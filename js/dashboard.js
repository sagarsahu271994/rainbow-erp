App.Dashboard = {
  drawBars(id, labels, values, color) {
    const c = App.$('#' + id);
    if (!c) return;
    const x = c.getContext('2d');
    const w = c.width = c.clientWidth * devicePixelRatio;
    const h = c.height = 180 * devicePixelRatio;
    x.clearRect(0, 0, w, h);
    const max = Math.max(...values, 1);
    const gap = w / (values.length || 1);
    x.fillStyle = color;
    values.forEach((v, i) => {
      const bh = (h - 40) * (v / max);
      x.fillRect(i * gap + 12 * devicePixelRatio, h - bh - 24 * devicePixelRatio, Math.max(8, gap - 24 * devicePixelRatio), bh);
    });
    x.fillStyle = '#657386';
    x.font = 12 * devicePixelRatio + 'px Arial';
    labels.forEach((l, i) => x.fillText(l, i * gap + 8 * devicePixelRatio, h - 6 * devicePixelRatio));
  },

  money(value) {
    return '₹' + Number(value || 0).toLocaleString('en-IN');
  },

  reminderMessage(student) {
    const dueDate = App.nextDueDate(student);
    return [
      'Rainbow The Learner Zone',
      '',
      'Dear Parent,',
      '',
      'Student: ' + (student.name || '-'),
      'Class: ' + (student.className || '-'),
      '',
      "Your child's fees are due.",
      '',
      'Please pay the fees at the earliest.',
      '',
      'Due Date: ' + (dueDate ? App.fmt(dueDate) : '-'),
      'Pending Fees: ' + this.money(student.pendingFees || student.fees || 0),
      '',
      'Thank You',
      'Rainbow The Learner Zone'
    ].join('\n');
  },

  async writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  },

  async copyReminderMessage(student) {
    await this.writeClipboard(this.reminderMessage(student));
    App.toast('Message copied successfully.');
  },

  async shareReminderMessage(student) {
    const message = this.reminderMessage(student);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Fees Due Reminder', text: message });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    await this.writeClipboard(message);
    App.toast('Message copied successfully.');
  },

  pendingRows() {
    return App.db.students.map(student => {
      const dueDate = App.nextDueDate(student);
      const pendingAmount = App.num(student.pendingFees || student.fees || 0);
      const isPending = dueDate && !App.feePaidForMonth(student, dueDate) && pendingAmount > 0;
      return { student, dueDate, pendingAmount, isPending };
    }).filter(row => row.isPending);
  },

  closedAlerts: new Set(),
  showClosedAlerts: false,

  filterPendingStudents() {
    const search = App.norm(App.$('#pendingSearch')?.value || '');
    const month = App.$('#pendingMonthFilter')?.value || 'all';
    return this.pendingRows().filter(row => {
      const s = row.student;
      const dueMonth = row.dueDate ? App.monthKey(App.todayFromDate(row.dueDate)) : '';
      const matchesSearch = !search || [s.name, s.className, s.mobile, s.admissionId].some(v => App.norm(v).includes(search));
      const matchesMonth = month === 'all' || dueMonth === month;
      const isClosed = this.closedAlerts.has(s.id);
      const matchesAlertState = this.showClosedAlerts ? isClosed : !isClosed;
      return matchesSearch && matchesMonth && matchesAlertState;
    });
  },

  toggleAlertClosed(id) {
    if (this.closedAlerts.has(id)) this.closedAlerts.delete(id); else this.closedAlerts.add(id);
    this.renderPendingTable();
  },

  toggleShowClosedAlerts() {
    this.showClosedAlerts = !this.showClosedAlerts;
    const btn = App.$('#pendingShowClosed');
    if (btn) btn.textContent = this.showClosedAlerts ? 'Show Active Alerts' : 'Show Closed Alerts';
    this.renderPendingTable();
  },

  searchPendingStudents() {
    this.renderPendingTable();
  },

  pendingSummary(rows) {
    const allRows = this.pendingRows();
    const total = rows.reduce((sum, row) => sum + App.num(row.pendingAmount), 0);
    const allTotal = allRows.reduce((sum, row) => sum + App.num(row.pendingAmount), 0);
    const today = App.parseDate(App.today());
    const overdue = rows.filter(row => row.dueDate && row.dueDate < today).length;
    return { total, allTotal, count: rows.length, allCount: allRows.length, overdue };
  },

  pendingOptions(rows) {
    const months = [...new Set(rows.map(row => row.dueDate ? App.monthKey(App.todayFromDate(row.dueDate)) : '').filter(Boolean))].sort();
    return '<option value="all">All Months</option>' + months.map(month => '<option value="' + App.esc(month) + '">' + App.esc(month) + '</option>').join('');
  },

  openPendingFeesModal() {
    const allRows = this.pendingRows();
    const summary = this.pendingSummary(allRows);
    App.$('#modalBody').innerHTML = '<section class="pending-modal"><div class="pending-hero"><div><h2>Pending Fees</h2><p>Review, search, remind and export pending fee records.</p></div><button id="pendingPdfBtn" class="red" type="button">Export PDF</button></div><div class="pending-summary-grid"><article class="pending-summary-card"><span>Total Pending</span><strong id="pendingModalAmount">' + this.money(summary.allTotal) + '</strong></article><article class="pending-summary-card"><span>Students Pending</span><strong id="pendingModalCount">' + summary.allCount + '</strong></article><article class="pending-summary-card"><span>Overdue</span><strong id="pendingModalOverdue">' + summary.overdue + '</strong></article><article class="pending-summary-card"><span>Showing</span><strong id="pendingModalShowing">' + summary.allCount + '</strong></article></div><div class="pending-toolbar"><input id="pendingSearch" type="search" placeholder="Search student, class, mobile or admission no."><select id="pendingMonthFilter">' + this.pendingOptions(allRows) + '</select><div class="pending-bulk-actions"><button id="pendingAllWa" type="button">WhatsApp All</button><button id="pendingAllShare" class="blue" type="button">Share All</button><button id="pendingAllCopy" class="ghost" type="button">Copy All</button><button id="pendingShowClosed" class="dark" type="button">' + (this.showClosedAlerts ? 'Show Active Alerts' : 'Show Closed Alerts') + '</button></div></div><div id="pendingFeesResults" class="pending-results"></div></section>';
    App.$('#modal').classList.add('show');
    App.$('#pendingSearch').oninput = () => this.searchPendingStudents();
    App.$('#pendingMonthFilter').onchange = () => this.renderPendingTable();
    App.$('#pendingAllWa').onclick = () => this.whatsappAllPending();
    App.$('#pendingAllShare').onclick = () => this.shareAllPending();
    App.$('#pendingAllCopy').onclick = () => this.copyAllPending();
    App.$('#pendingShowClosed').onclick = () => this.toggleShowClosedAlerts();
    App.$('#pendingPdfBtn').onclick = () => this.exportPendingPDF();
    if (this.pendingResizeHandler) window.removeEventListener('resize', this.pendingResizeHandler);
    this.pendingResizeHandler = () => {
      const mode = window.innerWidth <= 768 ? 'cards' : 'table';
      if (mode !== this.pendingRenderMode) this.renderPendingTable();
    };
    window.addEventListener('resize', this.pendingResizeHandler);
    this.renderPendingTable();
  },

  renderPendingTable() {
    const rows = this.filterPendingStudents();
    const summary = this.pendingSummary(rows);
    const target = App.$('#pendingFeesResults');
    if (!target) return;
    const useCards = window.innerWidth <= 768;
    this.pendingRenderMode = useCards ? 'cards' : 'table';
    App.$('#pendingModalAmount').textContent = this.money(summary.total);
    App.$('#pendingModalCount').textContent = String(summary.count);
    App.$('#pendingModalOverdue').textContent = String(summary.overdue);
    App.$('#pendingModalShowing').textContent = String(summary.count);
    if (!rows.length) {
      target.innerHTML = useCards
        ? '<div class="pending-card-list"><div class="pending-empty">No pending students found.</div></div>'
        : '<div class="pending-table-wrap"><table class="pending-table"><thead><tr><th>Student</th><th>Class</th><th>Mobile</th><th>Due Date</th><th>Pending</th><th>Status</th><th>Actions</th></tr></thead><tbody id="pendingFeesTableBody"><tr><td colspan="7"><div class="pending-empty">No pending students found.</div></td></tr></tbody></table></div>';
      return;
    }
    const today = App.parseDate(App.today());
    const rowHtml = rows.map(row => {
      const s = row.student;
      const id = App.esc(s.id);
      const overdue = row.dueDate && row.dueDate < today;
      const status = overdue ? 'Overdue' : 'Due';
      const closed = this.closedAlerts.has(s.id);
      return '<tr><td><b>' + App.esc(s.name) + '</b><br><small>' + App.esc(s.admissionId || '-') + '</small></td><td>' + App.esc(s.className || '-') + '</td><td>' + App.esc(s.mobile || '-') + '</td><td>' + (row.dueDate ? App.fmt(row.dueDate) : '-') + '</td><td><b>' + this.money(row.pendingAmount) + '</b></td><td><span class="status-badge ' + (overdue ? 'overdue' : 'due') + '">' + status + '</span></td><td><div class="pending-row-actions"><button class="green" data-pending-collect="' + id + '">Collect Fee</button><button data-pending-wa="' + id + '">WhatsApp</button><button class="blue" data-pending-share="' + id + '">Share</button><button class="ghost" data-pending-copy="' + id + '">Copy</button><button class="ghost" data-pending-toggle-close="' + id + '">' + (closed ? 'Reopen Alert' : 'Close Alert') + '</button></div></td></tr>';
    }).join('');
    const cardHtml = rows.map(row => {
      const s = row.student;
      const id = App.esc(s.id);
      const overdue = row.dueDate && row.dueDate < today;
      const status = overdue ? 'Overdue' : 'Due';
      const closed = this.closedAlerts.has(s.id);
      return '<article class="pending-card"><div class="pending-card-head"><div><b>' + App.esc(s.name) + '</b><small>' + App.esc(s.admissionId || '-') + '</small></div><span class="status-badge ' + (overdue ? 'overdue' : 'due') + '">' + status + '</span></div><div class="pending-card-grid"><div><span>Class</span><strong>' + App.esc(s.className || '-') + '</strong></div><div><span>Mobile</span><strong>' + App.esc(s.mobile || '-') + '</strong></div><div><span>Due Date</span><strong>' + (row.dueDate ? App.fmt(row.dueDate) : '-') + '</strong></div><div><span>Pending</span><strong>' + this.money(row.pendingAmount) + '</strong></div></div><div class="pending-row-actions"><button class="green" data-pending-collect="' + id + '">Collect Fee</button><button data-pending-wa="' + id + '">WhatsApp</button><button class="blue" data-pending-share="' + id + '">Share</button><button class="ghost" data-pending-copy="' + id + '">Copy</button><button class="ghost" data-pending-toggle-close="' + id + '">' + (closed ? 'Reopen Alert' : 'Close Alert') + '</button></div></article>';
    }).join('');
    target.innerHTML = useCards
      ? '<div class="pending-card-list">' + cardHtml + '</div>'
      : '<div class="pending-table-wrap"><table class="pending-table"><thead><tr><th>Student</th><th>Class</th><th>Mobile</th><th>Due Date</th><th>Pending</th><th>Status</th><th>Actions</th></tr></thead><tbody id="pendingFeesTableBody">' + rowHtml + '</tbody></table></div>';
    App.$$('[data-pending-collect]').forEach(btn => btn.onclick = () => this.collectFee(btn.dataset.pendingCollect));
    App.$$('[data-pending-wa]').forEach(btn => btn.onclick = () => this.whatsappPending(btn.dataset.pendingWa));
    App.$$('[data-pending-share]').forEach(btn => btn.onclick = () => this.sharePending(btn.dataset.pendingShare));
    App.$$('[data-pending-copy]').forEach(btn => btn.onclick = () => this.copyPending(btn.dataset.pendingCopy));
    App.$$('[data-pending-toggle-close]').forEach(btn => btn.onclick = () => this.toggleAlertClosed(btn.dataset.pendingToggleClose));
  },

  // Walks through every pending student one at a time so each WhatsApp tab
  // opens as a direct result of a click (browsers block auto-opened tabs
  // that aren't tied to a user click, so this can't be done in one loop).
  sendAllDue() {
    const list = App.pendingStudents();
    if (!list.length) return App.toast('No due reminders');
    this.dueQueue = list;
    this.dueIndex = 0;
    this.renderDueQueueModal();
  },

  renderDueQueueModal() {
    const total = this.dueQueue.length;
    const s = this.dueQueue[this.dueIndex];
    const modal = App.$('#modal');
    if (!s) {
      if (modal) modal.classList.remove('show');
      App.toast('Due reminders queue finished.');
      App.render();
      return;
    }
    App.$('#modalBody').innerHTML = '<h2>Send Due Reminders</h2><p>Reminder ' + (this.dueIndex + 1) + ' of ' + total + '</p><div class="item"><div><b>' + App.esc(s.name) + '</b><br><small>' + App.esc(s.className || '-') + ' | ' + App.esc(s.mobile || '-') + ' | ' + this.money(s.pendingFees || s.fees) + '</small></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;"><button id="dueQueueSend" class="green" type="button">Send WhatsApp &amp; Next</button><button id="dueQueueSkip" class="ghost" type="button">Skip</button><button id="dueQueueStop" class="red" type="button">Stop</button></div>';
    if (modal) modal.classList.add('show');
    App.$('#dueQueueSend').onclick = () => { App.whatsapp(s.mobile, this.reminderMessage(s)); this.dueIndex++; this.renderDueQueueModal(); };
    App.$('#dueQueueSkip').onclick = () => { this.dueIndex++; this.renderDueQueueModal(); };
    App.$('#dueQueueStop').onclick = () => { if (modal) modal.classList.remove('show'); };
  },

  collectFee(id) {
    const s = App.studentById(id);
    if (!s) return;
    const modal = App.$('#modal');
    if (modal) modal.classList.remove('show');
    App.navigate('fees', 'Fees Receipt');
    const form = App.$('#feesForm');
    if (form && form.elements.studentName) {
      form.elements.studentName.value = s.name;
      if (App.Fees && App.Fees.fill) App.Fees.fill();
      if (form.elements.fees) form.elements.fees.focus();
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  },

  whatsappPending(id) {
    const s = App.studentById(id);
    if (s) App.whatsapp(s.mobile, this.reminderMessage(s));
  },

  sharePending(id) {
    const s = App.studentById(id);
    if (s) this.shareReminderMessage(s);
  },

  copyPending(id) {
    const s = App.studentById(id);
    if (s) this.copyReminderMessage(s);
  },

  allPendingMessage(rows) {
    return rows.map((row, index) => {
      const s = row.student;
      return (index + 1) + '. ' + (s.name || '-') + ' | Class: ' + (s.className || '-') + ' | Due: ' + (row.dueDate ? App.fmt(row.dueDate) : '-') + ' | Pending: ' + this.money(row.pendingAmount);
    }).join('\n');
  },

  whatsappAllPending() {
    const rows = this.filterPendingStudents();
    if (!rows.length) return App.toast('No pending students found.');
    App.whatsapp('', 'Rainbow The Learner Zone\n\nPending Fees List\n\n' + this.allPendingMessage(rows));
  },

  async shareAllPending() {
    const rows = this.filterPendingStudents();
    if (!rows.length) return App.toast('No pending students found.');
    const text = 'Rainbow The Learner Zone\n\nPending Fees List\n\n' + this.allPendingMessage(rows);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Pending Fees List', text });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    await this.writeClipboard(text);
    App.toast('Message copied successfully.');
  },

  async copyAllPending() {
    const rows = this.filterPendingStudents();
    if (!rows.length) return App.toast('No pending students found.');
    await this.writeClipboard('Rainbow The Learner Zone\n\nPending Fees List\n\n' + this.allPendingMessage(rows));
    App.toast('Message copied successfully.');
  },

  exportPendingPDF() {
    const rows = this.filterPendingStudents();
    if (!rows.length) return App.toast('No pending students found.');
    const html = '<section class="doc ready"><h2>Pending Fees Report</h2><p>' + App.esc(App.today()) + '</p><table><thead><tr><th>Student</th><th>Class</th><th>Mobile</th><th>Due Date</th><th>Pending</th></tr></thead><tbody>' + rows.map(row => '<tr><td>' + App.esc(row.student.name) + '</td><td>' + App.esc(row.student.className || '-') + '</td><td>' + App.esc(row.student.mobile || '-') + '</td><td>' + (row.dueDate ? App.fmt(row.dueDate) : '-') + '</td><td>' + this.money(row.pendingAmount) + '</td></tr>').join('') + '</tbody></table></section>';
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page';
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    if (window.html2pdf) {
      window.html2pdf().set({ margin: 10, filename: 'pending-fees-report.pdf', image: { type: 'jpeg', quality: .98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(wrap).save().finally(() => wrap.remove());
      return;
    }
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) {
      wrap.remove();
      return App.toast('Popup blocked');
    }
    w.document.write('<!doctype html><html><head><title>Pending Fees Report</title><link rel="stylesheet" href="styles.css"></head><body>' + html + '</body></html>');
    w.document.close();
    wrap.remove();
    setTimeout(() => { w.focus(); w.print(); }, 350);
  },

  renderUpcomingDue() {
    const rows = App.db.students
      .filter(s => {
        const d = App.nextDueDate(s);
        return d && !App.feePaidForMonth(s, d);
      })
      .slice(0, 8)
      .map(s => {
        const id = App.esc(s.id);
        return '<div class="item due-item"><div><b>' + App.esc(s.name) + '</b><br><small>' + App.esc(s.className) + ' | ' + App.fmt(App.nextDueDate(s)) + ' | ' + this.money(s.pendingFees || s.fees) + '</small></div><div class="due-actions" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;"><button class="green" data-due-collect="' + id + '">Collect Fee</button><button data-due-wa="' + id + '">WhatsApp</button><button class="blue" data-due-share="' + id + '">Share</button><button class="ghost" data-due-copy="' + id + '">Copy</button></div></div>';
      });
    App.renderCards('#upcomingDueList', rows, 'No upcoming due.');
    App.$$('[data-due-collect]').forEach(b => b.onclick = () => this.collectFee(b.dataset.dueCollect));
    App.$$('[data-due-wa]').forEach(b => b.onclick = () => { const s = App.studentById(b.dataset.dueWa); if (s) App.whatsapp(s.mobile, this.reminderMessage(s)); });
    App.$$('[data-due-share]').forEach(b => b.onclick = () => { const s = App.studentById(b.dataset.dueShare); if (s) this.shareReminderMessage(s); });
    App.$$('[data-due-copy]').forEach(b => b.onclick = () => { const s = App.studentById(b.dataset.dueCopy); if (s) this.copyReminderMessage(s); });
  },

  render() {
    const t = App.today();
    const m = App.monthKey(t);
    const today = App.db.fees.filter(f => f.date === t).reduce((a, f) => a + App.num(f.total), 0);
    const monthly = App.db.fees.filter(f => App.monthKey(f.date) === m).reduce((a, f) => a + App.num(f.total), 0);
    const pending = this.pendingRows();
    const pendingTotal = pending.reduce((a, row) => a + App.num(row.pendingAmount), 0);
    App.$('#todayCollection').textContent = App.rs(today);
    App.$('#monthlyCollection').textContent = App.rs(monthly);
    App.$('#pendingFees').textContent = this.money(pendingTotal);
    if (App.$('#pendingStudentsCount')) App.$('#pendingStudentsCount').textContent = pending.length + ' Students Pending';
    App.$('#totalStudents').textContent = App.db.students.length;
    App.$('#todayAttendance').textContent = App.db.attendance.filter(a => a.date === t && a.status === 'Present').length;
    const detailsBtn = App.$('#pendingFeesDetailsBtn');
    if (detailsBtn) detailsBtn.onclick = () => this.openPendingFeesModal();
    const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return App.todayFromDate(d); });
    this.drawBars('collectionChart', days.map(d => d.slice(5)), days.map(d => App.db.fees.filter(f => f.date === d).reduce((a, f) => a + App.num(f.total), 0)), '#2878c7');
    this.drawBars('attendanceChart', days.map(d => d.slice(5)), days.map(d => App.db.attendance.filter(a => a.date === d && a.status === 'Present').length), '#55a847');
    this.renderUpcomingDue();
    App.renderCards('#recentAdmissions', App.db.admissions.slice(0, 5).map(a => '<div class="item"><div><b>' + App.esc(a.studentName) + '</b><br><small>' + App.esc(a.admissionId) + ' | ' + App.esc(a.className) + ' | ' + App.esc(a.date) + '</small></div></div>'), 'No admission yet.');
    App.renderCards('#recentFees', App.db.fees.slice(0, 5).map(f => '<div class="item"><div><b>' + App.esc(f.studentName) + '</b><br><small>' + App.esc(f.receiptNo) + ' | ' + App.esc(f.date) + ' | ' + App.rs(f.total) + '</small></div></div>'), 'No receipt yet.');
  }
};
