// Smoke test for the counter (not part of vitest): phone-size browser, tap "next" N times on
// fixture:simple_doily, reload, and check the position persisted (IndexedDB).
//
//   npm run build && node scripts/counter-smoke.mjs
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
const TAPS = 9;

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

async function state(page) {
  return page.evaluate(() => ({
    now: document.querySelector('.ctr-now__text')?.textContent ?? '',
    round: document.querySelector('.ctr-roundbtn__label')?.textContent ?? '',
    meta: document.querySelector('.ctr-meta')?.textContent ?? '',
    tap: document.querySelector('.ctr-tap')?.getAttribute('data-state') ?? '',
  }));
}

async function main() {
  if (!existsSync(`${APP}/dist/index.html`)) fail('dist/ not found — run `npm run build` first');
  const { proc, url } = await startPreview(await freePort());
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.goto(`${url}#/counter/fixture%3Asimple_doily`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.ctr-tap');
    await page.waitForTimeout(400);
    const start = await state(page);
    if (start.round !== 'Rnd 1' || start.now !== 'ch 6') fail(`unexpected start state ${JSON.stringify(start)}`);

    // tap the big zone (real touch taps), checking the end-of-round check appears after Rnd 1 (5 items)
    const box = await page.locator('.ctr-tap').boundingBox();
    const seen = [];
    for (let i = 0; i < TAPS; i++) {
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.8);
      await page.waitForTimeout(60);
      const s = await state(page);
      seen.push(s.tap === 'checkpoint' ? '[check]' : s.now);
    }
    // 5 items in Rnd 1, one tap to dismiss the check, then 3 items into Rnd 2
    if (seen[4] !== '[check]') fail(`expected the end-of-round check after 5 taps, saw ${JSON.stringify(seen)}`);
    const before = await state(page);
    if (before.round !== 'Rnd 2') fail(`expected Rnd 2 after ${TAPS} taps, got ${JSON.stringify(before)}`);

    // back then next (keyboard ← / →): net zero
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600); // IndexedDB write

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.ctr-tap');
    await page.waitForTimeout(500);
    const after = await state(page);
    if (after.now !== before.now || after.round !== before.round || after.meta !== before.meta) {
      fail(`position not persisted: before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
    }

    // landing page lists the pattern as in progress
    await page.goto(`${url}#/counter`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.ctr-conts');
    const listed = await page.locator('.ctr-cont__title').allTextContents();
    if (!listed.some((t) => t.startsWith('Simple doily'))) fail(`landing does not list the doily: ${JSON.stringify(listed)}`);

    if (errors.length) fail(`page errors:\n${errors.join('\n')}`);
    console.log(`counter smoke: OK — ${TAPS} taps → ${before.round} "${before.now}" (${before.meta}); persisted across reload; listed on landing`);
    console.log(`  sequence: ${seen.join(' | ')}`);
    await ctx.close();
  } finally {
    await browser.close();
    proc.kill();
  }
}

main().catch((e) => { console.error(`counter smoke: FAIL — ${e.message}`); process.exit(1); });
