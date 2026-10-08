// Configuration publique. AUCUN secret ici : ce fichier est servi tel quel par GitHub Pages.
// Les identifiants de dossiers Drive ne donnent aucun accès sans autorisation OAuth.

export const DRIVE_FOLDERS = {
  root: 'https://drive.google.com/drive/folders/1IPLb2Ild4L6gzoNu6qwgIGyH82qb0LV3',
  raceControl: 'https://drive.google.com/drive/folders/1Qii0gqhLU6dv8y-LMAOFnl_Rup1ABXyG',
  reconversionControl: 'https://drive.google.com/drive/folders/1xh0vomhbyUIsIKkrkLO8n3kyc_FNe3Li',
  archives: 'https://drive.google.com/drive/folders/1hjAgdsRaEfZbzmsJ2UVV9dvNvIAFMF4T',
} as const;

/** Phase 2 : identifiant client OAuth (public par nature, restreint aux origines autorisées). */
export const GOOGLE_CLIENT_ID = '';
/** Phase 2 : scopes minimaux. drive.file = uniquement les fichiers créés ou ouverts via le Picker. */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

/** Phase 4 : projet Supabase existant, tables vault_* isolées. La clé anon sera ajoutée en Phase 4. */
export const SUPABASE = { projectRef: 'zjydqnkyqshpnteabpat', region: 'eu-west-3 (Paris)' } as const;
