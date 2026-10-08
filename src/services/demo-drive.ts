// Drive de démonstration, en mémoire. Il se comporte comme un vrai service distant :
// latence, progression d'envoi, coupures, session expirée. Rien n'en sort du navigateur.

import { sha256 } from '../core/crypto';
import type { DriveItem, Quota, Scenario } from '../core/types';
import { ServiceError, type Journal, type StorageProvider, type UploadProgress } from './contracts';

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Annulé', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Annulé', 'AbortError'));
      },
      { once: true },
    );
  });

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export class DemoDrive implements StorageProvider {
  readonly label = 'Google Drive (démonstration)';
  items = new Map<string, DriveItem>();
  private blobs = new Map<string, Uint8Array>();
  private hashes = new Map<string, string>();
  /** Latence de base : assez pour voir les états de chargement, pas assez pour gêner. */
  latency = 260;

  constructor(
    private quota: Quota,
    private scenario: () => Scenario,
    private online: () => boolean,
  ) {}

  private guard() {
    if (!this.online() || this.scenario() === 'offline') throw new ServiceError('offline', 'Pas de connexion réseau.');
    if (this.scenario() === 'auth-expired') throw new ServiceError('auth-expired', 'La session Google a expiré.');
  }

  seed(item: DriveItem, bytes?: Uint8Array, hash?: string) {
    this.items.set(item.id, item);
    if (bytes) {
      this.blobs.set(item.id, bytes);
      if (hash) this.hashes.set(item.id, hash);
    }
  }

  async getQuota(signal?: AbortSignal) {
    await wait(this.latency, signal);
    this.guard();
    const used = this.quota.usedBytes + [...this.blobs.values()].reduce((s, b) => s + b.length, 0);
    return { ...this.quota, usedBytes: used, checkedAt: Date.now() };
  }

  async list(folderId: string, signal?: AbortSignal) {
    await wait(this.latency, signal);
    this.guard();
    return [...this.items.values()].filter((i) => i.parentId === folderId);
  }

  async upload(
    file: { name: string; parentId: string; bytes: Uint8Array; family: DriveItem['family']; versionId?: string },
    onProgress: (p: UploadProgress) => void,
    signal?: AbortSignal,
  ) {
    this.guard();
    const total = file.bytes.length;
    const chunks = 8;
    for (let i = 1; i <= chunks; i++) {
      await wait(110, signal);
      if (!this.online() || this.scenario() === 'offline') throw new ServiceError('offline', 'Pas de connexion réseau.');
      // Coupure simulée aux deux tiers : rien n'est écrit, comme un envoi « resumable » abandonné.
      if (this.scenario() === 'upload-interrupted' && i === 6) {
        throw new ServiceError('interrupted', 'Envoi interrompu — connexion perdue');
      }
      onProgress({ sentBytes: Math.round((total * i) / chunks), totalBytes: total });
    }
    const item: DriveItem = {
      id: newId('f'),
      parentId: file.parentId,
      name: file.name,
      kind: 'file',
      family: file.family,
      sizeBytes: total,
      modifiedAt: Date.now(),
      versionId: file.versionId,
    };
    // Écriture atomique : le fichier n'apparaît qu'une fois complet.
    this.items.set(item.id, item);
    this.blobs.set(item.id, file.bytes.slice());
    this.hashes.set(item.id, await sha256(file.bytes));
    return item;
  }

  async download(fileId: string, signal?: AbortSignal) {
    await wait(this.latency, signal);
    this.guard();
    const blob = this.blobs.get(fileId);
    if (!blob) throw new ServiceError('not-found', 'Fichier introuvable dans Drive.');
    return blob.slice();
  }

  async remoteSha256(fileId: string, signal?: AbortSignal) {
    await wait(120, signal);
    this.guard();
    const h = this.hashes.get(fileId);
    if (!h) throw new ServiceError('not-found', 'Empreinte distante indisponible.');
    return h;
  }

  findByVersion(versionId: string) {
    return [...this.items.values()].find((i) => i.versionId === versionId);
  }

  textOf(fileId: string): string | null {
    const b = this.blobs.get(fileId);
    const item = this.items.get(fileId);
    if (!b || !item || (item.family !== 'json' && item.family !== 'document')) return null;
    return new TextDecoder().decode(b);
  }

  bytesOf(fileId: string) {
    return this.blobs.get(fileId)?.slice() ?? null;
  }
}

export class DemoJournal implements Journal {
  readonly label = 'Supabase (démonstration)';
  constructor(
    private scenario: () => Scenario,
    private online: () => boolean,
  ) {}
  async ping(signal?: AbortSignal) {
    await wait(180, signal);
    return this.online() && this.scenario() !== 'offline' && this.scenario() !== 'supabase-down';
  }
}
