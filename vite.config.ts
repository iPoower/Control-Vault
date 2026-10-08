import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };

/** dist/version.json : permet de prouver, après publication, quel commit est réellement servi. */
function buildStamp(): Plugin {
  return {
    name: 'control-vault-version',
    apply: 'build',
    closeBundle() {
      const sha = /^[0-9a-f]{40}$/.test(process.env.BUILD_SHA ?? '') ? process.env.BUILD_SHA : 'local';
      writeFileSync(resolve('dist', 'version.json'), JSON.stringify({ app: 'control-vault', version: pkg.version, sha }));
    },
  };
}

// base relatif : fonctionne sous /Control-Vault/ (GitHub Pages) comme à la racine (Cloudflare).
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
  plugins: [buildStamp()],
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
} as never);
