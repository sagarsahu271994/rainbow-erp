/**
 * storage.js
 * Contains TWO independent modules that share this file only because
 * index.html already loads storage.js once — nothing else was changed:
 *
 *   1. App.Storage    — UNCHANGED. Supabase Storage (PDF/photo/document
 *                        uploads). Still used by pdf.js, admission.js,
 *                        supabase.js exactly as before.
 *   2. App.LocalCache — NEW. Pure localStorage/sessionStorage utility.
 *                        No Supabase, no UI, no business logic — just
 *                        save/load/delete/cache/session/theme/sidebar/
 *                        last-page/search-history/filters/offline-queue/
 *                        preferences primitives that any module can use.
 */

/* ================================================================
   App.Storage — UNCHANGED (Supabase Storage for PDFs/photos/documents)
   ================================================================ */
App.Storage = {
  bucket() { return App.db.settings.storageBucket || "documents"; },
  client() { return App.Supabase.get(); },
  path(type, item, file) {
    const folder = type === "admission" ? "admissions" : type === "fees" ? "receipts" : "students";
    const id = App.fileName(item.id || item.admissionId || item.receiptNo || App.uid());
    return folder + "/" + id + "-" + App.fileName(file);
  },
  async upload(type, item, blob, file) {
    const c = this.client();
    if (!c || !blob) return null;
    const p = this.path(type, item, file);
    const r = await c.storage.from(this.bucket()).upload(p, blob, { contentType: "application/pdf", upsert: true });
    if (r.error) throw r.error;
    const url = c.storage.from(this.bucket()).getPublicUrl(p).data.publicUrl;
    item.pdfUrl = url;
    item.pdfPath = p;
    item.sharedAt = new Date().toISOString();
    await App.Supabase.updatePdf(type, item);
    App.saveLocal();
    return url;
  },
  async remove(p) {
    const c = this.client();
    if (!c || !p) return;
    await c.storage.from(this.bucket()).remove([p]);
  }
};

/* ================================================================
   App.LocalCache — NEW. localStorage/sessionStorage only. No Supabase,
   no UI, no business logic — every method here is a pure storage
   primitive that other modules can call, never the other way around.
   ================================================================ */
App.LocalCache = {

  /* ---------------- namespacing / versioning ---------------- */
  PREFIX: 'rainbowERPCache:',
  VERSION_KEY: 'rainbowERPCacheVersion',
  CACHE_VERSION: 1,

  /** Wipes the entire cache namespace whenever CACHE_VERSION changes, so
   * a code deploy can safely invalidate stale cached shapes. */
  _ensureVersion() {
    const stored = localStorage.getItem(this.VERSION_KEY);
    if (String(stored) !== String(this.CACHE_VERSION)) {
      this.clearCache();
      try { localStorage.setItem(this.VERSION_KEY, String(this.CACHE_VERSION)); } catch (e) { /* quota — ignore */ }
    }
  },

  /* ---------------- generic Save / Load / Delete (localStorage) ---------------- */
  /** @param {string} key @param {*} value JSON-serializable @returns {boolean} */
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.warn('App.LocalCache.set failed for "' + key + '"', e); return false; }
  },
  /** @param {string} key @param {*} [fallback] @returns {*} */
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  /** @param {string} key @returns {boolean} */
  delete(key) {
    try { localStorage.removeItem(key); return true; }
    catch (e) { return false; }
  },
  /** @param {string} key @returns {boolean} */
  has(key) { return localStorage.getItem(key) !== null; },

  /* ---------------- Cache (namespaced, with expiry) ---------------- */
  /** @param {string} key @param {*} value @param {number} [ttlMs] omit for no expiry */
  setCache(key, value, ttlMs) {
    this._ensureVersion();
    return this.set(this.PREFIX + key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : null });
  },
  /** @param {string} key @returns {*} null if missing or expired */
  getCache(key) {
    this._ensureVersion();
    const record = this.get(this.PREFIX + key, null);
    if (!record) return null;
    if (record.expiresAt && Date.now() > record.expiresAt) { this.deleteCache(key); return null; }
    return record.value;
  },
  deleteCache(key) { return this.delete(this.PREFIX + key); },
  /** Removes every cached entry (not other localStorage keys). */
  clearCache() {
    Object.keys(localStorage).filter(k => k.indexOf(this.PREFIX) === 0).forEach(k => localStorage.removeItem(k));
  },

  /* ---------------- Session (sessionStorage — cleared on tab close) ---------------- */
  setSession(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  },
  getSession(key, fallback = null) {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  deleteSession(key) {
    try { sessionStorage.removeItem(key); return true; }
    catch (e) { return false; }
  },

  /**
   * Keys deliberately match what App.Session (app.js) already uses for
   * theme/sidebar/last-page/filters — App.LocalCache is a second access
   * point onto the SAME stored values, not a competing copy of them.
   */
  KEYS: {
    theme: 'rainbowERPTheme',
    sidebar: 'rainbowERPSidebarCollapsed',
    lastPage: 'rainbowERPLastPage',
    filters: 'rainbowERPFilters',
    searchHistory: 'rainbowERPSearchHistory',
    preferences: 'rainbowERPLocalPreferences'
  },

  /* ---------------- Theme ---------------- */
  getTheme(fallback = 'light') { return localStorage.getItem(this.KEYS.theme) || fallback; },
  setTheme(theme) {
    try { localStorage.setItem(this.KEYS.theme, theme); return true; }
    catch (e) { return false; }
  },

  /* ---------------- Sidebar State ---------------- */
  getSidebarCollapsed() { return localStorage.getItem(this.KEYS.sidebar) === 'yes'; },
  setSidebarCollapsed(collapsed) {
    try { localStorage.setItem(this.KEYS.sidebar, collapsed ? 'yes' : 'no'); return true; }
    catch (e) { return false; }
  },

  /* ---------------- Last Page ---------------- */
  getLastPage(fallback = 'dashboard') { return localStorage.getItem(this.KEYS.lastPage) || fallback; },
  setLastPage(view) {
    if (!view) return false;
    try { localStorage.setItem(this.KEYS.lastPage, view); return true; }
    catch (e) { return false; }
  },

  /* ---------------- Filters ---------------- */
  getFilters(fallback = {}) { return this.get(this.KEYS.filters, fallback); },
  setFilters(filters) { return this.set(this.KEYS.filters, filters || {}); },

  /* ---------------- Search History (per view, most-recent-first, capped) ---------------- */
  MAX_SEARCH_HISTORY: 10,
  /** @param {string} view e.g. 'students' | 'admission' | 'fees' | 'attendance' */
  getSearchHistory(view) {
    const all = this.get(this.KEYS.searchHistory, {});
    return all[view] || [];
  },
  addSearchHistory(view, term) {
    if (!view || !term || !String(term).trim()) return;
    const all = this.get(this.KEYS.searchHistory, {});
    const list = (all[view] || []).filter(t => t !== term);
    list.unshift(term);
    all[view] = list.slice(0, this.MAX_SEARCH_HISTORY);
    this.set(this.KEYS.searchHistory, all);
  },
  clearSearchHistory(view) {
    const all = this.get(this.KEYS.searchHistory, {});
    if (view) { delete all[view]; this.set(this.KEYS.searchHistory, all); }
    else this.delete(this.KEYS.searchHistory);
  },

  /* ---------------- Local Preferences ----------------
     UI-only preferences (e.g. "compact table view", "default page size").
     Deliberately separate from App.db.settings, which is business/school
     data synced to Supabase — these never leave the browser. */
  getPreference(key, fallback = null) {
    const all = this.get(this.KEYS.preferences, {});
    return key in all ? all[key] : fallback;
  },
  setPreference(key, value) {
    const all = this.get(this.KEYS.preferences, {});
    all[key] = value;
    return this.set(this.KEYS.preferences, all);
  },
  clearPreferences() { this.delete(this.KEYS.preferences); },

  /* ---------------- Generic named Offline Queue ----------------
     Storage primitives only — no retry/sync logic, no knowledge of what's
     inside a queued item. A module (e.g. Fees, Admission) owns the actual
     retry behavior; this just persists/lists/removes queued payloads. */
  queueKey(name) { return 'rainbowERPQueue:' + name; },
  queuePush(name, item) {
    const key = this.queueKey(name);
    const list = this.get(key, []);
    list.push({ ...item, queuedAt: Date.now() });
    this.set(key, list);
  },
  queueList(name) { return this.get(this.queueKey(name), []); },
  queueRemoveAt(name, index) {
    const key = this.queueKey(name);
    const list = this.get(key, []);
    if (index < 0 || index >= list.length) return;
    list.splice(index, 1);
    this.set(key, list);
  },
  queueClear(name) { this.delete(this.queueKey(name)); }

};
