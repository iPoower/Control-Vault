// Contrôle de sécurité bloquant, exécuté par la CI avant toute publication.
// Usage : node scripts/security-check.ts dist
// Échoue (code 1) au moindre secret, source map, identifiant personnel ou en-tête manquant.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface Finding {
  file: string;
  rule: string;
  detail: string;
}

/** Motifs de secrets courants : clés privées, jetons Google/GitHub/Slack/AWS/Stripe, secrets OAuth. */
export const SECRET_PATTERNS: [string, RegExp][] = [
  ['clé privée', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['jeton d’accès Google', /\bya29\.[0-9A-Za-z_-]{20,}/],
  ['jeton de rafraîchissement Google', /\b1\/\/0[0-9A-Za-z_-]{20,}/],
  ['secret client OAuth Google', /\bGOCSPX-[0-9A-Za-z_-]{10,}/],
  ['clé API Google', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['jeton GitHub', /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}|\bgithub_pat_[0-9A-Za-z_]{40,}/],
  ['clé AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['jeton Slack', /\bxox[abprs]-[0-9A-Za-z-]{10,}/],
  ['clé Stripe', /\b(?:sk|rk)_live_[0-9A-Za-z]{10,}/],
  // Clé « service_role » Supabase : JWT dont la charge contient le rôle (encodé en base64).
  ['clé service Supabase', /c2VydmljZV9yb2xl|SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*\S{20,}/],
  ['jeton Cloudflare', /\bCLOUDFLARE_API_TOKEN\s*[:=]\s*['"]?[0-9A-Za-z_-]{30,}/],
];

/** Identifiants personnels qui n'ont rien à faire dans le code public. */
export const PERSONAL_PATTERNS: [string, RegExp][] = [
  ['lien de dossier Google Drive', /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]{10,}/],
  ['identifiant client OAuth', /\b\d{6,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com\b/],
];

export function scanText(file: string, text: string, patterns: [string, RegExp][]): Finding[] {
  const out: Finding[] = [];
  for (const [rule, re] of patterns) {
    // Le motif trouvé n'est jamais recopié : un journal de CI ne doit pas exposer un secret, même en partie.
    if (re.test(text)) out.push({ file, rule, detail: 'motif détecté' });
  }
  return out;
}

/** CSP : pas d'unsafe-eval, pas d'unsafe-inline pour les scripts, frame-ancestors en production. */
export function checkCsp(csp: string, opts: { requireFrameAncestors: boolean }): string[] {
  const problems: string[] = [];
  const dir = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `) || d === name);
  if (!dir('default-src')) problems.push('default-src absent');
  const script = dir('script-src') ?? dir('default-src') ?? '';
  if (/'unsafe-eval'/.test(csp)) problems.push("'unsafe-eval' interdit");
  if (/'unsafe-inline'/.test(script)) problems.push("'unsafe-inline' interdit dans script-src");
  if (/(^|\s)\*(\s|;|$)/.test(csp)) problems.push('joker * interdit');
  if (!dir('object-src')?.includes("'none'")) problems.push("object-src 'none' requis");
  if (!dir('base-uri')) problems.push('base-uri requis');
  if (opts.requireFrameAncestors && !dir('frame-ancestors')?.includes("'none'")) problems.push("frame-ancestors 'none' requis");
  return problems;
}

export const REQUIRED_HEADERS = ['Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security'];

/** Analyse le bloc « /* » du fichier _headers de Cloudflare Pages. */
export function parseHeaders(text: string): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  let current = '';
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = raw.trim();
      rules[current] = {};
    } else if (current) {
      const i = raw.indexOf(':');
      if (i > 0) rules[current][raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
    }
  }
  return rules;
}

export function checkHeaders(text: string): string[] {
  const all = parseHeaders(text)['/*'];
  if (!all) return ['règle « /* » absente'];
  const problems = REQUIRED_HEADERS.filter((h) => !all[h]).map((h) => `${h} absent`);
  if (all['X-Frame-Options'] && all['X-Frame-Options'] !== 'DENY') problems.push('X-Frame-Options doit valoir DENY');
  if (all['X-Content-Type-Options'] && all['X-Content-Type-Options'] !== 'nosniff') problems.push('X-Content-Type-Options doit valoir nosniff');
  if (all['Content-Security-Policy']) problems.push(...checkCsp(all['Content-Security-Policy'], { requireFrameAncestors: true }).map((p) => `CSP : ${p}`));
  return problems;
}

function walk(dir: string, skip: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (skip.test(p)) return [];
    return statSync(p).isDirectory() ? walk(p, skip) : [p];
  });
}

const TEXT = /\.(js|mjs|ts|css|html|json|webmanifest|md|txt|yml|yaml|svg|map)$|_headers$/;

export function run(distDir: string, root = '.'): Finding[] {
  const findings: Finding[] = [];
  const skip = /node_modules|\.git\b|test-results|playwright-report|screenshots/;

  // 1. Build publié
  for (const f of walk(distDir, skip)) {
    const rel = relative(root, f);
    if (f.endsWith('.map')) findings.push({ file: rel, rule: 'source map publiée', detail: 'interdit' });
    if (!TEXT.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    if (/sourceMappingURL=/.test(text)) findings.push({ file: rel, rule: 'référence de source map', detail: 'interdit' });
    findings.push(...scanText(rel, text, SECRET_PATTERNS), ...scanText(rel, text, PERSONAL_PATTERNS));
  }

  // 2. Code et documentation du dépôt (public)
  for (const dir of ['src', 'public', 'docs', 'scripts', 'tests', '.github']) {
    for (const f of walk(join(root, dir), skip)) {
      if (!TEXT.test(f) || f.endsWith('security-check.ts') || f.endsWith('security-check.test.ts')) continue;
      const rel = relative(root, f);
      const text = readFileSync(f, 'utf8');
      findings.push(...scanText(rel, text, SECRET_PATTERNS), ...scanText(rel, text, PERSONAL_PATTERNS));
    }
  }
  for (const f of ['README.md', 'SECURITY.md', 'index.html']) {
    const p = join(root, f);
    if (existsSync(p)) findings.push(...scanText(f, readFileSync(p, 'utf8'), [...SECRET_PATTERNS, ...PERSONAL_PATTERNS]));
  }

  // 3. CSP du document et en-têtes de production
  const index = join(distDir, 'index.html');
  if (existsSync(index)) {
    const csp = readFileSync(index, 'utf8').match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
    if (!csp) findings.push({ file: 'dist/index.html', rule: 'CSP', detail: 'balise CSP absente' });
    else for (const p of checkCsp(csp, { requireFrameAncestors: false })) findings.push({ file: 'dist/index.html', rule: 'CSP', detail: p });
  } else findings.push({ file: 'dist/index.html', rule: 'build', detail: 'absent' });

  const headers = join(distDir, '_headers');
  if (!existsSync(headers)) findings.push({ file: 'dist/_headers', rule: 'en-têtes', detail: 'fichier absent' });
  else for (const p of checkHeaders(readFileSync(headers, 'utf8'))) findings.push({ file: 'dist/_headers', rule: 'en-têtes', detail: p });

  return findings;
}

if (process.argv[1]?.endsWith('security-check.ts')) {
  const dist = process.argv[2] ?? 'dist';
  const findings = run(dist);
  if (findings.length) {
    console.error(`✗ Contrôle de sécurité : ${findings.length} problème(s)`);
    for (const f of findings) console.error(`  - ${f.file} — ${f.rule} : ${f.detail}`);
    process.exit(1);
  }
  console.log('✓ Contrôle de sécurité : aucun secret, aucune source map, aucun identifiant personnel ; CSP et en-têtes conformes.');
}
