// Envoi de test réel : un fichier fictif, nouveau, clairement nommé. Rien n'est remplacé ni supprimé.

import { store } from '../app';
import { formatBytes, formatDuration, shortHash } from '../core/format';
import { runTestUpload, TEST_STEPS } from '../drive';
import { h, replace } from '../ui/dom';
import { icon } from '../ui/icons';
import { announce, openSheet, setFoot, toast } from '../ui/overlay';
import { connectGoogle } from '../views/drive-actions';
import { failureSeal, seal, stepList } from './sheets';

export function openTestUpload() {
  const s = store.get();
  if (s.busy) return toast('Une opération est déjà en cours.', { kind: 'info' });
  const sheet = openSheet({ title: 'Tester un envoi vers Drive' });

  if (s.drive.auth !== 'connected' || !s.connectivity.online) {
    sheet.body.append(
      h('div', { class: 'callout', dataset: { health: 'unknown' } }, icon(s.connectivity.online ? 'user' : 'offline'), h('div', null, h('strong', null, s.connectivity.online ? 'Connexion Google nécessaire' : 'Pas de connexion réseau'), h('p', null, 'L’envoi de test a besoin d’une session Google active et du réseau.'))),
    );
    setFoot(
      sheet,
      h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Fermer'),
      s.connectivity.online && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { connectGoogle(); sheet.close(); } }, 'Se connecter avec Google'),
    );
    return;
  }

  const targets = [
    ...s.drive.roots.filter((r) => r.kind === 'folder' && r.access === 'granted' && r.canAddChildren !== false).map((r) => ({ id: r.id, name: r.name })),
    { id: 'root', name: 'Racine de Mon Drive' },
  ];
  let chosen = targets[0].id;

  const list = h(
    'div',
    { class: 'scenarios panel', role: 'radiogroup', 'aria-label': 'Dossier de destination' },
    targets.map((t, i) =>
      h(
        'label',
        { class: 'scenario' },
        h('input', { type: 'radio', name: 'test-target', class: 'check round', id: `test-target-${i}`, checked: i === 0, onchange: () => (chosen = t.id) }),
        h('span', null, h('span', { class: 'row-title', style: 'display:block' }, t.name), t.id === 'root' ? h('span', { class: 'row-sub wrap', style: 'display:block' }, 'Toujours possible avec l’accès limité') : null),
      ),
    ),
  );

  sheet.body.append(
    h('p', null, 'Control Vault va créer un ', h('strong', null, 'nouveau fichier fictif'), ' nommé « control-vault-test_… .json », l’envoyer, le relire dans Drive et comparer son empreinte SHA-256.'),
    h('ul', { class: 'bullets' }, h('li', null, 'Aucune donnée personnelle dans le fichier.'), h('li', null, 'Aucun fichier existant n’est remplacé ni supprimé.'), h('li', null, 'Tu pourras le supprimer toi-même depuis Drive.')),
    h('h3', { class: 'section-title' }, 'Destination'),
    list,
  );

  const go = h('button', { class: 'btn btn-primary', type: 'button' }, icon('upload'), 'Créer le fichier de test');
  setFoot(sheet, h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Annuler'), go);

  go.addEventListener('click', () => {
    const steps = stepList(TEST_STEPS);
    const result = h('div', { 'aria-live': 'polite' });
    replace(sheet.body, steps.el, result);
    const ctrl = new AbortController();
    const cancel = h('button', { class: 'btn', type: 'button', onclick: () => ctrl.abort() }, 'Annuler l’envoi');
    setFoot(sheet, cancel);
    store.set({ busy: { kind: 'backup' } });
    runTestUpload(
      chosen,
      (index, state, note, progress) => {
        steps.update({ index, state, note, progress });
        if (index >= 2) cancel.setAttribute('disabled', '');
      },
      ctrl.signal,
    )
      .then((r) => {
        result.append(
          h(
            'div',
            { class: 'outcome', dataset: { health: 'verified' } },
            seal(),
            h(
              'div',
              null,
              h('h3', null, 'Envoi réel vérifié'),
              h(
                'dl',
                null,
                h('dt', null, 'Fichier'),
                h('dd', null, r.name),
                h('dt', null, 'Taille'),
                h('dd', null, formatBytes(r.sizeBytes)),
                h('dt', null, 'Empreinte'),
                h('dd', { title: r.sha256 }, shortHash(r.sha256)),
                h('dt', null, 'Contrôle'),
                h('dd', null, r.method === 'drive' ? 'Empreinte de Google Drive' : 'Relecture du contenu'),
                h('dt', null, 'Durée'),
                h('dd', null, formatDuration(r.durationMs)),
              ),
              r.link && /^https:\/\/(drive|docs)\.google\.com\//.test(r.link) ? h('a', { class: 'btn btn-sm', href: r.link, target: '_blank', rel: 'noopener noreferrer', style: 'margin-top: var(--s3)' }, 'Ouvrir dans Google Drive') : null,
            ),
          ),
        );
        setFoot(sheet, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => sheet.close() }, 'Terminé'));
        announce('Envoi réel vérifié');
      })
      .catch((e: Error) => {
        result.append(h('div', { class: 'outcome', dataset: { health: 'failed' } }, failureSeal(), h('div', null, h('h3', null, 'Envoi de test non vérifié'), h('p', { class: 'small' }, e.message))));
        setFoot(sheet, h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Fermer'));
      })
      .finally(() => store.set({ busy: null }));
  });
}
