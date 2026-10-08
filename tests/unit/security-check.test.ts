import { describe, expect, it } from 'vitest';
import { checkCsp, checkHeaders, PERSONAL_PATTERNS, scanText, SECRET_PATTERNS } from '../../scripts/security-check.ts';
import { readFileSync } from 'node:fs';

// Valeurs factices construites à l'exécution : aucun secret réel, et rien qui ressemble à un secret dans le fichier.
const fake = (...parts: string[]) => parts.join('');

describe('détection de secrets', () => {
  it.each([
    ['jeton d’accès Google', fake('ya29', '.', 'A'.repeat(30))],
    ['jeton de rafraîchissement Google', fake('1//0', 'B'.repeat(30))],
    ['secret client OAuth Google', fake('GOC', 'SPX-', 'c'.repeat(20))],
    ['clé API Google', fake('AI', 'za', 'D'.repeat(35))],
    ['jeton GitHub', fake('gh', 'p_', 'e'.repeat(36))],
    ['clé privée', fake('-----BEGIN ', 'PRIVATE KEY-----')],
  ])('%s détecté', (rule, value) => {
    expect(scanText('x.js', `const a = "${value}";`, SECRET_PATTERNS).map((f) => f.rule)).toContain(rule);
  });

  it('le rapport ne recopie jamais le secret', () => {
    const value = fake('ya29', '.', 'Z'.repeat(30));
    const findings = scanText('x.js', value, SECRET_PATTERNS);
    expect(JSON.stringify(findings)).not.toContain('ZZZZ');
  });

  it('liens de dossiers Drive et identifiants client OAuth détectés', () => {
    const folder = fake('https://drive.google.com/drive/', 'folders/', '1AbCdEfGhIjKlMnOp');
    const client = fake('123456789012-', 'abcdefghijklmnopqrstuvwxyz012345', '.apps.googleusercontent.com');
    expect(scanText('a', folder, PERSONAL_PATTERNS)).toHaveLength(1);
    expect(scanText('a', client, PERSONAL_PATTERNS)).toHaveLength(1);
  });

  it('texte ordinaire accepté', () => {
    expect(scanText('a', 'Sauvegarde terminée et vérifiée', [...SECRET_PATTERNS, ...PERSONAL_PATTERNS])).toEqual([]);
  });
});

describe('CSP', () => {
  it('refuse unsafe-eval, unsafe-inline dans script-src et le joker', () => {
    expect(checkCsp("default-src 'self'; script-src 'self' 'unsafe-eval'; object-src 'none'; base-uri 'self'", { requireFrameAncestors: false })).toContain("'unsafe-eval' interdit");
    expect(checkCsp("default-src 'self'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'", { requireFrameAncestors: false })).toContain("'unsafe-inline' interdit dans script-src");
    expect(checkCsp("default-src *; object-src 'none'; base-uri 'self'", { requireFrameAncestors: false })).toContain('joker * interdit');
  });

  it('exige frame-ancestors en production', () => {
    expect(checkCsp("default-src 'self'; object-src 'none'; base-uri 'self'", { requireFrameAncestors: true })).toContain("frame-ancestors 'none' requis");
  });

  it('la CSP de index.html est conforme', () => {
    const csp = readFileSync('index.html', 'utf8').match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)![1];
    expect(checkCsp(csp, { requireFrameAncestors: false })).toEqual([]);
  });
});

describe('en-têtes de production', () => {
  it('public/_headers contient toutes les protections', () => {
    expect(checkHeaders(readFileSync('public/_headers', 'utf8'))).toEqual([]);
  });

  it('un en-tête manquant est signalé', () => {
    const text = readFileSync('public/_headers', 'utf8').replace(/^\s+X-Frame-Options:.*$/m, '');
    expect(checkHeaders(text)).toContain('X-Frame-Options absent');
  });
});
