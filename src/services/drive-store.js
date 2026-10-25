/* File durable locale : uniquement paquets chiffrés, reçus et métadonnées.
 * Aucun effacement automatique. Les copies avant fusion sont immuables.
 * L'appelant doit tenir navigator.locks pendant lecture/modification/écriture.
 */
const DriveStore = (() => {
  function create(name, indexedDB = globalThis.indexedDB) {
    let opening, active;
    function open() {
      if (!opening) opening = new Promise((resolve, reject) => {
        if (!indexedDB) return reject(new Error('stockage'));
        const r = indexedDB.open(name, 1);
        let invalid = false;
        const failure = () => { invalid = true; reject(new Error('stockage')); };
        r.onupgradeneeded = () => { r.result.createObjectStore('state'); r.result.createObjectStore('recovery'); };
        r.onerror = failure;
        // Blocked opens may eventually complete: close a late connection from a rejected attempt.
        r.onblocked = failure;
        r.onsuccess = () => {
          const db = r.result;
          if (invalid) { db.close(); return; }
          active = db;
          const invalidate = () => { if (active === db) { active = null; opening = null; } };
          db.onversionchange = () => { db.close(); invalidate(); };
          db.onclose = invalidate;
          resolve(db);
        };
      }).catch(error => { opening = null; throw error; });
      return opening;
    }
    function transaction(db, store, mode) {
      try { return db.transaction(store, mode); }
      catch { opening = null; if (active === db) active = null; throw new Error('stockage'); }
    }
    async function read(store, key) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = transaction(db, store, 'readonly'), request = tx.objectStore(store).get(key); let value;
        request.onsuccess = () => { value = request.result; };
        tx.oncomplete = () => resolve(value ?? null); tx.onabort = tx.onerror = () => reject(new Error('stockage'));
      });
    }
    async function write(value) {
      const expected = structuredClone(value);
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = transaction(db, 'state', 'readwrite'); tx.objectStore('state').put(expected, 'current');
        tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(new Error('stockage'));
      });
      // Comparer les octets sans les convertir en une immense liste JSON.
      const same = (a, b, depth = 0) => {
        if (depth > 32) return false;
        if (a instanceof Uint8Array) return b instanceof Uint8Array && a.length === b.length && a.every((v, i) => v === b[i]);
        if (a && typeof a === 'object') {
          if (!b || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
          const names = Object.keys(a); return names.length === Object.keys(b).length && names.every(k => Object.hasOwn(b, k) && same(a[k], b[k], depth + 1));
        }
        return a === b;
      };
      if (!same(expected, await read('state', 'current'))) throw new Error('stockage');
    }
    async function recovery(bytes, crypto = globalThis.crypto) {
      const copy = bytes.slice(), hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy))].map(x => x.toString(16).padStart(2, '0')).join('');
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = transaction(db, 'recovery', 'readwrite'), store = tx.objectStore('recovery'), r = store.get(hash);
        r.onsuccess = () => { if (r.result == null) store.add(copy, hash); };
        tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(new Error('stockage'));
      });
      const back = await read('recovery', hash);
      if (!(back instanceof Uint8Array) || back.length !== copy.length || back.some((v, i) => v !== copy[i])) throw new Error('stockage');
      await new Promise((resolve, reject) => {
        const tx = transaction(db, 'state', 'readwrite'); tx.objectStore('state').put(hash, 'recovery-latest');
        tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(new Error('stockage'));
      });
      return hash;
    }
    return Object.freeze({ read: () => read('state', 'current'), write, recovery, readRecovery: hash => read('recovery', hash),
      latestRecovery: async () => { const hash = await read('state', 'recovery-latest'); return hash ? read('recovery', hash) : null; } });
  }
  return Object.freeze({ create });
})();

export { DriveStore };
