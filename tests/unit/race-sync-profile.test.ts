import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { readRacePacket } from '../../src/core/race-packet';

// Addendum A1 : propriétaire RC exact de la PR iPoower/iPoower#218 (tête
// 2fd6f24d9366ac14c5d8436e0ae20c7d0be8cb79), uniquement dans Node. Vault ne
// reçoit que les octets ; il ne dérive ni n'utilise jamais la clé de synchronisation.
const digest = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');
const codecSource = readFileSync('tests/fixtures/race-owner-sync/control-vault-packet.js', 'utf8');
const keySource = readFileSync('tests/fixtures/race-owner-sync/sync-key.js', 'utf8');
const PROVENANCE = {
  codec: 'e72f424ca394d8ef2ce1563fa04d2e87fdefb12a21e46f395fe8488f98e95166',
  key: 'f26168d4777ba94cdc626b0f2186ed98af0eae34b3e2eb42be9e19a01d749da3',
  addendum: '03fb30c20b2114292cfafd92aaad07610bcad8bc2f0b44b90a9bbd730c5c9ec6'
};
const code = 'synthetic-sync-passphrase', at = '2026-10-22T10:00:00.000Z';
const data = { app: 'twrc', v: 1, at, settings: { cars: [] }, view: 'garage' };
interface Handle { key: unknown; keyId: string; s: string }
interface Owner {
  codec: { sealWith(d: unknown, h: Handle, v: string, at: string): Promise<Uint8Array>; openWith(b: Uint8Array, h: Handle, v: string, r?: string): Promise<unknown>;
    open(b: Uint8Array, c: string, v: string): Promise<unknown> };
  key: { create(c: string, crypto: unknown, at: string): Promise<{ descriptor: Record<string, unknown>; handle: Handle }>; derive(d: unknown, c: string, crypto: unknown): Promise<Handle> };
}
function device(): Owner {
  const context = { Date, JSON, Math, Number, Object, Array, RegExp, Set, Map, String, Uint8Array, TextEncoder, TextDecoder, Promise, Error,
    atob, btoa, crypto: webcrypto, validateBusiness: (d: unknown) => JSON.stringify(d) === JSON.stringify(data) };
  createContext(context);
  return runInContext(codecSource + '\n' + keySource + ';({ codec: ControlVaultPacket.create({ validateBusiness }), key: SyncKey });', context) as Owner;
}
describe('addendum A1 — profil de synchronisation RC, transport inchangé', () => {
  it('épingle le codec, la clé et un addendum strictement identique à Race Control', () => {
    expect(digest(codecSource)).toBe(PROVENANCE.codec);
    expect(digest(keySource)).toBe(PROVENANCE.key);
    expect(digest(readFileSync('docs/INTEGRATION_SYNC_A1.md'))).toBe(PROVENANCE.addendum);
    expect(readFileSync('docs/INTEGRATION.md', 'utf8')).not.toContain('race-control-sync-key');
  });
  it('accepte et conserve à l’identique les paquets à sel de compte des deux appareils', async () => {
    const pc = device(), phone = device();
    const { descriptor, handle } = await pc.key.create(code, webcrypto, at);
    const phoneHandle = await phone.key.derive(descriptor, code, webcrypto);
    const a = await pc.codec.sealWith(data, handle, 'prod-156', at), b = await phone.codec.sealWith(data, phoneHandle, 'prod-156', at);
    const ea = JSON.parse(new TextDecoder().decode(a)), eb = JSON.parse(new TextDecoder().decode(b));
    expect(ea.payload.s).toBe(descriptor.s); expect(eb.payload.s).toBe(descriptor.s); expect(ea.payload.i).not.toBe(eb.payload.i);
    for (const bytes of [a, b]) {
      const opaque = await readRacePacket(bytes, digest(bytes));
      const kept = opaque.copyBytes();
      expect(digest(kept)).toBe(digest(bytes));
      // Le propriétaire relit sans code via sa clé reprise, ou avec le code par le chemin manuel.
      expect(await phone.codec.openWith(kept, phoneHandle, 'prod-156', digest(bytes))).toEqual(data);
      expect(await device().codec.open(kept, code, 'prod-156')).toEqual(data);
    }
  });
  it('le descripteur public n’est jamais pris pour une sauvegarde et ne contient aucun secret', async () => {
    const { descriptor } = await device().key.create(code, webcrypto, at);
    const text = JSON.stringify(descriptor);
    expect(text).not.toContain(code);
    await expect(readRacePacket(new TextEncoder().encode(text))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
  });
  it('aucun code de dérivation de clé RC dans le bundle Vault', () => {
    for (const file of ['src/core/race-packet.ts', 'src/services/opaque-drive.ts', 'src/services/opaque-archive.ts'])
      expect(readFileSync(file, 'utf8')).not.toMatch(/SyncKey\.|deriveKey|deriveBits|subtle\.decrypt/);
  });
});
