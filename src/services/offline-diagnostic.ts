// Diagnostic TEST en lecture seule : aucune clé métier ni cache n'est modifié.
// Il décrit des éléments présents maintenant, pas la réussite d'un futur redémarrage.
export const CV_SHELL_CACHE = 'cv-shell-v4';

export type OfflineDiagnostic =
  | 'unsupported' | 'not-registered' | 'not-active' | 'not-controlling'
  | 'wrong-worker' | 'cache-missing' | 'shell-invalid' | 'assets-missing'
  | 'local-elements-present' | 'unavailable';

export async function inspectOfflineElements(
  workers: ServiceWorkerContainer | undefined,
  storage: CacheStorage | undefined,
  scope: string,
  assets: string[],
): Promise<OfflineDiagnostic> {
  if (!workers || !storage) return 'unsupported';
  try {
    const root = new URL(scope);
    if (root.search || root.hash || !root.pathname.endsWith('/')) return 'unavailable';
    const registration = await workers.getRegistration(root.href);
    if (!registration) return 'not-registered';
    if (registration.scope !== root.href || !registration.active || registration.active.state !== 'activated') return 'not-active';
    const expectedWorker = new URL('sw.js', root).href;
    const controller = workers.controller;
    if (!controller) return 'not-controlling';
    if (controller.scriptURL !== expectedWorker || registration.active.scriptURL !== expectedWorker) return 'wrong-worker';

    // CacheStorage.match est en lecture seule, même si le cache disparaît entre les opérations.
    if (!(await storage.keys()).includes(CV_SHELL_CACHE)) return 'cache-missing';
    const match = (url: string) => storage.match(url, { cacheName: CV_SHELL_CACHE });
    const shell = await match(new URL('index.html', root).href);
    if (!shell?.ok || shell.redirected || shell.url !== root.href || !/^text\/html(?:\s*;|$)/i.test(shell.headers.get('content-type') || '')) return 'shell-invalid';

    const required = [...new Set(assets)];
    const parsed = required.map((url) => new URL(url, root));
    const allowed = parsed.every((url) => url.origin === root.origin && url.pathname.startsWith(root.pathname + 'assets/') && !url.search && !url.hash);
    if (!allowed || !parsed.some((url) => url.pathname.endsWith('.js')) || !parsed.some((url) => url.pathname.endsWith('.css'))) return 'assets-missing';
    const responses = await Promise.all(parsed.map((url) => match(url.href)));
    if (responses.some((response) => !response?.ok || response.redirected)) return 'assets-missing';
    return 'local-elements-present';
  } catch {
    return 'unavailable';
  }
}
