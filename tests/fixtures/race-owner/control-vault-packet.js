/* Contrat INTEGRATION V1 — codec propriétaire Race Control, non activé.
 * Aucun stockage, réseau, import appliqué ou accès depuis Control Vault.
 * Le validateur métier du propriétaire est obligatoire et ne peut nettoyer
 * le contenu. La restauration transactionnelle reste une étape distincte. */
'use strict';
const ControlVaultPacket = (() => {
  const LIMITS = Object.freeze({ file: 71303168, cipher: 50331648, depth: 4 });
  const FORMAT = 'race-control-backup', ITERATIONS = 600000;
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const fields = (v, keys) => Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
  const version = v => typeof v === 'string' && /^prod-[1-9][0-9]{0,8}$/.test(v) ? Number(v.slice(5)) : null;
  const iso = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  const utf8 = v => new TextEncoder().encode(v);
  const equal = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);
  function encode64(bytes) {
    let raw = '';
    for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(raw);
  }
  function decode64(v, min, max) {
    if (typeof v !== 'string' || !v.length || v.length % 4 || v.length > 4 * Math.ceil(max / 3) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(v)) return fail('INVALID_ENCODING');
    let raw;
    try { raw = atob(v); } catch { return fail('INVALID_ENCODING'); }
    if (raw.length < min || raw.length > max || btoa(raw) !== v) return fail('INVALID_ENCODING');
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  // La profondeur et les doublons sont contrôlés avant JSON.parse. Les clés
  // échappées ont la même identité que leur représentation non échappée.
  function parse(bytes, depth) {
    if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) return fail('MALFORMED_FILE');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('MALFORMED_FILE'); }
    const frames = [];
    for (let i = 0; i < text.length;) {
      const c = text[i];
      if (c === '"') {
        const begin = i++;
        while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
        i++;
        let next = i;
        while (next < text.length && /[\t\n\r ]/.test(text[next])) next++;
        if (text[next] === ':') {
          let key;
          try { key = JSON.parse(text.slice(begin, i)); } catch { return fail('MALFORMED_FILE'); }
          const frame = frames[frames.length - 1];
          if (!frame || frame.has(key)) return fail('MALFORMED_FILE');
          frame.add(key);
        }
      } else {
        if (c === '{' || c === '[') {
          frames.push(c === '{' ? new Set() : null);
          if (frames.length > depth) return fail('MALFORMED_FILE');
        } else if (c === '}' || c === ']') frames.pop();
        i++;
      }
    }
    let value;
    try { value = JSON.parse(text); } catch { return fail('MALFORMED_FILE'); }
    function finite(v) {
      if (typeof v === 'number' && !Number.isFinite(v)) return fail('MALFORMED_FILE');
      if (v && typeof v === 'object') Object.values(v).forEach(finite);
    }
    finite(value);
    return value;
  }
  // Refuser les données que JSON.stringify modifierait silencieusement.
  function jsonTree(v, depth = 0, seen = new Set()) {
    if (depth > 64) return fail('CONSERVATION_BLOCKED');
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return;
    if (!v || typeof v !== 'object' || seen.has(v) ||
      !Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return fail('CONSERVATION_BLOCKED');
    seen.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Object.getOwnPropertySymbols(v).length || Array.isArray(v) && (Object.keys(v).length !== v.length || Object.keys(v).some((k, i) => k !== String(i)))) return fail('CONSERVATION_BLOCKED');
    for (const [key, d] of Object.entries(descriptors)) {
      if (Array.isArray(v) && key === 'length') continue;
      if (!d.enumerable || !Object.prototype.hasOwnProperty.call(d, 'value') || ['__proto__', 'prototype', 'constructor'].includes(key)) return fail('CONSERVATION_BLOCKED');
      jsonTree(d.value, depth + 1, seen);
    }
    seen.delete(v);
  }
  function loadedVersion(loadedBuild, release) {
    if (typeof loadedBuild !== 'string' || !/^[0-9a-f]{12}$/.test(loadedBuild) || !object(release) ||
      release.build !== loadedBuild || !Number.isInteger(release.run) || release.run < 1 || release.run > 999999999)
      return fail('UNKNOWN_READER_VERSION');
    return 'prod-' + release.run;
  }
  const aad = e => utf8(JSON.stringify([FORMAT, 1, e.createdAt, e.appVersion, 'AES-256-GCM', 'PBKDF2-SHA256', ITERATIONS, e.payload.s, e.payload.i]));
  function create({ validateBusiness, crypto: crypt = globalThis.crypto } = {}) {
    if (typeof validateBusiness !== 'function' || !crypt || !crypt.subtle || typeof crypt.getRandomValues !== 'function') return fail('CONSERVATION_BLOCKED');
    const hash = async bytes => [...new Uint8Array(await crypt.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    function business(bytes) {
      const data = parse(bytes, 64);
      jsonTree(data);
      if (!object(data) || data.app !== 'twrc' || ![1, 2].includes(data.v) || !object(data.settings)) return fail('CONSERVATION_BLOCKED');
      const before = JSON.stringify(data);
      try { if (validateBusiness(data) !== true || JSON.stringify(data) !== before) return fail('CONSERVATION_BLOCKED'); }
      catch { return fail('CONSERVATION_BLOCKED'); }
      return data;
    }
    async function key(pass, salt, usage) {
      if (typeof pass !== 'string' || !pass.length || pass.length > 1024) return fail('AUTHENTICATION_FAILED');
      const bytes = utf8(pass);
      try {
        const material = await crypt.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
        return await crypt.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material,
          { name: 'AES-GCM', length: 256 }, false, usage);
      } finally { bytes.fill(0); }
    }
    async function read(input, referenceHash) {
      if (!(input instanceof Uint8Array)) return fail('MALFORMED_FILE');
      if (input.byteLength > LIMITS.file) return fail('FILE_TOO_LARGE');
      const bytes = input.slice(), e = parse(bytes, LIMITS.depth);
      if (object(e) && !Object.prototype.hasOwnProperty.call(e, 'format') && e.app === 'twrc-backup') return fail('LEGACY_REEXPORT_REQUIRED');
      if (!object(e) || e.format !== FORMAT) return fail('UNSUPPORTED_FORMAT');
      if (e.schemaVersion !== 1) return fail('UNSUPPORTED_SCHEMA');
      if (!fields(e, ['format', 'schemaVersion', 'createdAt', 'appVersion', 'sha256', 'payload']) || !iso(e.createdAt) ||
        version(e.appVersion) === null || typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256) || !object(e.payload)) return fail('INVALID_ENVELOPE');
      const p = e.payload;
      if (!fields(p, ['alg', 'kdf', 'it', 's', 'i', 'c']) || p.alg !== 'AES-256-GCM' || p.kdf !== 'PBKDF2-SHA256' || p.it !== ITERATIONS) return fail('INVALID_ENVELOPE');
      const salt = decode64(p.s, 16, 16), iv = decode64(p.i, 12, 12), cipher = decode64(p.c, 16, LIMITS.cipher);
      if (await hash(cipher) !== e.sha256) return fail('INTEGRITY_MISMATCH');
      const fileSha256 = await hash(bytes);
      if (referenceHash !== undefined && (typeof referenceHash !== 'string' || !/^[0-9a-f]{64}$/.test(referenceHash) || referenceHash !== fileSha256)) return fail('INTEGRITY_MISMATCH');
      return { e, salt, iv, cipher, info: Object.freeze({ createdAt: e.createdAt, appVersion: e.appVersion, cipherSha256: e.sha256, fileSha256, size: bytes.length }) };
    }
    async function decrypt(packet, derived) {
      try { return new Uint8Array(await crypt.subtle.decrypt({ name: 'AES-GCM', iv: packet.iv, additionalData: aad(packet.e), tagLength: 128 }, derived, packet.cipher)); }
      catch { return fail('AUTHENTICATION_FAILED'); }
    }
    async function open(input, pass, readerVersion, referenceHash) {
      const packet = await read(input, referenceHash), reader = version(readerVersion);
      if (reader === null) return fail('UNKNOWN_READER_VERSION');
      if (version(packet.e.appVersion) > reader) return fail('PRODUCER_TOO_NEW');
      const plain = await decrypt(packet, await key(pass, packet.salt, ['decrypt']));
      try { return business(plain); } finally { plain.fill(0); }
    }
    async function seal(data, pass, appVersion, createdAt = new Date().toISOString()) {
      if (version(appVersion) === null) return fail('UNKNOWN_READER_VERSION');
      if (!iso(createdAt)) return fail('INVALID_ENVELOPE');
      jsonTree(data);
      const plain = utf8(JSON.stringify(data));
      try {
        if (plain.length > LIMITS.cipher - 16) return fail('FILE_TOO_LARGE');
        business(plain);
        const salt = crypt.getRandomValues(new Uint8Array(16)), iv = crypt.getRandomValues(new Uint8Array(12));
        const e = { format: FORMAT, schemaVersion: 1, createdAt, appVersion, sha256: '',
          payload: { alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', it: ITERATIONS, s: encode64(salt), i: encode64(iv), c: '' } };
        const derived = await key(pass, salt, ['encrypt', 'decrypt']);
        const cipher = new Uint8Array(await crypt.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(e), tagLength: 128 }, derived, plain));
        e.payload.c = encode64(cipher); e.sha256 = await hash(cipher);
        const bytes = utf8(JSON.stringify(e));
        const packet = await read(bytes), check = await decrypt(packet, derived);
        try { if (!equal(check, plain)) return fail('CONSERVATION_BLOCKED'); business(check); }
        finally { check.fill(0); }
        return bytes;
      } finally { plain.fill(0); }
    }
    return Object.freeze({ seal, open, inspect: async (input, referenceHash) => (await read(input, referenceHash)).info });
  }
  return Object.freeze({ LIMITS, loadedVersion, create });
})();
