import { lastVerified } from '../app';
import { formatBytes, formatPercent, formatRelative } from '../core/format';
import type { State } from '../core/store';
import { openBackupPicker } from '../flows/sheets';
import { h, replace, staggered } from '../ui/dom';
import { eventHealth, eventResult, eventTitle, TYPE_ICON } from '../ui/events';
import { icon } from '../ui/icons';
import { dial, pill } from '../ui/parts';
import { openEventSheet } from './history';
import { globalStatus, runIntent } from './selectors';
import type { View, ViewContext } from './types';
import { store } from '../app';

const LEVEL_TEXT = { ok: 'Vérifié', attention: 'À surveiller', action: 'Action requise', unknown: 'Non vérifiable' } as const;

export function dashboardView(ctx: ViewContext): View {
  const el = h('div', { class: 'dash' });
  let animate = ctx.firstPaint;

  const render = (s: State) => {
    const st = globalStatus(s);
    const primaryIssue = st.issues.find((i) => i.action);
    const intent = primaryIssue?.action?.intent;
    const heroLabel = !intent
      ? ''
      : intent.kind === 'backup'
        ? `Sauvegarder ${s.apps[intent.appId].name}`
        : intent.kind === 'retry'
          ? `Réessayer la sauvegarde`
          : primaryIssue!.action!.label;
    const primary = intent
      ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => runIntent(intent, ctx.navigate) }, icon(intent.kind === 'reconnect' ? 'user' : intent.kind === 'retry' ? 'refresh' : 'backup'), heroLabel)
      : h('button', { class: 'btn btn-primary', type: 'button', onclick: openBackupPicker }, icon('backup'), 'Sauvegarder maintenant');

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
        h('p', { class: 'hero-meta faint small' }, st.lastVerifiedAt ? `Dernière sauvegarde vérifiée ${formatRelative(st.lastVerifiedAt)}` : 'Aucune sauvegarde vérifiée pour l’instant'),
        h('div', { class: 'btn-row' }, primary, primaryIssue && intent?.kind !== 'reconnect' && h('button', { class: 'btn', type: 'button', onclick: openBackupPicker }, 'Autre sauvegarde')),
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
              {
                class: 'legend-item',
                href: seg.key === 'drive' ? '#/fichiers' : seg.key === 'supabase' ? '#/securite' : `#/applis/${seg.key}`,
                dataset: { health: seg.health },
              },
              h('span', { class: 'legend-mark', 'aria-hidden': 'true' }),
              h('span', { class: 'legend-text' }, h('span', { class: 'legend-label' }, seg.label), h('span', { class: 'legend-detail' }, seg.detail)),
            ),
          ),
        ),
      ),
    );
    animate = false;

    const issues = st.issues.length
      ? h(
          'section',
          { class: 'panel issues', 'aria-labelledby': 'issues-title' },
          h('div', { class: 'panel-head' }, h('h2', { id: 'issues-title' }, 'À traiter'), h('span', { class: 'faint small num' }, String(st.issues.length))),
          h(
            'div',
            { class: 'rows' },
            st.issues.map((i) =>
              h(
                'div',
                { class: 'row issue' },
                h('span', { class: 'glyph', dataset: { health: i.severity === 'action' ? 'failed' : 'stale' } }, icon(i.severity === 'action' ? 'alert' : 'info')),
                h('div', { class: 'row-main' }, h('div', { class: 'row-title wrap' }, i.title), h('div', { class: 'row-sub wrap' }, i.detail)),
                i.action ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => runIntent(i.action!.intent, ctx.navigate) }, i.action.label) : h('span'),
              ),
            ),
          ),
        )
      : null;

    const q = s.quota;
    const ratio = q ? q.usedBytes / q.totalBytes : 0;
    const storage = h(
      'section',
      { class: 'panel', 'aria-labelledby': 'storage-title' },
      h('div', { class: 'panel-head' }, h('h2', { id: 'storage-title' }, 'Stockage Google Drive'), h('a', { href: '#/fichiers' }, 'Ouvrir')),
      q
        ? h(
            'div',
            { class: 'panel-body storage' },
            h('p', { class: 'storage-figure num' }, formatBytes(q.usedBytes), h('span', { class: 'muted' }, ` utilisés sur ${formatBytes(q.totalBytes, 0)}`)),
            h('div', { class: 'bar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(ratio * 100)), 'aria-label': 'Espace utilisé' }, h('i', { style: `transform: scaleX(${Math.max(ratio, 0.01)})` })),
            h(
              'dl',
              { class: 'kv' },
              h('dt', null, 'Disponible'),
              h('dd', null, formatBytes(q.totalBytes - q.usedBytes)),
              h('dt', null, 'Occupation'),
              h('dd', null, formatPercent(ratio)),
              h('dt', null, 'Vérifié'),
              h('dd', null, formatRelative(q.checkedAt)),
            ),
            h('p', { class: 'note small', dataset: { health: 'stale' } }, icon('info'), q.planNote),
          )
        : h('div', { class: 'panel-body' }, h('p', { class: 'muted small' }, 'Quota non vérifié : connexion à Drive nécessaire.')),
    );

    const c = s.connectivity;
    const conn = (ic: string, label: string, sub: string, health: Parameters<typeof pill>[0], text: string) =>
      h('div', { class: 'row' }, h('span', { class: 'glyph' }, icon(ic)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, label), h('div', { class: 'row-sub' }, sub)), pill(health, text));
    const connections = h(
      'section',
      { class: 'panel', 'aria-labelledby': 'conn-title' },
      h('div', { class: 'panel-head' }, h('h2', { id: 'conn-title' }, 'Connexions'), h('a', { href: '#/securite' }, 'Sécurité')),
      h(
        'div',
        { class: 'rows' },
        conn(c.online ? 'wifi' : 'offline', 'Réseau', c.online ? 'Ce navigateur est en ligne' : 'Aucune connexion détectée', c.online ? 'verified' : 'unknown', c.online ? 'En ligne' : 'Hors ligne'),
        conn('cloud', 'Google Drive', 'Compte de démonstration', !c.online ? 'unknown' : c.google === 'connected' ? 'verified' : 'failed', !c.online ? 'Non vérifiable' : c.google === 'connected' ? 'Connecté' : 'Session expirée'),
        conn('database', 'Supabase', 'reconversion-control, Paris', c.supabase === 'reachable' ? 'verified' : c.supabase === 'unreachable' ? 'failed' : 'unknown', c.supabase === 'reachable' ? 'Joignable' : c.supabase === 'unreachable' ? 'Injoignable' : 'Non vérifiable'),
      ),
    );

    const recent = s.events.slice(0, 5);
    const ops = h(
      'section',
      { class: 'panel', 'aria-labelledby': 'ops-title' },
      h('div', { class: 'panel-head' }, h('h2', { id: 'ops-title' }, 'Dernières opérations'), h('a', { href: '#/historique' }, 'Tout l’historique')),
      h(
        'div',
        { class: 'rows' },
        recent.map((e) =>
          h(
            'button',
            { class: 'row', type: 'button', onclick: () => openEventSheet(e.id) },
            h('span', { class: 'glyph', dataset: { health: eventHealth(e) } }, icon(TYPE_ICON[e.type])),
            h('span', { class: 'row-main' }, h('span', { class: 'row-title', style: 'display:block' }, eventTitle(e, s)), h('span', { class: 'row-sub', style: 'display:block' }, `${formatRelative(e.at)}${e.sizeBytes ? ` — ${formatBytes(e.sizeBytes)}` : ''}`)),
            h('span', { class: 'row-end' }, h('span', { class: 'desktop-only' }, eventResult(e)), icon(e.result === 'success' ? 'check' : e.result === 'failed' ? 'alert' : 'x')),
          ),
        ),
      ),
    );

    const apps = h(
      'section',
      { class: 'app-strip', 'aria-label': 'Applications connectées' },
      Object.values(s.apps).map((a) => {
        const v = lastVerified(a.id);
        return h(
          'a',
          { class: 'app-mini', href: `#/applis/${a.id}` },
          h('span', { class: 'app-mini-name' }, a.name),
          h('span', { class: 'faint small' }, v ? `Sauvegardée ${formatRelative(v.createdAt)}` : 'Jamais sauvegardée'),
        );
      }),
    );

    replace(el, hero, issues, apps, h('div', { class: 'dash-grid' }, storage, connections), ops);
    staggered([...el.children] as HTMLElement[]);
  };

  el.classList.add('stagger');
  render(store.get());
  setTimeout(() => el.classList.remove('stagger'), 600);

  return {
    el,
    title: 'Accueil',
    update: (s, changed) => {
      if (changed.has('settings') && changed.size === 1) return;
      render(s);
    },
  };
}
