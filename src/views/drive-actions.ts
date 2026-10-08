// Actions Google Drive déclenchées depuis l'interface. Toujours appelées dans un geste
// de l'utilisateur : la fenêtre Google s'ouvre sans être bloquée par Safari.

import { store } from '../app';
import { grantAccess, signIn } from '../drive';
import { ServiceError } from '../services/contracts';
import { toast } from '../ui/overlay';

export function connectGoogle(selectAccount = false) {
  signIn(selectAccount)
    .then(() => toast('Google Drive connecté et vérifié', { kind: 'ok' }))
    .catch((e: Error) => {
      const s = store.get().drive;
      if (s.auth === 'signed-out' && /fermée/.test(e.message)) toast(e.message, { kind: 'info' });
      else toast(e.message || 'Connexion impossible.', { kind: 'bad' });
    });
}

export function openGrant(parentId?: string) {
  grantAccess(parentId)
    .then((picked) => {
      if (picked === null) return;
      if (!picked.length) return toast('Aucun élément choisi.', { kind: 'info' });
      toast(`${picked.length} élément${picked.length > 1 ? 's' : ''} autorisé${picked.length > 1 ? 's' : ''}`, { kind: 'ok' });
    })
    .catch((e: Error) => toast(e instanceof ServiceError && e.code === 'auth-expired' ? 'Session Google expirée : reconnecte-toi d’abord.' : e.message || 'Sélecteur indisponible.', { kind: 'bad' }));
}
