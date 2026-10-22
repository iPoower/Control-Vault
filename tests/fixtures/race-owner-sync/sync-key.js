/* Clé de synchronisation Race Control — lot D1, non assemblée dans la PWA.
 * Le codec V1 dérive sa clé du code à chaque paquet ; une session mémorisée
 * reprend pourtant sans code. Ici, un descripteur PUBLIC de compte (identifiant
 * aléatoire, sel stable, contrôle GCM) permet de dériver UNE fois la clé au
 * moment où le code est saisi. La clé AES-256-GCM est non extractible et
 * conservée en IndexedDB jusqu'à l'expiration de la session authentifiée.
 * Jamais le code, une clé brute ou une donnée déchiffrée dans un stockage.
 * Limite : un script de même origine peut utiliser la clé tant qu'elle vit,
 * comme la clé du coffre mémorisée. Verrouiller révoque toutes les clés.
 */
'use strict';
const SyncKey = (() => {
  const FORMAT = 'race-control-sync-key', ITERATIONS = 600000, KDF = 'PBKDF2-SHA256';
  const CHECK = 'race-control-sync-key-check-v1', NAME = 'twrc.sync-key.v1', STORE = 'records';
  const MAX_MS = 7 * 24 * 60 * 60 * 1000, MAX_BYTES = 2048;
  const te = new TextEncoder();
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const fields = (v, keys) => Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
  const iso = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  const encode = b => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
  function decode(v, size) {
    if (typeof v !== 'string' || v.length !== 4 * Math.ceil(size / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return fail('INVALID_ENVELOPE');
    let raw;
    try { raw = atob(v); } catch { return fail('INVALID_ENVELOPE'); }
    if (raw.length !== size || btoa(raw) !== v) return fail('INVALID_ENVELOPE');
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  const aad = d => te.encode(JSON.stringify([FORMAT, 1, d.keyId, d.createdAt, KDF, ITERATIONS, d.s, d.check.i]));
  const binding = b => b === 'device' || (typeof b === 'string' && /^tab:[0-9a-f]{32}$/.test(b));

  // Toute la forme est contrôlée avant PBKDF2 : un descripteur hostile ne coûte rien.
  function validate(d) {
    if (!object(d) || d.format !== FORMAT) return fail('UNSUPPORTED_FORMAT');
    if (d.schemaVersion !== 1) return fail('UNSUPPORTED_SCHEMA');
    if (!fields(d, ['format', 'schemaVersion', 'keyId', 'createdAt', 'kdf', 'it', 's', 'check']) ||
      typeof d.keyId !== 'string' || !/^[0-9a-f]{32}$/.test(d.keyId) || !iso(d.createdAt) ||
      d.kdf !== KDF || d.it !== ITERATIONS || !object(d.check) || !fields(d.check, ['i', 'c'])) return fail('INVALID_ENVELOPE');
    return { salt: decode(d.s, 16), iv: decode(d.check.i, 12), cipher: decode(d.check.c, te.encode(CHECK).length + 16) };
  }
  // Octets lus depuis un fournisseur : JSON strict partagé avec le codec (BOM, doublons, profondeur).
  function parse(bytes, packet = typeof ControlVaultPacket === 'undefined' ? null : ControlVaultPacket) {
    if (!(bytes instanceof Uint8Array)) return fail('MALFORMED_FILE');
    if (bytes.length > MAX_BYTES) return fail('FILE_TOO_LARGE');
    if (!packet || typeof packet.strictJson !== 'function') return fail('MALFORMED_FILE');
    const d = packet.strictJson(bytes.slice(), 2);
    validate(d);
    return d;
  }
  function usable(key) {
    return !!key && key.type === 'secret' && key.extractable === false && key.algorithm && key.algorithm.name === 'AES-GCM' &&
      key.algorithm.length === 256 && Array.isArray(key.usages) && ['encrypt', 'decrypt'].every(u => key.usages.includes(u));
  }
  async function confirm(d, parts, key, crypto) {
    let plain;
    try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: parts.iv, additionalData: aad(d), tagLength: 128 }, key, parts.cipher)); }
    catch { return false; }
    const expected = te.encode(CHECK), ok = plain.length === expected.length && plain.every((x, i) => x === expected[i]);
    plain.fill(0);
    return ok;
  }
  const handle = (d, key) => Object.freeze({ key, keyId: d.keyId, s: d.s });
  async function deriveKey(code, salt, crypto) {
    if (typeof code !== 'string' || !code.length || code.length > 1024) return fail('AUTHENTICATION_FAILED');
    const bytes = te.encode(code);
    try {
      const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
      return await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    } finally { bytes.fill(0); }
  }
  // Premier appareil du compte : le descripteur ne contient aucun secret et peut être publié.
  async function create(code, crypto = globalThis.crypto, createdAt = new Date().toISOString()) {
    if (!iso(createdAt)) return fail('INVALID_ENVELOPE');
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const d = { format: FORMAT, schemaVersion: 1, keyId: hex(crypto.getRandomValues(new Uint8Array(16))), createdAt,
      kdf: KDF, it: ITERATIONS, s: encode(salt), check: { i: encode(iv), c: '' } };
    const key = await deriveKey(code, salt, crypto);
    d.check.c = encode(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(d), tagLength: 128 }, key, te.encode(CHECK))));
    if (!await confirm(d, validate(d), key, crypto)) return fail('CONSERVATION_BLOCKED');
    return { descriptor: d, handle: handle(d, key) };
  }
  // Saisie du code sur un appareil : un mauvais code est refusé AVANT toute mémorisation.
  async function derive(d, code, crypto = globalThis.crypto) {
    const parts = validate(d), key = await deriveKey(code, parts.salt, crypto);
    if (!await confirm(d, parts, key, crypto)) return fail('AUTHENTICATION_FAILED');
    return handle(d, key);
  }

  function storage(idb) {
    function connect() {
      return new Promise((resolve, reject) => {
        if (!idb) { reject(new Error('IndexedDB indisponible')); return; }
        let req;
        try { req = idb.open(NAME, 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Ouverture IndexedDB impossible'));
        req.onblocked = () => reject(new Error('IndexedDB occupé'));
      });
    }
    async function record(mode, action) {
      const db = await connect();
      return new Promise((resolve, reject) => {
        let result;
        try {
          const tx = db.transaction(STORE, mode);
          tx.oncomplete = () => { db.close(); resolve(result); };
          tx.onabort = () => { db.close(); reject(tx.error || new Error('Opération IndexedDB annulée')); };
          tx.onerror = () => { /* onabort porte l'erreur finale */ };
          const req = action(tx.objectStore(STORE));
          if (req) { req.onsuccess = () => { result = req.result; }; req.onerror = () => { /* onabort */ }; }
        } catch (e) { db.close(); reject(e); }
      });
    }
    const slot = b => 'sync:' + b;
    const sweep = (s, keep, now) => {
      const cursor = s.openCursor();
      cursor.onsuccess = () => { const row = cursor.result; if (!row) return;
        if (String(row.key).startsWith('sync:') && row.key !== keep && !(Number.isSafeInteger(row.value && row.value.e) && row.value.e > now)) row.delete();
        row.continue();
      };
    };
    return {
      // La durée est celle de la session authentifiée qui a reçu le code, 7 jours au plus.
      async remember(h, b, expiresAt, now = Date.now()) {
        if (!binding(b) || !object(h) || !usable(h.key) || !/^[0-9a-f]{32}$/.test(h.keyId || '') ||
          !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt - now > MAX_MS) return fail('CONSERVATION_BLOCKED');
        decode(h.s, 16);
        await record('readwrite', s => { sweep(s, slot(b), now); return s.put({ v: 1, keyId: h.keyId, s: h.s, key: h.key, a: now, e: expiresAt }, slot(b)); });
        return expiresAt;
      },
      // Reprise sans code : la clé doit encore ouvrir le contrôle du descripteur courant.
      async resume(d, b, crypto = globalThis.crypto, now = Date.now()) {
        if (!binding(b)) return null;
        let parts;
        try { parts = validate(d); } catch { return null; }
        let item;
        try { item = await record('readonly', s => s.get(slot(b))); } catch { return null; }
        if (!item) return null;
        const valid = item.v === 1 && item.keyId === d.keyId && item.s === d.s && Number.isSafeInteger(item.a) &&
          Number.isSafeInteger(item.e) && item.e - item.a <= MAX_MS && now >= item.a && now < item.e && usable(item.key);
        if (!valid || !await confirm(d, parts, item.key, crypto)) {
          // Une clé d'un autre compte ou d'un ancien code n'est jamais réutilisée.
          await record('readwrite', s => s.delete(slot(b))).catch(() => {});
          return null;
        }
        return handle(d, item.key);
      },
      async revoke(b) {
        if (b === undefined) return record('readwrite', s => {
          const cursor = s.openCursor();
          cursor.onsuccess = () => { const row = cursor.result; if (!row) return; if (String(row.key).startsWith('sync:')) row.delete(); row.continue(); };
        });
        if (binding(b)) return record('readwrite', s => s.delete(slot(b)));
      }
    };
  }
  return Object.freeze({ FORMAT, MAX_MS, validate, parse, create, derive, storage: (idb = globalThis.indexedDB) => storage(idb) });
})();
