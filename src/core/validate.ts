// Contrôle des fichiers entrants et des contenus avant sauvegarde ou restauration.

import type { AppId, Payload } from './types';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 100_000;
const APP_IDS: AppId[] = ['race-control', 'reconversion-control'];
// Schémas du jeu de démonstration uniquement ; sans rapport avec le coffre v3
// de Race Control ni avec schemaVersion du contrat d'intégration.
const DEMO_SCHEMAS: Record<AppId, number> = { 'race-control': 3, 'reconversion-control': 1 };

export type ValidationResult =
  | { ok: true; payload: Payload; appId: AppId | null }
  | { ok: false; error: string };

/** Borne aussi les données mémoire avant sérialisation, diff ou chiffrement. */
function jsonShapeError(value: unknown): string | null {
  let nodes = 0, chars = 0;
  const ancestors = new Set<object>();
  function visit(v: unknown, depth: number): boolean {
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
    if (typeof v === 'string') { chars += v.length; return chars <= MAX_IMPORT_BYTES; }
    if (v === null || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v !== 'object' || ancestors.has(v)) return false;
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
    ancestors.add(v);
    for (const [k, child] of Object.entries(v)) {
      chars += k.length;
      if (chars > MAX_IMPORT_BYTES || !visit(child, depth + 1)) return false;
    }
    ancestors.delete(v);
    return true;
  }
  return visit(value, 0) ? null : 'Contenu JSON trop complexe, trop volumineux ou non sérialisable : fichier refusé.';
}

/** Précontrôle lexical borné : profondeur et clés dupliquées avant JSON.parse. */
function jsonTextError(text: string): string | null {
  if (text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) return 'Le fichier dépasse 10 Mo, la limite d’import.';
  const stack: ({ keys: Set<string>; key: boolean } | null)[] = [];
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (++i; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') break;
      }
      const object = stack[stack.length - 1];
      if (object?.key) {
        let key: string;
        try { key = JSON.parse(text.slice(start, i + 1)) as string; } catch { return 'JSON invalide : fichier refusé.'; }
        if (object.keys.has(key)) return 'Clé JSON dupliquée : fichier ambigu refusé.';
        object.keys.add(key);
        object.key = false;
      }
    } else if (c === '{' || c === '[') {
      stack.push(c === '{' ? { keys: new Set(), key: true } : null);
      if (stack.length > MAX_JSON_DEPTH) return 'Contenu JSON trop profond : fichier refusé.';
    } else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') { const object = stack[stack.length - 1]; if (object) object.key = true; }
    if ((c === ',' || c === ':' || c === '{' || c === '[') && ++tokens > MAX_JSON_NODES * 2) return 'Contenu JSON trop complexe : fichier refusé.';
  }
  return null;
}

export function validateJsonText(text: string, expected?: AppId): ValidationResult {
  const error = jsonTextError(text);
  if (error) return { ok: false, error };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: 'JSON invalide : fichier refusé.' }; }
  return validatePayload(parsed, expected);
}

export function validatePayload(payload: unknown, expected?: AppId): ValidationResult {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Le contenu doit être un objet JSON (entre accolades).' };
  }
  const shapeError = jsonShapeError(payload);
  if (shapeError) return { ok: false, error: shapeError };
  const p = payload as Payload;
  const app = typeof p.app === 'string' && (APP_IDS as string[]).includes(p.app) ? (p.app as AppId) : null;
  if (expected && app !== expected) {
    return { ok: false, error: app ? `Ce contenu appartient à une autre application (${app}).` : 'Le champ « app » est absent : impossible de savoir à quelle application il appartient.' };
  }
  if (expected && typeof p.schema !== 'number') {
    return { ok: false, error: 'Le champ « schema » est absent : la version du format est inconnue.' };
  }
  if (app && p.schema !== DEMO_SCHEMAS[app]) {
    return { ok: false, error: 'Version du format de démonstration inconnue : contenu refusé.' };
  }
  if (app) {
    const collections = app === 'race-control' ? ['trajets', 'pneus'] : ['modules', 'sessions'];
    if (!Number.isSafeInteger(p.revision) || Number(p.revision) < 0 ||
      collections.some(k => !Array.isArray(p[k]) || (p[k] as unknown[]).some(x => !x || typeof x !== 'object' || Array.isArray(x) || typeof (x as Record<string, unknown>).id !== 'string')) ||
      app === 'race-control' && (!p.reglages || typeof p.reglages !== 'object' || Array.isArray(p.reglages))) {
      return { ok: false, error: 'Contenu de démonstration incomplet ou incompatible : fichier refusé.' };
    }
    for (const k of collections) {
      const ids = (p[k] as { id: string }[]).map(x => x.id);
      if (ids.some(id => !id) || new Set(ids).size !== ids.length) return { ok: false, error: 'Identifiants de collection absents ou dupliqués : fichier refusé.' };
    }
  }
  return { ok: true, payload: p, appId: app };
}

/** Métadonnées disponibles AVANT la lecture du fichier. */
export function importFileError(name: string, sizeBytes: number): string | null {
  if (!/\.json$/i.test(name)) return 'Seuls les fichiers .json sont acceptés pour l’import.';
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) return 'Taille du fichier invalide.';
  if (sizeBytes === 0) return 'Le fichier est vide.';
  if (sizeBytes > MAX_IMPORT_BYTES) return 'Le fichier dépasse 10 Mo, la limite d’import.';
  return null;
}

/** Fichier importé par l'utilisateur : extension, taille, syntaxe, puis structure. */
export function validateImport(name: string, sizeBytes: number, text: string): ValidationResult {
  const error = importFileError(name, sizeBytes);
  if (error) return { ok: false, error };
  const result = validateJsonText(text);
  if (!result.ok) return result;
  if (new TextEncoder().encode(text).length !== sizeBytes) return { ok: false, error: 'Taille du contenu différente de celle annoncée : fichier refusé.' };
  const parsed = result.payload;
  // Le contrat n'est pas encore implémenté dans l'application. Ne pas faire
  // passer un paquet Race Control par l'import JSON générique en le déclarant
  // vérifié, sans validation du schéma, du Base64 et du hash contractuels.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const p = parsed as Record<string, unknown>;
    if (p.format === 'race-control-backup' || p.app === 'twrc-backup' ||
      p.kdf === 'PBKDF2-SHA256' && typeof p.c === 'string' && typeof p.s === 'string' && typeof p.i === 'string') {
      return { ok: false, error: 'Ce paquet Race Control n’est pas pris en charge par le prototype. Conserve le fichier original et utilise Race Control pour sa restauration.' };
    }
  }
  return validatePayload(parsed);
}

/** Nom de fichier sûr pour Drive : pas de séparateurs, longueur bornée. */
export function safeFileName(name: string): string {
  const cleaned = name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
  return (cleaned || 'fichier').slice(0, 120);
}
