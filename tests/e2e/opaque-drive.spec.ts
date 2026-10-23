import { test, expect, type BrowserContext } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { packetFixture, fixtureCode } from '../fixtures/race-packet';

const origin = 'https://vault-drive.fixture.test', folder = 'fixture-folder';
let runtime: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, target: 'es2022', minify: false,
    lib: { entry: resolve('tests/fixtures/opaque-drive-runtime.ts'), name: 'CVDriveTest', formats: ['iife'] } } });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Bundle absent');
  const code = output.output.find(x => x.type === 'chunk');
  if (!code || code.type !== 'chunk') throw new Error('Runtime absent');
  runtime = code.code;
});

// Serveur entièrement simulé : aucun compte, endpoint ou jeton Google réel.
function remoteFixture() {
  type Entry = { meta: Record<string, unknown>; bytes: Buffer };
  const files = new Map<string, Entry>(), pending = new Map<string, Record<string, unknown>>();
  let next = 0, corrupted = false;
  async function route(context: BrowserContext) {
    await context.route(origin + '/**', async r => {
      const script = new URL(r.request().url()).pathname === '/runtime.js';
      await r.fulfill({ contentType: script ? 'text/javascript' : 'text/html',
        headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src https://www.googleapis.com; frame-ancestors 'none'" },
        body: script ? runtime : '<!doctype html><html><head><title>Drive fictif</title><script src="/runtime.js"></script></head><body></body></html>' });
    });
    await context.route('https://www.googleapis.com/**', async r => {
      const request = r.request(), u = new URL(request.url()), method = request.method(), key = u.pathname.split('/').at(-1)!;
      const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
        'Access-Control-Allow-Headers': 'authorization,content-type,content-range,x-upload-content-type,x-upload-content-length',
        'Access-Control-Expose-Headers': 'Location,Range,Content-Length' };
      const json = (value: unknown, status = 200) => r.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
      if (method === 'OPTIONS') { await r.fulfill({ status: 204, headers }); return; }
      expect(request.headers().authorization).toBe('Bearer fixture-token');
      expect(u.searchParams.has('access_token')).toBe(false);
      if (u.pathname.endsWith('/generateIds')) { await json({ ids: ['fixture-version-' + (++next)] }); return; }
      if (method === 'POST') {
        const meta = request.postDataJSON() as Record<string, unknown>, id = String(meta.id);
        if (files.has(id) || pending.has(id)) { await json({}, 409); return; }
        pending.set(id, meta);
        await r.fulfill({ status: 200, headers: { ...headers, Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=' + id } }); return;
      }
      if (method === 'PUT') {
        const id = u.searchParams.get('upload_id')!, meta = pending.get(id)!;
        const bytes = request.postDataBuffer()!;
        expect(request.headers()['content-range']).toBe(`bytes 0-${bytes.length - 1}/${bytes.length}`);
        files.set(id, { meta: { ...meta, size: String(bytes.length), trashed: false }, bytes }); pending.delete(id);
        await json({ id }); return;
      }
      if (key === folder) { await json({ id: folder, mimeType: 'application/vnd.google-apps.folder', trashed: false, ownedByMe: true, appProperties: { cv_contract: 'rc-folder-v1' }, capabilities: { canAddChildren: true } }); return; }
      if (u.pathname === '/drive/v3/files') { await json({ incompleteSearch: false, files: [...files.values()].map(x => x.meta) }); return; }
      const entry = files.get(key);
      if (!entry) { await json({}, 404); return; }
      if (u.searchParams.get('alt') === 'media') {
        const bytes = Buffer.from(entry.bytes); if (corrupted) bytes[0] ^= 1;
        await r.fulfill({ headers, contentType: 'application/json', body: bytes }); return;
      }
      await json(entry.meta);
    });
  }
  return { route, files, corrupt: () => { corrupted = true; } };
}

// Reconstitution de la clé depuis le seul code + paquet, dans l'adaptateur
// propriétaire de test Node. Aucune clé ou donnée claire dans le navigateur Vault.
async function independentlyDecrypt(bytes: number[]) {
  const e = JSON.parse(Buffer.from(bytes).toString('utf8')), enc = new TextEncoder();
  const material = await webcrypto.subtle.importKey('raw', enc.encode(fixtureCode), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(e.payload.s, 'base64'), iterations: e.payload.it, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const aad = enc.encode(JSON.stringify([e.format, e.schemaVersion, e.createdAt, e.appVersion, e.payload.alg, e.payload.kdf, e.payload.it, e.payload.s, e.payload.i]));
  const clear = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(e.payload.i, 'base64'), additionalData: aad }, key, Buffer.from(e.payload.c, 'base64'));
  return new TextDecoder('utf-8', { fatal: true }).decode(clear);
}

test('deux profils isolés : versions aller-retour, relecture et corruption distante', async ({ browser }, info) => {
  test.setTimeout(45000);
  const remote = remoteFixture(), first = await packetFixture(120), second = await packetFixture(61);
  const profiles: BrowserContext[] = [];
  async function device() {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: info.project.use.viewport,
      deviceScaleFactor: info.project.use.deviceScaleFactor, hasTouch: info.project.use.hasTouch,
      isMobile: info.project.use.isMobile, userAgent: info.project.use.userAgent });
    profiles.push(context); await remote.route(context);
    const page = await context.newPage(); await page.goto(origin);
    expect(page.viewportSize()).toEqual(info.project.use.viewport); return page;
  }
  try {
    let pc = await device();
    const upload = async (page: typeof pc, bytes: Uint8Array) => page.evaluate(async raw => {
      const api = (window as any).CVDriveTest, archive = new api.OpaqueArchive();
      const packet = await api.readRacePacket(new Uint8Array(raw)); await archive.save(packet);
      const drive = new api.OpaqueDrive([location.origin]); drive.connect('fixture-token', 3600, [api.DRIVE_FILE_SCOPE]);
      const id = await drive.reserveId();
      const proof = (await drive.upload(id, 'fixture-folder', packet)).proof;
      drive.disconnect(); await archive.close(); return proof;
    }, [...bytes]);
    const read = async (page: typeof pc) => page.evaluate(async () => {
      const api = (window as any).CVDriveTest, archive = new api.OpaqueArchive(), drive = new api.OpaqueDrive([location.origin]);
      drive.connect('fixture-token', 3600, [api.DRIVE_FILE_SCOPE]);
      const versions = await drive.list('fixture-folder'), copies = [];
      for (const version of versions) {
        const { packet, proof } = await drive.download(version), row = await archive.save(packet);
        copies.push({ id: version.fileSha256, bytes: [...packet.copyBytes()], proof: proof.state, local: row.state });
      }
      drive.disconnect(); await archive.close(); return copies;
    });
    expect((await upload(pc, first.bytes)).state).toBe('verified-bytes');
    await pc.context().close();
    const phone = await device(), fromPC = await read(phone);
    expect(fromPC).toHaveLength(1); expect(fromPC[0].bytes).toEqual([...first.bytes]);
    expect(await independentlyDecrypt(fromPC[0].bytes)).toBe(first.clear);
    expect((await upload(phone, second.bytes)).state).toBe('verified-bytes'); await phone.context().close();
    pc = await device();
    const both = await read(pc);
    expect(both.map(x => x.id).sort()).toEqual([first.hash, second.hash].sort());
    expect(both.every(x => x.proof === 'verified-bytes' && x.local === 'local-only')).toBe(true);
    for (const fixture of [first, second]) expect(await independentlyDecrypt(both.find(x => x.id === fixture.hash)!.bytes)).toBe(fixture.clear);
    remote.corrupt();
    await expect(read(pc)).rejects.toThrow('integrity');
    expect(remote.files.size).toBe(2); // refus sans suppression ni remplacement
  } finally { for (const profile of profiles) await profile.close(); }
});

test('révisions A2 : toutes les déclarations conservées, modification distante refusée après relecture', async ({ page, context }) => {
  const remote = remoteFixture(), fixture = await packetFixture();
  await remote.route(context); await page.goto(origin);
  const revisions = [
    { id: 'a'.repeat(32), device: 'd'.repeat(32), parents: [], seq: 1 },
    { id: 'b'.repeat(32), device: 'd'.repeat(32), parents: ['a'.repeat(32)], seq: 2 },
    { id: 'c'.repeat(32), device: 'e'.repeat(32), parents: ['a'.repeat(32)], seq: 1 },
  ];
  const versions = await page.evaluate(async ({ bytes, revisions }) => {
    const api = (window as any).CVDriveTest, drive = new api.OpaqueDrive([location.origin]);
    drive.connect('fixture-token', 3600, [api.DRIVE_FILE_SCOPE]);
    try {
      const packet = await api.readRacePacket(new Uint8Array(bytes));
      for (const revision of revisions) {
        const result = await drive.uploadRevision(await drive.reserveId(), 'fixture-folder', packet, revision);
        if (result.proof.state !== 'verified-bytes') throw new Error('Relecture absente');
      }
      return await drive.list('fixture-folder'); // Déclarations non authentifiées, aucune tête sélectionnée.
    } finally { drive.disconnect(); }
  }, { bytes: [...fixture.bytes], revisions });
  expect(versions.map((v: any) => v.revision)).toEqual(revisions);
  expect(versions.every((v: any) => v.state === 'unverified')).toBe(true);
  const entry = remote.files.get(versions[1].fileId)!;
  (entry.meta.appProperties as Record<string, string>).rcs = '3';
  await expect(page.evaluate(async reference => {
    const api = (window as any).CVDriveTest, drive = new api.OpaqueDrive([location.origin]);
    drive.connect('fixture-token', 3600, [api.DRIVE_FILE_SCOPE]);
    try { await drive.download(reference); } finally { drive.disconnect(); }
  }, versions[1])).rejects.toThrow('integrity');
  expect(remote.files.size).toBe(3);
  for (const stored of remote.files.values()) expect(stored.bytes).toEqual(Buffer.from(fixture.bytes));
});
