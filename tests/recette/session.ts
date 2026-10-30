// Recette Phase T — préparation d'une session navigateur (Google simulé, PWA iPhone, trace).
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { join } from 'node:path';
import { installFakeGoogle, ORIGIN, STANDALONE_INIT, type FakeOptions } from './fake-google';
import { OUT, Recorder } from './recorder';

export const isIphone = (info: TestInfo) => /iphone/.test(info.project.name);

export async function startSession(context: BrowserContext, page: Page, info: TestInfo, phase: string, options: FakeOptions = {}) {
  const rec = new Recorder(Recorder.browserName(info), phase);
  if (isIphone(info)) await context.addInitScript(STANDALONE_INIT);
  const fake = await installFakeGoogle(context, options);
  // Parcours : film d'écran + instantanés DOM. Exploration / monkey : instantanés DOM seulement
  // (une capture JPEG par étape est déjà enregistrée), sinon les traces dépassent le giga-octet.
  await context.tracing.start({ screenshots: phase === 'parcours', snapshots: true, title: `recette ${rec.browser} ${phase}` });
  rec.attach(page);
  context.on('page', (p) => { if (p !== page) { rec.attach(p); } });
  const stop = async () => {
    await context.tracing.stop({ path: join(OUT, 'traces', `${rec.browser}-${phase}.zip`) }).catch(() => {});
  };
  return { rec, fake, stop };
}

/** Vide le stockage de l'origine fictive (page JSON sans script ni connexion IndexedDB ouverte). */
export async function clearOrigin(page: Page) {
  await page.goto(ORIGIN + '/drive-config.json');
  await page.evaluate(async () => {
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* indisponible */ }
    try {
      const names = typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((d) => d.name).filter(Boolean) as string[] : [];
      await Promise.all(names.map((n) => new Promise<void>((done) => { const r = indexedDB.deleteDatabase(n); r.onsuccess = r.onerror = r.onblocked = () => done(); })));
    } catch { /* indisponible */ }
  });
}

/** Ouvre l'application sur un écran et attend le premier rendu réel. */
export async function openApp(page: Page, hash = '#/') {
  await page.goto(ORIGIN + '/' + hash);
  await expect(page.locator('#main .boot')).toHaveCount(0);
}

/** Attend que le DOM se stabilise (fin des transitions et des réponses du faux Drive). */
export async function settle(page: Page, max = 4000) {
  await page.evaluate(async (limit) => {
    let n = 0; const o = new MutationObserver((l) => { n += l.length; });
    o.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const start = performance.now(); let last = -1, stable = 0;
    while (performance.now() - start < limit) {
      await new Promise((r) => setTimeout(r, 150));
      if (n === last) { if (++stable >= 2 && performance.now() - start > 300) break; } else { stable = 0; last = n; }
    }
    o.disconnect();
  }, max).catch(() => {});
}
