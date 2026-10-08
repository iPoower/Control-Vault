// Formatage français, stable et testé. Aucune dépendance au DOM.

const KIB = 1024;
const UNITS = ['octets', 'Ko', 'Mo', 'Go', 'To'];

/** Tailles en base 1024, notation française (virgule décimale), comme l'affiche Google Drive. */
export function formatBytes(bytes: number, digits = 2): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < KIB) return `${bytes} ${bytes > 1 ? 'octets' : 'octet'}`;
  let value = bytes;
  let unit = 0;
  while (value >= KIB && unit < UNITS.length - 1) {
    value /= KIB;
    unit += 1;
  }
  const d = value >= 100 ? Math.min(digits, 1) : digits;
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(value)} ${UNITS[unit]}`;
}

const rtf = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

/** « il y a 3 heures », « hier », « à l'instant ». */
export function formatRelative(at: number, now = Date.now()): string {
  const diff = at - now;
  const abs = Math.abs(diff);
  const s = 1000;
  const m = 60 * s;
  const h = 60 * m;
  const d = 24 * h;
  if (abs < 45 * s) return "à l'instant";
  if (abs < 45 * m) return rtf.format(Math.round(diff / m), 'minute');
  if (abs < 22 * h) return rtf.format(Math.round(diff / h), 'hour');
  if (abs < 26 * d) return rtf.format(Math.round(diff / d), 'day');
  if (abs < 320 * d) return rtf.format(Math.round(diff / (30 * d)), 'month');
  return rtf.format(Math.round(diff / (365 * d)), 'year');
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export const formatDate = (at: number) => dateFmt.format(at);
export const formatDateTime = (at: number) => dateTimeFmt.format(at);
export const formatTime = (at: number) => timeFmt.format(at);

/** Titre de groupe pour la chronologie : « Aujourd'hui », « Hier » ou la date longue. */
export function formatDay(at: number, now = Date.now()): string {
  const startOf = (t: number) => {
    const x = new Date(t);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const delta = Math.round((startOf(now) - startOf(at)) / 86_400_000);
  if (delta === 0) return "Aujourd'hui";
  if (delta === 1) return 'Hier';
  const label = dayFmt.format(at);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`;
  const s = ms / 1000;
  if (s < 60) return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(s)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return rest ? `${m} min ${rest} s` : `${m} min`;
}

export function formatPercent(ratio: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: ratio < 0.1 ? 1 : 0 }).format(ratio);
}

/** Empreinte abrégée lisible : 4 + 4 caractères. */
export const shortHash = (hex: string) => (hex.length > 12 ? `${hex.slice(0, 4)} ${hex.slice(4, 8)}…${hex.slice(-4)}` : hex);

export function plural(n: number, one: string, many: string): string {
  return `${new Intl.NumberFormat('fr-FR').format(n)} ${n > 1 ? many : one}`;
}
