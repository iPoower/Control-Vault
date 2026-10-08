// Recherche rapide (Cmd/Ctrl + K) : actions, écrans, fichiers et versions en quelques frappes.

import { store, versionsOf } from '../app';
import { formatDateTime, formatRelative } from '../core/format';
import type { AppId } from '../core/types';
import { openBackup, openRestore, openVerifyAll } from '../flows/sheets';
import { h, replace } from './dom';
import { icon } from './icons';
import { familyLabel } from './parts';

interface Entry {
  group: string;
  label: string;
  sub?: string;
  icon: string;
  keywords?: string;
  run: () => void;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function entries(navigate: (h: string) => void): Entry[] {
  const s = store.get();
  const out: Entry[] = [];
  for (const id of Object.keys(s.apps) as AppId[]) {
    out.push({ group: 'Actions', label: `Sauvegarder ${s.apps[id].name}`, icon: 'backup', keywords: 'backup sauvegarde', run: () => openBackup(id) });
  }
  out.push({ group: 'Actions', label: 'Vérifier toutes les sauvegardes', icon: 'fingerprint', keywords: 'integrite sha controle', run: openVerifyAll });
  out.push({ group: 'Actions', label: 'Importer un fichier JSON', icon: 'upload', keywords: 'import envoyer', run: () => navigate('#/fichiers') });
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  out.push({ group: 'Actions', label: dark ? 'Passer en thème clair' : 'Passer en thème sombre', icon: 'sun', keywords: 'theme apparence mode', run: () => store.set({ settings: { ...store.get().settings, theme: dark ? 'light' : 'dark' } }) });

  const screens: [string, string, string][] = [
    ['Accueil', '#/', 'home'],
    ['Fichiers', '#/fichiers', 'folder'],
    ['Applications', '#/applis', 'apps'],
    ['Historique', '#/historique', 'history'],
    ['Sécurité', '#/securite', 'shield'],
    ['Réglages', '#/reglages', 'settings'],
  ];
  for (const [label, hash, ic] of screens) out.push({ group: 'Aller à', label, icon: ic, run: () => navigate(hash) });

  for (const item of s.catalog) {
    if (!item.parentId) continue;
    out.push({
      group: 'Fichiers',
      label: item.name,
      sub: `${familyLabel(item)}, ${formatRelative(item.modifiedAt)}`,
      icon: item.kind === 'folder' ? 'folder' : item.family === 'vault' ? 'vault' : item.family === 'json' ? 'json' : 'file',
      run: () => navigate(item.kind === 'folder' ? `#/fichiers/${item.id}` : `#/fichiers/${item.parentId === 'cv-root' ? '' : item.parentId}`),
    });
  }
  for (const id of Object.keys(s.apps) as AppId[]) {
    for (const v of versionsOf(id)) {
      out.push({ group: 'Versions', label: `${s.apps[id].name}, ${formatDateTime(v.createdAt)}`, sub: `${v.id} — restaurer`, icon: 'restore', keywords: `${v.id} version restaurer`, run: () => openRestore(v.id) });
    }
  }
  return out;
}

export function openPalette(navigate: (h: string) => void) {
  if (document.querySelector('dialog.palette')) return;
  const all = entries(navigate);
  const input = h('input', {
    type: 'text',
    placeholder: 'Rechercher une action, un fichier, une version…',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'palette-list',
    'aria-autocomplete': 'list',
    'aria-label': 'Recherche rapide',
    autocomplete: 'off',
    spellcheck: false,
  });
  const list = h('div', { class: 'palette-list', id: 'palette-list', role: 'listbox', 'aria-label': 'Résultats' });
  const dialog = h(
    'dialog',
    { class: 'palette', 'aria-label': 'Recherche rapide' },
    h('div', { class: 'palette-input' }, icon('search'), input, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: () => close() }, icon('x'))),
    list,
    h('div', { class: 'palette-foot desktop-only' }, h('span', null, h('kbd', null, '↑'), ' ', h('kbd', null, '↓'), ' naviguer'), h('span', null, h('kbd', null, 'Entrée'), ' ouvrir'), h('span', null, h('kbd', null, 'Échap'), ' fermer')),
  );
  const opener = document.activeElement as HTMLElement | null;
  let results: Entry[] = [];
  let active = 0;

  const close = () => {
    dialog.close();
    dialog.remove();
    opener?.focus?.({ preventScroll: true });
  };

  const paint = () => {
    const q = norm(input.value.trim());
    const terms = q.split(/\s+/).filter(Boolean);
    results = (terms.length ? all.filter((e) => terms.every((t) => norm(`${e.label} ${e.sub ?? ''} ${e.keywords ?? ''} ${e.group}`).includes(t))) : all.filter((e) => e.group !== 'Fichiers' && e.group !== 'Versions')).slice(0, 40);
    active = Math.min(active, Math.max(0, results.length - 1));
    if (!results.length) {
      replace(list, h('p', { class: 'palette-empty' }, `Rien ne correspond à « ${input.value} ».`));
      input.removeAttribute('aria-activedescendant');
      return;
    }
    let last = '';
    const nodes: HTMLElement[] = [];
    results.forEach((e, i) => {
      if (e.group !== last) {
        nodes.push(h('div', { class: 'palette-group', role: 'presentation' }, e.group));
        last = e.group;
      }
      nodes.push(
        h(
          'div',
          {
            class: 'palette-item',
            role: 'option',
            id: `pal-${i}`,
            'aria-selected': String(i === active),
            onclick: () => choose(i),
            onpointermove: () => {
              if (active !== i) {
                active = i;
                syncActive();
              }
            },
          },
          icon(e.icon),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title', style: 'display:block' }, e.label), e.sub ? h('span', { class: 'sub', style: 'display:block' }, e.sub) : null),
          h('span'),
        ),
      );
    });
    replace(list, ...nodes);
    syncActive();
  };

  const syncActive = () => {
    list.querySelectorAll('[role="option"]').forEach((n) => n.setAttribute('aria-selected', String(n.id === `pal-${active}`)));
    input.setAttribute('aria-activedescendant', `pal-${active}`);
    list.querySelector(`#pal-${active}`)?.scrollIntoView({ block: 'nearest' });
  };

  const choose = (i: number) => {
    const e = results[i];
    if (!e) return;
    close();
    setTimeout(e.run, 60);
  };

  input.addEventListener('input', () => {
    active = 0;
    paint();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') active = Math.min(results.length - 1, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'Enter') return choose(active);
    else return;
    e.preventDefault();
    syncActive();
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });

  document.body.appendChild(dialog);
  dialog.showModal();
  paint();
  input.focus();
}
