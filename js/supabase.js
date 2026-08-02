App.Supabase={client:null,get(){if(!window.supabase)return null;const s=App.db.settings;this.client=window.supabase.createClient(s.supabaseUrl||App.SUPABASE_URL,s.supabaseKey||App.SUPABASE_ANON_KEY);return this.client},isNum:id=>/^d+$/.test(String(id||"")),studentRow(r){return{id:r.student_id||String(r.id),rowId:r.id,admissionId:r.admission_no||r.student_id||String(r.id),name:r.student_name||"",fatherName:r.father_name||"",motherName:r.mother_name||"",schoolName:r.school_name||"",fees:r.total_fees||0,paidFees:r.paid_fees||0,pendingFees:r.pending_fees||0,date:r.admission_date||"",className:r.class||"",batch:r.batch||"",mobile:r.mobile||"",address:r.address||"",status:r.status||"Active",pdfUrl:r.pdf_url||""}},studentDb(s){const total=App.num(s.fees),paid=App.num(s.paidFees);return{student_id:s.id||s.student_id||App.uid(),admission_no:s.admissionId||"",student_name:s.name||s.studentName||"",father_name:s.fatherName||"",mother_name:s.motherName||"",mobile:s.mobile||"",class:s.className||"",batch:s.batch||"",school_name:s.schoolName||"",admission_date:s.date||null,address:s.address||"",total_fees:total,paid_fees:paid,pending_fees:Math.max(total-paid,0),status:s.status||"Active",pdf_url:s.pdfUrl||null}},admissionRow(r,map){const s=map.get(r.student_id)||{};return{id:String(r.id),studentId:r.student_id||"",date:r.admission_date||s.date||"",admissionId:s.admissionId||r.student_id||"",studentName:s.name||r.student_id||"",fatherName:s.fatherName||"",motherName:s.motherName||"",mobile:s.mobile||"",schoolName:s.schoolName||"",className:s.className||"",batch:s.batch||"",address:s.address||"",remarks:r.remarks||"",pdfUrl:r.pdf_url||"",pdfPath:r.pdf_path||"",sharedAt:r.shared_at||""}},admissionDb(a){return{student_id:a.studentId||a.id||a.admissionId||"",admission_date:a.date||null,remarks:a.remarks||"",pdf_url:a.pdfUrl||null,pdf_path:a.pdfPath||null,shared_at:a.sharedAt||null}},feeRow(r,map){const s=map.get(r.student_id)||{};return{id:String(r.id),receiptNo:r.receipt_no||"",date:r.receipt_date||String(r.created_at||App.today()).slice(0,10),studentId:r.student_id||"",studentName:s.name||r.student_id||"",className:s.className||"",monthly:s.fees||r.amount||0,fees:r.amount||0,total:r.amount||0,mobile:s.mobile||"",month:r.month||"",paymentMode:r.payment_mode||"Cash",transactionId:r.transaction_id||"",remarks:r.remarks||"",pdfUrl:r.pdf_url||"",pdfPath:r.pdf_path||"",sharedAt:r.shared_at||"",pdfLink:r.pdf_url||"Supabase"}},feeDb(f){const st=App.studentByName(f.studentName)||{};return{receipt_no:f.receiptNo||"",student_id:f.studentId||st.id||f.studentName||"",amount:App.num(f.total||f.fees),month:f.month||App.monthKey(f.date),receipt_date:f.date||App.today(),payment_mode:f.paymentMode||"Cash",transaction_id:f.transactionId||"",pdf_url:f.pdfUrl||null,pdf_path:f.pdfPath||null,shared_at:f.sharedAt||null}},attendanceRow(r,map){const s=map.get(r.student_id)||{};return{id:String(r.id),studentId:r.student_id||"",date:r.attendance_date||"",student:s.name||r.student_id||"",className:s.className||"",status:r.status||"",timeIn:r.time_in||"",timeOut:r.time_out||"",remarks:r.remarks||""}},attendanceDb(a){return{student_id:a.studentId||"",attendance_date:a.date||App.today(),status:a.status||"Present",time_in:a.timeIn||null,time_out:a.timeOut||null,remarks:a.remarks||""}},async load(){const c=this.get();if(!c)return;try{const st=await c.from("students").select("*").order("created_at",{ascending:false});if(st.error)throw st.error;App.db.students=(st.data||[]).map(this.studentRow);const map=new Map(App.db.students.map(s=>[s.id,s]));const ad=await c.from("admissions").select("*").order("created_at",{ascending:false});if(ad.error)throw ad.error;App.db.admissions=(ad.data||[]).map(r=>this.admissionRow(r,map));const fr=await c.from("fees_receipts").select("*").order("created_at",{ascending:false});if(fr.error)throw fr.error;App.db.fees=(fr.data||[]).map(r=>this.feeRow(r,map));const at=await c.from("attendance").select("*").order("created_at",{ascending:false});if(at.error)throw at.error;App.db.attendance=(at.data||[]).map(r=>this.attendanceRow(r,map));App.saveLocal();App.render();App.toast("Supabase connected")}catch(e){console.warn(e);App.toast("Supabase connection issue. Local data shown.")}},async upsert(table,item){const c=this.get();if(!c)return item;try{if(table==="students"){const row=this.studentDb(item);item.id=row.student_id;const r=await c.from("students").upsert(row,{onConflict:"student_id"});if(r.error)throw r.error;return item}const actual=table==="fees"?"fees_receipts":table;const row=table==="admissions"?this.admissionDb(item):table==="fees"?this.feeDb(item):this.attendanceDb(item);const q=c.from(actual);const r=this.isNum(item.id)?await q.update(row).eq("id",item.id):await q.insert(row).select("id").single();if(r.error)throw r.error;if(!this.isNum(item.id)&&r.data?.id)item.id=String(r.data.id);return item}catch(e){console.warn(e);App.toast("Supabase save issue. Local copy saved.");return item}},async updatePdf(table,item){const c=this.get();if(!c||!this.isNum(item.id))return;const actual=table==="fees"?"fees_receipts":table;await c.from(actual).update({pdf_url:item.pdfUrl||null,pdf_path:item.pdfPath||null,shared_at:item.sharedAt||null}).eq("id",item.id)},async delete(table,item){const c=this.get();if(!c||!item)return;try{if(item.pdfPath)await App.Storage.remove(item.pdfPath);if(table==="students"){await c.from("students").delete().eq("student_id",item.id);return}const actual=table==="fees"?"fees_receipts":table;if(this.isNum(item.id))await c.from(actual).delete().eq("id",item.id)}catch(e){console.warn(e)}},

/**
 * Feature 5 — Generate Receipt data-layer operation.
 * Inserts one row into fees_receipts for a Collect Fees action.
 * Defensive against schema drift: if the "remarks" column does not exist on
 * fees_receipts, retries the insert without it instead of failing the whole
 * collection flow. Does NOT touch students table — caller must separately
 * call App.refreshStudentFeeTotals(studentId) after this resolves, so
 * paid_fees / pending_fees stay derived from actual receipt rows (single
 * source of truth, no duplicate calculation logic).
 * next_due_date is intentionally never written here — there is no such
 * column on students; it stays a client-side calculation via App.nextDueDate().
 * @param {{receiptNo:string,studentId:string,studentName:string,amount:number,date:string,paymentMode:string,transactionId?:string,remarks?:string}} payload
 * @returns {Promise<object>} the inserted DB row (snake_case, raw from Supabase)
 */
async collectFee(payload){
  const c=this.get();
  if(!c)throw new Error("Supabase client not available");
  const row={
    receipt_no:payload.receiptNo||"",
    student_id:payload.studentId||"",
    amount:App.num(payload.amount),
    month:payload.month||App.monthKey(payload.date),
    receipt_date:payload.date||App.today(),
    payment_mode:payload.paymentMode||"Cash",
    transaction_id:payload.transactionId||"",
    remarks:payload.remarks||""
  };
  let r=await c.from("fees_receipts").insert(row).select("*").single();
  if(r.error&&/remarks/i.test(r.error.message||"")){
    console.warn("fees_receipts.remarks column not found — inserting without remarks. Add the column in Supabase if you want remarks stored.");
    delete row.remarks;
    r=await c.from("fees_receipts").insert(row).select("*").single();
  }
  if(r.error)throw r.error;
  return r.data;
}

};
