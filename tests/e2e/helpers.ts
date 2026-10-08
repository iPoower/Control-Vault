import { expect, type Page, type TestInfo } from '@playwright/test';

/** Ouvre l'app et attend le premier rendu réel (pas seulement le chargement de la page). */
export async function open(page: Page, hash = '#/') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`./${hash}`);
  await expect(page.locator('#main .boot')).toHaveCount(0);
  return errors;
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'débordement horizontal').toBeLessThanOrEqual(0);
}

export const isMobile = (testInfo: TestInfo) => /iphone/.test(testInfo.project.name);

/** Navigation par l'interface réelle : barre d'onglets sur mobile, barre latérale sur bureau. */
export async function go(page: Page, label: string, testInfo: TestInfo) {
  const nav = isMobile(testInfo) ? page.locator('.tabbar') : page.locator('.sidebar');
  const mobileLabel = label === 'Applications' ? 'Applis' : label;
  if (isMobile(testInfo) && label === 'Sécurité') {
    await nav.getByRole('link', { name: 'Réglages' }).click();
    await page.locator('#main').getByRole('link', { name: /Chiffrement, permissions/ }).click();
    return;
  }
  await nav.getByRole('link', { name: isMobile(testInfo) ? mobileLabel : label, exact: true }).click();
}

export async function shot(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForTimeout(350); // fin des transitions
  // caret: 'initial' : sinon Playwright injecte une feuille de style que la CSP stricte refuse (WebKit le signale).
  await page.screenshot({ path: `screenshots/${testInfo.project.name}/${name}.png`, fullPage: false, caret: 'initial' });
}

export async function scenario(page: Page, testInfo: TestInfo, label: string) {
  await go(page, 'Réglages', testInfo);
  await page.getByRole('radio', { name: new RegExp(label) }).check();
}
