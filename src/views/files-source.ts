// Source de l'explorateur : démonstration (Drive en mémoire) ou Google Drive réel.
// L'explorateur ne parle qu'à cette interface ; les deux mondes ne se mélangent jamais.

import { drive as demoDrive, importJson, ROOT_ID, store } from '../app';
import type { DriveItem } from '../core/types';
import { gdrive } from '../drive';
import { ServiceError } from '../services/contracts';
import { download, h, replace } from '../ui/dom';
import { icon } from '../ui/icons';
import { toast } from '../ui/overlay';

export interface ListResult {
  items: DriveItem[];
  next?: string;
}

export interface FilesSource {
  kind: 'demo' | 'drive';
  rootId: string;
  rootName: string;
  searchScope: string;
  path(folderId: string): { id: string; name: string }[];
  list(folderId: string, pageToken: string | undefined, signal: AbortSignal): Promise<ListResult>;
  search(q: string, signal: AbortSignal): Promise<{ items: DriveItem[]; incomplete?: boolean }>;
  /** Contenu de l'aperçu : immédiat en démonstration, à la demande en mode Drive. */
  preview(item: DriveItem): HTMLElement | null;
  canDownload(item: DriveItem): boolean;
  download(item: DriveItem): Promise<void>;
  canImport: boolean;
  importFile?(file: File, parentId: string): Promise<DriveItem>;
  locationOf(item: DriveItem): string;
}

const collectPath = (id: string, byId: (id: string) => DriveItem | undefined) => {
  const out: DriveItem[] = [];
  let cur = byId(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? byId(cur.parentId) : undefined;
  }
  return out;
};

// ─── Démonstration ─────────────────────────────────────────────────────────

export const demoSource: FilesSource = {
  kind: 'demo',
  rootId: ROOT_ID,
  rootName: 'Control Vault',
  searchScope: 'dans tout le coffre',
  path(folderId) {
    const cat = store.get().catalog;
    return collectPath(folderId, (id) => cat.find((i) => i.id === id)).map((i) => ({ id: i.id, name: i.name }));
  },
  async list(folderId, _token, signal) {
    return { items: await demoDrive.list(folderId, signal) };
  },
  async search(q) {
    const n = q.trim().toLocaleLowerCase('fr');
    return { items: store.get().catalog.filter((i) => i.id !== ROOT_ID && i.name.toLocaleLowerCase('fr').includes(n)) };
  },
  preview(item) {
    const text = item.kind === 'file' ? demoDrive.textOf(item.id) : null;
    if (text !== null) return h('div', null, h('h4', { class: 'section-title' }, 'Aperçu'), h('pre', { class: 'code' }, text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text));
    if (item.family === 'vault') return h('p', { class: 'muted small', style: 'margin-top: var(--s4)' }, 'Contenu chiffré : l’aperçu passe par la restauration, après contrôle de l’empreinte.');
    if (item.kind === 'file') return h('p', { class: 'muted small', style: 'margin-top: var(--s4)' }, 'Aperçu non disponible pour ce format dans la démonstration.');
    return null;
  },
  canDownload: (item) => item.kind === 'file',
  async download(item) {
    const bytes = demoDrive.bytesOf(item.id);
    if (!bytes) {
      toast('Ce fichier n’a pas de contenu téléchargeable.', { kind: 'bad' });
      return;
    }
    download(new Blob([bytes as BlobPart], { type: item.family === 'json' ? 'application/json' : 'application/octet-stream' }), item.name);
    toast(`${item.name} téléchargé`, { kind: 'ok' });
  },
  canImport: true,
  async importFile(file, parentId) {
    return (await importJson(file, parentId)).item;
  },
  locationOf(item) {
    return demoSource.path(item.parentId ?? ROOT_ID).map((p) => p.name).join(' / ');
  },
};

// ─── Google Drive réel ─────────────────────────────────────────────────────

export const AUTHORIZED_ROOT = 'autorises';
const PREVIEW_MAX = 512 * 1024;
const cache = new Map<string, DriveItem>();
const remember = (items: DriveItem[]) => items.forEach((i) => cache.set(i.id, i));

const isGoogleNative = (item: DriveItem) => (item.mimeType ?? '').startsWith('application/vnd.google-apps.');
const isTextual = (item: DriveItem) => item.family === 'json' || /^text\//.test(item.mimeType ?? '') || /\.(md|txt|csv|json)$/i.test(item.name);

export const driveSource: FilesSource = {
  kind: 'drive',
  rootId: AUTHORIZED_ROOT,
  rootName: 'Autorisés',
  searchScope: 'parmi les fichiers autorisés',
  path(folderId) {
    if (folderId === AUTHORIZED_ROOT) return [{ id: AUTHORIZED_ROOT, name: 'Autorisés' }];
    const chain = collectPath(folderId, (id) => cache.get(id));
    // On s'arrête au premier dossier autorisé : au-delà, Control Vault n'a pas accès.
    const roots = new Set(store.get().drive.roots.map((r) => r.id));
    const start = Math.max(0, chain.findIndex((c) => roots.has(c.id)));
    const trimmed = chain.slice(start);
    if (!trimmed.length) trimmed.push({ id: folderId, name: 'Dossier', parentId: null, kind: 'folder', modifiedAt: 0 });
    return [{ id: AUTHORIZED_ROOT, name: 'Autorisés' }, ...trimmed.map((i) => ({ id: i.id, name: i.name }))];
  },
  async list(folderId, token, signal) {
    if (folderId === AUTHORIZED_ROOT) {
      const roots = store.get().drive.roots.filter((r) => r.access === 'granted');
      const items = await Promise.all(roots.map((r) => cache.get(r.id) ?? gdrive.getFile(r.id, signal).then((f) => ({ ...f, name: r.source === 'config' ? r.name : f.name }))));
      remember(items);
      return { items };
    }
    if (!cache.has(folderId)) remember([await gdrive.getFile(folderId, signal)]);
    const page = await gdrive.listPage(folderId, token, signal);
    remember(page.items);
    return { items: page.items, next: page.nextPageToken };
  },
  async search(q, signal) {
    const page = await gdrive.search(q, signal);
    remember(page.items);
    return { items: page.items, incomplete: page.incompleteSearch || !!page.nextPageToken };
  },
  preview(item) {
    if (item.kind !== 'file') return null;
    if (isGoogleNative(item)) return h('p', { class: 'muted small', style: 'margin-top: var(--s4)' }, 'Document Google : ouvre-le dans Google Drive.');
    if (!isTextual(item)) return h('p', { class: 'muted small', style: 'margin-top: var(--s4)' }, 'Aperçu réservé aux fichiers texte et JSON.');
    if ((item.sizeBytes ?? 0) > PREVIEW_MAX) return h('p', { class: 'muted small', style: 'margin-top: var(--s4)' }, 'Fichier trop volumineux pour l’aperçu (512 Ko au maximum).');
    const zone = h('div', { class: 'preview-zone' });
    const btn = h('button', { class: 'btn btn-sm', type: 'button' }, icon('eye'), 'Afficher l’aperçu');
    btn.addEventListener('click', async () => {
      replace(zone, h('p', { class: 'muted small' }, 'Lecture du fichier…'));
      try {
        const bytes = await gdrive.download(item.id);
        const text = new TextDecoder().decode(bytes);
        replace(zone, h('h4', { class: 'section-title' }, 'Aperçu'), h('pre', { class: 'code' }, text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text));
      } catch (e) {
        replace(zone, h('p', { class: 'small', style: 'color: var(--bad)' }, e instanceof Error ? e.message : 'Lecture impossible.'), btn);
      }
    });
    zone.append(h('p', { class: 'muted small', style: 'margin: var(--s4) 0 var(--s2)' }, 'Le contenu n’est lu que si tu le demandes.'), btn);
    return zone;
  },
  canDownload: (item) => item.kind === 'file' && !isGoogleNative(item),
  async download(item) {
    try {
      toast(`Téléchargement de ${item.name}…`, { kind: 'info', duration: 1500 });
      const bytes = await gdrive.download(item.id);
      download(new Blob([bytes as BlobPart], { type: item.mimeType || 'application/octet-stream' }), item.name);
      toast(`${item.name} téléchargé`, { kind: 'ok' });
    } catch (e) {
      toast(e instanceof ServiceError ? e.message : 'Téléchargement impossible.', { kind: 'bad' });
    }
  },
  canImport: false,
  locationOf(item) {
    return driveSource.path(item.parentId ?? AUTHORIZED_ROOT).map((p) => p.name).join(' / ');
  },
};

export const currentSource = (): FilesSource => (store.get().mode === 'drive' ? driveSource : demoSource);
