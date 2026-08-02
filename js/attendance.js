/**
 * App.Attendance — Rainbow ERP Attendance module ONLY.
 *
 * Uses App.Supabase for every DB call (never creates its own Supabase
 * client), reads/writes App.db.attendance as the local cache, and always
 * finishes a mutation with App.save() (persists + re-renders every module,
 * same pattern every other module already uses).
 *
 * DASHBOARD REFRESH NOTE: this emits 'dashboard:refresh' via App.emit() as
 * required, but app.js's event bus doesn't currently have a listener bound
 * for that event (only fee/student/admission events are wired there, and
 * this file isn't allowed to touch app.js to add one). So, as a safety net,
 * this module ALSO calls App.Dashboard.render() directly when available —
 * that's calling an existing module's own render function, not duplicating
 * any dashboard calculation logic.
 *
 * CSV NOTE: app.js currently wires #attendanceCsv to a simple inline
 * App.csv(...) call. This module's render() re-wires that same button to
 * call App.Attendance.exportCsv() instead (richer export: respects current
 * filters, includes remarks/time in/out) — this only reassigns the
 * button's onclick at runtime, the same way every other module here wires
 * its own buttons; the app.js file itself is untouched.
 */
App.Attendance = {

  CONFIG: {
    STATUSES: ['Present', 'Absent', 'Leave', 'Holiday'],
    PAGE_SIZE: 50,
    OFFLINE_QUEUE_NAME: 'attendance',
    REMARKS_DEBOUNCE_MS: 500
  },

  _page: 1,
  _filterClass: 'all',
  _filterDate: '',

  /* ============================================================
     SANITIZATION — dynamic text values only, never raw innerHTML.
     ============================================================ */
  _sanitize(str, maxLen) {
    return String(str || '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen || 300);
  },

  /* ============================================================
     VALIDATION
     ============================================================ */
  validate(data) {
    const errors = [];
    if (!data.studentId) errors.push('Student is required.');
    if (!data.date || !App.parseDate(data.date)) errors.push('A valid attendance date is required.');
    if (!data.status || !this.CONFIG.STATUSES.includes(data.status)) errors.push('Status must be one of: ' + this.CONFIG.STATUSES.join(', ') + '.');
    return errors;
  },

  /* ============================================================
     OFFLINE QUEUE — built on App.LocalCache's generic queue primitives
     (storage.js). No retry logic duplicated elsewhere; this module owns
     its own retry behavior for its own queue name only.
     ============================================================ */
  _queueOffline(item) {
    if (App.LocalCache) App.LocalCache.queuePush(this.CONFIG.OFFLINE_QUEUE_NAME, item);
  },

  /** Restore Pending Queue — call on load and whenever the browser comes back online. */
  async restorePendingQueue() {
    if (!App.LocalCache) return;
    const queued = App.LocalCache.queueList(this.CONFIG.OFFLINE_QUEUE_NAME);
    if (!queued.length) return;
    let synced = 0;
    for (let i = queued.length - 1; i >= 0; i--) {
      const item = queued[i];
      try {
        await App.Supabase.upsert('attendance', item);
        App.LocalCache.queueRemoveAt(this.CONFIG.OFFLINE_QUEUE_NAME, i);
        if (!App.db.attendance.some(a => a.id === item.id)) App.db.attendance.unshift(item);
        synced++;
      } catch (e) {
        console.warn('restorePendingQueue: retry failed, keeping in queue', e);
      }
    }
    if (synced > 0) { App.save(); App.toast(synced + ' offline attendance record(s) synced'); }
  },

  _bindOfflineSync() {
    if (this._offlineListenerBound) return;
    this._offlineListenerBound = true;
    window.addEventListener('online', () => this.restorePendingQueue());
  },

  /* ============================================================
     CORE CRUD — always via App.Supabase, always finishes with App.save().
     ============================================================ */

  /**
   * Low-level save/update of one attendance record. Replaces any existing
   * entry for the same student + date (matches the original app's
   * "one status per student per day" behavior) unless updating by id.
   * @param {{id?:string,studentId:string,date:string,status:string,remarks?:string,timeIn?:string,timeOut?:string}} data
   */
  async save(data) {
    const errors = this.validate(data);
    if (errors.length) { App.toast(errors[0]); return null; }
    const s = App.studentById(data.studentId);
    const isNew = !data.id;
    if (!data.id) {
      App.db.attendance = App.db.attendance.filter(a => !(a.studentId === data.studentId && a.date === data.date));
    }
    const item = {
      id: data.id || App.uid(),
      studentId: data.studentId,
      date: data.date,
      student: s ? s.name : (data.student || ''),
      className: s ? s.className : (data.className || ''),
      status: data.status,
      remarks: this._sanitize(data.remarks, 300),
      timeIn: data.timeIn || '',
      timeOut: data.timeOut || ''
    };
    if (data.id) {
      App.db.attendance = App.db.attendance.map(a => a.id === data.id ? { ...a, ...item } : a);
    } else {
      App.db.attendance.push(item);
    }

    if (navigator.onLine === false) {
      this._queueOffline(item);
      App.save();
      App.toast('Offline: attendance queued, connection aane par sync hogi.');
      return item;
    }
    try {
      await App.Supabase.upsert('attendance', item);
    } catch (e) {
      console.warn('Attendance.save: Supabase upsert failed, queueing offline', e);
      this._queueOffline(item);
    }

    App.save();
    App.emit(isNew ? 'attendance:created' : 'attendance:updated', item);
    App.emit('dashboard:refresh', { source: 'attendance' });
    if (App.Dashboard && App.Dashboard.render) App.Dashboard.render();
    return item;
  },

  /** @param {string} id @param {object} changes partial fields to merge */
  async update(id, changes) {
    const existing = App.db.attendance.find(a => a.id === id);
    if (!existing) return App.toast('Attendance record not found.');
    return this.save({ ...existing, ...changes, id });
  },

  /** @param {string} id */
  async delete(id) {
    if (!confirm('Attendance record delete karna hai?')) return;
    const a = App.db.attendance.find(x => x.id === id);
    App.db.attendance = App.db.attendance.filter(x => x.id !== id);
    await App.Supabase.delete('attendance', a);
    App.save();
    if (a) App.emit('attendance:deleted', a);
    App.emit('dashboard:refresh', { source: 'attendance' });
    if (App.Dashboard && App.Dashboard.render) App.Dashboard.render();
  },

  /* ============================================================
     DAILY MARK HELPERS — public API required by spec.
     ============================================================ */
  markPresent(studentId, date) { return this.save({ studentId, date: date || App.$('#attendanceDate')?.value || App.today(), status: 'Present' }); },
  markAbsent(studentId, date) { return this.save({ studentId, date: date || App.$('#attendanceDate')?.value || App.today(), status: 'Absent' }); },
  markLeave(studentId, date) { return this.save({ studentId, date: date || App.$('#attendanceDate')?.value || App.today(), status: 'Leave' }); },
  markHoliday(studentId, date) { return this.save({ studentId, date: date || App.$('#attendanceDate')?.value || App.today(), status: 'Holiday' }); },

  /**
   * Bulk Attendance — marks every currently-filtered student the same
   * status for the selected date in one pass, with a single re-render at
   * the end instead of one per student (avoids duplicate rendering on
   * large class lists).
   * @param {string[]} studentIds
   * @param {string} status
   * @param {string} date
   */
  async markBulk(studentIds, status, date) {
    if (!this.CONFIG.STATUSES.includes(status)) return;
    const d = date || App.$('#attendanceDate')?.value || App.today();
    for (const id of studentIds) {
      const s = App.studentById(id);
      App.db.attendance = App.db.attendance.filter(a => !(a.studentId === id && a.date === d));
      const item = { id: App.uid(), studentId: id, date: d, student: s ? s.name : '', className: s ? s.className : '', status, remarks: '', timeIn: '', timeOut: '' };
      App.db.attendance.push(item);
      if (navigator.onLine === false) this._queueOffline(item);
      else {
        try { await App.Supabase.upsert('attendance', item); }
        catch (e) { console.warn('markBulk: upsert failed for one student, queued offline', e); this._queueOffline(item); }
      }
    }
    App.save();
    App.emit('attendance:created', { bulk: true, count: studentIds.length, status, date: d });
    App.emit('dashboard:refresh', { source: 'attendance' });
    if (App.Dashboard && App.Dashboard.render) App.Dashboard.render();
    App.toast(studentIds.length + ' student(s) marked ' + status);
  },

  /* ============================================================
     SEARCH / FILTERS
     ============================================================ */
  /** @param {string} term programmatic search entry point (per spec's public API) */
  search(term) {
    App.filters.attendance = term || '';
    this._page = 1;
    this.render();
  },

  _applyFilters(list) {
    const searchFiltered = list.filter(a => App.matches(a, App.filters.attendance, ['student', 'className', 'studentId']));
    return searchFiltered.filter(a => {
      const matchesClass = this._filterClass === 'all' || App.norm(a.className) === App.norm(this._filterClass);
      const matchesDate = !this._filterDate || a.date === this._filterDate;
      return matchesClass && matchesDate;
    });
  },

  _classOptions() {
    const classes = [...new Set(App.db.students.map(s => s.className).filter(Boolean))].sort();
    return '<option value="all">All Classes</option>' + classes.map(c => '<option value="' + App.esc(c) + '"' + (c === this._filterClass ? ' selected' : '') + '>' + App.esc(c) + '</option>').join('');
  },

  /* ============================================================
     SUMMARY + HISTORY
     ============================================================ */
  summary(rows) {
    return rows.reduce((acc, a) => {
      acc.total++;
      acc[a.status] = (acc[a.status] || 0) + 1;
      return acc;
    }, { total: 0, Present: 0, Absent: 0, Leave: 0, Holiday: 0 });
  },

  /** @param {string} studentId @returns {object[]} sorted newest-first */
  history(studentId) {
    return App.db.attendance.filter(a => a.studentId === studentId).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },

  showHistory(studentId) {
    const s = App.studentById(studentId);
    if (!s) return App.toast('Student not found.');
    const rows = this.history(studentId);
    const summary = this.summary(rows);
    const body = '<h2>Attendance History</h2><p><b>' + App.esc(s.name) + '</b> — ' + App.esc(s.className || '-') + '</p>'
      + '<p class="muted">Present: ' + summary.Present + ' | Absent: ' + summary.Absent + ' | Leave: ' + summary.Leave + ' | Holiday: ' + summary.Holiday + ' | Total: ' + summary.total + '</p>'
      + '<div class="tablewrap compact"><table><thead><tr><th>Date</th><th>Status</th><th>Remarks</th></tr></thead><tbody>'
      + (rows.length ? rows.map(a => '<tr><td>' + App.esc(a.date) + '</td><td>' + App.esc(a.status) + '</td><td>' + App.esc(a.remarks || '-') + '</td></tr>').join('') : '<tr><td colspan="3" class="empty">No records.</td></tr>')
      + '</tbody></table></div>';
    if (App.ModalManager) App.ModalManager.push(body);
    else { App.$('#modalBody').innerHTML = body; App.$('#modal').classList.add('show'); }
  },

  /* ============================================================
     CSV EXPORT — reuses the existing App.csv() helper, no duplicate
     CSV-building logic anywhere else.
     ============================================================ */
  exportCsv() {
    const rows = this._applyFilters(App.db.attendance);
    App.csv('attendance.csv', [
      ['Date', 'Student', 'Class', 'Status', 'Remarks', 'Time In', 'Time Out'],
      ...rows.map(a => [a.date, a.student, a.className, a.status, a.remarks || '', a.timeIn || '', a.timeOut || ''])
    ]);
  },

  /* ============================================================
     KEYBOARD SHORTCUTS — active only while the Daily Attendance search
     box is focused AND exactly one student matches the current filter
     (unambiguous target), so a stray keypress elsewhere in the app can
     never accidentally mark someone's attendance.
       P = Present, A = Absent, L = Leave, H = Holiday
     ============================================================ */
  bindShortcuts() {
    if (this._shortcutsBound) return;
    this._shortcutsBound = true;
    document.addEventListener('keydown', e => {
      const searchBox = App.$('[data-search="attendance"]');
      if (!searchBox || document.activeElement !== searchBox) return;
      const view = document.querySelector('.view.active');
      if (!view || view.id !== 'attendance') return;
      const matches = App.db.students.filter(s => App.matches(s, App.filters.attendance, ['admissionId', 'name', 'mobile', 'className']));
      if (matches.length !== 1) return;
      const key = e.key.toLowerCase();
      const map = { p: 'markPresent', a: 'markAbsent', l: 'markLeave', h: 'markHoliday' };
      if (map[key]) { e.preventDefault(); this[map[key]](matches[0].id); }
    });
  },

  /* ============================================================
     RENDER — Daily Attendance (mark buttons + bulk actions) and
     Attendance Records (paginated, filterable, editable, exportable).
     ============================================================ */

  _dailyRowHtml(s, todayStatus) {
    const id = App.esc(s.id);
    const btn = (status, label, cls) => '<button' + (cls ? ' class="' + cls + '"' : '') + (todayStatus === status ? ' style="outline:2px solid currentColor;"' : '') + ' data-mark="' + id + '" data-status="' + status + '">' + label + '</button>';
    return '<div class="attrow"><div><b>' + App.esc(s.name) + '</b><br><small>' + App.esc(s.admissionId) + ' | ' + App.esc(s.className) + ' | ' + App.esc(s.mobile) + '</small></div><div style="display:flex;gap:6px;flex-wrap:wrap;">'
      + btn('Present', 'Present', 'green') + btn('Absent', 'Absent', 'red') + btn('Leave', 'Leave', 'yellow') + btn('Holiday', 'Holiday', 'ghost')
      + '<button class="ghost" data-history="' + id + '">History</button>'
      + '</div></div>';
  },

  _renderDaily() {
    const date = App.$('#attendanceDate')?.value || App.today();
    const students = App.db.students.filter(s => App.matches(s, App.filters.attendance, ['admissionId', 'name', 'mobile', 'className']));
    const target = App.$('#attendanceList');
    if (!target) return;

    let toolbar = App.$('#attendanceBulkToolbar');
    const wrap = target.parentElement;
    if (!toolbar && wrap) {
      toolbar = document.createElement('div');
      toolbar.id = 'attendanceBulkToolbar';
      toolbar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;';
      wrap.insertBefore(toolbar, target);
    }
    if (toolbar) {
      toolbar.innerHTML = '<button class="green" id="attBulkPresent" type="button">Mark All Present</button><button class="red" id="attBulkAbsent" type="button">Mark All Absent</button><span class="muted" style="align-self:center;">' + students.length + ' student(s) shown</span>';
      App.$('#attBulkPresent').onclick = () => this.markBulk(students.map(s => s.id), 'Present', date);
      App.$('#attBulkAbsent').onclick = () => this.markBulk(students.map(s => s.id), 'Absent', date);
    }

    target.innerHTML = students.length
      ? students.map(s => {
          const existing = App.db.attendance.find(a => a.studentId === s.id && a.date === date);
          return this._dailyRowHtml(s, existing ? existing.status : null);
        }).join('')
      : '<div class="empty">Student record nahi mila.</div>';

    App.$$('[data-mark]').forEach(b => b.onclick = () => this.save({ studentId: b.dataset.mark, date, status: b.dataset.status }));
    App.$$('[data-history]').forEach(b => b.onclick = () => this.showHistory(b.dataset.history));
  },

  _renderToolbar(filteredCount) {
    const table = App.$('#attendanceTable');
    const wrap = table && table.closest ? table.closest('.tablewrap') : null;
    if (!wrap) return;
    let bar = App.$('#attendanceRecordsToolbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'attendanceRecordsToolbar';
      bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;';
      wrap.insertAdjacentElement('beforebegin', bar);
    }
    const totalPages = Math.max(1, Math.ceil(filteredCount / this.CONFIG.PAGE_SIZE));
    if (this._page > totalPages) this._page = totalPages;
    bar.innerHTML = '<select id="attendanceClassFilter">' + this._classOptions() + '</select>'
      + '<input type="date" id="attendanceDateFilter" value="' + App.esc(this._filterDate) + '">'
      + '<button type="button" class="ghost" id="attendanceDateFilterClear">Clear Date</button>'
      + '<span class="muted" style="margin-left:auto;">' + filteredCount + ' record(s) — Page ' + this._page + ' / ' + totalPages + '</span>'
      + '<button type="button" class="ghost" id="attendancePrevPage">Prev</button>'
      + '<button type="button" class="ghost" id="attendanceNextPage">Next</button>';
    App.$('#attendanceClassFilter').onchange = e => { this._filterClass = e.target.value; this._page = 1; this.render(); };
    App.$('#attendanceDateFilter').onchange = e => { this._filterDate = e.target.value; this._page = 1; this.render(); };
    App.$('#attendanceDateFilterClear').onclick = () => { this._filterDate = ''; this._page = 1; this.render(); };
    App.$('#attendancePrevPage').onclick = () => { if (this._page > 1) { this._page--; this.render(); } };
    App.$('#attendanceNextPage').onclick = () => { if (this._page < totalPages) { this._page++; this.render(); } };
  },

  _paginate(list) {
    const start = (this._page - 1) * this.CONFIG.PAGE_SIZE;
    return list.slice(start, start + this.CONFIG.PAGE_SIZE);
  },

  _recordRowHtml(a) {
    const id = App.esc(a.id);
    const statusOptions = this.CONFIG.STATUSES.map(s => '<option' + (s === a.status ? ' selected' : '') + '>' + s + '</option>').join('');
    return '<tr>'
      + '<td>' + App.esc(a.date) + '</td>'
      + '<td>' + App.esc(a.student) + '</td>'
      + '<td>' + App.esc(a.className) + '</td>'
      + '<td><select data-status-change="' + id + '">' + statusOptions + '</select></td>'
      + '<td><input data-remarks="' + id + '" value="' + App.esc(a.remarks || '') + '" placeholder="Remarks" style="width:120px;"></td>'
      + '<td><button class="red" data-del-att="' + id + '">Delete</button></td>'
      + '</tr>';
  },

  _renderRecords() {
    const filtered = this._applyFilters(App.db.attendance).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    this._renderToolbar(filtered.length);
    const pageRows = this._paginate(filtered);
    App.renderList('#attendanceTable', pageRows.map(a => this._recordRowHtml(a)));

    App.$$('[data-status-change]').forEach(sel => sel.onchange = () => this.update(sel.dataset.statusChange, { status: sel.value }));
    App.$$('[data-del-att]').forEach(b => b.onclick = () => this.delete(b.dataset.delAtt));

    // Auto Save for Remarks — debounced per-row, no explicit save button needed.
    App.$$('[data-remarks]').forEach(input => {
      if (input._autosaveBound) return;
      input._autosaveBound = true;
      const debounced = App._debounce ? App._debounce(() => this.update(input.dataset.remarks, { remarks: input.value }), this.CONFIG.REMARKS_DEBOUNCE_MS) : () => this.update(input.dataset.remarks, { remarks: input.value });
      input.addEventListener('input', debounced);
    });

    const csvBtn = App.$('#attendanceCsv');
    if (csvBtn) csvBtn.onclick = () => this.exportCsv();
  },

  render() {
    this._renderDaily();
    this._renderRecords();
    this.bindShortcuts();
    this._bindOfflineSync();
  }

};

App.Attendance.restorePendingQueue();
