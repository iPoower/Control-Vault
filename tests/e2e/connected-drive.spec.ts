import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fixtureCode } from '../fixtures/race-packet';
import { resolve } from 'node:path';
import { packetFixture } from '../fixtures/race-packet';
const origin = 'https://vault.example.com';
const scope = 'https://www.googleapis.com/auth/drive.file';
const config = { approved: true, clientId: ['123456', 'fake.apps.googleusercontent.com'].join('-'), apiKey: 'AIza' + 'a'.repeat(35), appId: '123456', raceOrigin: 'https://race.example.com', vaultOrigin: origin };

for (const direct of [false, true]) test('application complète, Google simulé : confirmation compte, dossier dédié, upload opaque, relecture et jeton oublié' + (direct ? ' · liste dédiée sans Picker' : ' · Picker conservé'), async ({ context, page, browser }) => {
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
    class Picker{addView(){return this}setOAuthToken(){return this}setDeveloperKey(){return this}setAppId(){return this}setOrigin(){return this}setCallback(c){this.cb=c;return this}build(){return this}setVisible(v){if(v){window.fixturePickerOpened=true;${direct ? "throw new Error('synthetic Picker unavailable')" : "this.cb({action:'picked',docs:[{id:'folder-A'}]})"}}}}
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
    if (u.pathname === '/drive/v3/files' && (u.searchParams.get('q') || '').includes("value='rc-folder-v1'")) return json({ incompleteSearch: false, files: folderReady ? [{id:'folder-A',name:'Dossier fictif <img src=x onerror=alert(1)>',createdTime:'2026-10-28T00:00:00.000Z',mimeType:'application/vnd.google-apps.folder',trashed:false,ownedByMe:true,appProperties:{cv_contract:'rc-folder-v1'},capabilities:{canAddChildren:true}}] : [] });
    if (u.pathname === '/drive/v3/files') return json({ incompleteSearch: false, files: [...files.values()].map(f => f.meta) });
    const file = files.get(key); if (!file) return json({}, 404);
    return u.searchParams.get('alt') === 'media' ? r.fulfill({ headers, contentType: 'application/json', body: file.bytes }) : json(file.meta);
  });
  // Origine connectée : les écrans de démonstration (ici Réglages) redirigent vers Google Drive.
  await page.goto(origin + '/#/reglages');
  await expect(page.getByRole('heading', { name: 'Google Drive', exact: true })).toBeVisible();
  await expect(page).toHaveURL(origin + '/#/drive');
  const recoveryLink=page.getByRole('link',{name:'Récupérer sur un appareil neuf dans Race Control'});
  await expect(recoveryLink).toHaveAttribute('href','https://race.example.com/recovery.html');
  await expect(recoveryLink).toHaveAttribute('rel','noopener noreferrer');
  await expect(page.locator('input[type=password]')).toHaveCount(0);
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
  if (direct) {
    await page.getByRole('button',{name:'Retrouver les dossiers dédiés'}).click();
    const list=page.getByRole('region',{name:'Dossiers dédiés autorisés'});
    await expect(list.getByText('Dossier fictif <img src=x onerror=alert(1)>',{exact:true})).toBeVisible();
    await expect(list.locator('img')).toHaveCount(0);
    await list.getByRole('button',{name:'Utiliser ce dossier'}).click();
  } else await page.getByRole('button', { name: 'Choisir le dossier Google Drive' }).click();
  expect(await page.evaluate(() => Boolean((window as unknown as {fixturePickerOpened?:boolean}).fixturePickerOpened))).toBe(!direct);
  await page.getByLabel('Copie chiffrée Race Control').setInputFiles({ name: 'opaque.json', mimeType: 'application/json', buffer: Buffer.from(fixture.bytes) });
  await expect(page.getByRole('status').filter({ hasText: 'Copie envoyée' })).toBeVisible();
  expect(files.size).toBe(1); expect(posts).toBe(1);
  await page.getByRole('button', { name: 'Actualiser les versions' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Vérifier et télécharger' }).click();
  const archive = await download;
  const downloaded = readFileSync(await archive.path());
  expect(createHash('sha256').update(downloaded).digest('hex')).toBe(fixture.hash);
  // Full business payload recovered with the ACTUAL pinned Race Control owner
  // codec, not with a second crypto implementation in Control Vault.
  // A virgin isolated browser has no producer storage, key or sessions.
  const virgin = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const ownerSource = readFileSync('tests/fixtures/race-owner/control-vault-packet.js', 'utf8');
    await virgin.route('https://race.example.com/**', route => {
      const p = new URL(route.request().url()).pathname;
      return p === '/owner.js'
        ? route.fulfill({contentType: 'text/javascript', body: ownerSource + '\nwindow.rcOwner=ControlVaultPacket;'})
        : route.fulfill({contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><script src="/owner.js"></script><body>Virgin synthetic recovery</body>'});
    });
    const newDevice = await virgin.newPage();
    await newDevice.goto('https://race.example.com/');
    const result = await newDevice.evaluate(async ({ bytes, code, hash }) => {
      const nativeCodec = (window as unknown as { rcOwner: {create: (o: unknown) => {open: (...args: unknown[])=>Promise<unknown>}}}).rcOwner;
      if (!nativeCodec) throw Error('Race Control owner codec not loaded');
      const codec = nativeCodec.create({validateBusiness: (x: unknown) => x !== null && typeof x === 'object'});
      const localBefore = localStorage.length, sessionBefore = sessionStorage.length;
      const databasesBefore = typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).length : null;
      const decoded = await codec.open(Uint8Array.from(bytes), code, 'prod-156', hash);
      let wrongCode = '';
      try { await codec.open(Uint8Array.from(bytes), 'incorrect-synthetic-code', 'prod-156', hash); }
      catch (e) { wrongCode = String((e as {code?:string}).code || (e as Error).message); }
      const modified = Uint8Array.from(bytes); modified[modified.length - 12] ^= 1;
      let tampered = '';
      try { await codec.open(modified, code, 'prod-156', hash); }
      catch (e) { tampered = String((e as {code?:string}).code || (e as Error).message); }
      return {decoded, localBefore, sessionBefore, databasesBefore, wrongCode, tampered,
        localAfter:localStorage.length, sessionAfter:sessionStorage.length};
    }, { bytes: Array.from(downloaded), code: fixtureCode, hash: fixture.hash });
    expect(result.localBefore).toBe(0);
    expect(result.sessionBefore).toBe(0);
    if (result.databasesBefore !== null) expect(result.databasesBefore).toBe(0);
    expect(result.decoded).toEqual(fixture.snapshot.data);
    expect(result.wrongCode).toBe('AUTHENTICATION_FAILED');
    expect(result.tampered).not.toBe('');
    expect(result.localAfter).toBe(0);
    expect(result.sessionAfter).toBe(0);
    const clear = result.decoded as typeof fixture.snapshot.data;
    expect(clear.settings.cars[0].odo[0].km).toBe(44000);
    expect(clear.settings.cars[0].tire.treads[0].mm).toBe(6.2);
    expect(clear.durable.context.debrief.archive.records).toHaveLength(63);
  } finally {
    await virgin.close();
  }
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
