// Service worker Control Vault — cache de l'interface uniquement.
// Jamais de mise en cache des réponses Google ou Supabase : ce sont des données personnelles
// qui doivent toujours venir du service, vérifiées.
// CacheStorage est partagé par toutes les applications d'une même origine GitHub Pages.
// Ne jamais supprimer les caches Race Control ou les caches tiers.
const CACHE_PREFIX = 'cv-shell-';
const VERSION = `${CACHE_PREFIX}v2`;

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
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Navigation : réseau d'abord (toujours la dernière version), cache en secours hors ligne.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Fichiers versionnés par Vite (nom avec empreinte) : cache d'abord.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
