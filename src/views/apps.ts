import { lastVerified, store, versionsOf } from '../app';
import { appHealth, openFailures } from '../core/status';
import { formatBytes, formatDate, formatDateTime, formatRelative, plural } from '../core/format';
import type { State } from '../core/store';
import type { AppId, AppRecord } from '../core/types';
import { openBackup, openRestore } from '../flows/sheets';
import { download, h, replace } from '../ui/dom';
import { icon } from '../ui/icons';
import { emptyState, pill } from '../ui/parts';
import type { View, ViewContext } from './types';

function healthOf(s: State, app: AppRecord) {
  return appHealth(
    { id: app.id, name: app.name, lastVerifiedAt: lastVerified(app.id)?.createdAt, freshnessDays: app.freshnessDays },
    Date.now(),
    openFailures(s.events).some((f) => f.source === app.id),
    s.queue.some((q) => q.appId === app.id),
  );
}

const HEALTH_SENTENCE = {
  verified: 'Sauvegarde récente vérifiée',
  stale: 'À rafraîchir',
  pending: 'En attente de connexion',
  failed: 'Dernière tentative échouée',
  unknown: 'Aucune sauvegarde vérifiée',
} as const;

function countsLine(app: AppRecord, counts: Record<string, number>) {
  return Object.entries(counts)
    .filter(([k]) => app.collections[k])
    .map(([k, n]) => plural(n, app.collections[k].one, app.collections[k].many))
    .join(', ');
}

function appCard(s: State, app: AppRecord, navigate: (h: string) => void) {
  const versions = versionsOf(app.id);
  const last = lastVerified(app.id);
  const health = healthOf(s, app);
  const total = versions.reduce((n, v) => n + v.sizeBytes, 0);
  const busy = s.busy?.appId === app.id;
  return h(
    'article',
    { class: 'app-card panel', 'aria-labelledby': `app-${app.id}` },
    h(
      'header',
      { class: 'app-card-head' },
      h('div', null, h('h2', { id: `app-${app.id}` }, app.name), h('p', { class: 'muted small' }, app.tagline)),
      pill(health, HEALTH_SENTENCE[health]),
    ),
    h(
      'dl',
      { class: 'app-facts' },
      h('div', null, h('dt', null, 'Dernière sauvegarde'), h('dd', null, last ? formatRelative(last.createdAt) : 'Jamais'), last && h('dd', { class: 'faint small' }, formatDateTime(last.createdAt))),
      h('div', null, h('dt', null, 'Versions'), h('dd', { class: 'num' }, String(versions.length)), h('dd', { class: 'faint small' }, `${formatBytes(total)} au total`)),
      h('div', { class: 'span2' }, h('dt', null, 'Données actuelles'), h('dd', null, countsLine(app, Object.fromEntries(Object.entries(app.payload).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length]))))),
    ),
    h(
      'div',
      { class: 'btn-row app-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openBackup(app.id), disabled: busy || undefined }, busy ? h('span', { class: 'spinner' }) : icon('backup'), busy ? 'Opération en cours' : 'Sauvegarder'),
      h('button', { class: 'btn', type: 'button', onclick: () => navigate(`#/applis/${app.id}`), disabled: !versions.length || undefined }, icon('restore'), 'Restaurer'),
      h('a', { class: 'btn btn-quiet', href: `#/applis/${app.id}` }, 'Versions et historique'),
    ),
  );
}

export function appsView(ctx: ViewContext): View {
  const el = h('div');
  const render = (s: State) =>
    replace(
      el,
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Applications'), h('p', null, 'Sauvegarde et restauration de tes applications connectées.'))),
      h('div', { class: 'app-grid' }, Object.values(s.apps).map((a) => appCard(s, a, ctx.navigate))),
      h(
        'div',
        { class: 'callout', dataset: { health: 'pending' }, style: 'margin-top: var(--s5)' },
        icon('link'),
        h('div', null, h('strong', null, 'Aucune écriture directe dans tes applications'), h('p', null, 'Tant qu’un contrat d’intégration n’est pas validé, Control Vault travaille sur des exports JSON. Race Control et Reconversion Control ne sont jamais modifiés à ton insu.')),
      ),
    );
  render(store.get());
  return { el, title: 'Applications', update: (s) => render(s) };
}

export function appDetailView(ctx: ViewContext): View {
  const id = ctx.params.id as AppId;
  const el = h('div');
  const render = (s: State) => {
    const app = s.apps[id];
    if (!app) {
      replace(el, emptyState({ icon: 'apps', title: 'Application inconnue', text: 'Cette application n’est pas connectée au coffre.', action: h('a', { class: 'btn', href: '#/applis' }, 'Voir les applications') }));
      return;
    }
    const versions = versionsOf(id);
    const health = healthOf(s, app);
    const current = Object.fromEntries(Object.entries(app.payload).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length]));
    const critical = Object.keys(app.collections).find((k) => app.collections[k].critical);

    replace(
      el,
      h('a', { class: 'back-link', href: '#/applis' }, icon('back'), 'Applications'),
      h(
        'div',
        { class: 'page-head' },
        h('div', null, h('h1', null, app.name), h('p', null, app.tagline)),
        pill(health, HEALTH_SENTENCE[health]),
      ),
      h(
        'div',
        { class: 'btn-row', style: 'margin-bottom: var(--s5)' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openBackup(id), disabled: !!s.busy || undefined }, icon('backup'), 'Sauvegarder maintenant'),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => download(new Blob([JSON.stringify(app.payload, null, 2)], { type: 'application/json' }), `${id}_etat-actuel_${new Date().toISOString().slice(0, 10)}.json`),
          },
          icon('download'),
          'Exporter l’état actuel',
        ),
      ),
      h('section', { class: 'panel', 'aria-labelledby': 'cur-title' }, h('div', { class: 'panel-head' }, h('h2', { id: 'cur-title' }, 'État actuel')), h('div', { class: 'panel-body' }, h('p', null, countsLine(app, current)))),
      h('h2', { class: 'section-title', id: 'versions' }, `Versions disponibles (${versions.length})`),
      versions.length
        ? h(
            'div',
            { class: 'panel rows versions' },
            versions.map((v, i) => {
              const delta = critical ? (v.counts[critical] ?? 0) - (current[critical] ?? 0) : 0;
              return h(
                'button',
                { class: 'row', type: 'button', onclick: () => openRestore(v.id), 'aria-label': `Version du ${formatDateTime(v.createdAt)}, ${formatBytes(v.sizeBytes)}. Ouvrir la restauration.` },
                h('span', { class: 'glyph', dataset: { health: v.verifiedAt ? 'verified' : 'unknown' } }, icon(v.kind === 'safety' ? 'shield' : 'vault')),
                h(
                  'span',
                  { class: 'row-main' },
                  h('span', { class: 'row-title', style: 'display:block' }, formatDateTime(v.createdAt), i === 0 ? h('span', { class: 'tag', style: 'margin-left: 8px' }, 'Plus récente') : null, v.kind === 'safety' ? h('span', { class: 'tag', style: 'margin-left: 8px' }, 'Copie de sécurité') : null),
                  h(
                    'span',
                    { class: 'row-sub', style: 'display:block' },
                    `${v.id} — ${formatBytes(v.sizeBytes)}`,
                    critical && delta !== 0 ? ` — ${delta > 0 ? '+' : '−'}${Math.abs(delta)} ${Math.abs(delta) > 1 ? app.collections[critical].many : app.collections[critical].one} par rapport à aujourd’hui` : '',
                  ),
                ),
                h('span', { class: 'row-end' }, h('span', { class: 'desktop-only' }, 'Restaurer'), icon('chevron')),
              );
            }),
          )
        : emptyState({ icon: 'vault', title: 'Aucune version', text: 'La première sauvegarde apparaîtra ici, avec sa date, sa taille et son empreinte.', action: h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openBackup(id) }, 'Sauvegarder maintenant') }),
      h('p', { class: 'faint small', style: 'margin-top: var(--s3)' }, `Les versions sont conservées dans Drive. Prochaine version attendue avant le ${formatDate((lastVerified(id)?.createdAt ?? Date.now()) + app.freshnessDays * 86_400_000)}.`),
    );
  };
  render(store.get());
  return { el, title: store.get().apps[id]?.name ?? 'Application', update: (s) => render(s) };
}
