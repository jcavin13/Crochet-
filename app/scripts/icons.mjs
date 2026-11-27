// Render the PWA icons from SVG sources with headless Chromium (Playwright, preinstalled globally).
// Usage: node scripts/icons.mjs   → writes PNGs into public/. Commit the results.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const any = readFileSync(here('../public/icon.svg'), 'utf8');
const maskable = readFileSync(here('./icon-maskable.svg'), 'utf8');
const jobs = [
  ['icon-192.png', any, 192],
  ['icon-512.png', any, 512],
  ['icon-maskable-512.png', maskable, 512],
  ['apple-touch-icon.png', maskable, 180], // iOS masks the corners itself; must be opaque
  ['favicon-32.png', any, 32],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, svg, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(here(`../public/${name}`), buf);
  console.log('wrote public/' + name);
}
await browser.close();
