// Parcours utilisateur réels, exécutés sur Chromium et WebKit (iPhone 11 Pro Max + bureau).
import { expect, test } from '@playwright/test';
import { go, isMobile, noHorizontalOverflow, open, scenario, shot } from './helpers';

test.describe('Parcours critiques', () => {
  test('1. Première ouverture : état calculé, démonstration signalée, aucune erreur', async ({ page }, testInfo) => {
    const errors = await open(page);
    await page.waitForTimeout(300);
    expect(await page.locator('.boot-error').allTextContents(), 'erreur de démarrage').toEqual([]);
    expect(errors).toEqual([]);
    await expect(page.locator('.dial')).toBeVisible();
    await expect(page.locator('#hero-title')).toBeVisible();
    await expect(page.getByText('Démonstration : données fictives')).toBeVisible();
    // Reconversion Control a 9 jours : l'accueil ne doit PAS prétendre que tout est vérifié.
    await expect(page.locator('#hero-title')).not.toHaveText('Tout est vérifié');
    await expect(page.locator('.dial')).toHaveAttribute('aria-label', /3 sources vérifiées sur 4/);
    await noHorizontalOverflow(page);
    // Vérifié avant la capture : sous WebKit, l'outil de capture injecte lui-même un style que la CSP refuse.
    expect(errors).toEqual([]);
    await shot(page, testInfo, '01-accueil');
  });

  test('3-4. Explorateur : dossier, recherche, filtre, aperçu, dossier vide', async ({ page }, testInfo) => {
    await open(page);
    await go(page, 'Fichiers', testInfo);
    await expect(page.getByRole('listitem').filter({ hasText: 'Race Control' })).toBeVisible();
    await page.getByRole('button', { name: /^Race Control/ }).first().click();
    await expect(page.locator('.crumbs [aria-current="page"]')).toHaveText('Race Control');
    await expect(page.getByText(/race-control_.*\.cvault/).first()).toBeVisible();
    await shot(page, testInfo, '03-dossier');

    await page.getByRole('searchbox', { name: 'Rechercher un fichier' }).fill('export');
    await expect(page.getByText('2 résultats dans tout le coffre')).toBeVisible();
    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    await page.locator('.file-open').filter({ hasText: 'export-manuel-septembre.json' }).click();
    await expect(page.getByText('"app": "race-control"').first()).toBeVisible();
    await shot(page, testInfo, '04-recherche-apercu');
    if (await page.locator('dialog.sheet[open]').count()) await page.keyboard.press('Escape');
    await expect(page.locator('dialog.sheet[open]')).toHaveCount(0);

    await page.getByRole('searchbox', { name: 'Rechercher un fichier' }).fill('');
    await page.goto('./#/fichiers/cv-archives-2025');
    await expect(page.getByText('Ce dossier est vide')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Importer un fichier JSON' })).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('5. Import JSON : refus expliqué puis import vérifié', async ({ page }, testInfo) => {
    await open(page, '#/fichiers/cv-archives-2025');
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({ name: 'casse.json', mimeType: 'application/json', buffer: Buffer.from('{"app": ') });
    await expect(page.getByText(/Import refusé : JSON invalide/)).toBeVisible();
    await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('bonjour') });
    await expect(page.getByText(/Seuls les fichiers \.json/)).toBeVisible();
    await input.setInputFiles({ name: 'export-race.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'race-control', schema: 3, trajets: [] })) });
    await expect(page.getByText('export-race.json importé et vérifié')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'export-race.json' })).toBeVisible();
    await shot(page, testInfo, '05-import');
  });

  test('6-7. Sauvegarde : six étapes réelles et confirmation d’intégrité', async ({ page }, testInfo) => {
    await open(page);
    await go(page, 'Applications', testInfo);
    const card = page.locator('article.app-card').filter({ hasText: 'Reconversion Control' });
    await card.getByRole('button', { name: 'Sauvegarder' }).click();
    const sheet = page.locator('dialog.sheet[open]');
    await expect(sheet.getByRole('heading', { name: 'Sauvegarder Reconversion Control' })).toBeVisible();
    await expect(sheet.locator('.step')).toHaveCount(6);
    await expect(sheet.getByText('Sauvegarde terminée et vérifiée')).toBeVisible({ timeout: 10_000 });
    await expect(sheet.locator('.step[data-state="done"]')).toHaveCount(6);
    await expect(sheet.getByText('SHA-256 identique')).toBeVisible();
    await shot(page, testInfo, '06-sauvegarde-verifiee');
    await sheet.getByRole('button', { name: 'Terminé' }).click();
    await expect(page.locator('dialog.sheet[open]')).toHaveCount(0);
    // L'état se recalcule : les deux applications sont désormais à jour.
    await go(page, 'Accueil', testInfo);
    await expect(page.locator('#hero-title')).toHaveText('Tout est vérifié');
    await shot(page, testInfo, '07-accueil-verifie');
  });

  test('Envoi interrompu : rien n’est écrit, erreur expliquée, « Réessayer » fonctionne', async ({ page }, testInfo) => {
    await open(page);
    await scenario(page, testInfo, 'Envoi interrompu');
    await go(page, 'Applications', testInfo);
    await page.locator('article.app-card').filter({ hasText: 'Race Control' }).getByRole('button', { name: 'Sauvegarder' }).click();
    const sheet = page.locator('dialog.sheet[open]');
    await expect(sheet.getByRole('heading', { name: 'Envoi interrompu — connexion perdue' })).toBeVisible({ timeout: 10_000 });
    await expect(sheet.getByText('Rien n’a été écrit dans Drive.')).toBeVisible();
    await expect(sheet.getByText('Interrompu à cette étape')).toBeVisible();
    await expect(sheet.getByText('Sauvegarde terminée')).toHaveCount(0); // aucun faux succès
    await shot(page, testInfo, '08-envoi-interrompu');
    await sheet.getByRole('button', { name: 'Fermer', exact: true }).click();

    await go(page, 'Accueil', testInfo);
    await expect(page.locator('#hero-title')).toHaveText(/Sauvegarde de Race Control échouée|Plusieurs points/);
    await page.locator('.banner-demo').getByRole('button', { name: 'Revenir à la normale' }).click();
    await page.locator('.hero').getByRole('button', { name: 'Réessayer la sauvegarde' }).click();
    await expect(page.locator('dialog.sheet[open]').getByText('Sauvegarde terminée et vérifiée')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.issues')).not.toContainText('Race Control échouée');
  });

  test('8. Restauration : aperçu obligatoire, confirmation explicite, copie de sécurité', async ({ page }, testInfo) => {
    await open(page, '#/applis/race-control');
    const versions = page.locator('.versions .row');
    await expect(versions).toHaveCount(5);
    await versions.nth(2).click();
    const sheet = page.locator('dialog.sheet[open]');
    await expect(sheet.getByText('Ce qui changera')).toBeVisible({ timeout: 8_000 });
    await expect(sheet.getByText(/débriefs de trajet disparaîtraient/)).toBeVisible();
    const confirm = sheet.getByRole('button', { name: 'Restaurer cette version' });
    await expect(confirm).toBeDisabled();
    await shot(page, testInfo, '09-restauration-apercu');
    await sheet.getByText(/Je remplace l’état actuel/).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(sheet.getByText('Restauration terminée')).toBeVisible({ timeout: 12_000 });
    await expect(sheet.locator('.step[data-state="done"]')).toHaveCount(6);
    await shot(page, testInfo, '10-restauration-terminee');
    await sheet.getByRole('button', { name: 'Terminé' }).click();
    await expect(page.locator('.versions .row')).toHaveCount(6); // + copie de sécurité
    await expect(page.getByText('Copie de sécurité').first()).toBeVisible();
    await go(page, 'Historique', testInfo);
    await expect(page.locator('.tl-title').first()).toHaveText('Restauration de Race Control');
  });

  test('9-10. Perte puis retour du réseau : file d’attente honnête', async ({ page, context }, testInfo) => {
    await open(page);
    await context.setOffline(true);
    await expect(page.locator('.banner').first()).toContainText('Hors ligne');
    await go(page, 'Applications', testInfo);
    await page.locator('article.app-card').filter({ hasText: 'Race Control' }).getByRole('button', { name: 'Sauvegarder' }).click();
    await page.getByRole('button', { name: 'Mettre en attente' }).click();
    await go(page, 'Accueil', testInfo);
    await expect(page.locator('#hero-title')).toHaveText('Une sauvegarde attend une connexion');
    await expect(page.locator('.dial')).toHaveAttribute('aria-label', /0 sources vérifiées/);
    await shot(page, testInfo, '11-hors-ligne');
    await context.setOffline(false);
    await expect(page.locator('.banner').filter({ hasText: 'Hors ligne' })).toHaveCount(0);
    await page.locator('.issues').getByRole('button', { name: 'Lancer maintenant' }).click();
    await expect(page.locator('dialog.sheet[open]').getByText('Sauvegarde terminée et vérifiée')).toBeVisible({ timeout: 10_000 });
  });

  test('11. Session expirée : bandeau clair et reconnexion', async ({ page }, testInfo) => {
    await open(page);
    await scenario(page, testInfo, 'Session Google expirée');
    const banner = page.locator('.banner').filter({ hasText: 'Session Google expirée' });
    await expect(banner).toBeVisible();
    await go(page, 'Accueil', testInfo);
    await expect(page.locator('#hero-title')).toHaveText(/Session Google expirée|Plusieurs points/);
    await shot(page, testInfo, '12-session-expiree');
    await banner.getByRole('button', { name: 'Se reconnecter' }).click();
    await expect(banner).toHaveCount(0);
  });

  test('12. Rechargement : réglages et écran conservés', async ({ page }, testInfo) => {
    await open(page);
    await go(page, 'Réglages', testInfo);
    await page.getByRole('radiogroup', { name: 'Thème' }).getByRole('radio', { name: 'Clair' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('#main .boot')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('.page-head h1')).toHaveText('Réglages');
    await shot(page, testInfo, '13-reglages-clair');
  });

  test('Filtres conservés entre deux écrans', async ({ page }, testInfo) => {
    await open(page);
    await go(page, 'Historique', testInfo);
    await page.getByRole('button', { name: /Échecs/ }).click();
    await go(page, 'Accueil', testInfo);
    await go(page, 'Historique', testInfo);
    await expect(page.getByRole('button', { name: /Échecs/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.tl-item')).toHaveCount(1);
  });

  test('Aucun dialogue impossible à fermer', async ({ page }) => {
    await open(page, '#/applis/race-control');
    await page.locator('.versions .row').nth(1).click();
    await expect(page.locator('dialog.sheet[open]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.sheet[open]')).toHaveCount(0);
    await page.locator('.versions .row').nth(1).click();
    await page.locator('dialog.sheet[open]').getByRole('button', { name: 'Fermer la fenêtre' }).click();
    await expect(page.locator('dialog.sheet[open]')).toHaveCount(0);
    await page.locator('.versions .row').nth(1).click();
    await page.locator('dialog.sheet[open]').getByRole('button', { name: 'Annuler' }).click();
    await expect(page.locator('dialog.sheet[open]')).toHaveCount(0);
  });
});

test.describe('Clavier', () => {
  test('13. Recherche rapide Ctrl/Cmd+K et raccourcis', async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo), 'clavier physique : bureau');
    await open(page);
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.locator('dialog.palette[open]');
    await expect(palette).toBeVisible();
    await page.keyboard.type('histo');
    await shot(page, testInfo, '14-recherche-rapide');
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);
    await expect(page.locator('.page-head h1')).toHaveText('Historique');
    await page.keyboard.press('g');
    await page.keyboard.press('f');
    await expect(page.locator('.crumbs [aria-current="page"]')).toHaveText('Control Vault');
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Rechercher un fichier' })).toBeFocused();
  });

  test('Tabulation : lien d’évitement et focus visible', async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo), 'clavier physique : bureau');
    await open(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe('none');
  });
});

test.describe('Ergonomie mobile', () => {
  test('Cibles tactiles ≥ 44 px dans la barre d’onglets', async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo), 'mobile uniquement');
    await open(page);
    for (const box of await page.locator('.tab').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  });

  for (const width of [320, 375, 414]) {
    test(`Aucun débordement à ${width} px`, async ({ page }, testInfo) => {
      test.skip(!isMobile(testInfo), 'mobile uniquement');
      await page.setViewportSize({ width, height: 800 });
      for (const hash of ['#/', '#/fichiers', '#/applis', '#/applis/race-control', '#/historique', '#/securite', '#/reglages']) {
        await open(page, hash);
        await page.waitForTimeout(400);
        await noHorizontalOverflow(page);
      }
    });
  }

  test('15. Paysage', async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo), 'mobile uniquement');
    await page.setViewportSize({ width: 896, height: 414 });
    await open(page);
    await noHorizontalOverflow(page);
    await shot(page, testInfo, '15-paysage');
  });
});
