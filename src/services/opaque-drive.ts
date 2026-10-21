// Fournisseur futur, non branché. Uniquement des paquets RC déjà chiffrés.
// Aucun OAuth automatique, token persistant, effacement ou modification de fichier.
import { PACKET_LIMITS, readRacePacket, type RacePacket } from '../core/race-packet';
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
}
export interface ByteProof {
  readonly fileId: string; readonly fileSha256: string; readonly cipherSha256: string;
  readonly size: number; readonly verifiedAt: number; readonly state: 'verified-bytes';
}
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
    if (token.trim() !== token || !/^[A-Za-z0-9._~+\/-]{1,8192}=*$/.test(token) || !Number.isFinite(expiresIn) || expiresIn <= 30 || expiresIn > 3600 ||
      granted.length !== 1 || granted[0] !== DRIVE_FILE_SCOPE) return fail('auth');
    this.#token = token; this.#until = this.now() + expiresIn * 1000 - 30000;
  }
  disconnect(): void { this.#token = null; this.#until = 0; this.#epoch++; }
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
    if (announced !== null && (!/^\d+$/.test(announced) || Number(announced) > max)) return fail('integrity');
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
        if (size > max) { await reader.cancel(); return fail('integrity'); }
        chunks.push(part.value);
      }
    } catch (e) { if (e instanceof OpaqueDriveError) throw e; return fail('unavailable'); }
    if (signal?.aborted) return fail('cancelled');
    if (announced !== null && Number(announced) !== size) return fail('incomplete');
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
  private version(v: unknown): RemotePacket {
    if (!object(v) || typeof v.id !== 'string' || !object(v.appProperties)) return fail('incomplete');
    const p = v.appProperties, size = typeof v.size === 'string' && /^\d+$/.test(v.size) ? Number(v.size) : NaN;
    if (p.cv_contract !== 'rc-v1' || !hash(p.cv_file) || !hash(p.cv_cipher) || !Number.isSafeInteger(size) || size < 1 || size > PACKET_LIMITS.file || v.trashed === true)
      return fail('incomplete');
    return Object.freeze({ fileId: id(v.id), fileSha256: p.cv_file, cipherSha256: p.cv_cipher, size, state: 'unverified' });
  }
  async list(folder: string, signal?: AbortSignal): Promise<RemotePacket[]> {
    id(folder); const epoch = this.lease(), versions = new Map<string, RemotePacket>(), tokens = new Set<string>(); let next = '';
    do {
      const p = new URLSearchParams({ q: `'${folder}' in parents and trashed = false and appProperties has { key='cv_contract' and value='rc-v1' }`,
        pageSize: '1000', fields: 'nextPageToken,incompleteSearch,files(id,size,trashed,appProperties)' });
      if (next) p.set('pageToken', next);
      const page = await this.json(await this.request(API + '/files?' + p, { signal }, epoch), signal);
      if (page.incompleteSearch !== false || !Array.isArray(page.files)) return fail('incomplete');
      for (const raw of page.files) {
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
    id(expected.fileId);
    const meta = await this.json(await this.request(API + '/files/' + expected.fileId + '?fields=id,size,trashed,appProperties,parents', { signal }, epoch), signal);
    const remote = this.version(meta);
    if (remote.fileId !== expected.fileId || remote.fileSha256 !== expected.fileSha256 || remote.cipherSha256 !== expected.cipherSha256 || remote.size !== expected.size ||
      folder !== undefined && (!Array.isArray(meta.parents) || !meta.parents.includes(folder))) return fail('integrity');
    const r = await this.request(API + '/files/' + expected.fileId + '?alt=media', { signal }, epoch);
    const bytes = await this.bytes(r, Math.min(PACKET_LIMITS.file, expected.size), signal);
    let packet: RacePacket;
    try { packet = await readRacePacket(bytes, expected.fileSha256); } catch { return fail('integrity'); }
    if (packet.info.cipherSha256 !== expected.cipherSha256 || packet.info.size !== expected.size) return fail('integrity');
    this.check(epoch, signal);
    return { packet, proof: Object.freeze({ ...remote, verifiedAt: this.now(), state: 'verified-bytes' }) };
  }
  async download(expected: RemotePacket, signal?: AbortSignal) { return this.verified(expected, this.lease(), undefined, signal); }
  async upload(fileId: string, folder: string, input: RacePacket, signal?: AbortSignal, progress: (sent: number, total: number) => void = () => {}) {
    id(fileId); id(folder);
    const packet = await readRacePacket(input.copyBytes(), input.info.fileSha256), epoch = this.lease();
    const expected: RemotePacket = { fileId, fileSha256: packet.info.fileSha256, cipherSha256: packet.info.cipherSha256, size: packet.info.size, state: 'unverified' };
    // Réessai après perte de la dernière réponse : relire la copie existante, jamais l'écraser.
    try { return await this.verified(expected, epoch, folder, signal); }
    catch (e) { if (!(e instanceof OpaqueDriveError) || e.code !== 'missing') throw e; }
    const parent = await this.json(await this.request(API + '/files/' + folder + '?fields=id,mimeType,capabilities(canAddChildren)', { signal }, epoch), signal);
    if (parent.id !== folder || parent.mimeType !== 'application/vnd.google-apps.folder' || !object(parent.capabilities) || parent.capabilities.canAddChildren !== true) return fail('conflict');
    const meta = { id: fileId, name: 'rc-' + expected.fileSha256 + '.json', mimeType: 'application/json', parents: [folder],
      appProperties: { cv_contract: 'rc-v1', cv_file: expected.fileSha256, cv_cipher: expected.cipherSha256 } };
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
