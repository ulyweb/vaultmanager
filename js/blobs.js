/* Binary storage for encrypted attachments. The vault record in localStorage stays small; each
   attachment is encrypted separately (see Session.sealBlob) and kept in IndexedDB. What is stored
   here is always ciphertext. Falls back to memory when IndexedDB is unavailable (private mode / tests). */

export function memoryBlobs() {
  const m = new Map();
  return { kind: 'memory', async put(k, v) { m.set(k, v); }, async get(k) { return m.get(k) || null; }, async del(k) { m.delete(k); }, async keys() { return [...m.keys()]; } };
}

export function idbBlobs(dbName = 'vaultmanager-blobs') {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('IndexedDB unavailable'));
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('blobs', mode); const store = t.objectStore('blobs');
      const req = fn(store);
      t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted'));
    });
  };
  return {
    kind: 'indexeddb',
    put: (k, v) => tx('readwrite', (s) => s.put(v, k)),
    get: async (k) => (await tx('readonly', (s) => s.get(k))) || null,
    del: (k) => tx('readwrite', (s) => s.delete(k)),
    keys: async () => (await tx('readonly', (s) => s.getAllKeys())) || [],
  };
}

export function createBlobStore() {
  try { if (typeof indexedDB !== 'undefined') return idbBlobs(); } catch { /* fall through */ }
  return memoryBlobs();
}
