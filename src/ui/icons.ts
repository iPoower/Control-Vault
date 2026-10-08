// Jeu d'icônes Control Vault : grille 24, trait 1,7, extrémités arrondies.
// Dessinées pour le projet afin de garder une famille cohérente.

const P: Record<string, string> = {
  // Navigation
  home: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm0 3.2v1.6m0 7.4v1.6M6.7 12h1.6m7.4 0h1.6M12 12l2.6-2.6',
  folder: 'M3.5 7.2c0-1 .8-1.7 1.7-1.7h4.1l1.9 2h7.6c1 0 1.7.8 1.7 1.7v7.6c0 1-.8 1.7-1.7 1.7H5.2c-1 0-1.7-.8-1.7-1.7Z',
  apps: 'M4.5 5.7c0-.7.5-1.2 1.2-1.2h4.1c.7 0 1.2.5 1.2 1.2v4.1c0 .7-.5 1.2-1.2 1.2H5.7c-.7 0-1.2-.5-1.2-1.2Zm8 0c0-.7.5-1.2 1.2-1.2h4.1c.7 0 1.2.5 1.2 1.2v4.1c0 .7-.5 1.2-1.2 1.2h-4.1c-.7 0-1.2-.5-1.2-1.2Zm-8 8.5c0-.7.5-1.2 1.2-1.2h4.1c.7 0 1.2.5 1.2 1.2v4.1c0 .7-.5 1.2-1.2 1.2H5.7c-.7 0-1.2-.5-1.2-1.2Zm8 2.05h7',
  history: 'M4.2 12a7.8 7.8 0 1 0 2.3-5.5M4 4.5v3h3M12 8v4.2l2.8 1.8',
  shield: 'M12 3.4 5.2 6v5.4c0 4.1 2.8 7.6 6.8 9.2 4-1.6 6.8-5.1 6.8-9.2V6Zm-3 8.8 2.2 2.2 4-4.2',
  settings: 'M4 7h9m4 0h3M4 17h3m4 0h9M15 4.8v4.4M9 14.8v4.4',
  search: 'M10.8 4.5a6.3 6.3 0 1 0 0 12.6 6.3 6.3 0 0 0 0-12.6Zm4.6 10.9 4.1 4.1',
  // Fichiers
  file: 'M7 3.5h6.5L18 8v11.3c0 .7-.5 1.2-1.2 1.2H7.2c-.7 0-1.2-.5-1.2-1.2V4.7c0-.7.5-1.2 1.2-1.2Zm6 0V8h5',
  json: 'M9 4.5c-1.6 0-2.3.7-2.3 2.2v2.6c0 1.2-.6 1.9-1.9 2.2 1.3.3 1.9 1 1.9 2.2v2.6c0 1.5.7 2.2 2.3 2.2m6-14c1.6 0 2.3.7 2.3 2.2v2.6c0 1.2.6 1.9 1.9 2.2-1.3.3-1.9 1-1.9 2.2v2.6c0 1.5-.7 2.2-2.3 2.2',
  image: 'M5.2 4.5h13.6c.7 0 1.2.5 1.2 1.2v12.6c0 .7-.5 1.2-1.2 1.2H5.2c-.7 0-1.2-.5-1.2-1.2V5.7c0-.7.5-1.2 1.2-1.2Zm-1.2 12 4.4-4.3 3.4 3.3 2.3-2.2 5.9 5.1M15.5 8.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z',
  doc: 'M7 3.5h6.5L18 8v11.3c0 .7-.5 1.2-1.2 1.2H7.2c-.7 0-1.2-.5-1.2-1.2V4.7c0-.7.5-1.2 1.2-1.2Zm2 9h6m-6 3.5h4',
  vault: 'M6 10.5h12c.6 0 1 .4 1 1v7.8c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-7.8c0-.6.4-1 1-1Zm2.5 0V8a3.5 3.5 0 0 1 7 0v2.5M12 14.2v2.6',
  // Actions
  upload: 'M12 15.5V4.8m-4.2 4 4.2-4.3 4.2 4.3M4.5 15v3.3c0 .7.5 1.2 1.2 1.2h12.6c.7 0 1.2-.5 1.2-1.2V15',
  download: 'M12 4.5v10.7m-4.2-4 4.2 4.3 4.2-4.3M4.5 15v3.3c0 .7.5 1.2 1.2 1.2h12.6c.7 0 1.2-.5 1.2-1.2V15',
  backup: 'M7.3 18.5H6.8a4.3 4.3 0 0 1-.6-8.5 6 6 0 0 1 11.6 0 4.3 4.3 0 0 1-.6 8.5h-.5M12 20v-7.5m-3 3 3-3 3 3',
  restore: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9M4.5 4.8V9h4.2',
  check: 'M5 12.5 9.5 17 19 7.5',
  x: 'M6.5 6.5l11 11m0-11-11 11',
  plus: 'M12 5v14M5 12h14',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  chevron: 'M9.5 6l6 6-6 6',
  back: 'M14.5 6l-6 6 6 6',
  alert: 'M12 4.2 3.5 19h17Zm0 5.6v4.2m0 2.6v.01',
  info: 'M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Zm0 7.2v5m0-7.8v.01',
  offline: 'M3.5 8.5a13 13 0 0 1 4-2.5m3.7-.8A13 13 0 0 1 20.5 8.5M6.3 11.7a9 9 0 0 1 3.4-1.9m4.6.1a9 9 0 0 1 3.4 1.8M9 15a4.5 4.5 0 0 1 6 0m-3 3.6v.01M4 4l16 16',
  wifi: 'M3.5 9a13 13 0 0 1 17 0M6.3 12.2a9 9 0 0 1 11.4 0M9 15.4a4.5 4.5 0 0 1 6 0M12 18.6v.01',
  cloud: 'M7 18.5h10.3a4.2 4.2 0 0 0 .5-8.4 6 6 0 0 0-11.6 0A4.2 4.2 0 0 0 7 18.5Z',
  database: 'M12 4c4.1 0 7 1.2 7 2.7v10.6c0 1.5-2.9 2.7-7 2.7s-7-1.2-7-2.7V6.7C5 5.2 7.9 4 12 4Zm7 2.7c0 1.5-2.9 2.7-7 2.7s-7-1.2-7-2.7m14 5.3c0 1.5-2.9 2.7-7 2.7S5 13.5 5 12',
  key: 'M14.5 4.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm-3.6 8.5L4.5 19.4M7 17l2.2 2.2M8.8 15.2 11 17.4M15.6 8.3h.01',
  fingerprint: 'M8.2 5.3A8 8 0 0 1 20 12.1v1.5M4 10.5a8 8 0 0 1 1.8-3.3M4.2 14.5v-1.2M16.6 18.6a19 19 0 0 0 1.4-5.3v-1.2a6 6 0 0 0-12 0v1.5M12.5 20.5a18 18 0 0 0 1.5-7v-1.4a2 2 0 0 0-4 0v1.4a14 14 0 0 1-2 7',
  device: 'M8 3.5h8c.7 0 1.2.5 1.2 1.2v14.6c0 .7-.5 1.2-1.2 1.2H8c-.7 0-1.2-.5-1.2-1.2V4.7c0-.7.5-1.2 1.2-1.2Zm3 14h2',
  sun: 'M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6ZM12 3v1.6m0 14.8V21M3 12h1.6m14.8 0H21M5.6 5.6l1.2 1.2m10.4 10.4 1.2 1.2m0-12.8-1.2 1.2M6.8 17.2l-1.2 1.2',
  bell: 'M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5Zm3.5 2.5a2 2 0 0 0 4 0',
  user: 'M12 4.5a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4ZM5 19.5c.9-3.1 3.8-5 7-5s6.1 1.9 7 5',
  export: 'M12 14.5V4m-4 3.8L12 4l4 3.8M7 10.5H5.7c-.7 0-1.2.5-1.2 1.2v6.6c0 .7.5 1.2 1.2 1.2h12.6c.7 0 1.2-.5 1.2-1.2v-6.6c0-.7-.5-1.2-1.2-1.2H17',
  list: 'M8.5 7h11m-11 5h11m-11 5h11M4.5 7h.01m-.01 5h.01m-.01 5h.01',
  grid: 'M4.5 4.5h6v6h-6Zm9 0h6v6h-6Zm-9 9h6v6h-6Zm9 0h6v6h-6Z',
  sort: 'M7 5v14m-3-3 3 3 3-3M14 7h6m-6 5h4.5m-4.5 5h3',
  select: 'M5.7 4.5h12.6c.7 0 1.2.5 1.2 1.2v12.6c0 .7-.5 1.2-1.2 1.2H5.7c-.7 0-1.2-.5-1.2-1.2V5.7c0-.7.5-1.2 1.2-1.2Zm2.8 7.7 2.4 2.4 4.6-4.8',
  eye: 'M2.8 12S6 5.8 12 5.8 21.2 12 21.2 12 18 18.2 12 18.2 2.8 12 2.8 12Zm9.2-2.6a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z',
  refresh: 'M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1M17.8 3.7v3.5h-3.5M6.2 20.3v-3.5h3.5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  command: 'M9 6.5a2.5 2.5 0 1 0-2.5 2.5H9Zm0 0v11m0-11h6m-6 11a2.5 2.5 0 1 1-2.5-2.5H9Zm0-2.5h6m0-8.5a2.5 2.5 0 1 1 2.5 2.5H15Zm0 0v11m0 0a2.5 2.5 0 1 0 2.5-2.5H15',
};

/** Logo : cadran de coffre stylisé, propre à Control Vault. */
export function logo(size = 28): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 32 32');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('logo');
  s.innerHTML =
    '<rect class="logo-plate" x="1" y="1" width="30" height="30" rx="9"/>' +
    '<circle class="logo-ring" cx="16" cy="16" r="9" stroke-width="1.8"/>' +
    '<path class="logo-ring" d="M16 7v2.4M16 22.6V25M7 16h2.4M22.6 16H25" stroke-width="1.8" stroke-linecap="round"/>' +
    '<circle class="logo-core" cx="16" cy="16" r="3.2"/>';
  return s;
}

export function icon(name: keyof typeof P | string, label?: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.7');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  if (label) {
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', label);
  } else s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', P[name] ?? P.file);
  if (name === 'more') p.setAttribute('stroke-width', '2.6');
  s.appendChild(p);
  return s;
}
