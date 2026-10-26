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

function harness(initial: string[], options: { fetch?: () => Promise<unknown>; hit?: boolean; failPut?: boolean } = {}) {
  const names = new Set(initial);
  const deleted: string[] = [];
  const listeners = new Map<string, (event: TestEvent) => void>();
  const matched: string[] = [];
  const written: { cache: string; request: unknown }[] = [];
  let claimed = false;

  const self = {
    location: { origin: 'https://ipoower.github.io' },
    registration: { scope: 'https://ipoower.github.io/Control-Vault/' },
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
      return { addAll: async (_urls: string[]) => {},
        put: async (request: unknown) => { if (options.failPut) throw new Error('Quota fictif'); written.push({ cache: key, request }); },
        match: async (request: string) => { matched.push(key + ':' + request); return options.hit === false ? undefined : { offlineShell: true }; } };
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
    fetch: options.fetch ?? (async () => { throw new Error('Connexion coupée (simulation)'); }),
  });

  return { names, deleted, listeners, matched, written, isClaimed: () => claimed };
}

describe('Service Worker : isolation interprojets', () => {
  it('ne supprime que les ANCIENS caches Control Vault et préserve Race Control et les autres applications', async () => {
    const h = harness(['cv-shell-v0', 'cv-shell-v1', 'cv-shell-v2', 'cv-shell-v3', 'twrc-shell-v17', 'twrc-weather-v4', 'unrelated-cache']);
    const activate = h.listeners.get('activate');
    expect(activate).toBeTypeOf('function');
    let pending: Promise<unknown> | undefined;
    activate?.({ waitUntil: (promise) => { pending = promise; } });
    expect(pending).toBeDefined();
    await pending;

    expect(h.deleted.sort()).toEqual(['cv-shell-v0', 'cv-shell-v1', 'cv-shell-v2']);
    expect([...h.names].sort()).toEqual(['cv-shell-v3', 'twrc-shell-v17', 'twrc-weather-v4', 'unrelated-cache'].sort());
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
    const h = harness(['cv-shell-v3', 'twrc-shell-v17']);
    let response: Promise<unknown> | undefined;
    h.listeners.get('fetch')?.({
      request: { method: 'GET', mode: 'navigate', url: 'https://ipoower.github.io/Control-Vault/' },
      respondWith: (promise) => { response = promise; },
    });
    expect(response).toBeDefined();
    await expect(response).resolves.toEqual({ offlineShell: true });
    expect(h.matched).toEqual(['cv-shell-v3:./index.html']);
    expect(h.deleted).toEqual([]);
  });

  it('ignore les requêtes externes et non GET', () => {
    const h = harness(['cv-shell-v3', 'twrc-shell-v17']);
    let responded = false;
    for (const request of [
      { method: 'POST', mode: 'navigate', url: 'https://ipoower.github.io/Control-Vault/' },
      { method: 'GET', mode: 'navigate', url: 'https://other.example.org/' },
      { method: 'GET', mode: 'navigate', url: 'https://ipoower.github.io/iPoower/' },
      { method: 'GET', mode: 'cors', url: 'https://ipoower.github.io/iPoower/assets/fiction.js' },
    ]) {
      h.listeners.get('fetch')?.({ request, respondWith: () => { responded = true; } });
    }
    expect(responded).toBe(false);
  });

  const response = (ok = true, type = 'text/html') => ({ ok, headers: { get: () => type }, clone() { return this; } });
  const navigation = { method: 'GET', mode: 'navigate', url: 'https://ipoower.github.io/Control-Vault/' };
  async function request(h: ReturnType<typeof harness>, request = navigation) {
    let pending: Promise<unknown> | undefined;
    h.listeners.get('fetch')?.({ request, respondWith: p => { pending = p; } });
    expect(pending).toBeDefined();
    return pending;
  }
  it('attend la mise en cache de l’interface réseau dans son seul cache', async () => {
    const res = response(), h = harness(['twrc-shell-v17'], { fetch: async () => res });
    expect(await request(h)).toBe(res);
    expect(h.written).toEqual([{ cache: 'cv-shell-v3', request: './index.html' }]);
    expect(h.deleted).toEqual([]);
  });
  it('ne remplace pas son interface hors ligne par une erreur HTTP ou une réponse JSON', async () => {
    for (const res of [response(false), response(true, 'application/json')]) {
      const h = harness([], { fetch: async () => res });
      expect(await request(h)).toBe(res);
      expect(h.written).toEqual([]);
    }
  });
  it('ne masque pas une réponse réseau valide si le cache refuse l’écriture', async () => {
    const res = response(), h = harness([], { fetch: async () => res, failPut: true });
    expect(await request(h)).toBe(res);
    expect(h.matched).toEqual([]);
  });
  it('met en cache les assets du seul chemin applicatif et uniquement après réponse valide', async () => {
    const res = response(true, 'text/javascript'), h = harness(['twrc-shell-v17'], { fetch: async () => res, hit: false });
    const asset = { ...navigation, mode: 'cors', url: 'https://ipoower.github.io/Control-Vault/assets/fiction.js' };
    expect(await request(h, asset)).toBe(res);
    expect(h.written).toEqual([{ cache: 'cv-shell-v3', request: asset }]);
    expect(h.matched.every(k => k.startsWith('cv-shell-v3:'))).toBe(true);
  });
  it('ne remplace jamais le shell par une navigation vers /recovery ou un JSON de configuration', () => {
    const h = harness(['cv-shell-v3'], { fetch: async () => response(true, 'text/html') });
    const paths = ['recovery', 'recovery.html', 'drive-config.json', 'fixture-manifest.json'];
    for (const path of paths) {
      let intercepted = false;
      h.listeners.get('fetch')?.({
        request: { method: 'GET', mode: 'navigate', url: 'https://ipoower.github.io/Control-Vault/' + path },
        respondWith: () => { intercepted = true; },
      });
      expect(intercepted, 'le navigateur doit aller directement au réseau pour ' + path).toBe(false);
    }
    expect(h.written).toEqual([]);
  });

});
