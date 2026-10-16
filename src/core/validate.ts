// Contrôle des fichiers entrants et des contenus avant sauvegarde ou restauration.

import type { AppId, Payload } from './types';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const APP_IDS: AppId[] = ['race-control', 'reconversion-control'];
// Schémas du jeu de démonstration uniquement ; sans rapport avec le coffre v3
// de Race Control ni avec schemaVersion du contrat d'intégration.
const DEMO_SCHEMAS: Record<AppId, number> = { 'race-control': 3, 'reconversion-control': 1 };

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
  if (app && p.schema !== DEMO_SCHEMAS[app]) {
    return { ok: false, error: 'Version du format de démonstration inconnue : contenu refusé.' };
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Les moteurs JSON peuvent inclure un extrait du contenu dans l'erreur.
    return { ok: false, error: 'JSON invalide : fichier refusé.' };
  }
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
