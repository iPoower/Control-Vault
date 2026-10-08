// Fournisseur Google Drive réel — Drive REST API v3, scope drive.file.
//
// Prudence :
//  - lecture des métadonnées seulement ; le contenu n'est téléchargé que sur demande explicite ;
//  - écriture = création d'un NOUVEAU fichier uniquement (jamais d'écrasement ni de suppression) ;
//  - erreurs HTTP traduites en messages utiles ; réessais limités aux lectures (idempotentes).

import { sha256 } from '../core/crypto';
import type { DriveItem, FileFamily, Quota } from '../core/types';
import { ServiceError, type StorageProvider, type UploadProgress } from './contracts';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,parents,sha256Checksum,webViewLink,trashed,capabilities(canAddChildren,canEdit)';
const REQUEST_TIMEOUT_MS = 20_000;
const RETRY_DELAYS = [400, 1200, 3000];

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
  sha256Checksum?: string;
  webViewLink?: string;
  trashed?: boolean;
  capabilities?: { canAddChildren?: boolean; canEdit?: boolean };
}

export interface Page {
  items: DriveItem[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
}

export interface Account {
  name?: string;
  email?: string;
}

/** Identifiants Drive : lettres, chiffres, tiret, souligné. Tout le reste est refusé. */
export function assertId(id: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ServiceError('not-found', 'Identifiant de fichier invalide.');
  return id;
}

/** Échappe une valeur pour une requête Drive `q` (guillemets simples et barres obliques). */
export const escapeQuery = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function familyOf(f: Pick<DriveFile, 'name' | 'mimeType'>): FileFamily | undefined {
  if (f.mimeType === FOLDER_MIME) return undefined;
  const n = f.name.toLowerCase();
  if (n.endsWith('.cvault')) return 'vault';
  if (f.mimeType === 'application/json' || n.endsWith('.json')) return 'json';
  if (f.mimeType.startsWith('image/')) return 'image';
  if (f.mimeType.startsWith('text/') || f.mimeType === 'application/pdf' || f.mimeType.startsWith('application/vnd.google-apps.') || /\.(md|txt|pdf|docx?)$/.test(n)) return 'document';
  return 'other';
}

export function toItem(f: DriveFile): DriveItem {
  return {
    id: f.id,
    parentId: f.parents?.[0] ?? null,
    name: f.name,
    kind: f.mimeType === FOLDER_MIME ? 'folder' : 'file',
    family: familyOf(f),
    sizeBytes: f.size !== undefined ? Number(f.size) : undefined,
    modifiedAt: f.modifiedTime ? Date.parse(f.modifiedTime) : 0,
    mimeType: f.mimeType,
    sha256: f.sha256Checksum,
    webViewLink: f.webViewLink,
  };
}

/** Lecture d'une erreur Drive : { error: { code, message, errors: [{ reason }] } }. */
async function errorFrom(res: Response): Promise<ServiceError> {
  let reason = '';
  try {
    const body = (await res.json()) as { error?: { errors?: { reason?: string }[]; status?: string } };
    reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? '';
  } catch {
    /* corps non JSON */
  }
  return httpError(res.status, reason);
}

export function httpError(status: number, reason = ''): ServiceError {
  if (status === 401) return new ServiceError('auth-expired', 'Session Google expirée.');
  if (status === 403) {
    if (/rateLimit|userRateLimit/i.test(reason)) return new ServiceError('rate-limited', 'Google demande de ralentir. Réessaie dans un instant.');
    if (/storageQuotaExceeded|quotaExceeded/i.test(reason)) return new ServiceError('quota', 'Espace Google Drive plein : l’envoi est refusé.');
    return new ServiceError('forbidden', 'Permission insuffisante : ce fichier n’a pas été autorisé pour Control Vault.');
  }
  if (status === 404) return new ServiceError('not-found', 'Introuvable ou non autorisé pour Control Vault. Avec l’accès limité, un fichier non sélectionné apparaît comme inexistant.');
  if (status === 429) return new ServiceError('rate-limited', 'Trop de requêtes vers Google. Réessaie dans un instant.');
  if (status >= 500) return new ServiceError('unavailable', 'Google Drive ne répond pas correctement pour le moment.');
  return new ServiceError('bad-response', `Réponse inattendue de Google Drive (${status}).`);
}

const retryable = (e: unknown) => e instanceof ServiceError && (e.code === 'rate-limited' || e.code === 'unavailable' || e.code === 'timeout' || e.code === 'network');

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Annulé', 'AbortError'));
    }, { once: true });
  });
}

/** Signal combiné : annulation par l'utilisateur OU délai dépassé. */
function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Délai dépassé', 'TimeoutError')), ms);
  const onAbort = () => ctrl.abort(signal?.reason ?? new DOMException('Annulé', 'AbortError'));
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  return { signal: ctrl.signal, done: () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); } };
}

export class GoogleDriveProvider implements StorageProvider {
  readonly label = 'Google Drive';
  /** Dernière réponse réussie de l'API : preuve horodatée que la connexion fonctionne. */
  lastSuccessAt = 0;

  constructor(
    private token: () => string | null,
    private onUnauthorized: () => void,
  ) {}

  private async request(url: string, init: RequestInit & { signal?: AbortSignal } = {}, attempt = 0): Promise<Response> {
    const token = this.token();
    if (!token) throw new ServiceError('auth-expired', 'Session Google expirée.');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ServiceError('offline', 'Pas de connexion réseau.');
    const t = withTimeout(init.signal ?? undefined, REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: t.signal, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` }, cache: 'no-store', referrerPolicy: 'no-referrer' });
    } catch (e) {
      t.done();
      if (init.signal?.aborted) throw new DOMException('Annulé', 'AbortError');
      const err = e instanceof DOMException && e.name === 'TimeoutError' ? new ServiceError('timeout', 'Google Drive met trop de temps à répondre.') : navigator.onLine === false ? new ServiceError('offline', 'Pas de connexion réseau.') : new ServiceError('network', 'Connexion à Google Drive impossible.');
      if (retryable(err) && attempt < RETRY_DELAYS.length && (init.method ?? 'GET') === 'GET') {
        await sleep(RETRY_DELAYS[attempt], init.signal ?? undefined);
        return this.request(url, init, attempt + 1);
      }
      throw err;
    }
    t.done();
    if (res.ok) {
      this.lastSuccessAt = Date.now();
      return res;
    }
    const err = await errorFrom(res);
    if (err.code === 'auth-expired') this.onUnauthorized();
    if (retryable(err) && attempt < RETRY_DELAYS.length && (init.method ?? 'GET') === 'GET') {
      await sleep(RETRY_DELAYS[attempt], init.signal ?? undefined);
      return this.request(url, init, attempt + 1);
    }
    throw err;
  }

  private async json<T>(url: string, signal?: AbortSignal): Promise<T> {
    const res = await this.request(url, { signal });
    try {
      return (await res.json()) as T;
    } catch {
      throw new ServiceError('bad-response', 'Réponse incomplète de Google Drive.');
    }
  }

  async about(signal?: AbortSignal): Promise<{ account: Account; quota: Quota }> {
    const r = await this.json<{ user?: { displayName?: string; emailAddress?: string }; storageQuota?: { limit?: string; usage?: string } }>(
      `${API}/about?fields=${encodeURIComponent('user(displayName,emailAddress),storageQuota(limit,usage)')}`,
      signal,
    );
    const limit = r.storageQuota?.limit ? Number(r.storageQuota.limit) : 0;
    return {
      account: { name: r.user?.displayName, email: r.user?.emailAddress },
      quota: { usedBytes: Number(r.storageQuota?.usage ?? 0), totalBytes: limit, planNote: limit ? 'Quota lu depuis Google Drive' : 'Stockage illimité ou non communiqué par Google', checkedAt: Date.now() },
    };
  }

  async getQuota(signal?: AbortSignal) {
    return (await this.about(signal)).quota;
  }

  async getFile(id: string, signal?: AbortSignal): Promise<DriveItem & { canAddChildren?: boolean }> {
    const f = await this.json<DriveFile>(`${API}/files/${assertId(id)}?fields=${encodeURIComponent(FILE_FIELDS)}&supportsAllDrives=true`, signal);
    if (f.trashed) throw new ServiceError('not-found', 'Ce fichier est dans la corbeille de Drive.');
    return { ...toItem(f), canAddChildren: f.capabilities?.canAddChildren };
  }

  async listPage(folderId: string, pageToken?: string, signal?: AbortSignal, pageSize = 100): Promise<Page> {
    const q = `'${assertId(folderId)}' in parents and trashed = false`;
    const params = new URLSearchParams({ q, pageSize: String(pageSize), orderBy: 'folder,name_natural', fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
    if (pageToken) params.set('pageToken', pageToken);
    const r = await this.json<{ files?: DriveFile[]; nextPageToken?: string; incompleteSearch?: boolean }>(`${API}/files?${params}`, signal);
    if (!Array.isArray(r.files)) throw new ServiceError('bad-response', 'Liste de fichiers incomplète.');
    return { items: r.files.map(toItem), nextPageToken: r.nextPageToken, incompleteSearch: r.incompleteSearch };
  }

  async list(folderId: string, signal?: AbortSignal) {
    return (await this.listPage(folderId, undefined, signal)).items;
  }

  /** Recherche par nom parmi les fichiers accessibles à Control Vault (et seulement ceux-là). */
  async search(text: string, signal?: AbortSignal): Promise<Page> {
    const q = `name contains '${escapeQuery(text.slice(0, 100))}' and trashed = false`;
    const params = new URLSearchParams({ q, pageSize: '50', fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
    const r = await this.json<{ files?: DriveFile[]; nextPageToken?: string; incompleteSearch?: boolean }>(`${API}/files?${params}`, signal);
    return { items: (r.files ?? []).map(toItem), nextPageToken: r.nextPageToken, incompleteSearch: r.incompleteSearch };
  }

  async download(fileId: string, signal?: AbortSignal): Promise<Uint8Array> {
    const res = await this.request(`${API}/files/${assertId(fileId)}?alt=media&supportsAllDrives=true`, { signal });
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * Empreinte distante : sha256Checksum de Drive quand il existe (fichiers binaires),
   * sinon relecture réelle du contenu et calcul local.
   */
  async remoteSha256(fileId: string, signal?: AbortSignal): Promise<string> {
    return (await this.remoteDigest(fileId, signal)).hash;
  }

  async remoteDigest(fileId: string, signal?: AbortSignal): Promise<{ hash: string; method: 'drive' | 'relecture' }> {
    const f = await this.json<DriveFile>(`${API}/files/${assertId(fileId)}?fields=sha256Checksum,size&supportsAllDrives=true`, signal);
    if (f.sha256Checksum && /^[0-9a-f]{64}$/i.test(f.sha256Checksum)) return { hash: f.sha256Checksum.toLowerCase(), method: 'drive' };
    return { hash: await sha256(await this.download(fileId, signal)), method: 'relecture' };
  }

  /**
   * Création d'un NOUVEAU fichier (multipart). XMLHttpRequest pour mesurer la progression.
   * Pas de réessai automatique : un envoi n'est pas idempotent.
   */
  upload(
    file: { name: string; parentId: string; bytes: Uint8Array; family: DriveItem['family']; mimeType?: string },
    onProgress: (p: UploadProgress) => void,
    signal?: AbortSignal,
  ): Promise<DriveItem> {
    const token = this.token();
    if (!token) return Promise.reject(new ServiceError('auth-expired', 'Session Google expirée.'));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.reject(new ServiceError('offline', 'Pas de connexion réseau.'));
    const boundary = `cv${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
    const mime = file.mimeType ?? 'application/octet-stream';
    const meta = JSON.stringify({ name: file.name, parents: [file.parentId === 'root' ? 'root' : assertId(file.parentId)], mimeType: mime });
    const enc = new TextEncoder();
    const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
    const tail = enc.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + file.bytes.length + tail.length);
    body.set(head, 0);
    body.set(file.bytes, head.length);
    body.set(tail, head.length + file.bytes.length);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`);
      xhr.timeout = 120_000;
      const total = file.bytes.length;
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const ratio = Math.min(1, e.loaded / e.total);
        onProgress({ sentBytes: Math.round(total * ratio), totalBytes: total });
      };
      const abort = () => xhr.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const cleanup = () => signal?.removeEventListener('abort', abort);
      xhr.onabort = () => {
        cleanup();
        reject(new DOMException('Annulé', 'AbortError'));
      };
      xhr.ontimeout = () => {
        cleanup();
        reject(new ServiceError('interrupted', 'Envoi interrompu — délai dépassé'));
      };
      xhr.onerror = () => {
        cleanup();
        reject(new ServiceError('interrupted', 'Envoi interrompu — connexion perdue'));
      };
      xhr.onload = () => {
        cleanup();
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const f = JSON.parse(xhr.responseText) as DriveFile;
            if (!f.id) throw new Error();
            this.lastSuccessAt = Date.now();
            onProgress({ sentBytes: total, totalBytes: total });
            resolve(toItem(f));
          } catch {
            reject(new ServiceError('bad-response', 'Réponse incomplète après l’envoi : vérifie le dossier dans Drive avant de réessayer.'));
          }
          return;
        }
        let reason = '';
        try {
          reason = (JSON.parse(xhr.responseText) as { error?: { errors?: { reason?: string }[] } }).error?.errors?.[0]?.reason ?? '';
        } catch {
          /* ignore */
        }
        const err = httpError(xhr.status, reason);
        if (err.code === 'auth-expired') this.onUnauthorized();
        reject(err);
      };
      xhr.send(body);
    });
  }
}
