// État global en mode Google Drive. Fonction pure, testée.
// « Vérifié » exige une réponse réelle de l'API Google, récente.

import type { DriveState } from './store';
import type { GlobalStatus, Issue, Segment } from './status';

const FRESH_MS = 15 * 60_000;

export function computeDriveStatus(d: DriveState, online: boolean, now: number): GlobalStatus {
  const issues: Issue[] = [];
  const connected = d.auth === 'connected';
  const proven = connected && online && !!d.lastCheckAt && now - d.lastCheckAt < FRESH_MS;
  const config = d.roots.filter((r) => r.source === 'config');
  const granted = config.filter((r) => r.access === 'granted').length;
  const checked = config.every((r) => r.access !== 'unknown' && r.access !== 'checking');

  const segments: Segment[] = [
    {
      key: 'drive',
      label: 'Google Drive',
      health: !online ? 'unknown' : proven ? 'verified' : d.auth === 'expired' || d.auth === 'error' || d.auth === 'denied' ? 'failed' : connected ? 'pending' : 'unknown',
      detail: !online ? 'Non vérifiable hors ligne' : proven ? 'Connexion vérifiée' : d.auth === 'expired' ? 'Session expirée' : d.auth === 'denied' ? 'Accès refusé' : d.auth === 'error' ? 'Erreur de connexion' : connected ? 'Vérification en cours' : 'Non connecté',
    },
    {
      key: 'folders',
      label: 'Dossiers du coffre',
      health: !proven ? 'unknown' : !checked ? 'pending' : granted === config.length ? 'verified' : granted ? 'stale' : 'failed',
      detail: !proven ? 'Non vérifiés' : !checked ? 'Contrôle en cours' : `${granted} sur ${config.length} autorisés`,
    },
    { key: 'supabase', label: 'Supabase', health: 'unknown', detail: 'Non connecté (Phase 4)' },
    { key: 'backups', label: 'Sauvegardes chiffrées', health: 'unknown', detail: 'Disponibles en Phase 3' },
  ];

  if (!online) {
    return { level: 'unknown', title: 'Hors ligne', detail: 'L’état de Google Drive sera vérifié au retour du réseau.', segments, issues };
  }
  if (d.auth === 'expired') {
    issues.push({ id: 'expired', severity: 'action', title: 'Session Google expirée', detail: 'Rien n’est perdu. Reconnecte-toi pour continuer.', action: { label: 'Se reconnecter', intent: { kind: 'reconnect' } } });
  } else if (d.auth === 'denied' || d.auth === 'error') {
    issues.push({ id: 'auth', severity: 'action', title: d.auth === 'denied' ? 'Accès à Google Drive refusé' : 'Connexion Google impossible', detail: d.message ?? 'Réessaie la connexion.', action: { label: 'Se connecter avec Google', intent: { kind: 'reconnect' } } });
  } else if (!connected) {
    issues.push({ id: 'signin', severity: 'action', title: 'Connecte ton Google Drive', detail: 'Control Vault ne voit que les fichiers que tu autorises, avec l’accès limité drive.file.', action: { label: 'Se connecter avec Google', intent: { kind: 'reconnect' } } });
  } else if (proven && checked && granted < config.length) {
    issues.push({ id: 'grant', severity: 'attention', title: granted ? 'Certains dossiers ne sont pas autorisés' : 'Autorise les dossiers du coffre', detail: 'Ouvre le sélecteur Google et choisis les dossiers Control Vault, Race Control, Reconversion Control et Archives.', action: { label: 'Autoriser des dossiers', intent: { kind: 'grant' } } });
  }

  const first = issues[0];
  if (first?.severity === 'action') return { level: 'action', title: first.title, detail: first.detail, segments, issues, lastVerifiedAt: d.lastCheckAt };
  if (first) return { level: 'attention', title: first.title, detail: first.detail, segments, issues, lastVerifiedAt: d.lastCheckAt };
  if (!proven || !checked) return { level: 'unknown', title: 'Vérification en cours', detail: 'Contrôle de la connexion et des dossiers autorisés.', segments, issues, lastVerifiedAt: d.lastCheckAt };
  return { level: 'ok', title: 'Google Drive connecté et vérifié', detail: 'Tes dossiers autorisés répondent. Les sauvegardes chiffrées arrivent en Phase 3.', segments, issues, lastVerifiedAt: d.lastCheckAt };
}
