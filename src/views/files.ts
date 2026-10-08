import { drive, importJson, OperationError, ROOT_ID, store } from '../app';
import { formatBytes, formatDateTime, formatRelative, shortHash } from '../core/format';
import type { State } from '../core/store';
import type { DriveItem } from '../core/types';
import { openRestore } from '../flows/sheets';
import { download, h, replace, staggered } from '../ui/dom';
import { icon } from '../ui/icons';
import { announce, openMenu, openSheet, setFoot, toast, type MenuItem } from '../ui/overlay';
import { emptyState, familyLabel, fileGlyph } from '../ui/parts';
import type { View, ViewContext } from './types';

type Filter = 'all' | 'vault' | 'json' | 'document' | 'image';
type Sort = 'name' | 'date' | 'size';
interface Mem {
  filter: Filter;
  sort: Sort;
  dir: 1 | -1;
  query: string;
  selected?: string;
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tout' },
  { id: 'vault', label: 'Sauvegardes' },
  { id: 'json', label: 'JSON' },
  { id: 'document', label: 'Documents' },
  { id: 'image', label: 'Images' },
];
const SORT_LABEL: Record<Sort, string> = { name: 'Nom', date: 'Date de modification', size: 'Taille' };

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

function pathOf(id: string, catalog: DriveItem[]): DriveItem[] {
  const byId = new Map(catalog.map((i) => [i.id, i]));
  const out: DriveItem[] = [];
  let cur = byId.get(id);
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

function downloadItem(item: DriveItem) {
  const bytes = drive.bytesOf(item.id);
  if (!bytes) return toast('Ce fichier n’a pas de contenu téléchargeable.', { kind: 'bad' });
  download(new Blob([bytes as BlobPart], { type: item.family === 'json' ? 'application/json' : 'application/octet-stream' }), item.name);
  toast(`${item.name} téléchargé`, { kind: 'ok' });
}

function details(item: DriveItem, s: State): HTMLElement {
  const version = item.versionId ? s.versions.find((v) => v.id === item.versionId) : undefined;
  const path = pathOf(item.parentId ?? ROOT_ID, s.catalog).map((p) => p.name).join(' / ');
  const text = item.kind === 'file' ? drive.textOf(item.id) : null;
  return h(
    'div',
    { class: 'details' },
    h('div', { class: 'details-head' }, fileGlyph(item), h('div', { class: 'row-main' }, h('h3', { class: 'details-name' }, item.name), h('p', { class: 'muted small' }, familyLabel(item)))),
    h(
      'dl',
      { class: 'kv' },
      item.sizeBytes !== undefined ? [h('dt', null, 'Taille'), h('dd', null, formatBytes(item.sizeBytes))] : null,
      h('dt', null, 'Modifié'),
      h('dd', null, formatDateTime(item.modifiedAt)),
      h('dt', null, 'Emplacement'),
      h('dd', null, path),
      version ? [h('dt', null, 'Version'), h('dd', null, version.id), h('dt', null, 'Chiffrement'), h('dd', null, 'AES-256-GCM'), h('dt', null, 'Empreinte'), h('dd', { title: version.sha256 }, shortHash(version.sha256))] : null,
      item.pinned ? [h('dt', null, 'Statut'), h('dd', null, 'Dossier d’origine, protégé')] : null,
    ),
    text !== null
      ? h('div', null, h('h4', { class: 'section-title' }, 'Aperçu'), h('pre', { class: 'code' }, text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text))
      : item.family === 'vault'
        ? h('p', { class: 'muted small', style: 'margin-top: var(--s4)' }, 'Contenu chiffré : l’aperçu passe par la restauration, après contrôle de l’empreinte.')
        : item.kind === 'file'
          ? h('p', { class: 'muted small', style: 'margin-top: var(--s4)' }, 'Aperçu non disponible pour ce format dans la démonstration.')
          : null,
  );
}

export function filesView(ctx: ViewContext): View {
  const mem = ctx.memory as Partial<Mem>;
  mem.filter ??= 'all';
  mem.sort ??= 'name';
  mem.dir ??= 1;
  mem.query ??= '';
  const folderId = ctx.params.id || ROOT_ID;
  const selection = new Set<string>();
  let selecting = false;
  let items: DriveItem[] | null = null;
  let error: string | null = null;
  const ctrl = new AbortController();

  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Fil d’Ariane' });
  const searchInput = h('input', {
    type: 'search',
    placeholder: 'Rechercher dans le coffre',
    'aria-label': 'Rechercher un fichier',
    value: mem.query,
    autocomplete: 'off',
    enterkeyhint: 'search',
  });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrer par type' });
  const sortBtn = h('button', { class: 'btn btn-sm btn-quiet', type: 'button', 'aria-haspopup': 'menu' });
  const viewBtns = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Affichage' });
  const selectBtn = h('button', { class: 'btn btn-sm btn-quiet', type: 'button' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  const importBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => fileInput.click() }, icon('upload'), 'Importer');
  const list = h('div', { class: 'file-list', 'aria-live': 'polite', 'aria-busy': 'true' });
  const detailPane = h('aside', { class: 'detail-pane panel', 'aria-label': 'Détails' });
  const selBar = h('div', { class: 'sel-bar', hidden: true, role: 'toolbar', 'aria-label': 'Actions sur la sélection' });

  const el = h(
    'div',
    { class: 'files' },
    h('div', { class: 'files-head' }, crumbs, h('div', { class: 'files-head-actions' }, importBtn)),
    h('div', { class: 'files-tools' }, h('label', { class: 'field search' }, icon('search'), searchInput), h('div', { class: 'tool-row' }, chips, h('div', { class: 'tool-end' }, sortBtn, selectBtn, viewBtns))),
    h('div', { class: 'files-body' }, h('div', { class: 'files-main' }, list), detailPane),
    selBar,
    fileInput,
  );

  const visible = (s: State): DriveItem[] => {
    const q = mem.query!.trim().toLocaleLowerCase('fr');
    let pool = q ? s.catalog.filter((i) => i.id !== ROOT_ID && i.name.toLocaleLowerCase('fr').includes(q)) : (items ?? []);
    if (mem.filter !== 'all') pool = pool.filter((i) => i.kind === 'file' && i.family === mem.filter);
    const dir = mem.dir!;
    return [...pool].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1; // dossiers d'abord
      if (mem.sort === 'date') return (a.modifiedAt - b.modifiedAt) * dir;
      if (mem.sort === 'size') return ((a.sizeBytes ?? 0) - (b.sizeBytes ?? 0)) * dir;
      return collator.compare(a.name, b.name) * dir;
    });
  };

  const itemMenu = (item: DriveItem): MenuItem[] => {
    const m: MenuItem[] = [];
    if (item.kind === 'folder') m.push({ label: 'Ouvrir', icon: 'folder', run: () => ctx.navigate(`#/fichiers/${item.id}`) });
    else {
      m.push({ label: 'Aperçu et détails', icon: 'eye', run: () => showDetails(item, true) });
      m.push({ label: 'Télécharger', icon: 'download', run: () => downloadItem(item) });
      if (item.versionId) m.push({ label: 'Restaurer cette version', icon: 'restore', run: () => openRestore(item.versionId!) });
    }
    m.push({ label: selecting ? 'Désélectionner' : 'Sélectionner', icon: 'select', run: () => { selecting = true; toggle(item.id); } });
    return m;
  };

  const showDetails = (item: DriveItem, forceSheet = false) => {
    mem.selected = item.id;
    const wide = matchMedia('(min-width: 1200px)').matches;
    if (wide && !forceSheet) {
      replace(detailPane, details(item, store.get()), item.kind === 'file' ? h('div', { class: 'btn-row', style: 'margin-top: var(--s4)' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => downloadItem(item) }, icon('download'), 'Télécharger'), item.versionId && h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openRestore(item.versionId!) }, icon('restore'), 'Restaurer')) : null);
      renderList(false);
      return;
    }
    const sheet = openSheet({ title: item.name, wide: true });
    sheet.body.append(details(item, store.get()));
    setFoot(
      sheet,
      h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Fermer'),
      item.kind === 'file' && h('button', { class: 'btn', type: 'button', onclick: () => downloadItem(item) }, icon('download'), 'Télécharger'),
      item.versionId && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { sheet.close(); setTimeout(() => openRestore(item.versionId!), 180); } }, icon('restore'), 'Restaurer'),
    );
  };

  const toggle = (id: string) => {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    if (!selection.size) selecting = false;
    renderTools();
    renderList(false);
    announce(`${selection.size} élément${selection.size > 1 ? 's' : ''} sélectionné${selection.size > 1 ? 's' : ''}`);
  };

  const rowFor = (item: DriveItem, s: State, showPath: boolean) => {
    const isSel = selection.has(item.id);
    const path = showPath ? pathOf(item.parentId ?? ROOT_ID, s.catalog).map((p) => p.name).join(' / ') : null;
    const open = () => {
      if (selecting) return toggle(item.id);
      if (item.kind === 'folder') ctx.navigate(`#/fichiers/${item.id}`);
      else showDetails(item);
    };
    const more = h('button', { class: 'icon-btn row-more', type: 'button', 'aria-label': `Actions pour ${item.name}`, 'aria-haspopup': 'menu' }, icon('more'));
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu(itemMenu(item), more, `Actions pour ${item.name}`);
    });
    const check = selecting && item.kind === 'file' ? h('input', { type: 'checkbox', class: 'check', checked: isSel, 'aria-label': `Sélectionner ${item.name}`, onclick: (e: Event) => { e.stopPropagation(); toggle(item.id); } }) : null;
    const main = h(
      'button',
      { class: 'file-open', type: 'button', onclick: open },
      fileGlyph(item),
      h(
        'span',
        { class: 'row-main' },
        h('span', { class: 'row-title' }, item.name),
        h(
          'span',
          { class: 'row-sub meta' },
          path ? h('span', null, path) : h('span', null, familyLabel(item)),
          h('span', null, formatRelative(item.modifiedAt)),
          item.sizeBytes !== undefined ? h('span', { class: 'num' }, formatBytes(item.sizeBytes)) : null,
        ),
      ),
      item.kind === 'folder' ? h('span', { class: 'row-end' }, icon('chevron')) : null,
    );

    // Tiroir d'actions révélé par glissement (non destructif)
    const tray = h(
      'div',
      { class: 'swipe-tray', 'aria-hidden': 'true' },
      item.kind === 'file' ? h('button', { type: 'button', tabindex: '-1', onclick: () => downloadItem(item) }, icon('download'), 'Télécharger') : null,
      h('button', { type: 'button', tabindex: '-1', onclick: () => (item.kind === 'folder' ? ctx.navigate(`#/fichiers/${item.id}`) : showDetails(item, true)) }, icon(item.kind === 'folder' ? 'folder' : 'eye'), item.kind === 'folder' ? 'Ouvrir' : 'Détails'),
    );
    const content = h('div', { class: 'file-row-content' }, check, main, more);
    const row = h('div', { class: 'file-row', role: 'listitem', dataset: { id: item.id, selected: String(isSel || mem.selected === item.id) } }, tray, content);
    attachGestures(row, content, () => openMenu(itemMenu(item), more, `Actions pour ${item.name}`));
    return row;
  };

  const renderTools = () => {
    replace(
      chips,
      FILTERS.map((f) =>
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(mem.filter === f.id), onclick: () => { mem.filter = f.id; renderTools(); renderList(true); } }, f.label),
      ),
    );
    replace(sortBtn, icon('sort'), h('span', { class: 'desktop-only' }, SORT_LABEL[mem.sort!]));
    sortBtn.setAttribute('aria-label', `Trier : ${SORT_LABEL[mem.sort!]}, ${mem.dir === 1 ? 'croissant' : 'décroissant'}`);
    const view = store.get().settings.view;
    replace(
      viewBtns,
      (['list', 'grid'] as const).map((v) =>
        h('button', { type: 'button', role: 'radio', 'aria-checked': String(view === v), 'aria-label': v === 'list' ? 'Liste' : 'Grille', onclick: () => { store.set({ settings: { ...store.get().settings, view: v } }); renderTools(); renderList(true); } }, icon(v)),
      ),
    );
    replace(selectBtn, selecting ? 'Terminé' : h('span', { class: 'sel-label' }, icon('select'), h('span', { class: 'desktop-only' }, 'Sélectionner')));
    selectBtn.setAttribute('aria-label', selecting ? 'Terminer la sélection' : 'Sélectionner des fichiers');
    selectBtn.setAttribute('aria-pressed', String(selecting));

    selBar.hidden = !selecting;
    if (selecting) {
      const chosen = store.get().catalog.filter((i) => selection.has(i.id));
      const vaults = chosen.filter((i) => i.versionId);
      replace(
        selBar,
        h('span', { class: 'num' }, `${selection.size} sélectionné${selection.size > 1 ? 's' : ''}`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-sm', type: 'button', disabled: !selection.size || undefined, onclick: () => chosen.forEach((it, i) => setTimeout(() => downloadItem(it), i * 350)) }, icon('download'), 'Télécharger'),
          h('button', {
            class: 'btn btn-sm', type: 'button', disabled: !vaults.length || undefined,
            onclick: async () => {
              let bad = 0;
              for (const it of vaults) {
                const v = store.get().versions.find((x) => x.id === it.versionId)!;
                const remote = await drive.remoteSha256(it.id).catch(() => '');
                if (remote !== v.sha256) bad++;
              }
              toast(bad ? `${bad} fichier(s) ne correspondent pas à leur empreinte` : `${vaults.length} sauvegarde${vaults.length > 1 ? 's' : ''} vérifiée${vaults.length > 1 ? 's' : ''}`, { kind: bad ? 'bad' : 'ok' });
            },
          }, icon('fingerprint'), 'Vérifier'),
        ),
      );
    }
  };

  const renderList = (animate: boolean) => {
    const s = store.get();
    list.setAttribute('aria-busy', String(items === null && !mem.query));
    renderCrumbs(s);
    if (error) {
      replace(list, emptyState({ icon: 'offline', title: 'Dossier indisponible', text: error, action: h('button', { class: 'btn', type: 'button', onclick: load }, icon('refresh'), 'Réessayer') }));
      return;
    }
    if (items === null && !mem.query) {
      replace(list, h('div', { class: 'skeleton panel', 'aria-label': 'Chargement du dossier' }, [0, 1, 2, 3, 4].map(() => h('div', { class: 'sk-row' }, h('div', { class: 'sk box' }), h('div', null, h('div', { class: 'sk w60' }), h('div', { class: 'sk w40' })), h('div', { class: 'sk' })))));
      return;
    }
    const rows = visible(s);
    if (!rows.length) {
      const searching = !!mem.query!.trim();
      replace(
        list,
        searching || (mem.filter !== 'all' && (items?.length ?? 0) > 0)
          ? emptyState({ icon: 'search', title: 'Aucun résultat', text: searching ? `Rien ne correspond à « ${mem.query} » dans le coffre.` : 'Aucun fichier de ce type dans ce dossier.', action: h('button', { class: 'btn', type: 'button', onclick: () => { mem.query = ''; mem.filter = 'all'; searchInput.value = ''; renderTools(); renderList(true); } }, 'Effacer les filtres') })
          : emptyState({ icon: 'folder', title: 'Ce dossier est vide', text: 'Importe un export JSON : il sera contrôlé, puis son empreinte vérifiée après l’envoi.', action: h('button', { class: 'btn btn-primary', type: 'button', onclick: () => fileInput.click() }, icon('upload'), 'Importer un fichier JSON') }),
      );
      return;
    }
    const grid = s.settings.view === 'grid';
    const nodes = rows.map((i) => rowFor(i, s, !!mem.query!.trim()));
    const container = h('div', { class: `panel file-rows${grid ? ' grid' : ''}${animate ? ' stagger' : ''}`, role: 'list', 'aria-label': mem.query ? 'Résultats de recherche' : 'Contenu du dossier' }, staggered(nodes));
    replace(list, mem.query ? h('p', { class: 'faint small', style: 'margin: 0 0 var(--s2) var(--s1)' }, `${rows.length} résultat${rows.length > 1 ? 's' : ''} dans tout le coffre`) : null, container);

    if (!detailPane.childElementCount || !mem.selected) {
      replace(detailPane, h('div', { class: 'detail-empty' }, icon('info'), h('p', { class: 'muted small' }, 'Sélectionne un fichier pour voir ses détails, son empreinte et un aperçu.')));
    }
  };

  const renderCrumbs = (s: State) => {
    const path = pathOf(folderId, s.catalog);
    replace(
      crumbs,
      h(
        'ol',
        null,
        path.map((p, i) =>
          h(
            'li',
            null,
            i < path.length - 1 ? h('a', { href: `#/fichiers/${p.id === ROOT_ID ? '' : p.id}` }, p.name) : h('span', { 'aria-current': 'page' }, p.name),
            i < path.length - 1 ? icon('chevron') : null,
          ),
        ),
      ),
    );
  };

  async function load() {
    error = null;
    items = null;
    renderList(false);
    try {
      items = await drive.list(folderId, ctrl.signal);
      renderList(true);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      const code = (e as { code?: string }).code;
      error = code === 'offline' ? 'Pas de connexion : le contenu de Drive ne peut pas être lu. Les fichiers déjà connus restent consultables via la recherche.' : code === 'auth-expired' ? 'Session Google expirée. Reconnecte-toi depuis le bandeau en haut de l’écran.' : 'Drive n’a pas répondu. Réessaie dans un instant.';
      renderList(false);
    }
  }

  searchInput.addEventListener('input', () => {
    mem.query = searchInput.value;
    renderList(false);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchInput.value) {
      e.stopPropagation();
      searchInput.value = '';
      mem.query = '';
      renderList(false);
    }
  });
  sortBtn.addEventListener('click', () =>
    openMenu(
      [
        ...(['name', 'date', 'size'] as Sort[]).map((k) => ({ label: `${SORT_LABEL[k]}${mem.sort === k ? (mem.dir === 1 ? ' (croissant)' : ' (décroissant)') : ''}`, icon: mem.sort === k ? 'check' : 'sort', run: () => { if (mem.sort === k) mem.dir = mem.dir === 1 ? -1 : 1; else { mem.sort = k; mem.dir = k === 'name' ? 1 : -1; } renderTools(); renderList(true); } })),
      ],
      sortBtn,
      'Trier',
    ),
  );
  selectBtn.addEventListener('click', () => {
    selecting = !selecting;
    if (!selecting) selection.clear();
    renderTools();
    renderList(false);
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const target = folderId;
    toast(`Import de ${file.name}…`, { kind: 'info', duration: 2000 });
    try {
      const { item } = await importJson(file, target);
      toast(`${item.name} importé et vérifié`, { kind: 'ok' });
      if (target === folderId) {
        items = await drive.list(folderId);
        mem.selected = item.id;
        renderList(false);
      }
    } catch (e) {
      toast(e instanceof OperationError ? `Import refusé : ${e.message}` : 'Import impossible.', { kind: 'bad' });
    }
  });

  renderTools();
  load();

  const onSlash = (e: KeyboardEvent) => {
    if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      searchInput.focus();
    }
  };
  document.addEventListener('keydown', onSlash);

  return {
    el,
    title: pathOf(folderId, store.get().catalog).at(-1)?.name ?? 'Fichiers',
    update: (s, changed) => {
      if (changed.has('catalog')) renderList(false);
      if (changed.has('connectivity') && error && s.connectivity.online) load();
    },
    destroy: () => {
      ctrl.abort();
      document.removeEventListener('keydown', onSlash);
    },
  };
}

/** Appui long → menu ; glissement vers la gauche → tiroir d'actions. Alternatives visibles : bouton « … ». */
function attachGestures(row: HTMLElement, content: HTMLElement, onLongPress: () => void) {
  let x0 = 0;
  let y0 = 0;
  let dx = 0;
  let timer = 0;
  let mode: 'idle' | 'swipe' | 'scroll' = 'idle';
  let open = false;
  const TRAY = 168;

  const set = (x: number, animate: boolean) => {
    content.style.transition = animate ? 'transform 200ms cubic-bezier(.2,.7,.2,1)' : 'none';
    content.style.transform = x ? `translateX(${x}px)` : '';
  };

  row.addEventListener(
    'touchstart',
    (e) => {
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      dx = 0;
      mode = 'idle';
      timer = window.setTimeout(() => {
        if (mode === 'idle') {
          navigator.vibrate?.(10);
          onLongPress();
        }
      }, 520);
    },
    { passive: true },
  );
  row.addEventListener(
    'touchmove',
    (e) => {
      const mx = e.touches[0].clientX - x0;
      const my = e.touches[0].clientY - y0;
      if (mode === 'idle' && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
        clearTimeout(timer);
        mode = Math.abs(mx) > Math.abs(my) ? 'swipe' : 'scroll';
      }
      if (mode !== 'swipe') return;
      dx = Math.min(0, Math.max(-TRAY - 24, mx + (open ? -TRAY : 0)));
      set(dx, false);
    },
    { passive: true },
  );
  row.addEventListener('touchend', () => {
    clearTimeout(timer);
    if (mode !== 'swipe') return;
    open = dx < -TRAY / 2;
    set(open ? -TRAY : 0, true);
    row.dataset.swiped = String(open);
  });
  row.addEventListener('contextmenu', (e) => {
    if (matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      onLongPress();
    }
  });
}
