// Recette Phase T — parcours utilisateur complet, cliqué comme un utilisateur.
// connexion (Google simulé) → choix du dossier → liste des versions → « Vérifier et télécharger ».
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FAKE_ACCOUNT, FOLDER_ID, FOLDER_NAME } from './fake-google';
import { clearOrigin, isIphone, openApp, settle, startSession } from './session';

test('parcours utilisateur : connexion Google simulée → dossier → versions → vérifier et télécharger', async ({ context, page }, info) => {
  test.setTimeout(180_000);
  const { rec, fake, stop } = await startSession(context, page, info, 'parcours');
  const steps: { step: string; status: 'OK' | 'KO'; ms: number; screenshot?: string; error?: string }[] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    rec.context = 'parcours › ' + name;
    const t0 = Date.now();
    try {
      await test.step(name, fn);
      await settle(page, 1500);
      steps.push({ step: name, status: 'OK', ms: Date.now() - t0, screenshot: await rec.shot(page, name) });
    } catch (e) {
      steps.push({ step: name, status: 'KO', ms: Date.now() - t0, screenshot: await rec.shot(page, 'ECHEC ' + name), error: String((e as Error).message).slice(0, 500) });
      throw e;
    }
  };
  const mobile = isIphone(info), main = page.locator('#main');
  const [v61, v120] = fake.seeds;
  let downloadedHash = '', downloadName = '';
  try {
    await step('Ouverture de l’application (origine HTTPS fictive)', async () => {
      await clearOrigin(page); await openApp(page, '#/');
      if (mobile) {
        expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches && (navigator as unknown as { standalone?: boolean }).standalone === true), 'émulation PWA standalone').toBe(true);
        await expect(page.locator('.tabbar')).toBeVisible();
      }
    });
    await step('Accès à l’espace Google Drive', async () => {
      if (mobile) {
        // Après correctif BUG-04, l'origine connectée n'affiche que l'onglet Google Drive.
        const direct = page.locator('.tabbar').getByRole('link', { name: 'Google Drive' });
        if (await direct.count()) await direct.click();
        else {
          await page.locator('.tabbar').getByRole('link', { name: 'Réglages' }).click();
          await page.getByRole('link', { name: /Copies chiffrées Race Control/ }).click();
        }
      } else {
        await page.locator('.sidebar').getByRole('link', { name: 'Google Drive', exact: true }).click();
      }
      await expect(page.getByRole('heading', { name: 'Google Drive', exact: true })).toBeVisible();
      await expect(main.getByText('Prêt à connecter Google Drive')).toBeVisible();
    });
    await step('Connexion : préparer', async () => {
      await page.getByRole('button', { name: 'Préparer la connexion Google' }).click();
      await expect(main.getByText('Connexion prête')).toBeVisible();
    });
    await step('Connexion : se connecter à Google (consentement simulé)', async () => {
      await page.getByRole('button', { name: 'Se connecter à Google', exact: true }).click();
      await expect(main.getByText('Compte Google sélectionné : ' + FAKE_ACCOUNT)).toBeVisible();
    });
    await step('Connexion : confirmer le compte dédié', async () => {
      await page.getByRole('button', { name: 'Confirmer ce compte dédié' }).click();
      await expect(main.getByText('Compte confirmé')).toBeVisible();
    });
    await step('Choix du dossier : retrouver les dossiers dédiés', async () => {
      await page.getByRole('button', { name: 'Retrouver les dossiers dédiés' }).click();
      await expect(page.getByRole('region', { name: 'Dossiers dédiés autorisés' }).getByText(FOLDER_NAME, { exact: true })).toBeVisible();
    });
    await step('Choix du dossier : utiliser ce dossier', async () => {
      await page.getByRole('region', { name: 'Dossiers dédiés autorisés' }).getByRole('button', { name: 'Utiliser ce dossier' }).click();
      await expect(main.getByText('Dossier dédié sélectionné : ' + FOLDER_ID)).toBeVisible();
    });
    await step('Liste des versions : actualiser', async () => {
      await page.getByRole('button', { name: 'Actualiser les versions' }).click();
      await expect(main.getByText('2 copies distantes listées')).toBeVisible();
      for (const v of [v61, v120]) await expect(page.locator('.drive-entry').filter({ hasText: v.hash.slice(0, 12) })).toContainText('non vérifiée');
    });
    await step('Vérifier et télécharger (copie fictive 61 trajets)', async () => {
      const row = page.locator('.drive-entry').filter({ hasText: v61.hash.slice(0, 12) });
      const download = page.waitForEvent('download');
      await row.getByRole('button', { name: 'Vérifier et télécharger' }).click();
      const file = await download;
      downloadName = file.suggestedFilename();
      const bytes = readFileSync(await file.path());
      downloadedHash = createHash('sha256').update(bytes).digest('hex');
      expect(downloadName).toBe('race-control-' + v61.hash.slice(0, 12) + '.json');
      expect(downloadedHash, 'SHA-256 du fichier téléchargé = SHA-256 de la copie fictive').toBe(v61.hash);
      await expect(row).toContainText('octets vérifiés le');
      await expect(main.getByText('Octets vérifiés et copie chiffrée gardée sur cet appareil')).toBeVisible();
      await expect(main.getByText('Octets distants vérifiés — restauration à valider dans Race Control')).toBeVisible();
      await expect(page.locator('.drive-entry').filter({ hasText: v120.hash.slice(0, 12) })).toContainText('non vérifiée');
    });
    await step('Aucun appel hors Google simulé, aucun jeton persistant', async () => {
      expect(fake.blocked.filter((b) => /google|googleapis/.test(b.url)), 'appel Google réel').toEqual([]);
      const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
      expect(storage).not.toContain('fixture-token');
    });
  } finally {
    rec.write('parcours', { browser: rec.browser, steps, download: { name: downloadName, sha256: downloadedHash, expected: v61.hash },
      googleCalls: fake.googleCalls.length, blocked: fake.blocked.map((b) => b.url) });
    rec.write('parcours-errors', rec.errors);
    await stop();
  }
});
