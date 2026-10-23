import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectedDrive } from '../../src/services/connected-drive';
import type { ByteProof, RemotePacket } from '../../src/services/opaque-drive';

const sha = (c: string) => c.repeat(64);
const proof: ByteProof = { fileId:'fixture-packet', fileSha256:sha('a'), cipherSha256:sha('b'), size:3, verifiedAt:1730000000000, state:'verified-bytes' };
const ref: RemotePacket = { fileId:proof.fileId, fileSha256:proof.fileSha256, cipherSha256:proof.cipherSha256, size:proof.size, state:'unverified' };
const bytes = new Uint8Array([42,43,44]);
function storage(seed: { v:1; job:any; receipts:ByteProof[] } = {v:1,job:null,receipts:[]}) {
 let saved = structuredClone(seed);
 let failReadback = false;
 const read = vi.fn(async () => {
   if (failReadback) return structuredClone(seed);
   return structuredClone(saved);
 });
 const write = vi.fn(async (value:typeof saved) => { saved=structuredClone(value); });
 return { read,write, get saved(){return saved;},set failReadback(x:boolean){failReadback=x;} };
}
function setup(store: ReturnType<typeof storage>) {
 const app = new ConnectedDrive();
 const p = {
   download: vi.fn(async () => ({packet:{copyBytes:()=>bytes.slice()},proof})),
   list: vi.fn(async () => [ref])
 };
 const archive={save:vi.fn(async () => {})};
 const internal=app as any;
 internal.provider=p;
 internal.session={connected:true};
 internal.selection={folder:'synthetic-dedicated-folder',binding:'test-binding'};
 internal.archive=archive;
 internal.durable=store;
 return {app,p,archive};
}
beforeEach(()=>{
 vi.stubGlobal('navigator',{locks:{request:async (_name:string,cb:()=>Promise<void>)=>cb()}});
});
afterEach(()=>vi.unstubAllGlobals());

describe('NOESIS-CV-001 — proof of opaque download survives reload',()=>{
 it('archives packet, commits receipt once, and reloads verified receipt without losing a concurrent upload',async()=>{
   const job={binding:'test-binding',bytes:new Uint8Array([1,2]),fileId:'reserved',sha:sha('c')};
   const disk=storage({v:1,job,receipts:[]});
   const {app,p,archive}=setup(disk);
   const ret=await app.download(ref);
   expect(ret).toEqual(bytes);
   expect(archive.save).toHaveBeenCalledOnce();
   expect(disk.saved.job).toEqual(job);
   expect(disk.saved.receipts).toHaveLength(1);
   expect(disk.saved.receipts[0]).toEqual(proof);
   expect(p.download).toHaveBeenCalledTimes(1);
   const fresh=setup(disk).app;
   await fresh.refresh();
   expect(fresh.state.receipts).toEqual([proof]);
 });
 it('redownloading is idempotent and does not create duplicate receipts',async()=>{
   const disk=storage(),{app}=setup(disk);
   await app.download(ref); await app.download(ref);
   expect(disk.saved.receipts).toEqual([proof]);
   expect(disk.write).toHaveBeenCalledTimes(2);
 });
 it('a failed receipt readback cannot return bytes or claim VERIFIED_BYTES',async()=>{
   const disk=storage();
   disk.failReadback=true;
   const {app}=setup(disk);
   const result=await app.download(ref);
   expect(result).toBeNull();
   expect(app.state.phase).toBe('ERROR');
   expect(app.state.message).toMatch(/Opération non confirmée/);
   expect(app.state.receipts).toEqual([]);
   expect(disk.write).toHaveBeenCalledOnce();
 });
 it('provider error retains the original pending upload and its receipts',async()=>{
   const disk=storage({v:1,job:{binding:'test-binding',bytes:new Uint8Array([7]),fileId:null,sha:sha('d')},receipts:[]});
   const {app,p}=setup(disk);
   p.download.mockRejectedValueOnce(new Error('synthetic network fault'));
   expect(await app.download(ref)).toBeNull();
   expect(disk.saved.job).not.toBeNull();
   expect(disk.saved.receipts).toEqual([]);
 });
});
