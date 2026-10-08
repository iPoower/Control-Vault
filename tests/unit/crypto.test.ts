import { describe, expect, it } from 'vitest';
import { decrypt, deriveKey, encrypt, generateKey, readEnvelope, sameHash, sha256, VaultFormatError } from '../../src/core/crypto';

describe('empreintes', () => {
  it('SHA-256 conforme au vecteur de test « abc »', async () => {
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('comparaison en temps constant', () => {
    expect(sameHash('abcd', 'abcd')).toBe(true);
    expect(sameHash('abcd', 'abce')).toBe(false);
    expect(sameHash('abc', 'abcd')).toBe(false);
  });
});

describe('chiffrement AES-256-GCM', () => {
  it('aller-retour fidèle', async () => {
    const key = await generateKey();
    const text = JSON.stringify({ app: 'race-control', trajets: [{ id: 1, debrief: 'Pluie fine, adhérence rassurante' }] });
    const blob = await encrypt(key, text);
    expect(new TextDecoder().decode(blob.slice(0, 4))).toBe('CVLT');
    expect(await decrypt(key, blob)).toBe(text);
  });

  it('deux chiffrements du même contenu diffèrent (IV aléatoire)', async () => {
    const key = await generateKey();
    const a = await encrypt(key, 'même contenu');
    const b = await encrypt(key, 'même contenu');
    expect(await sha256(a)).not.toBe(await sha256(b));
  });

  it('un seul octet altéré est détecté', async () => {
    const key = await generateKey();
    const blob = await encrypt(key, 'données importantes');
    blob[blob.length - 3] ^= 0x01;
    await expect(decrypt(key, blob)).rejects.toBeInstanceOf(VaultFormatError);
  });

  it('mauvaise clé refusée', async () => {
    const blob = await encrypt(await generateKey(), 'secret');
    await expect(decrypt(await generateKey(), blob)).rejects.toThrow(/clé incorrecte ou fichier altéré/);
  });

  it('fichier étranger refusé', () => {
    expect(() => readEnvelope(new TextEncoder().encode('{"pas":"une sauvegarde"}'))).toThrow(VaultFormatError);
  });

  it('clé dérivée d’une phrase secrète : même phrase + même sel = même clé', async () => {
    const salt = new Uint8Array(16).fill(7);
    const k1 = await deriveKey('cheval batterie agrafe correcte', salt, 1000);
    const k2 = await deriveKey('cheval batterie agrafe correcte', salt, 1000);
    const blob = await encrypt(k1, 'ok', salt);
    expect(await decrypt(k2, blob)).toBe('ok');
    const k3 = await deriveKey('autre phrase', salt, 1000);
    await expect(decrypt(k3, blob)).rejects.toBeInstanceOf(VaultFormatError);
  });
});
