import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };
import { GoogleDriveSession } from './src/services/google-drive-session.js';

/** dist/version.json : permet de prouver, après publication, quel commit est réellement servi. */
function buildStamp(): Plugin {
  const out = process.env.VAULT_OUT || 'dist';
  const text = process.env.GOOGLE_DRIVE_CONFIG || '';
  if (text && process.env.VAULT_DEDICATED_BUILD !== '1') throw new Error('Configuration Google réservée au build isolé.');
  let config = null;
  try { if (text) { if (Buffer.byteLength(text) > 2048) throw new Error(); const value = JSON.parse(text); config = GoogleDriveSession.config(value, value.vaultOrigin); } }
  catch { throw new Error('Configuration Google publique invalide (valeurs non affichées).'); }
  return {
    name: 'control-vault-version',
    apply: 'build',
    closeBundle() {
      const assets = readdirSync(resolve(out, 'assets'), { withFileTypes: true }).map(entry => {
        if (!entry.isFile() || !/\.(?:js|css|woff2|png|svg)$/.test(entry.name)) throw new Error('Asset de build inattendu');
        return './assets/' + entry.name;
      }).sort();
      const worker = resolve(out, 'sw.js'), source = readFileSync(worker, 'utf8');
      const marker = '/* @build-assets */ []';
      if (!source.includes(marker) || !assets.some(name => name.endsWith('.js'))) throw new Error('Précache incomplet');
      writeFileSync(worker, source.replace(marker, JSON.stringify(assets)));
      const sha = /^[0-9a-f]{40}$/.test(process.env.BUILD_SHA ?? '') ? process.env.BUILD_SHA : 'local';
      const bytes = JSON.stringify(config);
      writeFileSync(resolve(out, 'drive-config.json'), bytes);
      writeFileSync(resolve(out, 'version.json'), JSON.stringify({ app: 'control-vault', version: pkg.version, sha, driveConfig: createHash('sha256').update(bytes).digest('hex') }));
      if (config) {
        const index = resolve(out, 'index.html'), headers = resolve(out, '_headers');
        const google = (s: string) => s.replace("script-src 'self'", "script-src 'self' https://accounts.google.com/gsi/client https://apis.google.com")
          .replace("style-src 'self'", "style-src 'self' https://accounts.google.com/gsi/style")
          .replace("connect-src 'self'", "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/")
          .replace("object-src 'none'", "frame-src https://docs.google.com https://accounts.google.com/gsi/; object-src 'none'");
        writeFileSync(index, google(readFileSync(index, 'utf8')));
        writeFileSync(headers, google(readFileSync(headers, 'utf8')).replace('Cross-Origin-Opener-Policy: same-origin\n', 'Cross-Origin-Opener-Policy: same-origin-allow-popups\n'));
      }
      const headers = resolve(out, '_headers'); writeFileSync(headers, readFileSync(headers, 'utf8') + '\n/drive-config.json\n  Cache-Control: no-store\n');
    },
  };
}

// base relatif : fonctionne sous /Control-Vault/ (GitHub Pages) comme à la racine (Cloudflare).
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: process.env.VAULT_OUT || 'dist', target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
  plugins: [buildStamp()],
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
} as never);
