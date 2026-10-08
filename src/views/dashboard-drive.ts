// Accueil en mode Google Drive : uniquement des états prouvés par une réponse réelle de Google.

import { store } from '../app';
import { formatBytes, formatPercent, formatRelative } from '../core/format';
import type { RootAccess, State } from '../core/store';
import { openTestUpload } from '../flows/drive-test';
import { h, replace, staggered } from '../ui/dom';
import { eventHealth, eventResult, eventTitle, TYPE_ICON } from '../ui/events';
import { icon } from '../ui/icons';
import { dial, emptyState, pill } from '../ui/parts';
import { connectGoogle, openGrant } from './drive-actions';
import { openEventSheet } from './history';
import { globalStatus, runIntent } from './selectors';
import type { View, ViewContext } from './types';

const LEVEL_TEXT = { ok: 'Vérifié', attention: 'À compléter', action: 'Action requise', unknown: 'Non vérifié' } as const;

export const ACCESS_TEXT: Record<RootAccess['access'], [Parameters<typeof pill>[0], string]> = {
  granted: ['verified', 'Autorisé'],
  missing: ['stale', 'À autoriser'],
  checking: ['pending', 'Contrôle…'],
  unknown: ['unknown', 'Non vérifié'],
  error: ['failed', 'Erreur'],
};

export function rootsPanel(s: State) {
  const d = s.drive;
  const connected = d.auth === 'connected';
  return h(
    'section',
    { class: 'panel', 'aria-labelledby': 'roots-title' },
    h('div', { class: 'panel-head' }, h('h2', { id: 'roots-title' }, 'Dossiers autorisés'), connected ? h('button', { class: 'link', type: 'button', onclick: () => openGrant() }, 'Autoriser') : null),
    h(
      'div',
      { class: 'rows' },
      d.roots.map((r) => {
        const [health, text] = ACCESS_TEXT[connected ? r.access : 'unknown'];
        const sub =
          r.access === 'granted' && r.kind === 'folder'
            ? r.visibleChildren === 0
              ? 'Accessible ; aucun fichier visible à l’intérieur pour l’instant'
              : `${r.visibleChildren === 20 ? '20 éléments ou plus' : `${r.visibleChildren} élément${(r.visibleChildren ?? 0) > 1 ? 's' : ''}`} visible${(r.visibleChildren ?? 0) > 1 ? 's' : ''}`
            : r.access === 'missing'
              ? 'Pas encore choisi dans le sélecteur Google'
              : r.source === 'config'
                ? 'Dossier existant du coffre'
                : r.kind === 'folder' ? 'Dossier choisi dans le sélecteur' : 'Fichier choisi dans le sélecteur';
        const inner = [
          h('span', { class: 'glyph', dataset: { family: r.kind === 'folder' ? 'folder' : 'json' } }, icon(r.kind === 'folder' ? 'folder' : 'file')),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title', style: 'display:block' }, r.name), h('span', { class: 'row-sub', style: 'display:block' }, sub)),
          h('span', { class: 'row-end' }, pill(health, text)),
        ];
        return r.access === 'granted' && r.kind === 'folder'
          ? h('a', { class: 'row', href: `#/fichiers/${r.id}` }, inner)
          : h('div', { class: 'row' }, inner);
      }),
    ),
    connected && d.roots.some((r) => r.access === 'missing')
      ? h(
          'div',
          { class: 'panel-body' },
          h('p', { class: 'small muted', style: 'margin-bottom: var(--s3)' }, 'Avec l’accès limité, Google exige que tu choisisses toi-même chaque dossier ou fichier existant. Control Vault ne peut rien voir d’autre.'),
          h('button', { class: 'btn', type: 'button', onclick: () => openGrant() }, icon('key'), 'Ouvrir le sélecteur Google'),
        )
      : null,
  );
}

export function driveDashboardView(ctx: ViewContext): View {
  const el = h('div', { class: 'dash' });
  let animate = ctx.firstPaint;

  const render = (s: State) => {
    const st = globalStatus(s);
    const d = s.drive;
    const connected = d.auth === 'connected';
    const first = st.issues.find((i) => i.action);
    const primary = first?.action
      ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => runIntent(first.action!.intent, ctx.navigate) }, icon(first.action.intent.kind === 'grant' ? 'key' : 'user'), first.action.label)
      : connected
        ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openTestUpload() }, icon('upload'), 'Tester un envoi')
        : null;

    const hero = h(
      'section',
      { class: 'hero', 'aria-labelledby': 'hero-title', dataset: { level: st.level } },
      dial(st.segments, animate),
      h(
        'div',
        { class: 'hero-text' },
        h('p', { class: 'hero-level', dataset: { health: st.level === 'ok' ? 'verified' : st.level === 'action' ? 'failed' : st.level === 'attention' ? 'stale' : 'unknown' } }, LEVEL_TEXT[st.level]),
        h('h1', { id: 'hero-title' }, st.title),
        h('p', { class: 'hero-detail' }, st.detail),
        h('p', { class: 'hero-meta faint small' }, d.lastCheckAt ? `Dernière réponse de Google Drive ${formatRelative(d.lastCheckAt)}` : 'Aucune réponse de Google Drive pour l’instant'),
        h('div', { class: 'btn-row' }, primary, d.auth === 'signing-in' ? h('span', { class: 'muted small', style: 'align-self:center' }, 'Fenêtre Google ouverte…') : null),
      ),
      h(
        'ul',
        { class: 'legend', 'aria-label': 'Détail par source' },
        st.segments.map((seg) =>
          h(
            'li',
            null,
            h(
              'a',
              { class: 'legend-item', href: seg.key === 'drive' || seg.key === 'folders' ? '#/fichiers' : seg.key === 'backups' ? '#/applis' : '#/securite', dataset: { health: seg.health } },
              h('span', { class: 'legend-mark', 'aria-hidden': 'true' }),
              h('span', { class: 'legend-text' }, h('span', { class: 'legend-label' }, seg.label), h('span', { class: 'legend-detail' }, seg.detail)),
            ),
          ),
        ),
      ),
    );
    animate = false;

    const q = s.quota;
    const ratio = q && q.totalBytes ? q.usedBytes / q.totalBytes : 0;
    const account = h(
      'section',
      { class: 'panel', 'aria-labelledby': 'acct-title' },
      h('div', { class: 'panel-head' }, h('h2', { id: 'acct-title' }, 'Compte et stockage'), h('a', { href: '#/securite' }, 'Sécurité')),
      connected && d.account
        ? h(
            'div',
            { class: 'panel-body storage' },
            h('p', { class: 'row-title' }, d.account.name ?? 'Compte Google', h('span', { class: 'muted small', style: 'display:block' }, d.account.email ?? '')),
            q
              ? [
                  h('p', { class: 'storage-figure num' }, formatBytes(q.usedBytes), h('span', { class: 'muted' }, q.totalBytes ? ` utilisés sur ${formatBytes(q.totalBytes, 0)}` : ' utilisés')),
                  q.totalBytes ? h('div', { class: 'bar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(ratio * 100)), 'aria-label': 'Espace utilisé' }, h('i', { style: `transform: scaleX(${Math.max(ratio, 0.01)})` })) : null,
                  h('dl', { class: 'kv' }, q.totalBytes ? [h('dt', null, 'Disponible'), h('dd', null, formatBytes(q.totalBytes - q.usedBytes)), h('dt', null, 'Occupation'), h('dd', null, formatPercent(ratio))] : null, h('dt', null, 'Lu'), h('dd', null, formatRelative(q.checkedAt))),
                ]
              : null,
          )
        : h('div', { class: 'panel-body' }, h('p', { class: 'muted small' }, connected ? 'Lecture du compte en cours…' : 'Connecte Google Drive pour afficher ton compte et ton espace réel.'), !connected && d.auth !== 'signing-in' ? h('button', { class: 'btn', type: 'button', style: 'margin-top: var(--s3)', onclick: () => connectGoogle() }, icon('user'), 'Se connecter avec Google') : null),
    );

    const recent = s.events.slice(0, 5);
    const ops = h(
      'section',
      { class: 'panel', 'aria-labelledby': 'ops-title' },
      h('div', { class: 'panel-head' }, h('h2', { id: 'ops-title' }, 'Opérations réelles'), h('a', { href: '#/historique' }, 'Historique')),
      recent.length
        ? h(
            'div',
            { class: 'rows' },
            recent.map((e) =>
              h(
                'button',
                { class: 'row', type: 'button', onclick: () => openEventSheet(e.id) },
                h('span', { class: 'glyph', dataset: { health: eventHealth(e) } }, icon(TYPE_ICON[e.type])),
                h('span', { class: 'row-main' }, h('span', { class: 'row-title', style: 'display:block' }, eventTitle(e, s)), h('span', { class: 'row-sub', style: 'display:block' }, formatRelative(e.at))),
                h('span', { class: 'row-end' }, h('span', { class: 'desktop-only' }, eventResult(e)), icon(e.result === 'success' ? 'check' : e.result === 'failed' ? 'alert' : 'x')),
              ),
            ),
          )
        : emptyState({ icon: 'history', title: 'Aucune opération réelle', text: 'Les connexions, autorisations et envois de test de cette session apparaîtront ici.' }),
    );

    replace(el, hero, h('div', { class: 'dash-grid' }, rootsPanel(s), account), ops);
    staggered([...el.children] as HTMLElement[]);
  };

  el.classList.add('stagger');
  render(store.get());
  setTimeout(() => el.classList.remove('stagger'), 600);
  const tick = setInterval(() => render(store.get()), 60_000);
  return { el, title: 'Accueil', update: (s) => render(s), destroy: () => clearInterval(tick) };
}
