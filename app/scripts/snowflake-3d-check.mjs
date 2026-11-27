// Check of the snowflake designer's 3D tab at phone size (not part of vitest; user report 2026-11-27):
// it renders (WebGL canvas), settles, shows the pinned (blocked) star by default and the
// "Before blocking" view one tap away, with no page errors; the sticky top bar is opaque and the
// tab row does not show through it when scrolled.
//
//   npm run build && node scripts/snowflake-3d-check.mjs
//
// Serves dist/ with `vite preview` on a free port; uses the globally installed Playwright Chromium.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const APP = fileURLToPath(new URL('..', import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function startPreview(port) {
  const vite = `${APP}/node_modules/vite/bin/vite.js`;
  const proc = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: APP, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return { proc, url }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  proc.kill();
  throw new Error('vite preview did not start');
}

const fail = (msg) => { throw new Error(msg); };

async function main() {
  if (!existsSync(`${APP}/dist/index.html`)) throw new Error('dist/ not found — run `npm run build` first');
  const { proc, url } = await startPreview(await freePort());
  const browser = await chromium.launch();
  const errors = [];
  try {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${scheme}: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${scheme}: console: ${m.text()}`); });
      await page.goto(`${url}#/designer?kind=snowflake&view=3d`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.sf-sim .sim-stage[data-state="ready"]', { timeout: 90_000 });
      if (!(await page.$('.sf-sim .sim-stage[data-renderer="webgl"] canvas'))) fail(`${scheme}: no WebGL canvas in the 3D tab`);
      const sel = await page.getByRole('radio', { name: 'Blocked (pinned)' }).getAttribute('aria-checked');
      if (sel !== 'true') fail(`${scheme}: the 3D tab does not open on the blocked (pinned) view`);
      const cap = await page.locator('[data-testid="sf-sim-caption"]').textContent();
      if (!/pin marks/.test(cap ?? '')) fail(`${scheme}: blocked caption missing: ${cap}`);
      if (!(await page.locator('.sf-check__items li', { hasText: '3D check' }).count())) fail(`${scheme}: the snowflake check shows no 3D second opinion`);
      await page.getByRole('radio', { name: 'Before blocking' }).click();
      await page.waitForSelector('.sf-sim .sim-stage[data-state="ready"]', { timeout: 90_000 });
      const cap2 = await page.locator('[data-testid="sf-sim-caption"]').textContent();
      if (!/resting on a table/.test(cap2 ?? '')) fail(`${scheme}: before-blocking caption missing: ${cap2}`);
      // scrolled: the top bar is opaque and paints above the tab row
      await page.locator('.sf-tabs').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 20));
      await page.waitForTimeout(200);
      const top = await page.evaluate(() => {
        const bar = document.querySelector('.shell-top');
        const cs = getComputedStyle(bar);
        const tabs = document.querySelector('.sf-tabs').getBoundingClientRect();
        const r = bar.getBoundingClientRect();
        const hit = document.elementFromPoint(tabs.left + 10, Math.max(r.top + 2, Math.min(r.bottom - 2, tabs.top + 4)));
        return { bg: cs.backgroundColor, under: tabs.top < r.bottom, onTop: !!hit && bar.contains(hit) };
      });
      const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(top.bg)?.[1];
      if (alpha !== undefined && Number(alpha) < 0.99) fail(`${scheme}: the top bar is see-through (${top.bg})`);
      if (top.under && !top.onTop) fail(`${scheme}: the tab row paints over the top bar`);
      console.log(`✓ ${scheme}: 3D tab renders and settles (blocked + before blocking), top bar opaque`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    proc.kill();
  }
  if (errors.length) {
    console.error('Page errors:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
