// Messages exacts de connexion / dossier et accessibilité (recette Phase T, BUG-01 à BUG-06).
// Google entièrement simulé, données fictives, aucune requête externe.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { open } from './helpers';

const origin = 'https://vault.example.com';
const scope = 'https://www.googleapis.com/auth/drive.file';
const config = { approved: true, clientId: ['123456', 'fake.apps.googleusercontent.com'].join('-'), apiKey: 'AIza' + 'a'.repeat(35), appId: '123456', raceOrigin: 'https://race.example.com', vaultOrigin: origin };

// Origine HTTPS configurée (comme la production isolée), GIS / Picker / Drive simulés.
async function production(context: BrowserContext, opts: { consent?: 'granted' | 'popup-closed' | 'scope-refused'; picker?: 'picked' | 'cancel' } = {}) {
  await context.route('**/*', r => r.abort());
  await context.route(origin + '/**', async r => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/drive-config.json') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(config) });
    const target = resolve('dist', '.' + (path === '/' ? '/index.html' : path));
    if (!target.startsWith(resolve('dist') + '/')) return r.abort();
    let body = readFileSync(target);
    if (path === '/') body = Buffer.from(body.toString().replace("script-src 'self'", "script-src 'self' https://accounts.google.com/gsi/client https://apis.google.com")
      .replace("connect-src 'self'", "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/"));
    await r.fulfill({ body, contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.json') || path.endsWith('.webmanifest') ? 'application/json' : path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.png') ? 'image/png' : 'text/html' });
  });
  const answer = opts.consent === 'popup-closed' ? "o.error_callback({type:'popup_closed'})"
    : opts.consent === 'scope-refused' ? "o.callback({access_token:'fixture-token',scope:'openid',expires_in:3600})"
    : `o.callback({access_token:'fixture-token',scope:'${scope}',expires_in:3600})`;
  await context.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'text/javascript',
    body: `window.google={accounts:{oauth2:{initTokenClient:o=>({requestAccessToken:()=>setTimeout(()=>${answer},20)}),hasGrantedAllScopes:(t,s)=>String(t.scope).split(' ').includes(s)}}};` }));
  await context.route('https://apis.google.com/js/api.js', r => r.fulfill({ contentType: 'text/javascript', body: `
    window.gapi={load:(n,o)=>o.callback()};
    class View{setIncludeFolders(){return this}setSelectFolderEnabled(){return this}}
    class Picker{addView(){return this}setOAuthToken(){return this}setDeveloperKey(){return this}setAppId(){return this}setOrigin(){return this}setCallback(c){this.cb=c;return this}build(){return this}setVisible(v){if(v)setTimeout(()=>this.cb(${opts.picker === 'cancel' ? "{action:'cancel'}" : "{action:'picked',docs:[{id:'folder-A'}]}"}),20)}}
    google.picker={DocsView:View,PickerBuilder:Picker,ViewId:{FOLDERS:'folders'},Action:{PICKED:'picked',CANCEL:'cancel'}};` }));
  await context.route('https://www.googleapis.com/**', async r => {
    const u = new URL(r.request().url()), key = u.pathname.split('/').at(-1);
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,content-type' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers });
    const json = (v: unknown) => r.fulfill({ headers, contentType: 'application/json', body: JSON.stringify(v) });
    if (key === 'about') return json({ user: { permissionId: 'synthetic_account', emailAddress: 'fixture-backup@example.invalid' } });
    if (key === 'folder-A') return json({ id: key, mimeType: 'application/vnd.google-apps.folder', trashed: false, ownedByMe: true, appProperties: { cv_contract: 'rc-folder-v1' }, capabilities: { canAddChildren: true } });
    return r.fulfill({ status: 404, headers, body: '{}' });
  });
}
const status = (page: Page) => page.locator('#main p[role=status]').first();
async function connect(page: Page) {
  await page.goto(origin + '/#/drive');
  await page.getByRole('button', { name: 'Préparer la connexion Google' }).click();
  await page.getByRole('button', { name: 'Se connecter à Google', exact: true }).click();
}

test('BUG-01 fenêtre Google fermée ou bloquée : message exact, aucune « session expirée »', async ({ context, page }) => {
  await production(context, { consent: 'popup-closed' });
  await connect(page);
  await expect(status(page)).toHaveText('Connexion Google annulée ou fenêtre bloquée : réessaie (autorise les fenêtres pour ce site).');
  await expect(page.locator('#main .panel').first()).not.toContainText(/expirée|Synchronisation bloquée/);
  await expect(page.getByRole('button', { name: 'Se connecter à Google', exact: true })).toBeEnabled();
});

test('BUG-02 autorisation Google Drive refusée : l’accès non accordé est expliqué', async ({ context, page }) => {
  await production(context, { consent: 'scope-refused' });
  await connect(page);
  await expect(status(page)).toContainText('L’accès au dossier Google Drive n’a pas été accordé');
  await expect(page.locator('#main .panel').first()).not.toContainText(/expirée|Synchronisation bloquée/);
  await expect(page.getByText('Compte Google sélectionné')).toHaveCount(0);
});

test('BUG-03 sélecteur Google annulé : état neutre « Aucun dossier choisi »', async ({ context, page }) => {
  await production(context, { picker: 'cancel' });
  await connect(page);
  await page.getByRole('button', { name: 'Confirmer ce compte dédié' }).click();
  await page.getByRole('button', { name: 'Choisir le dossier Google Drive' }).click();
  await expect(status(page)).toHaveText('Aucun dossier choisi.');
  await expect(page.locator('#main .panel').first()).not.toContainText(/Erreur — action nécessaire|Opération non confirmée/);
  await expect(page.getByRole('button', { name: 'Choisir le dossier Google Drive' })).toBeEnabled();
});

test('BUG-04 origine de production : aucun état ni sauvegarde de démonstration', async ({ context, page }) => {
  await production(context);
  for (const hash of ['#/', '#/historique', '#/applis/race-control', '#/securite', '#/reglages']) {
    await page.goto(origin + '/' + hash);
    await expect(page.getByRole('heading', { name: 'Google Drive', exact: true })).toBeVisible();
    await expect(page).toHaveURL(origin + '/#/drive');
    await expect(page.locator('body')).not.toContainText(/Connexion vérifiée|Sauvegardée hier|Réussie et vérifiée|Compte de démonstration/);
  }
  await expect(page.getByRole('button', { name: 'Recherche rapide' })).toHaveCount(0);
});

test('BUG-05 « Restaurer cette version » désactivé : condition décrite par un texte visible', async ({ page }) => {
  await open(page, '#/applis/race-control');
  await page.getByRole('button', { name: /Ouvrir la restauration/ }).first().click();
  const go = page.getByRole('button', { name: 'Restaurer cette version' });
  await expect(go).toBeDisabled();
  const id = await go.getAttribute('aria-describedby');
  expect(id, 'aria-describedby').toBeTruthy();
  await expect(page.locator('#' + id)).toBeVisible();
  await expect(page.locator('#' + id)).toContainText('Coche');
  await expect(go).toHaveAccessibleDescription(/Coche/);
});

test('BUG-06 sauvegarde : « Annuler » n’est jamais laissé désactivé sans explication', async ({ page }) => {
  await open(page, '#/applis');
  await page.evaluate(() => {
    const w = window as unknown as { annulerDesactive?: boolean };
    new MutationObserver(list => {
      for (const m of list) {
        const b = m.target as HTMLElement;
        if (b.tagName === 'BUTTON' && b.textContent?.trim() === 'Annuler' && b.hasAttribute('disabled') && b.isConnected && !b.getAttribute('aria-describedby')) w.annulerDesactive = true;
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['disabled'] });
  });
  await page.locator('#main').getByRole('button', { name: 'Sauvegarder', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Sauvegarde terminée et vérifiée' })).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => !!(window as unknown as { annulerDesactive?: boolean }).annulerDesactive)).toBe(false);
});
