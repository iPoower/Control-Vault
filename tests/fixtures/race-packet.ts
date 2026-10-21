// Adaptateur de test côté propriétaire Race Control. Jamais importé par Control Vault.
import { webcrypto, createHash } from 'node:crypto';
const enc = new TextEncoder();
export const fixtureCode = 'synthetic-recovery-passphrase';
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function packetFixture(count = 120) {
  const rows = Array.from({ length: count }, (_, i) => ({ key: `fixture-${i}`, age: i === 0 ? 365 : 91, feedback: { id: `answer-${i}`, conditions: ['wet'] } }));
  rows.push({ ...rows[0], feedback: { id: 'second-answer', conditions: ['fog'] } });
  const clear = JSON.stringify({ app: 'twrc', v: 2, settings: { cars: [] }, archive: rows });
  const salt = webcrypto.getRandomValues(new Uint8Array(16)), iv = webcrypto.getRandomValues(new Uint8Array(12));
  const s = Buffer.from(salt).toString('base64'), i = Buffer.from(iv).toString('base64');
  const metadata = { format: 'race-control-backup', schemaVersion: 1, createdAt: '2026-10-21T10:00:00.000Z', appVersion: 'prod-156' };
  const aad = enc.encode(JSON.stringify([metadata.format, 1, metadata.createdAt, metadata.appVersion, 'AES-256-GCM', 'PBKDF2-SHA256', 600000, s, i]));
  const material = await webcrypto.subtle.importKey('raw', enc.encode(fixtureCode), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const c = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, enc.encode(clear)));
  const envelope = { ...metadata, sha256: digest(c), payload: { alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', it: 600000, s, i, c: Buffer.from(c).toString('base64') } };
  const bytes = enc.encode(JSON.stringify(envelope, null, 2));
  return { envelope, bytes, clear, hash: digest(bytes), decrypt: async (restored: Uint8Array) => {
    const e = JSON.parse(new TextDecoder().decode(restored));
    const aad = enc.encode(JSON.stringify([e.format, e.schemaVersion, e.createdAt, e.appVersion, e.payload.alg, e.payload.kdf, e.payload.it, e.payload.s, e.payload.i]));
    const out = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(e.payload.i, 'base64'), additionalData: aad }, key, Buffer.from(e.payload.c, 'base64'));
    return new TextDecoder('utf-8', { fatal: true }).decode(out);
  } };
}
