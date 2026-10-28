// Transport de paquets RC déjà chiffrés. Le parcours réel est distinct de DemoDrive.
// Aucun OAuth automatique, token persistant, effacement ou modification de fichier.
import { PACKET_LIMITS, readRacePacket, strictOpaqueJson, type RacePacket } from '../core/race-packet';
import { readSyncRevision, syncRevisionProperties, syncRevisionFromProperties, sameSyncRevision, type SyncRevision } from '../core/sync-revision';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export class OpaqueDriveError extends Error {
  constructor(readonly code: 'origin' | 'auth' | 'quota' | 'missing' | 'conflict' | 'integrity' | 'incomplete' | 'unavailable' | 'cancelled') {
    super(code); this.name = 'OpaqueDriveError';
  }
}
const fail = (code: OpaqueDriveError['code']): never => { throw new OpaqueDriveError(code); };
const id = (value: string) => value.trim() === value && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : fail('conflict');
const hash = (value: unknown): value is string => typeof value === 'string' && value.length === 64 && /^[0-9a-f]+$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export interface RemotePacket {
  readonly fileId: string; readonly fileSha256: string; readonly cipherSha256: string; readonly size: number;
  readonly state: 'unverified';
  readonly revision?: SyncRevision;
}
export interface ByteProof {
  readonly fileId: string; readonly fileSha256: string; readonly cipherSha256: string;
  readonly size: number; readonly verifiedAt: number; readonly state: 'verified-bytes';
  readonly revision?: SyncRevision;
}
export interface SyncProfile { readonly fileId: string; readonly sha256: string; readonly bytes: Uint8Array }
export interface DedicatedFolder { readonly id: string; readonly name: string; readonly createdTime: string }
export class OpaqueDrive {
  #token: string | null = null;
  #until = 0;
  #epoch = 0;
  constructor(private readonly origins: readonly string[], private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now()) { this.guard(); }
  private guard(): void {
    if (typeof location === 'undefined') return fail('origin');
    const u = new URL(location.origin);
    if (u.protocol !== 'https:' || u.hostname === 'github.io' || u.hostname.endsWith('.github.io') ||
      !this.origins.includes(u.origin)) return fail('origin');
  }
  connect(token: string, expiresIn: number, granted: readonly string[]): void {
    this.guard(); this.disconnect();
    if (token.length > 8192 || token.trim() !== token || !/^[A-Za-z0-9._~+\/-]{1,8192}=*$/.test(token) || !Number.isFinite(expiresIn) || expiresIn <= 30 || expiresIn > 3600 ||
      granted.length !== 1 || granted[0] !== DRIVE_FILE_SCOPE) return fail('auth');
    this.#token = token; this.#until = this.now() + expiresIn * 1000 - 30000;
  }
  disconnect(): void { this.#token = null; this.#until = 0; this.#epoch++; }
  get connected(): boolean { if (!this.#token || this.now() >= this.#until) { this.disconnect(); return false; } return true; }
  private lease(): number { this.guard(); if (!this.#token || this.now() >= this.#until) { this.disconnect(); return fail('auth'); } return this.#epoch; }
  private check(epoch: number, signal?: AbortSignal | null): void {
    if (signal?.aborted) return fail('cancelled');
    if (this.lease() !== epoch) return fail('auth');
  }
  private async request(url: string, init: RequestInit, epoch: number, allowed: number[] = []): Promise<Response> {
    this.check(epoch, init.signal);
    let r: Response;
    const controller = new AbortController(), abort = () => controller.abort();
    if (init.signal?.aborted) abort();
    init.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 30000);
    // fetch natif est une API Window/Worker : ne pas lui donner l'instance Drive comme this.
    const fetcher = this.fetcher;
    try { r = await fetcher(url, { ...init, signal: controller.signal, redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { ...init.headers, Authorization: 'Bearer ' + this.#token } }); }
    catch { return fail(init.signal?.aborted ? 'cancelled' : 'unavailable'); }
    finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); }
    this.check(epoch, init.signal); // Une réponse de l'ancien compte n'appartient pas à la nouvelle session.
    if (r.ok || allowed.includes(r.status)) return r;
    if (r.status === 401) { this.disconnect(); return fail('auth'); }
    if (r.status === 404) return fail('missing');
    if (r.status === 409) return fail('conflict');
    if (r.status === 403) {
      let quota = false;
      try { const e = await this.json(r, init.signal ?? undefined); quota = JSON.stringify(e).includes('storageQuotaExceeded'); } catch { /* refus générique */ }
      if (quota) return fail('quota');
    }
    return fail('unavailable');
  }
  private async bytes(r: Response, max: number, signal?: AbortSignal): Promise<Uint8Array> {
    const announced = r.headers.get('Content-Length');
    if (announced !== null && (!/^\d+$/.test(announced) || Number(announced) > max)) {
      void r.body?.cancel().catch(() => {}); return fail('integrity');
    }
    const reader = r.body?.getReader(); if (!reader) return fail('incomplete');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort: (() => void) | undefined;
        const part = await Promise.race([reader.read(), new Promise<never>((_, reject) => {
          const stop = (code: 'cancelled' | 'unavailable') => {
            reject(new OpaqueDriveError(code)); void reader.cancel().catch(() => {});
          };
          abort = () => stop('cancelled');
          if (signal?.aborted) { abort(); return; }
          signal?.addEventListener('abort', abort, { once: true });
          timer = setTimeout(() => stop('unavailable'), 30000);
        })]).finally(() => { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); });
        if (part.done) break;
        size += part.value.length;
        if (size > max) { void reader.cancel().catch(() => {}); return fail('integrity'); }
        chunks.push(part.value);
      }
    } catch (e) { if (e instanceof OpaqueDriveError) throw e; return fail('unavailable'); }
    if (signal?.aborted) return fail('cancelled');
    // fetch peut décompresser le corps ; Content-Length décrit alors les octets
    // encodés et Content-Encoding peut être masqué par CORS. La borne porte sur
    // les octets réellement lus, puis le paquet est vérifié contre sa taille/hash.
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return bytes;
  }
  private async json(r: Response, signal?: AbortSignal): Promise<Record<string, unknown>> {
    try {
      const v: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await this.bytes(r, 1024 * 1024, signal)));
      if (!object(v)) return fail('incomplete'); return v;
    } catch (e) { if (e instanceof OpaqueDriveError) throw e; return fail('incomplete'); }
  }
  async reserveId(signal?: AbortSignal): Promise<string> {
    const epoch = this.lease(), v = await this.json(await this.request(API + '/files/generateIds?count=1&space=drive&type=files', { signal }, epoch), signal);
    this.check(epoch, signal);
    if (!Array.isArray(v.ids) || v.ids.length !== 1 || typeof v.ids[0] !== 'string') return fail('incomplete');
    return id(v.ids[0]); // L'appelant conserve cet identifiant avant tout envoi/réessai.
  }
  async account(signal?: AbortSignal): Promise<string> {
    const epoch = this.lease();
    const value = await this.json(await this.request(API + '/about?fields=user(permissionId)', { signal }, epoch), signal);
    this.check(epoch, signal);
    if (!object(value.user) || typeof value.user.permissionId !== 'string') return fail('incomplete');
    return id(value.user.permissionId);
  }
  async identity(signal?: AbortSignal): Promise<{ id: string; label: string }> {
    const epoch = this.lease();
    const value = await this.json(await this.request(API + '/about?fields=user(permissionId,emailAddress)', { signal }, epoch), signal);
    this.check(epoch, signal);
    if (!object(value.user) || typeof value.user.permissionId !== 'string' || typeof value.user.emailAddress !== 'string' ||
      value.user.emailAddress.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(value.user.emailAddress)) return fail('incomplete');
    return Object.freeze({ id: id(value.user.permissionId), label: value.user.emailAddress }); // mémoire/UI seulement
  }
  async folder(folder: string, signal?: AbortSignal): Promise<void> {
    id(folder); const epoch = this.lease();
    const p = await this.json(await this.request(API + '/files/' + folder + '?fields=id,mimeType,trashed,ownedByMe,appProperties,capabilities(canAddChildren)', { signal }, epoch), signal);
    this.check(epoch, signal);
    if (p.id !== folder || p.trashed !== false || p.ownedByMe !== true || p.mimeType !== 'application/vnd.google-apps.folder' ||
      !object(p.appProperties) || p.appProperties.cv_contract !== 'rc-folder-v1' ||
      !object(p.capabilities) || p.capabilities.canAddChildren !== true) return fail('conflict');
  }
  // Only folders already visible to this OAuth application and bearing its
  // private contract. This never grants access to an arbitrary Drive folder.
  async folders(signal?: AbortSignal): Promise<DedicatedFolder[]> {
    const epoch = this.lease(), out: DedicatedFolder[] = [], pages = new Set<string>(), ids = new Set<string>();
    let next = '', count = 0;
    do {
      if (++count > 10) return fail('incomplete');
      const params = new URLSearchParams({
        q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'me' in owners and appProperties has { key='cv_contract' and value='rc-folder-v1' }",
        spaces: 'drive', pageSize: '100',
        fields: 'nextPageToken,incompleteSearch,files(id,name,createdTime,mimeType,trashed,ownedByMe,appProperties,capabilities(canAddChildren))',
      });
      if (next) params.set('pageToken', next);
      const page = await this.json(await this.request(API + '/files?' + params, { signal }, epoch), signal);
      this.check(epoch, signal);
      if ((page.incompleteSearch !== undefined && page.incompleteSearch !== false) || !Array.isArray(page.files) || page.files.length > 100) return fail('incomplete');
      for (const f of page.files) {
        if (!object(f) || typeof f.id !== 'string' || typeof f.name !== 'string' || !f.name || f.name.length > 1024 ||
          typeof f.createdTime !== 'string' || f.createdTime.length > 40 || !Number.isFinite(Date.parse(f.createdTime)) ||
          f.mimeType !== 'application/vnd.google-apps.folder' || f.trashed !== false || f.ownedByMe !== true ||
          !object(f.appProperties) || f.appProperties.cv_contract !== 'rc-folder-v1' ||
          !object(f.capabilities) || f.capabilities.canAddChildren !== true) return fail('conflict');
        const folder = id(f.id);
        if (ids.has(folder) || out.length >= 1000) return fail('incomplete');
        ids.add(folder); out.push(Object.freeze({ id: folder, name: f.name, createdTime: f.createdTime }));
      }
      if (page.nextPageToken === undefined) next = '';
      else if (typeof page.nextPageToken !== 'string' || !page.nextPageToken || page.nextPageToken.length > 4096 || pages.has(page.nextPageToken)) return fail('incomplete');
      else { next = page.nextPageToken; pages.add(next); }
    } while (next);
    this.check(epoch, signal);
    return out.sort((a, b) => b.createdTime.localeCompare(a.createdTime) || a.id.localeCompare(b.id));
  }
  async createFolder(fileId: string, signal?: AbortSignal): Promise<string> {
    id(fileId); const epoch = this.lease();
    // Réserver l'ID avant l'appel ; une réponse perdue est relue, jamais remplacée.
    try { await this.folder(fileId, signal); this.check(epoch, signal); return fileId; }
    catch (e) { if (!(e instanceof OpaqueDriveError) || e.code !== 'missing') throw e; }
    const metadata = { id: fileId, name: 'Control Vault — sauvegardes chiffrées', mimeType: 'application/vnd.google-apps.folder',
      appProperties: { cv_contract: 'rc-folder-v1' } };
    await this.request(API + '/files?fields=id', { method: 'POST', signal, headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(metadata) }, epoch, [409]);
    await this.folder(fileId, signal); this.check(epoch, signal); return fileId;
  }
  // Descripteur A1 public : jamais un code, une clé ou un profil métier. Son
  // contrôle GCM et sa dérivation restent exclusivement dans Race Control.
  private profileBytes(bytes: Uint8Array): void {
    if (!(bytes instanceof Uint8Array) || bytes.length > 2048) return fail('integrity');
    let p: Record<string, unknown>;
    try { p = strictOpaqueJson(bytes) as Record<string, unknown>; } catch { return fail('integrity'); }
    const keys = ['format', 'schemaVersion', 'keyId', 'createdAt', 'kdf', 'it', 's', 'check'];
    const base64 = (value: unknown, size: number) => {
      try { if (typeof value !== 'string') return false; const raw = atob(value); return raw.length === size && btoa(raw) === value; } catch { return false; }
    };
    if (!object(p) || Object.keys(p).length !== keys.length || keys.some(k => !(k in p)) ||
      p.format !== 'race-control-sync-key' || p.schemaVersion !== 1 || typeof p.keyId !== 'string' || !/^[0-9a-f]{32}$/.test(p.keyId) ||
      p.kdf !== 'PBKDF2-SHA256' || p.it !== 600000 || typeof p.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p.createdAt) ||
      !Number.isFinite(Date.parse(p.createdAt)) || new Date(p.createdAt).toISOString() !== p.createdAt || !base64(p.s, 16) || !object(p.check) ||
      Object.keys(p.check).sort().join() !== 'c,i' || !base64(p.check.i, 12) || !base64(p.check.c, 46)) return fail('integrity');
  }
  async profiles(folder: string, signal?: AbortSignal): Promise<SyncProfile[]> {
    id(folder); const epoch = this.lease(); await this.folder(folder, signal); this.check(epoch, signal);
    const out: SyncProfile[] = [], seen = new Set<string>(); let next = '';
    do {
      const params = new URLSearchParams({ q: `'${folder}' in parents and trashed = false and appProperties has { key='cv_contract' and value='rc-key-a1' }`,
        pageSize: '1000', fields: 'nextPageToken,incompleteSearch,files(id,size,trashed,parents,appProperties)' });
      if (next) params.set('pageToken', next);
      const page = await this.json(await this.request(API + '/files?' + params, { signal }, epoch), signal);
      if ((page.incompleteSearch !== undefined && page.incompleteSearch !== false) || !Array.isArray(page.files)) return fail('incomplete');
      for (const f of page.files) {
        if (!object(f) || typeof f.id !== 'string' || f.trashed === true || !Array.isArray(f.parents) || !f.parents.includes(folder) ||
          !object(f.appProperties) || f.appProperties.cv_contract !== 'rc-key-a1' || !hash(f.appProperties.cv_file) ||
          typeof f.size !== 'string' || !/^[1-9][0-9]*$/.test(f.size) || Number(f.size) > 2048) return fail('incomplete');
        const fileId = id(f.id), bytes = await this.bytes(await this.request(API + '/files/' + fileId + '?alt=media', { signal }, epoch), 2048, signal);
        this.profileBytes(bytes);
        if (bytes.length !== Number(f.size) || await this.digest(bytes) !== f.appProperties.cv_file || out.some(p => p.fileId === fileId)) return fail('integrity');
        out.push({ fileId, sha256: f.appProperties.cv_file, bytes });
      }
      if (page.nextPageToken === undefined) next = '';
      else if (typeof page.nextPageToken !== 'string' || !page.nextPageToken || page.nextPageToken.length > 4096 || seen.has(page.nextPageToken)) return fail('incomplete');
      else { next = page.nextPageToken; seen.add(next); }
    } while (next);
    this.check(epoch, signal); return out;
  }
  private async digest(bytes: Uint8Array): Promise<string> {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async uploadProfile(fileId: string, folder: string, input: Uint8Array, signal?: AbortSignal): Promise<SyncProfile> {
    id(fileId); id(folder); const bytes = input.slice(); this.profileBytes(bytes);
    const epoch = this.lease(), sha256 = await this.digest(bytes);
    await this.folder(folder, signal); this.check(epoch, signal);
    const verify = async () => {
      const meta = await this.json(await this.request(API + '/files/' + fileId + '?fields=id,size,trashed,parents,appProperties', { signal }, epoch), signal);
      if (meta.id !== fileId || meta.trashed === true || !Array.isArray(meta.parents) || !meta.parents.includes(folder) ||
        !object(meta.appProperties) || meta.appProperties.cv_contract !== 'rc-key-a1' || meta.appProperties.cv_file !== sha256 || meta.size !== String(bytes.length)) return fail('integrity');
      const back = await this.bytes(await this.request(API + '/files/' + fileId + '?alt=media', { signal }, epoch), 2048, signal);
      if (await this.digest(back) !== sha256) return fail('integrity');
      this.check(epoch, signal); return { fileId, sha256, bytes: back };
    };
    try { return await verify(); } catch (e) { if (!(e instanceof OpaqueDriveError) || e.code !== 'missing') throw e; }
    const boundary = 'rc_key_' + sha256;
    const metadata = { id: fileId, name: 'rc-sync-key-' + sha256 + '.json', mimeType: 'application/json', parents: [folder], appProperties: { cv_contract: 'rc-key-a1', cv_file: sha256 } };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${new TextDecoder().decode(bytes)}\r\n--${boundary}--`;
    await this.request(UPLOAD + '?uploadType=multipart&fields=id', { method: 'POST', signal, headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body }, epoch, [409]);
    return verify(); // Identifiant conservé par l'appelant AVANT cet appel.
  }
  private version(v: unknown): RemotePacket {
    if (!object(v) || typeof v.id !== 'string' || !object(v.appProperties)) return fail('incomplete');
    const p = v.appProperties, size = typeof v.size === 'string' && /^\d+$/.test(v.size) ? Number(v.size) : NaN;
    if (p.cv_contract !== 'rc-v1' || !hash(p.cv_file) || !hash(p.cv_cipher) || !Number.isSafeInteger(size) || size < 1 || size > PACKET_LIMITS.file || v.trashed === true)
      return fail('incomplete');
    let revision: SyncRevision | undefined;
    try { revision = syncRevisionFromProperties(p); } catch { return fail('incomplete'); }
    return Object.freeze({ fileId: id(v.id), fileSha256: p.cv_file, cipherSha256: p.cv_cipher, size, state: 'unverified',
      ...(revision ? { revision } : {}) });
  }
  async list(folder: string, signal?: AbortSignal): Promise<RemotePacket[]> {
    id(folder); const epoch = this.lease(); await this.folder(folder, signal); this.check(epoch, signal);
    const versions = new Map<string, RemotePacket>(), tokens = new Set<string>(); let next = '';
    do {
      const p = new URLSearchParams({ q: `'${folder}' in parents and trashed = false and appProperties has { key='cv_contract' and value='rc-v1' }`,
        pageSize: '1000', fields: 'nextPageToken,incompleteSearch,files(id,size,trashed,parents,appProperties)' });
      if (next) p.set('pageToken', next);
      const page = await this.json(await this.request(API + '/files?' + p, { signal }, epoch), signal);
      if ((page.incompleteSearch !== undefined && page.incompleteSearch !== false) || !Array.isArray(page.files)) return fail('incomplete');
      for (const raw of page.files) {
        if (!object(raw) || !Array.isArray(raw.parents) || !raw.parents.includes(folder)) return fail('conflict');
        const v = this.version(raw), old = versions.get(v.fileId);
        if (old && JSON.stringify(old) !== JSON.stringify(v)) return fail('conflict');
        versions.set(v.fileId, v);
      }
      if (page.nextPageToken === undefined) next = '';
      else if (typeof page.nextPageToken !== 'string' || !page.nextPageToken || page.nextPageToken.length > 4096 || tokens.has(page.nextPageToken)) return fail('incomplete');
      else { next = page.nextPageToken; tokens.add(next); }
    } while (next);
    this.check(epoch, signal); return [...versions.values()]; // Catalogue seulement, jamais une preuve d'intégrité.
  }
  private async verified(expected: RemotePacket, epoch: number, folder?: string, signal?: AbortSignal): Promise<{ packet: RacePacket; proof: ByteProof }> {
    // Figer la référence avant le premier await : aucune mutation de l'appelant ne peut changer la comparaison.
    try { expected = Object.freeze({ ...expected, ...(expected.revision !== undefined ? { revision: readSyncRevision(expected.revision) } : {}) }); }
    catch { return fail('integrity'); }
    id(expected.fileId);
    const meta = await this.json(await this.request(API + '/files/' + expected.fileId + '?fields=id,size,trashed,appProperties,parents', { signal }, epoch), signal);
    const remote = this.version(meta);
    if (remote.fileId !== expected.fileId || remote.fileSha256 !== expected.fileSha256 || remote.cipherSha256 !== expected.cipherSha256 || remote.size !== expected.size ||
      !sameSyncRevision(remote.revision, expected.revision) ||
      folder !== undefined && (!Array.isArray(meta.parents) || !meta.parents.includes(folder))) return fail('integrity');
    const r = await this.request(API + '/files/' + expected.fileId + '?alt=media', { signal }, epoch);
    const bytes = await this.bytes(r, Math.min(PACKET_LIMITS.file, expected.size), signal);
    let packet: RacePacket;
    try { packet = await readRacePacket(bytes, expected.fileSha256); } catch { return fail('integrity'); }
    if (packet.info.cipherSha256 !== expected.cipherSha256 || packet.info.size !== expected.size) return fail('integrity');
    this.check(epoch, signal);
    return { packet, proof: Object.freeze({ ...remote, verifiedAt: this.now(), state: 'verified-bytes' }) };
  }
  async download(expected: RemotePacket, signal?: AbortSignal, folder?: string) {
    // Le contrôle du dossier est lui-même asynchrone : figer aussi AVANT lui.
    try { expected = Object.freeze({ ...expected, ...(expected.revision !== undefined ? { revision: readSyncRevision(expected.revision) } : {}) }); }
    catch { return fail('integrity'); }
    const epoch = this.lease(); if (folder !== undefined) { await this.folder(folder, signal); this.check(epoch, signal); }
    return this.verified(expected, epoch, folder, signal);
  }
  async upload(fileId: string, folder: string, input: RacePacket, signal?: AbortSignal, progress: (sent: number, total: number) => void = () => {}) {
    return this.uploadPacket(fileId, folder, input, undefined, signal, progress);
  }
  async uploadRevision(fileId: string, folder: string, input: RacePacket, revision: SyncRevision, signal?: AbortSignal,
    progress: (sent: number, total: number) => void = () => {}) {
    let checked: SyncRevision;
    try { checked = readSyncRevision(revision); } catch { return fail('conflict'); }
    return this.uploadPacket(fileId, folder, input, checked, signal, progress);
  }
  private async uploadPacket(fileId: string, folder: string, input: RacePacket, revision: SyncRevision | undefined, signal: AbortSignal | undefined,
    progress: (sent: number, total: number) => void) {
    id(fileId); id(folder);
    const packet = await readRacePacket(input.copyBytes(), input.info.fileSha256), epoch = this.lease();
    await this.folder(folder, signal); this.check(epoch, signal);
    const expected: RemotePacket = { fileId, fileSha256: packet.info.fileSha256, cipherSha256: packet.info.cipherSha256, size: packet.info.size,
      state: 'unverified', ...(revision ? { revision } : {}) };
    // Réessai après perte de la dernière réponse : relire la copie existante, jamais l'écraser.
    try { return await this.verified(expected, epoch, folder, signal); }
    catch (e) { if (!(e instanceof OpaqueDriveError) || e.code !== 'missing') throw e; }
    const meta = { id: fileId, name: 'rc-' + expected.fileSha256 + '.json', mimeType: 'application/json', parents: [folder],
      appProperties: { cv_contract: 'rc-v1', cv_file: expected.fileSha256, cv_cipher: expected.cipherSha256,
        ...(revision ? syncRevisionProperties(revision) : {}) } };
    const start = await this.request(UPLOAD + '?uploadType=resumable&fields=id', { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json', 'X-Upload-Content-Length': String(expected.size) }, body: JSON.stringify(meta) }, epoch, [409]);
    if (start.status === 409) return this.verified(expected, epoch, folder, signal);
    const location = start.headers.get('Location');
    let session: URL; try { session = new URL(location ?? ''); } catch { return fail('incomplete'); }
    if (session.origin !== 'https://www.googleapis.com' || session.pathname !== '/upload/drive/v3/files' || session.hash || session.username || session.password ||
      session.searchParams.get('uploadType') !== 'resumable' || !session.searchParams.get('upload_id') || session.searchParams.has('access_token')) return fail('integrity');
    const bytes = packet.copyBytes(), chunkSize = 1024 * 1024;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, bytes.length), chunk = bytes.slice(offset, end);
      const r = await this.request(session.href, { method: 'PUT', signal, headers: { 'Content-Type': 'application/json',
        'Content-Range': `bytes ${offset}-${end - 1}/${bytes.length}` }, body: chunk.buffer }, epoch, [308]);
      if (r.status === 308) { if (end === bytes.length || r.headers.get('Range') !== 'bytes=0-' + (end - 1)) return fail('incomplete'); }
      else if (end !== bytes.length || (await this.json(r, signal)).id !== fileId) return fail('incomplete');
      progress(end, bytes.length);
    }
    return this.verified(expected, epoch, folder, signal); // Toujours les octets, jamais le checksum déclaré.
  }
}
