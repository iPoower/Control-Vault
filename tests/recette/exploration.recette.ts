// Recette Phase T — exploration systématique : chaque bouton, lien et champ visible de chaque écran
// est activé un par un, avec réinitialisation complète de l'état avant chaque élément.
import { test, type Page } from '@playwright/test';
import { arm, inventory, probe, SAMPLE_TEXTS, type Found } from './explore';
import type { MatrixRow, Verdict } from './recorder';
import { clearOrigin, openApp, settle, startSession } from './session';
import { explain } from './error-rules';

interface Screen { id: string; hash: string; steps: string[]; depth: number }
// États réels de l'écran Google Drive, atteints par les boutons de l'interface (clé d'inventaire).
const DRIVE: Screen[] = [
  { id: 'Google Drive · initial', hash: '#/drive', steps: [], depth: 0 },
  { id: 'Google Drive · connexion préparée', hash: '#/drive', steps: ['bouton|Préparer la connexion Google#1'], depth: 0 },
  { id: 'Google Drive · compte affiché', hash: '#/drive', steps: ['bouton|Préparer la connexion Google#1', 'bouton|Se connecter à Google#1'], depth: 0 },
  { id: 'Google Drive · compte confirmé', hash: '#/drive', steps: ['bouton|Préparer la connexion Google#1', 'bouton|Se connecter à Google#1', 'bouton|Confirmer ce compte dédié#1'], depth: 0 },
  { id: 'Google Drive · dossiers listés', hash: '#/drive', steps: ['bouton|Préparer la connexion Google#1', 'bouton|Se connecter à Google#1', 'bouton|Confirmer ce compte dédié#1', 'bouton|Retrouver les dossiers dédiés#1'], depth: 0 },
  { id: 'Google Drive · dossier sélectionné, versions listées', hash: '#/drive', steps: ['bouton|Préparer la connexion Google#1', 'bouton|Se connecter à Google#1', 'bouton|Confirmer ce compte dédié#1', 'bouton|Retrouver les dossiers dédiés#1', 'bouton|Utiliser ce dossier#1', 'bouton|Actualiser les versions#1'], depth: 0 },
];
// Groupes indépendants (un test chacun) pour paralléliser ; chaque groupe possède ses préfixes de route
// et explore aussi les routes et fenêtres qu'il découvre dans ce périmètre.
const GROUPS: { name: string; owns: RegExp; screens: Screen[] }[] = [
  { name: 'accueil', owns: /^#\/$/, screens: [{ id: 'Accueil', hash: '#/', steps: [], depth: 0 }] },
  { name: 'google-drive', owns: /^#\/drive/, screens: DRIVE },
  { name: 'fichiers-applications', owns: /^#\/(fichiers|applis)/, screens: [{ id: 'Fichiers', hash: '#/fichiers', steps: [], depth: 0 }, { id: 'Applications', hash: '#/applis', steps: [], depth: 0 }] },
  { name: 'historique-securite-reglages', owns: /^#\/(historique|securite|reglages)/, screens: [
    { id: 'Historique', hash: '#/historique', steps: [], depth: 0 }, { id: 'Sécurité', hash: '#/securite', steps: [], depth: 0 },
    { id: 'Réglages', hash: '#/reglages', steps: [], depth: 0 }] },
];
const MAX_SCREENS = Number(process.env.RECETTE_MAX_SCREENS || 30); // par groupe
const MAX_DIALOG_DEPTH = 2;
const BUDGET_MS = Number(process.env.RECETTE_EXPLORE_MS || 30 * 60_000); // par groupe

async function replay(page: Page, s: Screen) {
  for (const key of s.steps) {
    const inv = await inventory(page);
    const f = inv.find((x) => x.key === key);
    if (!f) throw new Error(`Étape introuvable « ${key} » pour l’écran « ${s.id} »`);
    await page.locator(`[data-recette-idx="${f.idx}"]`).click({ timeout: 5000 });
    await settle(page);
  }
}

for (const group of GROUPS) test(`exploration systématique · ${group.name}`, async ({ context, page }, info) => {
  test.setTimeout(BUDGET_MS + 10 * 60_000);
  const { rec, fake, stop } = await startSession(context, page, info, 'exploration-' + group.name);
  const rows: MatrixRow[] = [];
  const screens: (Screen & { found: number; tested: number; error?: string })[] = [];
  const queue: Screen[] = [...group.screens];
  const known = new Set(queue.map((s) => s.id));
  const knownHashes = new Set(queue.map((s) => s.hash));
  const dialogTitles = new Set<string>();
  const t0 = Date.now();
  const packet = fake.seeds[0].bytes; // sauvegarde chiffrée fictive pour tout sélecteur de fichier
  const reset = async (s: Screen) => {
    fake.reset();
    await clearOrigin(page);
    await openApp(page, s.hash);
    await settle(page, 1000);
    await replay(page, s);
  };
  try {
    while (queue.length) {
      const screen = queue.shift()!;
      rec.context = screen.id;
      let list: Found[];
      try { await reset(screen); list = await inventory(page); }
      catch (e) { screens.push({ ...screen, found: 0, tested: 0, error: String((e as Error).message).slice(0, 300) }); continue; }
      await rec.shot(page, screen.id + ' (écran)');
      const entry = { ...screen, found: list.length, tested: 0 };
      screens.push(entry);
      for (const item of list) {
        const row: MatrixRow = { browser: rec.browser, screen: screen.id, element: item.label, kind: item.kind, selector: item.selector, result: 'NON TESTABLE', detail: '' };
        rows.push(row);
        if (Date.now() - t0 > BUDGET_MS) { row.detail = 'non exécuté : budget de temps de l’exploration épuisé'; continue; }
        if (item.external) { row.detail = `lien externe (${item.href}) : non suivi, navigation externe bloquée`; continue; }
        rec.context = `${screen.id} › ${item.label}`;
        const started = Date.now();
        try {
          await reset(screen);
          const cur = (await inventory(page)).find((x) => x.key === item.key);
          if (!cur) { row.detail = 'élément transitoire : absent après réinitialisation (flux animé déjà avancé ou terminé), non rejouable de façon fiable'; continue; }
          if (cur.disabled) {
            row.result = cur.explanation ? 'OK' : 'DÉSACTIVÉ-SANS-EXPLICATION';
            row.detail = cur.explanation ? `désactivé, explication visible (${cur.explanation})` : 'désactivé, aucune explication visible (ni aria-describedby, ni title, ni texte d’aide voisin)';
            entry.tested++; row.screenshot = await rec.shot(page, `${screen.id} ${item.label} désactivé`); continue;
          }
          const before = await probe(page, cur.idx);
          const focusOf = (i: number) => page.evaluate((x) => { const a = document.activeElement; return !a || a === document.body ? 'body' : a.getAttribute('data-recette-idx') === String(x) ? 'cible' : a.outerHTML.slice(0, 80); }, i).catch(() => '');
          const focusBefore = await focusOf(cur.idx);
          const errorsBefore = rec.errors.length;
          const events: string[] = [];
          const onDownload = (d: { suggestedFilename(): string }) => events.push('téléchargement ' + d.suggestedFilename());
          const onPopup = (p: Page) => { events.push('nouvel onglet ' + p.url()); void p.close().catch(() => {}); };
          const onChooser = (c: { setFiles(f: unknown): Promise<void> }) => { events.push('sélecteur de fichier ouvert'); void c.setFiles({ name: 'recette-fictive.json', mimeType: 'application/json', buffer: packet }).catch(() => {}); };
          const onLoad = () => events.push('page rechargée');
          page.on('download', onDownload); page.on('popup', onPopup); page.on('filechooser', onChooser); page.on('load', onLoad);
          await arm(page);
          const target = page.locator(`[data-recette-idx="${cur.idx}"]`);
          let typed: string | null = null;
          try {
            if (/^champ:(text|search|email|url|tel|password|number)$|^zone-texte$/.test(cur.kind)) {
              typed = cur.kind === 'champ:number' ? '42' : SAMPLE_TEXTS[rows.length % SAMPLE_TEXTS.length];
              await target.fill(typed, { timeout: 5000 });
            } else if (cur.kind === 'liste') {
              await target.selectOption({ index: 1 }, { timeout: 5000 }).catch(() => target.selectOption({ index: 0 }));
            } else if (cur.kind === 'champ:file') {
              await target.setInputFiles({ name: 'recette-fictive.json', mimeType: 'application/json', buffer: packet });
            } else {
              // Élément hors écran tant qu'il n'a pas le focus (lien d'évitement) : activation au clavier, comme un utilisateur.
              const keyboard = async (why: string) => { await target.focus(); await page.keyboard.press('Enter'); events.push('activé au clavier (' + why + ')'); };
              if (cur.offscreen) await keyboard('placé hors écran tant qu’il n’a pas le focus');
              else {
                try { await target.click({ timeout: 4000 }); }
                catch (e) {
                  if (!/Timeout|outside of the viewport|intercepts pointer/.test(String(e))) throw e;
                  await keyboard('clic souris impossible : ' + String((e as Error).message).split('\n')[0].replace(/^locator\.click: /, '').slice(0, 60));
                }
              }
            }
          } catch (e) {
            row.result = 'KO'; row.detail = 'action impossible : ' + String((e as Error).message).split('\n')[0].slice(0, 200);
          }
          await settle(page);
          const after = await probe(page, cur.idx);
          const focusAfter = await focusOf(cur.idx);
          page.off('download', onDownload); page.off('popup', onPopup); page.off('filechooser', onChooser); page.off('load', onLoad);
          const errs = rec.since(errorsBefore);
          row.screenshot = await rec.shot(page, `${screen.id} ${item.label}`);
          entry.tested++;
          if (row.result === 'KO') continue;
          const signals: string[] = [...events];
          if (after.hash !== before.hash) signals.push('navigation vers ' + after.hash);
          if (after.dialogs > before.dialogs) signals.push('fenêtre ouverte « ' + after.dialogTitle + ' »');
          if (after.dialogs < before.dialogs) signals.push('fenêtre fermée');
          if (after.mutations > 0) signals.push(after.mutations + ' modification(s) du DOM');
          if (after.scrolled) signals.push('défilement');
          if (focusAfter !== focusBefore && focusAfter !== 'cible' && focusAfter !== 'body') signals.push('focus déplacé vers ' + focusAfter.replace(/\s+/g, ' ').slice(0, 60));
          if (typed !== null && after.value !== null) signals.push(`saisie acceptée (${after.value.length} car.)`);
          let verdict: Verdict = 'OK';
          const unexplained = errs.filter((e) => !explain(e).expected);
          if (errs.length > unexplained.length) signals.push(`${errs.length - unexplained.length} erreur(s) console attendue(s) (voir errors.json)`);
          let detail = signals.join(' ; ');
          if (unexplained.length) { verdict = 'KO'; detail = `${unexplained.length} erreur(s) inexpliquée(s) : ` + unexplained.map((e) => `[${e.type}] ${e.text}`).join(' | ').slice(0, 400) + (detail ? ' — ' + detail : ''); }
          else if (!signals.length) {
            if (cur.current) detail = 'lien vers l’écran déjà affiché : aucune action attendue';
            else { verdict = 'KO'; detail = 'aucune réaction visible (ni DOM, ni navigation, ni défilement, ni téléchargement)'; }
          }
          row.result = verdict; row.detail = detail;
          // Découverte : nouvel écran (route) ou nouvelle fenêtre modale à explorer à son tour.
          if (known.size < MAX_SCREENS) {
            if (after.hash !== before.hash && !knownHashes.has(after.hash) && group.owns.test(after.hash)) {
              const id = 'Route ' + after.hash; knownHashes.add(after.hash); known.add(id); queue.push({ id, hash: after.hash, steps: [], depth: 0 });
            } else if (after.dialogs > before.dialogs && screen.depth < MAX_DIALOG_DEPTH) {
              // Une même fenêtre (même titre) n'est explorée qu'une fois par groupe, depuis le premier écran qui l'ouvre.
              const title = after.dialogTitle || item.label, id = `${screen.id} › fenêtre « ${title} »`;
              if (!dialogTitles.has(title)) { dialogTitles.add(title); known.add(id); queue.push({ id, hash: screen.hash, steps: [...screen.steps, item.key], depth: screen.depth + 1 }); }
            }
          }
        } catch (e) {
          row.result = 'KO'; row.detail = 'erreur du banc de recette : ' + String((e as Error).message).split('\n')[0].slice(0, 200);
        } finally {
          row.ms = Date.now() - started;
          if (process.env.RECETTE_DEBUG) console.log(`${row.ms} ms · ${screen.id} · ${item.label} · ${row.result} · ${row.detail.slice(0, 120)}`);
        }
      }
    }
  } finally {
    rec.write('exploration-' + group.name, { browser: rec.browser, durationMs: Date.now() - t0, screens: screens.map(({ id, hash, steps, found, tested, error }) => ({ id, hash, steps, found, tested, error })), rows,
      blockedExternal: [...new Set(fake.blocked.map((b) => new URL(b.url).origin))] });
    rec.write('exploration-' + group.name + '-errors', rec.errors);
    await stop();
  }
});
