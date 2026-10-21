// Propriétaire de test isolé dans Node, jamais inclus dans le navigateur Vault.
// Codec exact de Race Control #216, instantanés métier issus de ses vrais modules.
import { webcrypto, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
const source = readFileSync('tests/fixtures/race-owner/control-vault-packet.js', 'utf8');
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const fixtureCode = 'synthetic-recovery-passphrase';
interface OwnerCodec {
  seal(data: unknown, code: string, version: string, at: string): Promise<Uint8Array>;
  open(bytes: Uint8Array, code: string, version: string, reference?: string): Promise<unknown>;
}
export async function packetFixture(count = 120) {
  if (![61, 120].includes(count)) throw new Error('Nombre de trajets fictifs inconnu');
  const snapshot = JSON.parse(readFileSync(`tests/fixtures/race-owner/business-${count}.json`, 'utf8'));
  const clear = JSON.stringify(snapshot.data);
  if (snapshot.repository !== 'iPoower/iPoower' || snapshot.commit !== '7f7e36fbd3083c84ca9e6a62ee5c28185de94d65' ||
    snapshot.codecSha256 !== digest(source) || snapshot.businessSha256 !== digest(clear) || snapshot.archiveRecords !== count + 2)
    throw new Error('Provenance de la fixture propriétaire invalide');
  function owner(): OwnerCodec {
    // Les objets JSON ont le même prototype que les valeurs du validateur de test.
    const context = { Date, JSON, Math, Number, Object, Array, RegExp, Set, Map, String, Uint8Array, TextEncoder, TextDecoder,
      atob, btoa, crypto: webcrypto, validateBusiness: (data: unknown) => digest(JSON.stringify(data)) === snapshot.businessSha256 };
    createContext(context);
    return runInContext(source + ';ControlVaultPacket.create({validateBusiness});', context) as OwnerCodec;
  }
  const bytes = await owner().seal(snapshot.data, fixtureCode, 'prod-156', '2026-10-21T10:00:00.000Z');
  const envelope = JSON.parse(new TextDecoder().decode(bytes));
  return { envelope, bytes, clear, hash: digest(bytes), snapshot, decrypt: async (restored: Uint8Array) => {
    // Nouveau propriétaire et nouvelle dérivation après fermeture de Vault :
    // aucune clé éphémère du producteur ni session Vault conservée.
    return JSON.stringify(await owner().open(restored, fixtureCode, 'prod-156', digest(bytes)));
  } };
}
