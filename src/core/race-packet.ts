// Contrat INTEGRATION V1. Paquet opaque : aucune clé ni opération de déchiffrement.
import { sha256 } from './crypto';

export const PACKET_LIMITS = Object.freeze({ file: 71303168, cipher: 50331648, depth: 4 });
export type PacketCode = 'FILE_TOO_LARGE' | 'MALFORMED_FILE' | 'UNSUPPORTED_FORMAT' | 'UNSUPPORTED_SCHEMA' |
  'INVALID_ENVELOPE' | 'INVALID_ENCODING' | 'INTEGRITY_MISMATCH' | 'LEGACY_REEXPORT_REQUIRED';
export class PacketError extends Error {
  constructor(readonly code: PacketCode) { super(code); this.name = 'PacketError'; }
}
const fail = (code: PacketCode): never => { throw new PacketError(code); };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const fields = (v: Record<string, unknown>, wanted: string[]) =>
  Object.keys(v).length === wanted.length && wanted.every(k => Object.hasOwn(v, k));

// JSON.parse valide la grammaire ; ce parcours indépendant refuse aussi les clés
// en double après échappement et les imbrications avant toute dérivation coûteuse.
function strictJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > PACKET_LIMITS.file) return fail('FILE_TOO_LARGE');
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) return fail('MALFORMED_FILE');
  let text: string, parsed: unknown;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); parsed = JSON.parse(text); }
  catch { return fail('MALFORMED_FILE'); }
  const frames: Array<Set<string> | null> = [];
  let at = 0;
  while (at < text.length) {
    const c = text[at];
    if (c === '"') {
      const begin = at++;
      while (text[at] !== '"' && at < text.length) at += text[at] === '\\' ? 2 : 1;
      at++;
      let next = at;
      while (/[\t\n\r ]/.test(text[next] ?? '') && next < text.length) next++;
      if (text[next] === ':') {
        const frame = frames.at(-1), key = JSON.parse(text.slice(begin, at)) as string;
        if (!frame || frame.has(key)) return fail('MALFORMED_FILE');
        frame.add(key);
      }
    } else {
      if (c === '{' || c === '[') {
        frames.push(c === '{' ? new Set() : null);
        if (frames.length > PACKET_LIMITS.depth) return fail('MALFORMED_FILE');
      } else if (c === '}' || c === ']') frames.pop();
      at++;
    }
  }
  const numbers = (v: unknown): void => {
    if (typeof v === 'number' && !Number.isFinite(v)) return fail('MALFORMED_FILE');
    if (v && typeof v === 'object') Object.values(v).forEach(numbers);
  };
  numbers(parsed);
  return parsed;
}
function base64(value: unknown, min: number, max: number): Uint8Array {
  if (typeof value !== 'string' || !value.length || value.length % 4 || value.length > 4 * Math.ceil(max / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return fail('INVALID_ENCODING');
  let raw: string;
  try { raw = atob(value); if (btoa(raw) !== value) return fail('INVALID_ENCODING'); }
  catch { return fail('INVALID_ENCODING'); }
  if (raw.length < min || raw.length > max) return fail('INVALID_ENCODING');
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
export interface PacketInfo {
  readonly format: 'race-control-backup';
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly appVersion: string;
  readonly cipherSha256: string;
  readonly fileSha256: string;
  readonly size: number;
}
// Les octets privés empêchent qu'une mutation de l'appelant invalide une preuve.
class Packet {
  readonly #bytes: Uint8Array;
  constructor(bytes: Uint8Array, readonly info: Readonly<PacketInfo>) {
    this.#bytes = bytes; Object.freeze(info); Object.freeze(this);
  }
  copyBytes(): Uint8Array { return this.#bytes.slice(); }
}
export type RacePacket = Packet;
export async function readRacePacket(input: Uint8Array, referenceHash?: string): Promise<RacePacket> {
  if (input.byteLength > PACKET_LIMITS.file) return fail('FILE_TOO_LARGE');
  const bytes = input.slice(), v = strictJson(bytes);
  if (object(v) && !Object.hasOwn(v, 'format') && v.app === 'twrc-backup') return fail('LEGACY_REEXPORT_REQUIRED');
  if (!object(v) || v.format !== 'race-control-backup') return fail('UNSUPPORTED_FORMAT');
  if (v.schemaVersion !== 1) return fail('UNSUPPORTED_SCHEMA');
  if (!fields(v, ['format', 'schemaVersion', 'createdAt', 'appVersion', 'sha256', 'payload']) ||
    typeof v.createdAt !== 'string' || v.createdAt.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.createdAt) ||
    !Number.isFinite(Date.parse(v.createdAt)) || new Date(v.createdAt).toISOString() !== v.createdAt ||
    typeof v.appVersion !== 'string' || v.appVersion.trim() !== v.appVersion || !/^prod-[1-9][0-9]{0,8}$/.test(v.appVersion) ||
    typeof v.sha256 !== 'string' || v.sha256.length !== 64 || !/^[0-9a-f]{64}$/.test(v.sha256) || !object(v.payload)) return fail('INVALID_ENVELOPE');
  const p = v.payload;
  if (!fields(p, ['alg', 'kdf', 'it', 's', 'i', 'c']) || p.alg !== 'AES-256-GCM' || p.kdf !== 'PBKDF2-SHA256' || p.it !== 600000)
    return fail('INVALID_ENVELOPE');
  base64(p.s, 16, 16); base64(p.i, 12, 12);
  const cipher = base64(p.c, 16, PACKET_LIMITS.cipher);
  if (await sha256(cipher) !== v.sha256) return fail('INTEGRITY_MISMATCH');
  const fileHash = await sha256(bytes);
  if (referenceHash !== undefined && (!/^[0-9a-f]{64}$/.test(referenceHash) || fileHash !== referenceHash)) return fail('INTEGRITY_MISMATCH');
  return new Packet(bytes, { format: 'race-control-backup', schemaVersion: 1, createdAt: v.createdAt,
    appVersion: v.appVersion, cipherSha256: v.sha256, fileSha256: fileHash, size: bytes.length });
}
export async function readRaceFile(file: Pick<File, 'size' | 'arrayBuffer'>): Promise<RacePacket> {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > PACKET_LIMITS.file) return fail('FILE_TOO_LARGE');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) return fail('MALFORMED_FILE');
  return readRacePacket(bytes);
}

// Parseur strict réutilisé uniquement pour les métadonnées publiques A1.
export { strictJson as strictOpaqueJson };
