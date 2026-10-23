// Parcours réel séparé du stockage de démonstration et des imports JSON métier.
// Seuls readRacePacket + ses octets opaques atteignent ce fournisseur.
import { readRacePacket, type RacePacket } from '../core/race-packet';
import { DriveStore } from './drive-store.js';
import { GoogleDriveSession, type DriveConfig, type DriveSession } from './google-drive-session.js';
import { OpaqueArchive } from './opaque-archive';
import { OpaqueDrive, type RemotePacket, type ByteProof } from './opaque-drive';

interface Job { binding: string; bytes: Uint8Array; fileId: string | null; sha: string }
interface Durable { v: 1; job: Job | null; receipts: ByteProof[] }
export interface ConnectedState { configured: boolean; prepared: boolean; connected: boolean; selected: boolean; busy: boolean; message: string;
  versions: RemotePacket[]; receipts: ByteProof[]; recoveryOrigin: string | null }
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
    message: 'Connexion réelle non activée sur cette version.', versions: [], receipts: [], recoveryOrigin: null };
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private change(patch: Partial<ConnectedState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  async init() {
    if (location.protocol !== 'https:' || /(^|\.)github\.io$/.test(location.hostname)) return;
    try {
      this.config = await GoogleDriveSession.load();
      if (location.origin !== this.config.vaultOrigin) return;
      this.provider = new OpaqueDrive([this.config.vaultOrigin]); this.session = GoogleDriveSession.create(this.config, this.provider);
      this.change({ configured: true, recoveryOrigin: this.config.raceOrigin, message: 'Prêt à connecter Google Drive. Aucun code Race Control ne sera demandé ici.' });
    } catch { /* absence de configuration = aucun OAuth ni transfert */ }
  }
  private async action(work: (epoch: number) => Promise<void>) {
    if (this.state.busy) return;
    const epoch = this.epoch; this.change({ busy: true });
    try { await work(epoch); }
    catch (e) {
      const code = (e as { code?: string }).code;
      this.change({ connected: this.session?.connected === true,
        message: code === 'auth' ? 'Session Google expirée : reconnecte-toi pour reprendre.' : code === 'binding' ? 'Cet envoi attend le compte et le dossier utilisés à sa préparation.' : code === 'quota' ? 'Espace Google Drive insuffisant. Copie locale conservée.' : 'Opération non confirmée. Aucune copie distante n’a été supprimée ni remplacée.' });
    } finally { this.change({ busy: false }); }
  }
  async prepare() { return this.action(async () => { await this.session?.prepare(); this.change({ prepared: true, message: 'Connexion prête. Appuie sur Se connecter à Google.' }); }); }
  // Conserver le geste utilisateur : ouvrir Google avant tout await.
  connect() {
    if (!this.session || this.state.busy) return Promise.resolve();
    this.epoch++; this.selection = null; this.change({ selected: false, versions: [], receipts: [] });
    const promise = this.session.connect();
    return this.action(async epoch => { await promise; this.check(epoch); this.change({ connected: true, message: 'Connecté. Choisis le dossier de Race Control dans Google Drive.' }); });
  }
  chooseFolder() {
    if (!this.session || this.state.busy) return Promise.resolve();
    const promise = this.session.chooseFolder();
    return this.action(async epoch => { const selection = await promise; this.check(epoch); this.selection = selection; this.change({ selected: true, versions: [], receipts: [], message: 'Dossier sélectionné. Actualise les versions pour les lire.' }); });
  }
  disconnect() {
    this.epoch++; this.session?.disconnect(); this.selection = null;
    this.change({ connected: false, selected: false, versions: [], receipts: [], message: 'Déconnecté. Les fichiers et les envois en attente sont conservés.' });
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
      this.change({ versions, receipts: saved?.receipts || [], message: `${versions.length} copies distantes listées. Leur contenu est encore à vérifier.` });
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
    const job = saved.job; if (!job) { this.change({ message: 'Aucun envoi en attente.' }); return; }
    const checked = await readRacePacket(job.bytes, job.sha); this.check(epoch);
    if (!job.fileId) { job.fileId = await provider.reserveId(); this.check(epoch); await this.durable.write(saved); }
    const back = await provider.upload(job.fileId, folder, checked); this.check(epoch);
    saved.receipts = [...saved.receipts.filter(p => p.fileId !== back.proof.fileId), back.proof]; saved.job = null;
    await this.durable.write(saved); this.check(epoch);
    this.change({ receipts: saved.receipts, message: 'Copie envoyée et octets distants relus à l’identique. Authentification et restauration à effectuer dans Race Control.' });
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
      const { provider } = this.selected(); const back = await provider.download(ref); this.check(epoch);
      await this.archive.save(back.packet); this.check(epoch);
      bytes = back.packet.copyBytes();
      this.change({ receipts: [...this.state.receipts.filter(p => p.fileId !== ref.fileId), back.proof], message: 'Octets vérifiés et copie chiffrée gardée sur cet appareil. Ouvre ce fichier dans Race Control pour le déchiffrer.' });
    });
    return bytes;
  }
}
export const connectedDrive = new ConnectedDrive();
