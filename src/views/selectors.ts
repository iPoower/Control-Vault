import { lastVerified } from '../app';
import { computeDriveStatus } from '../core/drive-status';
import { computeGlobalStatus, type IntentKind } from '../core/status';
import { connectGoogle, openGrant } from './drive-actions';
import type { State } from '../core/store';
import type { AppId } from '../core/types';
import { openBackup } from '../flows/sheets';
import { reconnectGoogle, store } from '../app';
import { toast } from '../ui/overlay';

export function globalStatus(s: State) {
  if (s.mode === 'drive') return computeDriveStatus(s.drive, s.connectivity.online, Date.now());
  return computeGlobalStatus({
    now: Date.now(),
    connectivity: s.connectivity,
    apps: (Object.keys(s.apps) as AppId[]).map((id) => ({
      id,
      name: s.apps[id].name,
      lastVerifiedAt: lastVerified(id)?.createdAt,
      freshnessDays: s.apps[id].freshnessDays,
    })),
    queue: s.queue,
    events: s.events,
  });
}

export async function runIntent(intent: IntentKind, navigate: (h: string) => void) {
  switch (intent.kind) {
    case 'reconnect':
      if (store.get().mode === 'drive') return connectGoogle();
      await reconnectGoogle();
      toast('Connexion Google rétablie', { kind: 'ok' });
      break;
    case 'retry':
    case 'backup':
      openBackup(intent.appId);
      break;
    case 'run-queue': {
      const first = store.get().queue[0];
      if (first) openBackup(first.appId);
      break;
    }
    case 'grant':
      openGrant();
      break;
    case 'open-security':
      navigate('#/securite');
      break;
  }
}
