// Recette Phase T — agrégation (globalTeardown) : matrix.json, MATRICE.md, errors.json.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, type ErrorRow, type MatrixRow } from './recorder';
import { explain } from './error-rules';

interface Exploration { browser: string; durationMs: number; screens: { id: string; found: number; tested: number; error?: string }[]; rows: MatrixRow[]; blockedExternal: string[] }
interface Parcours { browser: string; steps: { step: string; status: string; ms: number; screenshot?: string; error?: string }[]; download: { name: string; sha256: string; expected: string } }
interface Monkey { browser: string; seed: number; durationMs: number; actions: number; recoveries: number; blockedOrigins: string[]; errorActions: unknown[] }

function read<T>(file: string): T | null {
  try { return JSON.parse(readFileSync(join(OUT, 'partials', file), 'utf8')) as T; } catch { return null; }
}
const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);
const md = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export default async function report() {
  if (!existsSync(join(OUT, 'partials'))) return;
  const files = readdirSync(join(OUT, 'partials'));
  const browsers = [...new Set(files.map((f) => /^(.*?)-(parcours|exploration|monkey|bugs)/.exec(f)?.[1]).filter((b): b is string => !!b))].sort();
  let sha = process.env.RECETTE_SHA || process.env.GITHUB_SHA || '';
  if (!sha) { try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { sha = 'inconnu'; } }

  const summary: Record<string, unknown> = {};
  const rows: MatrixRow[] = [];
  const errors: (ErrorRow & { explication: string; statut: 'attendue' | 'inexpliquée' })[] = [];
  const parcours: Parcours[] = [], monkeys: Monkey[] = [], explorations: Exploration[] = [];
  for (const b of browsers) {
    const exParts = files.filter((f) => f.startsWith(b + '-exploration') && !f.endsWith('-errors.json')).map((f) => read<Exploration>(f)).filter((x): x is Exploration => !!x);
    const ex: Exploration | null = exParts.length ? { browser: b, durationMs: Math.max(...exParts.map((x) => x.durationMs)), screens: exParts.flatMap((x) => x.screens), rows: exParts.flatMap((x) => x.rows), blockedExternal: [...new Set(exParts.flatMap((x) => x.blockedExternal))] } : null;
    const pa = read<Parcours>(`${b}-parcours.json`), mo = read<Monkey>(`${b}-monkey.json`);
    if (ex) { explorations.push(ex); rows.push(...ex.rows); }
    if (pa) parcours.push(pa);
    if (mo) monkeys.push(mo);
    for (const file of files.filter((f) => f.startsWith(b + '-') && f.endsWith('-errors.json'))) {
      for (const e of read<ErrorRow[]>(file) ?? []) {
        const x = explain(e);
        errors.push({ ...e, explication: x.why, statut: x.expected ? 'attendue' : 'inexpliquée' });
      }
    }
    const mine = ex?.rows ?? [];
    const count = (r: string) => mine.filter((x) => x.result === r).length;
    const tested = mine.filter((x) => x.result !== 'NON TESTABLE').length;
    summary[b] = {
      trouvés: mine.length, testés: tested, couverture: pct(tested, mine.length), écrans: ex?.screens.length ?? 0,
      OK: count('OK'), KO: count('KO'), 'DÉSACTIVÉ-SANS-EXPLICATION': count('DÉSACTIVÉ-SANS-EXPLICATION'), 'NON TESTABLE': count('NON TESTABLE'),
      parcours: pa ? (pa.steps.every((s) => s.status === 'OK') && pa.download.sha256 === pa.download.expected ? 'RÉUSSI' : 'ÉCHEC') : 'non exécuté',
      monkey: mo ? { actions: mo.actions, duréeS: Math.round(mo.durationMs / 1000), graine: mo.seed, erreurs: errors.filter((e) => e.browser === b && e.phase === 'monkey' && e.statut === 'inexpliquée').length } : 'non exécuté',
      erreursInexpliquées: errors.filter((e) => e.browser === b && e.statut === 'inexpliquée').length,
    };
  }

  const bugs: { id: string; test: string; browser: string; reproduced: boolean; observed: string }[] = [];
  for (const f of files.filter((x) => x.endsWith('-bugs.jsonl'))) {
    for (const line of readFileSync(join(OUT, 'partials', f), 'utf8').split('\n').filter(Boolean)) { try { bugs.push(JSON.parse(line)); } catch { /* ligne tronquée */ } }
  }
  bugs.sort((a, b) => a.id.localeCompare(b.id) || a.browser.localeCompare(b.browser));
  writeFileSync(join(OUT, 'matrix.json'), JSON.stringify({ application: 'Control Vault', commit: sha, généré: new Date().toISOString(), données: 'fictives uniquement, Google entièrement simulé', navigateurs: summary, anomalies: bugs, parcours, écrans: Object.fromEntries(explorations.map((e) => [e.browser, e.screens])), lignes: rows }, null, 2));
  writeFileSync(join(OUT, 'errors.json'), JSON.stringify(errors, null, 2));

  const L: string[] = [];
  L.push('# Recette Phase T — Control Vault', '', `Commit testé : \`${sha}\` · généré le ${new Date().toISOString()}`, '',
    'Données fictives uniquement. Google (connexion, Picker, Drive) entièrement simulé par les routes Playwright ; toute autre requête est bloquée.', '',
    '## Synthèse par navigateur', '', '| Navigateur | Parcours | Éléments trouvés (N) | Testés (n) | Couverture | OK | KO | Désactivé sans explication | Non testable | Monkey (actions / erreurs) | Erreurs inexpliquées |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const b of browsers) {
    const s = summary[b] as Record<string, never> & { monkey: { actions: number; erreurs: number } | string };
    L.push(`| ${b} | ${s.parcours} | ${s.trouvés} | ${s.testés} | ${s.couverture} % | ${s.OK} | ${s.KO} | ${s['DÉSACTIVÉ-SANS-EXPLICATION']} | ${s['NON TESTABLE']} | ${typeof s.monkey === 'string' ? s.monkey : `${s.monkey.actions} / ${s.monkey.erreurs}`} | ${s.erreursInexpliquées} |`);
  }
  L.push('', '## Parcours utilisateur', '');
  for (const p of parcours) {
    L.push(`### ${p.browser}`, '', '| Étape | Résultat | Durée | Capture |', '|---|---|---|---|');
    for (const s of p.steps) L.push(`| ${md(s.step)} | ${s.status}${s.error ? ' — ' + md(s.error.slice(0, 200)) : ''} | ${s.ms} ms | ${s.screenshot ?? ''} |`);
    L.push('', `Téléchargement : \`${p.download.name}\` · SHA-256 obtenu \`${p.download.sha256}\` · attendu \`${p.download.expected}\` → ${p.download.sha256 && p.download.sha256 === p.download.expected ? 'identique' : 'DIFFÉRENT / absent'}`, '');
  }
  L.push('## Anomalies reproduites (tests marqués test.fail, sans correctif)', '', '| ID | Navigateur | Test de reproduction | Reproduite | Observé |', '|---|---|---|---|---|');
  for (const b of bugs) L.push(`| ${b.id} | ${b.browser} | ${md(b.test)} | ${b.reproduced ? 'oui' : 'NON (corrigée ?)'} | ${md(b.observed).slice(0, 200)} |`);
  if (!bugs.length) L.push('| — | — | — | — | aucun test de reproduction exécuté |');
  L.push('');
  L.push('## Éléments KO et désactivés sans explication', '', '| Navigateur | Écran | Élément | Résultat | Détail |', '|---|---|---|---|---|');
  for (const r of rows.filter((x) => x.result === 'KO' || x.result === 'DÉSACTIVÉ-SANS-EXPLICATION')) L.push(`| ${r.browser} | ${md(r.screen)} | ${md(r.element)} | ${r.result} | ${md(r.detail)} |`);
  L.push('', '## Erreurs console et exceptions', '', '| Navigateur | Phase | Contexte | Type | Message | Statut | Explication |', '|---|---|---|---|---|---|---|');
  for (const e of errors) L.push(`| ${e.browser} | ${e.phase} | ${md(e.context).slice(0, 120)} | ${e.type} | ${md(e.text).slice(0, 200)} | ${e.statut} | ${md(e.explication)} |`);
  if (!errors.length) L.push('| — | — | — | — | Aucune erreur capturée | — | — |');
  L.push('', '## Écrans explorés', '');
  for (const ex of explorations) {
    L.push(`### ${ex.browser} (${Math.round(ex.durationMs / 1000)} s)`, '', '| Écran | Éléments trouvés | Testés | Remarque |', '|---|---|---|---|');
    for (const s of ex.screens) L.push(`| ${md(s.id)} | ${s.found} | ${s.tested} | ${md(s.error ?? '')} |`);
    L.push('');
  }
  L.push('## Matrice complète (écran / élément / navigateur / résultat)', '', '| Écran | Élément | Type | Navigateur | Résultat | Détail |', '|---|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${md(r.screen)} | ${md(r.element)} | ${r.kind} | ${r.browser} | ${r.result} | ${md(r.detail).slice(0, 220)} |`);
  L.push('', '## Non testable automatiquement — vérification manuelle', '',
    '- [ ] Vraie connexion Google (compte réel, écran de consentement, choix du compte) sur l’origine de production.',
    '- [ ] Vrai Google Picker et vrai dossier Google Drive (création, liste, sélection).',
    '- [ ] Vrai iPhone physique, Safari et PWA ajoutée à l’écran d’accueil (l’émulation WebKit + display-mode standalone n’est pas un iPhone).',
    '- [ ] Téléchargement réel sur iPhone (fichier dans l’app Fichiers) puis import dans Race Control et déchiffrement avec le vrai code.',
    '- [ ] Liens externes (Race Control, Reconversion Control) : ouverture du bon site dans un nouvel onglet.',
    '- [ ] Service worker / hors ligne réel (bloqué pendant cette recette).',
    '- [ ] Messages affichés quand on ferme la fenêtre Google, refuse l’autorisation Drive ou annule le sélecteur (voir BUG-01 à BUG-03), sur un vrai compte.', '');
  writeFileSync(join(OUT, 'MATRICE.md'), L.join('\n'));
}
