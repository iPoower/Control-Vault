// Recette Phase T — collecte des erreurs console / exceptions JS, captures d'écran et sorties.
import type { Page, TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const OUT = process.env.RECETTE_OUTPUT || 'recette-output';

export type Verdict = 'OK' | 'KO' | 'DÉSACTIVÉ-SANS-EXPLICATION' | 'NON TESTABLE';
export interface MatrixRow {
  browser: string; screen: string; element: string; kind: string; selector: string;
  result: Verdict; detail: string; screenshot?: string; ms?: number;
}
export interface ErrorRow {
  browser: string; phase: string; context: string; type: 'console' | 'pageerror' | 'dialog';
  text: string; location?: string; at: string;
  /** Erreur reçue pendant une capture d'écran Playwright (voir error-rules.ts). */
  pendantCapture?: boolean;
}

/** Contexte courant (phase / écran / élément) attaché à chaque erreur capturée. */
export class Recorder {
  readonly errors: ErrorRow[] = [];
  context = '';
  private shotCount = 0;
  private shooting = 0;
  constructor(readonly browser: string, readonly phase: string) {
    mkdirSync(join(OUT, 'screenshots', browser, phase), { recursive: true });
    mkdirSync(join(OUT, 'traces'), { recursive: true });
    mkdirSync(join(OUT, 'partials'), { recursive: true });
  }
  static browserName(info: TestInfo) { return info.project.name.replace(/^recette-/, ''); }

  attach(page: Page) {
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const l = m.location();
      this.push({ type: 'console', text: m.text(), location: l?.url ? `${l.url}:${l.lineNumber}:${l.columnNumber}` : undefined });
    });
    page.on('pageerror', (e) => this.push({ type: 'pageerror', text: `${e.name}: ${e.message}`, location: (e.stack || '').split('\n').slice(1, 3).join(' | ').trim() || undefined }));
    page.on('dialog', (d) => { this.push({ type: 'dialog', text: `${d.type()} : ${d.message()}` }); void d.dismiss().catch(() => {}); });
  }
  private push(e: Omit<ErrorRow, 'browser' | 'phase' | 'context' | 'at'>) {
    this.errors.push({ browser: this.browser, phase: this.phase, context: this.context, at: new Date().toISOString(), ...e, ...(this.shooting ? { pendantCapture: true } : {}) });
  }
  /** Erreurs survenues depuis l'index donné (pour attribuer une erreur à une action). */
  since(index: number) { return this.errors.slice(index); }

  async shot(page: Page, name: string): Promise<string | undefined> {
    const file = join('screenshots', this.browser, this.phase, `${String(++this.shotCount).padStart(4, '0')}-${slug(name)}.jpg`);
    this.shooting++;
    try {
      // caret: 'initial' : sinon Playwright injecte une feuille de style refusée par la CSP stricte (cf. tests/e2e/helpers.ts).
      await page.screenshot({ path: join(OUT, file), type: 'jpeg', quality: 55, caret: 'initial', timeout: 5000 });
      await page.waitForTimeout(50); // laisse arriver les messages console émis par la capture elle-même
      return file;
    } catch { return undefined; } finally { this.shooting--; }
  }

  write(name: string, data: unknown) {
    writeFileSync(join(OUT, 'partials', `${this.browser}-${name}.json`), JSON.stringify(data, null, 2));
  }
}

export function slug(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase() || 'x';
}
