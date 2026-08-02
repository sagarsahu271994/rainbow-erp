/**
 * app.js — Rainbow ERP Application Controller.
 *
 * This file is ONLY the controller/orchestrator: event bus, navigation,
 * modal manager, loading overlay, toast wrapper, session/preferences,
 * keyboard shortcuts, network/error handling, and wiring of the existing
 * manual forms. It contains NO business logic — no fee math, no PDF
 * generation, no direct Supabase queries beyond what the original manual
 * form handlers already did (kept for backward compatibility, see note
 * below). Every real feature (fees, students, dashboard, PDF, Supabase)
 * is implemented in its own module and only ever *called* from here.
 *
 * HONESTY NOTES (read before relying on these):
 * - "Do not modify any other file" means app.js cannot add App.emit()
 *   calls *inside* fees.js's App.Fees.generateReceipt() (the Collect Fees
 *   popup flow used from Dashboard/Alerts). That flow already calls
 *   App.save() -> App.render() -> App.Dashboard.render() on success, so
 *   "auto refresh Dashboard after fee collection" already works today —
 *   just not through the new event bus for that specific entry point.
 *   The event bus below IS wired to the three manual forms that live in
 *   THIS file (#studentForm/#admissionForm/#feesForm), which is the only
 *   fee/admission/student-creation code app.js actually owns.
 * - "Refresh Student Profile after fee collection": the Student Profile
 *   and the Collect Fees popup share the same single #modal element (by
 *   original design), so they can never be open at the same time — there
 *   is nothing to "live refresh" while both are visible. Reopening a
 *   profile after a collection already shows the new receipt, because
 *   App.Students.profile() reads live from App.db.fees on every open.
 * - Sidebar Toggle / Theme Toggle: index.html has no toggle buttons for
 *   these yet (I was told not to modify HTML). The mechanisms below
 *   (App.Session.toggleSidebar/toggleTheme) are fully implemented and
 *   will work the moment a button with id="sidebarToggle" / id="themeToggle"
 *   exists — they just have nothing to bind to right now, so they're inert
 *   until that HTML is added.
 */

/* ================================================================
   INIT GUARD — every module below must initialize exactly once even
   if this script were ever evaluated twice.
   ================================================================ */
if (App._controllerInitialized) {
  console.warn('app.js: controller already initialized, skipping re-init.');
} else {
App._controllerInitialized = true;

/* ================================================================
   EVENT BUS — App.emit / App.on / App.off
   ================================================================ */
App._eventHandlers = App._eventHandlers || new Map();

/** @param {string} event @param {Function} handler */
App.on = (event, handler) => {
  if (typeof handler !== 'function') return;
  if (!App._eventHandlers.has(event)) App._eventHandlers.set(event, new Set());
  App._eventHandlers.get(event).add(handler); // Set -> adding the same fn twice is a no-op (prevents duplicate listeners)
};

/** @param {string} event @param {Function} [handler] omit to remove all handlers for the event */
App.off = (event, handler) => {
  const set = App._eventHandlers.get(event);
  if (!set) return;
  if (handler) set.delete(handler); else set.clear();
};

/** @param {string} event @param {*} [payload] */
App.emit = (event, payload) => {
  const set = App._eventHandlers.get(event);
  if (!set || !set.size) return;
  set.forEach(handler => {
    try { handler(payload); } catch (e) { console.error('Event handler failed for "' + event + '"', e); }
  });
};

/* ================================================================
   TOAST — thin wrapper around the existing App.toast(), adds
   success/error/warning/info without touching utils.js or styles.css.
   ================================================================ */
App.Toast = {
  success(msg) { App.toast('✅ ' + msg); },
  error(msg) { App.toast('❌ ' + msg); },
  warning(msg) { App.toast('⚠️ ' + msg); },
  info(msg) { App.toast('ℹ️ ' + msg); }
};

/* ================================================================
   LOADING OVERLAY — created at runtime (no index.html/styles.css edits).
   Reference-counted so nested show()/hide() calls behave correctly.
   ================================================================ */
App.Loading = {
  _count: 0,
  _ensureEl() {
    let el = document.getElementById('rainbowLoadingOverlay');
    if (el) return el;
    if (!document.getElementById('rainbowLoadingStyle')) {
      const style = document.createElement('style');
      style.id = 'rainbowLoadingStyle';
      style.textContent = '#rainbowLoadingOverlay{position:fixed;inset:0;background:rgba(15,20,30,.45);display:none;align-items:center;justify-content:center;z-index:9999}#rainbowLoadingOverlay.show{display:flex}#rainbowLoadingOverlay .rainbow-spinner{width:42px;height:42px;border-radius:50%;border:4px solid rgba(255,255,255,.35);border-top-color:#fff;animation:rainbowSpin .8s linear infinite}@keyframes rainbowSpin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }
    el = document.createElement('div');
    el.id = 'rainbowLoadingOverlay';
    el.innerHTML = '<div class="rainbow-spinner" aria-hidden="true"></div>';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    return el;
  },
  show() {
    this._count++;
    this._ensureEl().classList.add('show');
  },
  hide() {
    this._count = Math.max(0, this._count - 1);
    if (this._count === 0) {
      const el = document.getElementById('rainbowLoadingOverlay');
      if (el) el.classList.remove('show');
    }
  },
  /** Runs an async function with the overlay shown and guaranteed hidden afterwards. */
  async wrap(fn) {
    this.show();
    try { return await fn(); } finally { this.hide(); }
  }
};

/**
 * Prevents double-click / double-submit on a button while an async
 * handler is running. Does not implement any business logic itself —
 * just disables/re-enables the trigger element around the call.
 * @param {HTMLElement} btn
 * @param {Function} asyncFn
 */
App.guardDoubleSubmit = async (btn, asyncFn) => {
  if (btn && btn.disabled) return; // already running — ignore the extra click
  if (btn) btn.disabled = true;
  try {
    await asyncFn();
  } finally {
    if (btn) btn.disabled = false;
  }
};

/* ================================================================
   MODAL MANAGER — wraps the existing single #modal/#modalBody element.
   Individual modules (Students profile, Fees Collect popup, Dashboard
   Pending modal) already write directly into #modalBody and toggle
   #modal's "show" class — that is unchanged. What this adds, globally,
   on top of the existing #modalClose button click handler:
     - Escape key closes the modal (blocked automatically while
       App.Fees has a submission in flight, via its own capture-phase
       guard — this listener runs in the bubble phase, so it never
       fires in that window).
     - Clicking the backdrop (outside the modal card) closes it.
     - A lightweight stack so a caller COULD push/pop nested content
       without losing track of what was open before, while still only
       ever touching the one #modal DOM node that exists.
   ================================================================ */
App.ModalManager = {
  _stack: [],
  isOpen() {
    const el = App.$('#modal');
    return !!(el && el.classList.contains('show'));
  },
  /** Saves current #modalBody html on the stack, then replaces it. */
  push(html) {
    const body = App.$('#modalBody');
    if (!body) return;
    this._stack.push(body.innerHTML);
    body.innerHTML = html;
    App.$('#modal').classList.add('show');
  },
  /** Restores the previous stacked content, if any; otherwise closes. */
  pop() {
    const body = App.$('#modalBody');
    if (!body) return;
    if (this._stack.length) {
      body.innerHTML = this._stack.pop();
    } else {
      this.close();
    }
  },
  close() {
    this._stack = [];
    const el = App.$('#modal');
    if (el) el.classList.remove('show');
  },
  _bindGlobal() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    });
    const overlay = App.$('#modal');
    if (overlay) {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) this.close();
      });
    }
  }
};

/* ================================================================
   SESSION / PREFERENCES — theme, last page, sidebar, filters.
   Stored under dedicated localStorage keys, separate from App.STORE_KEY
   so this never collides with the existing App.db persistence.
   ================================================================ */
App.Session = {
  KEYS: {
    theme: 'rainbowERPTheme',
    lastPage: 'rainbowERPLastPage',
    sidebar: 'rainbowERPSidebarCollapsed',
    filters: 'rainbowERPFilters'
  },

  restoreTheme() {
    const theme = localStorage.getItem(this.KEYS.theme);
    if (theme) document.body.classList.toggle('theme-dark', theme === 'dark');
  },
  toggleTheme() {
    const isDark = document.body.classList.toggle('theme-dark');
    localStorage.setItem(this.KEYS.theme, isDark ? 'dark' : 'light');
  },

  rememberPage(view) {
    if (view) localStorage.setItem(this.KEYS.lastPage, view);
  },
  restoreLastPage() {
    return localStorage.getItem(this.KEYS.lastPage) || 'dashboard';
  },

  restoreSidebar() {
    const collapsed = localStorage.getItem(this.KEYS.sidebar) === 'yes';
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    return collapsed;
  },
  toggleSidebar() {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem(this.KEYS.sidebar, collapsed ? 'yes' : 'no');
  },

  persistFilters() {
    try { localStorage.setItem(this.KEYS.filters, JSON.stringify(App.filters)); } catch (e) { /* ignore quota errors */ }
  },
  restoreFilters() {
    try {
      const saved = App.safeParse(localStorage.getItem(this.KEYS.filters) || '', null);
      if (saved && typeof saved === 'object') App.filters = { ...App.filters, ...saved };
    } catch (e) { /* ignore corrupt data */ }
  }
};

/* ================================================================
   SESSION TIMEOUT — auto-logout after inactivity while logged in.
   ================================================================ */
App.SessionTimeout = {
  TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes
  _timer: null,
  _boundReset: null,
  start() {
    this.stop();
    this._boundReset = () => this.reset();
    ['mousemove', 'keydown', 'click', 'touchstart'].forEach(evt =>
      document.addEventListener(evt, this._boundReset, { passive: true })
    );
    this.reset();
  },
  stop() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    if (this._boundReset) {
      ['mousemove', 'keydown', 'click', 'touchstart'].forEach(evt =>
        document.removeEventListener(evt, this._boundReset)
      );
      this._boundReset = null;
    }
  },
  reset() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      App.Toast.info('Session timeout — aap logout ho gaye hain.');
      App.Auth.logout();
      this.stop();
    }, this.TIMEOUT_MS);
  }
};

/* ================================================================
   NETWORK STATUS — UI feedback only. App.Fees already owns its own
   offline receipt queue + 'online' retry listener (fees.js) — this
   does not duplicate that logic, it only toasts + emits an event bus
   notification other modules could subscribe to later.
   ================================================================ */
App.Network = {
  bind() {
    window.addEventListener('online', () => {
      App.Toast.success('Internet connection wapas aa gaya.');
      App.emit('network:online');
    });
    window.addEventListener('offline', () => {
      App.Toast.warning('Internet connection chala gaya. Kuch actions offline queue ho sakte hain.');
      App.emit('network:offline');
    });
  }
};

/* ================================================================
   GLOBAL ERROR HANDLING — catches anything modules didn't already
   handle themselves. Rate-limited so a repeating error can't spam
   toasts. Does not replace any module's own try/catch (e.g. App.Fees
   already classifies and handles its own errors) — this is the safety
   net underneath all of it.
   ================================================================ */
App.ErrorHandler = {
  _lastToastAt: 0,
  _minGapMs: 4000,
  _notify(message) {
    const now = Date.now();
    if (now - this._lastToastAt < this._minGapMs) return;
    this._lastToastAt = now;
    App.Toast.error(message);
  },
  bind() {
    window.addEventListener('error', e => {
      console.error('Global error:', e.error || e.message);
      this._notify('Kuch unexpected issue hua. Page reload karke dobara try karein.');
    });
    window.addEventListener('unhandledrejection', e => {
      console.error('Unhandled promise rejection:', e.reason);
      this._notify('Kuch background operation fail hui. Dobara try karein.');
    });
  }
};

/* ================================================================
   DEBOUNCE / THROTTLE — small local utilities, kept in app.js only
   (not added to utils.js) since they're used exclusively for wiring
   UI events here.
   ================================================================ */
App._debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};
App._throttle = (fn, ms) => {
  let last = 0, t;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
    else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn(...args); }, ms - (now - last)); }
  };
};

/* ================================================================
   GLOBAL SEARCH + KEYBOARD SHORTCUTS
   Ctrl+F  -> focus the active view's [data-search] box (Students,
              Admissions, Fees, Dashboard's Pending modal all already
              have one; nothing new is created).
   Ctrl+P  -> open Pending Fees modal (App.Dashboard.openPendingFeesModal).
   Ctrl+S  -> submit whichever primary form belongs to the active view.
   Esc     -> handled by App.ModalManager.
   ================================================================ */
App.Shortcuts = {
  FORM_BY_VIEW: {
    students: '#studentForm',
    admission: '#admissionForm',
    fees: '#feesForm'
  },
  _activeView() {
    const el = document.querySelector('.view.active');
    return el ? el.id : 'dashboard';
  },
  bind() {
    document.addEventListener('keydown', e => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key === 'f' || e.key === 'F') {
        const view = this._activeView();
        const input = document.querySelector('#' + view + ' [data-search], [data-search="' + view + '"]');
        if (input) { e.preventDefault(); input.focus(); }
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (App.Dashboard && App.Dashboard.openPendingFeesModal) App.Dashboard.openPendingFeesModal();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        const view = this._activeView();
        const formSel = this.FORM_BY_VIEW[view];
        const form = formSel ? App.$(formSel) : null;
        if (form && form.requestSubmit) form.requestSubmit();
        else if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });
  }
};

/* ================================================================
   EXISTING APPLICATION LOGIC — unchanged behavior, now:
     - no longer calls App.saveToSheet() (Supabase-only architecture;
       Google Sheets / Apps Script sync is fully removed from app.js)
     - wrapped with the double-submit guard
     - emits event-bus notifications where app.js is the owner of the
       action (see the honesty note at the top of this file)
   ================================================================ */

App.setDefaults = () => {
  const t = App.today();
  App.$('#studentForm [name=date]').value = t;
  App.$('#admissionForm [name=date]').value = t;
  App.$('#admissionForm [name=admissionId]').value = App.Admission.nextId();
  App.$('#feesForm [name=date]').value = t;
  App.$('#feesForm [name=receiptNo]').value = App.Fees.nextNo();
  App.$('#attendanceDate').value = t;
};

App.resetForm = (sel, btn, text) => {
  const f = App.$(sel);
  f.reset();
  if (f.elements.id) f.elements.id.value = '';
  if (f.elements.studentId) f.elements.studentId.value = '';
  App.$(btn).textContent = text;
  App.setDefaults();
};

/**
 * Module orchestrator — never contains business logic itself, only
 * calls each module's own render(). Unchanged from the original
 * behavior (kept for backward compatibility with every module).
 */
App.render = () => {
  App.$('#topAddress').textContent = App.db.settings.address;
  App.Dashboard.render();
  App.Students.render();
  App.Admission.render();
  App.Fees.render();
  App.Attendance.render();
  App.Reports.render();
};

document.addEventListener('DOMContentLoaded', () => {
  App.Auth.apply();
  App.Session.restoreFilters();
  App.Session.restoreTheme();
  App.Session.restoreSidebar();
  App.setDefaults();

  Object.entries(App.db.settings).forEach(([k, v]) => {
    const el = App.$('#settingsForm [name="' + k + '"]');
    if (el) el.value = v;
  });

  App.$('#loginForm').onsubmit = e => {
    App.Auth.login(e);
    if (sessionStorage.getItem(App.AUTH_KEY) === 'yes') App.SessionTimeout.start();
  };
  App.$('#logoutBtn').onclick = () => {
    App.Auth.logout();
    App.SessionTimeout.stop();
  };

  App.$$('#modalClose').forEach(b => b.onclick = () => App.ModalManager.close());
  App.ModalManager._bindGlobal();

  App.$$('[data-view]').forEach(b => b.onclick = () => {
    App.navigate(b.dataset.view, b.textContent);
    App.Session.rememberPage(b.dataset.view);
  });

  // FEATURE: debounced search (was firing App.render() on every keystroke).
  App.$$('[data-search]').forEach(i => i.oninput = App._debounce(() => {
    App.filters[i.dataset.search] = i.value;
    App.Session.persistFilters();
    App.render();
  }, 250));

  App.$('#studentForm').onsubmit = e => {
    e.preventDefault();
    App.guardDoubleSubmit(App.$('#studentSubmit'), async () => {
      const item = App.formData(e.target);
      const isNew = !item.id;
      if (item.id) {
        App.db.students = App.db.students.map(s => s.id === item.id ? { ...s, ...item } : s);
      } else {
        item.id = App.uid();
        App.db.students.push(item);
      }
      await App.Supabase.upsert('students', item); // pre-existing direct call, kept for backward compatibility
      App.resetForm('#studentForm', '#studentSubmit', 'Save Student');
      App.save();
      App.emit(isNew ? 'student:created' : 'student:updated', item);
      App.Toast.success('Student saved');
    });
  };

  App.$('#admissionForm').onsubmit = e => {
    e.preventDefault();
    App.guardDoubleSubmit(App.$('#admissionSubmit'), async () => {
      const item = App.formData(e.target);
      let s = App.studentByAdmission(item.admissionId) || App.studentByName(item.studentName);
      if (!s) {
        s = { id: App.uid(), admissionId: item.admissionId, name: item.studentName, fatherName: item.fatherName, motherName: item.motherName, date: item.date, className: item.className, batch: item.batch, mobile: item.mobile, address: item.address, fees: 0 };
        App.db.students.push(s);
        await App.Supabase.upsert('students', s);
      }
      item.studentId = s.id;
      const isNew = !item.id;
      if (item.id) {
        App.db.admissions = App.db.admissions.map(a => a.id === item.id ? { ...a, ...item } : a);
      } else {
        item.id = App.uid();
        App.db.admissions.push(item);
      }
      await App.Supabase.upsert('admissions', item); // pre-existing direct call, kept for backward compatibility
      App.Pdf.showAdmission(item);
      await App.Pdf.ensure('admission', item, 'Admission Form', App.Pdf.admissionHtml(item), App.fileName(item.admissionId + '-' + item.studentName) + '.pdf');
      App.resetForm('#admissionForm', '#admissionSubmit', 'Submit Admission');
      App.save();
      App.emit(isNew ? 'admission:created' : 'admission:updated', item);
      App.Toast.success('Admission saved');
    });
  };

  App.$('#feesForm').onsubmit = e => {
    e.preventDefault();
    App.guardDoubleSubmit(App.$('#feesSubmit'), async () => {
      const item = App.formData(e.target);
      const s = App.studentByName(item.studentName);
      if (s) item.studentId = s.id;
      const isNew = !item.id;
      if (item.id) {
        App.db.fees = App.db.fees.map(f => f.id === item.id ? { ...f, ...item } : f);
      } else {
        item.id = App.uid();
        App.db.fees.push(item);
      }
      await App.Supabase.upsert('fees', item); // pre-existing direct call, kept for backward compatibility
      App.refreshStudentFeeTotals(item.studentId || item.studentName);
      App.Pdf.showReceipt(item);
      await App.Pdf.ensure('fees', item, 'Fees Receipt', App.Pdf.receiptHtml(item), App.fileName(item.receiptNo + '-' + item.studentName) + '.pdf');
      App.resetForm('#feesForm', '#feesSubmit', 'Submit Receipt');
      App.save();
      // Manual Fees form lives entirely in app.js, so this IS the one fee
      // path this file can legitimately emit through the event bus for.
      App.emit(isNew ? 'fee:created' : 'fee:updated', item);
      App.Toast.success('Receipt saved');
    });
  };

  // FEATURE: auto-refresh Dashboard on the event-bus fee events this file
  // owns (see honesty note at top re: the Collect Fees popup in fees.js).
  App.on('fee:created', () => App.Dashboard.render());
  App.on('fee:updated', () => App.Dashboard.render());
  App.on('student:created', () => App.Dashboard.render());
  App.on('student:updated', () => App.Dashboard.render());
  App.on('admission:created', () => App.Dashboard.render());

  App.$('#feesForm [name="studentName"]').onblur = () => App.Fees.fill();
  App.$('#nextAdmission').onclick = () => App.$('#admissionForm [name=admissionId]').value = App.Admission.nextId();
  App.$('#nextReceipt').onclick = () => App.$('#feesForm [name=receiptNo]').value = App.Fees.nextNo();
  App.$('#attendanceDate').onchange = () => App.render();

  App.$('#backup').onclick = () => App.csv('rainbow-erp-backup.csv', [['Type', 'Data'], ['Backup', JSON.stringify(App.db)]]);
  App.$('#sendDue').onclick = () => {
    const s = App.pendingStudents()[0];
    s ? App.whatsapp(s.mobile, App.reminderText(s)) : App.Toast.info('No due reminders');
  };

  App.$('#studentsCsv').onclick = () => App.csv('students.csv', [['Admission ID', 'Name', 'Fees', 'Date', 'Class', 'Mobile'], ...App.db.students.map(s => [s.admissionId, s.name, s.fees, s.date, s.className, s.mobile])]);
  App.$('#admissionsCsv').onclick = () => App.csv('admissions.csv', [['Date', 'Admission ID', 'Student', 'Class', 'Mobile', 'PDF'], ...App.db.admissions.map(a => [a.date, a.admissionId, a.studentName, a.className, a.mobile, a.pdfUrl])]);
  App.$('#feesCsv').onclick = () => App.csv('fees.csv', [['Receipt', 'Date', 'Student', 'Class', 'Total', 'PDF'], ...App.db.fees.map(f => [f.receiptNo, f.date, f.studentName, f.className, f.total, f.pdfUrl])]);
  App.$('#attendanceCsv').onclick = () => App.csv('attendance.csv', [['Date', 'Student', 'Class', 'Status'], ...App.db.attendance.map(a => [a.date, a.student, a.className, a.status])]);

  App.$('#reportCsv').onclick = () => App.Reports.exportCsv();
  App.$('#reportExcel').onclick = () => App.Reports.exportCsv('rainbow-report.xls');
  App.$('#reportPdf').onclick = () => App.Reports.exportPdf();

  App.$('#saveSettings').onclick = () => {
    App.db.settings = { ...App.db.settings, ...App.formData(App.$('#settingsForm')) };
    App.Supabase.client = null;
    App.save();
    App.Supabase.load();
    App.Toast.success('Settings saved');
  };

  App.$('#sample').onclick = () => App.Toast.info('Production mode: sample data disabled');

  // Optional hooks — only bind if the corresponding element exists.
  // Nothing in index.html currently has these ids; safe no-ops until it does.
  const sidebarBtn = App.$('#sidebarToggle');
  if (sidebarBtn) sidebarBtn.onclick = () => App.Session.toggleSidebar();
  const themeBtn = App.$('#themeToggle');
  if (themeBtn) themeBtn.onclick = () => App.Session.toggleTheme();

  App.Network.bind();
  App.ErrorHandler.bind();
  App.Shortcuts.bind();

  window.addEventListener('resize', App._throttle(() => App.emit('window:resize'), 200));

  App.render();

  // Restore last visited page (defaults to 'dashboard' if none saved).
  const lastPage = App.Session.restoreLastPage();
  if (lastPage && lastPage !== 'dashboard') {
    const btn = App.$$('[data-view]').find(b => b.dataset.view === lastPage);
    if (btn) App.navigate(lastPage, btn.textContent);
  }

  App.Loading.wrap(() => App.Supabase.load());

  if (sessionStorage.getItem(App.AUTH_KEY) === 'yes') App.SessionTimeout.start();
});

} // end init guard
