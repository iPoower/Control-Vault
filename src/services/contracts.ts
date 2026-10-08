// Contrats de services. Phase 1 : implémentations de démonstration.
// Phase 2 : GoogleDriveProvider (Drive API v3, scope drive.file + Google Picker).
// Phase 4 : SupabaseJournal (tables vault_* isolées, RLS par auth.uid()).
// Les vues et les parcours ne connaissent que ces interfaces.

import type { DriveItem, Quota } from '../core/types';

export class ServiceError extends Error {
  constructor(
    public code:
      | 'offline'
      | 'auth-expired'
      | 'interrupted'
      | 'not-found'
      | 'quota'
      | 'unavailable'
      | 'forbidden'
      | 'rate-limited'
      | 'network'
      | 'timeout'
      | 'bad-response',
    message: string,
  ) {
    super(message);
  }
}

export interface UploadProgress {
  sentBytes: number;
  totalBytes: number;
}

export interface StorageProvider {
  readonly label: string;
  getQuota(signal?: AbortSignal): Promise<Quota>;
  list(folderId: string, signal?: AbortSignal): Promise<DriveItem[]>;
  upload(
    file: { name: string; parentId: string; bytes: Uint8Array; family: DriveItem['family']; versionId?: string },
    onProgress: (p: UploadProgress) => void,
    signal?: AbortSignal,
  ): Promise<DriveItem>;
  download(fileId: string, signal?: AbortSignal): Promise<Uint8Array>;
  /** Empreinte calculée côté serveur (Drive expose sha256Checksum pour les fichiers binaires). */
  remoteSha256(fileId: string, signal?: AbortSignal): Promise<string>;
}

/** Journal des opérations (miroir optionnel ; Drive reste la source de vérité). */
export interface Journal {
  readonly label: string;
  ping(signal?: AbortSignal): Promise<boolean>;
}
