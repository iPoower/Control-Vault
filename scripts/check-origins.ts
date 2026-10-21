// Configuration publique uniquement : deux URL, deux SHA Git et les empreintes
// index/manifest/worker des builds revus. Aucun jeton accepté ou affiché.
import { readFileSync } from 'node:fs';
import { probeOrigins } from '../src/core/origin-readiness.ts';
try {
  if (process.argv.length !== 3) throw new Error('configuration');
  const path = process.argv[2], file = readFileSync(path);
  if (file.byteLength > 8192) throw new Error('configuration');
  const report = await probeOrigins(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file)));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.state === 'blocked' ? 1 : 0;
} catch {
  console.error('ORIGIN_PREFLIGHT_FAILED — vérifier la configuration publique ou les réponses de l’hébergement.');
  process.exitCode = 1;
}
