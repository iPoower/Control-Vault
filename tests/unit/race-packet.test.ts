import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PACKET_LIMITS, PacketError, readRaceFile, readRacePacket } from '../../src/core/race-packet';
import { packetFixture } from '../fixtures/race-packet';
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
let fixture: Awaited<ReturnType<typeof packetFixture>>;
beforeAll(async () => { fixture = await packetFixture(); });
describe('paquet opaque réellement validé', () => {
  it('garde les octets originaux, le hash complet et celui du chiffré, sans clé Vault', async () => {
    const packet = await readRacePacket(fixture.bytes, fixture.hash);
    expect(packet.copyBytes()).toEqual(fixture.bytes);
    expect(packet.info.cipherSha256).toBe(fixture.envelope.sha256);
    expect(await fixture.decrypt(packet.copyBytes())).toBe(fixture.clear);
    // Le producteur RC écrit maintenant un JSON compact : réindenter
    // explicitement pour comparer deux fichiers distincts au même chiffré.
    const reordered = await readRacePacket(new TextEncoder().encode(JSON.stringify(fixture.envelope, null, 2)));
    expect(reordered.info.cipherSha256).toBe(packet.info.cipherSha256);
    expect(reordered.info.fileSha256).not.toBe(packet.info.fileSha256);
  });
  it('n’expose aucune référence mutable aux octets ou métadonnées', async () => {
    const bytes = fixture.bytes.slice(), packet = await readRacePacket(bytes);
    bytes.fill(0); packet.copyBytes().fill(1);
    expect(packet.copyBytes()).toEqual(fixture.bytes); expect(Object.isFrozen(packet.info)).toBe(true);
  });
  it('respecte les limites normatives sans modifier le contrat', () => {
    const doc = readFileSync('docs/INTEGRATION.md', 'utf8');
    const value = JSON.parse(doc.split('<!-- integration-limits:start -->')[1].split('<!-- integration-limits:end -->')[0].match(/~~~json\s*([\s\S]*?)\s*~~~/)![1]);
    expect(PACKET_LIMITS).toEqual({ file: value.maxFileBytes, cipher: value.maxCipherBytes, depth: value.maxJsonDepth });
  });
  it('refuse un fichier trop grand avant toute lecture', async () => {
    let read = false;
    await expect(readRaceFile({ size: PACKET_LIMITS.file + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(read).toBe(false);
    await expect(readRaceFile({ size: fixture.bytes.length + 1, arrayBuffer: async () => fixture.bytes.slice().buffer })).rejects.toMatchObject({ code: 'MALFORMED_FILE' });
  });
  it.each([
    ['format', { format: 'other' }, 'UNSUPPORTED_FORMAT'], ['schema', { schemaVersion: 2 }, 'UNSUPPORTED_SCHEMA'],
    ['extra', { place: 'forbidden' }, 'INVALID_ENVELOPE'], ['date', { createdAt: '2026-02-30T00:00:00.000Z' }, 'INVALID_ENVELOPE'],
    ['version', { appVersion: 'prod-0156' }, 'INVALID_ENVELOPE'], ['newline', { appVersion: 'prod-156\n' }, 'INVALID_ENVELOPE'],
    ['sha', { sha256: '0'.repeat(64) }, 'INTEGRITY_MISMATCH'],
  ])('refuse %s sans toucher aux octets', async (_name, patch, code) => {
    const before = fixture.bytes.slice();
    await expect(readRacePacket(encode({ ...fixture.envelope, ...patch }))).rejects.toMatchObject({ code });
    expect(fixture.bytes).toEqual(before);
  });
  it.each([
    ['coût', { it: 1 }, 'INVALID_ENVELOPE'], ['algorithme', { alg: 'other' }, 'INVALID_ENVELOPE'],
    ['Base64', { c: 'AAAA\n' }, 'INVALID_ENCODING'], ['sel', { s: 'AAAA' }, 'INVALID_ENCODING'],
    ['bits padding', { s: 'AAAAAAAAAAAAAAAAAAAAAB==' }, 'INVALID_ENCODING'], ['tag court', { c: 'AAAA' }, 'INVALID_ENCODING'],
  ])('refuse %s', async (_name, patch, code) => {
    await expect(readRacePacket(encode({ ...fixture.envelope, payload: { ...fixture.envelope.payload, ...patch } }))).rejects.toMatchObject({ code });
  });
  it.each(['{"a":1,"\\u0061":2}', '{"x":[[[[[]]]]]}', '{"x":1e400}', '{"x":1} trailing', '\ufeff{}'])('refuse le JSON ambigu/invalide %s', async text => {
    await expect(readRacePacket(new TextEncoder().encode(text))).rejects.toMatchObject({ code: 'MALFORMED_FILE' });
  });
  it('refuse UTF-8 invalide, hash de référence remplacé et historiques explicites', async () => {
    await expect(readRacePacket(new Uint8Array([0xff]))).rejects.toBeInstanceOf(PacketError);
    await expect(readRacePacket(fixture.bytes, '0'.repeat(64))).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' });
    for (const v of [1, 2, undefined]) await expect(readRacePacket(encode({ app: 'twrc-backup', v, c: 'AAAA' }))).rejects.toMatchObject({ code: 'LEGACY_REEXPORT_REQUIRED' });
  });
  it('une empreinte recalculée ou une AAD changée ne remplace pas GCM côté propriétaire', async () => {
    const e = structuredClone(fixture.envelope), cipher = Buffer.from(e.payload.c, 'base64'); cipher[0] ^= 1;
    e.payload.c = cipher.toString('base64'); e.sha256 = createHash('sha256').update(cipher).digest('hex');
    const bytes = (await readRacePacket(encode(e))).copyBytes();
    await expect(fixture.decrypt(bytes)).rejects.toThrow();
    await expect(fixture.decrypt(encode({ ...fixture.envelope, appVersion: 'prod-155' }))).rejects.toThrow();
  });
});
