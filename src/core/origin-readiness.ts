// Prévol public du lot C. N'active ni hébergement, migration, OAuth ou Drive.
export interface OriginTarget {
  baseURL: string;
  sha: string;
  hashes: { index: string; manifest: string; worker: string };
}
export interface OriginPair { race: OriginTarget; vault: OriginTarget }
export interface OriginReport {
  state: 'blocked' | 'technical-checks-passed';
  origins: { race: string; vault: string };
  findings: string[];
  pending: readonly string[];
}
const pending = Object.freeze([
  'exclusive-hosting-and-domain-ownership-review',
  'browser-storage-session-and-worker-isolation',
  'verified-recoverable-file-migration-and-physical-iphone',
  'oauth-popup-csp-and-coop-profile-review',
  'same-oauth-client-drive-file-visibility-on-both-origins',
]);
const fail = (): never => { throw new Error('INVALID_ORIGIN_CONFIGURATION'); };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const hex = (v: unknown, length: number): v is string => typeof v === 'string' && v.length === length && /^[0-9a-f]+$/.test(v);
function base(target: unknown): URL {
  if (!record(target) || !keys(target, ['baseURL', 'sha', 'hashes']) || typeof target.baseURL !== 'string' || !hex(target.sha, 40) ||
    !record(target.hashes) || !keys(target.hashes, ['index', 'manifest', 'worker']) || !Object.values(target.hashes).every(h => hex(h, 64))) return fail();
  let url: URL;
  try { url = new URL(target.baseURL); } catch { return fail(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port ||
    url.href !== target.baseURL || !url.pathname.endsWith('/') || !/^\/[A-Za-z0-9_/-]*$/.test(url.pathname) ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname) || /^[\d.]+$/.test(url.hostname) ||
    /(?:^|\.)(github\.io|localhost|local|internal)$/.test(url.hostname)) return fail();
  return url;
}
export function validateOriginPair(config: unknown): { config: OriginPair; race: URL; vault: URL } {
  if (!record(config) || !keys(config, ['race', 'vault'])) return fail();
  const race = base(config.race), vault = base(config.vault);
  if (race.origin === vault.origin) return fail();
  return { config: config as unknown as OriginPair, race, vault };
}
function cspProblems(value: string | null): boolean {
  if (!value || value.length > 16000 || value.includes(',')) return true;
  const directives = new Map<string, string[]>();
  for (const part of value.split(';').map(x => x.trim()).filter(Boolean)) {
    const [name, ...sources] = part.split(/\s+/);
    if (directives.has(name) || !/^[a-z-]+$/.test(name)) return true;
    directives.set(name, sources);
  }
  const only = (name: string, allowed: string[]) => {
    const sources = directives.get(name);
    return !!sources?.length && sources.every(s => allowed.includes(s));
  };
  if (!only('default-src', ["'self'"]) || !only('object-src', ["'none'"]) || !only('frame-ancestors', ["'none'"]) ||
    !only('base-uri', ["'none'", "'self'"]) || !only('form-action', ["'none'", "'self'"]) ||
    !only('worker-src', ["'self'"]) || !only('manifest-src', ["'self'"])) return true;
  for (const name of ['script-src', 'script-src-elem']) {
    if (name === 'script-src-elem' && !directives.has(name)) continue;
    const sources = directives.get(name);
    if (!sources?.length || sources.some(s => !["'self'", "'none'"].includes(s) && !/^'sha256-[A-Za-z0-9+/]{43}='$/.test(s))) return true;
  }
  if (directives.has('script-src-attr') && !only('script-src-attr', ["'none'"])) return true;
  const connections = directives.get('connect-src');
  return !connections?.length || connections.some(s => {
    if (["'self'", "'none'"].includes(s)) return false;
    try { const u = new URL(s); return u.protocol !== 'https:' || !!u.username || !!u.password || !!u.search || !!u.hash || s.includes('*'); }
    catch { return true; }
  });
}
function headersProblems(headers: Headers, app: 'race' | 'vault'): string[] {
  const findings: string[] = [], add = (name: string, ok: boolean) => { if (!ok) findings.push(name); };
  add('csp', !cspProblems(headers.get('content-security-policy')));
  for (const [name, wanted] of [['x-content-type-options', 'nosniff'], ['x-frame-options', 'deny'],
    ['cross-origin-opener-policy', 'same-origin'], ['cross-origin-resource-policy', 'same-origin']])
    add(name, headers.get(name)?.toLowerCase() === wanted);
  add('referrer-policy', ['no-referrer', 'strict-origin-when-cross-origin', 'same-origin'].includes(headers.get('referrer-policy') ?? ''));
  const hsts = headers.get('strict-transport-security') ?? '', age = hsts.match(/(?:^|;)\s*max-age=(\d+)(?:;|$)/i);
  add('hsts', !!age && Number(age[1]) >= 31536000);
  const permissions = headers.get('permissions-policy') ?? '';
  add('permissions-policy', ['camera', 'microphone', 'payment', 'usb'].every(p => new RegExp('(?:^|,)\\s*' + p + '=\\(\\)').test(permissions)) &&
    (app === 'vault' ? /(?:^|,)\s*geolocation=\(\)/.test(permissions) : /(?:^|,)\s*geolocation=\((?:self)?\)/.test(permissions)));
  add('cross-origin-access', !headers.has('access-control-allow-origin'));
  add('cookie-free-static-shell', !headers.has('set-cookie'));
  return findings;
}
async function bounded(response: Response, limit: number, abort: AbortController): Promise<Uint8Array> {
  if (!response.body) throw new Error('body');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  abort.signal.addEventListener('abort', cancel, { once: true });
  if (abort.signal.aborted) cancel();
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit || abort.signal.aborted) throw new Error('body');
      chunks.push(value);
    }
  } catch { abort.abort(); await reader.cancel().catch(() => {}); throw new Error('body'); }
  finally { abort.signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}
const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(n => n.toString(16).padStart(2, '0')).join('');
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
function inside(value: string, resource: URL, root: URL): boolean {
  const u = new URL(value, resource);
  return u.origin === root.origin && u.pathname.startsWith(root.pathname) && !u.username && !u.password && !u.search && !u.hash;
}
export async function probeOrigins(input: unknown, fetcher: typeof fetch = fetch): Promise<OriginReport> {
  const { config, race, vault } = validateOriginPair(input), findings: string[] = [];
  const descriptors = [
    ['index', 'index.html', 3 * 1024 * 1024, /^(?:text\/html)(?:;|$)/i],
    ['manifest', 'manifest.webmanifest', 65536, /^(?:application\/(?:manifest\+json|json))(?:;|$)/i],
    ['worker', 'sw.js', 1024 * 1024, /^(?:application|text)\/javascript(?:;|$)/i],
    ['version', 'version.json', 65536, /^application\/json(?:;|$)/i],
  ] as const;
  await Promise.all((['race', 'vault'] as const).map(async app => {
    const root = app === 'race' ? race : vault, target = config[app];
    await Promise.all(descriptors.map(async ([kind, name, limit, type]) => {
      const url = new URL(name, root), controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined, response: Response | undefined;
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 10000); });
      const problem = (name: string) => findings.push(`${app}:${kind}:${name}`);
      try {
        response = await Promise.race([fetcher(url.href, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal }), deadline]);
        if (controller.signal.aborted || response.status !== 200 || response.redirected || response.url && response.url !== url.href || !type.test(response.headers.get('content-type') ?? '')) throw new Error('response');
        headersProblems(response.headers, app).forEach(problem);
        if (kind === 'worker' && !/(?:^|,)\s*(?:no-cache|no-store)(?:,|$)/i.test(response.headers.get('cache-control') ?? '')) problem('cache-control');
        const allowed = response.headers.get('service-worker-allowed');
        if (kind === 'worker' && allowed !== null && new URL(allowed, root).href !== root.href) problem('worker-scope');
        const bytes = await bounded(response, limit, controller);
        if (controller.signal.aborted) throw new Error('response');
        if (kind !== 'version' && await digest(bytes) !== target.hashes[kind]) problem('artifact-hash');
        if (kind === 'manifest') {
          const m: unknown = JSON.parse(decode(bytes));
          if (!record(m) || m.name !== (app === 'race' ? 'Tyre Weather Race Control' : 'Control Vault') || m.display !== 'standalone' ||
            typeof m.scope !== 'string' || new URL(m.scope, url).href !== root.href || typeof m.start_url !== 'string' ||
            !inside(m.start_url, url, root) ||
            !Array.isArray(m.icons) || !m.icons.length || m.icons.some(icon => !record(icon) || typeof icon.src !== 'string' ||
              !inside(icon.src, url, root))) problem('manifest-scope-or-identity');
        }
        if (kind === 'version') {
          const v: unknown = JSON.parse(decode(bytes));
          if (!record(v) || v.sha !== target.sha || (app === 'vault' ? v.app !== 'control-vault' :
            !Number.isInteger(v.run) || Number(v.run) < 1 || Number(v.run) > 999999999 || !hex(v.build, 12))) problem('release-identity');
        }
        if (controller.signal.aborted) throw new Error('response');
      } catch { problem('unavailable-or-invalid'); }
      finally { clearTimeout(timer); controller.abort(); void response?.body?.cancel().catch(() => {}); }
    }));
  }));
  return { state: findings.length ? 'blocked' : 'technical-checks-passed', origins: { race: race.origin, vault: vault.origin }, findings: findings.sort(), pending };
}
