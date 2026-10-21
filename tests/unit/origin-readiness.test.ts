import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { probeOrigins, validateOriginPair, type OriginPair } from '../../src/core/origin-readiness';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const headers = () => ({
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000', 'Cache-Control': 'no-cache',
});
function fixture() {
  const bodies: Record<string, { text: string; type: string }> = {}, config = {} as OriginPair;
  for (const app of ['race', 'vault'] as const) {
    const baseURL = `https://${app}.fixture.test/`, sha = (app === 'race' ? 'a' : 'b').repeat(40);
    const index = '<!doctype html><title>Application fictive</title>', worker = '/* worker fictif */';
    const manifest = JSON.stringify({ name: app === 'race' ? 'Tyre Weather Race Control' : 'Control Vault', start_url: './', scope: './', display: 'standalone', icons: [{ src: 'icon.png' }] });
    config[app] = { baseURL, sha, hashes: { index: digest(index), worker: digest(worker), manifest: digest(manifest) } };
    for (const [file, text, type] of [['index.html', index, 'text/html'], ['sw.js', worker, 'application/javascript'],
      ['manifest.webmanifest', manifest, 'application/manifest+json'], ['version.json', JSON.stringify({ app: app === 'vault' ? 'control-vault' : 'race-control', sha, run: 156, build: 'abcdef012345' }), 'application/json']])
      bodies[baseURL + file] = { text, type };
  }
  const fetcher = vi.fn<typeof fetch>(async input => {
    const b = bodies[String(input)];
    return new Response(b?.text ?? '', { status: b ? 200 : 404, headers: { ...headers(), 'Content-Type': b?.type ?? 'text/plain' } });
  });
  return { config, bodies, fetcher };
}
afterEach(() => vi.useRealTimers());
describe('prévol des origines — aucune autorisation Google ni modification d’hébergement', () => {
  it('compare les artifacts exacts, les versions et les en-têtes des deux origines', async () => {
    const f = fixture(), report = await probeOrigins(f.config, f.fetcher);
    expect(report.state).toBe('technical-checks-passed'); expect(report.findings).toEqual([]);
    expect(report.pending).toHaveLength(5); // Un prévol réussi ne vaut jamais autorisation d’activation.
    expect(f.fetcher).toHaveBeenCalledTimes(8);
    for (const [url, init] of f.fetcher.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/(?:race|vault)\.fixture\.test\/(?:index.html|sw.js|manifest.webmanifest|version.json)$/);
      expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
      expect(init?.headers).toBeUndefined(); expect(init?.body).toBeUndefined();
    }
  });
  it('refuse avant réseau une origine partagée, non canonique, locale ou porteuse de données', async () => {
    const f = fixture();
    for (const baseURL of ['https://ipoower.github.io/Control-Vault/', 'https://a.github.io/', 'http://race.fixture.test/',
      'https://localhost/', 'https://127.0.0.1/', 'https://192.168.1.1/', 'https://race.fixture.test:8443/',
      'https://race.fixture.test/?token=fictif', 'https://race.fixture.test/#fictif', 'https://user:pass@race.fixture.test/',
      'https://RACE.fixture.test/', 'https://race.fixture.test/a/../', 'https://race.fixture.test']) {
      await expect(probeOrigins({ ...f.config, race: { ...f.config.race, baseURL } }, f.fetcher)).rejects.toThrow('INVALID_ORIGIN_CONFIGURATION');
    }
    await expect(probeOrigins({ ...f.config, vault: { ...f.config.vault, baseURL: f.config.race.baseURL + 'vault/' } }, f.fetcher)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('exige des SHA publics complets et refuse les champs supplémentaires/secrets', () => {
    const f = fixture();
    expect(() => validateOriginPair({ ...f.config, token: 'fictif' })).toThrow();
    expect(() => validateOriginPair({ ...f.config, race: { ...f.config.race, sha: 'main' } })).toThrow();
    expect(() => validateOriginPair({ ...f.config, race: { ...f.config.race, hashes: {} } })).toThrow();
  });
  it('un SHA annoncé correct ne masque pas un HTML ou worker différent du build revu', async () => {
    const f = fixture(); f.bodies[f.config.race.baseURL + 'index.html'].text += '<!-- autre build -->';
    f.bodies[f.config.vault.baseURL + 'sw.js'].text += '/* autre worker */';
    const r = await probeOrigins(f.config, f.fetcher);
    expect(r.state).toBe('blocked'); expect(r.findings).toContain('race:index:artifact-hash'); expect(r.findings).toContain('vault:worker:artifact-hash');
  });
  it('mauvaise version, JSON tronqué, réponse non 200 et mauvais type bloquent', async () => {
    const f = fixture(); f.bodies[f.config.race.baseURL + 'version.json'].text = JSON.stringify({ sha: '0'.repeat(40) });
    f.bodies[f.config.vault.baseURL + 'manifest.webmanifest'].text = '{';
    const r = await probeOrigins(f.config, f.fetcher);
    expect(r.findings).toContain('race:version:release-identity'); expect(r.findings).toContain('vault:manifest:unavailable-or-invalid');
    const fetcher: typeof fetch = async () => new Response('fictif', { status: 503 });
    expect((await probeOrigins(f.config, fetcher)).findings).toHaveLength(8);
  });
  it('une CSP meta ne remplace pas les en-têtes et les directives de scripts ne se contournent pas', async () => {
    const f = fixture();
    for (const csp of ['', headers()['Content-Security-Policy'].replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
      headers()['Content-Security-Policy'] + '; script-src-elem https://other.fixture.test',
      headers()['Content-Security-Policy'] + "; script-src 'none'", headers()['Content-Security-Policy'].replace("connect-src 'self'", 'connect-src *')]) {
      const network: typeof fetch = async (...args) => {
        const r = await f.fetcher(...args); r.headers.set('Content-Security-Policy', csp); return r;
      };
      const r = await probeOrigins(f.config, network); expect(r.state).toBe('blocked'); expect(r.findings).toContain('vault:index:csp');
    }
  });
  it('les cookies, CORS permissif et en-têtes d’isolation manquants bloquent', async () => {
    const f = fixture(); const network: typeof fetch = async (...args) => {
      const r = await f.fetcher(...args); r.headers.delete('Cross-Origin-Opener-Policy'); r.headers.delete('Cross-Origin-Resource-Policy');
      r.headers.set('Access-Control-Allow-Origin', '*'); r.headers.set('Set-Cookie', 'fixture=1; Domain=fixture.test'); return r;
    };
    const r = await probeOrigins(f.config, network);
    for (const name of ['cross-origin-opener-policy', 'cross-origin-resource-policy', 'cross-origin-access', 'cookie-free-static-shell'])
      expect(r.findings).toContain('vault:index:' + name);
  });
  it('un manifest exact mais hors scope est bloqué et un worker doit être revalidable', async () => {
    const f = fixture(), key = f.config.vault.baseURL + 'manifest.webmanifest';
    const m = JSON.parse(f.bodies[key].text); m.start_url = 'https://other.fixture.test/';
    f.bodies[key].text = JSON.stringify(m); f.config.vault.hashes.manifest = digest(f.bodies[key].text);
    const network: typeof fetch = async (...args) => { const r = await f.fetcher(...args); r.headers.delete('Cache-Control'); return r; };
    const r = await probeOrigins(f.config, network);
    expect(r.findings).toContain('vault:manifest:manifest-scope-or-identity'); expect(r.findings).toContain('vault:worker:cache-control');
  });
  it('les redirections et réponses trop grosses ne sont jamais validées', async () => {
    const f = fixture(); const network: typeof fetch = async (...args) => {
      if (String(args[0]).endsWith('version.json')) return new Response('x'.repeat(65537), { headers: { ...headers(), 'Content-Type': 'application/json' } });
      const r = await f.fetcher(...args); Object.defineProperty(r, 'redirected', { value: true }); return r;
    };
    const r = await probeOrigins(f.config, network); expect(r.state).toBe('blocked'); expect(r.findings).toHaveLength(8);
  });
  it('borne aussi un corps bloqué, sans conserver des requêtes actives', async () => {
    vi.useFakeTimers(); const f = fixture(); let cancellations = 0;
    const network: typeof fetch = async url => new Response(new ReadableStream({ cancel() { cancellations++; } }), {
      headers: { ...headers(), 'Content-Type': f.bodies[String(url)].type },
    });
    const job = probeOrigins(f.config, network); await vi.advanceTimersByTimeAsync(10001);
    const r = await job; expect(r.state).toBe('blocked'); expect(cancellations).toBe(8);
  });
  it('refuse également une requête qui ne renvoie jamais ses en-têtes', async () => {
    vi.useFakeTimers(); const f = fixture();
    const network: typeof fetch = () => new Promise(() => {});
    const job = probeOrigins(f.config, network); await vi.advanceTimersByTimeAsync(10001);
    expect((await job).findings).toHaveLength(8);
  });
});
