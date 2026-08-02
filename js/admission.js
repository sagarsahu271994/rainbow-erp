/**
 * App.Admission — Rainbow ERP Admission workflow module.
 *
 * SCHEMA NOTE (read first): the actual `admissions` table only has
 * (id, student_id, admission_date, remarks, created_at, pdf_url, pdf_path,
 * shared_at). There are NO columns for status, photo, or generic document
 * URLs. Everything else shown on an admission (student name, father/mother
 * name, mobile, class, batch, address, monthly fees) is not stored on the
 * admission row at all — it's read live from the linked student record.
 * So:
 *   - Status (Pending/Approved/Rejected/Cancelled) is tracked in-memory and
 *     the module ALSO attempts a best-effort Supabase update to a "status"
 *     column — if that column doesn't exist yet, the write fails silently
 *     (logged, not thrown) and the status stays local-only until reload.
 *     Add a `status text default 'Pending'` column to persist it for real.
 *   - Student Photo / Documents Upload reuse the existing App.Storage
 *     module to actually upload the file (no Storage logic duplicated
 *     here), but the resulting URL is only saved locally + a best-effort
 *     "photo_url"/"document_url" column write — same caveat as above.
 * None of this required touching the schema, index.html, or any other
 * module — everything above is a defensive, non-breaking attempt.
 */
App.Admission = {

  CONFIG: {
    STATUSES: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
    PAGE_SIZE: 50,
    DRAFT_KEY: 'rainbowERPAdmissionDraft',
    DRAFT_DEBOUNCE_MS: 600
  },

  _page: 1,
  _filterStatus: 'all',
  _filterClass: 'all',

  /* ============================================================
     EXISTING BEHAVIOR — kept exactly as before.
     ============================================================ */
  nextId() {
    const all = App.db.admissions.map(a => a.admissionId).concat(App.db.students.map(s => s.admissionId));
    return String(all.reduce((m, id) => Math.max(m, Number(id) || 0), 0) + 1).padStart(4, '0');
  },

  // Keeps students.total_fees / paid_fees / pending_fees / status aligned with
  // the Admission's Monthly Fees value. Reuses the existing App.refreshStudentFeeTotals
  // helper (already used by Fees/Students) instead of duplicating the calculation.
  // Safe to call repeatedly: it only writes when something actually changed.
  syncStudentFees(a) {
    if (!a || a.monthlyFees === undefined || a.monthlyFees === null || a.monthlyFees === '') return;
    const student = App.studentById(a.studentId) || App.studentByName(a.studentName);
    if (!student) return;
    const monthlyFee = App.num(a.monthlyFees);
    const isNewStudent = student.paidFees === undefined || student.paidFees === null;
    if (App.num(student.fees) === monthlyFee && !isNewStudent) return;
    student.fees = monthlyFee;
    if (isNewStudent) {
      student.paidFees = App.num(student.paidFees) || 0;
      student.status = student.status || 'Active';
    }
    if (App.refreshStudentFeeTotals) App.refreshStudentFeeTotals(student.id || student.name);
    else student.pendingFees = Math.max(monthlyFee - App.num(student.paidFees), 0);
  },

  /* ============================================================
     VALIDATION (Feature 18) + DUPLICATE PREVENTION (Feature 19)
     ============================================================ */
  validate(data) {
    const errors = [];
    if (!data.studentName || !data.studentName.trim()) errors.push('Student name is required.');
    if (!data.admissionId) errors.push('Admission ID is required.');
    if (!data.className) errors.push('Class is required.');
    if (!data.mobile || !/^\d{10}$/.test(String(data.mobile).replace(/\D/g, ''))) errors.push('A valid 10-digit mobile number is required.');
    if (!data.date || !App.parseDate(data.date)) errors.push('A valid admission date is required.');
    else if (data.date > App.today()) errors.push('Admission date cannot be in the future.');
    if (data.monthlyFees !== undefined && data.monthlyFees !== '' && App.num(data.monthlyFees) < 0) errors.push('Monthly fees cannot be negative.');
    return errors;
  },

  /**
   * Blocks obvious duplicates: same Admission ID already used, or the same
   * student name + mobile + admission date submitted twice. excludeId lets
   * an edit-in-progress ignore its own existing record.
   */
  isDuplicate(data, excludeId) {
    return App.db.admissions.some(a => {
      if (excludeId && a.id === excludeId) return false;
      const sameAdmissionId = App.norm(a.admissionId) === App.norm(data.admissionId);
      const sameTriplet = App.norm(a.studentName) === App.norm(data.studentName)
        && App.norm(a.mobile) === App.norm(data.mobile)
        && a.date === data.date;
      return sameAdmissionId || sameTriplet;
    });
  },

  /* ============================================================
     AUDIT LOG (Feature 17) — best-effort, same pattern App.Fees uses.
     Logs to console always; also tries an "audit_log" Supabase table if
     one exists, silently skipping if it doesn't (no schema assumed).
     ============================================================ */
  async _auditLog(action, details) {
    console.info('[AUDIT]', action, details);
    const c = App.Supabase.get();
    if (!c) return;
    try {
      await c.from('audit_log').insert({ action, details: JSON.stringify(details), created_at: new Date().toISOString() });
    } catch (e) { /* audit_log table likely doesn't exist yet — safe to ignore */ }
  },

  /* ============================================================
     STATUS (Feature 6) — see schema note at the top of this file.
     ============================================================ */
  async setStatus(id, status) {
    if (!this.CONFIG.STATUSES.includes(status)) return App.toast('Invalid status.');
    const a = App.db.admissions.find(x => x.id === id);
    if (!a) return App.toast('Admission not found.');
    const previous = a.status || 'Pending';
    a.status = status;
    App.saveLocal();
    this.render();

    const c = App.Supabase.get();
    if (c && App.Supabase.isNum(a.id)) {
      try {
        const r = await c.from('admissions').update({ status }).eq('id', a.id);
        if (r.error) throw r.error;
      } catch (e) {
        console.warn('setStatus: "status" column likely missing on admissions table — kept local-only.', e);
      }
    }

    this._auditLog('admission_status_changed', { id, admissionId: a.admissionId, from: previous, to: status });

    if (status === 'Approved') await this.convertToStudent(id);

    if (App.Dashboard && App.Dashboard.render) App.Dashboard.render();
    if (App.Students && App.Students.render) App.Students.render();
  },

  /* ============================================================
     CONVERT ADMISSION TO STUDENT (Feature 8)
     In this architecture a linked student row is already created at
     admission time (see app.js), so "convert" here means: ensure that
     student is marked Active and fully synced — the meaningful action
     once an admission moves to Approved status.
     ============================================================ */
  async convertToStudent(admissionId) {
    const a = App.db.admissions.find(x => x.id === admissionId);
    if (!a) return App.toast('Admission not found.');
    let s = App.studentById(a.studentId) || App.studentByName(a.studentName);
    if (!s) {
      s = { id: App.uid(), admissionId: a.admissionId, name: a.studentName, fatherName: a.fatherName, motherName: a.motherName, date: a.date, className: a.className, batch: a.batch, mobile: a.mobile, address: a.address, fees: App.num(a.monthlyFees) };
      App.db.students.push(s);
    }
    s.status = 'Active';
    await App.Supabase.upsert('students', s);
    this._auditLog('admission_converted_to_student', { admissionId: a.admissionId, studentId: s.id });
    App.save();
    App.toast(a.studentName + ' is now an active student.');
  },

  /* ============================================================
     PHOTO / DOCUMENT UPLOAD (Features 13 / 14) — reuses App.Storage,
     never reimplements upload logic. See schema note at top of file.
     ============================================================ */
  _pickFile(accept) {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      input.style.display = 'none';
      input.onchange = () => { resolve(input.files && input.files[0] ? input.files[0] : null); input.remove(); };
      document.body.appendChild(input);
      input.click();
    });
  },

  async uploadPhoto(admissionId) {
    const a = App.db.admissions.find(x => x.id === admissionId);
    if (!a) return App.toast('Admission not found.');
    const file = await this._pickFile('image/*');
    if (!file) return;
    App.toast('Uploading photo...');
    try {
      const url = await App.Storage.upload('admission', { id: a.id, admissionId: a.admissionId }, file, 'photo-' + App.fileName(a.studentName) + '.' + (file.name.split('.').pop() || 'jpg'));
      if (!url) return App.toast('Photo upload failed.');
      a.photoUrl = url;
      const c = App.Supabase.get();
      if (c && App.Supabase.isNum(a.id)) {
        try { await c.from('admissions').update({ photo_url: url }).eq('id', a.id); }
        catch (e) { console.warn('uploadPhoto: "photo_url" column likely missing — kept local-only.', e); }
      }
      this._auditLog('admission_photo_uploaded', { admissionId: a.admissionId });
      App.save();
      App.toast('Photo uploaded.');
    } catch (e) {
      console.warn('uploadPhoto failed', e);
      App.toast('Photo upload issue. Storage bucket/policy check karein.');
    }
  },

  async uploadDocument(admissionId) {
    const a = App.db.admissions.find(x => x.id === admissionId);
    if (!a) return App.toast('Admission not found.');
    const file = await this._pickFile();
    if (!file) return;
    App.toast('Uploading document...');
    try {
      const url = await App.Storage.upload('admission', { id: a.id, admissionId: a.admissionId }, file, 'doc-' + App.fileName(file.name));
      if (!url) return App.toast('Document upload failed.');
      a.documentUrl = url;
      const c = App.Supabase.get();
      if (c && App.Supabase.isNum(a.id)) {
        try { await c.from('admissions').update({ document_url: url }).eq('id', a.id); }
        catch (e) { console.warn('uploadDocument: "document_url" column likely missing — kept local-only.', e); }
      }
      this._auditLog('admission_document_uploaded', { admissionId: a.admissionId, fileName: file.name });
      App.save();
      App.toast('Document uploaded.');
    } catch (e) {
      console.warn('uploadDocument failed', e);
      App.toast('Document upload issue. Storage bucket/policy check karein.');
    }
  },

  /* ============================================================
     AUTO-SAVE DRAFT (Feature 20) — pure client-side, #admissionForm only.
     ============================================================ */
  bindDraftAutosave() {
    const form = App.$('#admissionForm');
    if (!form || form._draftBound) return;
    form._draftBound = true;
    const save = App._debounce ? App._debounce(() => this._saveDraft(), this.CONFIG.DRAFT_DEBOUNCE_MS) : () => this._saveDraft();
    form.addEventListener('input', save);
  },

  _saveDraft() {
    const form = App.$('#admissionForm');
    if (!form) return;
    const data = App.formData(form);
    if (!data.studentName && !data.admissionId) return; // nothing worth saving
    try { localStorage.setItem(this.CONFIG.DRAFT_KEY, JSON.stringify(data)); } catch (e) { /* quota — ignore */ }
  },

  restoreDraftIfAny() {
    let draft;
    try { draft = App.safeParse(localStorage.getItem(this.CONFIG.DRAFT_KEY) || '', null); } catch (e) { draft = null; }
    if (!draft) return;
    const form = App.$('#admissionForm');
    if (!form) return;
    Object.keys(draft).forEach(k => { if (form.elements[k] && draft[k]) form.elements[k].value = draft[k]; });
    App.toast('Draft restored from your last unsaved admission.');
  },

  clearDraft() {
    try { localStorage.removeItem(this.CONFIG.DRAFT_KEY); } catch (e) { /* ignore */ }
  },

  /* ============================================================
     FILTERS + PAGINATION (Features 5, 10 performance)
     ============================================================ */
  _applyFilters(list) {
    const searchFiltered = list.filter(a => App.matches(a, App.filters.admission, ['admissionId', 'studentName', 'mobile', 'className']));
    return searchFiltered.filter(a => {
      const status = a.status || 'Pending';
      const matchesStatus = this._filterStatus === 'all' || App.norm(status) === App.norm(this._filterStatus);
      const matchesClass = this._filterClass === 'all' || App.norm(a.className) === App.norm(this._filterClass);
      return matchesStatus && matchesClass;
    });
  },

  _classOptions(list) {
    const classes = [...new Set(list.map(a => a.className).filter(Boolean))].sort();
    return '<option value="all">All Classes</option>' + classes.map(c => '<option value="' + App.esc(c) + '"' + (c === this._filterClass ? ' selected' : '') + '>' + App.esc(c) + '</option>').join('');
  },

  _statusOptions() {
    return '<option value="all">All Status</option>' + this.CONFIG.STATUSES.map(s => '<option value="' + s + '"' + (s === this._filterStatus ? ' selected' : '') + '>' + s + '</option>').join('');
  },

  /** Injects (once) / refreshes a filter + pagination toolbar right above the admission table — no index.html edits. */
  _renderToolbar(filteredCount) {
    const table = App.$('#admissionTable');
    const wrap = table && table.closest ? table.closest('.tablewrap') : null;
    if (!wrap) return;
    let bar = App.$('#admissionToolbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'admissionToolbar';
      bar.className = 'admission-toolbar';
      bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;';
      wrap.insertAdjacentElement('beforebegin', bar);
    }
    const totalPages = Math.max(1, Math.ceil(filteredCount / this.CONFIG.PAGE_SIZE));
    if (this._page > totalPages) this._page = totalPages;
    bar.innerHTML = '<select id="admissionStatusFilter">' + this._statusOptions() + '</select>'
      + '<select id="admissionClassFilter">' + this._classOptions(App.db.admissions) + '</select>'
      + '<span class="muted" style="margin-left:auto;">' + filteredCount + ' admission(s) — Page ' + this._page + ' / ' + totalPages + '</span>'
      + '<button id="admissionPrevPage" type="button" class="ghost">Prev</button>'
      + '<button id="admissionNextPage" type="button" class="ghost">Next</button>';
    App.$('#admissionStatusFilter').onchange = e => { this._filterStatus = e.target.value; this._page = 1; this.render(); };
    App.$('#admissionClassFilter').onchange = e => { this._filterClass = e.target.value; this._page = 1; this.render(); };
    App.$('#admissionPrevPage').onclick = () => { if (this._page > 1) { this._page--; this.render(); } };
    App.$('#admissionNextPage').onclick = () => { if (this._page < totalPages) { this._page++; this.render(); } };
  },

  /** FEATURE 10 — only slices/renders one page of rows into the DOM at a time. */
  _paginate(list) {
    const start = (this._page - 1) * this.CONFIG.PAGE_SIZE;
    return list.slice(start, start + this.CONFIG.PAGE_SIZE);
  },

  _statusBadgeClass(status) {
    return { Approved: 'paid', Rejected: 'overdue', Cancelled: 'overdue', Pending: 'pending' }[status] || 'pending';
  },

  _rowHtml(a) {
    const status = a.status || 'Pending';
    const id = App.esc(a.id);
    return '<tr>'
      + '<td>' + App.esc(a.date) + '</td>'
      + '<td>' + App.esc(a.admissionId) + '</td>'
      + '<td>' + App.esc(a.studentName) + '</td>'
      + '<td>' + App.esc(a.className) + '</td>'
      + '<td>' + App.esc(a.mobile) + '</td>'
      + '<td><span class="status-badge ' + this._statusBadgeClass(status) + '">' + App.esc(status) + '</span></td>'
      + '<td>' + (a.pdfUrl ? '<a target="_blank" href="' + App.esc(a.pdfUrl) + '">Open</a>' : '-') + '</td>'
      + '<td class="admission-row-actions" style="display:flex;gap:4px;flex-wrap:wrap;">'
      + '<button data-view-ad="' + id + '">View</button>'
      + '<button class="yellow" data-edit-ad="' + id + '">Edit</button>'
      + '<button class="red" data-del-ad="' + id + '">Delete</button>'
      + (status !== 'Approved' ? '<button class="green" data-approve-ad="' + id + '">Approve</button>' : '')
      + (status !== 'Rejected' ? '<button class="ghost" data-reject-ad="' + id + '">Reject</button>' : '')
      + '<button class="ghost" data-photo-ad="' + id + '">Photo</button>'
      + '<button class="ghost" data-doc-ad="' + id + '">Document</button>'
      + '</td></tr>';
  },

  _wireRowActions() {
    App.$$('[data-view-ad]').forEach(b => b.onclick = () => App.Pdf.showAdmission(App.db.admissions.find(x => x.id === b.dataset.viewAd)));
    App.$$('[data-edit-ad]').forEach(b => b.onclick = () => this.edit(b.dataset.editAd));
    App.$$('[data-del-ad]').forEach(b => b.onclick = () => this.remove(b.dataset.delAd));
    App.$$('[data-approve-ad]').forEach(b => b.onclick = () => this.setStatus(b.dataset.approveAd, 'Approved'));
    App.$$('[data-reject-ad]').forEach(b => b.onclick = () => this.setStatus(b.dataset.rejectAd, 'Rejected'));
    App.$$('[data-photo-ad]').forEach(b => b.onclick = () => this.uploadPhoto(b.dataset.photoAd));
    App.$$('[data-doc-ad]').forEach(b => b.onclick = () => this.uploadDocument(b.dataset.docAd));
  },

  /* ============================================================
     RENDER — Search (existing App.filters.admission) + Status/Class
     filters + pagination, all reusing the same #admissionTable.
     ============================================================ */
  render() {
    App.db.admissions.forEach(a => this.syncStudentFees(a));
    const filtered = this._applyFilters(App.db.admissions);
    this._renderToolbar(filtered.length);
    const pageRows = this._paginate(filtered);
    App.renderList('#admissionTable', pageRows.map(a => this._rowHtml(a)));
    this._wireRowActions();
    this.bindDraftAutosave();
  },

  edit(id) {
    const a = App.db.admissions.find(x => x.id === id), f = App.$('#admissionForm');
    Object.keys(a).forEach(k => { if (f.elements[k]) f.elements[k].value = a[k]; });
    App.$('#admissionSubmit').textContent = 'Update Admission';
  },

  async remove(id) {
    if (!confirm('Admission delete karna hai?')) return;
    const a = App.db.admissions.find(x => x.id === id);
    App.db.admissions = App.db.admissions.filter(x => x.id !== id);
    await App.Supabase.delete('admissions', a);
    if (a) this._auditLog('admission_deleted', { id, admissionId: a.admissionId, studentName: a.studentName });
    App.save();
  }

};

App.Admission.restoreDraftIfAny();
