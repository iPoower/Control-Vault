import '@fontsource-variable/instrument-sans/wdth.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/views.css';

import { boot, reconnectGoogle, refreshConnectivity, setScenario, store } from './app';
import type { State } from './core/store';
import { h, replace } from './ui/dom';
import { icon, logo } from './ui/icons';
import { announce, closeMenu, openSheet } from './ui/overlay';
import { openPalette } from './ui/palette';
import { appDetailView, appsView } from './views/apps';
import { dashboardView } from './views/dashboard';
import { filesView } from './views/files';
import { historyView } from './views/history';
import { globalStatus } from './views/selectors';
import { securityView } from './views/security';
import { settingsView } from './views/settings';
import { driveView } from './views/drive';
import { connectedDrive } from './services/connected-drive';
import { inspectOfflineElements, type OfflineDiagnostic } from './services/offline-diagnostic';
import type { View, ViewContext } from './views/types';

// ─── Routes ────────────────────────────────────────────────────────────────

interface Route {
  key: string;
  nav: string;
  match: RegExp;
  make: (ctx: ViewContext) => View;
}

const ROUTES: Route[] = [
  { key: 'drive', nav: 'drive', match: /^\/drive\/?$/, make: driveView },
  { key: 'home', nav: 'home', match: /^\/?$/, make: dashboardView },
  { key: 'files', nav: 'files', match: /^\/fichiers(?:\/(?<id>[\w-]+))?\/?$/, make: filesView },
  { key: 'app', nav: 'apps', match: /^\/applis\/(?<id>[\w-]+)\/?$/, make: appDetailView },
  { key: 'apps', nav: 'apps', match: /^\/applis\/?$/, make: appsView },
  { key: 'history', nav: 'history', match: /^\/historique\/?$/, make: historyView },
  { key: 'security', nav: 'security', match: /^\/securite\/?$/, make: securityView },
  { key: 'settings', nav: 'settings', match: /^\/reglages\/?$/, make: settingsView },
];

const NAV = [
  { id: 'home', label: 'Accueil', icon: 'home', href: '#/', mobile: true },
  { id: 'drive', label: 'Google Drive', icon: 'folder', href: '#/drive', mobile: false },
  { id: 'files', label: 'Fichiers', icon: 'folder', href: '#/fichiers', mobile: true },
  { id: 'apps', label: 'Applications', short: 'Applis', icon: 'apps', href: '#/applis', mobile: true },
  { id: 'history', label: 'Historique', icon: 'history', href: '#/historique', mobile: true },
  { id: 'security', label: 'Sécurité', icon: 'shield', href: '#/securite', mobile: false },
  { id: 'settings', label: 'Réglages', icon: 'settings', href: '#/reglages', mobile: true },
];

// ─── Coquille ──────────────────────────────────────────────────────────────

const viewEl = h('main', { id: 'main', class: 'view', tabindex: '-1' });
const banners = h('div', { class: 'banners', role: 'region', 'aria-label': 'État du système' });
const topTitle = h('span', { class: 'topbar-title' });
const topStatus = h('a', { class: 'top-status mobile-only', href: '#/', 'aria-label': 'État global' });
const searchMobile = h('button', { class: 'icon-btn mobile-only', type: 'button', 'aria-label': 'Recherche rapide', onclick: () => openPalette(navigate) }, icon('search'));
const sideNav = h('nav', { class: 'side-nav', 'aria-label': 'Navigation principale' });
const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Navigation principale' });
const sideFoot = h('div', { class: 'side-foot' });
const topbar = h('header', { class: 'topbar' }, h('span', { class: 'brand-mini mobile-only' }, logo(26)), topTitle, topStatus, searchMobile);
const testDiagnostic = import.meta.env.MODE === 'fortress-test';
const offlineDiagnostic = h('div', { id: 'offline-diagnostic', class: 'banner banner-demo', role: 'status', 'aria-live': 'polite' });

const shell = h(
  'div',
  { class: 'shell' },
  h(
    'aside',
    { class: 'sidebar' },
    h('div', { class: 'brand' }, logo(32), h('span', { class: 'brand-name' }, 'Control Vault', h('span', { class: 'brand-sub' }, 'Stockage et sauvegardes'))),
    h('button', { class: 'search-trigger', type: 'button', onclick: () => openPalette(navigate), 'aria-label': 'Recherche rapide' }, icon('search'), h('span', null, 'Rechercher'), h('kbd', null, /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K')),
    sideNav,
    sideFoot,
  ),
  h('div', { class: 'main-col' }, topbar, testDiagnostic && offlineDiagnostic, banners, viewEl,
    h('nav', { class: 'app-links', 'aria-label': 'Mes applications' },
      h('strong', null, 'Mes applications'),
      h('div', null,
        h('a', { href: import.meta.env.MODE === 'fortress-test' ? 'https://rc-drive-test-ipoower.pages.dev/' : 'https://race-control-ipoower.pages.dev/', target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Race Control (nouvel onglet)' }, 'Race Control ↗'),
        h('span', { 'aria-current': 'page' }, 'Control Vault'),
        import.meta.env.MODE !== 'fortress-test' && h('a', { href: 'https://ipoower.github.io/Reconversion-Control/', target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Reconversion Control (nouvel onglet)' }, 'Reconversion Control ↗'),
      ),
    ),
  ),
);

document.body.append(
  h('a', { class: 'skip-link', href: '#main', onclick: (e: Event) => { e.preventDefault(); viewEl.focus(); } }, 'Aller au contenu'),
  shell,
  tabbar,
  h('div', { id: 'toasts', class: 'toasts' }),
  h('div', { id: 'sr-status', class: 'sr-only', role: 'status', 'aria-live': 'polite' }),
);

// ─── Thème ─────────────────────────────────────────────────────────────────

function applySettings(s: State) {
  const root = document.documentElement;
  if (s.settings.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = s.settings.theme;
  if (s.settings.motion === 'reduced') root.dataset.motion = 'reduced';
  else delete root.dataset.motion;
  const meta = document.querySelector('meta[name="theme-color"]:not([media])') as HTMLMetaElement | null;
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || '#121920';
}

// ─── Navigation ────────────────────────────────────────────────────────────

const memories = new Map<string, Record<string, unknown>>();
const scrolls = new Map<string, number>();
let current: { view: View; hash: string; nav: string } | null = null;
let firstPaint = true;

function navigate(hash: string) {
  if (location.hash === hash || (hash === '#/' && !location.hash)) render();
  else location.hash = hash;
}

function parse(): { route: Route; params: Record<string, string>; path: string } {
  const path = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  for (const route of ROUTES) {
    const m = path.match(route.match);
    if (m) return { route, params: { ...(m.groups ?? {}) } as Record<string, string>, path };
  }
  return { route: ROUTES[0], params: {}, path: '/' };
}

function render() {
  const { route, params, path } = parse();
  if (current) {
    scrolls.set(current.hash, window.scrollY);
    current.view.destroy?.();
  }
  closeMenu();
  const memKey = route.key === 'files' ? 'files' : path; // filtres des fichiers partagés entre dossiers
  if (!memories.has(memKey)) memories.set(memKey, {});
  const ctx: ViewContext = { params, memory: memories.get(memKey)!, firstPaint, navigate };
  const view = route.make(ctx);

  const swap = () => {
    viewEl.replaceChildren(view.el);
    if (!firstPaint) {
      view.el.classList.add('view-enter');
      view.el.addEventListener('animationend', () => view.el.classList.remove('view-enter'), { once: true });
    }
    window.scrollTo(0, scrolls.get(path) ?? 0);
  };
  swap();
  const isFirst = firstPaint;
  firstPaint = false;
  current = { view, hash: path, nav: route.nav };
  topTitle.textContent = view.title;
  document.title = route.key === 'home' ? 'Control Vault' : `${view.title} — Control Vault`;
  paintNav(store.get());
  paintBanners(store.get());
  if (!isFirst) {
    viewEl.focus({ preventScroll: true });
    announce(view.title);
  }
}

function paintNav(s: State) {
  const realDrive = current?.nav === 'drive';
  const st = globalStatus(s);
  const failures = s.events.filter((e) => e.result === 'failed' && !e.resolved).length;
  const health = st.level === 'ok' ? 'verified' : st.level === 'action' ? 'failed' : st.level === 'attention' ? 'stale' : 'unknown';
  replace(
    sideNav,
    NAV.map((n) =>
      h(
        'a',
        { class: 'side-link', href: n.href, 'aria-current': current?.nav === n.id ? 'page' : undefined, dataset: n.id === 'home' ? { health } : undefined },
        icon(n.icon),
        n.label,
        n.id === 'home' ? h('span', { class: 'dot', 'aria-hidden': 'true' }) : n.id === 'history' && failures ? h('span', { class: 'count num', 'aria-label': `${failures} échec(s)` }, String(failures)) : null,
      ),
    ),
  );
  replace(
    tabbar,
    NAV.filter((n) => n.mobile).map((n) =>
      h(
        'a',
        { class: 'tab', href: n.href, 'aria-current': current?.nav === n.id || (n.id === 'settings' && current?.nav === 'security') ? 'page' : undefined, dataset: n.id === 'home' ? { health } : undefined },
        h('span', { class: 'tab-icon' }, icon(n.icon), n.id === 'home' && health !== 'verified' ? h('span', { class: 'tab-dot', 'aria-hidden': 'true' }) : null),
        n.short ?? n.label,
      ),
    ),
  );
  replace(topStatus, h('span', { class: 'pill', dataset: { health } }, st.level === 'ok' ? 'Vérifié' : st.level === 'action' ? 'Action' : st.level === 'attention' ? 'À voir' : 'Hors ligne'));
  topStatus.setAttribute('aria-label', `État global : ${st.title}`);
  if (realDrive) { replace(topStatus, h('span', { class: 'pill' }, 'Google Drive')); topStatus.setAttribute('aria-label', 'Google Drive'); }
  replace(sideFoot, h('span', null, h('span', { class: 'pill', dataset: { health } }, st.level === 'ok' ? 'Vérifié' : st.level === 'action' ? 'Action requise' : st.level === 'attention' ? 'À surveiller' : 'Hors ligne')), h('span', { class: 'side-status' }, st.title), h('span', null, 'Démonstration, données fictives'));
  if (realDrive) replace(sideFoot, h('span', null, 'Copies opaques Race Control'), h('span', { class: 'side-status' }, connectedDrive.state.message));
}

// ─── Bandeaux contextuels ──────────────────────────────────────────────────

function paintBanners(s: State) {
  const items: HTMLElement[] = [];
  if (current?.nav === 'drive') {
    replace(banners, h('div', { class: 'banner' }, icon('shield'), h('p', null, 'Espace Google Drive : copies opaques Race Control. Aucun code de déchiffrement dans Control Vault.')));
    return;
  }
  const c = s.connectivity;
  if (!c.online) {
    items.push(h('div', { class: 'banner', dataset: { health: 'unknown' } }, icon('offline'), h('p', null, s.queue.length ? 'Hors ligne. Une sauvegarde attend le retour du réseau.' : 'Hors ligne. Les sauvegardes et restaurations reprendront au retour du réseau.')));
  } else if (c.google === 'expired') {
    items.push(h('div', { class: 'banner', dataset: { health: 'failed' } }, icon('alert'), h('p', null, 'Session Google expirée. Rien n’est perdu : reconnecte-toi pour reprendre.'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => reconnectGoogle() }, 'Se reconnecter')));
  } else if (s.busy) {
    const app = s.busy.appId ? s.apps[s.busy.appId].name : 'toutes les versions';
    const label = s.busy.kind === 'backup' ? `Sauvegarde de ${app} en cours…` : s.busy.kind === 'restore' ? `Restauration de ${app} en cours…` : 'Contrôle d’intégrité en cours…';
    items.push(h('div', { class: 'banner', dataset: { health: 'pending' } }, h('span', { class: 'spinner', style: 'color: var(--info)' }), h('p', null, label)));
  }
  if (s.scenario !== 'normal' && c.online) {
    items.push(h('div', { class: 'banner banner-demo' }, icon('info'), h('p', null, 'Situation simulée active.'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => setScenario('normal') }, 'Revenir à la normale')));
  }
  // Mode démonstration : signalé sur tous les écrans, sans exception.
  items.push(h('div', { class: 'banner banner-demo' }, icon('info'), h('p', null, 'Démonstration : données fictives, aucune connexion à Google ni à Supabase.')));
  replace(banners, ...items);
}

// ─── Raccourcis clavier ────────────────────────────────────────────────────

function showShortcuts() {
  const sheet = openSheet({ title: 'Raccourcis clavier' });
  const k = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const rows: [string, string][] = [
    [`${k} K`, 'Recherche rapide'],
    ['/', 'Rechercher dans les fichiers'],
    ['G puis A', 'Accueil'],
    ['G puis F', 'Fichiers'],
    ['G puis H', 'Historique'],
    ['Échap', 'Fermer une fenêtre ou un menu'],
    ['?', 'Afficher cette aide'],
  ];
  sheet.body.append(h('dl', { class: 'kv shortcuts' }, rows.map(([key, what]) => [h('dt', null, what), h('dd', null, h('kbd', null, key))])));
}

let gPending = 0;
document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette(navigate);
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.key === '?') return showShortcuts();
  if (e.key.toLowerCase() === 'g') {
    gPending = Date.now();
    return;
  }
  if (Date.now() - gPending < 900) {
    const map: Record<string, string> = { a: '#/', f: '#/fichiers', h: '#/historique', p: '#/applis', s: '#/securite', r: '#/reglages' };
    const to = map[e.key.toLowerCase()];
    gPending = 0;
    if (to) navigate(to);
  }
});

// ─── Démarrage ─────────────────────────────────────────────────────────────

store.subscribe((s, changed) => {
  if (changed.has('settings')) applySettings(s);
  paintNav(s);
  paintBanners(s);
  current?.view.update?.(s, changed);
});

window.addEventListener('hashchange', render);
window.addEventListener('online', () => refreshConnectivity());
window.addEventListener('offline', () => refreshConnectivity());
window.addEventListener(
  'scroll',
  () => {
    topbar.dataset.scrolled = String(window.scrollY > 4);
  },
  { passive: true },
);
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applySettings(store.get()));

applySettings(store.get());
viewEl.append(h('div', { class: 'boot', 'aria-busy': 'true', 'aria-label': 'Ouverture du coffre' }, h('div', { class: 'sk', style: 'width: 180px; height: 180px; border-radius: 50%; margin: 24px auto' })));

connectedDrive.subscribe(() => { if (current?.nav === 'drive') { paintNav(store.get()); paintBanners(store.get()); } });
void connectedDrive.init();
window.addEventListener('pagehide', () => connectedDrive.disconnect());
boot()
  .then(() => {
    render();
    paintBanners(store.get());
  })
  .catch(() => {
    const crypto = !!globalThis.crypto?.subtle;
    replace(
      viewEl,
      h(
        'div',
        { class: 'empty', role: 'alert' },
        h('h1', null, 'Ouverture impossible'),
        h('p', null, crypto ? 'Le coffre de démonstration n’a pas pu démarrer. Recharge la page ; aucun succès de sauvegarde n’est confirmé.' : 'Ce navigateur ne fournit pas les fonctions de chiffrement nécessaires (Web Crypto). Ouvre Control Vault dans Safari ou un navigateur récent, en HTTPS.'),
      ),
    );
  });

// Service worker : uniquement en production et hors aperçu intégré.
const canRegisterWorker = 'serviceWorker' in navigator && import.meta.env.PROD && location.protocol === 'https:' && !location.hostname.endsWith('claude.ai') && !location.hostname.includes('claudeusercontent');
let diagnosticRevision = 0;
const diagnosticText: Record<OfflineDiagnostic, string> = {
  'unsupported': 'Contrôle hors ligne : navigateur non compatible ou stockage indisponible.',
  'not-registered': 'Contrôle hors ligne : préparation non confirmée.',
  'not-active': 'Contrôle hors ligne : préparation non terminée.',
  'not-controlling': 'Contrôle hors ligne : service non actif sur cette page.',
  'wrong-worker': 'Contrôle hors ligne : service inattendu.',
  'cache-missing': 'Contrôle hors ligne : cache de l’interface absent.',
  'shell-invalid': 'Contrôle hors ligne : page locale absente ou non vérifiée.',
  'assets-missing': 'Contrôle hors ligne : fichiers de l’interface manquants.',
  'local-elements-present': 'Contrôle local : service actif et fichiers de l’interface présents. Redémarrage hors ligne à vérifier.',
  'unavailable': 'Contrôle hors ligne : vérification indisponible.',
};
async function refreshOfflineDiagnostic() {
  if (!testDiagnostic) return;
  const revision = ++diagnosticRevision;
  let timer = 0;
  const check = Promise.resolve().then(async () => {
    const scope = new URL('./', location.href);
    const assets = [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel="stylesheet"][href]')]
      .map((element) => new URL(element instanceof HTMLScriptElement ? element.src : element.href, scope))
      .filter((url) => url.origin === scope.origin && url.pathname.startsWith(scope.pathname + 'assets/'))
      .map((url) => url.href);
    return inspectOfflineElements('serviceWorker' in navigator ? navigator.serviceWorker : undefined, 'caches' in window ? window.caches : undefined, scope.href, assets);
  }).catch((): OfflineDiagnostic => 'unavailable');
  const timeout = new Promise<OfflineDiagnostic>((done) => { timer = window.setTimeout(() => done('unavailable'), 6000); });
  const result = await Promise.race([check, timeout]);
  window.clearTimeout(timer);
  if (revision !== diagnosticRevision) return;
  offlineDiagnostic.dataset.diagnostic = result;
  replace(offlineDiagnostic, icon(result === 'local-elements-present' ? 'info' : 'alert'), h('p', null, diagnosticText[result]));
}
if (testDiagnostic) {
  replace(offlineDiagnostic, icon('info'), h('p', null, 'Contrôle hors ligne : vérification en cours.'));
  if ('serviceWorker' in navigator) {
    let watchedController: ServiceWorker | null = null;
    const watchController = () => {
      const controller = navigator.serviceWorker.controller;
      if (controller && controller !== watchedController) {
        watchedController = controller;
        controller.addEventListener('statechange', () => void refreshOfflineDiagnostic());
      }
      void refreshOfflineDiagnostic();
    };
    navigator.serviceWorker.addEventListener('controllerchange', watchController);
    watchController();
  }
  window.addEventListener('pageshow', () => void refreshOfflineDiagnostic());
  window.setTimeout(() => void refreshOfflineDiagnostic(), 12000);
}
if (canRegisterWorker && !testDiagnostic) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
} else if (canRegisterWorker) {
  const registerWorker = () => {
    void navigator.serviceWorker.register('./sw.js').then((registration) => {
      const watch = () => registration.installing?.addEventListener('statechange', () => void refreshOfflineDiagnostic());
      registration.addEventListener('updatefound', watch);
      watch();
      void refreshOfflineDiagnostic();
    }).catch(() => void refreshOfflineDiagnostic());
  };
  window.addEventListener('load', registerWorker, { once: true });
} else if (testDiagnostic) {
  void refreshOfflineDiagnostic();
}
