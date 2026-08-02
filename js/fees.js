/**
 * App.Fees — Rainbow ERP fee collection module.
 *
 * PHASE 1 (MVP) NOTE — READ BEFORE TOUCHING RECEIPT NUMBER / TRANSACTION LOGIC:
 * True atomic receipt numbers and true multi-table transactions (receipt
 * insert + student totals update succeeding/failing together) require a
 * Postgres sequence/RPC function on the Supabase side. That is out of scope
 * for this phase (no schema/SQL changes allowed yet). Everything below is
 * the best possible CLIENT-SIDE approximation:
 *   - Receipt numbers are fetched fresh from Supabase right before use
 *     (never generated purely from local cache), which makes duplicates
 *     unlikely with a single admin, but does NOT eliminate a race condition
 *     if two admins submit in the same instant. Revisit with a DB
 *     sequence/RPC during the production hardening phase.
 *   - "Transaction" behavior is approximated with a compensating action:
 *     if the student-totals refresh fails after a successful receipt
 *     insert, the receipt is NOT rolled back (it's already safely in
 *     Supabase) — totals will self-correct on the next full data load,
 *     since paid/pending are always derived from fees_receipts, never
 *     trusted from the students table alone.
 *
 * Also note: the current fees_receipts schema only has
 * (id, receipt_no, student_id, amount, month, payment_mode, transaction_id,
 * receipt_date, pdf_url, pdf_path, shared_at). It has NO columns for
 * remarks, fee_type, discount, late_fee, or collected_by. Those fields are
 * captured in the Collect Fees popup (per spec) and used for the on-screen
 * receipt / PDF and in-memory state, but they are NOT persisted to Supabase
 * and will NOT survive a page reload / App.Supabase.load(). Add the columns
 * later if you want them permanent — flagging clearly here instead of
 * silently dropping them without a trace.
 */
App.Fees={

/** Centralized configuration — nothing below should be a magic number again. */
CONFIG:{
  RECEIPT_PREFIX:'RTL-',
  RECEIPT_NUMBER_PAD:4,
  PAYMENT_MODES:['Cash','UPI','Card','Bank Transfer','Cheque'],
  FEE_TYPES:['Monthly','Admission','Transport','Exam','Books','Uniform','Other'],
  MAX_PAYMENT:999999,
  MONTHS_BEFORE:3,
  MONTHS_AFTER:6,
  DUPLICATE_GUARD_MS:4000,
  OFFLINE_QUEUE_KEY:'rainbowERPPendingReceipts'
},

/* ============================================================
   MONEY HELPERS — integer paise internally, never raw floats.
   ============================================================ */
_toPaise(v){return Math.round(App.num(v)*100)},
_fromPaise(p){return Math.round(App.num(p))/100},

/* ============================================================
   SANITIZATION — defense in depth on top of App.esc() at render time.
   ============================================================ */
_sanitize(str,maxLen){
  return String(str||'').replace(/<[^>]*>/g,'').replace(/[\u0000-\u001F\u007F]/g,'').trim().slice(0,maxLen||500);
},

/* ============================================================
   EXISTING PUBLIC API — unchanged behavior, kept for backward compatibility.
   ============================================================ */

nextNo(){return this.CONFIG.RECEIPT_PREFIX+String((App.db.fees||[]).reduce((m,f)=>{const x=String(f.receiptNo||'').match(new RegExp('^'+this.CONFIG.RECEIPT_PREFIX+'(\\d+)$'));return Math.max(m,x?Number(x[1]):0)},0)+1).padStart(this.CONFIG.RECEIPT_NUMBER_PAD,'0')},

// Auto-loads the student's Monthly Fee (students.total_fees) into the receipt
// form and locks it so admin can't type a manual value. Also fills a live
// "Pending Amount" preview field if the form has one (#feesForm .pending).
fill(){
  const f=App.$('#feesForm'),s=App.studentByName(f.elements.studentName.value);
  if(!s)return;
  f.elements.studentId.value=s.id;
  f.elements.className.value=s.className;
  f.elements.mobile.value=s.mobile;
  const hasMonthlyFee=s.fees!==undefined&&s.fees!==null&&s.fees!==''&&App.num(s.fees)>0;
  const monthlyFee=App.num(s.fees);
  f.elements.monthly.value=hasMonthlyFee?monthlyFee:'';
  f.elements.monthly.readOnly=true; // Admin should not enter Monthly Fees manually
  if(!f.elements.fees.value)f.elements.fees.value=hasMonthlyFee?monthlyFee:'';
  if(!f.elements.total.value)f.elements.total.value=hasMonthlyFee?monthlyFee:'';
  this.updatePendingPreview(s);
  if(!hasMonthlyFee&&App.toast)App.toast('Monthly Fee Not Set. Update it from Admission Edit.');
},

/**
 * Unchanged public signature/behavior (manual #feesForm has no month
 * selector, so this still always previews the CURRENT month) but now
 * internally routed through the same paise-safe, month-parameterized
 * calculation used everywhere else — no duplicate math anymore.
 */
updatePendingPreview(student){
  const f=App.$('#feesForm');
  if(!f||!f.elements.pending)return;
  const s=student||App.studentByName(f.elements.studentName.value);
  if(!s)return;
  const monthKey=App.monthKey(App.today());
  f.elements.pending.value=this._fromPaise(this._pendingPaiseFromCache(s,monthKey));
},

render(){
  // Runtime recalculation of paid_fees/pending_fees/status after any receipt
  // add/edit/render pass. Reuses the existing App.refreshStudentFeeTotals
  // helper (same one already used on delete) instead of duplicating the math.
  if(App.refreshStudentFeeTotals){
    const affected=new Set(App.db.fees.map(f=>f.studentId||f.studentName).filter(Boolean));
    affected.forEach(key=>App.refreshStudentFeeTotals(key));
  }
  const data=App.db.fees.filter(f=>App.matches(f,App.filters.fees,['receiptNo','studentName','mobile','className']));
  const pdfCell=f=>f.pdfUrl?'<a target="_blank" href="'+App.esc(f.pdfUrl)+'">Open</a>':(f.pdfFailed?'<button class="yellow" data-retry-pdf="'+App.esc(f.id)+'">Retry PDF</button>':'-');
  const rows=data.map(f=>'<tr><td>'+App.esc(f.receiptNo)+'</td><td>'+App.esc(f.date)+'</td><td>'+App.esc(f.studentName)+'</td><td>'+App.esc(f.className)+'</td><td>'+App.rs(f.fees)+'</td><td>'+App.rs(f.total)+'</td><td>'+pdfCell(f)+'</td><td><button data-view-fee="'+App.esc(f.id)+'">View</button><button class="yellow" data-edit-fee="'+App.esc(f.id)+'">Edit</button><button class="red" data-del-fee="'+App.esc(f.id)+'">Delete</button></td></tr>');App.renderList('#feesTable',rows);const table=App.$('#feesTable'),wrap=table&&table.closest?table.closest('.tablewrap'):null;let cards=App.$('#feesCards');if(wrap&&wrap.classList)wrap.classList.add('fees-history-wrap');if(wrap&&!cards){cards=document.createElement('div');cards.id='feesCards';cards.className='fees-card-list';wrap.insertAdjacentElement('afterend',cards)}if(cards)cards.innerHTML=data.length?data.map(f=>{const mode=f.paymentMode||f.mode||'-',tx=f.transactionId||f.txnId||f.transactionNo||f.utr||'';return '<article class="fees-card"><div class="fees-card-head"><div><span>Receipt No.</span><strong>'+App.esc(f.receiptNo||'-')+'</strong></div><div><span>Date</span><strong>'+App.esc(f.date||'-')+'</strong></div></div><div class="fees-card-student"><b>'+App.esc(f.studentName||'-')+'</b><small>'+App.esc(f.className||'-')+'</small></div><div class="fees-card-grid"><div><span>Paid Fees</span><strong>'+App.rs(f.fees)+'</strong></div><div><span>Total Fees</span><strong>'+App.rs(f.total)+'</strong></div><div><span>Payment Mode</span><strong>'+App.esc(mode)+'</strong></div>'+(tx?'<div><span>Transaction ID</span><strong>'+App.esc(tx)+'</strong></div>':'')+'</div><div class="fees-card-actions"><button data-view-fee="'+App.esc(f.id)+'">View</button><button class="yellow" data-edit-fee="'+App.esc(f.id)+'">Edit</button><button class="red" data-del-fee="'+App.esc(f.id)+'">Delete</button></div></article>'}).join(''):'<div class="empty">No receipts found.</div>';
  App.$$('[data-view-fee]').forEach(b=>b.onclick=()=>App.Pdf.showReceipt(App.db.fees.find(x=>x.id===b.dataset.viewFee)));
  App.$$('[data-edit-fee]').forEach(b=>b.onclick=()=>this.edit(b.dataset.editFee));
  App.$$('[data-del-fee]').forEach(b=>b.onclick=()=>this.remove(b.dataset.delFee));
  App.$$('[data-retry-pdf]').forEach(b=>b.onclick=()=>{const f=App.db.fees.find(x=>x.id===b.dataset.retryPdf);if(f)this.generateReceiptPdfInBackground(f)});
},

edit(id){
  const fee=App.db.fees.find(x=>x.id===id),f=App.$('#feesForm');
  Object.keys(fee).forEach(k=>{if(f.elements[k])f.elements[k].value=fee[k]});
  if(f.elements.monthly)f.elements.monthly.readOnly=true;
  this.updatePendingPreview();
  App.$('#feesSubmit').textContent='Update Receipt'
},

async remove(id){
  if(!confirm('Receipt delete karna hai?'))return;
  const f=App.db.fees.find(x=>x.id===id);
  App.db.fees=App.db.fees.filter(x=>x.id!==id);
  await App.Supabase.delete('fees',f);
  if(f){
    App.refreshStudentFeeTotals(f.studentId||f.studentName);
    this._auditLog('fee_receipt_deleted',{id,receiptNo:f.receiptNo,studentId:f.studentId});
  }
  App.save();
},

/* ============================================================
   FEATURE 3 / 4 / 5 — Collect Fees -> Fee Receipt Popup -> Generate Receipt
   ============================================================ */

/** Small template helper so popup markup isn't one giant string. */
_field(labelText,inputHtml){
  return '<label>'+App.esc(labelText)+inputHtml+'</label>';
},

/**
 * Builds <option> list for the Fee Month selector — CONFIG.MONTHS_BEFORE
 * past months through CONFIG.MONTHS_AFTER future months. This is what makes
 * previous-month / current-month / advance (future-month) fee collection
 * possible instead of the old hardcoded "always current month" behavior.
 */
_feeMonthOptions(selectedKey){
  const base=App.parseDate(App.today())||new Date();
  const opts=[];
  for(let i=-this.CONFIG.MONTHS_BEFORE;i<=this.CONFIG.MONTHS_AFTER;i++){
    const d=new Date(base.getFullYear(),base.getMonth()+i,1);
    const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    const label=d.toLocaleString('en-IN',{month:'long',year:'numeric'});
    opts.push('<option value="'+key+'"'+(key===selectedKey?' selected':'')+'>'+App.esc(label)+'</option>');
  }
  return opts.join('');
},

/**
 * Sum (in paise) of everything already collected for one student in one
 * specific fee month, read from the already-loaded App.db.fees array
 * (which itself came from fees_receipts via App.Supabase.load() — never
 * from the students table). Used as the fast, synchronous path for
 * instant UI feedback when the admin switches the Fee Month dropdown.
 */
_collectedPaiseFromCache(student,monthKey){
  return App.db.fees.filter(f=>(f.studentId===student.id||App.norm(f.studentName)===App.norm(student.name))&&(f.month||App.monthKey(f.date))===monthKey).reduce((sum,f)=>sum+this._toPaise(f.total),0);
},

/**
 * Pending amount (paise) for one student + one fee month, derived ONLY from
 * fees_receipts data — never from student.pendingFees. This replaces the
 * old hardcoded-to-current-month calculation and works identically for
 * past, current, or future (advance) months.
 */
_pendingPaiseFromCache(student,monthKey){
  const monthlyPaise=this._toPaise(student.fees);
  if(!monthlyPaise)return 0;
  return Math.max(monthlyPaise-this._collectedPaiseFromCache(student,monthKey),0);
},

/**
 * Same calculation as _pendingPaiseFromCache but via a live Supabase query
 * scoped to this student, used once when the popup first opens so the
 * initial number is as fresh as possible. Falls back to cache on failure.
 */
async _fetchPendingPaise(student,monthKey){
  const monthlyPaise=this._toPaise(student.fees);
  if(!monthlyPaise)return 0;
  const c=App.Supabase.get();
  if(!c)return this._pendingPaiseFromCache(student,monthKey);
  try{
    const r=await c.from('fees_receipts').select('amount,month,receipt_date').eq('student_id',student.id);
    if(r.error)throw r.error;
    const collectedPaise=(r.data||[]).filter(row=>(row.month||App.monthKey(row.receipt_date))===monthKey).reduce((sum,row)=>sum+this._toPaise(row.amount),0);
    return Math.max(monthlyPaise-collectedPaise,0);
  }catch(e){
    console.warn('_fetchPendingPaise: Supabase lookup failed, using cached fees_receipts data',e);
    return this._pendingPaiseFromCache(student,monthKey);
  }
},

/**
 * Asks Supabase for the highest existing receipt number instead of trusting
 * the locally cached App.db.fees array. See the Phase 1 note at the top of
 * this file re: this is NOT a substitute for a real atomic DB sequence.
 */
async fetchNextReceiptNo(){
  const c=App.Supabase.get();
  if(!c)return this.nextNo();
  try{
    const r=await c.from('fees_receipts').select('receipt_no').order('id',{ascending:false}).limit(50);
    if(r.error)throw r.error;
    const prefixRe=new RegExp('^'+this.CONFIG.RECEIPT_PREFIX+'(\\d+)$');
    const max=(r.data||[]).reduce((m,row)=>{const match=String(row.receipt_no||'').match(prefixRe);return match?Math.max(m,Number(match[1])):m},0);
    return this.CONFIG.RECEIPT_PREFIX+String(max+1).padStart(this.CONFIG.RECEIPT_NUMBER_PAD,'0');
  }catch(e){
    console.warn('fetchNextReceiptNo: Supabase lookup failed, falling back to local calculation',e);
    return this.nextNo();
  }
},

loadingPopupHtml(student){
  return '<h2>Collect Fees</h2><p class="muted">Loading receipt details for <b>'+App.esc(student.name)+'</b>...</p>';
},

/**
 * Full Collect Fees popup. Every field from the spec is present. Discount /
 * Late Fee / Fee Type / Collected By are captured for the receipt PDF and
 * in-memory record but — per the schema note at the top of this file — are
 * NOT columns on fees_receipts yet, so they will not persist across a
 * reload until those columns are added.
 * @param {object} student
 * @param {string} receiptNo
 * @param {number} pendingAmount rupees (already converted from paise)
 * @returns {string}
 */
receiptPopupHtml(student,receiptNo,pendingAmount){
  const monthKey=App.monthKey(App.today());
  const modeOptions=this.CONFIG.PAYMENT_MODES.map(m=>'<option>'+App.esc(m)+'</option>').join('');
  const typeOptions=this.CONFIG.FEE_TYPES.map(t=>'<option>'+App.esc(t)+'</option>').join('');
  return '<h2>Collect Fees</h2>'
    +'<form id="collectFeeForm" class="form">'
    +'<input type="hidden" name="studentId" value="'+App.esc(student.id)+'">'
    +this._field('Receipt Number','<input name="receiptNo" value="'+App.esc(receiptNo)+'" readonly>')
    +this._field('Student Name','<input name="studentName" value="'+App.esc(student.name)+'" readonly>')
    +this._field('Admission Number','<input name="admissionId" value="'+App.esc(student.admissionId)+'" readonly>')
    +this._field('Father Name','<input name="fatherName" value="'+App.esc(student.fatherName||'-')+'" readonly>')
    +this._field('Mobile Number','<input name="mobileDisplay" value="'+App.esc(student.mobile||'-')+'" readonly>')
    +this._field('Class','<input name="className" value="'+App.esc(student.className||'-')+'" readonly>')
    +this._field('Monthly Fees','<input name="monthlyDisplay" value="'+App.num(student.fees)+'" readonly>')
    +this._field('Fee Month','<select name="feeMonth" id="collectFeeMonth">'+this._feeMonthOptions(monthKey)+'</select>')
    +this._field('Fee Type','<select name="feeType">'+typeOptions+'</select>')
    +this._field('Pending Amount (for selected month)','<input name="pendingDisplay" id="collectPendingDisplay" value="'+App.num(pendingAmount)+'" readonly>')
    +this._field('Discount','<input name="discount" type="number" min="0" step="1" value="0">')
    +this._field('Late Fee','<input name="lateFee" type="number" min="0" step="1" value="0">')
    +this._field('Paid Amount','<input name="amount" id="collectAmount" type="number" min="0" step="1" value="'+App.num(pendingAmount)+'" required>')
    +this._field('Payment Date','<input name="date" type="date" value="'+App.esc(App.today())+'" max="'+App.esc(App.today())+'" required>')
    +this._field('Payment Mode','<select name="paymentMode">'+modeOptions+'</select>')
    +this._field('Collected By','<input name="collectedBy" value="'+App.esc(App.AUTH_USER||'')+'">')
    +this._field('Remarks','<textarea name="remarks" placeholder="Optional" maxlength="500"></textarea>')
    +'<div id="collectFeeError" class="auth-error"></div>'
    +'<button type="submit" id="collectFeeSubmit">Generate Receipt</button>'
    +'</form>';
},

/**
 * Wires the Fee Month dropdown so Pending Amount + the suggested Paid
 * Amount update instantly (cache-based, so it stays responsive even with
 * 50,000+ receipts — no network round-trip per keystroke/selection).
 * Paid Amount is only auto-updated if the admin hasn't typed into it yet,
 * so we never overwrite a manual entry.
 */
_wireCollectPopupInteractions(student){
  const monthSel=App.$('#collectFeeMonth');
  const amountEl=App.$('#collectAmount');
  const pendingEl=App.$('#collectPendingDisplay');
  if(!monthSel||!amountEl||!pendingEl)return;
  let amountTouched=false;
  amountEl.addEventListener('input',()=>{amountTouched=true});
  monthSel.addEventListener('change',()=>{
    const pending=this._fromPaise(this._pendingPaiseFromCache(student,monthSel.value));
    pendingEl.value=pending;
    if(!amountTouched)amountEl.value=pending;
  });
},

/**
 * Opens the shared #modal for a student. Async loading state: the popup
 * renders instantly with a loading message while receiptNo (Supabase) and
 * pendingAmount (Supabase, from fees_receipts, current month) are fetched
 * in parallel — the real form only appears once both resolve.
 * @param {object} student
 */
async openCollectPopup(student){
  if(!student)return App.toast('Student not found');
  App.$('#modalBody').innerHTML=this.loadingPopupHtml(student);
  App.$('#modal').classList.add('show');
  try{
    const monthKey=App.monthKey(App.today());
    const[receiptNo,pendingPaise]=await Promise.all([
      this.fetchNextReceiptNo(),
      this._fetchPendingPaise(student,monthKey)
    ]);
    if(!App.$('#modal').classList.contains('show'))return; // closed while loading
    App.$('#modalBody').innerHTML=this.receiptPopupHtml(student,receiptNo,this._fromPaise(pendingPaise));
    this._wireCollectPopupInteractions(student);
    App.$('#collectFeeForm').onsubmit=e=>{e.preventDefault();this.generateReceipt(e.target,student)};
  }catch(e){
    console.warn('openCollectPopup: failed to prepare receipt popup',e);
    App.toast('Popup load karne me issue hua. Dobara try karein.');
    App.$('#modal').classList.remove('show');
  }
},

/**
 * Validates the Collect Fees form before any Supabase write. Pure function
 * of (data, student) — no network calls, so bad input never costs a request.
 * @returns {string[]} human-readable errors, empty array = valid
 */
validateCollectPayload(data,student){
  const errors=[];
  if(!student||!student.id)errors.push('Student not found.');
  if(!data.receiptNo)errors.push('Receipt number missing — please reopen the popup.');
  const amount=App.num(data.amount);
  if(!data.amount||Number.isNaN(amount)||amount<=0)errors.push('Amount must be a number greater than 0.');
  if(amount>this.CONFIG.MAX_PAYMENT)errors.push('Amount exceeds the maximum allowed payment (Rs. '+this.CONFIG.MAX_PAYMENT+').');
  const discount=App.num(data.discount);
  if(discount<0)errors.push('Discount cannot be negative.');
  if(discount>App.num(student.fees))errors.push('Discount cannot exceed the monthly fee.');
  const lateFee=App.num(data.lateFee);
  if(lateFee<0)errors.push('Late fee cannot be negative.');
  if(!data.date||!App.parseDate(data.date))errors.push('A valid payment date is required.');
  else if(data.date>App.today())errors.push('Payment date cannot be in the future.');
  if(!data.feeMonth||!/^\d{4}-\d{2}$/.test(data.feeMonth))errors.push('Select a valid fee month.');
  if(!data.paymentMode||!this.CONFIG.PAYMENT_MODES.includes(data.paymentMode))errors.push('Select a valid payment mode.');
  return errors;
},

/**
 * Duplicate-submission guard: blocks resubmitting the exact same
 * student+amount+date+mode within CONFIG.DUPLICATE_GUARD_MS of the last
 * successful submit (covers double-click / accidental double Enter).
 */
_isDuplicateSubmit(signature){
  const now=Date.now();
  const dup=this._lastSubmit&&this._lastSubmit.signature===signature&&(now-this._lastSubmit.at)<this.CONFIG.DUPLICATE_GUARD_MS;
  return dup;
},

/** Classifies a Supabase/network error into a category + friendly message. */
_classifyError(e){
  if(typeof navigator!=='undefined'&&navigator.onLine===false){
    return{type:'network',message:'Internet connection nahi hai. Receipt offline queue me save ho gayi — connection aane par automatically submit hogi.'};
  }
  const msg=String((e&&e.message)||e||'').toLowerCase();
  const code=e&&e.code?String(e.code):'';
  if(msg.includes('failed to fetch')||msg.includes('networkerror')||msg.includes('timeout'))return{type:'network',message:'Network/timeout issue. Dobara try karein ya connection check karein.'};
  if(code==='23505'||msg.includes('duplicate'))return{type:'duplicate',message:'Yeh receipt number pehle se exist karta hai. Popup dobara kholein.'};
  if(code==='42501'||msg.includes('permission')||msg.includes('rls')||msg.includes('403'))return{type:'permission',message:'Permission denied. Supabase RLS policy check karein.'};
  if(code==='23503'||msg.includes('foreign key'))return{type:'foreign_key',message:'Student record link nahi mila. Student dobara select karke try karein.'};
  return{type:'unexpected',message:'Kuch galat hua. Dobara try karein.'};
},

/** Best-effort audit trail. Logs to console always; also tries an
 * "audit_log" Supabase table if one exists, silently skipping if it
 * doesn't (no schema change made/assumed here). */
async _auditLog(action,details){
  console.info('[AUDIT]',action,details);
  const c=App.Supabase.get();
  if(!c)return;
  try{
    await c.from('audit_log').insert({action,details:JSON.stringify(details),created_at:new Date().toISOString()});
  }catch(e){/* audit_log table likely doesn't exist yet — safe to ignore */}
},

/** Queues a receipt payload locally when offline / on network failure. */
_queueOffline(payload){
  try{
    const q=App.safeParse(localStorage.getItem(this.CONFIG.OFFLINE_QUEUE_KEY)||'[]',[]);
    q.push({...payload,queuedAt:Date.now()});
    localStorage.setItem(this.CONFIG.OFFLINE_QUEUE_KEY,JSON.stringify(q));
  }catch(e){console.warn('_queueOffline failed',e)}
},

/**
 * Retries every queued offline receipt. Safe to call repeatedly (e.g. on
 * the browser's 'online' event) — successes are removed from the queue,
 * failures stay queued for the next attempt.
 */
async flushOfflineQueue(){
  let q;
  try{q=App.safeParse(localStorage.getItem(this.CONFIG.OFFLINE_QUEUE_KEY)||'[]',[])}catch{q=[]}
  if(!q.length)return;
  const remaining=[];
  let synced=0;
  for(const payload of q){
    try{
      const inserted=await App.Supabase.collectFee(payload);
      const student=App.studentById(payload.studentId);
      if(student){
        const item=this._buildFeeItem(inserted,payload,student);
        App.db.fees.unshift(item);
        App.refreshStudentFeeTotals(student.id);
        this._auditLog('fee_receipt_created_offline_sync',{receiptNo:item.receiptNo,studentId:student.id});
      }
      synced++;
    }catch(e){
      console.warn('flushOfflineQueue: retry failed, keeping in queue',e);
      remaining.push(payload);
    }
  }
  localStorage.setItem(this.CONFIG.OFFLINE_QUEUE_KEY,JSON.stringify(remaining));
  if(synced>0){App.save();App.toast(synced+' offline receipt(s) synced')}
},

/** Shared item-shape builder — used by both generateReceipt() and
 * flushOfflineQueue() so the mapping logic exists in exactly one place. */
_buildFeeItem(inserted,payload,student){
  return{
    id:String(inserted.id),
    receiptNo:inserted.receipt_no||payload.receiptNo,
    date:inserted.receipt_date||payload.date,
    studentId:student.id,
    studentName:student.name,
    className:student.className,
    admissionId:student.admissionId,
    monthly:App.num(student.fees),
    fees:App.num(inserted.amount!==undefined?inserted.amount:payload.amount),
    total:App.num(inserted.amount!==undefined?inserted.amount:payload.amount),
    mobile:student.mobile,
    month:inserted.month||payload.month,
    paymentMode:inserted.payment_mode||payload.paymentMode,
    transactionId:inserted.transaction_id||'',
    remarks:payload.remarks||'',
    feeType:payload.feeType||'',
    discount:App.num(payload.discount),
    lateFee:App.num(payload.lateFee),
    collectedBy:payload.collectedBy||'',
    pdfUrl:'',
    pdfFailed:false
  };
},

/**
 * FEATURE 5 — Generate Receipt.
 * 1. Prevents duplicate/concurrent submission (guard flag + button disable).
 * 2. Validates everything client-side first — no network call on bad input.
 * 3. Inserts via App.Supabase.collectFee(). On failure: classifies the
 *    error; network failures get queued offline and retried automatically
 *    (see flushOfflineQueue); other failures are reported and nothing is
 *    changed locally (receipt truly wasn't saved).
 * 4. On success: updates local state, recomputes student totals (best-effort
 *    "transaction" — see the Phase 1 note at the top of this file), closes
 *    the popup, and re-renders immediately. Fee collection is DONE here.
 * 5. PDF generation is fired afterwards and NEVER awaited — a slow/failing
 *    PDF/storage step can never block or fail the fee collection itself.
 */
async generateReceipt(formEl,student){
  if(this._submitting)return; // guards against double-submit / double-click
  const btn=App.$('#collectFeeSubmit');
  const errBox=App.$('#collectFeeError');
  const data=App.formData(formEl);

  const errors=this.validateCollectPayload(data,student);
  if(errors.length){
    if(errBox)errBox.textContent=errors[0];
    App.toast(errors[0]);
    return;
  }

  const signature=[student.id,data.amount,data.date,data.paymentMode,data.feeMonth].join('|');
  if(this._isDuplicateSubmit(signature)){
    App.toast('Yeh receipt already submit ho chuki hai — dobara submit nahi ki.');
    return;
  }

  if(errBox)errBox.textContent='';
  this._submitting=true;
  this._setPopupBusy(formEl,true);
  if(btn){btn.disabled=true;btn.textContent='Collecting...'}

  const discount=App.num(data.discount),lateFee=App.num(data.lateFee);
  const payload={
    receiptNo:data.receiptNo,
    studentId:student.id,
    studentName:student.name,
    amount:App.num(data.amount),
    date:data.date,
    month:data.feeMonth,
    paymentMode:data.paymentMode,
    remarks:this._sanitize(data.remarks,500),
    feeType:data.feeType,
    discount,
    lateFee,
    collectedBy:this._sanitize(data.collectedBy,120)
  };

  let inserted;
  try{
    inserted=await App.Supabase.collectFee(payload);
  }catch(e){
    console.warn('generateReceipt: collectFee insert failed',e);
    const info=this._classifyError(e);
    if(info.type==='network'){
      this._queueOffline(payload);
      App.$('#modal').classList.remove('show');
      App.toast(info.message);
    }else{
      App.toast(info.message);
      if(errBox)errBox.textContent=info.message;
    }
    this._submitting=false;
    this._setPopupBusy(formEl,false);
    if(btn){btn.disabled=false;btn.textContent='Generate Receipt'}
    return;
  }

  const item=this._buildFeeItem(inserted,payload,student);
  App.db.fees.unshift(item);

  try{
    App.refreshStudentFeeTotals(student.id);
  }catch(e){
    // Receipt is already safely saved in Supabase — this is non-fatal.
    // Totals are always re-derivable from fees_receipts on the next load().
    console.warn('generateReceipt: refreshStudentFeeTotals failed after successful insert',e);
  }

  this._lastSubmit={signature,at:Date.now()};
  this._auditLog('fee_receipt_created',{receiptNo:item.receiptNo,studentId:student.id,amount:item.total,month:item.month});

  App.$('#modal').classList.remove('show');
  App.save();
  App.toast('Receipt collected: '+item.receiptNo);

  this._submitting=false;
  if(btn){btn.disabled=false;btn.textContent='Generate Receipt'}

  // Fee collection has already succeeded and the UI has already moved on —
  // PDF happens afterwards and independently.
  this.generateReceiptPdfInBackground(item);
},

/** Disables/enables every input, the submit button, and the shared modal's
 * close button while a submission is in flight — also blocks Escape so the
 * popup can't be dismissed mid-submit, losing track of an in-flight write. */
_setPopupBusy(formEl,busy){
  if(formEl)Array.from(formEl.elements).forEach(el=>{el.disabled=busy});
  const closeBtn=App.$('#modalClose');
  if(closeBtn)closeBtn.disabled=busy;
  if(busy){
    this._escapeGuard=ev=>{if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation()}};
    document.addEventListener('keydown',this._escapeGuard,true);
  }else if(this._escapeGuard){
    document.removeEventListener('keydown',this._escapeGuard,true);
    this._escapeGuard=null;
  }
},

/**
 * Runs PDF creation + Storage upload without the caller waiting on it.
 * On failure: logs it, toasts a quiet notice, marks the record so render()
 * shows a "Retry PDF" button instead of silently losing the failure.
 */
generateReceiptPdfInBackground(item){
  App.Pdf.ensure('fees',item,'Fees Receipt',App.Pdf.receiptHtml(item),App.fileName(item.receiptNo+'-'+item.studentName)+'.pdf')
    .then(url=>{
      const idx=App.db.fees.findIndex(f=>f.id===item.id);
      if(idx===-1)return;
      if(url){
        App.db.fees[idx].pdfUrl=url;
        App.db.fees[idx].pdfFailed=false;
      }else{
        App.db.fees[idx].pdfFailed=true;
      }
      App.save();
    })
    .catch(e=>{
      console.warn('generateReceiptPdfInBackground: PDF/storage failed for receipt '+item.receiptNo,e);
      const idx=App.db.fees.findIndex(f=>f.id===item.id);
      if(idx>-1){App.db.fees[idx].pdfFailed=true;App.save()}
      App.toast('Receipt saved, lekin PDF banane me issue hua. "Retry PDF" button se dobara try karein.');
    });
}

};

// Auto-retry any receipts queued while offline, the moment connectivity
// returns. Guarded so re-running this script block doesn't double-register
// the listener.
if(!window.__rainbowFeesOfflineListenerAdded){
  window.__rainbowFeesOfflineListenerAdded=true;
  window.addEventListener('online',()=>App.Fees.flushOfflineQueue());
}
  if(App.refreshStudentFeeTotals){
    const affected=new Set(App.db.fees.map(f=>f.studentId||f.studentName).filter(Boolean));
    affected.forEach(key=>App.refreshStudentFeeTotals(key));
  }
  const data=App.db.fees.filter(f=>App.matches(f,App.filters.fees,['receiptNo','studentName','mobile','className']));const rows=data.map(f=>'<tr><td>'+App.esc(f.receiptNo)+'</td><td>'+App.esc(f.date)+'</td><td>'+App.esc(f.studentName)+'</td><td>'+App.esc(f.className)+'</td><td>'+App.rs(f.fees)+'</td><td>'+App.rs(f.total)+'</td><td>'+(f.pdfUrl?'<a target="_blank" href="'+App.esc(f.pdfUrl)+'">Open</a>':'-')+'</td><td><button data-view-fee="'+App.esc(f.id)+'">View</button><button class="yellow" data-edit-fee="'+App.esc(f.id)+'">Edit</button><button class="red" data-del-fee="'+App.esc(f.id)+'">Delete</button></td></tr>');App.renderList('#feesTable',rows);const table=App.$('#feesTable'),wrap=table&&table.closest?table.closest('.tablewrap'):null;let cards=App.$('#feesCards');if(wrap&&wrap.classList)wrap.classList.add('fees-history-wrap');if(wrap&&!cards){cards=document.createElement('div');cards.id='feesCards';cards.className='fees-card-list';wrap.insertAdjacentElement('afterend',cards)}if(cards)cards.innerHTML=data.length?data.map(f=>{const mode=f.paymentMode||f.mode||'-',tx=f.transactionId||f.txnId||f.transactionNo||f.utr||'';return '<article class="fees-card"><div class="fees-card-head"><div><span>Receipt No.</span><strong>'+App.esc(f.receiptNo||'-')+'</strong></div><div><span>Date</span><strong>'+App.esc(f.date||'-')+'</strong></div></div><div class="fees-card-student"><b>'+App.esc(f.studentName||'-')+'</b><small>'+App.esc(f.className||'-')+'</small></div><div class="fees-card-grid"><div><span>Paid Fees</span><strong>'+App.rs(f.fees)+'</strong></div><div><span>Total Fees</span><strong>'+App.rs(f.total)+'</strong></div><div><span>Payment Mode</span><strong>'+App.esc(mode)+'</strong></div>'+(tx?'<div><span>Transaction ID</span><strong>'+App.esc(tx)+'</strong></div>':'')+'</div><div class="fees-card-actions"><button data-view-fee="'+App.esc(f.id)+'">View</button><button class="yellow" data-edit-fee="'+App.esc(f.id)+'">Edit</button><button class="red" data-del-fee="'+App.esc(f.id)+'">Delete</button></div></article>'}).join(''):'<div class="empty">No receipts found.</div>';App.$$('[data-view-fee]').forEach(b=>b.onclick=()=>App.Pdf.showReceipt(App.db.fees.find(x=>x.id===b.dataset.viewFee)));App.$$('[data-edit-fee]').forEach(b=>b.onclick=()=>this.edit(b.dataset.editFee));App.$$('[data-del-fee]').forEach(b=>b.onclick=()=>this.remove(b.dataset.delFee))
},

edit(id){
  const fee=App.db.fees.find(x=>x.id===id),f=App.$('#feesForm');
  Object.keys(fee).forEach(k=>{if(f.elements[k])f.elements[k].value=fee[k]});
  if(f.elements.monthly)f.elements.monthly.readOnly=true;
  this.updatePendingPreview();
  App.$('#feesSubmit').textContent='Update Receipt'
},

async remove(id){if(!confirm('Receipt delete karna hai?'))return;const f=App.db.fees.find(x=>x.id===id);App.db.fees=App.db.fees.filter(x=>x.id!==id);await App.Supabase.delete('fees',f);if(f)App.refreshStudentFeeTotals(f.studentId||f.studentName);App.save()}};
