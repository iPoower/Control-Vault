// Régressions ciblées du prototype : données fictives, services mémoire uniquement.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '../../src/core/crypto';
import type { DriveItem } from '../../src/core/types';

let app: typeof import('../../src/app');

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('navigator', { onLine: true });
  app = await import('../../src/app');
  app.drive.latency = 0;
  await app.boot();
  // Même contrat que le fournisseur de démo, sans attendre ses animations.
  vi.spyOn(app.drive, 'upload').mockImplementation(async (file) => {
    const item: DriveItem = { id: 'fiction-upload-' + app.drive.items.size, name: file.name, parentId: file.parentId,
      kind: 'file', family: file.family, sizeBytes: file.bytes.length, modifiedAt: Date.now(), versionId: file.versionId };
    app.drive.seed(item, file.bytes.slice(), await sha256(file.bytes));
    return item;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('confirmation après relecture des octets', () => {
  it('ne confirme pas une sauvegarde si le hash fournisseur est correct mais le téléchargement est altéré', async () => {
    const before = app.store.get().versions.length;
    vi.spyOn(app.drive, 'download').mockResolvedValue(new Uint8Array([1, 2, 3]));
    await expect(app.runBackup('race-control', () => {})).rejects.toThrow();
    expect(app.store.get().versions).toHaveLength(before);
    expect(app.store.get().events[0]).toMatchObject({ result: 'failed' });
  });

  it('rejette un import JSON si son empreinte distante diffère, sans résultat de réussite', async () => {
    vi.spyOn(app.drive, 'remoteSha256').mockResolvedValue('0'.repeat(64));
    const file = new File(['{"fiction":true}'], 'fixture.json', { type: 'application/json' });
    await expect(app.importJson(file, app.FOLDER.archives)).rejects.toThrow();
    expect(app.store.get().events[0]).toMatchObject({ type: 'import', result: 'failed' });
  });

  it('refuse un fichier surdimensionné avant de lire son contenu', async () => {
    const text = vi.fn().mockResolvedValue('{}');
    const file = { name: 'fixture.json', size: 10 * 1024 * 1024 + 1, text } as unknown as File;
    await expect(app.importJson(file, app.FOLDER.archives)).rejects.toThrow();
    expect(text).not.toHaveBeenCalled();
  });

  it('révoque uniquement la vérification du fichier qui échoue à la relecture', async () => {
    const version = app.versionsOf('race-control')[0], file = app.drive.findByVersion(version.id)!;
    const download = app.drive.download.bind(app.drive);
    vi.spyOn(app.drive, 'download').mockImplementation((id, signal) => id === file.id ? Promise.resolve(new Uint8Array([9])) : download(id, signal));
    const result = await app.verifyAll(() => {});
    expect(result.mismatches).toBe(1);
    expect(app.store.get().versions.find(v => v.id === version.id)?.verifiedAt).toBeUndefined();
    expect(app.store.get().versions.filter(v => v.id !== version.id).every(v => v.verifiedAt)).toBe(true);
  });
});

describe('restauration : préserver une modification concurrente', () => {
  it('refuse dès l’aperçu un fichier dont le catalogue indique la mauvaise application', async () => {
    const version = app.versionsOf('reconversion-control')[0];
    app.store.set({ versions: app.store.get().versions.map(v => v.id === version.id ? { ...v, appId: 'race-control' } : v) });
    await expect(app.previewRestore(version.id)).rejects.toThrow(/autre application/);
  });
  async function conflict(fail: boolean) {
    const version = app.versionsOf('race-control')[1], file = app.drive.findByVersion(version.id)!;
    const before = app.store.get().apps['race-control'];
    const concurrent = { ...before, payload: { ...before.payload, revision: 999, ajoutFictif: 'à conserver' } };
    const download = app.drive.download.bind(app.drive);
    vi.spyOn(app.drive, 'download').mockImplementation(async (id, signal) => {
      if (id === file.id) {
        app.store.set({ apps: { ...app.store.get().apps, 'race-control': concurrent } });
        if (fail) throw new Error('Téléchargement fictif interrompu.');
      }
      return download(id, signal);
    });
    await expect(app.runRestore(version.id, () => {})).rejects.toThrow();
    expect(app.store.get().apps['race-control']).toBe(concurrent);
  }
  it('refuse de remplacer un état modifié pendant le téléchargement', () => conflict(false));
  it('ne restaure pas un ancien instantané quand le téléchargement échoue après un ajout concurrent', () => conflict(true));
});
