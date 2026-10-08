import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

// base relatif : fonctionne sous /Control-Vault/ (GitHub Pages) comme à la racine.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
} as never);
