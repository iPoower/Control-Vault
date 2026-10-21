// Cache local de paquets opaques. Drive reste la source distante de vérité.
// Aucun mot de passe, token, clair, clé ou URL de session dans ce stockage.
import { readRacePacket, type PacketInfo, type RacePacket } from '../core/race-packet';

export const OPAQUE_DB = 'cv-opaque-packets-v1';
interface Row { id: string; bytes: Uint8Array; info: PacketInfo }
export interface LocalPacket { readonly id: string; readonly info: Readonly<PacketInfo>; readonly state: 'local-only' }
export class ArchiveError extends Error {
  constructor(readonly code: 'storage' | 'missing' | 'integrity') { super(code); this.name = 'ArchiveError'; }
}
const hashId = (id: string) => { if (!/^[0-9a-f]{64}$/.test(id)) throw new ArchiveError('missing'); return id; };
const local = (packet: RacePacket): LocalPacket => Object.freeze({ id: packet.info.fileSha256, info: packet.info, state: 'local-only' });

export class OpaqueArchive {
  #db: Promise<IDBDatabase> | null = null;
  constructor(private readonly factory: IDBFactory = indexedDB) {}
  private open(): Promise<IDBDatabase> {
    if (this.#db) return this.#db;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      const request = this.factory.open(OPAQUE_DB, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('packets', { keyPath: 'id' }); };
      request.onerror = request.onblocked = () => { settled = true; reject(new ArchiveError('storage')); };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true;
        db.onversionchange = () => { db.close(); if (this.#db === ready) this.#db = null; };
        resolve(db);
      };
    });
    const ready = opening.catch(() => { if (this.#db === ready) this.#db = null; throw new ArchiveError('storage'); });
    this.#db = ready;
    return ready;
  }

  async close(): Promise<void> {
    const pending = this.#db; this.#db = null;
    if (pending) (await pending).close();
  }
  private async rows(id: string): Promise<Row[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('packets', 'readonly'), store = tx.objectStore('packets');
      const request = store.get(hashId(id));
      let result: Row[] = [];
      request.onsuccess = () => { result = request.result ? [request.result] : []; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(new ArchiveError('storage'));
    });
  }
  async read(id: string): Promise<RacePacket> {
    const [row] = await this.rows(id);
    if (!row) throw new ArchiveError('missing');
    try {
      if (!(row.bytes instanceof Uint8Array)) throw new ArchiveError('integrity');
      const packet = await readRacePacket(row.bytes, id);
      if (JSON.stringify(packet.info) !== JSON.stringify(row.info)) throw new ArchiveError('integrity');
      return packet;
    } catch { throw new ArchiveError('integrity'); }
  }
  async list(): Promise<LocalPacket[]> {
    const db = await this.open();
    const ids = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction('packets', 'readonly'), request = tx.objectStore('packets').getAllKeys();
      let keys: IDBValidKey[] = [];
      request.onsuccess = () => { keys = request.result; };
      tx.oncomplete = () => {
        if (!keys.every(k => typeof k === 'string')) { reject(new ArchiveError('integrity')); return; }
        resolve(keys as string[]);
      };
      tx.onerror = tx.onabort = () => reject(new ArchiveError('storage'));
    });
    const result: LocalPacket[] = [];
    // Une seule copie en mémoire à la fois, jamais getAll() de tout le journal.
    // Une ligne corrompue bloque un catalogue annoncé complet, sans être purgée.
    for (const id of ids) result.push(local(await this.read(id)));
    return result.sort((a, b) => b.info.createdAt.localeCompare(a.info.createdAt) || a.id.localeCompare(b.id));
  }
  async save(input: RacePacket): Promise<LocalPacket> {
    // Revalider à la frontière : un objet forgé ne permet pas d'enregistrer du clair.
    const packet = await readRacePacket(input.copyBytes(), input.info.fileSha256);
    const id = packet.info.fileSha256, db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('packets', 'readwrite'), store = tx.objectStore('packets');
      const check = store.get(id);
      check.onsuccess = () => {
        try { if (!check.result) store.add({ id, bytes: packet.copyBytes(), info: { ...packet.info } } satisfies Row); }
        catch { tx.abort(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new ArchiveError('storage'));
    });
    // Confirmation après commit et vraie relecture, jamais sur le seul succès add().
    return local(await this.read(id));
  }
}
