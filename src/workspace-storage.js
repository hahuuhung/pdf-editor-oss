// IndexedDB Workspace Storage for Auto-Save Drafts & MRU Recent Files.
// Security invariant: NEVER persists password-encrypted source PDFs or documents with userPassword set.
// Includes an in-memory adapter fallback when IndexedDB is unavailable (e.g. Node unit tests or private mode).

export const MAX_RECENT_FILES = 8;
export const MAX_PERSISTED_FILE_BYTES = 45 * 1024 * 1024; // 45 MB per file cap

const DB_NAME = 'pdfEditorProWorkspace';
const DB_VERSION = 1;
const STORE_KV = 'kv';
const KEY_DRAFT = 'activeDraft';
const KEY_RECENTS = 'recentFiles';

// Security & quota guard: strictly rejects encrypted files, password-protected settings, and oversized files.
export function shouldAutoSaveSession({
  pdfBytes,
  isEncryptedSource = false,
  settings = null,
  maxBytes = MAX_PERSISTED_FILE_BYTES,
} = {}) {
  if (!pdfBytes || !(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) return false;
  if (pdfBytes.byteLength > maxBytes) return false;
  if (isEncryptedSource) return false;
  if (settings?.protection?.userPassword) return false;
  return true;
}

export function formatFileSize(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeTimeVi(timestampMs, nowMs = Date.now()) {
  const diffSec = Math.max(0, Math.floor((nowMs - Number(timestampMs || 0)) / 1000));
  if (diffSec < 60) return 'Vừa xong';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

// Pure in-memory KV backend used in Node tests and restricted browsing contexts.
export function createMemoryKvBackend() {
  const map = new Map();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async del(key) {
      map.delete(key);
    },
    async clear() {
      map.clear();
    },
  };
}

// Browser IndexedDB KV backend.
export function createIndexedDbKvBackend(dbName = DB_NAME, version = DB_VERSION) {
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = globalThis.indexedDB.open(dbName, version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function runTx(mode, op) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_KV, mode);
      const store = tx.objectStore(STORE_KV);
      const req = op(store);
      tx.oncomplete = () => resolve(req?.result ?? null);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    get: (key) => runTx('readonly', (s) => s.get(key)),
    set: (key, value) => runTx('readwrite', (s) => s.put(value, key)),
    del: (key) => runTx('readwrite', (s) => s.delete(key)),
    clear: () => runTx('readwrite', (s) => s.clear()),
  };
}

export function createWorkspaceStorage({
  backend = typeof globalThis.indexedDB !== 'undefined' ? createIndexedDbKvBackend() : createMemoryKvBackend(),
  maxRecents = MAX_RECENT_FILES,
  maxBytes = MAX_PERSISTED_FILE_BYTES,
} = {}) {
  async function saveDraft({
    fileName = 'document.pdf',
    pdfBytes,
    boxes = [],
    marks = [],
    settings = {},
    pageCount = 1,
    isEncryptedSource = false,
    savedAt = Date.now(),
  } = {}) {
    if (!shouldAutoSaveSession({ pdfBytes, isEncryptedSource, settings, maxBytes })) {
      await backend.del(KEY_DRAFT).catch(() => {});
      return false;
    }
    const cleanSettings = { ...settings, protection: null };
    await backend.set(KEY_DRAFT, {
      fileName: String(fileName || 'document.pdf'),
      pdfBytes: pdfBytes.slice(),
      boxes: structuredClone(boxes),
      marks: structuredClone(marks),
      settings: structuredClone(cleanSettings),
      pageCount: Math.max(1, Number(pageCount) || 1),
      savedAt,
    });
    return true;
  }

  async function loadDraft() {
    try {
      const draft = await backend.get(KEY_DRAFT);
      if (!draft || !(draft.pdfBytes instanceof Uint8Array)) return null;
      return draft;
    } catch {
      return null;
    }
  }

  async function clearDraft() {
    try {
      await backend.del(KEY_DRAFT);
    } catch {
      // Ignore storage access errors
    }
  }

  async function listRecentFiles() {
    try {
      const list = await backend.get(KEY_RECENTS);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  async function addRecentFile({
    fileName,
    pdfBytes,
    pageCount = 1,
    isEncryptedSource = false,
    settings = null,
    openedAt = Date.now(),
  } = {}) {
    if (!shouldAutoSaveSession({ pdfBytes, isEncryptedSource, settings, maxBytes })) {
      return false;
    }
    const cleanName = String(fileName || 'document.pdf').trim() || 'document.pdf';
    const current = await listRecentFiles();
    const id = `${cleanName.toLowerCase()}::${pdfBytes.byteLength}`;
    const filtered = current.filter((item) => item.id !== id && item.fileName.toLowerCase() !== cleanName.toLowerCase());
    const next = [
      {
        id,
        fileName: cleanName,
        byteLength: pdfBytes.byteLength,
        pageCount: Math.max(1, Number(pageCount) || 1),
        openedAt,
        pdfBytes: pdfBytes.slice(),
      },
      ...filtered,
    ].slice(0, maxRecents);

    await backend.set(KEY_RECENTS, next);
    return true;
  }

  async function removeRecentFile(id) {
    const current = await listRecentFiles();
    const next = current.filter((item) => item.id !== id);
    await backend.set(KEY_RECENTS, next);
    return next;
  }

  async function clearAll() {
    await backend.clear();
  }

  return {
    saveDraft,
    loadDraft,
    clearDraft,
    listRecentFiles,
    addRecentFile,
    removeRecentFile,
    clearAll,
  };
}

// Debounced scheduler for non-blocking background auto-saves.
export function createAutoSaveScheduler(taskFn, delayMs = 2000) {
  let timer = null;

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule() {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      Promise.resolve().then(() => taskFn());
    }, delayMs);
  }

  async function flush() {
    cancel();
    return taskFn();
  }

  return { schedule, cancel, flush };
}
