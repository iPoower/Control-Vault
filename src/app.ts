// Contexte applicatif : état, services et moteurs d'opérations (sauvegarde, restauration, contrôle).
// Les moteurs exécutent réellement chaque étape (sérialisation, SHA-256, AES-GCM, envoi, relecture).
// En Phase 1, la destination est le Drive de démonstration ; en Phase 2, le vrai Drive.

import { decrypt, encrypt, generateKey, sameHash, sha256 } from './core/crypto';
import { countCollections, diffPayload } from './core/diff';
import { initialMode } from './core/mode';
import { createStore, loadSettings, type State } from './core/store';
import type { AppId, OpEvent, Payload, Scenario, Version } from './core/types';
import { safeFileName, validateImport, validatePayload } from './core/validate';
import { demoApps, FOLDER, newVersionId, ROOT_ID, seedDemo, versionFileName } from './data/demo';
import { ServiceError } from './services/contracts';
import { DemoDrive, DemoJournal } from './services/demo-drive';

const GIB = 1024 ** 3;
const TIB = 1024 ** 4;

const now = Date.now();
const mode = typeof window === 'undefined' ? 'demo' : initialMode();
const initial: State = {
  ready: false,
  mode,
  drive: { auth: 'signed-out', scopes: [], roots: [] },
  scenario: 'normal',
  connectivity: { online: typeof navigator === 'undefined' ? true : navigator.onLine, google: mode === 'drive' ? 'disconnected' : 'connected', supabase: 'unknown' },
  apps: demoApps(now),
  versions: [],
  events: [],
  queue: [],
  settings: loadSettings(),
  busy: null,
  catalog: [],
};

export const store = createStore(initial);
const scenario = () => store.get().scenario;
const browserOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

export const drive = new DemoDrive(
  { usedBytes: 239.48 * GIB, totalBytes: 5 * TIB, planNote: 'Offre étudiante — renouvellement à vérifier', checkedAt: now },
  scenario,
  browserOnline,
);
export const journal = new DemoJournal(scenario, browserOnline);
export { ROOT_ID, FOLDER };

let sessionKey: CryptoKey;

export async function boot() {
  if (store.get().mode === 'drive') {
    // Mode Google Drive : aucune donnée de démonstration n'est créée.
    const { bootDrive } = await import('./drive');
    await bootDrive();
    store.set({ ready: true });
    return;
  }
  sessionKey = await generateKey();
  const seed = await seedDemo(drive, store.get().apps, sessionKey, now);
  store.set({ versions: seed.versions, events: seed.events, catalog: [...drive.items.values()] });
  await refreshConnectivity();
  store.set({ ready: true });
}

/** Re-vérifie réellement chaque source. Rien n'est supposé. */
export async function refreshConnectivity() {
  const s = store.get();
  if (s.mode === 'drive') {
    const { refreshDrive } = await import('./drive');
    return refreshDrive();
  }
  const online = browserOnline() && s.scenario !== 'offline';
  const google = s.scenario === 'auth-expired' ? 'expired' : s.connectivity.google === 'disconnected' ? 'disconnected' : 'connected';
  let supabase: State['connectivity']['supabase'] = 'unknown';
  if (online) supabase = (await journal.ping()) ? 'reachable' : 'unreachable';
  let quota = s.quota;
  if (online && google === 'connected') {
    try {
      quota = await drive.getQuota();
    } catch {
      /* le quota affiché garde sa date de dernière vérification */
    }
  }
  store.set({ connectivity: { online, google, supabase }, quota });
}

export async function setScenario(next: Scenario) {
  store.set({ scenario: next });
  await refreshConnectivity();
}

export function reconnectGoogle() {
  // Démonstration : en Phase 2, relance Google Identity Services (consentement incrémental).
  store.set({ connectivity: { ...store.get().connectivity, google: 'connected' } });
  return setScenario(store.get().scenario === 'auth-expired' ? 'normal' : store.get().scenario);
}

export function pushEvent(e: OpEvent) {
  const s = store.get();
  let events = [e, ...s.events];
  // Une réussite clôt les échecs précédents de la même opération.
  if (e.result === 'success' && (e.type === 'backup' || e.type === 'restore')) {
    events = events.map((x) => (x.source === e.source && x.type === e.type && x.result === 'failed' ? { ...x, resolved: true } : x));
  }
  store.set({ events });
}

export const lastVerified = (appId: AppId) =>
  store
    .get()
    .versions.filter((v) => v.appId === appId && v.verifiedAt)
    .sort((a, b) => b.createdAt - a.createdAt)[0];

export const versionsOf = (appId: AppId) =>
  store
    .get()
    .versions.filter((v) => v.appId === appId)
    .sort((a, b) => b.createdAt - a.createdAt);

// ─── Étapes ────────────────────────────────────────────────────────────────

export type StepState = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';
export interface StepUpdate {
  index: number;
  state: StepState;
  progress?: number; // 0..1 quand mesurable
  note?: string;
}

export const BACKUP_STEPS = ['Préparation des données', 'Vérification du contenu', 'Chiffrement', 'Envoi vers Drive', 'Contrôle de l’empreinte distante', 'Confirmation'];
export const RESTORE_STEPS = [
  'Copie de sécurité de l’état actuel',
  'Téléchargement de la version',
  'Contrôle d’intégrité',
  'Déchiffrement',
  'Validation du contenu',
  'Application de la version',
];

export class OperationError extends Error {
  constructor(
    message: string,
    public step: number,
    public retryable: boolean,
    public untouched = true,
  ) {
    super(message);
  }
}

function explain(e: unknown): { message: string; retryable: boolean } {
  if (e instanceof DOMException && e.name === 'AbortError') return { message: 'Opération annulée. Rien n’a été écrit dans Drive.', retryable: true };
  if (e instanceof ServiceError) {
    switch (e.code) {
      case 'offline':
        return { message: 'Connexion perdue avant la fin. Rien n’a été écrit dans Drive.', retryable: true };
      case 'interrupted':
        return { message: 'Envoi interrompu — connexion perdue. Rien n’a été écrit dans Drive.', retryable: true };
      case 'auth-expired':
        return { message: 'Session Google expirée. Reconnecte-toi puis relance la sauvegarde.', retryable: false };
      case 'not-found':
        return { message: 'Le fichier n’existe plus dans Drive. Il a peut-être été déplacé ou supprimé.', retryable: false };
      default:
        return { message: e.message, retryable: true };
    }
  }
  return { message: e instanceof Error ? e.message : 'Erreur inattendue.', retryable: true };
}

// ─── Sauvegarde ────────────────────────────────────────────────────────────

export interface BackupResult {
  version: Version;
  durationMs: number;
}

export async function runBackup(
  appId: AppId,
  onStep: (u: StepUpdate) => void,
  signal?: AbortSignal,
  kind: Version['kind'] = 'manual',
  record = true,
): Promise<BackupResult> {
  const started = performance.now();
  const app = store.get().apps[appId];
  let step = 0;
  const go = (index: number, state: StepState, extra: Partial<StepUpdate> = {}) => {
    step = index;
    onStep({ index, state, ...extra });
  };
  try {
    go(0, 'running');
    const json = JSON.stringify(app.payload);
    const counts = countCollections(app.payload);
    go(0, 'done', { note: `${(json.length / 1024).toFixed(1).replace('.', ',')} Ko de données` });

    go(1, 'running');
    const check = validatePayload(JSON.parse(json), appId);
    if (!check.ok) throw new OperationError(check.error, 1, false);
    const plainHash = await sha256(json);
    go(1, 'done', { note: 'Structure conforme' });

    go(2, 'running');
    const blob = await encrypt(sessionKey, json);
    const localHash = await sha256(blob);
    go(2, 'done', { note: 'AES-256-GCM' });

    go(3, 'running', { progress: 0 });
    const id = newVersionId();
    const at = Date.now();
    const file = await drive.upload(
      { name: versionFileName(appId, at), parentId: FOLDER[appId], bytes: blob, family: 'vault', versionId: id },
      (p) => onStep({ index: 3, state: 'running', progress: p.sentBytes / p.totalBytes }),
      signal,
    );
    go(3, 'done', { progress: 1 });

    go(4, 'running');
    const remote = await drive.remoteSha256(file.id, signal);
    if (!sameHash(remote, localHash)) {
      throw new OperationError('L’empreinte du fichier dans Drive ne correspond pas. La version est marquée comme non fiable.', 4, true, false);
    }
    go(4, 'done', { note: 'SHA-256 identique' });

    const version: Version = {
      id,
      appId,
      createdAt: at,
      sizeBytes: blob.length,
      sha256: localHash,
      encrypted: true,
      kind,
      counts,
      verifiedAt: Date.now(),
    };
    void plainHash;
    const durationMs = performance.now() - started;
    store.set({
      versions: [...store.get().versions, version],
      catalog: [...drive.items.values()],
      queue: store.get().queue.filter((q) => q.appId !== appId),
    });
    if (record) {
      pushEvent({ id: `e-${id}`, at, source: appId, type: kind === 'safety' ? 'safety' : 'backup', result: 'success', durationMs, sizeBytes: blob.length, integrity: 'verified', versionId: id, sha256: localHash });
    }
    go(5, 'done');
    return { version, durationMs };
  } catch (e) {
    const err = e instanceof OperationError ? e : new OperationError(explain(e).message, step, explain(e).retryable);
    onStep({ index: err.step, state: 'failed', note: err.message });
    if (record) {
      const cancelled = e instanceof DOMException && e.name === 'AbortError';
      pushEvent({
        id: `e-fail-${Date.now()}`,
        at: Date.now(),
        source: appId,
        type: kind === 'safety' ? 'safety' : 'backup',
        result: cancelled ? 'cancelled' : 'failed',
        durationMs: performance.now() - started,
        integrity: 'not-checked',
        reason: err.message,
        retry: err.retryable ? { appId, type: 'backup' } : undefined,
        resolved: cancelled,
      });
    }
    throw err;
  }
}

export function queueBackup(appId: AppId) {
  const s = store.get();
  if (s.queue.some((q) => q.appId === appId)) return;
  store.set({
    queue: [...s.queue, { id: `q-${Date.now()}`, appId, type: 'backup', queuedAt: Date.now(), reason: s.connectivity.google === 'expired' ? 'auth' : 'offline' }],
  });
}

// ─── Restauration ──────────────────────────────────────────────────────────

export interface RestorePreview {
  current: { counts: Record<string, number>; revision: unknown };
  target: Version;
  diff: ReturnType<typeof diffPayload> | null;
  /** Collections critiques qui perdraient des éléments. */
  losses: { key: string; label: string; count: number }[];
}

/** Prévisualisation : télécharge, vérifie et déchiffre la version, sans rien modifier. */
export async function previewRestore(versionId: string, signal?: AbortSignal): Promise<RestorePreview & { payload: Payload }> {
  const version = store.get().versions.find((v) => v.id === versionId);
  if (!version) throw new OperationError('Version introuvable.', 0, false);
  const app = store.get().apps[version.appId];
  const file = drive.findByVersion(versionId);
  if (!file) throw new OperationError('Le fichier de cette version n’est plus dans Drive.', 1, false);
  try {
    const blob = await drive.download(file.id, signal);
    const h = await sha256(blob);
    if (!sameHash(h, version.sha256)) throw new OperationError('Le fichier a été modifié depuis la sauvegarde : restauration bloquée.', 2, false);
    const payload = JSON.parse(await decrypt(sessionKey, blob)) as Payload;
    const diff = diffPayload(app.payload, payload);
    const losses = diff.collections
      .filter((c) => c.removed > 0 && app.collections[c.key]?.critical)
      .map((c) => ({ key: c.key, label: c.removed > 1 ? app.collections[c.key].many : app.collections[c.key].one, count: c.removed }));
    return { current: { counts: countCollections(app.payload), revision: app.payload.revision }, target: version, diff, losses, payload };
  } catch (e) {
    if (e instanceof OperationError) throw e;
    throw new OperationError(explain(e).message, 1, explain(e).retryable);
  }
}

export async function runRestore(versionId: string, onStep: (u: StepUpdate) => void, signal?: AbortSignal) {
  const started = performance.now();
  const version = store.get().versions.find((v) => v.id === versionId)!;
  const appId = version.appId;
  const before = store.get().apps[appId];
  let step = 0;
  try {
    // 1. Copie de sécurité : sans elle, on ne continue pas.
    step = 0;
    onStep({ index: 0, state: 'running' });
    const safety = await runBackup(appId, (u) => u.index === 3 && onStep({ index: 0, state: 'running', progress: u.progress }), signal, 'safety', true);
    onStep({ index: 0, state: 'done', note: `Version ${safety.version.id}` });

    step = 1;
    onStep({ index: 1, state: 'running' });
    const file = drive.findByVersion(versionId);
    if (!file) throw new OperationError('Le fichier de cette version n’est plus dans Drive.', 1, false);
    const blob = await drive.download(file.id, signal);
    onStep({ index: 1, state: 'done' });

    step = 2;
    onStep({ index: 2, state: 'running' });
    const h = await sha256(blob);
    if (!sameHash(h, version.sha256)) throw new OperationError('Empreinte différente de celle enregistrée : fichier altéré.', 2, false);
    onStep({ index: 2, state: 'done', note: 'SHA-256 identique' });

    step = 3;
    onStep({ index: 3, state: 'running' });
    const json = await decrypt(sessionKey, blob);
    onStep({ index: 3, state: 'done' });

    step = 4;
    onStep({ index: 4, state: 'running' });
    const check = validatePayload(JSON.parse(json), appId);
    if (!check.ok) throw new OperationError(check.error, 4, false);
    onStep({ index: 4, state: 'done' });

    // 6. Remplacement atomique : l'ancien état n'est remplacé qu'une fois tout validé.
    step = 5;
    onStep({ index: 5, state: 'running' });
    if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
    store.set({ apps: { ...store.get().apps, [appId]: { ...before, payload: check.payload } } });
    onStep({ index: 5, state: 'done' });

    pushEvent({ id: `e-r-${Date.now()}`, at: Date.now(), source: appId, type: 'restore', result: 'success', durationMs: performance.now() - started, sizeBytes: version.sizeBytes, integrity: 'verified', versionId, sha256: version.sha256 });
    return { safetyVersionId: safety.version.id };
  } catch (e) {
    // Aucun état intermédiaire : l'application garde exactement ses données d'avant.
    store.set({ apps: { ...store.get().apps, [appId]: before } });
    const err = e instanceof OperationError ? e : new OperationError(explain(e).message, step, explain(e).retryable);
    onStep({ index: err.step, state: 'failed', note: err.message });
    pushEvent({
      id: `e-rf-${Date.now()}`,
      at: Date.now(),
      source: appId,
      type: 'restore',
      result: e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed',
      durationMs: performance.now() - started,
      integrity: 'not-checked',
      versionId,
      reason: `${err.message} Les données actuelles n’ont pas été modifiées.`,
      resolved: true,
    });
    throw err;
  }
}

// ─── Contrôle d'intégrité global ───────────────────────────────────────────

export async function verifyAll(onProgress: (done: number, total: number) => void, signal?: AbortSignal) {
  const started = performance.now();
  const versions = store.get().versions;
  let mismatches = 0;
  for (const [i, v] of versions.entries()) {
    const file = drive.findByVersion(v.id);
    const bytes = file ? drive.bytesOf(file.id) : null;
    if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
    const remote = file ? await drive.remoteSha256(file.id, signal) : '';
    const local = bytes ? await sha256(bytes) : '';
    if (!sameHash(remote, v.sha256) || !sameHash(local, v.sha256)) mismatches++;
    onProgress(i + 1, versions.length);
  }
  const at = Date.now();
  store.set({ versions: versions.map((v) => ({ ...v, verifiedAt: mismatches ? v.verifiedAt : at })) });
  pushEvent({
    id: `e-v-${at}`,
    at,
    source: 'vault',
    type: 'verify',
    result: mismatches ? 'failed' : 'success',
    durationMs: performance.now() - started,
    integrity: mismatches ? 'mismatch' : 'verified',
    reason: mismatches ? `${mismatches} fichier(s) ne correspondent plus à leur empreinte.` : undefined,
    resolved: !mismatches,
  });
  return { total: versions.length, mismatches };
}

// ─── Import JSON ───────────────────────────────────────────────────────────

export async function importJson(file: File, parentId: string) {
  const text = await file.text();
  const check = validateImport(file.name, file.size, text);
  if (!check.ok) throw new OperationError(check.error, 0, false);
  const started = performance.now();
  const bytes = new TextEncoder().encode(text);
  try {
    const item = await drive.upload({ name: safeFileName(file.name), parentId, bytes, family: 'json' }, () => {}, undefined);
    const remote = await drive.remoteSha256(item.id);
    const local = await sha256(bytes);
    const ok = sameHash(remote, local);
    store.set({ catalog: [...drive.items.values()] });
    pushEvent({
      id: `e-i-${Date.now()}`,
      at: Date.now(),
      source: check.appId ?? 'vault',
      type: 'import',
      result: ok ? 'success' : 'failed',
      durationMs: performance.now() - started,
      sizeBytes: bytes.length,
      integrity: ok ? 'verified' : 'mismatch',
      sha256: local,
      resolved: true,
    });
    return { item, appId: check.appId };
  } catch (e) {
    throw new OperationError(explain(e).message, 0, explain(e).retryable);
  }
}

export function exportJournal(): Blob {
  const s = store.get();
  const data = { exportedAt: new Date().toISOString(), demo: true, events: s.events, versions: s.versions.map(({ id, appId, createdAt, sizeBytes, sha256: h, kind }) => ({ id, appId, createdAt, sizeBytes, sha256: h, kind })) };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}
