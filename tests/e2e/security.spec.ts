// Tests de sécurité exécutés dans les vrais moteurs (Chromium et WebKit).
import { expect, test } from '@playwright/test';
import { open } from './helpers';

test.describe('Sécurité', () => {
  test('Isolation : deux origines distinctes ne partagent pas le stockage local', async ({ browser }) => {
    // 127.0.0.1 et 127.0.0.2 sont deux origines différentes, comme ipoower.github.io et un
    // sous-domaine Cloudflare dédié. Ce que l'une écrit, l'autre ne le voit pas.
    const ctx = await browser.newContext();
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await a.goto('http://127.0.0.1:4173/');
    await b.goto('http://127.0.0.2:4173/');
    await a.evaluate(() => localStorage.setItem('isolation-test', 'origine-A'));
    expect(await a.evaluate(() => localStorage.getItem('isolation-test'))).toBe('origine-A');
    expect(await b.evaluate(() => localStorage.getItem('isolation-test'))).toBeNull();
    expect(await b.evaluate(() => Object.keys(localStorage).filter((k) => !k.startsWith('control-vault:')))).toEqual([]);
    await ctx.close();
  });

  test('CSP active : un script injecté dans la page ne s’exécute pas', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(
      () =>
        new Promise<{ ran: boolean; violation: string | null }>((resolve) => {
          let violation: string | null = null;
          document.addEventListener('securitypolicyviolation', (e) => (violation = e.effectiveDirective), { once: true });
          const s = document.createElement('script');
          s.textContent = 'window.__injected = true;';
          document.body.appendChild(s);
          setTimeout(() => resolve({ ran: (window as unknown as { __injected?: boolean }).__injected === true, violation }), 300);
        }),
    );
    expect(result.ran).toBe(false);
    expect(result.violation).toMatch(/script-src/);
  });

  test('Aucun identifiant de dossier Drive ni connexion Google dans l’application publiée', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await open(page);
    for (const hash of ['#/', '#/fichiers', '#/securite', '#/reglages']) {
      await page.goto(`./${hash}`);
      await page.waitForTimeout(300);
      expect(await page.content()).not.toMatch(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\//);
    }
    // Aucune requête ne quitte l'origine : pas de Google, pas de Supabase, pas de police externe.
    const external = requests.filter((u) => !u.startsWith('http://127.0.0.1:4173/') && !u.startsWith('data:') && !u.startsWith('blob:'));
    expect(external).toEqual([]);
  });

  test('La démonstration reste signalée et aucune donnée réelle n’est affichée', async ({ page }) => {
    await open(page, '#/reglages');
    await expect(page.getByText(/aucun dossier n’est enregistré dans le code/i)).toBeVisible();
    await page.goto('./#/');
    await expect(page.getByText('Démonstration : données fictives')).toBeVisible();
  });

  test('version.json identifie le build publié', async ({ request }) => {
    const res = await request.get('./version.json');
    expect(res.ok()).toBe(true);
    const v = await res.json();
    expect(v.app).toBe('control-vault');
    expect(v.sha).toMatch(/^([0-9a-f]{40}|local)$/);
  });
});
