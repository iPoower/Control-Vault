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
    const preview = await app.previewRestore(version.id);
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
    await expect(app.runRestore(version.id, () => {}, undefined, preview)).rejects.toThrow();
    expect(app.store.get().apps['race-control']).toBe(concurrent);
  }
  it('refuse de remplacer un état modifié pendant le téléchargement', () => conflict(false));
  it('ne restaure pas un ancien instantané quand le téléchargement échoue après un ajout concurrent', () => conflict(true));
});

describe('audit : interruptions, concurrence imbriquée et confidentialité', () => {
  it('refuse aussi une modification imbriquée sans remplacement de la référence', async () => {
    const version = app.versionsOf('race-control')[1];
    const preview = await app.previewRestore(version.id);
    await expect(app.runRestore(version.id, u => {
      if (u.index === 5 && u.state === 'running') app.store.get().apps['race-control'].payload.ajoutFictif = 'conservé';
    }, undefined, preview)).rejects.toThrow();
    expect(app.store.get().apps['race-control'].payload.ajoutFictif).toBe('conservé');
  });

  it('ne supprime pas un ajout imbriqué lors du retour arrière après publication', async () => {
    const version = app.versionsOf('race-control')[1];
    const preview = await app.previewRestore(version.id);
    await expect(app.runRestore(version.id, u => {
      if (u.index === 5 && u.state === 'done') {
        app.store.get().apps['race-control'].payload.ajoutFictif = 'conservé après publication';
        throw new Error('Interruption fictive après publication.');
      }
    }, undefined, preview)).rejects.toThrow();
    expect(app.store.get().apps['race-control'].payload.ajoutFictif).toBe('conservé après publication');
    expect(app.store.get().events[0].reason).not.toContain('n’ont pas été modifiées');
  });

  it('révoque une preuve déjà invalidée même si le contrôle global est ensuite annulé', async () => {
    const version = app.store.get().versions[0], file = app.drive.findByVersion(version.id)!;
    const download = app.drive.download.bind(app.drive);
    vi.spyOn(app.drive, 'download').mockImplementation((id, signal) => id === file.id ? Promise.resolve(new Uint8Array([9])) : download(id, signal));
    const ctrl = new AbortController();
    await expect(app.verifyAll(done => { if (done === 1) ctrl.abort(); }, ctrl.signal)).rejects.toThrow();
    expect(app.store.get().versions.find(v => v.id === version.id)?.verifiedAt).toBeUndefined();
    expect(app.drive.bytesOf(file.id)).not.toBeNull();
  });

  it('n’attribue pas une preuve ancienne à une version remplacée pendant la lecture', async () => {
    const version = app.store.get().versions[0], file = app.drive.findByVersion(version.id)!;
    const download = app.drive.download.bind(app.drive);
    vi.spyOn(app.drive, 'download').mockImplementation(async (id, signal) => {
      const bytes = await download(id, signal);
      if (id === file.id) app.store.set({ versions: app.store.get().versions.map(v => v.id === version.id ? { ...v, sha256: '0'.repeat(64), verifiedAt: undefined } : v) });
      return bytes;
    });
    await app.verifyAll(() => {});
    expect(app.store.get().versions.find(v => v.id === version.id)?.verifiedAt).toBeUndefined();
  });

  it('ne confirme pas un succès si l’annulation survient à la fin de la relecture', async () => {
    const before = app.store.get().versions.length, ctrl = new AbortController();
    const download = app.drive.download.bind(app.drive);
    vi.spyOn(app.drive, 'download').mockImplementation(async (id, signal) => { const bytes = await download(id, signal); ctrl.abort(); return bytes; });
    await expect(app.runBackup('race-control', () => {}, ctrl.signal)).rejects.toThrow();
    expect(app.store.get().versions).toHaveLength(before);
    expect(app.store.get().events[0].result).toBe('cancelled');
  });

  it('ne transmet aucun message brut de fournisseur au journal ni à l’erreur publique', async () => {
    const marker = 'DONNEE-FICTIVE-CONFIDENTIELLE';
    vi.mocked(app.drive.upload).mockRejectedValue(new Error(marker));
    let error: unknown;
    try { await app.runBackup('race-control', () => {}); } catch (e) { error = e; }
    expect(String(error)).not.toContain(marker);
    expect(await app.exportJournal().text()).not.toContain(marker);
    expect(app.store.get().events[0].result).toBe('failed');
  });

  it('exige un aperçu authentique, encore actuel et utilisable une seule fois', async () => {
    const version = app.versionsOf('race-control')[1];
    await expect(app.runRestore(version.id, () => {})).rejects.toThrow(/aperçu/);
    const preview = await app.previewRestore(version.id);
    app.store.get().apps['race-control'].payload.ajoutFictif = 'après aperçu';
    await expect(app.runRestore(version.id, () => {}, undefined, preview)).rejects.toThrow(/aperçu/);
    expect(app.store.get().apps['race-control'].payload.ajoutFictif).toBe('après aperçu');
    await expect(app.runRestore(version.id, () => {}, undefined, preview)).rejects.toThrow(/aperçu/);
  });

  it('restaure une version après aperçu et laisse l’état précédent récupérable', async () => {
    const version = app.versionsOf('race-control')[1], before = structuredClone(app.store.get().apps['race-control'].payload);
    const preview = await app.previewRestore(version.id);
    const result = await app.runRestore(version.id, () => {}, undefined, preview);
    expect(app.store.get().apps['race-control'].payload).toEqual(preview.payload);
    expect((await app.previewRestore(result.safetyVersionId)).payload).toEqual(before);
    await expect(app.runRestore(version.id, () => {}, undefined, preview)).rejects.toThrow(/aperçu/);
  });

  it('rétablit fidèlement l’état précédent si aucune écriture concurrente ne suit l’application', async () => {
    const version = app.versionsOf('race-control')[1], before = structuredClone(app.store.get().apps['race-control']);
    const preview = await app.previewRestore(version.id);
    await expect(app.runRestore(version.id, u => { if (u.index === 5 && u.state === 'done') throw new Error('Interruption fictive.'); }, undefined, preview)).rejects.toThrow();
    expect(app.store.get().apps['race-control']).toEqual(before);
    expect(app.store.get().events[0]).toMatchObject({ type: 'restore', result: 'failed' });
  });

  it('refuse une relecture trop grande avant de tenter le déchiffrement', async () => {
    const version = app.versionsOf('race-control')[1];
    vi.spyOn(app.drive, 'download').mockResolvedValue(new Uint8Array(10 * 1024 * 1024 + 50));
    await expect(app.previewRestore(version.id)).rejects.toThrow(/Taille/);
  });

  it('le contrôle de sélection relit les octets, même avec une empreinte fournisseur inchangée', async () => {
    const version = app.versionsOf('race-control')[0];
    vi.spyOn(app.drive, 'download').mockResolvedValue(new Uint8Array([9]));
    expect(await app.verifyVersions([version.id])).toEqual({ total: 1, mismatches: 1 });
    expect(app.store.get().versions.find(v => v.id === version.id)?.verifiedAt).toBeUndefined();
  });
  it('une erreur de lecture du fichier importé reste expurgée et n’annonce aucun succès', async () => {
    const file = { name: 'fixture.json', size: 2, text: async () => { throw new Error('DONNEE-FICTIVE-CONFIDENTIELLE'); } } as unknown as File;
    await expect(app.importJson(file, app.FOLDER.archives)).rejects.not.toThrow(/DONNEE-FICTIVE/);
    expect(app.store.get().events[0]).toMatchObject({ type: 'import', result: 'failed' });
  });

  it('refuse une taille de catalogue incompatible avant tout téléchargement', async () => {
    const version = app.versionsOf('race-control')[1];
    app.store.set({ versions: app.store.get().versions.map(v => v.id === version.id ? { ...v, sizeBytes: 100 * 1024 * 1024 } : v) });
    const download = vi.spyOn(app.drive, 'download');
    await expect(app.previewRestore(version.id)).rejects.toThrow(/volumineuse/);
    expect(download).not.toHaveBeenCalled();
  });

  it('refuse un chiffré corrompu même si le catalogue contient son nouveau hash', async () => {
    const version = app.versionsOf('race-control')[1], file = app.drive.findByVersion(version.id)!;
    const bytes = app.drive.bytesOf(file.id)!; bytes[bytes.length - 1] ^= 1;
    const hash = await sha256(bytes), before = structuredClone(app.store.get().apps);
    app.drive.seed(file, bytes, hash);
    app.store.set({ versions: app.store.get().versions.map(v => v.id === version.id ? { ...v, sha256: hash } : v) });
    await expect(app.previewRestore(version.id)).rejects.toThrow(/Déchiffrement impossible/);
    expect(app.store.get().apps).toEqual(before);
  });

  it('arrête la restauration si la copie préalable n’est pas vérifiée', async () => {
    const version = app.versionsOf('race-control')[1], preview = await app.previewRestore(version.id);
    const before = structuredClone(app.store.get().apps);
    vi.spyOn(app.drive, 'remoteSha256').mockResolvedValue('0'.repeat(64));
    await expect(app.runRestore(version.id, () => {}, undefined, preview)).rejects.toThrow();
    expect(app.store.get().apps).toEqual(before);
    expect(app.store.get().events.some(e => e.type === 'restore' && e.result === 'success')).toBe(false);
  });

  it('conserve 120 sources fictives et leurs champs inconnus dans la sauvegarde et sa relecture', async () => {
    const current = app.store.get().apps['race-control'];
    const payload = { ...current.payload, revision: 123, trajets: Array.from({ length: 120 }, (_, i) => ({ id: `fiction-${i}`, at: i === 0 ? '2025-01-01' : '2026-01-01', inconnu: { source: i } })), champFutur: { integral: true } };
    app.store.set({ apps: { ...app.store.get().apps, 'race-control': { ...current, payload } } });
    const { version } = await app.runBackup('race-control', () => {});
    expect(version.counts.trajets).toBe(120);
    expect((await app.previewRestore(version.id)).payload).toEqual(payload);
  });
});
