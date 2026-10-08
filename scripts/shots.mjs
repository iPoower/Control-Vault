// Captures rapides de revue visuelle (local). Usage : node scripts/shots.mjs [base]
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:4173/';
const out = 'screenshots/local';
const browser = await chromium.launch();
const errors = [];
for (const [name, vp, scheme] of [['iphone', { width: 414, height: 896 }, 'dark'], ['desktop', { width: 1440, height: 900 }, 'dark'], ['iphone-light', { width: 414, height: 896 }, 'light']]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: scheme, hasTouch: name.startsWith('iphone'), isMobile: name.startsWith('iphone') });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  for (const [route, file] of [['#/', 'home'], ['#/fichiers', 'files'], ['#/applis', 'apps'], ['#/applis/race-control', 'app-detail'], ['#/historique', 'history'], ['#/securite', 'security'], ['#/reglages', 'settings']]) {
    if (scheme === 'light' && !['home', 'files'].includes(file)) continue;
    await page.goto(base + route);
    await page.waitForTimeout(1300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) errors.push(`${name} ${file}: débordement horizontal ${overflow}px`);
    await page.screenshot({ path: `${out}/${name}-${file}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'aucune erreur');
