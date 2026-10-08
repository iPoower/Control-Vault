// Génère les icônes PNG (iOS, Android, maskable) à partir de public/icons/icon.svg.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const shots = [
  ['public/icons/apple-touch-icon.png', 180, false],
  ['public/icons/icon-192.png', 192, false],
  ['public/icons/icon-512.png', 512, false],
  ['public/icons/icon-maskable-512.png', 512, true],
];
for (const [file, size, maskable] of shots) {
  // iOS arrondit lui-même : icône carrée pleine. Maskable : zone de sécurité de 80 %.
  const inner = maskable ? svg.replace('<rect width="512" height="512" rx="112"', '<rect width="512" height="512" rx="0"').replace('<g ', '<g transform="translate(51.2 51.2) scale(0.8)" ').replace('<circle cx="256" cy="256" r="52"', '<circle cx="256" cy="256" r="41.6"') : svg.replace('rx="112"', 'rx="0"');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:#121920}svg{width:${size}px;height:${size}px;display:block}</style>${inner}`);
  await page.screenshot({ path: file });
}
await browser.close();
console.log('icônes générées');
