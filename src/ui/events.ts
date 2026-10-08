import type { State } from '../core/store';
import type { Health, OpEvent } from '../core/types';

const TYPE_LABEL: Record<OpEvent['type'], string> = {
  backup: 'Sauvegarde',
  restore: 'Restauration',
  safety: 'Copie de sécurité',
  import: 'Import JSON',
  verify: 'Contrôle d’intégrité',
  connect: 'Connexion à Google Drive',
  grant: 'Autorisation de fichiers',
  'test-upload': 'Envoi de test',
};

export const TYPE_ICON: Record<OpEvent['type'], string> = {
  backup: 'backup',
  restore: 'restore',
  safety: 'shield',
  import: 'upload',
  verify: 'fingerprint',
  connect: 'cloud',
  grant: 'key',
  'test-upload': 'upload',
};

export function sourceName(e: OpEvent, s: State) {
  return e.source === 'vault' ? 'Control Vault' : s.apps[e.source].name;
}

export function eventTitle(e: OpEvent, s: State) {
  if (e.source === 'vault') return e.type === 'verify' ? 'Contrôle d’intégrité de toutes les versions' : e.title ?? TYPE_LABEL[e.type];
  const prep = e.type === 'import' ? ' pour ' : ' de ';
  return `${TYPE_LABEL[e.type]}${prep}${s.apps[e.source].name}`;
}

export function eventHealth(e: OpEvent): Health {
  if (e.result === 'failed') return e.resolved ? 'stale' : 'failed';
  if (e.result === 'cancelled') return 'unknown';
  return e.integrity === 'verified' ? 'verified' : 'unknown';
}

export function eventResult(e: OpEvent) {
  if (e.result === 'cancelled') return 'Annulée';
  if (e.result === 'failed') return e.resolved ? 'Échec, résolu depuis' : 'Échec';
  return e.integrity === 'verified' ? 'Réussie et vérifiée' : 'Réussie';
}

export const TYPE_LABELS = TYPE_LABEL;
