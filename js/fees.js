App.Fees={nextNo(){return 'RTL-'+String((App.db.fees||[]).reduce((m,f)=>{const x=String(f.receiptNo||'').match(/^RTL-(\d+)$/);return Math.max(m,x?Number(x[1]):0)},0)+1).padStart(4,'0')},

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

updatePendingPreview(student){
  const f=App.$('#feesForm');
  if(!f||!f.elements.pending)return;
  const s=student||App.studentByName(f.elements.studentName.value);
  if(!s)return;
  const monthlyFee=App.num(s.fees);
  const m=App.monthKey?App.monthKey(App.today()):'';
  const collectedThisMonth=App.db.fees.filter(x=>(x.studentId===s.id||App.norm(x.studentName)===App.norm(s.name))&&(App.monthKey?App.monthKey(x.date):'')===m).reduce((a,x)=>a+App.num(x.total),0);
  f.elements.pending.value=monthlyFee?Math.max(monthlyFee-collectedThisMonth,0):0;
},

render(){
  // Runtime recalculation of paid_fees/pending_fees/status after any receipt
  // add/edit/render pass. Reuses the existing App.refreshStudentFeeTotals
  // helper (same one already used on delete) instead of duplicating the math.
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
