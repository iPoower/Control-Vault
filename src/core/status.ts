// Calcul de l'état global affiché au centre du tableau de bord.
// Règle d'or : on n'affirme jamais qu'une donnée est à jour sans preuve vérifiée et récente.

import type { AppId, Connectivity, Health, OpEvent, PendingOp } from './types';

export type Level = 'ok' | 'attention' | 'action' | 'unknown';

export interface AppSnapshot {
  id: AppId;
  name: string;
  /** Date de la dernière sauvegarde dont l'intégrité distante a été vérifiée. */
  lastVerifiedAt?: number;
  freshnessDays: number;
}

export interface Segment {
  key: 'drive' | 'supabase' | AppId;
  label: string;
  health: Health;
  detail: string;
}

export type IntentKind =
  | { kind: 'reconnect' }
  | { kind: 'retry'; appId: AppId }
  | { kind: 'backup'; appId: AppId }
  | { kind: 'run-queue' }
  | { kind: 'open-security' };

export interface Issue {
  id: string;
  severity: 'action' | 'attention';
  title: string;
  detail: string;
  action?: { label: string; intent: IntentKind };
}

export interface GlobalStatus {
  level: Level;
  title: string;
  detail: string;
  segments: Segment[];
  issues: Issue[];
  lastVerifiedAt?: number;
}

export interface StatusInput {
  now: number;
  connectivity: Connectivity;
  apps: AppSnapshot[];
  queue: PendingOp[];
  events: OpEvent[];
}

const DAY = 86_400_000;

export function appHealth(app: AppSnapshot, now: number, hasOpenFailure: boolean, queued: boolean): Health {
  if (hasOpenFailure) return 'failed';
  if (queued) return 'pending';
  if (!app.lastVerifiedAt) return 'unknown';
  return now - app.lastVerifiedAt <= app.freshnessDays * DAY ? 'verified' : 'stale';
}

export function openFailures(events: OpEvent[]): OpEvent[] {
  return events.filter((e) => e.result === 'failed' && !e.resolved);
}

export function computeGlobalStatus({ now, connectivity, apps, queue, events }: StatusInput): GlobalStatus {
  const issues: Issue[] = [];
  const failures = openFailures(events);
  const { online, google, supabase } = connectivity;

  // Sources d'infrastructure
  const driveHealth: Health = !online ? 'unknown' : google === 'connected' ? 'verified' : google === 'expired' ? 'failed' : 'unknown';
  const driveDetail = !online
    ? 'Non vérifiable hors ligne'
    : google === 'connected'
      ? 'Connexion vérifiée'
      : google === 'expired'
        ? 'Session expirée'
        : 'Non connecté';
  const supaHealth: Health = !online ? 'unknown' : supabase === 'reachable' ? 'verified' : supabase === 'unreachable' ? 'failed' : 'unknown';
  const supaDetail = !online ? 'Non vérifiable hors ligne' : supabase === 'reachable' ? 'Répond normalement' : supabase === 'unreachable' ? 'Ne répond pas' : 'Pas encore contacté';

  const segments: Segment[] = [
    { key: 'drive', label: 'Google Drive', health: driveHealth, detail: driveDetail },
    { key: 'supabase', label: 'Supabase', health: supaHealth, detail: supaDetail },
  ];

  if (online && google === 'expired') {
    issues.push({
      id: 'google-expired',
      severity: 'action',
      title: 'Session Google expirée',
      detail: 'Les sauvegardes ne peuvent pas être envoyées tant que tu ne t’es pas reconnecté.',
      action: { label: 'Se reconnecter', intent: { kind: 'reconnect' } },
    });
  } else if (online && google === 'disconnected') {
    issues.push({
      id: 'google-disconnected',
      severity: 'action',
      title: 'Google Drive n’est pas connecté',
      detail: 'Connecte ton compte pour accéder au dossier Control Vault.',
      action: { label: 'Connecter Google Drive', intent: { kind: 'reconnect' } },
    });
  }

  if (online && supabase === 'unreachable') {
    issues.push({
      id: 'supabase-down',
      severity: 'attention',
      title: 'Historique distant indisponible',
      detail: 'Supabase ne répond pas. Les sauvegardes restent possibles ; le journal sera complété à son retour.',
    });
  }

  let latest: number | undefined;
  for (const app of apps) {
    const failure = failures.find((f) => f.source === app.id);
    const queued = queue.some((q) => q.appId === app.id);
    const health = appHealth(app, now, !!failure, queued);
    if (app.lastVerifiedAt && (!latest || app.lastVerifiedAt > latest)) latest = app.lastVerifiedAt;

    const detail =
      health === 'failed'
        ? 'Dernière tentative échouée'
        : health === 'pending'
          ? 'En attente de connexion'
          : health === 'unknown'
            ? 'Aucune sauvegarde vérifiée'
            : health === 'stale'
              ? `Plus de ${app.freshnessDays} jours sans sauvegarde`
              : 'Sauvegarde récente vérifiée';
    segments.push({ key: app.id, label: app.name, health, detail });

    if (failure) {
      issues.push({
        id: `fail-${app.id}`,
        severity: 'action',
        title: `Sauvegarde de ${app.name} échouée`,
        detail: failure.reason ?? 'La dernière tentative n’a pas abouti.',
        action: online ? { label: 'Réessayer', intent: { kind: 'retry', appId: app.id } } : undefined,
      });
    } else if (!queued && health === 'unknown') {
      issues.push({
        id: `none-${app.id}`,
        severity: 'action',
        title: `${app.name} n’a aucune sauvegarde vérifiée`,
        detail: 'Lance une première sauvegarde pour pouvoir restaurer en cas de besoin.',
        action: { label: 'Sauvegarder', intent: { kind: 'backup', appId: app.id } },
      });
    } else if (!queued && health === 'stale') {
      issues.push({
        id: `stale-${app.id}`,
        severity: 'attention',
        title: `Sauvegarde de ${app.name} à rafraîchir`,
        detail: `La dernière version vérifiée date de plus de ${app.freshnessDays} jours.`,
        action: { label: 'Sauvegarder', intent: { kind: 'backup', appId: app.id } },
      });
    }
  }

  if (queue.length) {
    issues.push({
      id: 'queue',
      severity: 'attention',
      title: queue.length > 1 ? `${queue.length} sauvegardes attendent` : 'Une sauvegarde attend',
      detail: online ? 'La connexion est revenue : tu peux la lancer maintenant.' : 'Elle partira dès le retour du réseau, à ta demande.',
      action: online && google === 'connected' ? { label: 'Lancer maintenant', intent: { kind: 'run-queue' } } : undefined,
    });
  }

  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'action' ? -1 : 1));

  // Titre central
  let level: Level;
  let title: string;
  let detail: string;
  if (!online) {
    level = 'unknown';
    title = queue.length ? 'Une sauvegarde attend une connexion' : 'Hors ligne';
    detail = 'L’état de Drive et de Supabase sera vérifié au retour du réseau.';
  } else if (issues.some((i) => i.severity === 'action')) {
    level = 'action';
    const first = issues.find((i) => i.severity === 'action')!;
    title = issues.filter((i) => i.severity === 'action').length > 1 ? 'Plusieurs points demandent ton attention' : first.title;
    detail = first.detail;
  } else if (issues.length) {
    level = 'attention';
    title = issues.length > 1 ? 'Vérification requise' : issues[0].title;
    detail = issues[0].detail;
  } else {
    level = 'ok';
    title = 'Tout est vérifié';
    detail = 'Chaque application a une sauvegarde récente dont l’empreinte correspond.';
  }

  return { level, title, detail, segments, issues, lastVerifiedAt: latest };
}
