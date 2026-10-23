// Métadonnées publiques A2 : une déclaration de catalogue, jamais une authentification.
export interface SyncRevision {
  readonly id: string;
  readonly parents: readonly string[];
  readonly device: string;
  readonly seq: number;
}
const invalid = (): never => { throw new Error('INVALID_REVISION'); };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);

export function readSyncRevision(value: unknown): SyncRevision {
  if (!object(value) || Object.keys(value).length !== 4 ||
    !['id', 'parents', 'device', 'seq'].every(k => Object.hasOwn(value, k)) ||
    !identifier(value.id) || !identifier(value.device) || typeof value.seq !== 'number' ||
    !Number.isSafeInteger(value.seq) || value.seq < 1 || !Array.isArray(value.parents) || value.parents.length > 8)
    return invalid();
  const parents: string[] = [];
  for (const p of value.parents) {
    if (!identifier(p) || p === value.id || parents.length > 0 && parents[parents.length - 1] >= p) return invalid();
    parents.push(p);
  }
  return Object.freeze({ id: value.id, parents: Object.freeze(parents), device: value.device, seq: value.seq });
}

export function syncRevisionProperties(value: SyncRevision): Readonly<Record<string, string>> {
  const rev = readSyncRevision(value), p: Record<string, string> = { rcr: rev.id, rcd: rev.device, rcs: String(rev.seq) };
  for (let i = 0; i * 3 < rev.parents.length; i++) p['rcp' + i] = rev.parents.slice(i * 3, i * 3 + 3).join(',');
  return Object.freeze(p);
}

export function syncRevisionFromProperties(value: unknown): SyncRevision | undefined {
  if (!object(value)) return invalid();
  const keys = Object.keys(value).filter(k => k.startsWith('rc'));
  if (!keys.length) return undefined; // Paquet V1 manuel, sans révision A2.
  for (const k of keys) {
    const v = value[k];
    if (!/^(rcr|rcd|rcs|rcp[0-2])$/.test(k) || typeof v !== 'string' || v.length > 124 ||
      new TextEncoder().encode(k + v).length > 124) return invalid();
  }
  if (typeof value.rcs !== 'string' || !/^[1-9][0-9]{0,15}$/.test(value.rcs)) return invalid();
  const parents: string[] = [];
  for (let i = 0; i < 3; i++) {
    const group = value['rcp' + i];
    if (typeof group === 'string') parents.push(...group.split(','));
  }
  const revision = readSyncRevision({ id: value.rcr, parents, device: value.rcd, seq: Number(value.rcs) });
  const canonical = syncRevisionProperties(revision);
  // Pas de trou, de groupe court suivi d'un autre, ni de représentation alternative.
  if (keys.length !== Object.keys(canonical).length || keys.some(k => value[k] !== canonical[k])) return invalid();
  return revision;
}

export function sameSyncRevision(a: SyncRevision | undefined, b: SyncRevision | undefined): boolean {
  return a === undefined || b === undefined ? a === b :
    a.id === b.id && a.device === b.device && a.seq === b.seq && a.parents.join(',') === b.parents.join(',');
}
