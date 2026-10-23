import { describe, expect, it } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { run } from '../../scripts/security-check';
describe('profil Google de l’artefact isolé', () => {
  it('configuration publique contrôlée, CSP adaptée ; le build de démo la refuse', () => {
    const out = '.drive-build-test';
    const config = { approved: true, clientId: ['123456', 'a'.repeat(24) + '.apps.googleusercontent.com'].join('-'), apiKey: 'AIza' + 'a'.repeat(35), appId: '123456', raceOrigin: 'https://race.example.com', vaultOrigin: 'https://vault.example.com' };
    const build = (dedicated: boolean, value = config) => spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { encoding: 'utf8', env: { ...process.env, VAULT_OUT: out, GOOGLE_DRIVE_CONFIG: JSON.stringify(value), VAULT_DEDICATED_BUILD: dedicated ? '1' : '' } });
    try {
      const result = build(true); expect(result.status, result.stderr).toBe(0);
      const html = readFileSync(out + '/index.html', 'utf8'), headers = readFileSync(out + '/_headers', 'utf8');
      expect(html).toContain('https://accounts.google.com/gsi/client'); expect(html).toContain('https://docs.google.com');
      expect(html).not.toContain(config.apiKey); expect(html).not.toContain(config.clientId);
      expect(headers).toContain('same-origin-allow-popups'); expect(headers).toContain('/drive-config.json\n  Cache-Control: no-store');
      expect(run(out)).toEqual([]);
      expect(build(false).status).not.toBe(0);
      const bad = { ...config, token: 'forbidden' }; expect(build(true, bad).status).not.toBe(0);
    } finally { rmSync(out, { recursive: true, force: true }); }
  }, 30000);
});
