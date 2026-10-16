// Contrat exécutable de lot 1, exclusivement dans les tests.
// Aucune donnée réelle, clé, dépendance de production ou import depuis Race Control.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

type MapValue = Record<string, unknown>;
interface Rule {
  const?: string | number;
  type?: 'object' | 'string';
  required?: string[];
  properties?: Record<string, Rule>;
  additionalProperties?: boolean;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}
interface Limits {
  maxFileBytes: number;
  maxCipherBytes: number;
  maxJsonDepth: number;
  saltBytes: number;
  ivBytes: number;
  tagBytes: number;
}
interface Packet {
  format: string;
  schemaVersion: number;
  createdAt: string;
  appVersion: string;
  sha256: string;
  payload: { alg: string; kdf: string; it: number; s: string; i: string; c: string };
}
const document = readFileSync('docs/INTEGRATION.md', 'utf8');
function normative(name: string): unknown {
  const part = document.split('<!-- integration-' + name + ':start -->')[1]
    ?.split('<!-- integration-' + name + ':end -->')[0];
  const json = part?.match(/~~~json\s*([\s\S]*?)\s*~~~/)?.[1];
  if (!json) throw new Error('Section normative manquante');
  return JSON.parse(json) as unknown;
}
const schema = normative('schema') as Rule;
const limits = normative('limits') as Limits;
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const map = (value: unknown): value is MapValue => value !== null && typeof value === 'object' && !Array.isArray(value);
function refuse(code: string): never { throw new Error(code); }
function fileSizeAllowed(size: number): boolean {
  return Number.isSafeInteger(size) && size >= 0 && size <= limits.maxFileBytes;
}
function cipherSizeAllowed(size: number): boolean {
  return Number.isSafeInteger(size) && size >= limits.tagBytes && size <= limits.maxCipherBytes;
}
function release(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() !== value || !/^prod-[1-9][0-9]{0,8}$/.test(value)) return null;
  return Number(value.substring(5));
}

// Interpréteur de la forme du contrat pour les tests ; jamais appelé par l'application.
function conforms(value: unknown, rule: Rule): boolean {
  if (Object.hasOwn(rule, 'const') && value !== rule.const) return false;
  switch (rule.type) {
    case 'object': {
      if (!map(value)) return false;
      const fields = rule.properties ?? {};
      if ((rule.required ?? []).some((key) => !Object.hasOwn(value, key))) return false;
      return Object.entries(value).every(([key, item]) =>
        Object.hasOwn(fields, key) ? conforms(item, fields[key]) : rule.additionalProperties !== false);
    }
    case 'string':
      return typeof value === 'string' &&
        value.length >= (rule.minLength ?? 0) && value.length <= (rule.maxLength ?? Infinity) &&
        (!rule.pattern || new RegExp(rule.pattern).test(value));
    default:
      return true;
  }
}
function base64(value: unknown, minimum: number, maximum: number): Buffer {
  if (typeof value !== 'string' || !value.length || value.length % 4 !== 0 ||
    value.length > 4 * Math.ceil(maximum / 3) || /[^A-Za-z0-9+/=]/.test(value) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) refuse('INVALID_ENCODING');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length < minimum || decoded.length > maximum || decoded.toString('base64') !== value) refuse('INVALID_ENCODING');
  return decoded;
}
function readJson(source: string | Uint8Array): unknown {
  const bytes = typeof source === 'string' ? Buffer.from(source) : Buffer.from(source);
  if (!fileSizeAllowed(bytes.length)) refuse('FILE_TOO_LARGE');
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) refuse('MALFORMED_FILE');
  let text: string, result: unknown;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    result = JSON.parse(text) as unknown;
  } catch { return refuse('MALFORMED_FILE'); }
  // Grammaire déjà validée ; parcours lexical indépendant pour doublons et profondeur.
  const frames: Array<Set<string> | null> = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (char === '"') {
      const begin = at++;
      while (at < text.length && text[at] !== '"') at += text[at] === '\\' ? 2 : 1;
      at++;
      let next = at;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (text[next] === ':') {
        const frame = frames.at(-1);
        const key = JSON.parse(text.slice(begin, at)) as string;
        if (!frame || frame.has(key)) refuse('MALFORMED_FILE');
        frame.add(key);
      }
    } else {
      if (char === '{' || char === '[') {
        frames.push(char === '{' ? new Set<string>() : null);
        if (frames.length > limits.maxJsonDepth) refuse('MALFORMED_FILE');
      } else if (char === '}' || char === ']') frames.pop();
      at++;
    }
  }
  return result;
}
function historicalShape(data: MapValue): boolean {
  if (data.v != null && data.v !== 1 && data.v !== 2) return false;
  if (data.kdf != null && data.kdf !== 'PBKDF2-SHA256') return false;
  if (data.it != null && data.it !== 600000) return false;
  // Le contrat ne durcit pas le validateur historique : ne pas exiger le réencodage canonique.
  const originalBase64 = (v: unknown): v is string => typeof v === 'string' && v.length > 0 &&
    v.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(v);
  try {
    return originalBase64(data.s) && data.s.length === 24 && Buffer.from(data.s, 'base64').length === 16 &&
      originalBase64(data.i) && data.i.length === 16 && Buffer.from(data.i, 'base64').length === 12 &&
      originalBase64(data.c) && data.c.length <= 64 * 1024 ** 2 && Buffer.from(data.c, 'base64').length >= 16;
  } catch { return false; }
}
function evaluate(source: string | Uint8Array, destination: 'vault' | 'race' = 'vault', reader: unknown = 'prod-124'): string {
  const value = readJson(source);
  if (!map(value)) return refuse('UNSUPPORTED_FORMAT');
  if (!Object.hasOwn(value, 'format') && value.app === 'twrc-backup') {
    if (!historicalShape(value)) return refuse('INVALID_ENVELOPE');
    if (destination === 'vault') return refuse('LEGACY_REEXPORT_REQUIRED');
    return 'legacy-candidate'; // Contrat du chemin RC, pas une restauration dans Vault.
  }
  if (value.format !== 'race-control-backup') return refuse('UNSUPPORTED_FORMAT');
  if (value.schemaVersion !== 1) return refuse('UNSUPPORTED_SCHEMA');
  if (!conforms(value, schema)) return refuse('INVALID_ENVELOPE');
  const packet = value as unknown as Packet;
  const time = Date.parse(packet.createdAt);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== packet.createdAt) return refuse('INVALID_ENVELOPE');
  base64(packet.payload.s, limits.saltBytes, limits.saltBytes);
  base64(packet.payload.i, limits.ivBytes, limits.ivBytes);
  const bytes = base64(packet.payload.c, limits.tagBytes, limits.maxCipherBytes);
  if (sha(bytes) !== packet.sha256) return refuse('INTEGRITY_MISMATCH');
  if (destination === 'race') {
    const loaded = release(reader), made = release(packet.appVersion);
    if (loaded === null) return refuse('UNKNOWN_READER_VERSION');
    if (made !== null && made > loaded) return refuse('PRODUCER_TOO_NEW');
  }
  return 'schema-ok'; // Ce résultat ne valide ni GCM ni une restauration réelle.
}
const bytes = Uint8Array.from({ length: 32 }, (_, n) => n);
function fixture(): Packet {
  return {
    format: 'race-control-backup', schemaVersion: 1, createdAt: '2026-01-01T00:00:00.000Z', appVersion: 'prod-124',
    sha256: '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd',
    payload: { alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', it: 600000,
      s: Buffer.alloc(16).toString('base64'), i: Buffer.alloc(12).toString('base64'), c: Buffer.from(bytes).toString('base64') },
  };
}
function changed(update: (data: MapValue, payload: MapValue) => void): string {
  const data = fixture() as unknown as MapValue;
  update(data, data.payload as MapValue);
  return JSON.stringify(data);
}

describe('contrat V1 : schéma uniquement, aucune restauration', () => {
  it('lit les règles et limites du contrat normatif', () => {
    expect(schema.properties?.schemaVersion.const).toBe(1);
    expect(schema.required).toEqual(['format', 'schemaVersion', 'createdAt', 'appVersion', 'sha256', 'payload']);
    expect(schema.properties?.payload.required).toEqual(['alg', 'kdf', 'it', 's', 'i', 'c']);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.payload.additionalProperties).toBe(false);
    expect(limits).toEqual({ maxFileBytes: 68 * 1024 ** 2, maxCipherBytes: 48 * 1024 ** 2,
      maxJsonDepth: 4, saltBytes: 16, ivBytes: 12, tagBytes: 16 });
  });
  it('valide le vecteur des octets 0 à 31', () => {
    expect(sha(bytes)).toBe(fixture().sha256);
    expect(evaluate(JSON.stringify(fixture()))).toBe('schema-ok');
  });
  it('tolère ordre JSON et indentation sans changer le hash des octets', () => {
    const reversed = Object.fromEntries(Object.entries(fixture()).reverse());
    expect(evaluate(JSON.stringify(reversed, null, 2))).toBe('schema-ok');
  });
  it('refuse le hash du texte Base64 ou du JSON', () => {
    for (const hash of [sha(fixture().payload.c), sha(JSON.stringify(fixture().payload))]) {
      expect(() => evaluate(changed((v) => { v.sha256 = hash; }))).toThrow('INTEGRITY_MISMATCH');
    }
  });
  it.each(schema.required ?? [])('exige le champ racine %s', (key) => {
    expect(() => evaluate(changed((v) => { delete v[key]; }))).toThrow();
  });
  it.each(schema.properties?.payload.required ?? [])('exige le paramètre payload.%s', (key) => {
    expect(() => evaluate(changed((_v, p) => { delete p[key]; }))).toThrow();
  });
  it.each([0, 2, 999, '1', null])('refuse schemaVersion inconnue %s', (version) => {
    expect(() => evaluate(changed((v) => { v.schemaVersion = version; }))).toThrow('UNSUPPORTED_SCHEMA');
  });
  it('ne replie pas un format inconnu vers le chemin historique', () => {
    expect(() => evaluate(changed((v) => { v.format = 'other'; v.app = 'twrc-backup'; }))).toThrow('UNSUPPORTED_FORMAT');
  });
  it.each(['prod-0', 'prod-01', 'prod-1.0', 'prod-1000000000', 'dev', '', 124, null, 'prod-124\n', 'prod-124\r\n', 'prod-124\u2028'])('refuse la version productrice %s', (version) => {
    expect(() => evaluate(changed((v) => { v.appVersion = version; }))).toThrow('INVALID_ENVELOPE');
  });
  it('compare prod-9 et prod-10 numériquement pour le lecteur Race Control', () => {
    const ten = changed((v) => { v.appVersion = 'prod-10'; });
    expect(() => evaluate(ten, 'race', 'prod-9')).toThrow('PRODUCER_TOO_NEW');
    expect(evaluate(ten, 'race', 'prod-10')).toBe('schema-ok');
    expect(evaluate(changed((v) => { v.appVersion = 'prod-9'; }), 'race', 'prod-10')).toBe('schema-ok');
  });
  it('transporte le producteur futur connu sans promettre son import', () => {
    const future = changed((v) => { v.appVersion = 'prod-125'; });
    expect(evaluate(future)).toBe('schema-ok');
    expect(() => evaluate(future, 'race', 'prod-124')).toThrow('PRODUCER_TOO_NEW');
  });
  it.each(['', 'local', 'prod-01', null, 'prod-124\n'])('refuse le lecteur chargé inconnu %s', (reader) => {
    expect(() => evaluate(JSON.stringify(fixture()), 'race', reader)).toThrow('UNKNOWN_READER_VERSION');
  });
  it.each(['0'.repeat(64), 'A'.repeat(64), 'ab', null, 1, fixture().sha256 + '\n'])('refuse une empreinte mal formée ou différente (%s)', (hash) => {
    expect(() => evaluate(changed((v) => { v.sha256 = hash; }))).toThrow();
  });
  it('refuse un octet de chiffré altéré', () => {
    expect(() => evaluate(changed((_v, p) => {
      const c = Buffer.from(p.c as string, 'base64'); c[0] ^= 1; p.c = c.toString('base64');
    }))).toThrow('INTEGRITY_MISMATCH');
  });
  it('montre que hash recalculé et métadonnée valide ne prouvent pas authenticité', () => {
    const raw = changed((v, p) => {
      const c = Buffer.from(p.c as string, 'base64'); c[0] ^= 1; p.c = c.toString('base64');
      v.sha256 = sha(c); v.createdAt = '2026-01-02T00:00:00.000Z';
    });
    expect(evaluate(raw)).toBe('schema-ok');
    expect(document).toContain('PAS une preuve d’authenticité');
    expect(document).toContain('additionalData (AAD)');
  });
  it.each(['locations', 'vehicles', 'trips', 'address', 'driveFolderId', 'password', 'key', 'accessToken', '__proto__', 'constructor'])(
    'interdit la métadonnée %s aux deux niveaux', (key) => {
      expect(() => evaluate(changed((v) => { Object.defineProperty(v, key, { enumerable: true, value: 'synthetic' }); }))).toThrow();
      expect(() => evaluate(changed((_v, p) => { Object.defineProperty(p, key, { enumerable: true, value: 'synthetic' }); }))).toThrow();
    });
  it.each(['{', '{"format":', 'null', '[]', '42', '"text"', JSON.stringify(fixture()) + ' trailing'])('refuse un fichier malformé ou non objet %s', (text) => {
    expect(() => evaluate(text)).toThrow();
  });
  it('refuse UTF-8 invalide et BOM', () => {
    expect(() => evaluate(Uint8Array.of(195, 40))).toThrow('MALFORMED_FILE');
    expect(() => evaluate(Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(JSON.stringify(fixture()))]))).toThrow('MALFORMED_FILE');
  });
  it('refuse les clés dupliquées, y compris échappées et dans payload', () => {
    const raw = JSON.stringify(fixture());
    for (const duplicate of [
      raw.replace('{"format":', '{"format":"ignored","format":'),
      raw.replace('{"format":', '{"\\u0066ormat":"ignored","format":'),
      raw.replace('"payload":{', '"payload":{"alg":"ignored",'),
    ]) expect(() => evaluate(duplicate)).toThrow('MALFORMED_FILE');
  });
  it('borne la profondeur du JSON', () => {
    expect(() => evaluate('{"a":[[[[0]]]]}')).toThrow('MALFORMED_FILE');
  });
  it.each(['2026-02-30T00:00:00.000Z', '2026-13-01T00:00:00.000Z', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00.000+01:00'])(
    'refuse une date non canonique %s', (date) => {
      expect(() => evaluate(changed((v) => { v.createdAt = date; }))).toThrow('INVALID_ENVELOPE');
    });
  it.each([0, 1, 599999, 600001, 1e12, '600000'])('refuse le coût KDF arbitraire %s', (cost) => {
    expect(() => evaluate(changed((_v, p) => { p.it = cost; }))).toThrow('INVALID_ENVELOPE');
  });
  it('refuse une autre suite cryptographique', () => {
    expect(() => evaluate(changed((_v, p) => { p.alg = 'AES-CBC'; }))).toThrow('INVALID_ENVELOPE');
    expect(() => evaluate(changed((_v, p) => { p.kdf = 'other'; }))).toThrow('INVALID_ENVELOPE');
  });
  it.each(['_'.repeat(24), fixture().payload.c.slice(0, -1), fixture().payload.c + '\n', 'A'.repeat(22) + 'B='])(
    'refuse Base64 non canonique %s', (value) => {
      expect(() => evaluate(changed((_v, p) => { p.c = value; }))).toThrow();
    });
  it('exige la taille exacte du sel, de l’IV et un tag complet', () => {
    for (const [field, length] of [['s', 15], ['s', 17], ['i', 11], ['i', 13], ['c', 15]] as const) {
      expect(() => evaluate(changed((_v, p) => { p[field] = Buffer.alloc(length).toString('base64'); }))).toThrow();
    }
  });
  it('vérifie les bornes numériques sans allocation massive', () => {
    expect(fileSizeAllowed(limits.maxFileBytes)).toBe(true);
    expect(fileSizeAllowed(limits.maxFileBytes + 1)).toBe(false);
    expect(fileSizeAllowed(-1)).toBe(false);
    expect(cipherSizeAllowed(16)).toBe(true);
    expect(cipherSizeAllowed(limits.maxCipherBytes)).toBe(true);
    expect(cipherSizeAllowed(15)).toBe(false);
    expect(cipherSizeAllowed(limits.maxCipherBytes + 1)).toBe(false);
  });
  it.each([1, 2, undefined])('réserve le fichier historique V%s à Race Control sans conversion', (version) => {
    const current = fixture();
    const old: MapValue = { app: 'twrc-backup', s: current.payload.s, i: current.payload.i, c: current.payload.c };
    if (version !== undefined) Object.assign(old, { v: version, kdf: 'PBKDF2-SHA256', it: 600000 });
    expect(evaluate(JSON.stringify(old), 'race')).toBe('legacy-candidate');
    expect(() => evaluate(JSON.stringify(old))).toThrow('LEGACY_REEXPORT_REQUIRED');
  });
  it('reconnaît une ancienne enveloppe à bits Base64 non canoniques sans la convertir', () => {
    const p = fixture().payload;
    const old = { app: 'twrc-backup', v: 2, s: 'A'.repeat(21) + 'B==', i: p.i, c: p.c };
    expect(evaluate(JSON.stringify(old), 'race')).toBe('legacy-candidate');
    expect(() => evaluate(JSON.stringify(old))).toThrow('LEGACY_REEXPORT_REQUIRED');
  });
  it('ne traite pas une version historique future comme une sauvegarde connue', () => {
    const p = fixture().payload;
    const old = { app: 'twrc-backup', v: 3, it: 600000, s: p.s, i: p.i, c: p.c };
    expect(() => evaluate(JSON.stringify(old))).toThrow('INVALID_ENVELOPE');
    old.v = 2; old.it = 1e12;
    expect(() => evaluate(JSON.stringify(old))).toThrow('INVALID_ENVELOPE');
  });
  it('garde les trois blocages et neuf preuves futures explicites', () => {
    for (const id of ['B01', 'B02', 'B03', 'F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09']) expect(document).toContain(id);
    expect(document).toContain('NON RÉSOLUS par le lot 1');
    expect(document).toContain('Arrêt après leur création');
  });
});
