// Invariants du pipeline de publication. Ils échouent si une modification future
// ouvre un chemin de publication sans « Vérification complète » réussie.
//
// Rappel GitHub Actions : un job qui déclare `needs: verify` est ignoré si `verify`
// échoue ou est annulé, SAUF si sa condition `if` contient always(), failure() ou cancelled().

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  environment?: string | { name: string };
  permissions?: Record<string, string>;
  steps?: { uses?: string; run?: string; with?: Record<string, unknown> }[];
}
interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

const DIR = '.github/workflows';
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const workflows = files.map((f) => ({ file: f, wf: parse(readFileSync(`${DIR}/${f}`, 'utf8')) as Workflow }));
const pipeline = workflows.find((w) => w.file === 'pipeline.yml')!.wf;

const needsList = (j: Job) => (Array.isArray(j.needs) ? j.needs : j.needs ? [j.needs] : []);
const publishes = (j: Job) =>
  (j.steps ?? []).some((s) => /deploy-pages|upload-pages-artifact/.test(s.uses ?? '') || /wrangler(@[\d.]+)?\s+pages\s+deploy/.test(s.run ?? ''));

describe('pipeline de publication', () => {
  it('un seul workflow existe', () => {
    expect(files).toEqual(['pipeline.yml']);
  });

  it('aucun déclenchement manuel ni externe', () => {
    for (const { wf } of workflows) {
      for (const trigger of ['workflow_dispatch', 'repository_dispatch', 'workflow_run', 'schedule', 'pull_request_target']) {
        expect(Object.keys(wf.on)).not.toContain(trigger);
      }
    }
  });

  it('permissions par défaut en lecture seule', () => {
    expect(pipeline.permissions).toEqual({ contents: 'read' });
  });

  it('le job de vérification ne publie rien et ne reçoit aucun secret', () => {
    const verify = pipeline.jobs.verify;
    expect(verify.name).toBe('Vérification complète');
    expect(JSON.stringify(verify)).not.toMatch(/secrets\./);
    expect((verify.steps ?? []).some((s) => /deploy-pages/.test(s.uses ?? '') || /pages\s+deploy/.test(s.run ?? ''))).toBe(false);
  });

  const deployJobs = Object.entries(pipeline.jobs).filter(([id, j]) => id !== 'verify' && publishes(j));

  it('il existe bien deux jobs de publication', () => {
    expect(deployJobs.map(([id]) => id).sort()).toEqual(['deploy-cloudflare', 'deploy-pages']);
  });

  for (const [id, job] of deployJobs) {
    describe(id, () => {
      it('dépend de « Vérification complète »', () => {
        expect(needsList(job)).toContain('verify');
      });

      it('aucune condition ne contourne un échec de la vérification', () => {
        expect(job.if ?? '').not.toMatch(/always\(\)|failure\(\)|cancelled\(\)|!\s*success\(\)/);
      });

      it('publie uniquement depuis un push sur main', () => {
        expect(job.if).toMatch(/github\.event_name == 'push'/);
        expect(job.if).toMatch(/github\.ref == 'refs\/heads\/main'/);
      });

      it('passe par un environnement GitHub (protégeable)', () => {
        expect(job.environment).toBeTruthy();
      });

      it('ne reconstruit pas : aucun npm ci / npm run build dans le job', () => {
        expect((job.steps ?? []).some((s) => /npm (ci|install|run build)/.test(s.run ?? ''))).toBe(false);
      });
    });
  }

  it('Cloudflare publie l’artefact vérifié de ce run et contrôle le commit', () => {
    const cf = pipeline.jobs['deploy-cloudflare'];
    const dl = (cf.steps ?? []).find((s) => /download-artifact/.test(s.uses ?? ''));
    expect(String(dl?.with?.name)).toContain('${{ github.sha }}');
    expect((cf.steps ?? []).some((s) => /version\.json/.test(s.run ?? '') && /github\.sha/.test(s.run ?? ''))).toBe(true);
    expect((cf.environment as { name: string }).name).toBe('production');
  });

  it('les secrets Cloudflare ne sont utilisés que dans le job Cloudflare', () => {
    for (const [id, job] of Object.entries(pipeline.jobs)) {
      if (id === 'deploy-cloudflare') continue;
      expect(JSON.stringify(job)).not.toMatch(/CLOUDFLARE_API_TOKEN/);
    }
  });
});
