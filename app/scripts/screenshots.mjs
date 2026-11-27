// Screenshots of the built app (desktop 1280×800 and phone 390×844) into docs/screenshots/.
//
//   npm run build && node scripts/screenshots.mjs            # all routes
//   node scripts/screenshots.mjs editor chart                 # only names containing these words
//
// Serves dist/ with `vite preview` on a free port; uses the globally installed Playwright Chromium.
// Wave-2 features: add your routes to ROUTES below (name → file `<name>-desktop.png` / `<name>-phone.png`).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const APP = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../../docs/screenshots/', import.meta.url));

/**
 * @typedef {{ name: string, path: string, wait?: string, scheme?: 'light'|'dark',
 *   only?: 'desktop'|'phone', fullPage?: boolean, prepare?: (page: import('playwright').Page) => Promise<void> }} Shot
 * `path` is the hash route. `wait`: CSS selector to wait for. `prepare`: runs after load, before the shot.
 */
/** @type {Shot[]} */
export const ROUTES = [
  { name: 'gallery', path: '/', wait: '.gal-hero' },
  { name: 'gallery-dark', path: '/', wait: '.gal-hero', scheme: 'dark' },
  { name: 'library', path: '/library', wait: '.lib-list' },
  { name: 'editor', path: '/editor/fixture%3Asimple_doily', wait: '.ed-box' },
  {
    name: 'editor-error',
    path: '/editor/fixture%3Aflat_sc_circle',
    wait: '.ed-box',
    prepare: async (page) => {
      // type into the built-in (forks it into My patterns) and break a round's count
      const ta = page.locator('.ed-input');
      await ta.click();
      const text = await ta.inputValue();
      await ta.fill(text.replace('Rnd 3: *sc, inc* x6. (18)', 'Rnd 3: *sc, inc* x5. (18)').replace('Rnd 5: *3 sc, inc* x6. (30)', 'Rnd 5: *3 sc, inc x6. (30)'));
      await page.waitForTimeout(700);
      await page.evaluate(() => window.scrollTo(0, 0));
    },
  },
  { name: 'editor-dark', path: '/editor/fixture%3Achain_space_motif', wait: '.ed-box', scheme: 'dark', only: 'desktop' },
  { name: 'chart', path: '/chart', wait: '.ch-svg' },
  { name: 'chart-doily', path: '/chart/fixture%3Asimple_doily', wait: '.ch-svg' },
  { name: 'chart-dc-circle', path: '/chart/fixture%3Aflat_dc_circle', wait: '.ch-svg' },
  { name: 'chart-sphere', path: '/chart/fixture%3Asc_sphere', wait: '.ch-svg' },
  { name: 'chart-hyperbolic', path: '/chart/fixture%3Ahyperbolic_plane', wait: '.ch-svg' },
  { name: 'chart-chainspace', path: '/chart/fixture%3Achain_space_motif', wait: '.ch-svg' },
  { name: 'chart-petal', path: '/chart/corpus%3Apetal-doily-12', wait: '.ch-svg' },
  { name: 'chart-spiderweb', path: '/chart/corpus%3Aspiderweb-doily-10', wait: '.ch-svg' },
  { name: 'chart-granny', path: '/chart/corpus%3Agranny-square-motif', wait: '.ch-svg', only: 'desktop' },
  { name: 'chart-doily-dark', path: '/chart/fixture%3Asimple_doily', wait: '.ch-svg', scheme: 'dark', only: 'desktop' },
  {
    name: 'chart-doily-tooltip', path: '/chart/fixture%3Asimple_doily', wait: '.ch-svg', only: 'desktop',
    prepare: async (page) => {
      const box = await page.locator('.ch-svg').boundingBox();
      if (box) await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.18);
      await page.waitForTimeout(300);
    },
  },
  { name: 'sim', path: '/sim', wait: 'main h1' },
  { name: 'designer', path: '/designer', wait: '.dz-controls' },
  {
    name: 'designer-random',
    path: '/designer',
    wait: '.dz-controls',
    prepare: async (page) => {
      await page.getByRole('radio', { name: 'Surprise me' }).click();
      await page.waitForTimeout(600);
    },
  },
  { name: 'designer-dark', path: '/designer', wait: '.dz-controls', scheme: 'dark', only: 'desktop' },
  // counter: fresh start, mid-round (Rnd 5), the end-of-round check, landing, tally, dark
  ...(() => {
    const doily = '/counter/fixture%3Asimple_doily';
    const toRound = async (page, label) => {
      await page.click('.ctr-roundbtn');
      await page.locator('.ctr-rounds__btn', { hasText: label }).click();
      await page.waitForTimeout(3600); // let the "Jumped to" toast go
    };
    const press = async (page, n) => { for (let i = 0; i < n; i++) await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250); };
    const toCheckpoint = async (page) => {
      for (let i = 0; i < 400 && !(await page.$('.ctr-tap[data-state="checkpoint"]')); i++) await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(250);
    };
    return [
      { name: 'counter', path: doily, wait: '.ctr-tap', prepare: async (page) => press(page, 3) },
      { name: 'counter-midround', path: doily, wait: '.ctr-tap', prepare: async (page) => { await toRound(page, 'Rnd 5'); await press(page, 10); } },
      { name: 'counter-endofround', path: doily, wait: '.ctr-tap', prepare: async (page) => { await toRound(page, 'Rnd 5'); await toCheckpoint(page); } },
      { name: 'counter-dark', path: doily, wait: '.ctr-tap', scheme: 'dark', prepare: async (page) => { await toRound(page, 'Rnd 6'); await press(page, 5); } },
      {
        name: 'counter-landing', path: doily, wait: '.ctr-tap',
        prepare: async (page) => {
          await press(page, 40);
          await page.goto(page.url().replace(/#.*$/, '#/counter/corpus%3Agranny-square-motif'));
          await page.waitForSelector('.ctr-tap');
          await page.waitForTimeout(400);
          await press(page, 12);
          await page.goto(page.url().replace(/#.*$/, '#/counter'));
          await page.waitForSelector('.ctr-conts');
          await page.waitForTimeout(300);
        },
      },
      { name: 'counter-tally', path: '/counter/tally', wait: '.ctr-tap', prepare: async (page) => press(page, 7) },
    ];
  })(),
  { name: 'amigurumi', path: '/amigurumi', wait: '.ami-editor' },
  { name: 'amigurumi-pattern', path: '/amigurumi', wait: '.ami-editor', only: 'phone', prepare: async (page) => { await page.getByRole('tab', { name: /^Pattern/ }).click(); await page.waitForTimeout(300); } },
  { name: 'gauge', path: '/amigurumi?tab=gauge', wait: '.ami-gauge' },
  { name: 'about', path: '/about', wait: 'main h1' },
];

const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function startPreview(port) {
  // run vite's JS entry directly (not via npx) so kill() reaches the server itself
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

async function main() {
  if (!existsSync(`${APP}/dist/index.html`)) throw new Error('dist/ not found — run `npm run build` first');
  mkdirSync(OUT, { recursive: true });
  const filters = process.argv.slice(2);
  const shots = ROUTES.filter((r) => !filters.length || filters.some((f) => r.name.includes(f)));
  const { proc, url } = await startPreview(await freePort());
  const browser = await chromium.launch();
  const errors = [];
  try {
    for (const [vp, opts] of Object.entries(VIEWPORTS)) {
      for (const shot of shots) {
        if (shot.only && shot.only !== vp) continue;
        // fresh context per shot: empty IndexedDB, no service worker interference
        const ctx = await browser.newContext({ ...opts, colorScheme: shot.scheme ?? 'light', serviceWorkers: 'block', reducedMotion: 'reduce' });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(`${shot.name}/${vp}: ${e.message}`));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(`${shot.name}/${vp}: console: ${m.text()}`); });
        await page.goto(`${url}#${shot.path}`, { waitUntil: 'networkidle' });
        if (shot.wait) await page.waitForSelector(shot.wait, { timeout: 10_000 });
        await page.waitForTimeout(350); // debounced compile, fonts
        if (shot.prepare) await shot.prepare(page);
        const file = `${OUT}${shot.name}-${vp}.png`;
        await page.screenshot({ path: file, fullPage: shot.fullPage ?? false });
        console.log('✓', file.replace(OUT, 'docs/screenshots/'));
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    proc.kill();
  }
  if (errors.length) {
    console.error('\nPage errors:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
