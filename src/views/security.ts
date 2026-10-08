import { FOLDER, reconnectGoogle, ROOT_ID, store } from '../app';
import { formatRelative } from '../core/format';
import { PBKDF2_ITERATIONS } from '../core/crypto';
import type { State } from '../core/store';
import { openVerifyAll } from '../flows/sheets';
import { h, replace } from '../ui/dom';
import { icon } from '../ui/icons';
import { openSheet, setFoot, toast } from '../ui/overlay';
import { pill } from '../ui/parts';
import type { View, ViewContext } from './types';

const row = (ic: string, title: string, sub: string | HTMLElement, end?: HTMLElement | null) =>
  h('div', { class: 'row' }, h('span', { class: 'glyph' }, icon(ic)), h('div', { class: 'row-main' }, h('div', { class: 'row-title wrap' }, title), h('div', { class: 'row-sub wrap' }, sub)), end ?? h('span'));

function revoke() {
  const sheet = openSheet({ title: 'Retirer l’accès à Google Drive ?' });
  sheet.body.append(
    h('p', null, 'Control Vault ne pourra plus lire ni écrire dans Drive. Concrètement :'),
    h(
      'ul',
      { class: 'bullets' },
      h('li', null, 'Aucune sauvegarde ni restauration possible jusqu’à la reconnexion.'),
      h('li', null, 'Tes fichiers dans Drive ne sont ni supprimés ni déplacés.'),
      h('li', null, 'Il faudra de nouveau autoriser les dossiers du coffre.'),
    ),
  );
  setFoot(
    sheet,
    h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Garder l’accès'),
    h(
      'button',
      {
        class: 'btn btn-danger solid',
        type: 'button',
        onclick: () => {
          store.set({ connectivity: { ...store.get().connectivity, google: 'disconnected' } });
          sheet.close();
          toast('Accès Google retiré. Tes fichiers sont intacts.', { kind: 'info', action: { label: 'Reconnecter', run: () => reconnectGoogle() } });
        },
      },
      'Retirer l’accès',
    ),
  );
}

export function securityView(_ctx: ViewContext): View {
  const el = h('div', { class: 'stack-page' });
  const render = (s: State) => {
    const c = s.connectivity;
    const lastVerify = s.events.find((e) => e.type === 'verify');
    const host = location.hostname;
    const sharedOrigin = host.endsWith('github.io');
    const folders = s.catalog.filter((i) => [ROOT_ID, FOLDER['race-control'], FOLDER['reconversion-control'], FOLDER.archives].includes(i.id));

    replace(
      el,
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Sécurité'), h('p', null, 'Ce qui protège tes données, et ce que chaque action implique.'))),

      h(
        'section',
        { class: 'panel', 'aria-labelledby': 'sec-enc' },
        h('div', { class: 'panel-head' }, h('h2', { id: 'sec-enc' }, 'Chiffrement'), pill('verified', 'Actif')),
        h(
          'div',
          { class: 'rows' },
          row('vault', 'Sauvegardes chiffrées sur l’appareil', 'AES-256-GCM, avant tout envoi. Drive ne reçoit que des données illisibles sans ta clé.'),
          row('key', 'Clé de chiffrement', `Démonstration : clé de session éphémère, non exportable. Version réelle : dérivée de ta phrase secrète (PBKDF2-SHA-256, ${new Intl.NumberFormat('fr-FR').format(PBKDF2_ITERATIONS)} itérations), jamais transmise.`),
          row('fingerprint', 'Empreinte de chaque fichier', 'SHA-256 calculée avant l’envoi, comparée à celle de Drive après l’envoi et avant chaque restauration.'),
        ),
      ),

      h(
        'section',
        { class: 'panel', 'aria-labelledby': 'sec-google' },
        h('div', { class: 'panel-head' }, h('h2', { id: 'sec-google' }, 'Connexion Google'), pill(!c.online ? 'unknown' : c.google === 'connected' ? 'verified' : 'failed', !c.online ? 'Non vérifiable' : c.google === 'connected' ? 'Connecté' : c.google === 'expired' ? 'Session expirée' : 'Déconnecté')),
        h(
          'div',
          { class: 'rows' },
          row('user', 'Compte', 'Compte de démonstration'),
          row('shield', 'Permission demandée : drive.file', 'Accès limité aux fichiers créés par Control Vault et aux dossiers que tu lui ouvres via le sélecteur Google. Aucun accès au reste de ton Drive.'),
          h(
            'div',
            { class: 'row no-icon folders' },
            h(
              'div',
              { class: 'row-main', style: 'grid-column: 1 / -1' },
              h('div', { class: 'row-title' }, 'Dossiers autorisés'),
              h('ul', { class: 'folder-grants' }, folders.map((f) => h('li', null, icon('folder'), h('span', null, f.name), pill(c.google === 'connected' ? 'verified' : 'unknown', c.google === 'connected' ? 'Accès accordé' : 'Accès suspendu')))),
            ),
          ),
        ),
        h(
          'div',
          { class: 'panel-body btn-row' },
          c.google === 'connected'
            ? h('button', { class: 'btn btn-danger', type: 'button', onclick: revoke }, 'Retirer l’accès')
            : h('button', { class: 'btn btn-primary', type: 'button', onclick: () => reconnectGoogle() }, 'Se reconnecter'),
        ),
      ),

      h(
        'section',
        { class: 'panel', 'aria-labelledby': 'sec-sessions' },
        h('div', { class: 'panel-head' }, h('h2', { id: 'sec-sessions' }, 'Sessions')),
        h(
          'div',
          { class: 'rows' },
          row('device', 'Cet appareil', `${/iPhone|iPad/.test(navigator.userAgent) ? 'Safari sur iPhone' : /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent) ? 'Safari' : 'Navigateur de bureau'}, session ouverte ${formatRelative(performance.timeOrigin)}`, pill('verified', 'Active')),
          row('key', 'Jetons d’accès', 'Gardés en mémoire uniquement, jamais dans le stockage du navigateur. Fermer l’onglet les efface.'),
        ),
      ),

      h(
        'section',
        { class: 'panel', 'aria-labelledby': 'sec-integrity' },
        h('div', { class: 'panel-head' }, h('h2', { id: 'sec-integrity' }, 'Vérification d’intégrité')),
        h(
          'div',
          { class: 'rows' },
          row('fingerprint', `${s.versions.length} versions enregistrées`, lastVerify ? `Dernier contrôle complet ${formatRelative(lastVerify.at)} : ${lastVerify.result === 'success' ? 'toutes les empreintes correspondaient' : 'des écarts ont été trouvés'}.` : 'Aucun contrôle complet pour l’instant.'),
        ),
        h('div', { class: 'panel-body' }, h('button', { class: 'btn', type: 'button', onclick: openVerifyAll, disabled: !c.online || c.google !== 'connected' || !!s.busy || undefined }, icon('fingerprint'), 'Vérifier toutes les sauvegardes')),
      ),

      h(
        'section',
        { class: 'panel', 'aria-labelledby': 'sec-recovery' },
        h('div', { class: 'panel-head' }, h('h2', { id: 'sec-recovery' }, 'Récupération')),
        h(
          'div',
          { class: 'panel-body' },
          h(
            'div',
            { class: 'callout', dataset: { health: 'stale' } },
            icon('alert'),
            h(
              'div',
              null,
              h('strong', null, 'Sans ta phrase secrète, personne ne peut relire tes sauvegardes — pas même toi.'),
              h('p', null, 'Elle sera créée à l’activation du chiffrement réel (Phase 3), avec une phrase de récupération à noter sur papier. Control Vault ne la conserve nulle part.'),
            ),
          ),
        ),
      ),

      h(
        'section',
        { class: 'panel', 'aria-labelledby': 'sec-host' },
        h('div', { class: 'panel-head' }, h('h2', { id: 'sec-host' }, 'Hébergement')),
        h(
          'div',
          { class: 'rows' },
          row('shield', 'Connexion chiffrée', location.protocol === 'https:' ? 'HTTPS actif.' : 'HTTP local (développement).', pill(location.protocol === 'https:' || host === 'localhost' ? 'verified' : 'failed', location.protocol === 'https:' ? 'HTTPS' : 'Local')),
          row('shield', 'Politique de sécurité du contenu', 'Scripts, styles et polices servis uniquement depuis l’application. Connexions limitées à Google et Supabase.', pill('verified', 'Active')),
          sharedOrigin
            ? row('alert', 'Origine partagée', `${host} est aussi l’adresse de tes autres pages GitHub (dont Race Control). Leur stockage local est commun : avant d’activer la vraie connexion Google, Control Vault doit passer sur une adresse dédiée.`, pill('stale', 'À corriger'))
            : null,
        ),
      ),
    );
  };
  render(store.get());
  return { el, title: 'Sécurité', update: (s) => render(s) };
}
