import { store } from '../app';
import { formatBytes, formatDay, formatDuration, formatTime } from '../core/format';
import type { State } from '../core/store';
import type { OpEvent } from '../core/types';
import { openBackup, openRestore } from '../flows/sheets';
import { append, h, replace, staggered } from '../ui/dom';
import { eventHealth, eventResult, eventTitle, sourceName, TYPE_ICON, TYPE_LABELS } from '../ui/events';
import { icon } from '../ui/icons';
import { openSheet, setFoot } from '../ui/overlay';
import { emptyState, pill } from '../ui/parts';
import type { View, ViewContext } from './types';

type Filter = 'all' | 'backup' | 'restore' | 'failed' | 'verify';
const FILTERS: { id: Filter; label: string; test: (e: OpEvent) => boolean }[] = [
  { id: 'all', label: 'Tout', test: () => true },
  { id: 'backup', label: 'Sauvegardes', test: (e) => e.type === 'backup' || e.type === 'safety' },
  { id: 'restore', label: 'Restaurations', test: (e) => e.type === 'restore' },
  { id: 'failed', label: 'Échecs', test: (e) => e.result !== 'success' },
  { id: 'verify', label: 'Contrôles et imports', test: (e) => e.type === 'verify' || e.type === 'import' },
];

const INTEGRITY_TEXT = { verified: 'Empreinte vérifiée', mismatch: 'Empreinte différente', 'not-checked': 'Non contrôlée' } as const;

export function openEventSheet(id: string) {
  const s = store.get();
  const e = s.events.find((x) => x.id === id);
  if (!e) return;
  const sheet = openSheet({ title: eventTitle(e, s) });
  const health = eventHealth(e);
  append(sheet.body, [
    h('div', { style: 'margin-bottom: var(--s4)' }, pill(health, eventResult(e))),
    e.reason
      ? h('div', { class: 'callout', dataset: { health: e.resolved ? 'stale' : 'failed' }, style: 'margin-bottom: var(--s4)' }, icon('info'), h('div', null, h('strong', null, 'Ce qui s’est passé'), h('p', null, e.reason)))
      : null,
    h(
      'dl',
      { class: 'kv' },
      h('dt', null, 'Date et heure'),
      h('dd', null, `${formatDay(e.at)}, ${formatTime(e.at)}`),
      h('dt', null, 'Source'),
      h('dd', null, sourceName(e, s)),
      h('dt', null, 'Opération'),
      h('dd', null, TYPE_LABELS[e.type]),
      h('dt', null, 'Durée'),
      h('dd', null, formatDuration(e.durationMs)),
      e.sizeBytes ? [h('dt', null, 'Taille'), h('dd', null, formatBytes(e.sizeBytes))] : null,
      e.versionId ? [h('dt', null, 'Version'), h('dd', null, e.versionId)] : null,
      h('dt', null, 'Intégrité'),
      h('dd', null, INTEGRITY_TEXT[e.integrity]),
    ),
    e.sha256 ? [h('h3', { class: 'section-title' }, 'Empreinte SHA-256'), h('pre', { class: 'code' }, e.sha256)] : null,
  ]);
  const version = e.versionId ? s.versions.find((v) => v.id === e.versionId) : undefined;
  setFoot(
    sheet,
    h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Fermer'),
    e.result === 'failed' && !e.resolved && e.retry
      ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { sheet.close(); setTimeout(() => openBackup(e.retry!.appId), 180); } }, icon('refresh'), 'Réessayer')
      : version && (e.type === 'backup' || e.type === 'safety')
        ? h('button', { class: 'btn', type: 'button', onclick: () => { sheet.close(); setTimeout(() => openRestore(version.id), 180); } }, icon('restore'), 'Restaurer cette version')
        : null,
  );
}

export function historyView(ctx: ViewContext): View {
  const mem = ctx.memory as { filter?: Filter };
  mem.filter ??= 'all';

  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrer l’historique' });
  const list = h('div', { class: 'timeline-wrap' });
  const el = h(
    'div',
    null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Historique'), h('p', null, 'Chaque opération, avec sa durée, sa taille et son contrôle d’intégrité.'))),
    chips,
    list,
  );

  const render = (s: State, animate: boolean) => {
    const counts = Object.fromEntries(FILTERS.map((f) => [f.id, s.events.filter(f.test).length]));
    replace(
      chips,
      FILTERS.map((f) =>
        h(
          'button',
          {
            class: 'chip',
            type: 'button',
            'aria-pressed': String(mem.filter === f.id),
            onclick: () => {
              mem.filter = f.id;
              render(store.get(), true);
            },
          },
          f.label,
          h('span', { class: 'n' }, String(counts[f.id])),
        ),
      ),
    );

    const events = s.events.filter(FILTERS.find((f) => f.id === mem.filter)!.test);
    if (!events.length) {
      replace(list, emptyState({ icon: 'history', title: 'Rien dans ce filtre', text: mem.filter === 'failed' ? 'Aucun échec enregistré. Les incidents apparaîtront ici avec leur explication.' : 'Aucune opération de ce type pour l’instant.' }));
      return;
    }
    const groups = new Map<string, OpEvent[]>();
    for (const e of events) {
      const k = formatDay(e.at);
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    const nodes = [...groups.entries()].map(([day, evs]) =>
      h(
        'section',
        { class: 'day' },
        h('h2', { class: 'section-title' }, day),
        h(
          'ol',
          { class: 'timeline panel' },
          evs.map((e) => {
            const health = eventHealth(e);
            const open = e.result === 'failed' && !e.resolved;
            return h(
              'li',
              { class: 'tl-item', dataset: { health } },
              h('time', { class: 'tl-time num', datetime: new Date(e.at).toISOString() }, formatTime(e.at)),
              h('span', { class: 'tl-dot', 'aria-hidden': 'true' }, icon(TYPE_ICON[e.type])),
              h(
                'div',
                { class: 'tl-body' },
                h('button', { class: 'tl-title', type: 'button', onclick: () => openEventSheet(e.id) }, eventTitle(e, s)),
                h(
                  'p',
                  { class: 'tl-meta small muted' },
                  h('span', null, eventResult(e)),
                  h('span', null, formatDuration(e.durationMs)),
                  e.sizeBytes ? h('span', null, formatBytes(e.sizeBytes)) : null,
                  h('span', { class: 'tl-integrity', dataset: { health: e.integrity === 'verified' ? 'verified' : e.integrity === 'mismatch' ? 'failed' : 'unknown' } }, INTEGRITY_TEXT[e.integrity]),
                ),
                e.reason ? h('p', { class: 'tl-reason small' }, e.reason) : null,
                open && e.retry ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openBackup(e.retry!.appId) }, icon('refresh'), 'Réessayer') : null,
              ),
            );
          }),
        ),
      ),
    );
    replace(list, ...nodes);
    if (animate) {
      list.classList.remove('stagger');
      void list.offsetWidth;
      list.classList.add('stagger');
      staggered(nodes);
    }
  };

  render(store.get(), true);
  return { el, title: 'Historique', update: (s, changed) => (changed.has('events') ? render(s, false) : undefined) };
}
