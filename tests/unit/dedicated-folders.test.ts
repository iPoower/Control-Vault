import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRIVE_FILE_SCOPE, OpaqueDrive } from '../../src/services/opaque-drive';

const origin = 'https://vault.fixture.test';
const entry = (id = 'dedicated-A') => ({ id, name: 'Dossier fictif', createdTime: '2026-10-28T00:00:00.000Z',
  mimeType: 'application/vnd.google-apps.folder', trashed: false, ownedByMe: true,
  appProperties: { cv_contract: 'rc-folder-v1' }, capabilities: { canAddChildren: true } });
const json = (data: unknown) => new Response(JSON.stringify(data));
const client = (network: typeof fetch) => {
  const p = new OpaqueDrive([origin], network); p.connect('fixture-token', 3600, [DRIVE_FILE_SCOPE]); return p;
};
beforeEach(() => vi.stubGlobal('location', { origin }));
afterEach(() => vi.unstubAllGlobals());

describe('dossiers dédiés déjà autorisés, transport simulé', () => {
  it('borne la recherche aux dossiers privés de l’application et lit toutes les pages sans écrire', async () => {
    const requests: URL[] = [];
    const network = vi.fn<typeof fetch>(async (url, init) => {
      const u = new URL(String(url)); requests.push(u);
      expect(u.pathname).toBe('/drive/v3/files');
      expect(u.searchParams.get('q')).toContain("'me' in owners");
      expect(u.searchParams.get('q')).toContain("appProperties has { key='cv_contract' and value='rc-folder-v1' }");
      expect(u.searchParams.get('q')).toContain("mimeType = 'application/vnd.google-apps.folder'");
      expect(u.searchParams.get('q')).toContain('trashed = false');
      expect(u.searchParams.get('spaces')).toBe('drive');
      expect(init?.method ?? 'GET').toBe('GET');
      expect(init?.credentials).toBe('omit'); expect(init?.cache).toBe('no-store'); expect(init?.redirect).toBe('error');
      expect(String(url)).not.toContain('fixture-token');
      return json(u.searchParams.has('pageToken') ? { incompleteSearch: false, files: [entry('dedicated-B')] }
        : { incompleteSearch: false, files: [entry()], nextPageToken: 'page-2' });
    });
    expect(await client(network).folders()).toEqual([
      { id: 'dedicated-A', name: 'Dossier fictif', createdTime: '2026-10-28T00:00:00.000Z' },
      { id: 'dedicated-B', name: 'Dossier fictif', createdTime: '2026-10-28T00:00:00.000Z' },
    ]);
    expect(requests).toHaveLength(2);
  });
  it.each([
    { ownedByMe: false }, { trashed: true }, { appProperties: { cv_contract: 'other' } },
    { mimeType: 'text/plain' }, { capabilities: { canAddChildren: false } },
    { id: '../other' }, { createdTime: 'unknown' }, { name: '' },
  ])('refuse une réponse incompatible avec le dossier autorisé : %j', async patch => {
    const p = client(vi.fn(async () => json({ incompleteSearch: false, files: [{ ...entry(), ...patch }] })));
    await expect(p.folders()).rejects.toMatchObject({ code: 'conflict' });
  });
  it.each([
    { incompleteSearch: true, files: [] }, { files: [] }, { incompleteSearch: false, files: null },
    { incompleteSearch: false, files: Array.from({ length: 101 }, (_, n) => entry('id-' + n)) },
  ])('n’annonce pas de liste partielle comme complète', async response => {
    await expect(client(vi.fn(async () => json(response))).folders()).rejects.toMatchObject({ code: 'incomplete' });
  });
  it('refuse doublon et boucle de pagination', async () => {
    for (const duplicate of [true, false]) {
      let n = 0;
      const p = client(vi.fn(async () => json({ incompleteSearch: false, files: [entry(duplicate ? 'same' : 'id-' + n++)], nextPageToken: 'repeated' })));
      await expect(p.folders()).rejects.toMatchObject({ code: 'incomplete' });
    }
  });
  it('refuse un historique de dossiers trop grand sans retourner un préfixe', async () => {
    let n = 0;
    const network = vi.fn(async () => json({ incompleteSearch: false, files: [], nextPageToken: 'page-' + ++n }));
    await expect(client(network).folders()).rejects.toMatchObject({ code: 'incomplete' });
    expect(network).toHaveBeenCalledTimes(10);
  });
  it('ne livre pas une liste reçue après déconnexion', async () => {
    let release!: (r: Response) => void;
    const p = client(vi.fn(() => new Promise<Response>(r => { release = r; })));
    const pending = p.folders(); p.disconnect(); release(json({ incompleteSearch: false, files: [entry()] }));
    await expect(pending).rejects.toMatchObject({ code: 'auth' });
  });
});
