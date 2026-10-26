// Service worker Control Vault — cache de l'interface uniquement.
// Jamais de mise en cache des réponses Google ou Supabase : ce sont des données personnelles
// qui doivent toujours venir du service, vérifiées.
// CacheStorage est partagé par toutes les applications d'une même origine GitHub Pages.
// Ne jamais supprimer les caches Race Control ou les caches tiers.
const CACHE_PREFIX = 'cv-shell-';
const VERSION = `${CACHE_PREFIX}v3`;
const APP_PATH = new URL(self.registration.scope).pathname;
const cached = (request) => caches.open(VERSION).then((cache) => cache.match(request));
async function remember(request, response) {
  try {
    const cache = await caches.open(VERSION);
    await cache.put(request, response.clone());
  } catch {
    // Un quota de cache d’interface ne doit pas masquer la réponse réseau valide.
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icons/icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(APP_PATH)) return;

  // Navigation : réseau d'abord (toujours la dernière version), cache en secours hors ligne.
  if (req.mode === 'navigate') {
    // Une page de reprise, une configuration ou tout autre document HTML ne doit
    // jamais écraser ./index.html dans CacheStorage. Seuls les alias du shell
    // bénéficient du repli hors ligne.
    if (![APP_PATH, APP_PATH + 'index', APP_PATH + 'index.html'].includes(url.pathname)) return;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.headers.get('content-type')?.includes('text/html')) {
            return remember('./index.html', res);
          }
          return res;
        })
        .catch(() => cached('./index.html')),
    );
    return;
  }

  // Fichiers versionnés par Vite (nom avec empreinte) : cache d'abord.
  if (url.pathname.startsWith(APP_PATH + 'assets/')) {
    event.respondWith(
      cached(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            return res.ok ? remember(req, res) : res;
          }),
      ),
    );
  }
});
