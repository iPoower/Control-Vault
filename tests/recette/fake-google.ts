// Recette Phase T — Google entièrement simulé.
// Aucune requête ne quitte le navigateur : tout est servi ou bloqué par les routes Playwright.
// Repris de tests/e2e/connected-drive.spec.ts (même configuration publique fictive,
// mêmes faux scripts GIS / Picker, même faux Drive) et de tests/fixtures/race-packet.ts
// (paquets Race Control fictifs, chiffrés par le vrai codec propriétaire épinglé).
import type { BrowserContext, Request } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { packetFixture } from '../fixtures/race-packet';
import { readRacePacket } from '../../src/core/race-packet';

export const ORIGIN = 'https://vault.example.com';
export const RACE_ORIGIN = 'https://race.example.com';
export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const FAKE_TOKEN = 'fixture-token'; // jeton fictif, accepté uniquement par le faux Drive ci-dessous
export const FAKE_ACCOUNT = 'recette-fictive@example.invalid';
export const FOLDER_ID = 'folder-recette-A';
export const FOLDER_NAME = 'Sauvegardes Race Control (fictif)';
// Configuration publique fictive (même forme que la vraie, valeurs inventées, aucune clé réelle).
const CONFIG = { approved: true, clientId: ['123456', 'fake.apps.googleusercontent.com'].join('-'), apiKey: 'AIza' + 'a'.repeat(35), appId: '123456', raceOrigin: RACE_ORIGIN, vaultOrigin: ORIGIN };

export interface SeedVersion { fileId: string; hash: string; cipher: string; bytes: Buffer; trips: number }
let seedsPromise: Promise<SeedVersion[]> | null = null;
/** Deux sauvegardes chiffrées fictives (61 et 120 trajets), produites par le codec Race Control épinglé. */
export function seeds(): Promise<SeedVersion[]> {
  seedsPromise ??= (async () => {
    const out: SeedVersion[] = [];
    for (const trips of [61, 120]) {
      const fx = await packetFixture(trips);
      const packet = await readRacePacket(fx.bytes, fx.hash);
      out.push({ fileId: 'version-recette-' + trips, hash: fx.hash, cipher: packet.info.cipherSha256, bytes: Buffer.from(fx.bytes), trips });
    }
    return out;
  })();
  return seedsPromise;
}

const TYPES: Record<string, string> = { js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', json: 'application/json', webmanifest: 'application/manifest+json', png: 'image/png', svg: 'image/svg+xml', html: 'text/html' };

export interface Traffic { url: string; method: string; at: number }

/**
 * Installe l'application (dist/) sur une origine HTTPS fictive et un Google/Drive simulé.
 * Toute autre requête est interrompue et consignée dans `blocked`.
 */
export interface FakeOptions {
  /** Réponse du faux consentement Google : accordé, fenêtre fermée par l'utilisateur, ou autorisation Drive décochée. */
  consent?: 'granted' | 'popup-closed' | 'scope-refused';
  /** Réponse du faux Google Picker : dossier choisi ou annulation par l'utilisateur. */
  picker?: 'picked' | 'cancel';
}
export async function installFakeGoogle(context: BrowserContext, options: FakeOptions = {}) {
  const consent = options.consent ?? 'granted', pickerAction = options.picker ?? 'picked';
  const vs = await seeds();
  type Entry = { meta: Record<string, unknown>; bytes: Buffer };
  const state = {
    files: new Map<string, Entry>(), pending: new Map<string, Record<string, unknown>>(),
    folders: new Map<string, Record<string, unknown>>(), next: 0,
  };
  const blocked: Traffic[] = [], googleCalls: Traffic[] = [];
  const reset = () => {
    state.files.clear(); state.pending.clear(); state.folders.clear(); state.next = 0;
    state.folders.set(FOLDER_ID, { id: FOLDER_ID, name: FOLDER_NAME, createdTime: '2026-10-20T08:00:00.000Z', mimeType: 'application/vnd.google-apps.folder', trashed: false, ownedByMe: true, appProperties: { cv_contract: 'rc-folder-v1' }, capabilities: { canAddChildren: true } });
    for (const v of vs) state.files.set(v.fileId, { bytes: v.bytes, meta: { id: v.fileId, name: 'rc-' + v.hash + '.json', mimeType: 'application/json', parents: [FOLDER_ID], size: String(v.bytes.length), trashed: false, appProperties: { cv_contract: 'rc-v1', cv_file: v.hash, cv_cipher: v.cipher } } });
  };
  reset();

  // 1) Filet : tout ce qui n'est pas explicitement simulé est bloqué (enregistré par Playwright en premier = évalué en dernier).
  await context.route('**/*', (r) => { blocked.push({ url: r.request().url(), method: r.request().method(), at: Date.now() }); return r.abort('blockedbyclient'); });

  // 2) Application construite (dist/) servie sur l'origine fictive, CSP élargie aux seuls hôtes Google simulés.
  await context.route(ORIGIN + '/**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/drive-config.json') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(CONFIG) });
    const target = resolve('dist', '.' + (path === '/' ? '/index.html' : path));
    if (!target.startsWith(resolve('dist') + '/')) return r.fulfill({ status: 404, body: '' });
    let body: Buffer;
    try { body = readFileSync(target); } catch { return r.fulfill({ status: 404, contentType: 'text/plain', body: 'absent' }); }
    if (path === '/' || path === '/index.html') body = Buffer.from(body.toString()
      .replace("script-src 'self'", "script-src 'self' https://accounts.google.com/gsi/client https://apis.google.com")
      .replace("connect-src 'self'", "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/"));
    const ext = path === '/' ? 'html' : (path.split('.').pop() ?? '');
    return r.fulfill({ body, contentType: TYPES[ext] ?? 'application/octet-stream' });
  });

  // 3) Faux Google Identity Services : consentement immédiat, jeton fictif en mémoire.
  await context.route('https://accounts.google.com/gsi/client', (r) => {
    googleCalls.push({ url: r.request().url(), method: 'GET', at: Date.now() });
    const respond = consent === 'popup-closed' ? `o.error_callback&&o.error_callback({type:'popup_closed',message:'Popup window closed'})`
      : consent === 'scope-refused' ? `o.callback({access_token:'${FAKE_TOKEN}',scope:'openid',expires_in:3600})`
      : `o.callback({access_token:'${FAKE_TOKEN}',scope:'${SCOPE}',expires_in:3600})`;
    return r.fulfill({ contentType: 'text/javascript', body: `window.google=window.google||{};window.google.accounts={oauth2:{initTokenClient:o=>({requestAccessToken:()=>setTimeout(()=>{${respond}},50)}),hasGrantedAllScopes:(t,s)=>typeof t.scope==='string'&&t.scope.split(' ').includes(s)}};` });
  });

  // 4) Faux Picker : choisit le dossier fictif.
  await context.route('https://apis.google.com/js/api.js', (r) => {
    googleCalls.push({ url: r.request().url(), method: 'GET', at: Date.now() });
    return r.fulfill({ contentType: 'text/javascript', body: `
    window.gapi={load:(name,o)=>setTimeout(()=>o.callback(),10)};
    class View{setIncludeFolders(){return this}setSelectFolderEnabled(){return this}}
    class Picker{addView(){return this}setOAuthToken(){return this}setDeveloperKey(){return this}setAppId(){return this}setOrigin(){return this}setCallback(c){this.cb=c;return this}build(){return this}setVisible(v){if(v){window.recettePickerOpened=(window.recettePickerOpened||0)+1;setTimeout(()=>this.cb(${pickerAction === 'cancel' ? "{action:'cancel'}" : `{action:'picked',docs:[{id:'${FOLDER_ID}'}]}`}),50)}}}
    window.google=window.google||{};window.google.picker={DocsView:View,PickerBuilder:Picker,ViewId:{FOLDERS:'folders'},Action:{PICKED:'picked',CANCEL:'cancel'}};` });
  });

  // 5) Faux Drive v3 (métadonnées, liste, téléchargement, dossier, envoi reprenable).
  await context.route('https://www.googleapis.com/**', async (r) => {
    const request: Request = r.request(), u = new URL(request.url()), key = u.pathname.split('/').at(-1)!, method = request.method();
    googleCalls.push({ url: u.origin + u.pathname, method, at: Date.now() });
    const headers = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type,content-range,x-upload-content-type,x-upload-content-length', 'Access-Control-Expose-Headers': 'Location,Range' };
    const json = (v: unknown, status = 200) => r.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(v) });
    if (method === 'OPTIONS') return r.fulfill({ status: 204, headers });
    if (request.headers().authorization !== 'Bearer ' + FAKE_TOKEN || u.searchParams.has('access_token')) return json({ error: 'unauthenticated' }, 401);
    if (key === 'about') return json({ user: { permissionId: 'recette_account', emailAddress: FAKE_ACCOUNT } });
    if (key === 'generateIds') return json({ ids: ['recette-gen-' + (++state.next)] });
    if (method === 'POST' && u.pathname === '/drive/v3/files') {
      const m = request.postDataJSON() as Record<string, unknown>;
      if (state.folders.has(String(m.id))) return json({}, 409);
      state.folders.set(String(m.id), { id: m.id, name: m.name, createdTime: new Date().toISOString(), mimeType: m.mimeType, trashed: false, ownedByMe: true, appProperties: m.appProperties, capabilities: { canAddChildren: true } });
      return json({ id: m.id });
    }
    if (method === 'POST') {
      const m = request.postDataJSON() as Record<string, unknown>, id = String(m.id);
      if (state.files.has(id) || state.pending.has(id)) return json({}, 409);
      state.pending.set(id, m);
      return r.fulfill({ status: 200, headers: { ...headers, Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=' + id } });
    }
    if (method === 'PUT') {
      const id = u.searchParams.get('upload_id')!, meta = state.pending.get(id), bytes = request.postDataBuffer();
      if (!meta || !bytes) return json({}, 404);
      state.files.set(id, { meta: { ...meta, size: String(bytes.length), trashed: false }, bytes }); state.pending.delete(id);
      return json({ id });
    }
    if (state.folders.has(key)) return json(state.folders.get(key));
    if (u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q') || '';
      if (q.includes("value='rc-folder-v1'")) return json({ incompleteSearch: false, files: [...state.folders.values()] });
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const wanted = /value='([^']+)'/.exec(q)?.[1];
      return json({ incompleteSearch: false, files: [...state.files.values()].map((f) => f.meta).filter((m) => (!parent || (m.parents as string[]).includes(parent)) && (!wanted || (m.appProperties as Record<string, string>).cv_contract === wanted)) });
    }
    const file = state.files.get(key);
    if (!file) return json({}, 404);
    return u.searchParams.get('alt') === 'media' ? r.fulfill({ headers, contentType: 'application/json', body: file.bytes }) : json(file.meta);
  });

  return { state, reset, blocked, googleCalls, seeds: vs };
}

/** Émulation PWA iPhone « écran d'accueil » : display-mode standalone + navigator.standalone. */
export const STANDALONE_INIT = `(() => {
  try {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = original(query);
      if (/\\(\\s*display-mode\\s*:\\s*standalone\\s*\\)/.test(query)) {
        return { matches: true, media: query, onchange: null,
          addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
      }
      return result;
    };
    Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
  } catch (e) { /* l'émulation ne doit jamais casser la page */ }
})();`;
