// Feuilles modales, notifications, menus contextuels, annonces pour lecteurs d'écran.
// Tous les dialogues se ferment : bouton visible, Échap, toucher le fond, glisser vers le bas.

import { h, reducedMotion } from './dom';
import { icon } from './icons';

export interface SheetHandle {
  dialog: HTMLDialogElement;
  body: HTMLElement;
  foot: HTMLElement;
  setTitle(t: string): void;
  close(): void;
  onClose(fn: () => void): void;
}

let sheetCount = 0;

export function openSheet(opts: { title: string; wide?: boolean; label?: string }): SheetHandle {
  const id = `sheet-title-${++sheetCount}`;
  const title = h('h2', { id }, opts.title);
  const body = h('div', { class: 'sheet-body' });
  const foot = h('div', { class: 'sheet-foot', hidden: true });
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer la fenêtre' }, icon('x'));
  const grip = h('div', { class: 'sheet-grip', 'aria-hidden': 'true' });
  const head = h('div', { class: 'sheet-head' }, title, closeBtn);
  const dialog = h('dialog', { class: `sheet${opts.wide ? ' wide' : ''}`, 'aria-labelledby': id }, grip, head, body, foot);
  const closers: (() => void)[] = [];
  const opener = document.activeElement as HTMLElement | null;
  let closed = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    dialog.close();
    dialog.remove();
    closers.forEach((f) => f());
    opener?.focus?.({ preventScroll: true });
  };
  const close = () => {
    if (closed) return;
    if (reducedMotion()) return finish();
    dialog.classList.add('closing');
    setTimeout(finish, 170);
  };

  closeBtn.addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) close();
  });

  // Glisser vers le bas pour fermer (mobile) — l'alternative visible est le bouton Fermer.
  let startY = 0;
  let dy = 0;
  let dragging = false;
  const onStart = (e: TouchEvent) => {
    dragging = true;
    startY = e.touches[0].clientY;
    dy = 0;
    dialog.style.transition = 'none';
  };
  const onMove = (e: TouchEvent) => {
    if (!dragging) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    dialog.style.transform = `translateY(${dy}px)`;
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    dialog.style.transition = 'transform 180ms cubic-bezier(.2,.7,.2,1)';
    if (dy > 90) close();
    else dialog.style.transform = '';
  };
  for (const zone of [grip, head]) {
    zone.addEventListener('touchstart', onStart, { passive: true });
    zone.addEventListener('touchmove', onMove, { passive: true });
    zone.addEventListener('touchend', onEnd);
  }

  document.body.appendChild(dialog);
  dialog.showModal();
  // Focus sur le titre plutôt que sur le premier bouton : VoiceOver lit le contexte d'abord.
  title.tabIndex = -1;
  title.focus({ preventScroll: true });

  return {
    dialog,
    body,
    foot,
    setTitle: (t) => (title.textContent = t),
    close,
    onClose: (fn) => closers.push(fn),
  };
}

export function setFoot(sheet: SheetHandle, ...buttons: (HTMLElement | null | false | undefined | '')[]) {
  sheet.foot.replaceChildren(...(buttons.filter(Boolean) as HTMLElement[]));
  sheet.foot.hidden = sheet.foot.childElementCount === 0;
}

// ─── Notifications ─────────────────────────────────────────────────────────

type ToastKind = 'ok' | 'info' | 'bad';

export function toast(message: string, opts: { kind?: ToastKind; action?: { label: string; run: () => void }; duration?: number } = {}) {
  const root = document.getElementById('toasts')!;
  const kind = opts.kind ?? 'info';
  const el = h(
    'div',
    { class: 'toast', role: kind === 'bad' ? 'alert' : 'status' },
    icon(kind === 'ok' ? 'check' : kind === 'bad' ? 'alert' : 'info'),
    h('p', null, message),
    opts.action &&
      h(
        'button',
        {
          class: 'btn btn-sm',
          type: 'button',
          onclick: () => {
            opts.action!.run();
            dismiss();
          },
        },
        opts.action.label,
      ),
  );
  let timer = 0;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 170);
  };
  const arm = () => (timer = window.setTimeout(dismiss, opts.duration ?? (opts.action ? 7000 : 4200)));
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', arm);
  root.appendChild(el);
  while (root.childElementCount > 3) root.firstElementChild?.remove();
  arm();
}

/** Annonce discrète pour VoiceOver / lecteurs d'écran (changements d'état). */
export function announce(text: string) {
  const live = document.getElementById('sr-status');
  if (!live) return;
  live.textContent = '';
  requestAnimationFrame(() => (live.textContent = text));
}

// ─── Menu contextuel ───────────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  icon: string;
  run: () => void;
  danger?: boolean;
}

let openMenuEl: HTMLElement | null = null;

export function closeMenu() {
  openMenuEl?.remove();
  openMenuEl = null;
}

export function openMenu(items: (MenuItem | 'sep')[], at: { x: number; y: number } | HTMLElement, label = 'Actions') {
  closeMenu();
  const opener = document.activeElement as HTMLElement | null;
  const buttons: HTMLButtonElement[] = [];
  const menu = h(
    'div',
    { class: 'menu', role: 'menu', 'aria-label': label },
    items.map((it) => {
      if (it === 'sep') return h('hr', { role: 'separator' });
      const b = h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          style: it.danger ? 'color: var(--bad)' : undefined,
          onclick: () => {
            closeMenu();
            opener?.focus?.({ preventScroll: true });
            it.run();
          },
        },
        icon(it.icon),
        it.label,
      );
      buttons.push(b);
      return b;
    }),
  );
  document.body.appendChild(menu);
  openMenuEl = menu;

  const r = at instanceof HTMLElement ? at.getBoundingClientRect() : { left: at.x, right: at.x, bottom: at.y, top: at.y };
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const left = Math.min(Math.max(8, (at instanceof HTMLElement ? r.right - mw : r.left)), window.innerWidth - mw - 8);
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  buttons[0]?.focus();

  menu.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') buttons[(i + 1) % buttons.length].focus();
    else if (e.key === 'ArrowUp') buttons[(i - 1 + buttons.length) % buttons.length].focus();
    else if (e.key === 'Escape' || e.key === 'Tab') {
      closeMenu();
      opener?.focus?.({ preventScroll: true });
    } else return;
    e.preventDefault();
  });
  setTimeout(() => {
    const off = (e: Event) => {
      if (!menu.contains(e.target as Node)) {
        closeMenu();
        document.removeEventListener('pointerdown', off, true);
      }
    };
    document.addEventListener('pointerdown', off, true);
  });
}
