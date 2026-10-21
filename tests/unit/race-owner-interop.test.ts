import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { packetFixture } from '../fixtures/race-packet';
import { readRacePacket } from '../../src/core/race-packet';
describe('interop avec le codec propriétaire RC exact — aucune donnée réelle', () => {
  it.each([61, 120])('restitue les %i trajets, anciennes entrées et différentes versions sans clé Vault', async count => {
    const f = await packetFixture(count), opaque = await readRacePacket(f.bytes, f.hash);
    const clear = JSON.parse(await f.decrypt(opaque.copyBytes()));
    expect(clear).toEqual(f.snapshot.data);
    expect(clear.durable.context.debrief.archive.records).toHaveLength(count + 2);
    const records = clear.durable.context.debrief.archive.records.map((r: string) => JSON.parse(r));
    expect(records.some((r: any) => r.oldField?.answers.length === 2)).toBe(true);
    expect(records.filter((r: any) => r.key === 'fixture-0')).toHaveLength(3);
    expect(records.some((r: any) => Date.parse(clear.at) - r.at >= 365 * 86400000)).toBe(true);
    expect(clear.durable.context.gps).toBeNull(); expect(clear.durable.context.debrief.active).toBeNull();
    expect(clear.settings.cars[0].odo[0].km).toBe(44000);
    expect(clear.settings.cars[0].tire.treads[0].mm).toBe(6.2);
    expect(clear.settings.cars[0].maintenance).toHaveLength(1);
  });
  it('épingle la provenance source plutôt que de maintenir un second chiffrement de test', () => {
    const a = JSON.parse(readFileSync('tests/fixtures/race-owner/business-61.json', 'utf8'));
    const b = JSON.parse(readFileSync('tests/fixtures/race-owner/business-120.json', 'utf8'));
    expect(a.commit).toBe(b.commit); expect(a.generatorSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.codecSha256).toBe(createHash('sha256').update(readFileSync('tests/fixtures/race-owner/control-vault-packet.js')).digest('hex'));
  });
});
