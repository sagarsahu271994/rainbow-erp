/**
 * App.Auth — Rainbow ERP authentication module. Authentication ONLY — no
 * Dashboard/Student/Fee logic anywhere in this file.
 *
 * HONESTY NOTE: this still checks credentials against the same client-side
 * App.AUTH_USER / App.AUTH_PASS constants defined in utils.js (unchanged —
 * this file doesn't touch utils.js). That is the same security model
 * flagged earlier in this project: it protects the UI, not the data, since
 * Supabase RLS is still open. Session Expiry / Lock Screen / cross-tab sync
 * below make the UI harder to leave accidentally logged in, but this is
 * NOT a substitute for real Supabase Auth + RLS. Revisit that whenever
 * you're ready — this file is compatible with swapping the credential
 * check for a real Supabase Auth call later without changing its public
 * API (apply/login/logout), since app.js only ever calls those three.
 *
 * Compatible with the existing app.js wiring exactly as-is:
 *   App.$('#loginForm').onsubmit = e => App.Auth.login(e)
 *   App.$('#logoutBtn').onclick  = () => App.Auth.logout()
 *   document.addEventListener('DOMContentLoaded', () => App.Auth.apply())
 * Uses the existing App.AUTH_KEY / App.AUTH_USER / App.AUTH_PASS constants
 * from utils.js — does not redefine them.
 */
App.Auth = {

  /* ---------------- config ---------------- */
  SESSION_EXPIRY_KEY: 'rainbowERPSessionExpiry',
  LOCK_KEY: 'rainbowERPScreenLocked',
  SESSION_DURATION_MS: 12 * 60 * 60 * 1000,       // 12 hours for a normal login
  REMEMBER_DURATION_MS: 30 * 24 * 60 * 60 * 1000, // 30 days if "Remember Me" is checked

  /** Picks sessionStorage (tab-scoped) or localStorage (persists across tabs/restarts). */
  _storageFor(remember) { return remember ? localStorage : sessionStorage; },

  /* ================================================================
     SESSION RESTORE / SESSION EXPIRY / ROUTE GUARD
     ================================================================ */

  /** True if either storage has an active login flag (session or "remembered"). */
  isLoggedIn() {
    return sessionStorage.getItem(App.AUTH_KEY) === 'yes' || localStorage.getItem(App.AUTH_KEY) === 'yes';
  },

  /** Session Expiry check — true if no expiry was recorded (legacy/safe default) or it hasn't passed yet. */
  _expiryValid() {
    const raw = sessionStorage.getItem(this.SESSION_EXPIRY_KEY) || localStorage.getItem(this.SESSION_EXPIRY_KEY);
    if (!raw) return true;
    return Date.now() < Number(raw);
  },

  _clearSession() {
    sessionStorage.removeItem(App.AUTH_KEY);
    sessionStorage.removeItem(this.SESSION_EXPIRY_KEY);
    localStorage.removeItem(App.AUTH_KEY);
    localStorage.removeItem(this.SESSION_EXPIRY_KEY);
  },

  /**
   * Applies the current login state to the UI (Route Guard / Auth Guard):
   * toggles body.locked and the #loginScreen overlay, matching the
   * original behavior exactly. Also enforces Session Expiry on every call
   * (e.g. on page load) and keeps cross-tab logout in sync.
   * @returns {boolean} true if the app is unlocked (logged in)
   */
  apply() {
    let ok = this.isLoggedIn();
    if (ok && !this._expiryValid()) {
      this._clearSession();
      ok = false;
      if (typeof App.toast === 'function') App.toast('Session expire ho gaya. Dobara login karein.');
    }
    document.body.classList.toggle('locked', !ok);
    const screen = App.$('#loginScreen');
    if (screen) screen.style.display = ok ? 'none' : 'grid';
    if (ok) { this._bindCrossTabSync(); if (this.isLocked()) this._showLockOverlay(); }
    else { this._unbindCrossTabSync(); this._hideLockOverlay(); }
    return ok;
  },

  /**
   * Route/Auth Guard helper other code can call before doing something
   * that requires an active session. Re-applies UI state if not authed.
   * @param {Function} [onAuthed]
   * @returns {boolean}
   */
  requireAuth(onAuthed) {
    const ok = this.isLoggedIn() && this._expiryValid();
    if (ok) { if (typeof onAuthed === 'function') onAuthed(); return true; }
    this.apply();
    return false;
  },

  /* ================================================================
     LOGIN / LOGOUT / REMEMBER LOGIN
     ================================================================ */

  /**
   * @param {SubmitEvent} e #loginForm submit event
   * @returns {boolean} true on successful login
   */
  login(e) {
    e.preventDefault();
    const form = e.target;
    const data = App.formData(form);
    // Remember Me is optional — only used if a checkbox named "remember"
    // exists on the form. index.html doesn't have one yet; this stays
    // inert (defaults to session-only login) until it does.
    const remember = !!(form.elements.remember && form.elements.remember.checked);

    if (data.username !== App.AUTH_USER || data.password !== App.AUTH_PASS) {
      const err = App.$('#loginError');
      if (err) err.classList.add('show');
      return false;
    }

    const store = this._storageFor(remember);
    const other = remember ? sessionStorage : localStorage;
    store.setItem(App.AUTH_KEY, 'yes');
    store.setItem(this.SESSION_EXPIRY_KEY, String(Date.now() + (remember ? this.REMEMBER_DURATION_MS : this.SESSION_DURATION_MS)));
    // Clear the other storage so a stale flag there can't cause conflicting state later.
    other.removeItem(App.AUTH_KEY);
    other.removeItem(this.SESSION_EXPIRY_KEY);

    const err = App.$('#loginError');
    if (err) err.classList.remove('show');
    this.apply();
    if (typeof App.toast === 'function') App.toast('Login successful');
    return true;
  },

  logout() {
    this._clearSession();
    sessionStorage.removeItem(this.LOCK_KEY);
    this.apply();
    if (typeof App.toast === 'function') App.toast('Logged out');
  },

  /* ================================================================
     LOCK SCREEN / UNLOCK SCREEN
     Distinct from logout: session data stays intact, only the UI is
     hidden behind a password prompt. Useful for "step away from desk"
     without ending the session or losing unsaved form state. The overlay
     is created at runtime (no index.html/styles.css edits) the same way
     Loading/Modal helpers elsewhere in this app already do.
     ================================================================ */

  isLocked() { return sessionStorage.getItem(this.LOCK_KEY) === 'yes'; },

  lock() {
    if (!this.isLoggedIn()) return;
    sessionStorage.setItem(this.LOCK_KEY, 'yes');
    this._showLockOverlay();
  },

  /**
   * @param {string} [password] required unless silent=true
   * @param {boolean} [silent] true for programmatic unlock (e.g. from logout()), skips the password check
   * @returns {boolean}
   */
  unlock(password, silent) {
    if (!silent && password !== App.AUTH_PASS) {
      if (typeof App.toast === 'function') App.toast('Galat password.');
      return false;
    }
    sessionStorage.removeItem(this.LOCK_KEY);
    this._hideLockOverlay();
    return true;
  },

  _showLockOverlay() {
    let el = document.getElementById('rainbowLockScreen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rainbowLockScreen';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.style.cssText = 'position:fixed;inset:0;background:rgba(10,14,20,.92);display:flex;align-items:center;justify-content:center;z-index:10000;';
      el.innerHTML = '<form id="rainbowLockForm" style="background:#fff;padding:24px;border-radius:10px;min-width:260px;display:flex;flex-direction:column;gap:10px;box-shadow:0 10px 30px rgba(0,0,0,.3);">'
        + '<h3 style="margin:0;">Screen Locked</h3>'
        + '<input type="password" id="rainbowLockPassword" placeholder="Password" autocomplete="current-password" required style="padding:8px;border:1px solid #ccc;border-radius:6px;">'
        + '<div id="rainbowLockError" style="color:#c62828;font-size:13px;display:none;">Galat password.</div>'
        + '<button type="submit" style="padding:8px;border-radius:6px;">Unlock</button>'
        + '</form>';
      document.body.appendChild(el);
      el.querySelector('#rainbowLockForm').onsubmit = ev => {
        ev.preventDefault();
        const input = document.getElementById('rainbowLockPassword');
        const errBox = document.getElementById('rainbowLockError');
        const ok = this.unlock(input.value);
        if (ok) { input.value = ''; if (errBox) errBox.style.display = 'none'; }
        else if (errBox) errBox.style.display = 'block';
      };
    }
    el.style.display = 'flex';
    const input = document.getElementById('rainbowLockPassword');
    if (input) setTimeout(() => input.focus(), 0);
  },

  _hideLockOverlay() {
    const el = document.getElementById('rainbowLockScreen');
    if (el) el.style.display = 'none';
  },

  /* ================================================================
     CROSS-TAB SYNC — if the user logs out (or the session expires) in
     one tab, every other open tab re-applies the guard immediately
     instead of silently staying "logged in" until its next reload.
     ================================================================ */
  _storageListener: null,
  _bindCrossTabSync() {
    if (this._storageListener) return;
    this._storageListener = e => {
      if (e.key === App.AUTH_KEY || e.key === this.SESSION_EXPIRY_KEY) this.apply();
    };
    window.addEventListener('storage', this._storageListener);
  },
  _unbindCrossTabSync() {
    if (this._storageListener) {
      window.removeEventListener('storage', this._storageListener);
      this._storageListener = null;
    }
  }

};
