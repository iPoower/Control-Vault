// Rendu de la version TEST avec stockage fictif ; aucun Google ni donnée réelle.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

let root: string;
test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'cv-offline-diagnostic-fixture-'));
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'fortress-test'], {
    env: { ...process.env, VAULT_OUT: root, GOOGLE_DRIVE_CONFIG: '' }, timeout: 90000, stdio: 'pipe',
  });
});

for (const scenario of ['registration-refused', 'cache-missing', 'local-elements-present', 'storage-denied', 'worker-denied', 'registration-stalled'] as const) {
  test(`diagnostic hors ligne TEST : ${scenario}`, async ({ page }) => {
    await page.addInitScript((mode) => {
      const scope = 'https://cv.fixture.test/';
      const worker = { state: 'activated', scriptURL: scope + 'sw.js', addEventListener() {} };
      const registration = { scope, active: worker, installing: null, addEventListener() {} };
      const workerFixture = {
        controller: mode === 'registration-refused' ? null : worker,
        getRegistration: async () => mode === 'registration-stalled' ? new Promise(() => {}) : mode === 'registration-refused' ? undefined : registration,
        register: async () => { if (mode === 'registration-refused') throw Error('fixture refused'); return registration; },
        addEventListener() {},
      };
      if (mode === 'worker-denied') Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get() { throw Error('fixture denied'); } });
      else Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: workerFixture });
      const cacheFixture = {
        keys: async () => mode === 'cache-missing' ? [] : ['cv-shell-v4'],
        match: async (key: string) => key.endsWith('/index.html')
          ? { ok: true, redirected: false, url: scope, headers: { get: () => 'text/html' } }
          : { ok: true, redirected: false },
      };
      if (mode === 'storage-denied') Object.defineProperty(window, 'caches', { configurable: true, get() { throw Error('fixture denied'); } });
      else Object.defineProperty(window, 'caches', { configurable: true, value: cacheFixture });
    }, scenario);
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://cv.fixture.test') return route.abort();
      const filename = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      if (!filename.startsWith(root + '/')) return route.abort();
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
      try { await route.fulfill({ status: 200, contentType: types[extname(filename)] || 'application/octet-stream', body: readFileSync(filename) }); }
      catch { await route.fulfill({ status: 404, body: 'fixture absente' }); }
    });
    await page.goto('https://cv.fixture.test/');
    await expect(page.locator('#hero-title')).toBeVisible();
    const diagnostic = page.locator('#offline-diagnostic');
    const expected = scenario === 'registration-refused' ? 'not-registered' : (scenario === 'storage-denied' || scenario === 'worker-denied' || scenario === 'registration-stalled') ? 'unavailable' : scenario;
    await expect(diagnostic).toHaveAttribute('data-diagnostic', expected, { timeout: 10000 });
    if (scenario === 'local-elements-present') await expect(diagnostic).toContainText('Redémarrage hors ligne à vérifier.');
    else await expect(diagnostic).not.toContainText('service actif et fichiers');
  });
}

test('diagnostic : Service Worker et CacheStorage natifs, puis rechargement sans réseau', async ({ page }) => {
  test.setTimeout(60000);
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const filename = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!filename.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
    try { res.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(readFileSync(filename)); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture server');
  const origin = `http://127.0.0.1:${address.port}`;
  let closed = false;
  try {
    await page.goto(origin + '/');
    await expect(page.locator('#hero-title')).toBeVisible();
    // Sur loopback HTTP, l'application ne s'auto-enregistre pas. C'est le vrai
    // fichier du build ; enregistrer ici explicitement pour tester le cache natif.
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>((done) => navigator.serviceWorker.addEventListener('controllerchange', () => done(), { once: true }));
      localStorage.setItem('fixture-cv-diagnostic', 'fictif');
    });
    const nativeState = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration(new URL('./', location.href).href);
      return { expectedScope: new URL('./', location.href).href, actualScope: reg?.scope, activeState: reg?.active?.state,
        activeScript: reg?.active?.scriptURL, controllerState: navigator.serviceWorker.controller?.state, controllerScript: navigator.serviceWorker.controller?.scriptURL };
    });
    console.log('NATIVE_WORKER_DIAGNOSTIC', JSON.stringify(nativeState));
    await expect(page.locator('#offline-diagnostic')).toHaveAttribute('data-diagnostic', 'local-elements-present', { timeout: 15000 });
    await new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); });
    closed = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#hero-title')).toBeVisible();
    await expect(page.locator('#offline-diagnostic')).toHaveAttribute('data-diagnostic', 'local-elements-present');
    await expect(page.locator('#offline-diagnostic')).toContainText('Redémarrage hors ligne à vérifier.');
    expect(await page.evaluate(() => localStorage.getItem('fixture-cv-diagnostic'))).toBe('fictif');
  } finally {
    if (!closed) await new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); });
  }
});
