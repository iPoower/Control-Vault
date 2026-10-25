import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { run } from '../../scripts/security-check';
it('publie uniquement un profil TEST identifié, vérifiable et fermé sans client Google', () => {
  const result = spawnSync(process.execPath, ['scripts/build-drive-test.mjs'], { encoding: 'utf8', env: { ...process.env, BUILD_SHA: 'a'.repeat(40), GOOGLE_DRIVE_CONFIG: '' }, timeout: 120000 });
  expect(result.status).toBe(0);
  const data = JSON.parse(result.stdout.trim());
  const manifest = JSON.parse(readFileSync(join(data.site, 'fixture-manifest.json'), 'utf8'));
  expect(manifest.fixtureOnly).toBe(true); expect(manifest.sourceSha).toBe('a'.repeat(40)); expect(manifest.googleEnabled).toBe(false);
  expect(readFileSync(join(data.site, 'index.html'), 'utf8')).toContain('TEST — DONNÉES FICTIVES UNIQUEMENT');
  expect(readFileSync(join(data.site, 'drive-config.json'), 'utf8')).toBe('null');
  for (const [name, hash] of Object.entries(manifest.files)) expect(createHash('sha256').update(readFileSync(join(data.site, name))).digest('hex')).toBe(hash);
  expect(run(data.site)).toEqual([]);
  const other = { approved: true, clientId: ['123456', 'a'.repeat(24) + '.apps.googleusercontent.com'].join('-'), apiKey: 'AIza' + 'a'.repeat(35), appId: '123456', raceOrigin: 'https://race.example.com', vaultOrigin: 'https://vault.example.com' };
  expect(spawnSync(process.execPath, ['scripts/build-drive-test.mjs'], { encoding: 'utf8', env: { ...process.env, BUILD_SHA: 'a'.repeat(40), GOOGLE_DRIVE_CONFIG: JSON.stringify(other) } }).status).not.toBe(0);
}, 30000);
it('bloque aussi les portes de publication lorsque CodeQL échoue, sans secret dans ce job', () => {
  const pipeline = parse(readFileSync('.github/workflows/pipeline.yml', 'utf8'));
  expect(pipeline.jobs.verify.needs).toBe('codeql');
  expect(pipeline.jobs.codeql.permissions).toEqual({ contents: 'read', actions: 'read', 'security-events': 'write' });
  expect(JSON.stringify(pipeline.jobs.codeql)).not.toMatch(/secrets\.|deploy-pages|pages deploy|always\(\)/);
  expect(pipeline.jobs.codeql.steps.filter((s: { uses: string }) => s.uses.startsWith('github/codeql-action/')).every((s: { uses: string }) => /@[0-9a-f]{40}$/.test(s.uses))).toBe(true);
});
