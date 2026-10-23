import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { packetFixture } from '../fixtures/race-packet';
const origin = 'https://vault.example.com';
const scope = 'https://www.googleapis.com/auth/drive.file';
const config = { approved: true, clientId: ['123456', 'fake.apps.googleusercontent.com'].join('-'), apiKey: 'AIza' + 'a'.repeat(35), appId: '123456', raceOrigin: 'https://race.example.com', vaultOrigin: origin };

test('application complète, Google simulé : confirmation compte, dossier dédié, upload opaque, relecture et jeton oublié', async ({ context, page }) => {
  await context.route('**/*', r => r.abort());
  const fixture = await packetFixture(61), files = new Map<string, { meta: Record<string, unknown>; bytes: Buffer }>(), pending = new Map<string, Record<string, unknown>>(); let next = 0, posts = 0, folderPosts = 0, folderReady = false;
  await context.route(origin + '/**', async r => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/drive-config.json') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(config) });
    const target = resolve('dist', '.' + (path === '/' ? '/index.html' : path));
    if (!target.startsWith(resolve('dist') + '/')) return r.abort();
    let body = readFileSync(target);
    if (path === '/') body = Buffer.from(body.toString().replace("script-src 'self'", "script-src 'self' https://accounts.google.com/gsi/client https://apis.google.com")
      .replace("connect-src 'self'", "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/"));
    await r.fulfill({ body, contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.json') || path.endsWith('.webmanifest') ? 'application/json' : 'text/html' });
  });
  await context.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{oauth2:{initTokenClient:o=>({requestAccessToken:()=>o.callback({access_token:'fixture-token',scope:'${scope}',expires_in:3600})}),hasGrantedAllScopes:()=>true}}};` }));
  await context.route('https://apis.google.com/js/api.js', r => r.fulfill({ contentType: 'text/javascript', body: `
    window.gapi={load:(name,o)=>o.callback()};
    class View{setIncludeFolders(){return this}setSelectFolderEnabled(){return this}}
    class Picker{addView(){return this}setOAuthToken(){return this}setDeveloperKey(){return this}setAppId(){return this}setOrigin(){return this}setCallback(c){this.cb=c;return this}build(){return this}setVisible(v){if(v)this.cb({action:'picked',docs:[{id:'folder-A'}]})}}
    google.picker={DocsView:View,PickerBuilder:Picker,ViewId:{FOLDERS:'folders'},Action:{PICKED:'picked',CANCEL:'cancel'}};` }));
  await context.route('https://www.googleapis.com/**', async r => {
    const request = r.request(), u = new URL(request.url()), key = u.pathname.split('/').at(-1)!;
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type,content-range,x-upload-content-type,x-upload-content-length', 'Access-Control-Expose-Headers': 'Location,Range' };
    const json = (v: unknown, status = 200) => r.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(v) });
    if (request.method() === 'OPTIONS') return r.fulfill({ status: 204, headers });
    expect(request.headers().authorization).toBe('Bearer fixture-token'); expect(u.searchParams.has('access_token')).toBe(false);
    if (key === 'about') return json({ user: { permissionId: 'synthetic_account', emailAddress: 'fixture-backup@example.invalid' } });
    if (key === 'generateIds') return json({ ids: [++next === 1 ? 'folder-A' : 'version-' + next] });
    if (key === 'folder-A' && !folderReady) return json({},404);
    if (key === 'folder-A') return json({ id: key, mimeType: 'application/vnd.google-apps.folder', trashed: false, ownedByMe: true, appProperties: { cv_contract: 'rc-folder-v1' }, capabilities: { canAddChildren: true } });
    if (request.method() === 'POST' && u.pathname === '/drive/v3/files') { const m=request.postDataJSON(); expect(m.mimeType).toBe('application/vnd.google-apps.folder');expect(m.appProperties).toEqual({cv_contract:'rc-folder-v1'});expect(m.id).toBe('folder-A');folderReady=true;folderPosts++;return json({id:m.id}); }
    if (request.method() === 'POST') { posts++; const m = request.postDataJSON() as Record<string, unknown>; pending.set(String(m.id), m); return r.fulfill({ headers: { ...headers, Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=' + m.id } }); }
    if (request.method() === 'PUT') { const id = u.searchParams.get('upload_id')!, bytes = request.postDataBuffer()!; expect(bytes.equals(Buffer.from(fixture.bytes))).toBe(true); files.set(id, { meta: { ...pending.get(id), size: String(bytes.length) }, bytes }); return json({ id }); }
    if (u.pathname === '/drive/v3/files') return json({ incompleteSearch: false, files: [...files.values()].map(f => f.meta) });
    const file = files.get(key); if (!file) return json({}, 404);
    return u.searchParams.get('alt') === 'media' ? r.fulfill({ headers, contentType: 'application/json', body: file.bytes }) : json(file.meta);
  });
  await page.goto(origin + '/#/reglages');
  await page.getByRole('link', { name: /Copies chiffrées Race Control/ }).click();
  await expect(page.getByRole('heading', { name: 'Google Drive', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Préparer la connexion Google' }).click();
  await page.getByRole('button', { name: 'Se connecter à Google', exact: true }).click();
  await expect(page.getByText('Compte Google sélectionné : fixture-backup@example.invalid')).toBeVisible();
  await expect(page.getByRole('button', {name:'Choisir le dossier Google Drive'})).toHaveCount(0);
  expect(posts).toBe(0);expect(folderPosts).toBe(0);
  await page.getByRole('button', {name:'Confirmer ce compte dédié'}).click();
  await page.getByRole('button', {name:'Créer un dossier neuf dédié'}).click();
  await expect(page.getByRole('status').filter({hasText:'Dossier neuf dédié créé'})).toBeVisible();
  expect(folderPosts).toBe(1);
  await page.getByRole('button', {name:'Créer un dossier neuf dédié'}).click();
  await expect(page.getByRole('status').filter({hasText:'Dossier neuf dédié créé'})).toBeVisible();expect(folderPosts).toBe(1);
  await page.getByRole('button', { name: 'Choisir le dossier Google Drive' }).click();
  await page.getByLabel('Copie chiffrée Race Control').setInputFiles({ name: 'opaque.json', mimeType: 'application/json', buffer: Buffer.from(fixture.bytes) });
  await expect(page.getByRole('status').filter({ hasText: 'Copie envoyée' })).toBeVisible();
  expect(files.size).toBe(1); expect(posts).toBe(1);
  await page.getByRole('button', { name: 'Actualiser les versions' }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Vérifier et télécharger' }).click(); await download;
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.getByLabel('Copie chiffrée Race Control').setInputFiles({ name: 'clear.json', mimeType: 'application/json', buffer: Buffer.from('{"settings":{"private":true}}') });
  await expect(page.getByRole('status').filter({ hasText: 'Opération non confirmée' })).toBeVisible(); expect(posts).toBe(1);
  await page.reload(); await expect(page.getByRole('button', { name: 'Préparer la connexion Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choisir le dossier Google Drive' })).toHaveCount(0);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })); expect(storage).not.toContain('fixture-token');
});

test('origine github.io : aucune connexion ni chargement Google', async ({ context, page }) => {
  await context.route('**/*', r => r.abort());
  let google = 0; await context.route(/https:\/\/(?:accounts\.google\.com|apis\.google\.com|www\.googleapis\.com)\//, r => { google++; return r.abort(); });
  await context.route('https://ipoower.github.io/Control-Vault/**', async r => {
    const path = new URL(r.request().url()).pathname.replace('/Control-Vault/', '') || 'index.html';
    await r.fulfill({ body: readFileSync(resolve('dist', path)), contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.woff2') ? 'font/woff2' : 'text/html' });
  });
  await page.goto('https://ipoower.github.io/Control-Vault/#/drive');
  await expect(page.getByRole('heading', { name: 'Google Drive', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /connexion Google|connecter à Google/ })).toHaveCount(0); expect(google).toBe(0);
});
