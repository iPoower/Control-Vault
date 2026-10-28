import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpaqueDrive, DRIVE_FILE_SCOPE } from '../../src/services/opaque-drive';
import { GoogleDriveSession } from '../../src/services/google-drive-session.js';
import { webcrypto } from 'node:crypto';
import { packetFixture } from '../fixtures/race-packet';

const origin = 'https://vault.example.com';
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => vi.stubGlobal('location', { origin }));
afterEach(() => vi.unstubAllGlobals());
const client = (fetcher: typeof fetch) => { const p = new OpaqueDrive([origin], fetcher); p.connect('fixture-token', 3600, [DRIVE_FILE_SCOPE]); return p; };

describe('compte et destination : frontière réelle du fournisseur, réseau fictif', () => {
  it('refuse un dossier personnel accessible en écriture mais non créé comme dossier dédié par cette application', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ id: 'personal-folder', mimeType: 'application/vnd.google-apps.folder',
      trashed: false, ownedByMe: true, capabilities: { canAddChildren: true } }));
    await expect(client(fetcher).folder('personal-folder')).rejects.toMatchObject({ code: 'conflict' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).not.toContain('alt=media');
  });

  it('refuse un fichier déplacé hors de la destination avant de lire ses octets, même si son hash est correct', async () => {
    const fixture = await packetFixture(); let media = 0;
    const meta = { id: 'archive-file', parents: ['other-folder'], trashed: false, size: String(fixture.bytes.length),
      appProperties: { cv_contract: 'rc-v1', cv_file: fixture.hash, cv_cipher: fixture.envelope.sha256 } };
    const fetcher = vi.fn<typeof fetch>(async input => {
      const u = new URL(String(input));
      if (u.pathname.endsWith('/allowed-folder')) return json({ id: 'allowed-folder', mimeType: 'application/vnd.google-apps.folder',
        trashed: false, ownedByMe: true, appProperties: { cv_contract: 'rc-folder-v1' }, capabilities: { canAddChildren: true } });
      if (u.searchParams.get('alt') === 'media') { media++; return new Response(fixture.bytes as BodyInit); }
      return json(meta);
    });
    const ref = { fileId: meta.id, fileSha256: fixture.hash, cipherSha256: fixture.envelope.sha256, size: fixture.bytes.length, state: 'unverified' as const };
    await expect((client(fetcher).download as any)(ref, undefined, 'allowed-folder')).rejects.toMatchObject({ code: 'integrity' });
    expect(media).toBe(0);
  });
});


const scope = DRIVE_FILE_SCOPE;
const config = { approved: true as const, clientId: ['123456','fake.apps.googleusercontent.com'].join('-'), apiKey: 'AIza'+'a'.repeat(35), appId: '123456', raceOrigin: 'https://race.example.com', vaultOrigin: origin };
function sessionFixture() {
  const clients: any[] = [], callbacks: any[] = [];
  class View { setIncludeFolders(){return this;} setSelectFolderEnabled(){return this;} }
  class Picker {
    addView(){return this;} setOAuthToken(){return this;} setDeveloperKey(){return this;} setAppId(){return this;} setOrigin(){return this;}
    setCallback(cb: any){callbacks.push(cb);return this;} build(){return this;} setVisible(){}
  }
  const provider = { connect: vi.fn(), disconnect: vi.fn(), identity: vi.fn(async()=>({id:'fixture-account',label:'backup-fixture@example.invalid'})),
    account: vi.fn(async()=>'fixture-account'), folder: vi.fn(async()=>{}), reserveId: vi.fn(async()=>'reserved-folder'), createFolder: vi.fn(async(id: string)=>id) };
  const host = { location:{origin}, crypto:webcrypto, gapi:{load:(_: string,o: any)=>o.callback()}, google:{accounts:{oauth2:{
    initTokenClient:(o: any)=>{clients.push(o);return {requestAccessToken:(arg: any)=>expect(arg.prompt).toBe('select_account')};},hasGrantedAllScopes:()=>true}},
    picker:{DocsView:View,PickerBuilder:Picker,ViewId:{FOLDERS:'folders'},Action:{PICKED:'picked',CANCEL:'cancel'}}}};
  const session = (GoogleDriveSession.create as any)(config,provider,host);
  const connect = async()=>{await session.prepare();const done=session.connect();await clients.at(-1).callback({access_token:'fixture-token',scope,expires_in:3600});await done;};
  return {session,provider,clients,callbacks,connect};
}

describe('consentement et réponses tardives GIS/Picker, aucun vrai compte',()=>{
  it('impose la confirmation du compte affiché avant toute sélection ou création de dossier',async()=>{
    const f=sessionFixture();await f.connect();expect(f.session.identity.label).toBe('backup-fixture@example.invalid');
    await expect(f.session.chooseFolder()).rejects.toMatchObject({code:'confirmation'});
    await expect(f.session.newFolder()).rejects.toMatchObject({code:'confirmation'});
    expect(()=>f.session.confirmAccount('other-account')).toThrow('confirmation');
    expect(f.provider.folder).not.toHaveBeenCalled();expect(f.provider.reserveId).not.toHaveBeenCalled();
    f.session.confirmAccount('fixture-account');expect(f.session.confirmed).toBe(true);
    const p=f.session.chooseFolder();await f.callbacks.at(-1)({action:'picked',docs:[{id:'dedicated-folder'}]});
    expect((await p).folder).toBe('dedicated-folder');expect(f.provider.folder).toHaveBeenCalledWith('dedicated-folder');
    f.session.disconnect();expect(f.session.identity).toBeNull();
  });
  it('bloque un compte différent avant toute lecture de dossier ou réservation',async()=>{
    const f=sessionFixture();await f.connect();f.session.confirmAccount('fixture-account');f.provider.account.mockResolvedValue('other-account');
    const p=f.session.chooseFolder();const rejected=expect(p).rejects.toMatchObject({code:'auth'});
    await f.callbacks.at(-1)({action:'picked',docs:[{id:'dedicated-folder'}]});await rejected;
    await expect(f.session.newFolder()).rejects.toMatchObject({code:'auth'});
    expect(f.provider.folder).not.toHaveBeenCalled();expect(f.provider.reserveId).not.toHaveBeenCalled();
  });
  it('ignore le callback Picker de la session antérieure sans annuler le nouveau choix',async()=>{
    const f=sessionFixture();await f.connect();f.session.confirmAccount('fixture-account');
    const old=f.session.chooseFolder().catch((e: any)=>e.code), stale=f.callbacks.at(-1);f.session.disconnect();expect(await old).toBe('cancelled');
    await f.connect();f.session.confirmAccount('fixture-account');const current=f.session.chooseFolder();
    await stale({action:'picked',docs:[{id:'old-folder'}]});expect(f.provider.folder).not.toHaveBeenCalled();
    await f.callbacks.at(-1)({action:'picked',docs:[{id:'new-folder'}]});expect((await current).folder).toBe('new-folder');
  });
  it('réutilise le même identifiant de dossier après une réponse perdue',async()=>{
    const f=sessionFixture();await f.connect();f.session.confirmAccount('fixture-account');
    f.provider.createFolder.mockRejectedValueOnce(Object.assign(Error('unavailable'),{code:'unavailable'}));
    await expect(f.session.newFolder()).rejects.toMatchObject({code:'unavailable'});expect(await f.session.newFolder()).toBe('reserved-folder');
    expect(f.provider.reserveId).toHaveBeenCalledTimes(1);expect(f.provider.createFolder.mock.calls.map(c=>c[0])).toEqual(['reserved-folder','reserved-folder']);
  });
});

describe('relecture du dossier réservé et révocation',()=>{
  it('retrouve le dossier créé malgré une réponse POST perdue, sans nouvelle création',async()=>{
    let exists=false, posts=0;
    const fetcher=vi.fn<typeof fetch>(async(_url,init)=>{
      if(init?.method==='POST'){posts++;exists=true;throw Error('response lost');}
      return exists?json({id:'reserved-folder',mimeType:'application/vnd.google-apps.folder',trashed:false,ownedByMe:true,
        appProperties:{cv_contract:'rc-folder-v1'},capabilities:{canAddChildren:true}}):json({},404);
    });
    const provider=client(fetcher);
    await expect(provider.createFolder('reserved-folder')).rejects.toMatchObject({code:'unavailable'});
    expect(await provider.createFolder('reserved-folder')).toBe('reserved-folder');expect(posts).toBe(1);
  });
  it('ne réactive pas un jeton révoqué pour changer de destination',async()=>{
    const f=sessionFixture();await f.connect();f.session.confirmAccount('fixture-account');
    Object.defineProperty(f.provider,'connected',{get:()=>false});
    await expect(f.session.newFolder()).rejects.toMatchObject({code:'auth'});
    expect(f.session.connected).toBe(false);expect(f.session.identity).toBeNull();expect(f.provider.reserveId).not.toHaveBeenCalled();
  });
});

describe('référence du téléchargement figée avant le contrôle du dossier',()=>{
  it('ne suit pas une référence modifiée pendant la relecture asynchrone du dossier',async()=>{
    const fixture=await packetFixture();let release!:()=>void;const held=new Promise<void>(r=>release=r);
    const fetcher=vi.fn<typeof fetch>(async input=>{
      const u=new URL(String(input)),fileId=u.pathname.split('/').at(-1)!;
      if(fileId==='dedicated-folder'){await held;return json({id:fileId,mimeType:'application/vnd.google-apps.folder',trashed:false,ownedByMe:true,appProperties:{cv_contract:'rc-folder-v1'},capabilities:{canAddChildren:true}});}
      if(u.searchParams.get('alt')==='media')return new Response(fixture.bytes as BodyInit);
      return json({id:fileId,parents:['dedicated-folder'],size:String(fixture.bytes.length),appProperties:{cv_contract:'rc-v1',cv_file:fixture.hash,cv_cipher:fixture.envelope.sha256}});
    });
    const ref={fileId:'expected-archive',fileSha256:fixture.hash,cipherSha256:fixture.envelope.sha256,size:fixture.bytes.length,state:'unverified' as const};
    const reading=client(fetcher).download(ref,undefined,'dedicated-folder');ref.fileId='other-archive';release();
    expect((await reading).proof.fileId).toBe('expected-archive');
    expect(fetcher.mock.calls.some(c=>String(c[0]).includes('/other-archive'))).toBe(false);
  });
});


describe('Picker facultatif : API Drive utilisable sans bibliothèque Picker', () => {
  it('autorise OAuth et sélection dédiée quand le chargement Picker échoue', async () => {
    const clients: any[] = [];
    const host = {
      location: { origin }, crypto: webcrypto,
      gapi: { load: (_name: string, callbacks: any) => callbacks.onerror() },
      google: { accounts: { oauth2: {
        initTokenClient: (options: any) => { clients.push(options); return { requestAccessToken: () => {} }; },
        hasGrantedAllScopes: () => true,
      } } },
    };
    const folder = { id: 'folder-fixture', name: 'Dossier fictif', createdTime: '2026-10-28T00:00:00Z' };
    const provider = {
      connect: vi.fn(), disconnect: vi.fn(), identity: vi.fn(async () => ({ id: 'fixture-account', label: 'fixture@example.invalid' })),
      account: vi.fn(async () => 'fixture-account'), folders: vi.fn(async () => [folder]),
      folder: vi.fn(async () => {}),
    };
    const session = (GoogleDriveSession.create as any)(config, provider, host);
    await expect(session.prepare()).resolves.toBeUndefined();
    const pending = session.connect();
    await clients.at(-1).callback({ access_token: 'fixture-token', scope, expires_in: 3600 });
    await pending;
    session.confirmAccount('fixture-account');
    expect(await session.listDedicatedFolders()).toEqual([folder]);
    expect((await session.chooseDedicatedFolder('folder-fixture')).folder).toBe('folder-fixture');
    await expect(session.chooseFolder()).rejects.toMatchObject({ code: 'network' });
    expect(provider.folder).toHaveBeenCalledWith('folder-fixture');
    session.disconnect();
  });
});
