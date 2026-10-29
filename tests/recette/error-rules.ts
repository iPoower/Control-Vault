// Recette Phase T — explication des erreurs console connues. Tout le reste est « inexpliquée ».
import type { ErrorRow } from './recorder';

type E = Pick<ErrorRow, 'text' | 'location' | 'type'> & Partial<Pick<ErrorRow, 'browser' | 'pendantCapture'>>;
const RULES: { test: (e: E) => boolean; why: string }[] = [
  {
    // Playwright (WebKit) insère <style>body {}</style> avant chaque capture d'écran pour synchroniser les animations
    // (inPagePrepareForScreenshots / shouldToggleStyleSheetToSyncAnimations). La CSP stricte de l'application
    // (style-src 'self') la refuse et WebKit le journalise. Absent sous Chromium, une erreur par capture.
    test: (e) => e.type === 'console' && /webkit/.test(e.browser ?? '') && e.pendantCapture === true &&
      /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/.test(e.text),
    why: 'Artefact du banc : feuille de style vide injectée par Playwright WebKit avant chaque capture d’écran, refusée (à juste titre) par la CSP style-src \'self\' de l’application.',
  },
  {
    // OpaqueDrive.createFolder / uploadPacket relisent d'abord l'identifiant réservé (generateIds) :
    // le 404 « pas encore créé » est le cas nominal, traité par l'application. Le navigateur le journalise quand même.
    test: (e) => e.type === 'console' && /status of 404/.test(e.text) && /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/recette-gen-\d+/.test(e.location ?? ''),
    why: 'Relecture d’un identifiant Drive réservé avant sa création (contrat « réserver puis relire ») : 404 nominal, géré par l’application, journalisé par le navigateur.',
  },
  {
    test: (e) => e.type === 'console' && (/ERR_BLOCKED_BY_CLIENT|blockedbyclient/i.test(e.text) ||
      (/Failed to load resource/.test(e.text) && !!e.location && !e.location.startsWith('https://vault.example.com/') && !e.location.startsWith('https://www.googleapis.com/'))),
    why: 'Requête vers une origine externe interrompue volontairement par le banc de recette (aucun réseau réel).',
  },
];

export function explain(e: E): { why: string; expected: boolean } {
  const rule = RULES.find((r) => r.test(e));
  return rule ? { why: rule.why, expected: true } : { why: 'Non expliquée par le banc : à analyser (voir contexte, capture et trace).', expected: false };
}
