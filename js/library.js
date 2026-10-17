/*
 * Recent files and reading progress, kept only in this browser.
 * Files are recognised by a fingerprint of their contents, so the same PDF/Word file
 * resumes where you stopped even after renaming or uploading it again.
 * Copies of recent files are stored in IndexedDB so they can be reopened from the home page.
 */
const Library = (() => {
  const LIST_KEY = 'sunotes.library';
  const DB_NAME = 'sunotes';
  const STORE = 'files';
  const MAX_FILES = 6;
  const MAX_BYTES = 60 * 1024 * 1024; // larger files keep their progress but aren't stored

  /* ---------- Entries (localStorage) ---------- */
  function list() {
    try {
      const v = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      return Array.isArray(v) ? v.sort((a, b) => b.updatedAt - a.updatedAt) : [];
    } catch { return []; }
  }

  function saveList(items) {
    try { localStorage.setItem(LIST_KEY, JSON.stringify(items)); } catch { /* storage full or unavailable */ }
  }

  function get(id) { return list().find(e => e.id === id) || null; }

  function update(id, patch) {
    const items = list();
    const e = items.find(x => x.id === id);
    if (!e) return null;
    Object.assign(e, patch, { updatedAt: Date.now() });
    saveList(items);
    return e;
  }

  /* ---------- File copies (IndexedDB) ---------- */
  let dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('no IndexedDB')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(err => { dbPromise = null; throw err; });
    return dbPromise;
  }

  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  /* ---------- Public API ---------- */
  async function fingerprint(buffer, name) {
    try {
      const hash = await crypto.subtle.digest('SHA-256', buffer);
      return [...new Uint8Array(hash)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return `n-${buffer.byteLength}-${name}`; // crypto.subtle needs https or localhost
    }
  }

  /** Add or refresh a file in the recent list. `blob` is a copy of the file to store (optional). */
  async function remember(meta, blob) {
    const items = list();
    let e = items.find(x => x.id === meta.id);
    if (!e) {
      e = { idx: 0, total: 0, page: 0, pages: 0, stored: false, ...meta };
      items.unshift(e);
    }
    Object.assign(e, { name: meta.name, kind: meta.kind, size: meta.size, updatedAt: Date.now() });

    // Keep only the most recent files.
    const sorted = items.sort((a, b) => b.updatedAt - a.updatedAt);
    const dropped = sorted.splice(MAX_FILES);
    saveList(sorted);
    dropped.forEach(d => { if (d.stored) tx('readwrite', s => s.delete(d.id)).catch(() => {}); });

    if (blob && !e.stored && blob.size <= MAX_BYTES) {
      try {
        await tx('readwrite', s => s.put(blob, meta.id));
        update(meta.id, { stored: true });
      } catch { /* private mode or quota: progress still works, reopening needs the file */ }
    }
  }

  function saveProgress(id, progress) { update(id, progress); }

  async function loadFile(id) {
    try {
      const blob = await tx('readonly', s => s.get(id));
      return blob ? await blob.arrayBuffer() : null;
    } catch { return null; }
  }

  async function remove(id) {
    saveList(list().filter(e => e.id !== id));
    try { await tx('readwrite', s => s.delete(id)); } catch { /* nothing stored */ }
  }

  /** "just now", "5 min ago", "yesterday", "3 days ago" */
  function ago(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    const d = Math.floor(s / 86400);
    return d === 1 ? 'yesterday' : `${d} days ago`;
  }

  return { fingerprint, remember, get, list, saveProgress, loadFile, remove, ago };
})();
