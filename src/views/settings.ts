import { exportJournal, setScenario, store } from '../app';
import { formatBytes } from '../core/format';
import type { State } from '../core/store';
import type { AppId, Scenario, Settings } from '../core/types';
import { download, h, replace } from '../ui/dom';
import { icon } from '../ui/icons';
import { toast } from '../ui/overlay';
import type { View, ViewContext } from './types';

const SECTIONS = [
  ['compte', 'Compte'],
  ['stockage', 'Stockage'],
  ['applications', 'Applications'],
  ['sauvegardes', 'Sauvegardes'],
  ['notifications', 'Notifications'],
  ['apparence', 'Apparence'],
  ['securite', 'Sécurité'],
  ['donnees', 'Données et exportation'],
  ['demo', 'Démonstration'],
] as const;

const SCENARIOS: { id: Scenario; label: string; text: string }[] = [
  { id: 'normal', label: 'Fonctionnement normal', text: 'Drive et Supabase répondent.' },
  { id: 'offline', label: 'Hors ligne', text: 'Aucune requête ne part ; les sauvegardes peuvent être mises en attente.' },
  { id: 'auth-expired', label: 'Session Google expirée', text: 'Drive refuse les requêtes jusqu’à la reconnexion.' },
  { id: 'upload-interrupted', label: 'Envoi interrompu', text: 'La connexion tombe pendant l’envoi d’une sauvegarde.' },
  { id: 'supabase-down', label: 'Supabase injoignable', text: 'Le journal distant ne répond pas.' },
];

function segmented<T extends string>(label: string, value: T, options: [T, string][], onChange: (v: T) => void) {
  const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  let current = value;
  const choose = (v: T, focus = false) => {
    current = v;
    onChange(v);
    paint();
    if (focus) (group.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
  };
  const paint = () =>
    replace(
      group,
      options.map(([val, text]) =>
        h('button', { type: 'button', role: 'radio', 'aria-checked': String(current === val), tabindex: current === val ? '0' : '-1', onclick: () => choose(val) }, text),
      ),
    );
  group.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = options.findIndex(([v]) => v === current);
    choose(options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length][0], true);
  });
  paint();
  return group;
}

const setRow = (title: string, sub: string | null, control: HTMLElement | null) =>
  h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('div', { class: 'row-title wrap' }, title), sub ? h('div', { class: 'row-sub wrap' }, sub) : null), control);

export function settingsView(ctx: ViewContext): View {
  const el = h('div', { class: 'settings' });

  const patch = (p: Partial<Settings>) => store.set({ settings: { ...store.get().settings, ...p } });

  const render = (s: State) => {
    const q = s.quota;
    replace(
      el,
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Réglages'))),
      h('nav', { class: 'set-nav chips', 'aria-label': 'Sections des réglages' }, SECTIONS.map(([id, label]) => h('a', { class: 'chip', href: `#/reglages`, onclick: (e: Event) => { e.preventDefault(); document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, label))),

      group('compte', 'Compte', setRow('Google', 'Compte de démonstration — connexion réelle en Phase 2', h('span', { class: 'tag' }, 'Démo'))),

      group(
        'stockage',
        'Stockage',
        setRow('Dossiers du coffre', 'En mode connecté, tu choisiras toi-même chaque dossier dans le sélecteur Google. Aucun dossier n’est enregistré dans le code, et les dossiers existants ne sont jamais recréés ni déplacés.', null),
        setRow('Espace', q ? `${formatBytes(q.usedBytes)} utilisés sur ${formatBytes(q.totalBytes, 0)}. ${q.planNote}.` : 'Non vérifié', null),
      ),

      group(
        'applications',
        'Applications',
        ...(Object.keys(s.apps) as AppId[]).map((id) => h('a', { class: 'set-row link', href: `#/applis/${id}` }, h('div', { class: 'set-text' }, h('div', { class: 'row-title' }, s.apps[id].name), h('div', { class: 'row-sub' }, s.apps[id].tagline)), icon('chevron'))),
      ),

      group(
        'sauvegardes',
        'Sauvegardes',
        setRow(
          'Rappel de fraîcheur',
          'Au-delà de ce délai sans sauvegarde, l’accueil signale une vérification requise.',
          segmented('Délai de rappel', String(s.apps['race-control'].freshnessDays) as '3' | '7' | '14', [['3', '3 j'], ['7', '7 j'], ['14', '14 j']], (v) => {
            const apps = { ...store.get().apps };
            for (const k of Object.keys(apps) as AppId[]) apps[k] = { ...apps[k], freshnessDays: Number(v) };
            store.set({ apps });
          }),
        ),
        setRow('Chiffrement', 'Toujours actif. Une sauvegarde n’est jamais envoyée en clair.', h('span', { class: 'pill', dataset: { health: 'verified' } }, 'Actif')),
        setRow('Conservation', 'Toutes les versions sont gardées. Aucune suppression automatique dans cette version.', null),
      ),

      group(
        'notifications',
        'Notifications',
        setRow('Alertes sur iPhone', 'Disponibles une fois Control Vault ajouté à l’écran d’accueil : Safari, bouton Partager, puis « Sur l’écran d’accueil ». Activation prévue avec la connexion réelle.', null),
      ),

      group(
        'apparence',
        'Apparence',
        setRow('Thème', null, segmented('Thème', s.settings.theme, [['system', 'Système'], ['dark', 'Sombre'], ['light', 'Clair']], (v) => patch({ theme: v }))),
        setRow('Animations', 'Le réglage « Réduire les animations » de l’appareil est toujours respecté.', segmented('Animations', s.settings.motion, [['system', 'Système'], ['reduced', 'Réduites']], (v) => patch({ motion: v }))),
        setRow('Affichage des fichiers', null, segmented('Affichage des fichiers', s.settings.view, [['list', 'Liste'], ['grid', 'Grille']], (v) => patch({ view: v }))),
      ),

      group('securite', 'Sécurité', h('a', { class: 'set-row link', href: '#/securite' }, h('div', { class: 'set-text' }, h('div', { class: 'row-title' }, 'Chiffrement, permissions, sessions'), h('div', { class: 'row-sub' }, 'État détaillé et contrôle d’intégrité')), icon('chevron'))),

      group(
        'donnees',
        'Données et exportation',
        setRow('Journal des opérations', 'Toutes les opérations et versions, au format JSON.', h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { download(exportJournal(), `control-vault_journal_${new Date().toISOString().slice(0, 10)}.json`); toast('Journal exporté', { kind: 'ok' }); } }, icon('export'), 'Exporter')),
      ),

      group(
        'demo',
        'Démonstration',
        h('p', { class: 'set-intro muted small' }, 'Données fictives, recréées à chaque ouverture. Choisis une situation pour voir comment l’interface réagit.'),
        h(
          'div',
          { class: 'scenarios', role: 'radiogroup', 'aria-label': 'Situation simulée' },
          SCENARIOS.map((sc) =>
            h(
              'label',
              { class: 'scenario' },
              h('input', { type: 'radio', name: 'scenario', class: 'check round', checked: s.scenario === sc.id, onchange: () => setScenario(sc.id) }),
              h('span', null, h('span', { class: 'row-title', style: 'display:block' }, sc.label), h('span', { class: 'row-sub wrap', style: 'display:block' }, sc.text)),
            ),
          ),
        ),
        setRow('Recommencer', 'Recrée les données de démonstration d’origine.', h('button', { class: 'btn btn-sm', type: 'button', onclick: () => location.reload() }, icon('refresh'), 'Réinitialiser')),
      ),

      h('p', { class: 'faint small about' }, `Control Vault ${__APP_VERSION__} — Phase 1, prototype`),
    );
  };

  function group(id: string, title: string, ...rows: HTMLElement[]) {
    return h('section', { class: 'set-group', id: `set-${id}`, 'aria-labelledby': `set-${id}-t` }, h('h2', { class: 'section-title', id: `set-${id}-t` }, title), h('div', { class: 'panel' }, rows));
  }

  render(store.get());
  void ctx;
  return {
    el,
    title: 'Réglages',
    update: (s, changed) => {
      if (changed.has('scenario') || changed.has('quota') || changed.has('apps')) render(s);
    },
  };
}
