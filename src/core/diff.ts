import type { JsonValue, Payload } from './types';

export interface CollectionDiff {
  key: string;
  added: number;
  removed: number;
  changed: number;
  current: number;
  target: number;
}

export interface PayloadDiff {
  collections: CollectionDiff[];
  /** Champs simples dont la valeur change (réglages, métadonnées). */
  fields: string[];
  identical: boolean;
}

const isRecordArray = (v: JsonValue | undefined): v is { [k: string]: JsonValue }[] =>
  Array.isArray(v) && v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x));

const idOf = (x: { [k: string]: JsonValue }, i: number) => (typeof x.id === 'string' || typeof x.id === 'number' ? String(x.id) : `#${i}`);

/** JSON canonique : clés triées, pour comparer des objets sans dépendre de l'ordre. */
export function canonical(v: JsonValue): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Ce que change une restauration : passer de `current` à `target`.
 * « removed » = éléments présents aujourd'hui qui disparaîtraient.
 */
export function diffPayload(current: Payload, target: Payload): PayloadDiff {
  const keys = [...new Set([...Object.keys(current), ...Object.keys(target)])].sort();
  const collections: CollectionDiff[] = [];
  const fields: string[] = [];

  for (const key of keys) {
    const a = current[key];
    const b = target[key];
    if (isRecordArray(a) || isRecordArray(b)) {
      const aa = isRecordArray(a) ? a : [];
      const bb = isRecordArray(b) ? b : [];
      const mapA = new Map(aa.map((x, i) => [idOf(x, i), canonical(x)]));
      const mapB = new Map(bb.map((x, i) => [idOf(x, i), canonical(x)]));
      let added = 0;
      let removed = 0;
      let changed = 0;
      for (const [id, val] of mapB) {
        if (!mapA.has(id)) added++;
        else if (mapA.get(id) !== val) changed++;
      }
      for (const id of mapA.keys()) if (!mapB.has(id)) removed++;
      collections.push({ key, added, removed, changed, current: aa.length, target: bb.length });
    } else if (canonical(a ?? null) !== canonical(b ?? null)) {
      fields.push(key);
    }
  }

  const identical = fields.length === 0 && collections.every((c) => !c.added && !c.removed && !c.changed);
  return { collections, fields, identical };
}

export function countCollections(payload: Payload): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(payload)) if (Array.isArray(v)) out[k] = v.length;
  return out;
}
