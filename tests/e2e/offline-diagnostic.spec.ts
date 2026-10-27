// Rendu de la version TEST avec stockage fictif ; aucun Google ni donnée réelle.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
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

for (const scenario of ['registration-refused', 'cache-missing', 'local-elements-present'] as const) {
  test(`diagnostic hors ligne TEST : ${scenario}`, async ({ page }) => {
    await page.addInitScript((mode) => {
      const scope = 'https://cv.fixture.test/';
      const worker = { state: 'activated', scriptURL: scope + 'sw.js', addEventListener() {} };
      const registration = { scope, active: worker, installing: null, addEventListener() {} };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
        controller: mode === 'registration-refused' ? null : worker,
        getRegistration: async () => mode === 'registration-refused' ? undefined : registration,
        register: async () => { if (mode === 'registration-refused') throw Error('fixture refused'); return registration; },
        addEventListener() {},
      } });
      Object.defineProperty(window, 'caches', { configurable: true, value: {
        keys: async () => mode === 'cache-missing' ? [] : ['cv-shell-v4'],
        match: async (key: string) => key.endsWith('/index.html')
          ? { ok: true, redirected: false, url: scope, headers: { get: () => 'text/html' } }
          : { ok: true, redirected: false },
      } });
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
    const expected = scenario === 'registration-refused' ? 'not-registered' : scenario;
    await expect(diagnostic).toHaveAttribute('data-diagnostic', expected);
    if (scenario === 'local-elements-present') await expect(diagnostic).toContainText('Redémarrage hors ligne à vérifier.');
    else await expect(diagnostic).not.toContainText('service actif et fichiers');
  });
}
