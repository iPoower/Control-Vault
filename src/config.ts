// Configuration publique. AUCUN secret ici : ce dépôt est public.
//
// Les identifiants Google de la connexion réelle arrivent au moment du build, par variables
// d'environnement définies UNIQUEMENT dans le projet Cloudflare Pages de production :
//   VITE_GOOGLE_CLIENT_ID  identifiant client OAuth « Application Web » (public par nature)
//   VITE_GOOGLE_API_KEY    clé API navigateur, restreinte à l'origine dédiée + docs.google.com
//   VITE_GOOGLE_APP_ID     numéro du projet Google Cloud (pour Google Picker)
//   VITE_APP_ORIGIN        origine dédiée exacte, ex. https://control-vault.pages.dev
// Le build GitHub Pages (ipoower.github.io) n'en reçoit aucun : il reste en démonstration.

export const DRIVE_FOLDERS = {
  root: 'https://drive.google.com/drive/folders/1IPLb2Ild4L6gzoNu6qwgIGyH82qb0LV3',
  raceControl: 'https://drive.google.com/drive/folders/1Qii0gqhLU6dv8y-LMAOFnl_Rup1ABXyG',
  reconversionControl: 'https://drive.google.com/drive/folders/1xh0vomhbyUIsIKkrkLO8n3kyc_FNe3Li',
  archives: 'https://drive.google.com/drive/folders/1hjAgdsRaEfZbzmsJ2UVV9dvNvIAFMF4T',
} as const;

export const folderIdFromUrl = (url: string) => url.match(/folders\/([A-Za-z0-9_-]+)/)?.[1] ?? '';

/** Les quatre dossiers existants : jamais recréés, jamais déplacés, permissions jamais modifiées. */
export const CONFIGURED_FOLDERS = [
  { key: 'root', name: 'Control Vault', id: folderIdFromUrl(DRIVE_FOLDERS.root) },
  { key: 'race-control', name: 'Race Control', id: folderIdFromUrl(DRIVE_FOLDERS.raceControl) },
  { key: 'reconversion-control', name: 'Reconversion Control', id: folderIdFromUrl(DRIVE_FOLDERS.reconversionControl) },
  { key: 'archives', name: 'Archives', id: folderIdFromUrl(DRIVE_FOLDERS.archives) },
] as const;

/** Seul scope demandé. drive.file = fichiers créés par l'app ou ouverts via le sélecteur Google. */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface GoogleConfig {
  clientId: string;
  apiKey: string;
  appId: string;
  appOrigin: string;
}

const env = import.meta.env as Record<string, string | undefined>;

export const GOOGLE: GoogleConfig = {
  clientId: (env.VITE_GOOGLE_CLIENT_ID ?? '').trim(),
  apiKey: (env.VITE_GOOGLE_API_KEY ?? '').trim(),
  appId: (env.VITE_GOOGLE_APP_ID ?? '').trim(),
  appOrigin: (env.VITE_APP_ORIGIN ?? '').trim().replace(/\/$/, ''),
};

/** Adresse de la version connectée, affichée sur la démonstration GitHub Pages si connue. */
export const DEDICATED_URL = (env.VITE_DEDICATED_URL ?? '').trim();

export type Availability =
  | { available: true }
  | { available: false; reason: 'not-configured' | 'wrong-origin' | 'insecure' | 'no-crypto'; detail: string };

/**
 * La connexion réelle n'est possible que si TOUT est réuni : identifiants présents, origine
 * exactement égale à l'origine dédiée, contexte sécurisé. Sinon : démonstration uniquement.
 */
export function realModeAvailability(cfg: GoogleConfig, origin: string, secureContext: boolean, hasCrypto = true): Availability {
  if (!cfg.clientId || !cfg.apiKey || !cfg.appId || !cfg.appOrigin) {
    return { available: false, reason: 'not-configured', detail: 'Cette version n’a pas d’identifiants Google : elle fonctionne uniquement en démonstration.' };
  }
  if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(cfg.clientId)) {
    return { available: false, reason: 'not-configured', detail: 'Identifiant client OAuth mal formé.' };
  }
  if (origin !== cfg.appOrigin) {
    return { available: false, reason: 'wrong-origin', detail: `La connexion Google est réservée à ${cfg.appOrigin}. Cette adresse (${origin}) reste en démonstration.` };
  }
  if (!secureContext) return { available: false, reason: 'insecure', detail: 'Connexion non sécurisée : HTTPS obligatoire.' };
  if (!hasCrypto) return { available: false, reason: 'no-crypto', detail: 'Ce navigateur ne fournit pas Web Crypto.' };
  return { available: true };
}

/** Supabase (Phase 4) : non connecté en Phase 2. */
export const SUPABASE = { projectRef: 'zjydqnkyqshpnteabpat', region: 'eu-west-3 (Paris)' } as const;
