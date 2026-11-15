// Minimaler IndexedDB-Key-Value-Speicher für Projekt und Foto.
const DB = 'mosaik-studio', STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}

export const kvGet = key => tx('readonly', s => s.get(key));
export const kvSet = (key, value) => tx('readwrite', s => s.put(value, key));
export const kvDel = key => tx('readwrite', s => s.delete(key));
