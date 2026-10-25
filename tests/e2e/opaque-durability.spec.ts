import { readFileSync } from 'node:fs';
import { test, expect, chromium, webkit, type BrowserContext } from '@playwright/test';
import { build } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packetFixture } from '../fixtures/race-packet';

// Tout le code métier exercé est celui de src/. Le harness ne change pas l'app.
let runtime: string;
test.beforeAll(async () => {
  const output = await build({ configFile: false, logLevel: 'silent', build: { write: false, target: 'es2022', minify: false,
    lib: { entry: resolve('tests/fixtures/opaque-runtime.ts'), name: 'CVPacketTest', formats: ['iife'] } } });
  const result = Array.isArray(output) ? output[0] : output;
  if (!('output' in result)) throw new Error('Bundle de test absent');
  const chunk = result.output.find(x => x.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Code de test absent');
  runtime = chunk.code;
});
const origin = 'https://vault-packet.fixture.test';
async function route(context: BrowserContext) {
  await context.route(origin + '/**', async r => {
    const script = new URL(r.request().url()).pathname === '/runtime.js';
    await r.fulfill({ contentType: script ? 'text/javascript' : 'text/html', headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" },
      body: script ? runtime : '<!doctype html><html><head><title>Fixture opaque</title><script src="/runtime.js"></script></head><body></body></html>' });
  });
}

test('paquets opaques : fermeture du navigateur, réouverture, deux versions et relecture indépendante', async ({ browserName }, info) => {
  const root = await mkdtemp(join(tmpdir(), 'cv-opaque-')), bytesA = await packetFixture(120), bytesB = await packetFixture(61);
  const engine = browserName === 'webkit' ? webkit : chromium;
  const options = { headless: true, serviceWorkers: 'block' as const, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch, isMobile: info.project.use.isMobile };
  let context: BrowserContext | undefined;
  try {
    context = await engine.launchPersistentContext(root, options); await route(context);
    let page = await context.newPage(); await page.goto(origin);
    const saved = await page.evaluate(async ([a, b]) => {
      const api = (window as any).CVPacketTest, first = new api.OpaqueArchive(), second = new api.OpaqueArchive();
      const one = await api.readRacePacket(new Uint8Array(a)), two = await api.readRacePacket(new Uint8Array(b));
      const [x, y] = await Promise.all([first.save(one), second.save(one)]);
      await first.save(two);
      const list = await first.list();
      await Promise.all([first.close(), second.close()]);
      return { ids: list.map((p: any) => p.id).sort(), states: list.map((p: any) => p.state), same: x.id === y.id };
    }, [[...bytesA.bytes], [...bytesB.bytes]]);
    expect(saved.same).toBe(true); expect(saved.ids).toEqual([bytesA.hash, bytesB.hash].sort());
    expect(saved.states).toEqual(['local-only', 'local-only']);
    await context.close(); context = undefined; // processus navigateur fermé, pas seulement reload
    context = await engine.launchPersistentContext(root, options); await route(context);
    page = await context.newPage(); await page.goto(origin);
    const restored = await page.evaluate(async () => {
      const archive = new (window as any).CVPacketTest.OpaqueArchive(), rows = await archive.list(), result = [];
      for (const row of rows) result.push({ id: row.id, bytes: [...(await archive.read(row.id)).copyBytes()] });
      await archive.close(); return result;
    });
    expect(restored.map(x => x.id).sort()).toEqual(saved.ids);
    for (const fixture of [bytesA, bytesB]) {
      const row = restored.find(x => x.id === fixture.hash)!;
      expect(new Uint8Array(row.bytes)).toEqual(fixture.bytes);
      // Déchiffrement seulement dans l'adaptateur de test propriétaire, jamais dans Vault.
      expect(await fixture.decrypt(new Uint8Array(row.bytes))).toBe(fixture.clear);
    }
  } finally { await context?.close(); await rm(root, { recursive: true, force: true }); }
});

test('quota et corruption : aucune version précédente supprimée, aucun catalogue faussement vérifié', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' }); await route(context);
  const fixture = await packetFixture();
  try {
    const page = await context.newPage(); await page.goto(origin);
    const result = await page.evaluate(async raw => {
      const api = (window as any).CVPacketTest, archive = new api.OpaqueArchive();
      const packet = await api.readRacePacket(new Uint8Array(raw)); await archive.save(packet);
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function () { throw new DOMException('Quota fictif', 'QuotaExceededError'); };
      let quota = false;
      try {
        const e = JSON.parse(new TextDecoder().decode(new Uint8Array(raw))); e.createdAt = '2026-10-20T10:00:00.000Z';
        const other = await api.readRacePacket(new TextEncoder().encode(JSON.stringify(e)));
        await archive.save(other);
      } catch { quota = true; } finally { IDBObjectStore.prototype.add = add; }
      const ids = (await archive.list()).map((r: any) => r.id);
      await archive.close();
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(api.OPAQUE_DB, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(); });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('packets', 'readwrite'), store = tx.objectStore('packets'), get = store.get(packet.info.fileSha256);
        get.onsuccess = () => { const row = get.result; row.bytes[0] ^= 1; store.put(row); };
        tx.oncomplete = () => resolve(); tx.onerror = () => reject();
      }); db.close();
      let refused = false;
      try { await archive.list(); } catch { refused = true; }
      // Le refus ne purge pas la ligne corrompue ou d'autres applications.
      const db2 = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open(api.OPAQUE_DB, 1); request.onsuccess = () => resolve(request.result); });
      const count = await new Promise<number>(resolve => { const request = db2.transaction('packets').objectStore('packets').count(); request.onsuccess = () => resolve(request.result); });
      db2.close(); await archive.close(); return { quota, ids, refused, count };
    }, [...fixture.bytes]);
    expect(result).toEqual({ quota: true, ids: [fixture.hash], refused: true, count: 1 });
  } finally { await context.close(); }
});


test('DriveStore natif : abort, connexion close, versionchange et récupération préservée', async ({ browser }) => {
  const context=await browser.newContext({serviceWorkers:'block'});await route(context);
  try {
    const page=await context.newPage();await page.goto(origin);
    const result=await page.evaluate(readFileSync('tests/fixtures/native-drive-store.js','utf8')) as any;
    expect(result.aborted).toBe(true);expect(result.closedRejected).toBe(true);
    for(const key of ['afterAbort','afterReopen','afterVersionChange'])expect(result[key]).toEqual(result.expected);
    expect(result.recoveryHash).toMatch(/^[0-9a-f]{64}$/);expect(result.recovery).toEqual([9,8,7,0,255]);
  } finally {await context.close();}
});
