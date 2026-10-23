import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
import { OpaqueDrive, DRIVE_FILE_SCOPE } from '../../src/services/opaque-drive';
import { GoogleDriveSession } from '../../src/services/google-drive-session.js';

const digest = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
async function descriptor() {
  const c = { crypto: webcrypto, TextEncoder, Uint8Array, btoa, atob };
  createContext(c);
  return new TextEncoder().encode(await runInContext(readFileSync('tests/fixtures/race-owner-sync/sync-key.js', 'utf8') + ';SyncKey.create("synthetic-owner-code").then(v=>JSON.stringify(v.descriptor));', c));
}
describe('connexion réelle et métadonnées publiques A1', () => {
  it('partage le client/projet et refuse les identifiants de compte, dossier, code ou secret', () => {
    const config = { approved: true, clientId: ['123456', 'fake.apps.googleusercontent.com'].join('-'), apiKey: 'AIza' + 'a'.repeat(35), appId: '123456', raceOrigin: 'https://race.example.com', vaultOrigin: 'https://vault.example.com' };
    expect(GoogleDriveSession.config(config, config.vaultOrigin)).toEqual(config);
    for (const extra of [{ token: 'secret' }, { folderId: 'private' }, { code: 'private' }, { secret: 'private' }, { approved: false }, { appId: '654321' }])
      expect(() => GoogleDriveSession.config({ ...config, ...extra }, config.vaultOrigin)).toThrow();
    expect(() => GoogleDriveSession.config(config, 'https://ipoower.github.io')).toThrow();
  });
  it('publie un descripteur immuable sous identifiant réservé, puis relit les octets ; pas de clé dans Vault', async () => {
    vi.stubGlobal('location', { origin: 'https://vault.example.com' });
    const bytes = await descriptor(), hash = digest(bytes), requests: { url: string; method: string }[] = [];
    let stored = false;
    const fetcher = (async (url: string, init: RequestInit) => {
      requests.push({ url, method: init.method || 'GET' });
      expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('error'); expect(init.cache).toBe('no-store');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer synthetic_token'); expect(url).not.toContain('synthetic_token');
      const u = new URL(url), json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
      if (u.pathname.endsWith('/about')) return json({ user: { permissionId: 'synthetic_account' } });
      if (u.pathname.endsWith('/files/generateIds')) return json({ ids: ['reserved_key'] });
      if (u.pathname === '/upload/drive/v3/files') { expect(init.method).toBe('POST'); expect(String(init.body)).not.toContain('synthetic-owner-code'); expect(String(init.body)).toContain('reserved_key'); stored = true; return json({ id: 'reserved_key' }); }
      if (u.pathname.endsWith('/files/folder_A')) return json({ id: 'folder_A', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } });
      if (u.pathname.endsWith('/files/reserved_key')) {
        if (!stored) return json({}, 404);
        if (u.searchParams.get('alt') === 'media') return new Response(bytes as BodyInit);
        return json({ id: 'reserved_key', size: String(bytes.length), parents: ['folder_A'], appProperties: { cv_contract: 'rc-key-a1', cv_file: hash } });
      }
      if (u.pathname.endsWith('/files')) return json({ incompleteSearch: false, files: stored ? [{ id: 'reserved_key', size: String(bytes.length), appProperties: { cv_contract: 'rc-key-a1', cv_file: hash } }] : [] });
      throw new Error('Unexpected request');
    }) as typeof fetch;
    const drive = new OpaqueDrive(['https://vault.example.com'], fetcher); drive.connect('synthetic_token', 3600, [DRIVE_FILE_SCOPE]);
    expect(await drive.account()).toBe('synthetic_account');
    const id = await drive.reserveId(); expect(id).toBe('reserved_key');
    expect((await drive.uploadProfile(id, 'folder_A', bytes)).sha256).toBe(hash);
    expect((await drive.profiles('folder_A'))[0].bytes).toEqual(bytes);
    await drive.uploadProfile(id, 'folder_A', bytes);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(requests.some(r => /PATCH|DELETE/.test(r.method))).toBe(false);
    drive.disconnect(); await expect(drive.account()).rejects.toMatchObject({ code: 'auth' });
    vi.unstubAllGlobals();
  });
  it('refuse le JSON personnel et les doublons JSON avant tout appel réseau', async () => {
    vi.stubGlobal('location', { origin: 'https://vault.example.com' }); const fetcher = vi.fn();
    const drive = new OpaqueDrive(['https://vault.example.com'], fetcher); drive.connect('synthetic_token', 3600, [DRIVE_FILE_SCOPE]);
    const bytes = await descriptor(), text = new TextDecoder().decode(bytes);
    for (const bad of [new TextEncoder().encode('{"settings":{"private":true}}'), new TextEncoder().encode(text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'))])
      await expect(drive.uploadProfile('reserved_key', 'folder_A', bad)).rejects.toMatchObject({ code: 'integrity' });
    expect(fetcher).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it('le parcours réel ne dépend pas de DemoDrive ni de l’import métier générique', () => {
    const source = readFileSync('src/services/connected-drive.ts', 'utf8');
    expect(source).not.toMatch(/DemoDrive|from ['"]\.\.\/app|deriveKey|subtle\.decrypt|localStorage|sessionStorage/);
    expect(source).toContain('readRacePacket'); expect(source).toContain('cv-drive-outbox-v1');
  });
});
