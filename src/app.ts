// Contexte applicatif : état, services et moteurs d'opérations (sauvegarde, restauration, contrôle).
// Les moteurs exécutent réellement chaque étape (sérialisation, SHA-256, AES-GCM, envoi, relecture).
// En Phase 1, la destination est le Drive de démonstration ; en Phase 2, le vrai Drive.

import { decrypt, encrypt, generateKey, sameHash, sha256, VaultFormatError } from './core/crypto';
import { countCollections, diffPayload } from './core/diff';
import { createStore, loadSettings, type State } from './core/store';
import type { AppId, OpEvent, Payload, Scenario, Version } from './core/types';
import { importFileError, MAX_IMPORT_BYTES, safeFileName, validateImport, validateJsonText, validatePayload } from './core/validate';
import { demoApps, FOLDER, newVersionId, ROOT_ID, seedDemo, versionFileName } from './data/demo';
import { ServiceError } from './services/contracts';
import { DemoDrive, DemoJournal } from './services/demo-drive';

const GIB = 1024 ** 3;
const TIB = 1024 ** 4;

const now = Date.now();
const initial: State = {
  ready: false,
  scenario: 'normal',
  connectivity: { online: typeof navigator === 'undefined' ? true : navigator.onLine, google: 'connected', supabase: 'unknown' },
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
  sessionKey = await generateKey();
  const seed = await seedDemo(drive, store.get().apps, sessionKey, now);
  store.set({ versions: seed.versions, events: seed.events, catalog: [...drive.items.values()] });
  await refreshConnectivity();
  store.set({ ready: true });
}

/** Re-vérifie réellement chaque source. Rien n'est supposé. */
export async function refreshConnectivity() {
  const s = store.get();
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

function pushEvent(e: OpEvent) {
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
  if (e instanceof DOMException && e.name === 'AbortError') return { message: 'Opération annulée. Aucun succès n’a été confirmé.', retryable: true };
  if (e instanceof ServiceError) {
    switch (e.code) {
      case 'offline':
        return { message: 'Connexion perdue avant la fin. La conservation du fichier n’est pas confirmée.', retryable: true };
      case 'interrupted':
        return { message: 'Envoi interrompu — connexion perdue. La sauvegarde n’est pas confirmée.', retryable: true };
      case 'auth-expired':
        return { message: 'Session Google expirée. Reconnecte-toi puis relance la sauvegarde.', retryable: false };
      case 'not-found':
        return { message: 'Le fichier n’existe plus dans Drive. Il a peut-être été déplacé ou supprimé.', retryable: false };
      case 'quota':
        return { message: 'Espace de stockage insuffisant. Le fichier n’est pas confirmé.', retryable: false };
      default:
        return { message: 'Service indisponible. Le fichier n’est pas confirmé.', retryable: true };
    }
  }
  if (e instanceof VaultFormatError) return { message: 'Déchiffrement impossible : format incompatible, clé incorrecte ou fichier altéré.', retryable: false };
  // Un message fournisseur, JSON ou navigateur peut contenir des données privées.
  return { message: 'Opération interrompue. Aucun succès n’a été confirmé. Réessaie après vérification de la connexion.', retryable: true };
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
}

function checkFileSize(bytes: Uint8Array, expected?: number) {
  // 10 Mio de JSON + en-tête CVLT v1 (33) + tag GCM (16).
  if (bytes.length > MAX_IMPORT_BYTES + 49 || expected !== undefined && bytes.length !== expected) {
    throw new OperationError('Taille du fichier incompatible : fichier refusé avant déchiffrement.', 2, false);
  }
}

function checkVersion(version: Version) {
  if (!version.encrypted || !Number.isSafeInteger(version.sizeBytes) || version.sizeBytes < 49 || version.sizeBytes > MAX_IMPORT_BYTES + 49) {
    throw new OperationError('Version de démonstration incompatible ou trop volumineuse : restauration refusée.', 0, false);
  }
}

/** Un hash annoncé par le fournisseur ne prouve pas la relecture du fichier. */
async function readVerified(fileId: string, expected: string, signal?: AbortSignal, expectedSize?: number): Promise<Uint8Array> {
  checkAbort(signal);
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_IMPORT_BYTES + 49)) throw new OperationError('Taille de référence invalide.', 4, false);
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new OperationError('Empreinte de référence invalide.', 4, false);
  const remote = await drive.remoteSha256(fileId, signal);
  checkAbort(signal);
  if (!sameHash(remote, expected)) throw new OperationError('Empreinte distante différente : fichier non vérifié.', 4, true, false);
  const bytes = await drive.download(fileId, signal);
  checkFileSize(bytes, expectedSize);
  if (!sameHash(await sha256(bytes), expected)) throw new OperationError('Relecture différente : fichier non vérifié.', 4, true, false);
  checkAbort(signal);
  return bytes;
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
    checkAbort(signal);
    go(0, 'running');
    const source = validatePayload(app.payload, appId);
    if (!source.ok) throw new OperationError(source.error, 1, false);
    const json = JSON.stringify(app.payload);
    if (new TextEncoder().encode(json).length > MAX_IMPORT_BYTES) throw new OperationError('Le contenu dépasse 10 Mo : sauvegarde refusée.', 0, false);
    const counts = countCollections(source.payload);
    go(0, 'done', { note: `${(json.length / 1024).toFixed(1).replace('.', ',')} Ko de données` });

    go(1, 'running');
    const check = validateJsonText(json, appId);
    if (!check.ok) throw new OperationError(check.error, 1, false);
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
    await readVerified(file.id, localHash, signal, blob.length);
    go(4, 'done', { note: 'Octets retéléchargés, SHA-256 identique' });
    checkAbort(signal);

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
    const durationMs = performance.now() - started;
    go(5, 'done');
    checkAbort(signal);
    store.set({
      versions: [...store.get().versions, version],
      catalog: [...drive.items.values()],
      queue: store.get().queue.filter((q) => q.appId !== appId),
    });
    if (record) {
      pushEvent({ id: `e-${id}`, at, source: appId, type: kind === 'safety' ? 'safety' : 'backup', result: 'success', durationMs, sizeBytes: blob.length, integrity: 'verified', versionId: id, sha256: localHash });
    }
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

// Reçu mémoire, non exporté : la confirmation porte sur l’état réellement aperçu.
// Il est consommé une fois et ne contient ni clé ni information persistante.
const restoreReceipts = new WeakMap<RestorePreview, { app: State['apps'][AppId]; snapshot: string; version: string; fileId: string }>();
const versionIdentity = (v: Version) => JSON.stringify([v.id, v.appId, v.sha256, v.sizeBytes, v.encrypted, v.createdAt, v.kind, v.counts]);
function appUnchanged(appId: AppId, app: State['apps'][AppId], snapshot: string) {
  try { return store.get().apps[appId] === app && validatePayload(app.payload, appId).ok && JSON.stringify(app) === snapshot; }
  catch { return false; }
}

const conflictError = () => new OperationError('L’état actuel ou la version a changé depuis l’aperçu. Refaire l’aperçu ; les nouveaux ajouts sont conservés.', 5, false);

/** Prévisualisation : télécharge, vérifie et déchiffre la version, sans rien modifier. */
export async function previewRestore(versionId: string, signal?: AbortSignal): Promise<RestorePreview & { payload: Payload }> {
  const version = store.get().versions.find((v) => v.id === versionId);
  if (!version) throw new OperationError('Version introuvable.', 0, false);
  checkVersion(version);
  const app = store.get().apps[version.appId];
  const validCurrent = validatePayload(app.payload, version.appId);
  if (!validCurrent.ok) throw new OperationError(validCurrent.error, 0, false);
  const snapshot = JSON.stringify(app), identity = versionIdentity(version);
  const file = drive.findByVersion(versionId);
  if (!file) throw new OperationError('Le fichier de cette version n’est plus dans Drive.', 1, false);
  try {
    const blob = await drive.download(file.id, signal);
    checkFileSize(blob, version.sizeBytes);
    const h = await sha256(blob);
    if (!sameHash(h, version.sha256)) throw new OperationError('Le fichier a été modifié depuis la sauvegarde : restauration bloquée.', 2, false);
    const check = validateJsonText(await decrypt(sessionKey, blob), version.appId);
    if (!check.ok) throw new OperationError(check.error, 4, false);
    checkAbort(signal);
    const currentVersion = store.get().versions.find(v => v.id === versionId);
    if (!appUnchanged(version.appId, app, snapshot) || !currentVersion || versionIdentity(currentVersion) !== identity || drive.findByVersion(versionId)?.id !== file.id) throw conflictError();
    const payload = check.payload;
    const diff = diffPayload(app.payload, payload);
    const losses = diff.collections
      .filter((c) => c.removed > 0 && app.collections[c.key]?.critical)
      .map((c) => ({ key: c.key, label: c.removed > 1 ? app.collections[c.key].many : app.collections[c.key].one, count: c.removed }));
    const preview = { current: { counts: countCollections(app.payload), revision: app.payload.revision }, target: version, diff, losses, payload };
    restoreReceipts.set(preview, { app, snapshot, version: identity, fileId: file.id });
    return preview;
  } catch (e) {
    if (e instanceof OperationError) throw e;
    throw new OperationError(explain(e).message, 1, explain(e).retryable);
  }
}

export async function runRestore(versionId: string, onStep: (u: StepUpdate) => void, signal?: AbortSignal, preview?: RestorePreview) {
  const started = performance.now();
  const version = store.get().versions.find((v) => v.id === versionId);
  if (!version) throw new OperationError('Version introuvable.', 0, false);
  checkVersion(version);
  const appId = version.appId;
  const before = store.get().apps[appId];
  const receipt = preview && restoreReceipts.get(preview);
  if (!receipt) throw new OperationError('Un aperçu et une nouvelle confirmation sont nécessaires avant restauration.', 0, false);
  restoreReceipts.delete(preview!);
  if (!appUnchanged(appId, receipt.app, receipt.snapshot) || versionIdentity(version) !== receipt.version || drive.findByVersion(versionId)?.id !== receipt.fileId) throw conflictError();
  const beforeSnapshot = receipt.snapshot;
  const rollback = structuredClone(before);
  let applied: typeof before | undefined;
  let appliedSnapshot: string | undefined;
  let step = 0;
  try {
    // 1. Copie de sécurité : sans elle, on ne continue pas.
    step = 0;
    checkAbort(signal);
    onStep({ index: 0, state: 'running' });
    const safety = await runBackup(appId, (u) => u.index === 3 && onStep({ index: 0, state: 'running', progress: u.progress }), signal, 'safety', true);
    onStep({ index: 0, state: 'done', note: `Version ${safety.version.id}` });

    step = 1;
    onStep({ index: 1, state: 'running' });
    const file = drive.findByVersion(versionId);
    if (!file) throw new OperationError('Le fichier de cette version n’est plus dans Drive.', 1, false);
    const blob = await drive.download(file.id, signal);
    checkFileSize(blob, version.sizeBytes);
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
    const check = validateJsonText(json, appId);
    if (!check.ok) throw new OperationError(check.error, 4, false);
    onStep({ index: 4, state: 'done' });

    // 6. Remplacement atomique : l'ancien état n'est remplacé qu'une fois tout validé.
    step = 5;
    onStep({ index: 5, state: 'running' });
    checkAbort(signal);
    const currentVersion = store.get().versions.find(v => v.id === versionId);
    if (!appUnchanged(appId, before, beforeSnapshot) || !currentVersion || versionIdentity(currentVersion) !== receipt.version || drive.findByVersion(versionId)?.id !== receipt.fileId) throw conflictError();
    applied = { ...before, payload: check.payload };
    appliedSnapshot = JSON.stringify(applied);
    store.set({ apps: { ...store.get().apps, [appId]: applied } });
    onStep({ index: 5, state: 'done' });

    pushEvent({ id: `e-r-${Date.now()}`, at: Date.now(), source: appId, type: 'restore', result: 'success', durationMs: performance.now() - started, sizeBytes: version.sizeBytes, integrity: 'verified', versionId, sha256: version.sha256 });
    return { safetyVersionId: safety.version.id };
  } catch (e) {
    // Annuler uniquement notre propre publication ; ne jamais rétablir un ancien
    // instantané au-dessus d'une modification effectuée par une autre opération.
    const changedAfterApply = !!applied && !appUnchanged(appId, applied, appliedSnapshot!);
    if (applied && !changedAfterApply) store.set({ apps: { ...store.get().apps, [appId]: rollback } });
    const err = e instanceof OperationError ? e : new OperationError(explain(e).message, step, explain(e).retryable);
    err.untouched = !changedAfterApply;
    const recovery = changedAfterApply ? 'Un ajout concurrent après application a été conservé ; le retour arrière automatique a été arrêté. L’état antérieur reste dans la copie de sécurité.' : 'Aucune donnée concurrente n’a été remplacée ; l’état antérieur est conservé.';
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
      reason: `${err.message} ${recovery}`,
      resolved: true,
    });
    throw err;
  }
}

// ─── Contrôle d'intégrité global ───────────────────────────────────────────

export async function verifyAll(onProgress: (done: number, total: number) => void, signal?: AbortSignal) {
  return verifyVersions(store.get().versions.map(v => v.id), onProgress, signal);
}

/** Même preuve pour le contrôle global et la sélection dans l’explorateur. */
export async function verifyVersions(ids: string[], onProgress: (done: number, total: number) => void = () => {}, signal?: AbortSignal) {
  const started = performance.now();
  const versions = [...new Set(ids)].map(id => {
    const version = store.get().versions.find(v => v.id === id);
    return { id, version, identity: version && versionIdentity(version), fileId: drive.findByVersion(id)?.id };
  });
  let mismatches = 0;
  let completed = 0;
  try {
    for (const [i, snapshot] of versions.entries()) {
      const { id, version, identity, fileId } = snapshot;
      checkAbort(signal);
      let verified = false;
      try {
        if (!version || !fileId) throw new OperationError('Fichier introuvable.', 0, false);
        await readVerified(fileId, version.sha256, signal, version.sizeBytes);
        verified = true;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
      }
      const current = store.get().versions.find(v => v.id === id);
      const unchanged = !!current && versionIdentity(current) === identity && drive.findByVersion(id)?.id === fileId;
      if (!verified || !unchanged) mismatches++;
      // Publier immédiatement le résultat connu ; une annulation ultérieure ne
      // doit pas rétablir le statut d’un fichier dont la lecture a échoué.
      if (unchanged) store.set({ versions: store.get().versions.map(v => v.id === id ? { ...v, verifiedAt: verified ? Date.now() : undefined } : v) });
      completed++;
      onProgress(i + 1, versions.length);
    }
    checkAbort(signal);
  } catch (e) {
    const cancelled = signal?.aborted || e instanceof DOMException && e.name === 'AbortError';
    pushEvent({ id: `e-vc-${Date.now()}`, at: Date.now(), source: 'vault', type: 'verify', result: cancelled ? 'cancelled' : 'failed', durationMs: performance.now() - started,
      integrity: mismatches ? 'mismatch' : 'not-checked', reason: `Contrôle interrompu après ${completed} fichier(s). Les résultats déjà obtenus sont conservés.`, resolved: true });
    throw new OperationError(explain(e).message, 0, true);
  }
  const at = Date.now();
  pushEvent({
    id: `e-v-${at}`,
    at,
    source: 'vault',
    type: 'verify',
    result: mismatches ? 'failed' : 'success',
    durationMs: performance.now() - started,
    integrity: mismatches ? 'mismatch' : 'verified',
    reason: mismatches ? `${mismatches} fichier(s) non vérifiés : lecture ou empreinte en échec.` : undefined,
    resolved: !mismatches,
  });
  return { total: versions.length, mismatches };
}

// ─── Import JSON ───────────────────────────────────────────────────────────

export async function importJson(file: File, parentId: string) {
  const started = performance.now();
  let appId: AppId | null = null;
  try {
    const fileError = importFileError(file.name, file.size);
    if (fileError) throw new OperationError(fileError, 0, false);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== file.size || bytes.length > MAX_IMPORT_BYTES) throw new OperationError('Taille du contenu différente de celle annoncée : fichier refusé.', 0, false);
    let text: string;
    try {
      // File.text() remplace silencieusement un UTF-8 tronqué. Conserver les
      // octets d’origine et refuser tout remplacement, y compris un BOM JSON.
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new OperationError('Encodage UTF-8 invalide : fichier refusé.', 0, false);
    }
    const check = validateImport(file.name, file.size, text);
    if (!check.ok) throw new OperationError(check.error, 0, false);
    appId = check.appId;
    const local = await sha256(bytes);
    const item = await drive.upload({ name: safeFileName(file.name), parentId, bytes, family: 'json' }, () => {}, undefined);
    await readVerified(item.id, local, undefined, bytes.length);
    store.set({ catalog: [...drive.items.values()] });
    pushEvent({
      id: `e-i-${Date.now()}`,
      at: Date.now(),
      source: check.appId ?? 'vault',
      type: 'import',
      result: 'success',
      durationMs: performance.now() - started,
      sizeBytes: bytes.length,
      integrity: 'verified',
      sha256: local,
      resolved: true,
    });
    return { item, appId: check.appId };
  } catch (e) {
    const err = e instanceof OperationError ? e : new OperationError(explain(e).message, 0, explain(e).retryable);
    pushEvent({ id: `e-if-${Date.now()}`, at: Date.now(), source: appId ?? 'vault', type: 'import', result: 'failed',
      durationMs: performance.now() - started, integrity: 'not-checked', reason: err.message, resolved: false });
    throw err;
  }
}

export function exportJournal(): Blob {
  const s = store.get();
  const data = { exportedAt: new Date().toISOString(), demo: true, events: s.events, versions: s.versions.map(({ id, appId, createdAt, sizeBytes, sha256: h, kind }) => ({ id, appId, createdAt, sizeBytes, sha256: h, kind })) };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}
