// Micro-outil de construction DOM. Pas de framework : moins de mémoire sur iPhone,
// pas de dépendance à maintenir, et un rendu prévisible.

type Child = Node | string | number | false | null | undefined | Child[];
type Attrs = Record<string, unknown> & { class?: string; style?: string; dataset?: Record<string, string> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'dataset') Object.assign(el.dataset, v as Record<string, string>);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      // Style via CSSOM (cssText) : autorisé par une CSP stricte, contrairement à l'attribut style.
      else if (k === 'style') el.style.cssText = String(v);
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function replace(el: Element, ...children: Child[]) {
  el.replaceChildren();
  append(el, children);
}

const SVG = 'http://www.w3.org/2000/svg';
export function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: (SVGElement | null | false)[]) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') (el as SVGElement).style.cssText = String(v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.appendChild(c);
  return el;
}

/** Index d'apparition progressive pour la classe .stagger (plafonné pour rester rapide). */
export function staggered<T extends HTMLElement>(nodes: T[]): T[] {
  nodes.forEach((n, i) => n.style.setProperty('--i', String(Math.min(i, 12))));
  return nodes;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const reducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
