App.Admission={nextId(){const all=App.db.admissions.map(a=>a.admissionId).concat(App.db.students.map(s=>s.admissionId));return String(all.reduce((m,id)=>Math.max(m,Number(id)||0),0)+1).padStart(4,'0')},

// Keeps students.total_fees / paid_fees / pending_fees / status aligned with the
// Admission's Monthly Fees value. Reuses the existing App.refreshStudentFeeTotals
// helper (already used by Fees/Students) instead of duplicating the calculation.
// Safe to call repeatedly: it only writes when something actually changed.
syncStudentFees(a){
  if(!a||a.monthlyFees===undefined||a.monthlyFees===null||a.monthlyFees==='')return;
  const student=App.studentById(a.studentId)||App.studentByName(a.studentName);
  if(!student)return;
  const monthlyFee=App.num(a.monthlyFees);
  const isNewStudent=student.paidFees===undefined||student.paidFees===null;
  if(App.num(student.fees)===monthlyFee&&!isNewStudent)return;
  student.fees=monthlyFee;
  if(isNewStudent){
    student.paidFees=App.num(student.paidFees)||0;
    student.status=student.status||'Active';
  }
  if(App.refreshStudentFeeTotals)App.refreshStudentFeeTotals(student.id||student.name);
  else student.pendingFees=Math.max(monthlyFee-App.num(student.paidFees),0);
},

render(){
  App.db.admissions.forEach(a=>this.syncStudentFees(a));
  const rows=App.db.admissions.filter(a=>App.matches(a,App.filters.admission,['admissionId','studentName','mobile','className'])).map(a=>'<tr><td>'+App.esc(a.date)+'</td><td>'+App.esc(a.admissionId)+'</td><td>'+App.esc(a.studentName)+'</td><td>'+App.esc(a.className)+'</td><td>'+App.esc(a.mobile)+'</td><td>'+(a.pdfUrl?'<a target="_blank" href="'+App.esc(a.pdfUrl)+'">Open</a>':'-')+'</td><td><button data-view-ad="'+App.esc(a.id)+'">View</button><button class="yellow" data-edit-ad="'+App.esc(a.id)+'">Edit</button><button class="red" data-del-ad="'+App.esc(a.id)+'">Delete</button></td></tr>');App.renderList('#admissionTable',rows);App.$$('[data-view-ad]').forEach(b=>b.onclick=()=>App.Pdf.showAdmission(App.db.admissions.find(x=>x.id===b.dataset.viewAd)));App.$$('[data-edit-ad]').forEach(b=>b.onclick=()=>this.edit(b.dataset.editAd));App.$$('[data-del-ad]').forEach(b=>b.onclick=()=>this.remove(b.dataset.delAd))
},

edit(id){const a=App.db.admissions.find(x=>x.id===id),f=App.$('#admissionForm');Object.keys(a).forEach(k=>{if(f.elements[k])f.elements[k].value=a[k]});App.$('#admissionSubmit').textContent='Update Admission'},

async remove(id){if(!confirm('Admission delete karna hai?'))return;const a=App.db.admissions.find(x=>x.id===id);App.db.admissions=App.db.admissions.filter(x=>x.id!==id);await App.Supabase.delete('admissions',a);App.save()}};
