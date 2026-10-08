// Modèle de domaine de Control Vault.
// Toutes les vues lisent ce modèle ; aucune ne parle directement à Google ou Supabase.

export type AppId = 'race-control' | 'reconversion-control';

/** Santé vérifiée d'une source. « verified » n'est jamais posé sans contrôle réel. */
export type Health = 'verified' | 'stale' | 'pending' | 'failed' | 'unknown';

export type GoogleState = 'connected' | 'expired' | 'disconnected';
export type SupabaseState = 'reachable' | 'unreachable' | 'unknown';

export interface Connectivity {
  online: boolean;
  google: GoogleState;
  supabase: SupabaseState;
}

export interface Quota {
  usedBytes: number;
  totalBytes: number;
  /** Le quota dépend d'une offre dont le renouvellement n'est pas garanti. */
  planNote: string;
  checkedAt: number;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type Payload = { [k: string]: JsonValue };

export interface AppRecord {
  id: AppId;
  name: string;
  tagline: string;
  /** État courant des données de l'application, tel que connu du coffre. */
  payload: Payload;
  /** Libellés humains des collections du payload (ex. trips → « débriefs de trajet »). */
  collections: Record<string, { one: string; many: string; critical?: boolean }>;
  freshnessDays: number;
}

export interface Version {
  id: string;
  appId: AppId;
  createdAt: number;
  sizeBytes: number;
  sha256: string;
  encrypted: boolean;
  kind: 'manual' | 'safety' | 'import';
  /** Comptage par collection, pour comparer sans tout déchiffrer. */
  counts: Record<string, number>;
  /** Dernier contrôle d'intégrité du fichier distant. */
  verifiedAt?: number;
}

export type ItemKind = 'folder' | 'file';
export type FileFamily = 'vault' | 'json' | 'document' | 'image' | 'other';

export interface DriveItem {
  id: string;
  parentId: string | null;
  name: string;
  kind: ItemKind;
  family?: FileFamily;
  sizeBytes?: number;
  modifiedAt: number;
  versionId?: string;
  /** Dossier existant côté Drive (ne jamais recréer ni déplacer). */
  pinned?: boolean;
  mimeType?: string;
  /** Empreinte fournie par Google Drive (fichiers binaires uniquement). */
  sha256?: string;
  webViewLink?: string;
}

export type OpType = 'backup' | 'restore' | 'safety' | 'import' | 'verify' | 'connect' | 'grant' | 'test-upload';
export type OpResult = 'success' | 'failed' | 'cancelled';
export type Integrity = 'verified' | 'mismatch' | 'not-checked';

export interface OpEvent {
  id: string;
  at: number;
  source: AppId | 'vault';
  type: OpType;
  result: OpResult;
  durationMs: number;
  sizeBytes?: number;
  integrity: Integrity;
  versionId?: string;
  sha256?: string;
  /** Explication lisible d'un échec : ce qui s'est passé et quoi faire. */
  reason?: string;
  retry?: { appId: AppId; type: 'backup' };
  /** Titre explicite (opérations réelles hors applications). */
  title?: string;
  /** Lien Drive du fichier concerné, quand il existe. */
  link?: string;
  /** Un échec reste « ouvert » jusqu'à une réussite ultérieure de la même opération. */
  resolved?: boolean;
}

export interface PendingOp {
  id: string;
  appId: AppId;
  type: 'backup';
  queuedAt: number;
  reason: 'offline' | 'auth';
}

export type Scenario = 'normal' | 'offline' | 'auth-expired' | 'upload-interrupted' | 'supabase-down';

export interface Settings {
  theme: 'system' | 'dark' | 'light';
  motion: 'system' | 'reduced';
  view: 'list' | 'grid';
}
