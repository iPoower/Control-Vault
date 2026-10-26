// Vrai réseau local et vrai Service Worker ; aucun compte Google ni donnée personnelle.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { expect, test } from '@playwright/test';

test('première visite : le build complet redémarre hors ligne sans second chargement en ligne', async ({ page }) => {
  const root = resolve('dist');
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = createServer(async (req, res) => {
    try {
      const name = new URL(req.url || '/', 'http://localhost').pathname;
      const file = resolve(root, '.' + (name === '/' ? '/index.html' : name));
      if (!file.startsWith(root + '/')) throw Error('path');
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(bytes);
    } catch { res.writeHead(404); res.end('Absent'); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('local server');
  const origin = `http://127.0.0.1:${address.port}`;
  let closed = false;
  try {
    await page.goto(origin + '/');
    await expect(page.locator('#hero-title')).toBeVisible();
    // L'application réserve son auto-enregistrement à HTTPS. Loopback est un
    // contexte sûr : enregistrer explicitement le même fichier sans le modifier.
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>(done => navigator.serviceWorker.addEventListener('controllerchange', () => done(), { once: true }));
    });
    const keys = await page.evaluate(async () => {
      const cache = await caches.open('cv-shell-v4');
      return (await cache.keys()).map(k => new URL(k.url).pathname);
    });
    expect(keys.some(k => /\/assets\/.*\.js$/.test(k)), 'JS du build disponible dès la première installation').toBe(true);
    // Couper le SERVEUR teste une vraie indisponibilité TCP, sans dépendre
    // de l'émulation setOffline de Playwright/WebKit.
    await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); });
    closed = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#hero-title')).toBeVisible();
    await expect(page.getByText('Démonstration : données fictives')).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#hero-title')).toBeVisible();
  } finally {
    if (!closed) await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); });
  }
});
