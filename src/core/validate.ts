// Contrôle des fichiers entrants et des contenus avant sauvegarde ou restauration.

import type { AppId, Payload } from './types';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const APP_IDS: AppId[] = ['race-control', 'reconversion-control'];

export type ValidationResult =
  | { ok: true; payload: Payload; appId: AppId | null }
  | { ok: false; error: string };

export function validatePayload(payload: unknown, expected?: AppId): ValidationResult {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Le contenu doit être un objet JSON (entre accolades).' };
  }
  const p = payload as Payload;
  const app = typeof p.app === 'string' && (APP_IDS as string[]).includes(p.app) ? (p.app as AppId) : null;
  if (expected && app !== expected) {
    return { ok: false, error: app ? `Ce contenu appartient à une autre application (${app}).` : 'Le champ « app » est absent : impossible de savoir à quelle application il appartient.' };
  }
  if (expected && typeof p.schema !== 'number') {
    return { ok: false, error: 'Le champ « schema » est absent : la version du format est inconnue.' };
  }
  return { ok: true, payload: p, appId: app };
}

/** Fichier importé par l'utilisateur : extension, taille, syntaxe, puis structure. */
export function validateImport(name: string, sizeBytes: number, text: string): ValidationResult {
  if (!/\.json$/i.test(name)) return { ok: false, error: 'Seuls les fichiers .json sont acceptés pour l’import.' };
  if (sizeBytes === 0) return { ok: false, error: 'Le fichier est vide.' };
  if (sizeBytes > MAX_IMPORT_BYTES) return { ok: false, error: 'Le fichier dépasse 10 Mo, la limite d’import.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const where = e instanceof SyntaxError ? e.message.replace(/^JSON\.parse: /, '') : '';
    return { ok: false, error: `JSON invalide${where ? ` : ${where}` : ''}.` };
  }
  return validatePayload(parsed);
}

/** Nom de fichier sûr pour Drive : pas de séparateurs, longueur bornée. */
export function safeFileName(name: string): string {
  const cleaned = name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
  return (cleaned || 'fichier').slice(0, 120);
}
