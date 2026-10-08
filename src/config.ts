// Configuration publique. Ce dépôt est public : AUCUN secret ni identifiant personnel ici.
//
// - Aucun identifiant de dossier Google Drive : en mode réel (Phase 2), les dossiers sont
//   choisis explicitement par l'utilisateur dans le sélecteur Google (Google Picker).
// - Les identifiants publics de la connexion Google (client OAuth, clé API restreinte,
//   numéro de projet) seront fournis au build de production par des variables
//   d'environnement protégées, jamais par ce fichier.

/** Seul scope Google qui sera demandé. drive.file = fichiers créés par l'app ou choisis via le sélecteur. */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;
