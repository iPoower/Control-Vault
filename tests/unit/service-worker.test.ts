import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Exécute le VRAI script public/sw.js ; ne se contente pas de recopier la règle de filtrage.
const workerSource = readFileSync('public/sw.js', 'utf8');

type TestEvent = {
  waitUntil?: (promise: Promise<unknown>) => void;
  respondWith?: (promise: Promise<unknown>) => void;
  request?: { method: string; mode: string; url: string };
};

function harness(initial: string[]) {
  const names = new Set(initial);
  const deleted: string[] = [];
  const listeners = new Map<string, (event: TestEvent) => void>();
  const matched: string[] = [];
  let claimed = false;

  const self = {
    location: { origin: 'https://ipoower.github.io' },
    addEventListener: (type: string, fn: (event: TestEvent) => void) => listeners.set(type, fn),
    skipWaiting: () => {},
    clients: { claim: async () => { claimed = true; } },
  };

  const caches = {
    keys: async () => [...names],
    delete: async (key: string) => {
      deleted.push(key);
      return names.delete(key);
    },
    open: async (key: string) => {
      names.add(key);
      return { addAll: async (_urls: string[]) => {}, put: async () => {} };
    },
    match: async (key: string) => {
      matched.push(key);
      return { offlineShell: true };
    },
  };

  runInNewContext(workerSource, {
    self,
    caches,
    URL,
    fetch: async () => { throw new Error('Connexion coupée (simulation)'); },
  });

  return { names, deleted, listeners, matched, isClaimed: () => claimed };
}

describe('Service Worker : isolation interprojets', () => {
  it('ne supprime que les ANCIENS caches Control Vault et préserve Race Control et les autres applications', async () => {
    const h = harness(['cv-shell-v0', 'cv-shell-v1', 'cv-shell-v2', 'twrc-shell-v17', 'twrc-weather-v4', 'unrelated-cache']);
    const activate = h.listeners.get('activate');
    expect(activate).toBeTypeOf('function');
    let pending: Promise<unknown> | undefined;
    activate?.({ waitUntil: (promise) => { pending = promise; } });
    expect(pending).toBeDefined();
    await pending;

    expect(h.deleted.sort()).toEqual(['cv-shell-v0', 'cv-shell-v1']);
    expect([...h.names].sort()).toEqual(['cv-shell-v2', 'twrc-shell-v17', 'twrc-weather-v4', 'unrelated-cache'].sort());
    expect(h.isClaimed()).toBe(true);
  });

  it('ne supprime aucun cache étranger même si le cache Control Vault courant est absent', async () => {
    const h = harness(['twrc-shell-v17', 'third-party-v1']);
    let pending: Promise<unknown> | undefined;
    h.listeners.get('activate')?.({ waitUntil: (promise) => { pending = promise; } });
    await pending;
    expect(h.deleted).toEqual([]);
    expect([...h.names].sort()).toEqual(['third-party-v1', 'twrc-shell-v17']);
  });

  it('utilise encore la page hors ligne en cas d’échec réseau', async () => {
    const h = harness(['cv-shell-v2', 'twrc-shell-v17']);
    let response: Promise<unknown> | undefined;
    h.listeners.get('fetch')?.({
      request: { method: 'GET', mode: 'navigate', url: 'https://ipoower.github.io/Control-Vault/' },
      respondWith: (promise) => { response = promise; },
    });
    expect(response).toBeDefined();
    await expect(response).resolves.toEqual({ offlineShell: true });
    expect(h.matched).toContain('./index.html');
    expect(h.deleted).toEqual([]);
  });

  it('ignore les requêtes externes et non GET', () => {
    const h = harness(['cv-shell-v2', 'twrc-shell-v17']);
    let responded = false;
    for (const request of [
      { method: 'POST', mode: 'navigate', url: 'https://ipoower.github.io/Control-Vault/' },
      { method: 'GET', mode: 'navigate', url: 'https://other.example.org/' },
    ]) {
      h.listeners.get('fetch')?.({ request, respondWith: () => { responded = true; } });
    }
    expect(responded).toBe(false);
  });
});
