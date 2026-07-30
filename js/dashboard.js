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
      x.fillRect(
        i * gap + 12 * devicePixelRatio,
        h - bh - 24 * devicePixelRatio,
        Math.max(8, gap - 24 * devicePixelRatio),
        bh
      );
    });
    x.fillStyle = '#657386';
    x.font = 12 * devicePixelRatio + 'px Arial';
    labels.forEach((l, i) => x.fillText(l, i * gap + 8 * devicePixelRatio, h - 6 * devicePixelRatio));
  },

  reminderMessage(student) {
  const dueDate = App.nextDueDate(student);

  return [
    '🌈 *Rainbow The Learner Zone*',
    '',
    'Dear Parent/Guardian,',
    '',
    'This is a gentle reminder that your child\'s tuition fee is pending.',
    '',
    '━━━━━━━━━━━━━━━━━━',
    '👤 *Student Name:* ' + (student.name || '-'),
    '🎓 *Class:* ' + (student.className || '-'),
    '📅 *Due Date:* ' + (dueDate ? App.fmt(dueDate) : '-'),
    '💰 *Pending Fees:* ' + App.rs(student.pendingFees || student.fees || 0),
    '━━━━━━━━━━━━━━━━━━',
    '',
    'Kindly pay the pending fees at the earliest to ensure uninterrupted classes and academic services.',
    '',
    'Thank you for your continued support and cooperation.',
    '',
    '📞 *Rainbow The Learner Zone*'
  ].join('\n');
},

  async copyReminderMessage(student) {
    await navigator.clipboard.writeText(this.reminderMessage(student));
    App.toast('Message copied successfully.');
  },

  async shareReminderMessage(student) {
    const message = this.reminderMessage(student);
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Fees Due Reminder',
          text: message
        });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    await navigator.clipboard.writeText(message);
    App.toast('Message copied successfully.');
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
        return '<div class="item due-item"><div><b>' + App.esc(s.name) + '</b><br><small>' +
          App.esc(s.className) + ' | ' + App.fmt(App.nextDueDate(s)) + ' | ' +
          App.rs(s.pendingFees || s.fees) +
          '</small></div><div class="due-actions" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">' +
          '<button data-due-wa="' + id + '">WhatsApp</button>' +
          '<button class="blue" data-due-share="' + id + '">Share</button>' +
          '<button class="ghost" data-due-copy="' + id + '">Copy</button>' +
          '</div></div>';
      });

    App.renderCards('#upcomingDueList', rows, 'No upcoming due.');

    App.$$('[data-due-wa]').forEach(b => {
      b.onclick = () => {
        const s = App.studentById(b.dataset.dueWa);
        if (s) App.whatsapp(s.mobile, this.reminderMessage(s));
      };
    });

    App.$$('[data-due-share]').forEach(b => {
      b.onclick = () => {
        const s = App.studentById(b.dataset.dueShare);
        if (s) this.shareReminderMessage(s);
      };
    });

    App.$$('[data-due-copy]').forEach(b => {
      b.onclick = () => {
        const s = App.studentById(b.dataset.dueCopy);
        if (s) this.copyReminderMessage(s);
      };
    });
  },

  render() {
    const t = App.today();
    const m = App.monthKey(t);
    const today = App.db.fees.filter(f => f.date === t).reduce((a, f) => a + App.num(f.total), 0);
    const monthly = App.db.fees.filter(f => App.monthKey(f.date) === m).reduce((a, f) => a + App.num(f.total), 0);
    const pending = App.pendingStudents();

    App.$('#todayCollection').textContent = App.rs(today);
    App.$('#monthlyCollection').textContent = App.rs(monthly);
    App.$('#pendingFees').textContent = App.rs(pending.reduce((a, s) => a + App.num(s.pendingFees || s.fees), 0));
    App.$('#totalStudents').textContent = App.db.students.length;
    App.$('#todayAttendance').textContent = App.db.attendance.filter(a => a.date === t && a.status === 'Present').length;

    const days = [...Array(7)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - 6 + i);
      return App.todayFromDate(d);
    });

    this.drawBars(
      'collectionChart',
      days.map(d => d.slice(5)),
      days.map(d => App.db.fees.filter(f => f.date === d).reduce((a, f) => a + App.num(f.total), 0)),
      '#2878c7'
    );
    this.drawBars(
      'attendanceChart',
      days.map(d => d.slice(5)),
      days.map(d => App.db.attendance.filter(a => a.date === d && a.status === 'Present').length),
      '#55a847'
    );

    this.renderUpcomingDue();

    App.renderCards(
      '#recentAdmissions',
      App.db.admissions.slice(0, 5).map(a => '<div class="item"><div><b>' + App.esc(a.studentName) +
        '</b><br><small>' + App.esc(a.admissionId) + ' | ' + App.esc(a.className) + ' | ' +
        App.esc(a.date) + '</small></div></div>'),
      'No admission yet.'
    );
    App.renderCards(
      '#recentFees',
      App.db.fees.slice(0, 5).map(f => '<div class="item"><div><b>' + App.esc(f.studentName) +
        '</b><br><small>' + App.esc(f.receiptNo) + ' | ' + App.esc(f.date) + ' | ' +
        App.rs(f.total) + '</small></div></div>'),
      'No receipt yet.'
    );
  }
};
