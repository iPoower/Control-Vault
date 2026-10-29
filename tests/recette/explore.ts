// Recette Phase T — inventaire et activation systématique des éléments interactifs.
import type { Page } from '@playwright/test';

export interface Found {
  idx: number; key: string; kind: string; label: string; selector: string;
  external: boolean; href: string | null; disabled: boolean; explanation: string; current: boolean; offscreen: boolean;
  inputType: string | null;
}

/**
 * Inventaire DANS la page : boutons, liens, champs visibles du premier plan
 * (la feuille modale ouverte la plus haute, sinon le document). Chaque cible reçoit
 * data-recette-idx pour être activée ensuite par Playwright comme un utilisateur.
 */
export async function inventory(page: Page): Promise<Found[]> {
  return page.evaluate(() => {
    const open = [...document.querySelectorAll('dialog[open]')] as HTMLElement[];
    const root: ParentNode = open.at(-1) ?? document;
    document.querySelectorAll('[data-recette-idx]').forEach((e) => e.removeAttribute('data-recette-idx'));
    const SEL = 'a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=tab], [role=radio], [role=checkbox], [role=switch], [role=menuitem], [role=option], [contenteditable=true]';
    const visible = (e: Element) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const anyE = e as HTMLElement & { checkVisibility?: (o: unknown) => boolean };
      if (anyE.checkVisibility && !anyE.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      const cs = getComputedStyle(e);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const text = (e: Element | null) => (e?.textContent || '').replace(/\s+/g, ' ').trim();
    const labelOf = (e: HTMLElement) => {
      const by = e.getAttribute('aria-labelledby');
      const fromLabels = (e as HTMLInputElement).labels ? [...((e as HTMLInputElement).labels ?? [])].map(text).join(' ') : '';
      return (e.getAttribute('aria-label') || (by ? by.split(/\s+/).map((id) => text(document.getElementById(id))).join(' ') : '') ||
        fromLabels || (e as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() || e.getAttribute('placeholder') || e.getAttribute('title') ||
        (e as HTMLInputElement).value || e.getAttribute('name') || e.tagName.toLowerCase()).slice(0, 90);
    };
    const cssPath = (e: Element) => {
      const parts: string[] = [];
      for (let n: Element | null = e; n && n !== document.body && parts.length < 6; n = n.parentElement) {
        if (n.id) { parts.unshift('#' + n.id); break; }
        const p = n.parentElement; const same = p ? [...p.children].filter((c) => c.tagName === n!.tagName) : [];
        const cls = [...n.classList].filter((c) => !/^(view-enter|stagger)$/.test(c)).slice(0, 2).map((c) => '.' + c).join('');
        parts.unshift(n.tagName.toLowerCase() + cls + (same.length > 1 ? `:nth-of-type(${same.indexOf(n) + 1})` : ''));
      }
      return parts.join(' > ');
    };
    const explanation = (e: HTMLElement) => {
      const by = e.getAttribute('aria-describedby');
      const desc = by ? by.split(/\s+/).map((id) => text(document.getElementById(id))).join(' ') : '';
      if (desc) return 'aria-describedby : ' + desc;
      if (e.title) return 'title : ' + e.title;
      // Texte d'aide visible dans le même bloc (heuristique : role=status / alert, .hint, .muted, .row-sub, .note).
      const block = e.closest('.set-row, .panel-body, .field, .sheet-body, form, section, li') as HTMLElement | null;
      const hint = block ? [...block.querySelectorAll('[role=status], [role=alert], .hint, .muted, .row-sub, .note, .help, small')].find((h) => visible(h) && text(h)) : null;
      return hint ? 'texte voisin : ' + text(hint).slice(0, 120) : '';
    };
    const seen = new Set<Element>(); const counts = new Map<string, number>(); const out: unknown[] = [];
    for (const raw of [...root.querySelectorAll(SEL)] as HTMLElement[]) {
      if (seen.has(raw) || raw.closest('[inert]') || raw.closest('[aria-hidden="true"]')) continue;
      let target: HTMLElement = raw;
      if (!visible(raw)) {
        // Champ masqué visuellement mais activable par son libellé (cases / boutons radio stylés).
        const lab = (raw as HTMLInputElement).labels?.[0];
        if (raw.tagName === 'INPUT' && lab && visible(lab) && (raw as HTMLInputElement).type !== 'file') target = lab; else continue;
      }
      seen.add(raw);
      const tag = raw.tagName.toLowerCase(), type = tag === 'input' ? ((raw as HTMLInputElement).type || 'text') : null;
      const role = raw.getAttribute('role');
      const kind = tag === 'a' ? 'lien' : tag === 'button' ? (role === 'radio' ? 'bouton-radio' : role === 'tab' ? 'onglet' : 'bouton')
        : tag === 'input' ? 'champ:' + type : tag === 'select' ? 'liste' : tag === 'textarea' ? 'zone-texte' : tag === 'summary' ? 'résumé' : 'role:' + (role || tag);
      const label = labelOf(raw);
      // Clé stable entre réinitialisations : les dates relatives de la démonstration (heures, minutes) varient.
      const base = kind + '|' + label.replace(/\d+/g, '#'); const n = (counts.get(base) ?? 0) + 1; counts.set(base, n);
      const href = tag === 'a' ? (raw as HTMLAnchorElement).href : null;
      let external = false;
      if (href) { try { const u = new URL(href, location.href); external = u.origin !== location.origin || (raw as HTMLAnchorElement).target === '_blank'; } catch { external = true; } }
      const disabled = !!((raw as HTMLButtonElement).disabled || raw.getAttribute('aria-disabled') === 'true' || raw.closest('fieldset[disabled]'));
      const idx = out.length;
      target.setAttribute('data-recette-idx', String(idx));
      const rect = target.getBoundingClientRect();
      const offscreen = rect.bottom + scrollY <= 0 || rect.right + scrollX <= 0;
      out.push({ idx, key: base + '#' + n, kind, label, selector: cssPath(raw), external, href, disabled, explanation: disabled ? explanation(raw) : '',
        offscreen, current: !!href && !external && new URL(href, location.href).hash === (location.hash || '#/'), inputType: type });
    }
    return out as never;
  });
}

export interface Probe { mutations: number; scrolled: boolean; hash: string; dialogs: number; dialogTitle: string; value: string | null }

/** Démarre l'observation (mutations DOM, défilement) avant une action. */
export async function arm(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __recette?: { m: number; s: number; obs: MutationObserver } };
    w.__recette?.obs.disconnect();
    const rec = { m: 0, s: 0, obs: new MutationObserver((list) => { rec.m += list.filter((x) => !(x.type === 'attributes' && x.attributeName === 'data-recette-idx')).length; }) };
    rec.obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    w.__recette = rec;
    if (!(window as unknown as { __recetteScroll?: boolean }).__recetteScroll) {
      (window as unknown as { __recetteScroll?: boolean }).__recetteScroll = true;
      addEventListener('scroll', () => { const r = (window as unknown as { __recette?: { s: number } }).__recette; if (r) r.s++; }, { capture: true, passive: true });
    }
  });
}

export async function probe(page: Page, idx?: number): Promise<Probe> {
  return page.evaluate((i) => {
    const w = window as unknown as { __recette?: { m: number; s: number } };
    const open = [...document.querySelectorAll('dialog[open]')];
    const el = i === undefined ? null : document.querySelector(`[data-recette-idx="${i}"]`) as HTMLInputElement | null;
    return { mutations: w.__recette?.m ?? 0, scrolled: (w.__recette?.s ?? 0) > 0, hash: location.hash, dialogs: open.length,
      dialogTitle: (open.at(-1)?.querySelector('h2, h1')?.textContent || open.at(-1)?.getAttribute('aria-label') || '').trim(), value: el && 'value' in el ? String(el.value) : null };
  }, idx).catch(() => ({ mutations: 0, scrolled: false, hash: '', dialogs: 0, dialogTitle: '', value: null }));
}

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const SAMPLE_TEXTS = [
  'recette fictive', 'Révision 42 — été', '<img src=x onerror=alert(1)>', '"; DROP TABLE x; --', '😀 émoji ✓', ' ', '0', '-1',
  'a'.repeat(300), '../../etc/passwd', 'javascript:alert(1)', '%00%0a', 'ÀÉÎÕÜ ß ç', '١٢٣ عربى', '   espaces   ',
];
