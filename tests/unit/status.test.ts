import { describe, expect, it } from 'vitest';
import { computeGlobalStatus, type AppSnapshot } from '../../src/core/status';
import type { Connectivity, OpEvent } from '../../src/core/types';

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 8, 12);
const ok: Connectivity = { online: true, google: 'connected', supabase: 'reachable' };
const apps = (a: number | undefined, b: number | undefined): AppSnapshot[] => [
  { id: 'race-control', name: 'Race Control', lastVerifiedAt: a, freshnessDays: 7 },
  { id: 'reconversion-control', name: 'Reconversion Control', lastVerifiedAt: b, freshnessDays: 7 },
];
const fail = (source: OpEvent['source'], resolved = false): OpEvent => ({
  id: 'f', at: now - 1000, source, type: 'backup', result: 'failed', durationMs: 10, integrity: 'not-checked', reason: 'Envoi interrompu — connexion perdue.', resolved,
});

describe('état global', () => {
  it('annonce « Tout est vérifié » seulement si tout est récent, vérifié et joignable', () => {
    const s = computeGlobalStatus({ now, connectivity: ok, apps: apps(now - DAY, now - 2 * DAY), queue: [], events: [] });
    expect(s.level).toBe('ok');
    expect(s.title).toBe('Tout est vérifié');
    expect(s.segments.every((x) => x.health === 'verified')).toBe(true);
  });

  it('ne déclare jamais vérifié une source non contactée', () => {
    const s = computeGlobalStatus({ now, connectivity: { ...ok, supabase: 'unknown' }, apps: apps(now - DAY, now - DAY), queue: [], events: [] });
    expect(s.segments.find((x) => x.key === 'supabase')!.health).toBe('unknown');
  });

  it('hors ligne : aucune source réseau n’est affirmée, la file d’attente est annoncée', () => {
    const s = computeGlobalStatus({
      now, connectivity: { online: false, google: 'connected', supabase: 'reachable' }, apps: apps(now - DAY, now - DAY),
      queue: [{ id: 'q', appId: 'race-control', type: 'backup', queuedAt: now, reason: 'offline' }], events: [],
    });
    expect(s.level).toBe('unknown');
    expect(s.title).toBe('Une sauvegarde attend une connexion');
    expect(s.segments.find((x) => x.key === 'drive')!.health).toBe('unknown');
    expect(s.segments.find((x) => x.key === 'race-control')!.health).toBe('pending');
  });

  it('une sauvegarde trop ancienne demande une vérification', () => {
    const s = computeGlobalStatus({ now, connectivity: ok, apps: apps(now - DAY, now - 9 * DAY), queue: [], events: [] });
    expect(s.level).toBe('attention');
    expect(s.segments.find((x) => x.key === 'reconversion-control')!.health).toBe('stale');
    expect(s.issues[0].action?.intent).toEqual({ kind: 'backup', appId: 'reconversion-control' });
  });

  it('un échec non résolu passe en action requise avec « Réessayer »', () => {
    const s = computeGlobalStatus({ now, connectivity: ok, apps: apps(now - DAY, now - DAY), queue: [], events: [fail('race-control')] });
    expect(s.level).toBe('action');
    expect(s.issues[0].action).toEqual({ label: 'Réessayer', intent: { kind: 'retry', appId: 'race-control' } });
    expect(s.issues[0].detail).toContain('connexion perdue');
  });

  it('un échec résolu ne remonte plus', () => {
    const s = computeGlobalStatus({ now, connectivity: ok, apps: apps(now - DAY, now - DAY), queue: [], events: [fail('race-control', true)] });
    expect(s.level).toBe('ok');
  });

  it('session expirée : action de reconnexion en tête', () => {
    const s = computeGlobalStatus({ now, connectivity: { ...ok, google: 'expired' }, apps: apps(now - DAY, now - DAY), queue: [], events: [] });
    expect(s.level).toBe('action');
    expect(s.issues[0].action?.intent).toEqual({ kind: 'reconnect' });
  });

  it('jamais sauvegardée : action requise', () => {
    const s = computeGlobalStatus({ now, connectivity: ok, apps: apps(undefined, now - DAY), queue: [], events: [] });
    expect(s.level).toBe('action');
    expect(s.segments.find((x) => x.key === 'race-control')!.health).toBe('unknown');
  });
});
