const AUTH_USER = "admin";
const AUTH_PASS = "Rainbow@123";
const AUTH_KEY = "rainbowERPLoggedIn";
const STORE_KEY = "rainbowERPAdminV2";
const SUPABASE_URL = "https://vlgoqihzrrckjpbyfbhl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsZ29xaWh6cnJja2pwYnlmYmhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MzkzMTYsImV4cCI6MjA5ODExNTMxNn0.FKchXI87PRlhZB7f3_xmbmg1B6rRdUmrNSeA66IIArc";
const logoPath = "assets/logo.png";
function localDateString(date) { const d = date || new Date(); const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0"); return y + "-" + m + "-" + day; }
const today = () => localDateString(new Date());
const rs = (value) => "Rs. " + Number(value || 0).toLocaleString("en-IN");
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const uid = () => String(Date.now()) + "-" + Math.random().toString(16).slice(2);

let db = JSON.parse(localStorage.getItem(STORE_KEY) || localStorage.getItem("rainbowERP") || "null") || {
  students: [], admissions: [], fees: [], attendance: [],
  settings: { name: "Rainbow The Learner Zone", address: "110/2, Nehru Nagar, Indore", session: "2026-27", appsScriptUrl: "", supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_ANON_KEY }
};
let filters = { students: "", admission: "", fees: "", attendance: "", reports: "" };
let sb = null;
let supabaseConnected = false;

function supabaseClient() {
  if (sb) return sb;
  if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return sb;
}
function isNumericId(id) { return /^\d+$/.test(String(id || "")); }
function moneyNumber(value) { return Number(value || 0); }
function rowToStudent(row) {
  return {
    id: row.student_id || String(row.id),
    rowId: row.id,
    admissionId: row.admission_no || row.student_id || String(row.id),
    name: row.student_name || "",
    fatherName: row.father_name || "",
    motherName: row.mother_name || "",
    schoolName: row.school_name || "",
    fees: row.total_fees || row.pending_fees || 0,
    paidFees: row.paid_fees || 0,
    pendingFees: row.pending_fees || 0,
    date: row.admission_date || "",
    className: row.class || "",
    batch: row.batch || "",
    mobile: row.mobile || "",
    address: row.address || "",
    status: row.status || "Active",
    message: ""
  };
}
function studentToRow(item) {
  const total = moneyNumber(item.fees || item.totalFees || item.total_fees);
  const paid = moneyNumber(item.paidFees || item.paid_fees);
  return {
    student_id: item.id || item.student_id || uid(),
    admission_no: item.admissionId || item.admission_no || "",
    student_name: item.name || item.studentName || item.student_name || "",
    father_name: item.fatherName || item.father_name || "",
    mother_name: item.motherName || item.mother_name || "",
    mobile: item.mobile || "",
    class: item.className || item.class || "",
    batch: item.batch || "",
    school_name: item.schoolName || item.school_name || "",
    admission_date: item.date || item.admissionDate || item.admission_date || null,
    address: item.address || "",
    total_fees: total,
    paid_fees: paid,
    pending_fees: Math.max(total - paid, 0),
    status: item.status || "Active"
  };
}
function rowToAdmission(row, studentMap) {
  const s = studentMap.get(row.student_id) || {};
  return {
    id: String(row.id),
    studentId: row.student_id || "",
    date: row.admission_date || s.date || "",
    admissionId: s.admissionId || row.student_id || "",
    studentName: s.name || row.student_id || "",
    fatherName: s.fatherName || "",
    motherName: s.motherName || "",
    mobile: s.mobile || "",
    schoolName: s.schoolName || "",
    className: s.className || "",
    batch: s.batch || "",
    address: s.address || "",
    remarks: row.remarks || ""
  };
}
function admissionToRow(item) {
  return {
    student_id: item.studentId || item.id || item.admissionId || "",
    admission_date: item.date || item.admission_date || null,
    remarks: item.remarks || ""
  };
}
function rowToFee(row, studentMap) {
  const s = studentMap.get(row.student_id) || {};
  return {
    id: String(row.id),
    receiptNo: row.receipt_no || "",
    date: row.created_at ? String(row.created_at).slice(0, 10) : today(),
    studentId: row.student_id || "",
    studentName: s.name || row.student_id || "",
    className: s.className || "",
    monthly: s.fees || row.amount || 0,
    fees: row.amount || 0,
    total: row.amount || 0,
    mobile: s.mobile || "",
    month: row.month || "",
    paymentMode: row.payment_mode || "",
    transactionId: row.transaction_id || "",
    pdfLink: "Supabase"
  };
}
function feeToRow(item) {
  const s = studentByName(item.studentName) || {};
  return {
    receipt_no: item.receiptNo || "",
    student_id: item.studentId || s.id || item.studentName || "",
    amount: moneyNumber(item.total || item.fees || item.amount),
    month: item.month || (item.date ? item.date.slice(0, 7) : today().slice(0, 7)),
    payment_mode: item.paymentMode || "Cash",
    transaction_id: item.transactionId || ""
  };
}
function rowToAttendance(row, studentMap) {
  const s = studentMap.get(row.student_id) || {};
  return {
    id: String(row.id),
    studentId: row.student_id || "",
    date: row.attendance_date || "",
    student: s.name || row.student_id || "",
    className: s.className || "",
    status: row.status || "",
    timeIn: row.time_in || "",
    timeOut: row.time_out || "",
    remarks: row.remarks || ""
  };
}
function attendanceToRow(item) {
  return {
    student_id: item.studentId || "",
    attendance_date: item.date || today(),
    status: item.status || "Present",
    time_in: item.timeIn || null,
    time_out: item.timeOut || null,
    remarks: item.remarks || ""
  };
}
async function loadSupabaseData() {
  const client = supabaseClient();
  if (!client) return;
  try {
    const studentsRes = await client.from("students").select("*").order("created_at", { ascending: false });
    if (studentsRes.error) throw studentsRes.error;
    db.students = (studentsRes.data || []).map(rowToStudent);
    const studentMap = new Map(db.students.map((student) => [student.id, student]));

    const admissionsRes = await client.from("admissions").select("*").order("created_at", { ascending: false });
    if (admissionsRes.error) throw admissionsRes.error;
    db.admissions = (admissionsRes.data || []).map((row) => rowToAdmission(row, studentMap));

    const feesRes = await client.from("fees_receipts").select("*").order("created_at", { ascending: false });
    if (feesRes.error) throw feesRes.error;
    db.fees = (feesRes.data || []).map((row) => rowToFee(row, studentMap));

    const attendanceRes = await client.from("attendance").select("*").order("created_at", { ascending: false });
    if (attendanceRes.error) throw attendanceRes.error;
    db.attendance = (attendanceRes.data || []).map((row) => rowToAttendance(row, studentMap));

    supabaseConnected = true;
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
    render();
    toast("Supabase connected");
  } catch (error) {
    supabaseConnected = false;
    console.warn("Supabase load failed", error);
    toast("Supabase connection issue. Local mode active.");
  }
}
async function upsertSupabase(table, item) {
  const client = supabaseClient();
  if (!client || !item) return;
  try {
    if (table === "students") {
      const row = studentToRow(item);
      item.id = row.student_id;
      const res = await client.from("students").upsert(row, { onConflict: "student_id" });
      if (res.error) throw res.error;
      return;
    }
    if (table === "admissions") {
      const row = admissionToRow(item);
      const query = client.from("admissions");
      const res = isNumericId(item.id) ? await query.update(row).eq("id", item.id) : await query.insert(row).select("id").single();
      if (res.error) throw res.error;
      if (!isNumericId(item.id) && res.data && res.data.id) item.id = String(res.data.id);
      localStorage.setItem(STORE_KEY, JSON.stringify(db));
      return;
    }
    if (table === "fees") {
      const row = feeToRow(item);
      const query = client.from("fees_receipts");
      const res = isNumericId(item.id) ? await query.update(row).eq("id", item.id) : await query.insert(row).select("id").single();
      if (res.error) throw res.error;
      if (!isNumericId(item.id) && res.data && res.data.id) item.id = String(res.data.id);
      localStorage.setItem(STORE_KEY, JSON.stringify(db));
      return;
    }
    if (table === "attendance") {
      const row = attendanceToRow(item);
      const query = client.from("attendance");
      const res = isNumericId(item.id) ? await query.update(row).eq("id", item.id) : await query.insert(row).select("id").single();
      if (res.error) throw res.error;
      if (!isNumericId(item.id) && res.data && res.data.id) item.id = String(res.data.id);
      localStorage.setItem(STORE_KEY, JSON.stringify(db));
    }
  } catch (error) { console.warn("Supabase save failed", table, error); toast("Supabase save issue. Local copy saved."); }
}
async function deleteSupabase(table, id) {
  const client = supabaseClient();
  if (!client || !id) return;
  try {
    if (table === "students") { const res = await client.from("students").delete().eq("student_id", id); if (res.error) throw res.error; return; }
    const actual = table === "fees" ? "fees_receipts" : table;
    if (!isNumericId(id)) return;
    const res = await client.from(actual).delete().eq("id", id);
    if (res.error) throw res.error;
  } catch (error) { console.warn("Supabase delete failed", table, error); }
}
async function saveSettingsSupabase() { return; }
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(db)); render(); }
function toast(text) { const box = $("#toast"); box.textContent = text; box.classList.add("show"); setTimeout(() => box.classList.remove("show"), 2200); }
function dataFrom(form) { return Object.fromEntries(new FormData(form).entries()); }
function parseDate(date) { const d = new Date(String(date || "") + "T00:00:00"); return Number.isNaN(d.getTime()) ? null : d; }
function fmt(date) { return date ? localDateString(date) : ""; }
function sameMonth(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }
function addMonthsClamped(date, months) { const d = parseDate(date); if (!d) return null; const day = d.getDate(); const result = new Date(d.getFullYear(), d.getMonth() + months, 1); const last = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate(); result.setDate(Math.min(day, last)); return result; }
function daysBetween(a, b) { return Math.floor((parseDate(a) - parseDate(b)) / 86400000); }
function normalize(text) { return String(text || "").toLowerCase().trim(); }
function matches(item, query, keys) { const q = normalize(query); if (!q) return true; return keys.some((key) => normalize(item[key]).includes(q)); }
function studentByName(name) { return db.students.find((student) => normalize(student.name) === normalize(name)); }
function refreshStudentFeeTotals(studentName) { const s = studentByName(studentName); if (!s) return; const paid = db.fees.filter((fee) => normalize(fee.studentName) === normalize(studentName)).reduce((sum, fee) => sum + Number(fee.total || fee.fees || 0), 0); s.paidFees = paid; s.pendingFees = Math.max(Number(s.fees || 0) - paid, 0); upsertSupabase("students", s); }
function feesForStudentMonth(student, dueDate) { return db.fees.some((fee) => normalize(fee.studentName) === normalize(student.name) && sameMonth(parseDate(fee.date), dueDate)); }
function nextDueDate(student, reference) {
  const admission = parseDate(student.date); const ref = parseDate(reference || today()); if (!admission || !ref) return null;
  let months = (ref.getFullYear() - admission.getFullYear()) * 12 + (ref.getMonth() - admission.getMonth());
  months = Math.max(1, months);
  let due = addMonthsClamped(student.date, months);
  if (due < ref && !sameMonth(due, ref)) due = addMonthsClamped(student.date, months + 1);
  if (feesForStudentMonth(student, due)) due = addMonthsClamped(student.date, months + 1);
  return due;
}
function isDueToday(student) { const due = nextDueDate(student); return fmt(due) === today() && !feesForStudentMonth(student, due); }
function isUpcomingDue(student) { const due = nextDueDate(student); if (!due || feesForStudentMonth(student, due)) return false; const diff = daysBetween(fmt(due), today()); return diff >= 1 && diff <= 7; }
function pendingFeeStudents() { return db.students.filter((student) => { const due = nextDueDate(student); return due && fmt(due) <= today() && !feesForStudentMonth(student, due); }); }
function reminderText(student) { const due = nextDueDate(student); return student.message || "Dear Parent, " + student.name + " (" + student.className + ") ki monthly fees due date " + fmt(due) + " hai. Kripya fees jama karein. - Rainbow The Learner Zone"; }
function whatsapp(mobile, text) { let number = String(mobile || "").replace(/\D/g, ""); if (number.length === 10) number = "91" + number; window.open("https://wa.me/" + number + "?text=" + encodeURIComponent(text), "_blank"); }
function saveToSheet(type, payload) { const url = db.settings.appsScriptUrl; if (!url) return; fetch(url, { method: "POST", mode: "no-cors", body: JSON.stringify({ type, payload }) }).catch(() => {}); }
function nextAdmissionId() { const all = db.admissions.map((x) => x.admissionId).concat(db.students.map((x) => x.admissionId)); const max = all.reduce((n, id) => Math.max(n, Number(id) || 0), 0); return String(max + 1).padStart(4, "0"); }
function nextReceiptNo() { const max = db.fees.reduce((n, item) => { const match = String(item.receiptNo || "").match(/RTL-(\d+)/); return Math.max(n, match ? Number(match[1]) : 0); }, 0); return "RTL-" + String(max + 1).padStart(4, "0"); }
function setDefaults() { $("#studentForm [name=date]").value = today(); $("#admissionForm [name=date]").value = today(); $("#admissionForm [name=admissionId]").value = nextAdmissionId(); $("#feesForm [name=date]").value = today(); $("#feesForm [name=receiptNo]").value = nextReceiptNo(); $("#attendanceDate").value = today(); }
function resetForm(formSelector, submitSelector, submitText) { const form = $(formSelector); form.reset(); form.querySelector('[name="id"]').value = ""; $(submitSelector).textContent = submitText; setDefaults(); }
function applyAuth() { const ok = sessionStorage.getItem(AUTH_KEY) === "yes"; document.body.classList.toggle("locked", !ok); $("#loginScreen").style.display = ok ? "none" : "grid"; }
function doLogin(event) { event.preventDefault(); const item = dataFrom(event.target); if (item.username !== AUTH_USER || item.password !== AUTH_PASS) { $("#loginError").classList.add("show"); return; } sessionStorage.setItem(AUTH_KEY, "yes"); $("#loginError").classList.remove("show"); applyAuth(); toast("Login successful"); }
function doLogout() { sessionStorage.removeItem(AUTH_KEY); applyAuth(); toast("Logged out"); }
function docHeader(title) { return '<div class="doch"><img src="' + logoPath + '" alt=""><div><h2>' + db.settings.name + '</h2><p>' + db.settings.address + '</p><b>' + title + '</b></div></div>'; }
function showAdmissionDoc(item) { $("#admissionDoc").className = "doc ready"; $("#admissionDoc").innerHTML = docHeader("Admission Form") + '<div class="docgrid"><div><b>Date:</b> ' + item.date + '</div><div><b>Admission ID:</b> ' + item.admissionId + '</div><div><b>Student:</b> ' + item.studentName + '</div><div><b>Class:</b> ' + item.className + '</div><div><b>Father:</b> ' + item.fatherName + '</div><div><b>Mother:</b> ' + item.motherName + '</div><div><b>Mobile:</b> ' + item.mobile + '</div><div><b>School:</b> ' + (item.schoolName || "-") + '</div><div><b>Batch:</b> ' + (item.batch || "-") + '</div><div><b>Address:</b> ' + (item.address || "-") + '</div></div><div class="actions"><button onclick="window.print()">Print PDF</button><button id="admissionWa">WhatsApp Form</button></div>'; $("#admissionWa").onclick = () => whatsapp(item.mobile, "Admission Form: " + item.studentName + ", Class " + item.className + ", ID " + item.admissionId); }
function showReceiptDoc(item) { $("#receiptDoc").className = "doc ready"; $("#receiptDoc").innerHTML = docHeader("Fees Receipt") + '<div class="docgrid"><div><b>Receipt No.:</b> ' + item.receiptNo + '</div><div><b>Date:</b> ' + item.date + '</div><div><b>Student:</b> ' + item.studentName + '</div><div><b>Class:</b> ' + (item.className || "-") + '</div><div><b>Monthly:</b> ' + rs(item.monthly) + '</div><div><b>Paid:</b> ' + rs(item.fees) + '</div><div><b>Total:</b> ' + rs(item.total) + '</div></div><div class="seal">Rainbow<br>Seal</div><div class="actions"><button onclick="window.print()">Print PDF</button><button id="receiptWa">WhatsApp Receipt</button></div>'; $("#receiptWa").onclick = () => whatsapp(item.mobile, "Receipt " + item.receiptNo + ": " + item.studentName + " ki fees " + rs(item.total) + " receive ho gayi. - Rainbow The Learner Zone"); }
function showModal(title, html) { $("#modalBody").innerHTML = "<h2>" + title + "</h2>" + html; $("#modal").classList.add("show"); }
function profileHtml(student) { const due = nextDueDate(student); const history = db.fees.filter((fee) => normalize(fee.studentName) === normalize(student.name)); return '<div class="profile-grid"><div><b>Admission ID:</b> ' + student.admissionId + '</div><div><b>Name:</b> ' + student.name + '</div><div><b>Class:</b> ' + student.className + '</div><div><b>Mobile:</b> ' + student.mobile + '</div><div><b>Admission Date:</b> ' + student.date + '</div><div><b>Monthly Fees:</b> ' + rs(student.fees) + '</div><div><b>Next Due:</b> <span class="badge">' + fmt(due) + '</span></div><div><b>Status:</b> ' + (feesForStudentMonth(student, due) ? "Paid" : "Pending") + '</div></div><h2 style="margin-top:18px">Fee History</h2>' + (history.length ? history.map((fee) => '<div class="item"><div><b>' + fee.receiptNo + '</b><br><small>' + fee.date + ' | ' + rs(fee.total) + '</small></div></div>').join("") : '<div class="empty">No receipt found.</div>'); }
function renderList(target, rows, empty) { $(target).innerHTML = rows.length ? rows.join("") : '<tr><td colspan="9" class="empty">' + (empty || "No records found.") + '</td></tr>'; }
function renderCards(target, rows, empty) { $(target).innerHTML = rows.length ? rows.join("") : '<div class="empty">' + (empty || "No records found.") + '</div>'; }
function renderDashboard() { const todayCollection = db.fees.filter((fee) => fee.date === today()).reduce((sum, fee) => sum + Number(fee.total || 0), 0); const pending = pendingFeeStudents(); const attendance = db.attendance.filter((item) => item.date === today() && item.status === "Present").length; $("#todayCollection").textContent = rs(todayCollection); $("#totalStudents").textContent = db.students.length; $("#pendingFees").textContent = rs(pending.reduce((sum, student) => sum + Number(student.fees || 0), 0)); $("#todayAttendance").textContent = attendance; const dueToday = db.students.filter(isDueToday); renderCards("#dueTodayList", dueToday.map((s, i) => '<div class="item"><div><b>' + s.name + '</b><br><small>' + s.className + ' | Due ' + fmt(nextDueDate(s)) + ' | ' + rs(s.fees) + '</small></div><button data-due-today="' + i + '">WhatsApp</button></div>'), "Aaj koi fee reminder nahi hai."); $$('[data-due-today]').forEach((button) => button.onclick = () => whatsapp(dueToday[button.dataset.dueToday].mobile, reminderText(dueToday[button.dataset.dueToday]))); const upcoming = db.students.filter(isUpcomingDue).sort((a, b) => fmt(nextDueDate(a)).localeCompare(fmt(nextDueDate(b)))); renderCards("#upcomingDueList", upcoming.map((s) => '<div class="item"><div><b>' + s.name + '</b><br><small>' + s.className + ' | ' + fmt(nextDueDate(s)) + ' | ' + rs(s.fees) + '</small></div><span class="badge">Upcoming</span></div>'), "Next 7 days me koi due nahi hai."); renderCards("#recentAdmissions", db.admissions.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((a) => '<div class="item"><div><b>' + a.studentName + '</b><br><small>' + a.admissionId + ' | ' + a.className + ' | ' + a.date + '</small></div></div>'), "No admission yet."); renderCards("#recentFees", db.fees.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((f) => '<div class="item"><div><b>' + f.studentName + '</b><br><small>' + f.receiptNo + ' | ' + f.date + ' | ' + rs(f.total) + '</small></div></div>'), "No fee collection yet."); }
function renderStudents() { const rows = db.students.filter((s) => matches(s, filters.students, ["admissionId", "name", "mobile", "className"])).map((s) => '<tr><td>' + s.admissionId + '</td><td>' + s.name + '</td><td>' + rs(s.fees) + '</td><td>' + s.date + '</td><td>' + fmt(nextDueDate(s)) + '</td><td>' + s.className + '</td><td>' + s.mobile + '</td><td><button class="ghost" data-view-student="' + s.id + '">View</button><button class="yellow" data-edit-student="' + s.id + '">Edit</button><button class="red" data-delete-student="' + s.id + '">Delete</button><button class="blue" data-reminder-student="' + s.id + '">WhatsApp</button></td></tr>'); renderList("#studentsTable", rows); $$('[data-view-student]').forEach((b) => b.onclick = () => { const s = db.students.find((x) => x.id === b.dataset.viewStudent); showModal("Student Profile", profileHtml(s)); }); $$('[data-edit-student]').forEach((b) => b.onclick = () => editStudent(b.dataset.editStudent)); $$('[data-delete-student]').forEach((b) => b.onclick = () => deleteStudent(b.dataset.deleteStudent)); $$('[data-reminder-student]').forEach((b) => b.onclick = () => { const s = db.students.find((x) => x.id === b.dataset.reminderStudent); whatsapp(s.mobile, reminderText(s)); }); }
function renderAdmissions() { const rows = db.admissions.filter((a) => matches(a, filters.admission, ["admissionId", "studentName", "mobile", "className"])).map((a) => '<tr><td>' + a.date + '</td><td>' + a.admissionId + '</td><td>' + a.studentName + '</td><td>' + a.className + '</td><td>' + a.mobile + '</td><td><button class="ghost" data-view-admission="' + a.id + '">View</button><button class="yellow" data-edit-admission="' + a.id + '">Edit</button><button class="blue" data-print-admission="' + a.id + '">Print</button><button class="red" data-delete-admission="' + a.id + '">Delete</button></td></tr>'); renderList("#admissionTable", rows); $$('[data-view-admission]').forEach((b) => b.onclick = () => showAdmissionDoc(db.admissions.find((x) => x.id === b.dataset.viewAdmission))); $$('[data-print-admission]').forEach((b) => b.onclick = () => { showAdmissionDoc(db.admissions.find((x) => x.id === b.dataset.printAdmission)); window.print(); }); $$('[data-edit-admission]').forEach((b) => b.onclick = () => editAdmission(b.dataset.editAdmission)); $$('[data-delete-admission]').forEach((b) => b.onclick = () => deleteAdmission(b.dataset.deleteAdmission)); }
function renderFees() { const rows = db.fees.filter((f) => matches(f, filters.fees, ["receiptNo", "studentName", "mobile", "className"])).map((f) => '<tr><td>' + f.receiptNo + '</td><td>' + f.date + '</td><td>' + f.studentName + '</td><td>' + (f.className || "-") + '</td><td>' + rs(f.monthly) + '</td><td>' + rs(f.fees) + '</td><td>' + rs(f.total) + '</td><td><button class="ghost" data-view-fee="' + f.id + '">View</button><button class="yellow" data-edit-fee="' + f.id + '">Edit</button><button class="blue" data-print-fee="' + f.id + '">Print</button><button class="red" data-delete-fee="' + f.id + '">Delete</button></td></tr>'); renderList("#feesTable", rows); $$('[data-view-fee]').forEach((b) => b.onclick = () => showReceiptDoc(db.fees.find((x) => x.id === b.dataset.viewFee))); $$('[data-print-fee]').forEach((b) => b.onclick = () => { showReceiptDoc(db.fees.find((x) => x.id === b.dataset.printFee)); window.print(); }); $$('[data-edit-fee]').forEach((b) => b.onclick = () => editFee(b.dataset.editFee)); $$('[data-delete-fee]').forEach((b) => b.onclick = () => deleteFee(b.dataset.deleteFee)); }
function renderAttendance() { const students = db.students.filter((s) => matches(s, filters.attendance, ["admissionId", "name", "mobile", "className"])); $("#attendanceList").innerHTML = students.length ? students.map((s) => '<div class="attrow"><div><b>' + s.name + '</b><br><small>' + s.admissionId + ' | ' + s.className + ' | ' + s.mobile + '</small></div><div><button class="green" data-present="' + s.id + '">Present</button><button class="red" data-absent="' + s.id + '">Absent</button></div></div>').join("") : '<div class="empty">Student record nahi mila.</div>'; $$('[data-present]').forEach((b) => b.onclick = () => markAttendance(b.dataset.present, "Present")); $$('[data-absent]').forEach((b) => b.onclick = () => markAttendance(b.dataset.absent, "Absent")); const rows = db.attendance.slice().reverse().map((a) => '<tr><td>' + a.date + '</td><td>' + a.student + '</td><td>' + a.className + '</td><td>' + a.status + '</td><td><button class="yellow" data-edit-att="' + a.id + '">Edit</button><button class="red" data-delete-att="' + a.id + '">Delete</button></td></tr>'); renderList("#attendanceTable", rows); $$('[data-edit-att]').forEach((b) => b.onclick = () => editAttendance(b.dataset.editAtt)); $$('[data-delete-att]').forEach((b) => b.onclick = () => deleteAttendance(b.dataset.deleteAtt)); }
function renderReports() { const q = filters.reports; const students = db.students.filter((s) => matches(s, q, ["admissionId", "name", "mobile", "className"])); const total = db.fees.filter((f) => matches(f, q, ["studentName", "mobile", "className"])).reduce((sum, f) => sum + Number(f.total || 0), 0); const pending = students.filter((s) => { const due = nextDueDate(s); return due && fmt(due) <= today() && !feesForStudentMonth(s, due); }); $("#studentReport").textContent = students.length + " students matched. Total students: " + db.students.length + "."; $("#feesReport").textContent = "Monthly fee collection: " + rs(total) + ". Receipts: " + db.fees.length + "."; $("#attendanceReport").textContent = db.attendance.filter((a) => a.status === "Present").length + " present and " + db.attendance.filter((a) => a.status === "Absent").length + " absent entries."; $("#monthlyReport").textContent = pending.length + " pending students. Pending amount: " + rs(pending.reduce((sum, s) => sum + Number(s.fees || 0), 0)) + "."; }
function render() { renderDashboard(); renderStudents(); renderAdmissions(); renderFees(); renderAttendance(); renderReports(); }
function editStudent(id) { const s = db.students.find((x) => x.id === id); const form = $("#studentForm"); Object.keys(s).forEach((key) => { if (form.elements[key]) form.elements[key].value = s[key]; }); $("#studentSubmit").textContent = "Update Student"; form.scrollIntoView({ behavior: "smooth", block: "center" }); }
function deleteStudent(id) { if (!confirm("Student delete karna hai?")) return; db.students = db.students.filter((x) => x.id !== id); deleteSupabase("students", id); save(); }
function editAdmission(id) { const a = db.admissions.find((x) => x.id === id); const form = $("#admissionForm"); Object.keys(a).forEach((key) => { if (form.elements[key]) form.elements[key].value = a[key]; }); $("#admissionSubmit").textContent = "Update Admission"; form.scrollIntoView({ behavior: "smooth", block: "center" }); }
function deleteAdmission(id) { if (!confirm("Admission delete karna hai?")) return; db.admissions = db.admissions.filter((x) => x.id !== id); deleteSupabase("admissions", id); save(); }
function editFee(id) { const f = db.fees.find((x) => x.id === id); const form = $("#feesForm"); Object.keys(f).forEach((key) => { if (form.elements[key]) form.elements[key].value = f[key]; }); $("#feesSubmit").textContent = "Update Receipt"; form.scrollIntoView({ behavior: "smooth", block: "center" }); }
function deleteFee(id) { if (!confirm("Receipt delete karna hai?")) return; const oldFee = db.fees.find((x) => x.id === id); db.fees = db.fees.filter((x) => x.id !== id); deleteSupabase("fees", id); if (oldFee) refreshStudentFeeTotals(oldFee.studentName); save(); }
function editAttendance(id) { const a = db.attendance.find((x) => x.id === id); if (!a) return; a.status = a.status === "Present" ? "Absent" : "Present"; save(); toast("Attendance updated"); }
function deleteAttendance(id) { if (!confirm("Attendance delete karna hai?")) return; db.attendance = db.attendance.filter((x) => x.id !== id); deleteSupabase("attendance", id); save(); }
function markAttendance(studentId, status) { const s = db.students.find((x) => x.id === studentId); const date = $("#attendanceDate").value || today(); db.attendance = db.attendance.filter((a) => !(a.date === date && a.studentId === studentId)); const entry = { id: uid(), studentId, date, student: s.name, className: s.className, status }; db.attendance.push(entry); upsertSupabase("attendance", entry); save(); toast(s.name + ": " + status); }
function csv(name, rows) { const data = rows.map((row) => row.map((cell) => '"' + String(cell ?? "").replaceAll('"', '""') + '"').join(",")).join("\n"); const blob = new Blob([data], { type: "text/csv;charset=utf-8" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = name; link.click(); URL.revokeObjectURL(link.href); }
function fillFeeFromStudentName() { const form = $("#feesForm"); const s = studentByName(form.elements.studentName.value); if (!s) return; form.elements.className.value = s.className; form.elements.mobile.value = s.mobile; form.elements.monthly.value = s.fees; if (!form.elements.fees.value) form.elements.fees.value = s.fees; if (!form.elements.total.value) form.elements.total.value = s.fees; }
$$('[data-view], [data-go]').forEach((button) => { button.onclick = () => { const id = button.dataset.view || button.dataset.go; $$('.view').forEach((view) => view.classList.toggle('active', view.id === id)); $$('.nav button').forEach((nav) => nav.classList.toggle('active', nav.dataset.view === id)); $('#title').textContent = button.textContent; render(); }; });
$$('[data-search]').forEach((input) => { input.oninput = () => { filters[input.dataset.search] = input.value; render(); }; });
$('#modalClose').onclick = () => $('#modal').classList.remove('show');
$('#loginForm').onsubmit = doLogin; $('#logoutBtn').onclick = doLogout;
$('#studentForm').onsubmit = (event) => { event.preventDefault(); const item = dataFrom(event.target); if (item.id) { db.students = db.students.map((s) => s.id === item.id ? item : s); toast('Student updated'); upsertSupabase('students', item); } else { item.id = uid(); db.students.push(item); saveToSheet('student', item); upsertSupabase('students', item); toast('Student saved'); } resetForm('#studentForm', '#studentSubmit', 'Save Student'); save(); };
$('#admissionForm').onsubmit = (event) => { event.preventDefault(); const item = dataFrom(event.target); if (item.id) { db.admissions = db.admissions.map((a) => a.id === item.id ? item : a); toast('Admission updated'); upsertSupabase('admissions', item); } else { item.id = uid(); db.admissions.push(item); saveToSheet('admission', item); upsertSupabase('admissions', item); const existing = db.students.find((s) => s.admissionId === item.admissionId); if (!existing) { item.studentId = item.id; const newStudent = { id: item.id, admissionId: item.admissionId, name: item.studentName, fees: '', date: item.date, className: item.className, mobile: item.mobile, message: '' }; db.students.push(newStudent); upsertSupabase('students', newStudent); } toast('Admission saved'); } showAdmissionDoc(item); resetForm('#admissionForm', '#admissionSubmit', 'Submit Admission'); save(); };
$('#feesForm').onsubmit = (event) => { event.preventDefault(); const item = { ...dataFrom(event.target), pdfLink: 'Generated in ERP' }; if (item.id) { db.fees = db.fees.map((f) => f.id === item.id ? item : f); toast('Receipt updated'); upsertSupabase('fees', item); } else { item.id = uid(); db.fees.push(item); saveToSheet('fees', item); upsertSupabase('fees', item); toast('Receipt saved. Current month reminder band ho gaya.'); } refreshStudentFeeTotals(item.studentName); showReceiptDoc(item); resetForm('#feesForm', '#feesSubmit', 'Submit Receipt'); save(); };
$('#feesForm [name="studentName"]').onblur = fillFeeFromStudentName;
$('#nextAdmission').onclick = () => $('#admissionForm [name=admissionId]').value = nextAdmissionId();
$('#nextReceipt').onclick = () => $('#feesForm [name=receiptNo]').value = nextReceiptNo();
$('#attendanceDate').onchange = render;
$('#sample').onclick = () => { db.students.push({ id: uid(), admissionId: '0001', name: 'Sagar Sharma', fees: '1200', date: '2026-06-10', className: '4th', mobile: '9999999999', message: '' }, { id: uid(), admissionId: '0002', name: 'Anaya Verma', fees: '1500', date: '2026-06-15', className: '5th', mobile: '9999999999', message: '' }, { id: uid(), admissionId: '0003', name: 'Aarav Jain', fees: '1000', date: '2026-06-28', className: '3rd', mobile: '9999999999', message: '' }); save(); toast('Sample students added'); };
$('#sendDue').onclick = () => { const s = db.students.find(isDueToday); s ? whatsapp(s.mobile, reminderText(s)) : toast('Aaj koi due reminder nahi hai'); };
$('#studentsCsv').onclick = () => csv('student-details.csv', [['Admission ID','Student Name','Fees','Admission Date','Next Due','Class','Mobile No.','Alert Message'], ...db.students.map((s) => [s.admissionId, s.name, s.fees, s.date, fmt(nextDueDate(s)), s.className, s.mobile, reminderText(s)])]);
$('#feesCsv').onclick = () => csv('fees-receipt.csv', [['Receipt No.','Date','Student Name','Class','Monthly','Fees','Total Fees','PDF Link'], ...db.fees.map((f) => [f.receiptNo, f.date, f.studentName, f.className, f.monthly, f.fees, f.total, f.pdfLink])]);
$('#attendanceCsv').onclick = () => csv('attendance.csv', [['Date','Student','Class','Status'], ...db.attendance.map((a) => [a.date, a.student, a.className, a.status])]);
$('#backup').onclick = () => csv('rainbow-erp-backup.csv', [['Type','Data'], ['Backup', JSON.stringify(db)]]);
$('#saveSettings').onclick = () => { db.settings = { ...db.settings, ...dataFrom($('#settingsForm')) }; saveSettingsSupabase(); save(); toast('Settings saved'); };
applyAuth(); setDefaults(); render(); loadSupabaseData();