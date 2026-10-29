// Parcours réel séparé du stockage de démonstration et des imports JSON métier.
// Seuls readRacePacket + ses octets opaques atteignent ce fournisseur.
import { readRacePacket, type RacePacket } from '../core/race-packet';
import { DriveStore } from './drive-store.js';
import { GoogleDriveSession, type DriveConfig, type DriveSession } from './google-drive-session.js';
import { OpaqueArchive } from './opaque-archive';
import { OpaqueDrive, type RemotePacket, type ByteProof, type DedicatedFolder } from './opaque-drive';

interface Job { binding: string; bytes: Uint8Array; fileId: string | null; sha: string }
interface Durable { v: 1; job: Job | null; receipts: ByteProof[] }
// Ne jamais sérialiser un Uint8Array pouvant atteindre 68 Mio en deux chaînes
// JSON géantes pour confirmer qu'un téléchargement n'a pas changé l'envoi.
function sameJob(a: Job | null, b: Job | null): boolean {
  if (a === null || b === null) return a === b;
  return !!a && !!b && Object.keys(a).length === 4 && Object.keys(b).length === 4 &&
    a.binding === b.binding && a.fileId === b.fileId && a.sha === b.sha &&
    a.bytes instanceof Uint8Array && b.bytes instanceof Uint8Array && a.bytes.length === b.bytes.length &&
    a.bytes.every((value, i) => value === b.bytes[i]);
}
export interface ConnectedState { configured: boolean; prepared: boolean; connected: boolean; selected: boolean; busy: boolean; message: string;
  dedicatedFolders: DedicatedFolder[];
  versions: RemotePacket[]; receipts: ByteProof[]; recoveryOrigin: string | null; account: string | null; accountConfirmed: boolean; folder: string | null;
  phase: 'WAITING' | 'SENDING' | 'UPLOADED' | 'VERIFIED_BYTES' | 'CONFLICT' | 'SYNC_BLOCKED' | 'ERROR'; pending: boolean; lastOperationAt: number | null }
export class ConnectedDrive {
  private provider: OpaqueDrive | null = null;
  private session: DriveSession | null = null;
  private config: DriveConfig | null = null;
  private selection: { folder: string; binding: string } | null = null;
  private archive = new OpaqueArchive();
  private durable = DriveStore.create<Durable>('cv-drive-outbox-v1');
  private listeners = new Set<() => void>();
  private epoch = 0;
  state: ConnectedState = { configured: false, prepared: false, connected: false, selected: false, busy: false,
    message: 'Connexion réelle non activée sur cette version.', dedicatedFolders: [], versions: [], receipts: [], recoveryOrigin: null, account: null, accountConfirmed: false, folder: null, phase: 'WAITING', pending: false, lastOperationAt: null };
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private change(patch: Partial<ConnectedState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  async init() {
    if (location.protocol !== 'https:' || /(^|\.)github\.io$/.test(location.hostname)) return;
    try {
      this.config = await GoogleDriveSession.load();
      if (location.origin !== this.config.vaultOrigin) return;
      this.provider = new OpaqueDrive([this.config.vaultOrigin]); this.session = GoogleDriveSession.create(this.config, this.provider);
      const checkSession = () => { if (this.state.connected && !this.session?.connected) { this.disconnect(); this.change({ phase: 'SYNC_BLOCKED', message: 'Autorisation Google expirée ou révoquée : reconnecte et confirme le compte dédié.' }); } };
      setInterval(checkSession, 30000); window.addEventListener('focus', checkSession); document.addEventListener('visibilitychange', checkSession);
      this.change({ configured: true, recoveryOrigin: this.config.raceOrigin, message: 'Prêt à connecter Google Drive. Aucun code Race Control ne sera demandé ici.' });
    } catch { /* absence de configuration = aucun OAuth ni transfert */ }
  }
  private async action(work: (epoch: number) => Promise<void>) {
    if (this.state.busy) return;
    const epoch = this.epoch; this.change({ busy: true });
    try { await work(epoch); }
    catch (e) {
      const code = (e as { code?: string }).code;
      if (epoch !== this.epoch) return;
      this.change({ connected: this.session?.connected === true, phase: code === 'conflict' ? 'CONFLICT' : ['auth','binding','integrity','conflict','confirmation','quota','missing','incomplete','unavailable','origin'].includes(code || '') ? 'SYNC_BLOCKED' : 'ERROR', lastOperationAt: Date.now(),
        message: code === 'conflict' ? 'Conflit de destination ou de métadonnées : opération bloquée, copies conservées. Vérifie les révisions dans Race Control.' : code === 'integrity' ? 'Intégrité non confirmée : synchronisation bloquée, copie locale conservée.' : code === 'auth' ? 'Session Google expirée : reconnecte-toi pour reprendre.' : code === 'binding' ? 'Cet envoi attend le compte et le dossier utilisés à sa préparation.' : code === 'quota' ? 'Espace Google Drive insuffisant. Copie locale conservée.' : 'Opération non confirmée. Aucune copie distante n’a été supprimée ni remplacée.' });
    } finally { if (epoch === this.epoch) this.change({ busy: false }); }
  }
  async prepare() { return this.action(async epoch => { await this.session?.prepare(); if (epoch !== this.epoch) return; this.change({ prepared: true, message: 'Connexion prête. Appuie sur Se connecter à Google.' }); }); }
  // Conserver le geste utilisateur : ouvrir Google avant tout await.
  connect() {
    if (!this.session || this.state.busy) return Promise.resolve();
    this.epoch++; this.selection = null; this.change({ selected: false, account: null, accountConfirmed: false, folder: null, dedicatedFolders: [], versions: [], receipts: [], phase: 'WAITING' });
    const promise = this.session.connect();
    return this.action(async epoch => { await promise; this.check(epoch); this.change({ connected: true, account: this.session?.identity?.label || null, accountConfirmed: false, message: 'Compte affiché : confirme explicitement ce compte dédié avant tout accès aux fichiers.' }); });
  }
  confirmAccount() {
    if (!this.session?.identity || this.state.busy) return;
    try { this.session.confirmAccount(this.session.identity.id); this.change({ accountConfirmed: true, message: 'Compte confirmé. Crée un dossier neuf dédié ou retrouve les dossiers déjà autorisés pour cette application.' }); }
    catch { this.change({ phase: 'SYNC_BLOCKED', message: 'Confirmation du compte refusée. Reconnecte le compte dédié.' }); }
  }
  newFolder() {
    if (!this.session || this.state.busy || !this.state.accountConfirmed) return Promise.resolve();
    this.epoch++; this.selection = null; this.change({ selected: false, folder: null, versions: [], receipts: [] });
    return this.action(async epoch => { await this.session!.newFolder(); this.check(epoch); this.change({ dedicatedFolders: [], phase: 'WAITING', lastOperationAt: Date.now(), message: 'Dossier neuf dédié créé et relu. Retrouve les dossiers dédiés pour le sélectionner.' }); });
  }
  async listDedicatedFolders() {
    if (!this.session || this.state.busy || !this.state.accountConfirmed) return;
    this.change({ dedicatedFolders: [] });
    return this.action(async epoch => {
      const folders = await this.session!.listDedicatedFolders(); this.check(epoch);
      this.change({ dedicatedFolders: folders, message: folders.length ? 'Dossiers dédiés retrouvés. Choisis explicitement celui à utiliser.' : 'Aucun dossier dédié autorisé trouvé. Crée un dossier neuf, puis actualise cette liste.' });
    });
  }
  chooseDedicatedFolder(id: string) {
    if (!this.session || this.state.busy || !this.state.accountConfirmed) return Promise.resolve();
    this.epoch++; this.selection = null; this.change({ selected: false, folder: null, versions: [], receipts: [], phase: 'WAITING' });
    return this.action(async epoch => {
      const selection = await this.session!.chooseDedicatedFolder(id); this.check(epoch); this.selection = selection;
      this.change({ selected: true, folder: selection.folder, versions: [], receipts: [], lastOperationAt: Date.now(), message: 'Dossier dédié relu et sélectionné. Actualise les versions pour les lire.' });
    });
  }
  chooseFolder() {
    if (!this.session || this.state.busy) return Promise.resolve();
    if (!this.state.accountConfirmed) return Promise.resolve();
    this.epoch++; this.selection = null; this.change({ selected: false, folder: null, versions: [], receipts: [], phase: 'WAITING' });
    const promise = this.session.chooseFolder();
    return this.action(async epoch => { const selection = await promise; this.check(epoch); this.selection = selection; this.change({ selected: true, folder: selection.folder, versions: [], receipts: [], lastOperationAt: Date.now(), message: 'Dossier sélectionné. Actualise les versions pour les lire.' }); });
  }
  disconnect() {
    this.epoch++; this.session?.disconnect(); this.selection = null;
    this.change({ busy: false, connected: false, selected: false, account: null, accountConfirmed: false, folder: null, dedicatedFolders: [], phase: 'WAITING', versions: [], receipts: [], message: 'Déconnecté. Les fichiers et les envois en attente sont conservés.' });
  }
  private check(epoch: number) { if (this.epoch !== epoch || !this.session?.connected) throw Object.assign(new Error('auth'), { code: 'auth' }); }
  private selected() { if (!this.provider || !this.selection) throw new Error('Dossier requis'); return { provider: this.provider, ...this.selection }; }
  private async locked(work: () => Promise<void>) {
    if (!navigator.locks) throw new Error('Navigateur à mettre à jour');
    await navigator.locks.request('cv-drive-outbox-v1', work);
  }
  async refresh() {
    return this.action(async epoch => {
      const { provider, folder } = this.selected(); const versions = await provider.list(folder); this.check(epoch);
      const saved = await this.durable.read(); this.check(epoch);
      // Les anciens reçus restent des preuves d'octets datées, pas une preuve
      // que la copie existe encore ni qu'elle est authentique/lue par RC.
      this.change({ versions, pending: !!saved?.job, receipts: (saved?.receipts || []).filter(p => versions.some(v => v.fileId === p.fileId && v.fileSha256 === p.fileSha256)), lastOperationAt: Date.now(), message: `${versions.length} copies distantes listées. Leur contenu est encore à vérifier.` });
    });
  }
  private async resumeInside(epoch: number, packet?: RacePacket) {
    const { provider, folder, binding } = this.selected();
    let saved = await this.durable.read() || { v: 1 as const, job: null, receipts: [] };
    this.check(epoch);
    if (saved.v !== 1 || !Array.isArray(saved.receipts)) throw new Error('stockage');
    if (saved.job && (saved.job.binding !== binding || packet && saved.job.sha !== packet.info.fileSha256)) throw Object.assign(new Error('binding'), { code: 'binding' });
    if (!saved.job && packet) {
      // Vérification + copie IDB AVANT toute réservation/envoi réseau.
      await this.archive.save(packet); this.check(epoch);
      saved = { ...saved, job: { binding, bytes: packet.copyBytes(), fileId: null, sha: packet.info.fileSha256 } }; await this.durable.write(saved);
    }
    const job = saved.job; this.change({ pending: !!job }); if (!job) { this.change({ message: 'Aucun envoi en attente.' }); return; }
    const checked = await readRacePacket(job.bytes, job.sha); this.check(epoch);
    if (!job.fileId) { job.fileId = await provider.reserveId(); this.check(epoch); await this.durable.write(saved); }
    this.change({ phase: 'SENDING' });
    const back = await provider.upload(job.fileId, folder, checked, undefined, (sent, total) => { if (epoch === this.epoch) this.change({ phase: sent === total ? 'UPLOADED' : 'SENDING' }); }); this.check(epoch);
    saved.receipts = [...saved.receipts.filter(p => p.fileId !== back.proof.fileId), back.proof]; saved.job = null;
    await this.durable.write(saved); this.check(epoch);
    this.change({ receipts: saved.receipts, pending: false, phase: 'VERIFIED_BYTES', lastOperationAt: Date.now(), message: 'Copie envoyée et octets distants relus à l’identique. Authentification et restauration à effectuer dans Race Control.' });
  }
  async upload(file: File) {
    return this.action(async epoch => {
      if (file.size > 71303168) throw new Error('Fichier trop volumineux');
      const packet = await readRacePacket(new Uint8Array(await file.arrayBuffer())); this.check(epoch);
      await this.locked(() => this.resumeInside(epoch, packet));
    });
  }
  async resume() { return this.action(epoch => this.locked(() => this.resumeInside(epoch))); }
  async download(ref: RemotePacket): Promise<Uint8Array | null> {
    let bytes: Uint8Array | null = null;
    await this.action(async epoch => {
      const { provider, folder } = this.selected(); const back = await provider.download(ref, undefined, folder); this.check(epoch);
      await this.archive.save(back.packet); this.check(epoch);
      // The archive and its transport receipt are separate guarantees. Serialize the
      // receipt read/modify/write with uploads under the existing outbox lock.
      let receipts: ByteProof[] = [];
      await this.locked(async () => {
        const previous = await this.durable.read() || { v: 1 as const, job: null, receipts: [] };
        this.check(epoch);
        if (previous.v !== 1 || !Array.isArray(previous.receipts)) throw new Error('stockage');
        const updated: Durable = {
          ...previous,
          receipts: [...previous.receipts.filter(p => p.fileId !== back.proof.fileId), back.proof]
        };
        await this.durable.write(updated); this.check(epoch);
        const confirmed = await this.durable.read(); this.check(epoch);
        const sameProof = (p: ByteProof) => p.fileId === back.proof.fileId &&
          p.fileSha256 === back.proof.fileSha256 && p.cipherSha256 === back.proof.cipherSha256 &&
          p.size === back.proof.size && p.verifiedAt === back.proof.verifiedAt;
        if (!confirmed || confirmed.v !== 1 || !Array.isArray(confirmed.receipts) ||
            !confirmed.receipts.some(sameProof) || !sameJob(confirmed.job, previous.job))
          throw new Error('stockage');
        receipts = confirmed.receipts;
      });
      bytes = back.packet.copyBytes();
      this.change({ phase: 'VERIFIED_BYTES', lastOperationAt: Date.now(), receipts, message: 'Octets vérifiés et copie chiffrée gardée sur cet appareil. Ouvre ce fichier dans Race Control pour le déchiffrer.' });
    });
    return bytes;
  }
}
export const connectedDrive = new ConnectedDrive();
