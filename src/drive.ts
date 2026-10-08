// Session Google Drive réelle : authentification, vérifications, autorisations, envoi de test.
// Ce module n'est chargé qu'en mode Google Drive, sur l'origine dédiée.

import { pushEvent, store } from './app';
import { CONFIGURED_FOLDERS, GOOGLE } from './config';
import { sameHash, sha256 } from './core/crypto';
import type { RootAccess } from './core/store';
import { ServiceError } from './services/contracts';
import { GoogleAuth } from './services/google-auth';
import { GoogleDriveProvider } from './services/google-drive';
import { pickFromDrive, preloadPicker, type PickedDoc } from './services/google-picker';

export const auth = new GoogleAuth(GOOGLE.clientId);
export const gdrive = new GoogleDriveProvider(
  () => auth.accessToken(),
  () => auth.expire(),
);

/** Identifiants autorisés via le sélecteur (pas des secrets) : on retient lesquels, pas leur contenu. */
const GRANTS_KEY = 'control-vault:granted-ids:v1';
const RECHECK_MS = 5 * 60_000;

function loadGrants(): { id: string; kind: 'folder' | 'file' }[] {
  try {
    const raw = JSON.parse(localStorage.getItem(GRANTS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((g): g is { id: string; kind: 'folder' | 'file' } => !!g && /^[A-Za-z0-9_-]+$/.test(g.id) && (g.kind === 'folder' || g.kind === 'file')).slice(0, 200) : [];
  } catch {
    return [];
  }
}

function saveGrants(list: { id: string; kind: 'folder' | 'file' }[]) {
  try {
    localStorage.setItem(GRANTS_KEY, JSON.stringify(list.slice(0, 200)));
  } catch {
    /* non bloquant */
  }
}

function initialRoots(): RootAccess[] {
  const configured: RootAccess[] = CONFIGURED_FOLDERS.map((f) => ({ id: f.id, name: f.name, key: f.key, source: 'config', kind: 'folder', access: 'unknown' }));
  const extra: RootAccess[] = loadGrants()
    .filter((g) => !configured.some((c) => c.id === g.id))
    .map((g) => ({ id: g.id, name: g.kind === 'folder' ? 'Dossier autorisé' : 'Fichier autorisé', source: 'picker', kind: g.kind, access: 'unknown' }));
  return [...configured, ...extra];
}

function patchDrive(p: Partial<ReturnType<typeof store.get>['drive']>) {
  store.set({ drive: { ...store.get().drive, ...p } });
}

function syncConnectivity() {
  const s = store.get();
  const a = s.drive.auth;
  store.set({
    connectivity: {
      online: navigator.onLine,
      google: a === 'connected' ? 'connected' : a === 'expired' ? 'expired' : 'disconnected',
      supabase: 'unknown',
    },
  });
}

export async function bootDrive() {
  patchDrive({ roots: initialRoots() });
  auth.subscribe((snap) => {
    patchDrive({ auth: snap.state, message: snap.message, scopes: snap.grantedScopes, expiresAt: snap.expiresAt });
    syncConnectivity();
  });
  syncConnectivity();
  // Préchargement : le futur clic « Se connecter » doit ouvrir la fenêtre Google immédiatement.
  auth.prepare().catch((e: Error) => patchDrive({ message: e.message }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeAfterSleep();
  });
}

/** Retour de veille (iPhone) : jeton expiré → état « expirée » ; sinon contrôle discret. */
export function resumeAfterSleep() {
  auth.checkExpiry();
  const s = store.get().drive;
  if (s.auth === 'connected' && navigator.onLine && Date.now() - (s.lastCheckAt ?? 0) > RECHECK_MS) verifyConnection().catch(() => {});
}

export async function refreshDrive() {
  syncConnectivity();
  if (store.get().drive.auth === 'connected' && navigator.onLine) await verifyConnection().catch(() => {});
}

/** À appeler directement dans un gestionnaire de clic. */
export async function signIn(selectAccount = false) {
  const started = performance.now();
  await auth.signIn({ selectAccount });
  await verifyConnection();
  pushEvent({ id: `e-c-${Date.now()}`, at: Date.now(), source: 'vault', type: 'connect', title: 'Connexion à Google Drive', result: 'success', durationMs: performance.now() - started, integrity: 'not-checked', resolved: true });
  preloadPicker();
  await checkRoots();
}

/** Preuve de connexion : un appel réel à l'API (compte + quota). */
export async function verifyConnection() {
  const { account, quota } = await gdrive.about();
  patchDrive({ account, lastCheckAt: Date.now() });
  store.set({ quota });
}

export function signOut() {
  auth.signOut();
  patchDrive({ account: undefined, lastCheckAt: undefined, roots: store.get().drive.roots.map((r) => ({ ...r, access: 'unknown', visibleChildren: undefined })) });
  store.set({ quota: undefined });
}

export async function revokeAccess() {
  const ok = await auth.revoke();
  signOut();
  return ok;
}

/** Vérifie, pour chaque dossier connu, si Control Vault y a réellement accès. */
export async function checkRoots() {
  const roots = store.get().drive.roots;
  patchDrive({ roots: roots.map((r) => ({ ...r, access: 'checking' })) });
  const checked = await Promise.all(
    roots.map(async (r): Promise<RootAccess> => {
      try {
        const f = await gdrive.getFile(r.id);
        let visibleChildren: number | undefined;
        if (f.kind === 'folder') visibleChildren = (await gdrive.listPage(r.id, undefined, undefined, 20)).items.length;
        return { ...r, name: r.source === 'config' ? r.name : f.name, kind: f.kind, access: 'granted', canAddChildren: f.canAddChildren, visibleChildren };
      } catch (e) {
        if (e instanceof ServiceError && (e.code === 'not-found' || e.code === 'forbidden')) return { ...r, access: 'missing' };
        if (e instanceof ServiceError && e.code === 'auth-expired') return { ...r, access: 'unknown' };
        return { ...r, access: 'error' };
      }
    }),
  );
  patchDrive({ roots: checked });
  return checked;
}

/** Ouvre le sélecteur Google pour autoriser des dossiers ou fichiers existants. */
export async function grantAccess(parentId?: string): Promise<PickedDoc[] | null> {
  const token = auth.accessToken();
  if (!token) throw new ServiceError('auth-expired', 'Session Google expirée.');
  const picked = await pickFromDrive({ token, apiKey: GOOGLE.apiKey, appId: GOOGLE.appId, parentId, title: 'Autoriser des fichiers pour Control Vault' });
  if (!picked?.length) return picked;
  const grants = loadGrants();
  for (const d of picked) if (!grants.some((g) => g.id === d.id)) grants.push({ id: d.id, kind: d.isFolder ? 'folder' : 'file' });
  saveGrants(grants);
  const roots = store.get().drive.roots;
  const added = picked.filter((d) => !roots.some((r) => r.id === d.id)).map((d): RootAccess => ({ id: d.id, name: d.name, source: 'picker', kind: d.isFolder ? 'folder' : 'file', access: 'unknown' }));
  patchDrive({ roots: [...roots, ...added] });
  pushEvent({ id: `e-g-${Date.now()}`, at: Date.now(), source: 'vault', type: 'grant', title: `Autorisation de ${picked.length} élément${picked.length > 1 ? 's' : ''}`, result: 'success', durationMs: 0, integrity: 'not-checked', resolved: true });
  await checkRoots();
  return picked;
}

/** Oublie localement un élément autorisé (l'autorisation Google, elle, se retire par révocation). */
export function forgetGrant(id: string) {
  saveGrants(loadGrants().filter((g) => g.id !== id));
  patchDrive({ roots: store.get().drive.roots.filter((r) => r.source === 'config' || r.id !== id) });
}

// ─── Envoi de test ─────────────────────────────────────────────────────────

export const TEST_STEPS = ['Création du fichier de test', 'Envoi vers Drive', 'Relecture distante', 'Comparaison SHA-256', 'Confirmation'];

export interface TestUploadResult {
  name: string;
  sizeBytes: number;
  sha256: string;
  method: 'drive' | 'relecture';
  link?: string;
  durationMs: number;
}

export function testFileName(at = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `control-vault-test_${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}_${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}.json`;
}

/**
 * Crée un NOUVEAU fichier fictif clairement nommé, l'envoie, le relit et compare les empreintes.
 * Ne remplace ni ne supprime rien.
 */
export async function runTestUpload(parentId: string, onStep: (i: number, state: 'running' | 'done' | 'failed', note?: string, progress?: number) => void, signal?: AbortSignal): Promise<TestUploadResult> {
  const started = performance.now();
  let step = 0;
  try {
    onStep(0, 'running');
    const name = testFileName();
    const content = JSON.stringify(
      { app: 'control-vault', type: 'fichier-de-test', fictif: true, cree: new Date().toISOString(), message: 'Fichier de test créé par Control Vault. Aucune donnée personnelle. Tu peux le supprimer.' },
      null,
      2,
    );
    const bytes = new TextEncoder().encode(content);
    const local = await sha256(bytes);
    onStep(0, 'done', name);

    step = 1;
    onStep(1, 'running', undefined, 0);
    const item = await gdrive.upload({ name, parentId, bytes, family: 'json', mimeType: 'application/json' }, (p) => onStep(1, 'running', undefined, p.sentBytes / p.totalBytes), signal);
    onStep(1, 'done', undefined, 1);

    step = 2;
    onStep(2, 'running');
    const remote = await gdrive.remoteDigest(item.id, signal);
    onStep(2, 'done', remote.method === 'drive' ? 'Empreinte calculée par Google Drive' : 'Contenu relu et empreinte recalculée');

    step = 3;
    onStep(3, 'running');
    if (!sameHash(remote.hash, local)) throw new ServiceError('bad-response', 'Empreinte différente : le fichier dans Drive ne correspond pas à celui envoyé.');
    onStep(3, 'done', 'Identique');

    onStep(4, 'done');
    const durationMs = performance.now() - started;
    pushEvent({ id: `e-t-${Date.now()}`, at: Date.now(), source: 'vault', type: 'test-upload', title: `Envoi de test : ${name}`, result: 'success', durationMs, sizeBytes: bytes.length, integrity: 'verified', sha256: local, link: item.webViewLink, resolved: true });
    return { name, sizeBytes: bytes.length, sha256: local, method: remote.method, link: item.webViewLink, durationMs };
  } catch (e) {
    const cancelled = e instanceof DOMException && e.name === 'AbortError';
    const interrupted = e instanceof ServiceError && e.code === 'interrupted';
    const message = cancelled
      ? 'Envoi annulé. Si l’envoi était presque terminé, vérifie le dossier dans Drive.'
      : interrupted
        ? `${e.message}. Si la coupure est arrivée à la toute fin, le fichier peut exister quand même : vérifie le dossier avant de réessayer.`
        : e instanceof Error
          ? e.message
          : 'Erreur inattendue.';
    onStep(step, 'failed', message);
    pushEvent({
      id: `e-tf-${Date.now()}`,
      at: Date.now(),
      source: 'vault',
      type: 'test-upload',
      title: 'Envoi de test',
      result: cancelled ? 'cancelled' : 'failed',
      durationMs: performance.now() - started,
      integrity: 'not-checked',
      reason: message,
      resolved: true,
    });
    throw e instanceof Error ? e : new Error(message);
  }
}
