// Recette Phase T — reproductions des anomalies trouvées (AUCUN correctif ici).
// Chaque test décrit le comportement ATTENDU et est marqué test.fail() : il « réussit » tant que
// l'anomalie existe et deviendra « unexpectedly passed » (rouge) le jour où elle sera corrigée,
// pour rappeler de retirer le marqueur. Ces tests ne tournent que dans le workflow « Recette Phase T »
// (configuration séparée) : ils n'affectent jamais « Vérification complète ».
import { test, expect, type Page } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeGoogle, STANDALONE_INIT, type FakeOptions } from './fake-google';
import { OUT, Recorder } from './recorder';
import { isIphone, openApp, settle } from './session';

function note(info: import('@playwright/test').TestInfo, id: string, observed: string, reproduced: boolean) {
  mkdirSync(join(OUT, 'partials'), { recursive: true });
  appendFileSync(join(OUT, 'partials', `${Recorder.browserName(info)}-bugs.jsonl`), JSON.stringify({ id, test: info.title, browser: Recorder.browserName(info), reproduced, observed }) + '\n');
}

async function drive(page: Page, context: import('@playwright/test').BrowserContext, info: import('@playwright/test').TestInfo, options: FakeOptions = {}) {
  if (isIphone(info)) await context.addInitScript(STANDALONE_INIT);
  await installFakeGoogle(context, options);
  await openApp(page, '#/drive');
  await page.getByRole('button', { name: 'Préparer la connexion Google' }).click(); await settle(page);
  await page.getByRole('button', { name: 'Se connecter à Google', exact: true }).click(); await settle(page);
}
const status = (page: Page) => page.locator('#main p[role=status]').first().innerText();
const phase = (page: Page) => page.locator('#main .panel-body > p').filter({ hasText: /^(En attente|Envoi en cours|Envoyé|Octets distants|Conflit|Synchronisation bloquée|Erreur — action nécessaire)/ }).first().innerText();

test('BUG-01 connexion : fermer (ou bloquer) la fenêtre de consentement Google affiche « Session Google expirée »', async ({ context, page }, info) => {
  test.fail(true, 'Anomalie connue (recette Phase T) : message trompeur, aucune session n’a jamais existé.');
  await drive(page, context, info, { consent: 'popup-closed' });
  const msg = await status(page), ph = await phase(page);
  note(info, 'BUG-01', `${msg} / ${ph}`, /expirée/.test(msg) || ph === 'Synchronisation bloquée');
  expect(msg, 'un abandon volontaire ne doit pas être présenté comme une session expirée').not.toMatch(/expirée/);
  expect(ph).not.toBe('Synchronisation bloquée');
});

test('BUG-02 connexion : refuser l’autorisation Google Drive affiche « Session Google expirée » au lieu d’expliquer la permission manquante', async ({ context, page }, info) => {
  test.fail(true, 'Anomalie connue (recette Phase T) : message trompeur, la cause (permission drive.file refusée) n’est pas dite.');
  await drive(page, context, info, { consent: 'scope-refused' });
  const msg = await status(page);
  note(info, 'BUG-02', msg, /expirée/.test(msg) || !/autoris|permission/i.test(msg));
  expect(msg).not.toMatch(/expirée/);
  expect(msg).toMatch(/autoris|permission/i);
});

test('BUG-03 dossier : annuler le sélecteur Google Drive affiche « Erreur — action nécessaire » et « Opération non confirmée »', async ({ context, page }, info) => {
  test.fail(true, 'Anomalie connue (recette Phase T) : une annulation volontaire est présentée comme une erreur.');
  await drive(page, context, info, { picker: 'cancel' });
  await page.getByRole('button', { name: 'Confirmer ce compte dédié' }).click(); await settle(page);
  await page.getByRole('button', { name: 'Choisir le dossier Google Drive' }).click(); await settle(page);
  const msg = await status(page), ph = await phase(page);
  note(info, 'BUG-03', `${msg} / ${ph}`, ph === 'Erreur — action nécessaire' || /non confirmée/.test(msg));
  expect(ph, 'annuler le choix du dossier n’est pas une erreur').not.toBe('Erreur — action nécessaire');
  expect(msg).not.toMatch(/Opération non confirmée/);
});

test('BUG-04 cohérence : sur l’origine connectable, l’Accueil annonce « Google Drive — Connexion vérifiée » sans aucun compte connecté', async ({ context, page }, info) => {
  test.fail(true, 'Anomalie connue (recette Phase T) : état de démonstration présenté comme réel à côté du vrai parcours Google Drive (à arbitrer).');
  if (isIphone(info)) await context.addInitScript(STANDALONE_INIT);
  await installFakeGoogle(context);
  await openApp(page, '#/drive');
  await expect(page.locator('#main p[role=status]').first()).toContainText('Prêt à connecter Google Drive');
  await openApp(page, '#/');
  const tile = (await page.locator('#main').getByRole('link', { name: /Google Drive/ }).first().innerText()).replace(/\s+/g, ' ');
  note(info, 'BUG-04', tile, /Connexion vérifiée/.test(tile));
  expect(tile, 'aucun compte Google n’est connecté dans cette session').not.toMatch(/Connexion vérifiée/);
});

test('BUG-05 accessibilité : « Restaurer cette version » est désactivé sans description accessible de la condition (case de confirmation)', async ({ context, page }, info) => {
  test.fail(true, 'Anomalie mineure connue (recette Phase T) : bouton désactivé sans aria-describedby ni title.');
  if (isIphone(info)) await context.addInitScript(STANDALONE_INIT);
  await installFakeGoogle(context);
  await openApp(page, '#/applis/race-control');
  await page.getByRole('button', { name: /Ouvrir la restauration/ }).first().click();
  const go = page.getByRole('button', { name: 'Restaurer cette version' });
  await expect(go).toBeDisabled();
  const described = await go.evaluate((b) => {
    const ids = (b.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.textContent?.trim() || '').join(' ') || b.getAttribute('title') || '';
  });
  note(info, 'BUG-05', described ? `description : ${described}` : 'désactivé, ni aria-describedby ni title (la case « Je remplace l’état actuel… » n’est pas reliée au bouton)', !described);
  expect(described, 'la raison de la désactivation doit être exposée au bouton').not.toBe('');
});

test('BUG-06 sauvegarde : « Annuler » devient désactivé pendant le contrôle de l’empreinte sans aucune explication', async ({ context, page }, info) => {
  test.fail(true, 'Anomalie mineure connue (recette Phase T) : le code annonce « on retire le bouton » mais le laisse désactivé, sans raison affichée.');
  if (isIphone(info)) await context.addInitScript(STANDALONE_INIT);
  await installFakeGoogle(context);
  await openApp(page, '#/applis');
  await page.locator('#main').getByRole('button', { name: 'Sauvegarder', exact: true }).first().click();
  const cancel = page.locator('dialog[open]').getByRole('button', { name: 'Annuler', exact: true });
  const seen = await expect(cancel).toBeDisabled({ timeout: 20_000 }).then(() => true, () => false);
  if (!seen) { note(info, 'BUG-06', 'état transitoire non observé pendant cette exécution', false); test.skip(true, 'état transitoire non observé'); return; }
  const why = await cancel.evaluate((b) => {
    const ids = (b.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.textContent?.trim() || '').join(' ') || b.getAttribute('title') || '';
  });
  note(info, 'BUG-06', why ? `description : ${why}` : 'bouton « Annuler » désactivé, ni aria-describedby, ni title, ni texte expliquant que l’envoi ne peut plus être annulé', !why);
  expect(why, 'la raison de la désactivation doit être exposée (ou le bouton retiré)').not.toBe('');
});
