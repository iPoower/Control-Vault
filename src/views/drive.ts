import { connectedDrive } from '../services/connected-drive';
import { download, h, replace } from '../ui/dom';
import type { View } from './types';

export function driveView(): View {
  const el = h('div', { class: 'stack-page' });
  const render = () => {
    const s = connectedDrive.state;
    const button = (label: string, action: () => unknown, enabled = true) => h('button', { class: 'btn', type: 'button', disabled: !enabled || s.busy, onclick: action }, label);
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Copie chiffrée Race Control', onchange: (event: Event) => {
      const input = event.target as HTMLInputElement, chosen = input.files?.[0]; input.value = ''; if (chosen) void connectedDrive.upload(chosen);
    } });
    replace(el,
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Google Drive'), h('p', null, 'Copies chiffrées de Race Control.'))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-body stack' },
        h('p', { role: 'status', 'aria-live': 'polite' }, s.message),
        h('p', { class: 'muted' }, 'Race Control chiffre et déchiffre sur chaque appareil. Control Vault conserve les fichiers opaques : il ne demande jamais ton code et ne peut pas authentifier leur contenu.'),
        h('p', { class: 'muted' }, 'Choisis le même compte et le même dossier sur le PC et l’iPhone. La synchronisation de Race Control fonctionne aussi lorsque Control Vault est fermé. Les autres écrans restent des démonstrations.'),
        s.account ? h('p', null, 'Compte Google sélectionné : ' + s.account) : null,
        s.folder ? h('p', { class: 'wrap' }, 'Dossier dédié sélectionné : ' + s.folder) : null,
        h('p', null, ({ WAITING: 'En attente', SENDING: 'Envoi en cours', UPLOADED: 'Envoyé — relecture requise', VERIFIED_BYTES: 'Octets distants vérifiés — restauration à valider dans Race Control', CONFLICT: 'Conflit', SYNC_BLOCKED: 'Synchronisation bloquée', ERROR: 'Erreur — action nécessaire' })[s.phase]),
        s.lastOperationAt ? h('p', { class: 'muted' }, 'Dernière opération : ' + new Date(s.lastOperationAt).toLocaleString('fr-FR')) : null,
        s.pending ? h('p', null, 'Un envoi chiffré est conservé en attente sur cet appareil.') : null,
        s.configured ? h('div', { class: 'btn-row' },
          !s.prepared ? button('Préparer la connexion Google', () => connectedDrive.prepare()) : button(s.connected ? 'Changer de compte Google' : 'Se connecter à Google', () => connectedDrive.connect()),
          s.connected && !s.accountConfirmed ? button('Confirmer ce compte dédié', () => connectedDrive.confirmAccount()) : null,
          s.connected && s.accountConfirmed ? button('Créer un dossier neuf dédié', () => connectedDrive.newFolder()) : null,
          s.connected && s.accountConfirmed ? button('Choisir le dossier Google Drive', () => connectedDrive.chooseFolder()) : null,
          s.connected ? h('button', { class: 'btn', type: 'button', onclick: () => connectedDrive.disconnect() }, 'Déconnecter') : null,
        ) : null,
        s.selected ? h('div', { class: 'btn-row' }, button('Actualiser les versions', () => connectedDrive.refresh()),
          button('Envoyer une copie chiffrée', () => file.click()), file,
          button('Reprendre l’envoi en attente', () => connectedDrive.resume())) : null,
      )),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Versions distantes')),
        (() => { const parents = new Set(s.versions.flatMap(v => v.revision?.parents || [])); const heads = s.versions.filter(v => v.revision && !parents.has(v.revision.id)); return heads.length > 1 ? h('p', { role: 'status' }, 'Plusieurs têtes de révision déclarées : conserver les branches et vérifier le conflit dans Race Control. Control Vault ne les authentifie ni ne les fusionne.') : null; })(),
        h('div', { class: 'panel-body' }, s.versions.length ? s.versions.map(ref => {
          const proof = s.receipts.find(p => p.fileId === ref.fileId && p.fileSha256 === ref.fileSha256);
          return h('div', { class: 'row' }, h('div', { class: 'row-main' }, h('p', { class: 'row-title wrap' }, ref.revision ? `Révision ${ref.revision.seq} · ${ref.revision.id.slice(0, 8)}` : 'Copie manuelle'),
            h('p', { class: 'row-sub wrap' }, `${Math.ceil(ref.size / 1024)} Ko · ${ref.fileSha256.slice(0, 12)} · ${proof ? 'octets vérifiés le ' + new Date(proof.verifiedAt).toLocaleString('fr-FR') : 'non vérifiée'}`)),
            button('Vérifier et télécharger', async () => {
              const bytes = await connectedDrive.download(ref);
              if (bytes) download(new Blob([bytes as BlobPart], { type: 'application/json' }), 'race-control-' + ref.fileSha256.slice(0, 12) + '.json');
            }));
        }) : h('p', { class: 'muted' }, 'Aucune liste chargée. Connecte Google et sélectionne le dossier avant d’actualiser.'))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-body' }, h('h2', null, 'Récupération'),
        h('p', null, 'Vérifie et télécharge une version, puis importe ce fichier dans Réglages → Sauvegarde de Race Control. Une empreinte identique prouve les octets reçus ; seul Race Control vérifie le chiffrement et prépare la fusion avec tes données actuelles.'),
        s.recoveryOrigin ? h('a', { class: 'btn', href: s.recoveryOrigin, target: '_blank', rel: 'noopener noreferrer' }, 'Ouvrir Race Control') : null,
        h('p', { class: 'muted small' }, 'Aucune purge automatique. Aucun envoi de JSON personnel en clair. Une session Google expirée exige une reconnexion volontaire.'))),
    );
  };
  const unsubscribe = connectedDrive.subscribe(render); render();
  return { el, title: 'Google Drive', destroy: unsubscribe };
}
