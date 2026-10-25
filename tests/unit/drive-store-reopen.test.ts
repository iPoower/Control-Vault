import { describe, expect, it } from 'vitest';
import { DriveStore } from '../../src/services/drive-store.js';

// NOESIS-CV-002: injected provider only; the production DriveStore is imported.
function backend() {
  let mode: 'ok' | 'error' | 'blocked' = 'ok';
  let opens = 0;
  let deletes = 0;
  const connections: any[] = [];
  const late: Array<() => void> = [];
  const rows: Record<string, Map<string, unknown>> = { state: new Map(), recovery: new Map() };
  function connection() {
    let closed = false;
    const db: any = {
      close() { closed = true; }, createObjectStore() {},
      get closed() { return closed; },
      transaction(store: string) {
        if (closed) throw Error('InvalidStateError: closed database');
        const tx: any = { objectStore() { return {
          get(key: string) {
            const req: any = {};
            queueMicrotask(() => { req.result = rows[store].get(key); req.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); });
            return req;
          },
          put(value: unknown, key: string) {
            rows[store].set(key, structuredClone(value));
            queueMicrotask(() => tx.oncomplete?.());
          }
        }; } };
        return tx;
      }
    };
    connections.push(db);
    return db;
  }
  const indexedDB = {
    open() {
      opens++;
      const req: any = { result: connection() };
      const behavior = mode; mode = 'ok';
      queueMicrotask(() => {
        if (behavior === 'error') { req.onerror?.(); return; }
        if (behavior === 'blocked') { req.onblocked?.(); late.push(() => req.onsuccess?.()); return; }
        req.onupgradeneeded?.(); req.onsuccess?.();
      });
      return req;
    },
    deleteDatabase() { deletes++; throw Error('Forbidden database deletion'); }
  } as unknown as IDBFactory;
  return { indexedDB, connections, late, rows, set mode(next: 'ok' | 'error' | 'blocked') { mode = next; }, get opens() { return opens; }, get deletes() { return deletes; } };
}

describe('NOESIS-CV-002 — durable IndexedDB open retry without any purge', () => {
  it('retries a rejected first open rather than caching a rejected promise', async () => {
    const f = backend(), store = DriveStore.create('fixture-reopen', f.indexedDB);
    f.mode = 'error';
    await expect(store.read()).rejects.toThrow('stockage');
    await expect(store.read()).resolves.toBeNull();
    expect(f.opens).toBe(2);
  });
  it('rejects a blocked open, closes any late success, and can reopen', async () => {
    const f = backend(), store = DriveStore.create('fixture-reopen', f.indexedDB);
    f.mode = 'blocked';
    await expect(store.read()).rejects.toThrow('stockage');
    await expect(store.read()).resolves.toBeNull();
    f.late.forEach(release => release());
    await Promise.resolve();
    expect(f.connections[0].closed).toBe(true);
    expect(f.deletes).toBe(0);
  });
  it('closes and invalidates on versionchange and can read existing bytes', async () => {
    const f = backend(), store = DriveStore.create('fixture-reopen', f.indexedDB);
    await store.write({v: 1, job: null, receipts: [{fileId: 'synthetic'}]});
    f.connections[0].onversionchange();
    expect(f.connections[0].closed).toBe(true);
    expect((await store.read() as { receipts: Array<{fileId:string}> }).receipts[0].fileId).toBe('synthetic');
    expect(f.opens).toBe(2);
  });
  it('retries after a manually closed transaction and never deletes data', async () => {
    const f = backend(), store = DriveStore.create('fixture-reopen', f.indexedDB);
    await store.write({v: 1, job: null, receipts: []});
    f.connections[0].close();
    await expect(store.read()).rejects.toThrow('stockage');
    await expect(store.read()).resolves.toMatchObject({v:1});
    expect(f.opens).toBe(2);
    expect(f.deletes).toBe(0);
  });
  it('coalesces simultaneous opens', async () => {
    const f = backend(), store = DriveStore.create('fixture-reopen', f.indexedDB);
    const reads = await Promise.all([store.read(), store.read(), store.read()]);
    expect(reads).toEqual([null,null,null]);
    expect(f.opens).toBe(1);
  });
});
