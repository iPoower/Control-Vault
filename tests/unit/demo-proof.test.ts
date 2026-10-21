import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKey, sha256 } from '../../src/core/crypto';
import { demoApps, seedDemo } from '../../src/data/demo';
import { DemoDrive } from '../../src/services/demo-drive';

afterEach(() => vi.restoreAllMocks());
const fixture = () => new DemoDrive({ usedBytes: 0, totalBytes: 1e9, planNote: 'fiction', checkedAt: 0 }, () => 'normal', () => true);

describe('preuves initiales de démonstration', () => {
  it('relit chaque fichier conservé avant de lui attribuer une preuve SHA-256', async () => {
    const drive = fixture(), read = vi.spyOn(drive, 'bytesOf'), at = Date.now();
    const result = await seedDemo(drive, demoApps(at), await generateKey(), at);
    expect(read).toHaveBeenCalledTimes(result.versions.length);
    for (const v of result.versions) {
      const bytes = drive.bytesOf(drive.findByVersion(v.id)!.id)!;
      expect(await sha256(bytes)).toBe(v.sha256);
      expect(v.verifiedAt).toBeGreaterThanOrEqual(at);
    }
  });
  it('ne démarre pas en annonçant des sauvegardes vérifiées si la copie conservée est corrompue', async () => {
    const drive = fixture(), at = Date.now();
    vi.spyOn(drive, 'bytesOf').mockReturnValue(new Uint8Array([9]));
    await expect(seedDemo(drive, demoApps(at), await generateKey(), at)).rejects.toThrow(/Contrôle initial/);
  });
});
