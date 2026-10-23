import { describe, expect, it } from 'vitest';
import { readSyncRevision, syncRevisionFromProperties, syncRevisionProperties } from '../../src/core/sync-revision';

const id = 'a'.repeat(32), device = 'b'.repeat(32);
const parents = Array.from({ length: 8 }, (_, i) => i.toString(16).padStart(32, '0'));
const revision = { id, device, parents, seq: 42 };
const props = { rcr: id, rcd: device, rcs: '42',
  rcp0: parents.slice(0, 3).join(','), rcp1: parents.slice(3, 6).join(','), rcp2: parents.slice(6).join(',') };

describe('contrat A2 — métadonnées de catalogue non authentifiées', () => {
  it('encode huit parents en groupes 3/3/2, sous 124 octets UTF-8 par propriété', () => {
    expect(syncRevisionProperties(revision)).toEqual(props);
    expect(syncRevisionFromProperties({ cv_contract: 'rc-v1', ...props })).toEqual(revision);
    expect(Object.entries(props).every(([k, v]) => new TextEncoder().encode(k + v).length <= 124)).toBe(true);
  });
  it('accepte de zéro à huit parents, le compteur maximal sûr et les paquets manuels sans révision', () => {
    for (let n = 0; n <= 8; n++) {
      const r = { ...revision, parents: parents.slice(0, n), seq: Number.MAX_SAFE_INTEGER };
      expect(syncRevisionFromProperties(syncRevisionProperties(r))).toEqual(r);
    }
    expect(syncRevisionFromProperties({ cv_contract: 'rc-v1' })).toBeUndefined();
  });
  it('copie et fige les métadonnées avant toute opération asynchrone', () => {
    const input = { ...revision, parents: [...parents] }, checked = readSyncRevision(input);
    input.parents.length = 0; input.seq = 99;
    expect(checked).toEqual(revision);
    expect(Object.isFrozen(checked)).toBe(true); expect(Object.isFrozen(checked.parents)).toBe(true);
  });
  it.each([
    null, [], {}, { ...revision, extra: 'non prévu' }, { ...revision, id: id.toUpperCase() },
    { ...revision, device: 12 }, { ...revision, seq: '42' }, { ...revision, seq: 0 },
    { ...revision, seq: -1 }, { ...revision, seq: 1.5 }, { ...revision, seq: Infinity },
    { ...revision, seq: Number.MAX_SAFE_INTEGER + 1 }, { ...revision, parents: [id] },
    { ...revision, parents: [...parents].reverse() }, { ...revision, parents: [parents[0], parents[0]] },
    { ...revision, parents: [...parents, '8'.repeat(32)] }, { ...revision, parents: [''] },
  ])('refuse une révision invalide : %#', value => {
    expect(() => readSyncRevision(value)).toThrow('INVALID_REVISION');
  });
  it.each([
    { ...props, rcr: undefined }, { ...props, rcd: '' }, { ...props, rcs: '0' },
    { ...props, rcs: '042' }, { ...props, rcs: '+42' }, { ...props, rcs: '4.2e1' },
    { ...props, rcs: '42\n' }, { ...props, rcs: '9007199254740992' }, { ...props, rcs: 42 },
    { ...props, rcp0: '' }, { ...props, rcp0: undefined }, { ...props, rcp1: undefined },
    { ...props, rcp2: props.rcp2 + ',' }, { ...props, rcp2: 'é'.repeat(100) },
    { ...props, rcx: 'inconnu' }, { ...props, rcp3: parents[0] },
    { rcr: id, rcd: device, rcs: '42', rcp0: parents[0], rcp1: parents[1] },
    { rcr: id, rcd: device, rcs: '42', rcp1: parents[0] },
  ])('refuse les propriétés ambiguës ou non canoniques : %#', value => {
    expect(() => syncRevisionFromProperties(value)).toThrow('INVALID_REVISION');
  });
});
