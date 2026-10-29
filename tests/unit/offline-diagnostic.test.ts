import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CV_SHELL_CACHE, inspectOfflineElements } from '../../src/services/offline-diagnostic';

const origin = 'https://cv.fixture.test/';
const js = origin + 'assets/app-123.js';
const css = origin + 'assets/app-456.css';
const asset = () => ({ ok: true, redirected: false }) as Response;
const shell = () => ({ ok: true, redirected: false, url: origin, headers: { get: () => 'text/html; charset=utf-8' } }) as unknown as Response;
function fixture() {
  const worker = { state: 'activated', scriptURL: origin + 'sw.js' } as ServiceWorker;
  const registration = { scope: origin, active: worker } as ServiceWorkerRegistration;
  const getRegistration = vi.fn(async () => registration as ServiceWorkerRegistration | undefined);
  const workers = { getRegistration, controller: worker } as unknown as ServiceWorkerContainer;
  const entries = new Map<string, Response>([[origin + 'index.html', shell()], [js, asset()], [css, asset()]]);
  const match = vi.fn(async (key: string, _options: MultiCacheQueryOptions) => entries.get(key));
  const keys = vi.fn(async () => [CV_SHELL_CACHE, 'other-application']);
  const open = vi.fn();
  const storage = { keys, open, match } as unknown as CacheStorage;
  const check = () => inspectOfflineElements(workers, storage, origin, [js, css]);
  return { worker, registration, getRegistration, workers, storage, keys, open, match, entries, check };
}

describe('diagnostic de préparation hors ligne TEST, en lecture seule', () => {
  it('signale seulement les éléments contrôlés sans déclarer la recette iPhone réussie', async () => {
    const f = fixture();
    expect(await f.check()).toBe('local-elements-present');
    expect(f.keys).toHaveBeenCalledOnce();
    expect(f.open).not.toHaveBeenCalled();
    expect(f.match.mock.calls.map(([key]) => key).sort()).toEqual([origin + 'index.html', js, css].sort());
    expect(f.match.mock.calls.every(([, options]) => options.cacheName === CV_SHELL_CACHE)).toBe(true);
    expect(readFileSync('src/main.ts', 'utf8')).toContain('Redémarrage hors ligne à vérifier.');
  });
  it('le nom du cache contrôlé correspond au Service Worker du candidat', () => {
    const worker = readFileSync('public/sw.js', 'utf8');
    expect(worker).toContain("const CACHE_PREFIX = 'cv-shell-';");
    expect(worker).toContain('const VERSION = `${CACHE_PREFIX}v4`;');
    expect(CV_SHELL_CACHE).toBe('cv-shell-v4');
  });
  it('repère l’absence de l’API, de registration, de contrôle ou de service actif', async () => {
    const f = fixture();
    expect(await inspectOfflineElements(undefined, f.storage, origin, [js, css])).toBe('unsupported');
    expect(await inspectOfflineElements(f.workers, undefined, origin, [js, css])).toBe('unsupported');
    f.getRegistration.mockResolvedValueOnce(undefined);
    expect(await f.check()).toBe('not-registered');
    Object.defineProperty(f.registration, 'active', { value: null, configurable: true });
    expect(await f.check()).toBe('not-active');
    Object.defineProperty(f.registration, 'active', { value: f.worker, configurable: true });
    Object.defineProperty(f.workers, 'controller', { value: null, configurable: true });
    expect(await f.check()).toBe('not-controlling');
    expect(f.open).not.toHaveBeenCalled();
  });
  it('rejette une mauvaise origine de service sans toucher au cache', async () => {
    const f = fixture();
    Object.defineProperty(f.worker, 'scriptURL', { value: 'https://elsewhere.fixture.test/sw.js' });
    expect(await f.check()).toBe('wrong-worker');
    expect(f.open).not.toHaveBeenCalled();
  });
  it('ne crée pas le cache manquant', async () => {
    const f = fixture(); f.keys.mockResolvedValueOnce(['other-application']);
    expect(await f.check()).toBe('cache-missing'); expect(f.open).not.toHaveBeenCalled();
  });
  it('refuse une page absente, redirigée, externe ou qui n’est pas du HTML', async () => {
    for (const bad of [undefined, { ...shell(), redirected: true }, { ...shell(), url: 'https://outside.fixture.test/' }, { ...shell(), headers: { get: () => 'application/json' } }]) {
      const f = fixture();
      if (bad) f.entries.set(origin + 'index.html', bad as Response); else f.entries.delete(origin + 'index.html');
      expect(await f.check()).toBe('shell-invalid');
    }
  });
  it('refuse les scripts et styles manquants, redirigés ou hors origine', async () => {
    const f = fixture(); f.entries.delete(css);
    expect(await f.check()).toBe('assets-missing');
    f.entries.set(css, { ...asset(), redirected: true } as Response);
    expect(await f.check()).toBe('assets-missing');
    expect(await inspectOfflineElements(f.workers, f.storage, origin, [js, 'https://outside.fixture.test/assets/a.css'])).toBe('assets-missing');
    expect(await inspectOfflineElements(f.workers, f.storage, origin, [js])).toBe('assets-missing');
  });
  it('signale les erreurs de lecture sans suppression ni correction automatique', async () => {
    const f = fixture(); f.keys.mockRejectedValueOnce(new Error('fixture stockage indisponible'));
    expect(await f.check()).toBe('unavailable'); expect(f.open).not.toHaveBeenCalled();
  });
});
