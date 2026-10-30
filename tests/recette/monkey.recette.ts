// Recette Phase T — robustesse : session de clics aléatoires (« monkey », façon gremlins.js, écrit ici).
// Éléments visibles au hasard, textes aléatoires dans les champs, touches clavier, tapes à des
// coordonnées aléatoires. Toute navigation externe est bloquée (routes) ; les onglets ouverts sont fermés.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ORIGIN } from './fake-google';
import { inventory, rng, SAMPLE_TEXTS } from './explore';
import { clearOrigin, isIphone, openApp, startSession } from './session';

const DURATION = Number(process.env.RECETTE_MONKEY_MS || 5 * 60_000);
const HASHES = ['#/', '#/drive', '#/fichiers', '#/applis', '#/historique', '#/securite', '#/reglages'];
const KEYS = ['Escape', 'Tab', 'Shift+Tab', 'Enter', 'Space', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', '?', 'g', 'f', 'h', '/', 'Control+k'];

test('monkey : clics aléatoires pendant ' + Math.round(DURATION / 60000) + ' min', async ({ context, page }, info) => {
  test.setTimeout(DURATION + 5 * 60_000);
  const { rec, fake, stop } = await startSession(context, page, info, 'monkey');
  const seed = Number(process.env.RECETTE_SEED || 20261029) + (isIphone(info) ? 1 : 0);
  const rand = rng(seed), pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const packet = readFileSync('tests/fixtures/race-owner/business-61.json');
  const log: { n: number; t: number; action: string; url: string; errors: number }[] = [];
  const counts: Record<string, number> = {};
  let n = 0, recoveries = 0;
  page.on('popup', (p: Page) => { void p.close().catch(() => {}); });
  page.on('filechooser', (c) => { void (rand() < 0.5 ? c.setFiles({ name: 'monkey.json', mimeType: 'application/json', buffer: rand() < 0.5 ? packet : Buffer.from(String(rand())) }) : c.setFiles([])).catch(() => {}); });
  page.on('download', (d) => { void d.cancel().catch(() => {}); });
  const t0 = Date.now();
  try {
    await clearOrigin(page); await openApp(page, '#/');
    while (Date.now() - t0 < DURATION) {
      n++;
      let action = '';
      const before = rec.errors.length;
      rec.context = `monkey #${n}`;
      try {
        if (!page.url().startsWith(ORIGIN + '/') || page.url().includes('drive-config.json')) { recoveries++; action = 'retour sur l’application'; await openApp(page, pick(HASHES)); }
        else {
          const r = rand();
          if (r < 0.62) {
            const els = (await inventory(page)).filter((e) => !e.disabled);
            if (!els.length) { action = 'aucun élément : Échap'; await page.keyboard.press('Escape'); }
            else {
              const e = pick(els);
              action = `clic ${e.kind} « ${e.label} »`;
              const loc = page.locator(`[data-recette-idx="${e.idx}"]`);
              if (/^champ:(text|search|email|url|tel|password|number)$|^zone-texte$/.test(e.kind)) { const t = pick(SAMPLE_TEXTS); action = `saisie « ${t.slice(0, 30)} » dans « ${e.label} »`; await loc.fill(t, { timeout: 2000 }); }
              else await loc.click({ timeout: 2000, trial: false });
            }
          } else if (r < 0.75) {
            const vp = page.viewportSize() ?? { width: 400, height: 800 };
            const x = Math.floor(rand() * vp.width), y = Math.floor(rand() * vp.height);
            action = `tape (${x}, ${y})`;
            if (isIphone(info)) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
          } else if (r < 0.88) {
            const k = pick(KEYS); action = 'touche ' + k; await page.keyboard.press(k);
          } else if (r < 0.95) {
            const dy = Math.floor((rand() - 0.3) * 1500); action = 'défilement ' + dy; await page.mouse.wheel(0, dy).catch(() => page.evaluate((d) => scrollBy(0, d), dy));
          } else if (r < 0.98) {
            const h = pick(HASHES); action = 'adresse ' + h; await page.evaluate((x) => { location.hash = x; }, h);
          } else {
            action = 'retour arrière'; await page.goBack({ timeout: 3000 }).catch(() => {});
          }
        }
      } catch (e) { action += ' (sans effet : ' + String((e as Error).message).split('\n')[0].slice(0, 80) + ')'; }
      await page.waitForTimeout(120 + Math.floor(rand() * 200));
      const kind = action.split(' ')[0]; counts[kind] = (counts[kind] ?? 0) + 1;
      log.push({ n, t: Date.now() - t0, action, url: page.url().replace(ORIGIN, ''), errors: rec.errors.length - before });
      if (rec.errors.length > before || n % 25 === 0) await rec.shot(page, `${n} ${action}`);
    }
    // L'application doit rester utilisable après la session.
    rec.context = 'monkey › contrôle final';
    await openApp(page, '#/');
    await expect(page.locator('#main h1').first()).toBeVisible();
    await rec.shot(page, 'contrôle final');
  } finally {
    rec.write('monkey', { browser: rec.browser, seed, durationMs: Date.now() - t0, actions: n, recoveries, counts,
      googleCalls: fake.googleCalls.length, blockedOrigins: [...new Set(fake.blocked.map((b) => { try { return new URL(b.url).origin; } catch { return b.url; } }))],
      errorActions: log.filter((l) => l.errors), last: log.slice(-60) });
    rec.write('monkey-errors', rec.errors);
    await stop();
  }
});
