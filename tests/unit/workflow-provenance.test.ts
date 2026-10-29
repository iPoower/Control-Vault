// Regression guards for action provenance and the Pages artifact contract.
// The archive test runs only on disposable files, never app/backup data.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step { name?: string; uses?: string; if?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> }
const workflow = parse(readFileSync('.github/workflows/pipeline.yml', 'utf8')) as { jobs: Record<string, { steps: Step[] }> };
const steps = Object.values(workflow.jobs).flatMap(job => job.steps);
const verify = workflow.jobs.verify.steps;

describe('provenance immuable du pipeline', () => {
  it('toutes les actions tierces sont liées à un commit complet, jamais un tag ou une branche', () => {
    const references = steps.flatMap(step => step.uses ? [step.uses] : []);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/);
    }
  });

  it('Pages utilise directement un uploader figé, sans composite à référence transitive mobile', () => {
    expect(steps.some(step => (step.uses ?? '').startsWith('actions/upload-pages-artifact@'))).toBe(false);
    const archive = verify.find(step => step.name === 'Archive vérifiée (GitHub Pages)');
    const upload = verify.find(step => step.with?.name === 'github-pages');
    expect(archive?.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(upload?.if).toBe(archive?.if);
    expect(upload?.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
    expect(upload?.with?.path).toBe('${{ runner.temp }}/artifact.tar');
    expect(upload?.with?.['retention-days']).toBe(1);
    expect(upload?.with?.['if-no-files-found']).toBe('error');
  });

  it('le vrai conditionnement garde les octets, fichiers cachés et liens déréférencés, sans métadonnées Git', () => {
    const archive = verify.find(step => step.name === 'Archive vérifiée (GitHub Pages)');
    expect(archive?.run).toBeTruthy();
    const root = mkdtempSync(join(tmpdir(), 'cv-pages-fixture-'));
    try {
      for (const dir of ['dist/assets', 'dist/.git', 'dist/.github', 'runner']) mkdirSync(join(root, dir), { recursive: true });
      const fixture: Record<string, string> = {
        'index.html': '<!doctype html><p>fictional-build</p>',
        'version.json': '{"sha":"fictional-build"}',
        'drive-config.json': 'null',
        '.hidden-fixture': 'included',
        'assets/app.js': 'console.log("fixture");',
      };
      for (const [file, content] of Object.entries(fixture)) writeFileSync(join(root, 'dist', file), content);
      writeFileSync(join(root, 'dist/.git/private'), 'must-not-be-packed');
      writeFileSync(join(root, 'dist/.github/private'), 'must-not-be-packed');
      symlinkSync('assets/app.js', join(root, 'dist/alias.js'));
      const packed = spawnSync('sh', ['-ec', archive!.run!], { cwd: root, env: { ...process.env, RUNNER_TEMP: join(root, 'runner') }, encoding: 'utf8' });
      expect(packed.status, packed.stderr).toBe(0);
      const tar = join(root, 'runner/artifact.tar');
      const names = execFileSync('tar', ['-tf', tar], { encoding: 'utf8' }).trim().split('\n');
      expect(names.some(name => /\/(?:\.git|\.github)(?:\/|$)/.test(name))).toBe(false);
      for (const [file, content] of Object.entries(fixture)) {
        expect(execFileSync('tar', ['-xOf', tar, './' + file], { encoding: 'utf8' })).toBe(content);
      }
      expect(execFileSync('tar', ['-xOf', tar, './alias.js'], { encoding: 'utf8' })).toBe(fixture['assets/app.js']);
      const listing = execFileSync('tar', ['-tvf', tar], { encoding: 'utf8' }).split('\n');
      expect(listing.filter(line => line.includes('./alias.js')).every(line => line.startsWith('-'))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
