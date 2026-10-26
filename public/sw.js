// Service worker Control Vault — cache de l'interface uniquement.
// Jamais de mise en cache des réponses Google ou Supabase : ce sont des données personnelles
// qui doivent toujours venir du service, vérifiées.
// CacheStorage est partagé par toutes les applications d'une même origine GitHub Pages.
// Ne jamais supprimer les caches Race Control ou les caches tiers.
const CACHE_PREFIX = 'cv-shell-';
// Renouveler le namespace protège contre un ancien shell déjà remplacé par une page annexe.
// La migration efface uniquement les anciens caches cv-shell-, jamais les autres applications.
const VERSION = `${CACHE_PREFIX}v4`;
// Vite remplit cette liste avec les noms réellement produits (JS/CSS/polices).
// Sans eux le HTML seul ne permet pas un premier redémarrage hors ligne.
const BUILD_ASSETS = /* @build-assets */ [];
const APP_PATH = new URL(self.registration.scope).pathname;
const cached = (request) => caches.open(VERSION).then((cache) => cache.match(request));
// L'URL finale est la preuve de provenance, après toutes les redirections.
// Filtrer aussi les anciennes entrées évite de servir un cache déjà contaminé.
function validShell(response) {
  if (!response?.ok || !/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || !response.url) return false;
  try {
    const final = new URL(response.url);
    return final.origin === self.location.origin && [APP_PATH, APP_PATH + 'index', APP_PATH + 'index.html'].includes(final.pathname);
  } catch { return false; }
}
async function cachedShell() {
  const response = await cached('./index.html');
  if (!validShell(response)) throw new Error('Aucun shell hors ligne vérifié');
  return response;
}
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
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icons/icon.svg', ...BUILD_ASSETS])));
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
          if (validShell(res)) {
            return remember('./index.html', res);
          }
          return res;
        })
        .catch(() => cachedShell()),
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
