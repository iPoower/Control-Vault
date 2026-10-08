// Composants partagés : pastilles d'état, cadran, glyphes de fichiers, états vides.

import type { Segment } from '../core/status';
import type { DriveItem, Health } from '../core/types';
import { h, svg } from './dom';
import { icon } from './icons';

export const HEALTH_LABEL: Record<Health, string> = {
  verified: 'Vérifié',
  stale: 'À rafraîchir',
  pending: 'En attente',
  failed: 'Échec',
  unknown: 'Non vérifié',
};

export function pill(health: Health, text = HEALTH_LABEL[health]) {
  return h('span', { class: 'pill', dataset: { health } }, text);
}

export function fileGlyph(item: Pick<DriveItem, 'kind' | 'family'>) {
  const fam = item.kind === 'folder' ? 'folder' : (item.family ?? 'other');
  const name = fam === 'folder' ? 'folder' : fam === 'vault' ? 'vault' : fam === 'json' ? 'json' : fam === 'image' ? 'image' : fam === 'document' ? 'doc' : 'file';
  return h('span', { class: 'glyph', dataset: { family: fam } }, icon(name));
}

export function familyLabel(item: DriveItem) {
  if (item.kind === 'folder') return 'Dossier';
  return { vault: 'Sauvegarde chiffrée', json: 'JSON', document: 'Document', image: 'Image', other: 'Fichier' }[item.family ?? 'other'];
}

export function emptyState(opts: { icon: string; title: string; text: string; action?: HTMLElement }) {
  return h(
    'div',
    { class: 'empty' },
    h('span', { class: 'glyph' }, icon(opts.icon)),
    h('h3', null, opts.title),
    h('p', null, opts.text),
    opts.action,
  );
}

/**
 * Cadran d'état : quatre arcs, un par source (Drive, Supabase, chaque application).
 * La graduation rappelle le cadran d'un coffre ; les couleurs ne disent que des états vérifiés.
 */
export function dial(segments: Segment[], animate: boolean) {
  const size = 200;
  const c = size / 2;
  const R = 72;
  const gap = 9; // degrés
  const span = 360 / segments.length;
  const verified = segments.filter((s) => s.health === 'verified').length;

  const polar = (r: number, deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [c + r * Math.cos(rad), c + r * Math.sin(rad)];
  };

  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'dial-svg', 'aria-hidden': 'true' });

  // Graduation
  const ticks = svg('g', { class: 'dial-ticks' });
  for (let i = 0; i < 72; i++) {
    const long = i % 6 === 0;
    const [x1, y1] = polar(94, i * 5);
    const [x2, y2] = polar(long ? 85 : 89, i * 5);
    ticks.appendChild(svg('line', { x1, y1, x2, y2, class: long ? 'long' : '' }));
  }
  root.appendChild(ticks);

  // Piste puis arcs
  root.appendChild(svg('circle', { cx: c, cy: c, r: R, class: 'dial-track' }));
  segments.forEach((s, i) => {
    const a0 = i * span + gap / 2;
    const a1 = (i + 1) * span - gap / 2;
    const [x0, y0] = polar(R, a0);
    const [x1, y1] = polar(R, a1);
    const len = (2 * Math.PI * R * (a1 - a0)) / 360;
    const path = svg('path', {
      d: `M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}`,
      class: `dial-arc${animate ? ' draw' : ''}`,
      'data-health': s.health,
      style: `--len:${len.toFixed(1)};--d:${i * 90}ms`,
    });
    root.appendChild(path);
  });

  const center = h(
    'div',
    { class: 'dial-center' },
    h('span', { class: 'dial-count num' }, String(verified), h('span', { class: 'dial-of' }, ` / ${segments.length}`)),
    h('span', { class: 'dial-label' }, verified > 1 ? 'sources vérifiées' : 'source vérifiée'),
  );

  return h(
    'div',
    {
      class: 'dial',
      role: 'img',
      'aria-label': `${verified} sources vérifiées sur ${segments.length}. ${segments.map((s) => `${s.label} : ${s.detail}`).join('. ')}.`,
    },
    root,
    center,
  );
}

export function sectionTitle(text: string, id?: string) {
  return h('h2', { class: 'section-title', id }, text);
}
