import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { OpaqueDrive, DRIVE_FILE_SCOPE } from '../../src/services/opaque-drive';
import { readRacePacket } from '../../src/core/race-packet';
import { packetFixture } from '../fixtures/race-packet';
import { syncRevisionProperties } from '../../src/core/sync-revision';
let fixture: Awaited<ReturnType<typeof packetFixture>>;
beforeAll(async () => { fixture = await packetFixture(); });
beforeEach(() => vi.stubGlobal('location', { origin: 'https://vault.fixture.test' }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const json = (v: unknown, status = 200, headers = {}) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const folder = 'fixture-folder', fileId = 'fixture-file';
function backend() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const files = new Map<string, { meta: any; bytes: Uint8Array }>();
  const pending = new Map<string, { meta: any; chunks: Uint8Array[] }>();
  let corrupt = false, loseReply = false, evilLocation = false;
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    const u = new URL(url), key = u.pathname.split('/').at(-1)!;
    if (u.pathname.endsWith('/generateIds')) return json({ ids: [fileId] });
    if (u.pathname === '/upload/drive/v3/files' && init.method === 'POST') {
      const meta = JSON.parse(String(init.body));
      if (files.has(meta.id)) return json({}, 409);
      pending.set(meta.id, { meta, chunks: [] });
      return new Response(null, { status: 200, headers: { Location: evilLocation ? 'https://other.fixture.test/upload' : `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${meta.id}` } });
    }
    if (init.method === 'PUT') {
      const id = u.searchParams.get('upload_id')!, p = pending.get(id)!;
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(new Headers(init.headers).get('Content-Range')!)!;
      p.chunks.push(new Uint8Array(init.body as ArrayBuffer));
      if (Number(range[2]) + 1 < Number(range[3])) return new Response(null, { status: 308, headers: { Range: 'bytes=0-' + range[2] } });
      const out = new Uint8Array(Number(range[3])); let offset = 0;
      for (const c of p.chunks) { out.set(c, offset); offset += c.length; }
      files.set(id, { meta: { ...p.meta, size: String(out.length), trashed: false }, bytes: out }); pending.delete(id);
      if (loseReply) throw new TypeError('Panne fictive après écriture');
      return json({ id });
    }
    if (key === folder) return json({ id: folder, mimeType: 'application/vnd.google-apps.folder', trashed: false, ownedByMe: true, appProperties: { cv_contract: 'rc-folder-v1' }, capabilities: { canAddChildren: true } });
    if (u.pathname === '/drive/v3/files') return json({ incompleteSearch: false, files: [...files.values()].map(f => f.meta) });
    const file = files.get(key); if (!file) return json({}, 404);
    if (u.searchParams.get('alt') === 'media') {
      const bytes = file.bytes.slice(); if (corrupt) bytes[0] ^= 1;
      return new Response(bytes.buffer, { headers: { 'Content-Length': String(bytes.length) } });
    }
    return json(file.meta);
  });
  return { calls, files, pending, fetcher, corrupt: () => { corrupt = true; }, loseReply: () => { loseReply = true; }, evilLocation: () => { evilLocation = true; } };
}
function client(fetcher: typeof fetch, now = () => Date.now()) {
  const drive = new OpaqueDrive(['https://vault.fixture.test'], fetcher, now);
  drive.connect('fixture-token', 3600, [DRIVE_FILE_SCOPE]); return drive;
}
describe('fournisseur opaque, réseau entièrement fictif', () => {
  it('refuse les origines partagées/non autorisées avant tout token ou réseau', () => {
    const network = vi.fn<typeof fetch>();
    for (const origin of ['https://ipoower.github.io', 'http://vault.fixture.test', 'https://other.fixture.test']) {
      vi.stubGlobal('location', { origin });
      expect(() => new OpaqueDrive([origin === 'https://ipoower.github.io' ? origin : 'https://vault.fixture.test'], network)).toThrow('origin');
    }
    expect(network).not.toHaveBeenCalled();
  });
  it('réserve un identifiant, crée une nouvelle copie et retélécharge toujours les octets', async () => {
    const b = backend(), drive = client(b.fetcher), packet = await readRacePacket(fixture.bytes);
    expect(await drive.reserveId()).toBe(fileId);
    const { proof, packet: copy } = await drive.upload(fileId, folder, packet);
    expect(copy.copyBytes()).toEqual(fixture.bytes); expect(proof.state).toBe('verified-bytes');
    expect(proof.fileSha256).toBe(fixture.hash);
    expect(b.calls.some(c => new URL(c.url).searchParams.get('alt') === 'media')).toBe(true);
    expect(b.calls.every(c => !c.url.includes('fixture-token') && c.init.redirect === 'error')).toBe(true);
    expect(b.calls.every(c => c.init.cache === 'no-store' && c.init.credentials === 'omit' && c.init.referrerPolicy === 'no-referrer')).toBe(true);
    expect(b.calls.every(c => new Headers(c.init.headers).get('Authorization') === 'Bearer fixture-token')).toBe(true);
    expect(b.files.size).toBe(1);
  });
  it('appelle fetch sans lui imposer un receveur étranger à Window/Worker', async () => {
    const network: typeof fetch = async function (this: unknown) {
      if (this !== undefined) throw new TypeError('Receveur incompatible');
      return json({ ids: [fileId] });
    };
    await expect(client(network).reserveId()).resolves.toBe(fileId);
  });
  it('ne remplace pas une ancienne version lors d’un réessai après perte de réponse', async () => {
    const b = backend(), drive = client(b.fetcher), packet = await readRacePacket(fixture.bytes); b.loseReply();
    await expect(drive.upload(fileId, folder, packet)).rejects.toMatchObject({ code: 'unavailable' });
    const created = b.files.get(fileId)!.bytes.slice();
    const { proof } = await drive.upload(fileId, folder, packet);
    expect(proof.state).toBe('verified-bytes'); expect(b.files.get(fileId)!.bytes).toEqual(created);
    expect(b.calls.filter(c => c.init.method === 'POST')).toHaveLength(1);
  });
  it('transporte toutes les révisions concurrentes sans choisir une tête ni réencoder les paquets', async () => {
    const b = backend(), drive = client(b.fetcher), packet = await readRacePacket(fixture.bytes);
    const revisions = [
      { id: 'a'.repeat(32), device: 'd'.repeat(32), parents: [], seq: 1 },
      { id: 'b'.repeat(32), device: 'd'.repeat(32), parents: ['a'.repeat(32)], seq: 2 },
      { id: 'c'.repeat(32), device: 'e'.repeat(32), parents: ['a'.repeat(32)], seq: 1 },
    ];
    for (const [i, revision] of revisions.entries()) {
      const key = 'revision-' + i, result = await drive.uploadRevision(key, folder, packet, revision);
      expect(result.proof.revision).toEqual(revision); expect(result.proof.state).toBe('verified-bytes');
      expect(result.packet.copyBytes()).toEqual(fixture.bytes);
      expect(b.files.get(key)!.meta.appProperties).toMatchObject(syncRevisionProperties(revision));
    }
    const versions = await drive.list(folder);
    expect(versions.map(v => v.revision)).toEqual(revisions);
    expect(versions.every(v => v.state === 'unverified')).toBe(true);
    expect(b.files.size).toBe(3); expect(b.calls.some(c => ['PATCH', 'DELETE'].includes(c.init.method ?? ''))).toBe(false);
  });
  it('refuse une révision modifiée ou retirée même lorsque tous les octets et empreintes restent identiques', async () => {
    const b = backend(), drive = client(b.fetcher), packet = await readRacePacket(fixture.bytes);
    const revision = { id: 'a'.repeat(32), device: 'd'.repeat(32), parents: ['0'.repeat(32)], seq: 2 };
    await drive.uploadRevision(fileId, folder, packet, revision);
    const [expected] = await drive.list(folder), stored = b.files.get(fileId)!, original = structuredClone(stored.meta.appProperties);
    for (const change of [{ rcr: 'b'.repeat(32) }, { rcd: 'e'.repeat(32) }, { rcs: '3' }, { rcp0: '1'.repeat(32) }]) {
      stored.meta.appProperties = { ...original, ...change };
      await expect(drive.download(expected)).rejects.toMatchObject({ code: 'integrity' });
    }
    stored.meta.appProperties = { cv_contract: original.cv_contract, cv_file: original.cv_file, cv_cipher: original.cv_cipher };
    await expect(drive.download(expected)).rejects.toMatchObject({ code: 'integrity' });
    expect(stored.bytes).toEqual(fixture.bytes); expect(b.files.size).toBe(1);
  });
  it('refuse une collision de révision sur le même fichier sans modifier la copie existante', async () => {
    const b = backend(), drive = client(b.fetcher), packet = await readRacePacket(fixture.bytes);
    const revision = { id: 'a'.repeat(32), device: 'd'.repeat(32), parents: [], seq: 1 };
    await drive.uploadRevision(fileId, folder, packet, revision);
    await expect(drive.uploadRevision(fileId, folder, packet, { ...revision, seq: 2 })).rejects.toMatchObject({ code: 'integrity' });
    expect(b.calls.filter(c => c.init.method === 'POST')).toHaveLength(1);
    expect(b.files.get(fileId)!.meta.appProperties.rcs).toBe('1');
  });
  it('reprend la même copie A2 après perte de réponse, sans nouvel envoi ni perte des parents', async () => {
    const b = backend(), drive = client(b.fetcher), packet = await readRacePacket(fixture.bytes); b.loseReply();
    const revision = { id: 'a'.repeat(32), device: 'd'.repeat(32), parents: ['0'.repeat(32)], seq: 2 };
    await expect(drive.uploadRevision(fileId, folder, packet, revision)).rejects.toMatchObject({ code: 'unavailable' });
    const result = await drive.uploadRevision(fileId, folder, packet, revision);
    expect(result.proof.revision).toEqual(revision); expect(b.files.size).toBe(1);
    expect(b.calls.filter(c => c.init.method === 'POST')).toHaveLength(1);
  });
  it('fige les métadonnées avant l’attente et refuse les révisions invalides avant réseau', async () => {
    const b = backend(), drive = client(b.fetcher), packet = await readRacePacket(fixture.bytes);
    const revision = { id: 'a'.repeat(32), device: 'd'.repeat(32), parents: ['0'.repeat(32)], seq: 2 };
    const pending = drive.uploadRevision(fileId, folder, packet, revision);
    revision.seq = 999; revision.parents.length = 0;
    expect((await pending).proof.revision).toEqual({ ...revision, seq: 2, parents: ['0'.repeat(32)] });
    const network = vi.fn<typeof fetch>(), other = client(network);
    await expect(other.uploadRevision(fileId, folder, packet, { ...revision, seq: 0 })).rejects.toMatchObject({ code: 'conflict' });
    await expect(other.download({ fileId, fileSha256: fixture.hash, cipherSha256: fixture.envelope.sha256, size: fixture.bytes.length,
      state: 'unverified', revision: null as any })).rejects.toMatchObject({ code: 'integrity' });
    expect(network).not.toHaveBeenCalled();
  });
  it('une révision partielle bloque le catalogue et une révision ajoutée ne convertit pas une référence manuelle', async () => {
    const b = backend(), drive = client(b.fetcher), packet = await readRacePacket(fixture.bytes);
    await drive.upload(fileId, folder, packet);
    const [manual] = await drive.list(folder), stored = b.files.get(fileId)!;
    expect(manual.revision).toBeUndefined();
    stored.meta.appProperties.rcr = 'a'.repeat(32);
    await expect(drive.list(folder)).rejects.toMatchObject({ code: 'incomplete' });
    Object.assign(stored.meta.appProperties, syncRevisionProperties({ id: 'a'.repeat(32), device: 'd'.repeat(32), parents: [], seq: 1 }));
    await expect(drive.download(manual)).rejects.toMatchObject({ code: 'integrity' });
    expect(stored.bytes).toEqual(fixture.bytes);
  });
  it('une référence changée pendant le téléchargement ne peut légitimer les métadonnées distantes modifiées', async () => {
    const b = backend(), drive = client(b.fetcher), packet = await readRacePacket(fixture.bytes);
    const revision = { id: 'a'.repeat(32), device: 'd'.repeat(32), parents: [], seq: 1 };
    await drive.uploadRevision(fileId, folder, packet, revision);
    const expected = { ...structuredClone((await drive.list(folder))[0]) };
    b.files.get(fileId)!.meta.appProperties.rcs = '2';
    const other = client(async (...args) => {
      const response = await b.fetcher(...args);
      expected.revision = { ...revision, seq: 2 }; // mutation pendant la première réponse
      return response;
    });
    await expect(other.download(expected)).rejects.toMatchObject({ code: 'integrity' });
    expect(b.files.get(fileId)!.bytes).toEqual(fixture.bytes);
  });
  it('refuse une collision d’identifiant avec une copie plus ancienne, sans écrasement', async () => {
    const b = backend(), drive = client(b.fetcher), a = await readRacePacket(fixture.bytes);
    await drive.upload(fileId, folder, a);
    const altered = new TextEncoder().encode(JSON.stringify({ ...fixture.envelope, createdAt: '2026-10-20T10:00:00.000Z' }));
    await expect(drive.upload(fileId, folder, await readRacePacket(altered))).rejects.toMatchObject({ code: 'integrity' });
    expect(b.files.get(fileId)!.bytes).toEqual(fixture.bytes);
  });
  it('un checksum déclaré cohérent ne masque pas des octets corrompus', async () => {
    const b = backend(), drive = client(b.fetcher), packet = await readRacePacket(fixture.bytes); b.corrupt();
    await expect(drive.upload(fileId, folder, packet)).rejects.toMatchObject({ code: 'integrity' });
  });
  it('aucun JSON en clair ou faux paquet ne démarre un upload', async () => {
    const b = backend(), drive = client(b.fetcher);
    const forged = { info: { fileSha256: fixture.hash }, copyBytes: () => new TextEncoder().encode('{"clear":"fixture"}') };
    await expect(drive.upload(fileId, folder, forged as any)).rejects.toThrow();
    expect(b.calls).toHaveLength(0);
    await expect(drive.reserveId()).resolves.toBe(fileId);
    await expect(drive.upload('bad\n', folder, await readRacePacket(fixture.bytes))).rejects.toMatchObject({ code: 'conflict' });
  });
  it('l’URL de session ne permet pas d’envoyer un jeton vers une autre origine', async () => {
    const b = backend(), drive = client(b.fetcher); b.evilLocation();
    await expect(drive.upload(fileId, folder, await readRacePacket(fixture.bytes))).rejects.toMatchObject({ code: 'integrity' });
    expect(b.calls.every(c => new URL(c.url).origin === 'https://www.googleapis.com')).toBe(true);
  });
  it('envoie les gros paquets par morceaux et vérifie chaque accusé de réception', async () => {
    const e = structuredClone(fixture.envelope), cipher = Buffer.alloc(900000, 42);
    e.payload.c = cipher.toString('base64');
    e.sha256 = (await import('node:crypto')).createHash('sha256').update(cipher).digest('hex');
    const packet = await readRacePacket(new TextEncoder().encode(JSON.stringify(e))), b = backend(), drive = client(b.fetcher);
    const progress: number[] = []; await drive.upload(fileId, folder, packet, undefined, sent => progress.push(sent));
    expect(b.calls.filter(c => c.init.method === 'PUT')).toHaveLength(2);
    expect(progress.at(-1)).toBe(packet.info.size);
  });
  it('les jetons expirent et ne sont jamais sérialisés ni renouvelés automatiquement', async () => {
    let now = 100000; const b = backend(), drive = client(b.fetcher, () => now);
    drive.connect('fixture-token', 60, [DRIVE_FILE_SCOPE]); now += 31000;
    await expect(drive.reserveId()).rejects.toMatchObject({ code: 'auth' }); expect(b.calls).toHaveLength(0);
    expect(JSON.stringify(drive)).not.toContain('fixture-token');
    expect(() => drive.connect('fixture-token', 7200, [DRIVE_FILE_SCOPE])).toThrow('auth');
    expect(() => drive.connect('x' + '='.repeat(8192), 60, [DRIVE_FILE_SCOPE])).toThrow('auth');
    expect(() => drive.connect('fixture-token', 60, ['https://www.googleapis.com/auth/drive'])).toThrow('auth');
  });
  it('déconnexion pendant une requête : la réponse tardive ne produit pas de preuve', async () => {
    const b = backend(); let drive: OpaqueDrive;
    const wrapped: typeof fetch = async (...args) => { const response = await b.fetcher(...args); drive.disconnect(); return response; };
    drive = client(wrapped);
    await expect(drive.reserveId()).rejects.toMatchObject({ code: 'auth' });
  });
  it('un changement de compte pendant la lecture du corps invalide la réponse', async () => {
    let drive: OpaqueDrive;
    const network: typeof fetch = async () => new Response(new ReadableStream({
      start(controller) {
        drive.connect('new-fixture-token', 3600, [DRIVE_FILE_SCOPE]);
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ ids: [fileId] }))); controller.close();
      },
    }));
    drive = client(network);
    await expect(drive.reserveId()).rejects.toMatchObject({ code: 'auth' });
  });
  it('un ancien 401 ne déconnecte pas le nouveau compte', async () => {
    let drive: OpaqueDrive, first = true;
    const network: typeof fetch = async () => {
      if (first) { first = false; drive.connect('new-fixture-token', 3600, [DRIVE_FILE_SCOPE]); return json({}, 401); }
      return json({ ids: [fileId] });
    };
    drive = client(network);
    await expect(drive.reserveId()).rejects.toMatchObject({ code: 'auth' });
    await expect(drive.reserveId()).resolves.toBe(fileId);
  });
  it('annulation après les en-têtes et corps bloqué ne donnent pas un faux succès', async () => {
    const controller = new AbortController(); let opened!: () => void;
    const started = new Promise<void>(resolve => { opened = resolve; });
    const drive = client(async () => new Response(new ReadableStream({ start() { opened(); } })));
    const pending = drive.reserveId(controller.signal);
    await started; controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('borne les réponses sans Content-Length et refuse une réponse tronquée', async () => {
    for (const response of [
      new Response('x'.repeat(1024 * 1024 + 1)),
      new Response('{"ids":["truncated', { headers: { 'Content-Length': '10000' } }),
    ]) {
      await expect(client(async () => response).reserveId()).rejects.toBeInstanceOf(Error);
    }
  });
  it('une réponse décompressée par fetch est bornée sur ses octets décodés', async () => {
    // CORS peut masquer Content-Encoding ; la longueur HTTP reste celle du corps compressé.
    const response = new Response(JSON.stringify({ ids: [fileId] }), { headers: { 'Content-Length': '12' } });
    await expect(client(async () => response).reserveId()).resolves.toBe(fileId);
  });
  it('expire aussi pendant une vérification et borne l’attente du corps', async () => {
    let now = 100000;
    const expired = client(async () => { now += 40000; return json({ ids: [fileId] }); }, () => now);
    expired.connect('fixture-token', 60, [DRIVE_FILE_SCOPE]);
    await expect(expired.reserveId()).rejects.toMatchObject({ code: 'auth' });
    vi.useFakeTimers();
    const stalled = client(async () => new Response(new ReadableStream()));
    const pending = expect(stalled.reserveId()).rejects.toMatchObject({ code: 'unavailable' });
    await vi.advanceTimersByTimeAsync(30001); await pending;
  });
  it('un accusé de réception partiel empêche la confirmation', async () => {
    const b = backend();
    const network: typeof fetch = async (...args) => {
      const response = await b.fetcher(...args);
      return args[1]?.method === 'PUT' ? new Response(null, { status: 308, headers: { Range: 'bytes=0-1' } }) : response;
    };
    const drive = client(network);
    await expect(drive.upload(fileId, folder, await readRacePacket(fixture.bytes))).rejects.toMatchObject({ code: 'incomplete' });
    expect(b.files.get(fileId)!.bytes).toEqual(fixture.bytes); // copie récupérable, mais pas encore vérifiée
  });
  it('401, quota et annulation restent des échecs explicites', async () => {
    for (const [response, code] of [[json({}, 401), 'auth'], [json({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, 403), 'quota']] as const) {
      const drive = client(vi.fn<typeof fetch>(async () => response));
      await expect(drive.reserveId()).rejects.toMatchObject({ code });
    }
    const aborted = new AbortController(); aborted.abort();
    const drive = client(async (_input, init) => { if (init?.signal?.aborted) throw new DOMException('Annulé', 'AbortError'); return json({}); });
    await expect(drive.reserveId(aborted.signal)).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('énumère toutes les pages, en gardant les versions non vérifiées', async () => {
    const meta = (n: number) => ({ id: 'fixture-' + n, parents: [folder], size: String(fixture.bytes.length), appProperties: { cv_contract: 'rc-v1', cv_file: fixture.hash, cv_cipher: fixture.envelope.sha256 } });
    const calls: string[] = [];
    const drive = client(async input => { if(new URL(String(input)).pathname.endsWith('/'+folder)) return json({id:folder,mimeType:'application/vnd.google-apps.folder',trashed:false,ownedByMe:true,appProperties:{cv_contract:'rc-folder-v1'},capabilities:{canAddChildren:true}}); calls.push(String(input)); return json({ incompleteSearch: false, files: Array.from({ length: 100 }, (_, i) => meta(i + (calls.length - 1) * 100)), ...(calls.length === 1 ? { nextPageToken: 'next-fixture' } : {}) }); });
    const list = await drive.list(folder); expect(list).toHaveLength(200); expect(list.every(v => v.state === 'unverified')).toBe(true);
    expect(new URL(calls[1]).searchParams.get('pageToken')).toBe('next-fixture');
  });
  it('recherche incomplète et boucle de pagination ne donnent jamais un catalogue complet', async () => {
    for (const page of [{ incompleteSearch: true, files: [] }, { incompleteSearch: false, files: [], nextPageToken: 'again' }]) {
      const drive = client(async input => new URL(String(input)).pathname.endsWith('/'+folder) ? json({id:folder,mimeType:'application/vnd.google-apps.folder',trashed:false,ownedByMe:true,appProperties:{cv_contract:'rc-folder-v1'},capabilities:{canAddChildren:true}}) : json(page)); await expect(drive.list(folder)).rejects.toMatchObject({ code: 'incomplete' });
    }
  });
});
