import { defineConfig, devices } from '@playwright/test';

const ci = !!process.env.CI;

// WebKit n'est pas disponible dans tous les environnements locaux : il tourne toujours en CI.
const withWebkit = ci || process.env.PW_WEBKIT === '1';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  workers: ci ? 3 : undefined,
  outputDir: 'test-results',
  use: { baseURL: 'http://localhost:4173/', trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview', port: 4173, reuseExistingServer: !ci },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-iphone', use: { ...devices['Desktop Chrome'], viewport: { width: 414, height: 896 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true } },
    ...(withWebkit
      ? [
          { name: 'webkit-iphone-11-pro-max', use: { ...devices['iPhone 11 Pro Max'] } },
          { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
        ]
      : []),
  ],
});
