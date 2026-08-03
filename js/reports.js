App.Reports={rows(){return [['Students',App.db.students.length],['Admissions',App.db.admissions.length],['Receipts',App.db.fees.length],['Attendance',App.db.attendance.length],['Pending Students',App.pendingStudents().length]]},

// Students with 2 or more unpaid months (from admission month up to the
// current month, based on the explicit fee "month" — not payment date).
defaulters(){
  return App.db.students.map(s=>{
    const months=App.feeMonthRange?App.feeMonthRange(s,0):[];
    const paid=App.studentPaidMonths?App.studentPaidMonths(s):new Set();
    const pendingMonths=months.filter(m=>!paid.has(m));
    return {student:s,pendingMonths};
  }).filter(x=>x.pendingMonths.length>=2);
},

renderDefaulters(){
  const target=App.$('#defaultersReport');
  if(!target)return;
  const list=this.defaulters();
  target.innerHTML=list.length?('<div class="tablewrap"><table><thead><tr><th>Student</th><th>Class</th><th>Mobile</th><th>Months Pending</th><th>Pending Amount</th><th>Action</th></tr></thead><tbody>'+list.map(d=>{
    const amount=d.pendingMonths.length*App.num(d.student.fees);
    return '<tr><td>'+App.esc(d.student.name)+'</td><td>'+App.esc(d.student.className||'-')+'</td><td>'+App.esc(d.student.mobile||'-')+'</td><td>'+d.pendingMonths.length+' ('+d.pendingMonths.map(m=>App.monthLabel(m)).join(', ')+')</td><td>'+App.rs(amount)+'</td><td><button data-defaulter-wa="'+App.esc(d.student.id)+'">WhatsApp</button></td></tr>';
  }).join('')+'</tbody></table></div>'):'<div class="empty">No defaulters found.</div>';
  App.$$('[data-defaulter-wa]').forEach(b=>b.onclick=()=>{const s=App.studentById(b.dataset.defaulterWa);if(s)App.whatsapp(s.mobile,(App.Dashboard&&App.Dashboard.reminderMessage)?App.Dashboard.reminderMessage(s):App.reminderText(s))});
},

// Present / total attendance-marked days this month, per student.
attendancePercent(){
  const m=App.monthKey(App.today());
  return App.db.students.map(s=>{
    const records=App.db.attendance.filter(a=>(a.studentId===s.id||App.norm(a.student)===App.norm(s.name))&&App.monthKey(a.date)===m);
    const present=records.filter(a=>a.status==='Present').length;
    const total=records.length;
    return {student:s,present,total,pct:total?Math.round((present/total)*100):null};
  }).filter(x=>x.total>0).sort((a,b)=>a.pct-b.pct);
},

renderAttendancePercent(){
  const target=App.$('#attendancePercentReport');
  if(!target)return;
  const list=this.attendancePercent();
  target.innerHTML=list.length?('<div class="tablewrap"><table><thead><tr><th>Student</th><th>Class</th><th>Present/Total</th><th>Attendance %</th></tr></thead><tbody>'+list.map(x=>'<tr><td>'+App.esc(x.student.name)+'</td><td>'+App.esc(x.student.className||'-')+'</td><td>'+x.present+'/'+x.total+'</td><td>'+x.pct+'%</td></tr>').join('')+'</tbody></table></div>'):'<div class="empty">No attendance marked this month yet.</div>';
},

render(){const q=App.filters.reports,students=App.db.students.filter(s=>App.matches(s,q,['admissionId','name','mobile','className']));const fees=App.db.fees.filter(f=>App.matches(f,q,['studentName','mobile','className']));App.$('#studentReport').textContent=students.length+' students matched. Total admissions: '+App.db.admissions.length+'.';App.$('#feesReport').textContent='Receipts: '+fees.length+'. Collection: '+App.rs(fees.reduce((a,f)=>a+App.num(f.total),0))+'.';App.$('#attendanceReport').textContent=App.db.attendance.filter(a=>a.status==='Present').length+' present, '+App.db.attendance.filter(a=>a.status==='Absent').length+' absent.';App.$('#monthlyReport').textContent=App.pendingStudents().length+' pending students. Pending: '+App.rs(App.pendingStudents().reduce((a,s)=>a+App.num(s.pendingFees||s.fees),0))+'.';this.renderDefaulters();this.renderAttendancePercent()},exportCsv(name='rainbow-report.csv'){App.csv(name,this.rows())},exportPdf(){const html='<h1>Rainbow ERP Report</h1><table>'+this.rows().map(r=>'<tr><th>'+App.esc(r[0])+'</th><td>'+App.esc(r[1])+'</td></tr>').join('')+'</table>';App.Pdf.openPrint('Rainbow ERP Report',html)}};
