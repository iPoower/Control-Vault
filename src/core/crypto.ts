// Chiffrement local et empreintes — Web Crypto uniquement, aucune dépendance tierce.
//
// Enveloppe d'un fichier .cvault :
//   "CVLT" (4 octets) | version (1 octet = 1) | sel (16) | IV (12) | AES-256-GCM(ciphertext + tag)
// Le sel n'est utile qu'avec une clé dérivée d'une phrase secrète (Phase 3) ; il est présent
// dès maintenant pour que le format ne change pas.

const MAGIC = new Uint8Array([0x43, 0x56, 0x4c, 0x54]); // "CVLT"
const FORMAT_VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN;

/** Itérations PBKDF2-SHA256 recommandées par l'OWASP (2023+). */
export const PBKDF2_ITERATIONS = 600_000;

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return toHex(await subtle().digest('SHA-256', bytes as BufferSource));
}

/** Comparaison en temps constant de deux empreintes hexadécimales. */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Clé de session non extractible (mode démonstration). */
export function generateKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Clé dérivée d'une phrase secrète (Phase 3). La clé n'est jamais exportable. */
export async function deriveKey(passphrase: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(passphrase) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export async function encrypt(key: CryptoKey, plaintext: Uint8Array | string, salt = randomBytes(SALT_LEN)): Promise<Uint8Array> {
  const iv = randomBytes(IV_LEN);
  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource));
  const out = new Uint8Array(HEADER_LEN + cipher.length);
  out.set(MAGIC, 0);
  out[MAGIC.length] = FORMAT_VERSION;
  out.set(salt, MAGIC.length + 1);
  out.set(iv, MAGIC.length + 1 + SALT_LEN);
  out.set(cipher, HEADER_LEN);
  return out;
}

export class VaultFormatError extends Error {}

export function readEnvelope(blob: Uint8Array): { salt: Uint8Array; iv: Uint8Array; cipher: Uint8Array } {
  if (blob.length <= HEADER_LEN || !MAGIC.every((b, i) => blob[i] === b)) {
    throw new VaultFormatError("Ce fichier n'est pas une sauvegarde Control Vault.");
  }
  if (blob[MAGIC.length] !== FORMAT_VERSION) {
    throw new VaultFormatError('Format de sauvegarde plus récent que cette version de Control Vault.');
  }
  return {
    salt: blob.slice(MAGIC.length + 1, MAGIC.length + 1 + SALT_LEN),
    iv: blob.slice(MAGIC.length + 1 + SALT_LEN, HEADER_LEN),
    cipher: blob.slice(HEADER_LEN),
  };
}

export async function decrypt(key: CryptoKey, blob: Uint8Array): Promise<string> {
  const { iv, cipher } = readEnvelope(blob);
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, cipher as BufferSource);
    return dec.decode(plain);
  } catch {
    // GCM échoue si la clé est mauvaise OU si un seul octet a été altéré.
    throw new VaultFormatError('Déchiffrement impossible : clé incorrecte ou fichier altéré.');
  }
}
