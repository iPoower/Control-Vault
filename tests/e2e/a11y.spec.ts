// Accessibilité automatique (axe-core) sur chaque écran, en thème sombre et clair.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { open } from './helpers';

const SCREENS = ['#/', '#/fichiers', '#/applis', '#/applis/race-control', '#/historique', '#/securite', '#/reglages'];

for (const scheme of ['dark', 'light'] as const) {
  test(`WCAG 2.2 AA — thème ${scheme === 'dark' ? 'sombre' : 'clair'}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const hash of SCREENS) {
      await open(page, hash);
      await page.waitForTimeout(500);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const serious = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${hash} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
    }
  });
}

test('Feuille de restauration accessible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '#/applis/race-control');
  await page.locator('.versions .row').nth(2).click();
  await expect(page.locator('dialog.sheet[open]').getByText('Ce qui changera')).toBeVisible({ timeout: 8000 });
  const res = await new AxeBuilder({ page }).include('dialog.sheet').withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});
