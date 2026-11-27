// Offline on the first visit (review R13), checked in a real browser:
//   npm run build && npm run offline:check
// First load with an empty profile → wait for <html data-offline="ready"> (set together with the
// "Ready to work offline" toast, only once the service worker controls the page) → go offline →
// open every route, including the lazily loaded 3D view (#/sim) → fail on any page or console error.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const APP = fileURLToPath(new URL('..', import.meta.url));

const ROUTES = [
  ['/', '.gal-hero'], ['/library', '.lib-list'], ['/editor/fixture%3Asimple_doily', '.ed-box'],
  ['/chart/fixture%3Asimple_doily', '.ch-svg'], ['/sim/fixture%3Asc_cone', '.sim-stage'], ['/designer', 'main h1'],
  ['/counter', 'main'], ['/amigurumi', '.ami-editor'], ['/amigurumi?tab=gauge', '.ami-gauge'], ['/about', 'main h1'],
  ['/no-such-page', 'main'],
];

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function main() {
  if (!existsSync(`${APP}/dist/index.html`)) throw new Error('dist/ not found — run `npm run build` first');
  const port = await freePort();
  const proc = spawn(process.execPath, [`${APP}/node_modules/vite/bin/vite.js`, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: APP, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.goto(`${url}#/`, { waitUntil: 'load' });
    const t0 = Date.now();
    await page.waitForSelector('html[data-offline="ready"]', { timeout: 60_000 });
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    console.log(`ready to work offline after ${Date.now() - t0} ms; controlled by the service worker: ${controlled}`);
    if (!controlled) errors.push('data-offline="ready" but the page is not controlled by the service worker');
    const toast = await page.getByText('Ready to work offline').count();
    if (!toast) errors.push('no "Ready to work offline" toast');
    await ctx.setOffline(true);
    for (const [path, sel] of ROUTES) {
      await page.evaluate((p) => { location.hash = `#${p}`; }, path);
      try {
        await page.waitForSelector(sel, { timeout: 15_000 });
        await page.waitForTimeout(400);
        const crashed = await page.getByText(/Failed to fetch|could not be loaded|Something went wrong/i).count();
        if (crashed) errors.push(`${path}: route shows a load error offline`);
        console.log(`offline ✓ #${path}`);
      } catch (e) {
        errors.push(`${path}: ${e.message.split('\n')[0]}`);
      }
    }
    // a full reload offline is served from the precache too
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('main', { timeout: 15_000 });
    console.log('offline ✓ reload');
    await ctx.close();
  } finally {
    await browser.close();
    proc.kill();
  }
  if (errors.length) {
    console.error('\nOffline check failed:\n' + errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('offline check passed');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
