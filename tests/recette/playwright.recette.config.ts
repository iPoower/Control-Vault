// Recette Phase T — configuration Playwright SÉPARÉE (jamais exécutée par `npm run test:e2e`,
// dont le testDir est tests/e2e). Lancée uniquement par .github/workflows/recette.yml ou à la main :
//   npm run build && npx playwright test -c tests/recette/playwright.recette.config.ts
// Aucun serveur : l'application construite (dist/) est servie par les routes Playwright
// sur une origine HTTPS fictive, avec Google entièrement simulé (voir fake-google.ts).
import { defineConfig, devices } from '@playwright/test';

const ci = !!process.env.CI;
// Hors CI uniquement : navigateur Chromium préinstallé d'une autre révision (ex. /opt/pw-browsers/chromium).
const chromiumPath = process.env.RECETTE_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.recette\.ts$/,
  fullyParallel: true,
  forbidOnly: ci,
  retries: 0,
  workers: ci ? 4 : 2,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: '../../test-results/recette',
  reporter: [['list'], ['json', { outputFile: '../../recette-output/playwright-results.json' }], ['html', { open: 'never', outputFolder: '../../recette-output/rapport-playwright' }]],
  globalSetup: './setup.ts',
  globalTeardown: './report.ts',
  use: { trace: 'off', acceptDownloads: true, serviceWorkers: 'block', locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  projects: [
    { name: 'recette-chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: chromiumPath ? { executablePath: chromiumPath } : {} } },
    { name: 'recette-webkit-iphone', use: { ...devices['iPhone 15'], browserName: 'webkit' } },
    // Contrôle local optionnel quand WebKit est absent : même gabarit iPhone, moteur Chromium (n'est PAS une preuve WebKit).
    ...(process.env.RECETTE_LOCAL_IPHONE_CHROMIUM === '1'
      ? [{ name: 'recette-chromium-iphone-local', use: { ...devices['iPhone 15'], browserName: 'chromium' as const, launchOptions: chromiumPath ? { executablePath: chromiumPath } : {} } }]
      : []),
  ],
});
