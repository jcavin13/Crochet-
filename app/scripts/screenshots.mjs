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
/** Bring `el` to the top: inside its scrolling split pane on desktop (page scrolled to the panes), else the page (below the sticky header). */
function scrollToInPane(el) {
  const pane = el.closest('.ui-split__pane');
  if (pane && getComputedStyle(pane).overflowY === 'auto' && pane.scrollHeight > pane.clientHeight + 4) {
    const split = pane.closest('.ui-split');
    window.scrollTo(0, split.getBoundingClientRect().top + window.scrollY - 8);
    pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top - 8;
  } else {
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 72);
  }
}

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
  // blankets on the chart page (#/chart?blanket=…: the studio's swatch, not saved): a body in rows
  // with its border round it (rounded-rectangle rounds, corner fans), polygons and stadiums in the round
  ...(() => {
    const toStage = async (page) => {
      await page.locator('.ch-stage').evaluate((el) => { if (window.innerWidth < 900) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 64); });
      await page.waitForTimeout(300);
    };
    const corner = async (page) => {
      const b = page.locator('.ch-viewbar button').nth(1);
      if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
      await page.waitForTimeout(400);
      await toStage(page);
    };
    const c = (q) => `/chart?blanket=${q}`;
    return [
      { name: 'chart-blanket-border', path: c('rect:dc:sc,shell'), wait: '.ch-svg', only: 'desktop', prepare: toStage },
      // corner detail: the default on a phone (one corner, the first rows, every border round)
      { name: 'chart-blanket-corner', path: c('rect:dc:sc,shell'), wait: '.ch-svg', prepare: corner },
      { name: 'chart-blanket-moss', path: c('rect:moss:sc'), wait: '.ch-svg', only: 'desktop', prepare: toStage },
      { name: 'chart-blanket-granny-stripe', path: c('demo:granny-stripe-baby'), wait: '.ch-svg', only: 'desktop', prepare: toStage },
      { name: 'chart-blanket-ripple', path: c('rect:ripple:sc,sc'), wait: '.ch-svg', only: 'desktop', prepare: toStage },
      { name: 'chart-blanket-granny-square', path: c('round:granny-square:granny'), wait: '.ch-svg', prepare: toStage },
      { name: 'chart-blanket-solid-square', path: c('round:solid-square:dc'), wait: '.ch-svg', only: 'desktop', prepare: toStage },
      { name: 'chart-blanket-hexagon', path: c('round:hexagon:dc'), wait: '.ch-svg', only: 'desktop', prepare: toStage },
      { name: 'chart-blanket-c2s', path: `${c('round:circle-to-square:dc,hdc')}&full=1&w=30`, wait: '.ch-svg', only: 'desktop', prepare: toStage },
      { name: 'chart-blanket-rect-round', path: c('round:rect-round:sc'), wait: '.ch-svg', only: 'desktop', prepare: toStage },
      // the blanket studio's own swatch chart (it embeds ChartView)
      {
        name: 'blanket-swatch-chart', path: '/blanket?demo=moss-throw', wait: '.bk-controls',
        prepare: async (page) => {
          await page.waitForSelector('.bk-hero__svg', { timeout: 30_000, state: 'attached' });
          const t = page.getByRole('tab', { name: 'Blanket' });
          if (await t.isVisible().catch(() => false)) { await t.click(); await page.waitForTimeout(400); }
          await page.getByRole('switch', { name: 'Chart', exact: true }).check({ force: true });
          await page.waitForSelector('.bk-chart .ch-svg', { timeout: 10_000 });
          await page.locator('.bk-chart').evaluate(scrollToInPane);
          await page.waitForTimeout(500);
        },
      },
    ];
  })(),
  // symmetry overlay (one repeat shaded, sector lines) and a symmetry defect shown on the chart
  ...(() => {
    const symOn = async (page) => {
      await page.getByRole('switch', { name: 'Symmetry', exact: true }).check({ force: true });
      await page.waitForTimeout(300);
    };
    return [
      { name: 'chart-symmetry', path: '/chart/corpus%3Apetal-doily-12', wait: '.ch-svg', prepare: symOn },
      { name: 'chart-symmetry-mirror', path: '/chart/fixture%3Asimple_doily', wait: '.ch-svg', only: 'desktop', prepare: symOn },
    ];
  })(),
  // symmetry defect as a hint in the Problems list + the compact symmetry panel
  { name: 'editor-symmetry', path: '/editor/corpus%3Asunburst-dtr-doily-20', wait: '.ed-box', only: 'desktop' },
  // flatness assistant: ranked fixes for the ruffling round of the teaching pattern
  {
    name: 'editor-fixes', path: '/editor/corpus%3Ateaching-ruffle-shell-doily', wait: '.ed-box',
    prepare: async (page) => {
      const tab = page.getByRole('tab', { name: /Check/ });
      if (await tab.isVisible().catch(() => false)) await tab.click();
      await page.getByRole('button', { name: 'Suggest fixes' }).first().click();
      await page.waitForSelector('.ed-fix', { timeout: 10_000 });
      await page.locator('.ed-flat__list > li.is-off').first().evaluate((el) => {
        el.scrollIntoView({ block: 'start' });
        if (window.innerWidth >= 900) window.scrollTo(0, 0); else window.scrollBy(0, -96);
      });
      await page.waitForTimeout(300);
    },
  },
  { name: 'chart-doily-dark', path: '/chart/fixture%3Asimple_doily', wait: '.ch-svg', scheme: 'dark', only: 'desktop' },
  {
    name: 'chart-doily-tooltip', path: '/chart/fixture%3Asimple_doily', wait: '.ch-svg', only: 'desktop',
    prepare: async (page) => {
      const box = await page.locator('.ch-svg').boundingBox();
      if (box) await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.18);
      await page.waitForTimeout(300);
    },
  },
  // 3D sim: wait until the solve of the shown state has finished (worker), then let WebGL draw
  ...(() => {
    const ready = '.sim-stage[data-state="ready"]';
    const settle = async (page) => { await page.waitForSelector(ready, { timeout: 30_000 }); await page.waitForTimeout(500); };
    const blockIt = async (page) => {
      await page.waitForSelector(ready, { timeout: 30_000 });
      await page.getByRole('radio', { name: 'Blocked' }).click();
      await page.waitForTimeout(100);
      await settle(page);
    };
    const fx = (n) => `/sim/fixture%3A${n}`;
    return [
      { name: 'sim', path: '/sim', wait: 'main h1', prepare: settle },
      ...['flat_sc_circle', 'flat_dc_circle', 'sc_sphere', 'sc_cone', 'hyperbolic_plane', 'simple_doily', 'chain_space_motif']
        .map((n) => ({ name: `sim-${n}`, path: fx(n), wait: 'main h1', prepare: settle })),
      // review R1: the count rule says ruffle, the sim's shape measure says cup — shown as a tendency, with the reason
      { name: 'sim-corpus-teaching-ruffle', path: '/sim/corpus%3Ateaching-ruffle-shell-doily', wait: 'main h1', only: 'desktop', prepare: settle },
      { name: 'sim-simple_doily-blocked', path: fx('simple_doily'), wait: 'main h1', prepare: blockIt },
      { name: 'sim-hyperbolic_plane-blocked', path: fx('hyperbolic_plane'), wait: 'main h1', prepare: blockIt },
      { name: 'sim-chain_space_motif-blocked', path: fx('chain_space_motif'), wait: 'main h1', only: 'desktop', prepare: blockIt },
      {
        name: 'sim-sc_sphere-round6', path: fx('sc_sphere'), wait: 'main h1', only: 'desktop',
        prepare: async (page) => {
          await settle(page);
          const s = page.getByRole('slider', { name: /Show up to/ });
          await s.focus();
          for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft');
          await settle(page);
        },
      },
      {
        name: 'sim-hyperbolic_plane-strain', path: fx('hyperbolic_plane'), wait: 'main h1', only: 'desktop',
        prepare: async (page) => { await settle(page); await page.getByRole('combobox', { name: 'Colour' }).selectOption('strain'); await page.waitForTimeout(500); },
      },
      { name: 'sim-doily-dark', path: fx('simple_doily'), wait: 'main h1', scheme: 'dark', only: 'desktop', prepare: settle },
    ];
  })(),
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
  {
    name: 'designer-pattern',
    path: '/designer',
    wait: '.dz-controls',
    only: 'phone',
    prepare: async (page) => {
      await page.getByRole('tab', { name: 'Pattern' }).click();
      await page.waitForTimeout(400);
    },
  },
  { name: 'designer-dark', path: '/designer', wait: '.dz-controls', scheme: 'dark', only: 'desktop' },
  // layer builder: a layer opened with its automatic-sizing explanation; the "add a round" suggestions
  {
    name: 'designer-layers', path: '/designer?kind=doily', wait: '.dz-rounds',
    prepare: async (page) => {
      await page.locator('.dz-round__main').nth(3).click();
      await page.waitForSelector('.dz-sizing .dz-alt');
      // desktop: scroll the layers pane only; phone: scroll the page to the layer list, below the sticky header
      await page.locator('.dz-round[data-open="true"]').evaluate(scrollToInPane);
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'designer-suggestions', path: '/designer?kind=doily', wait: '.dz-rounds', only: 'desktop',
    prepare: async (page) => {
      // take the edging off so the suggestions are for an open lace round
      for (const k of [8, 7]) {
        await page.locator('.dz-round__main').nth(k).click();
        await page.getByRole('button', { name: 'Remove this round' }).click();
        await page.waitForTimeout(300);
      }
      await page.getByRole('button', { name: 'Add a round' }).click();
      await page.waitForSelector('.dz-suglist', { timeout: 20_000 });
      await page.getByRole('button', { name: 'Suggest the next 3 rounds' }).click();
      await page.locator('.dz-suggest').evaluate(scrollToInPane);
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'snowflake', path: '/designer?kind=snowflake&view=preview', wait: '.sf-stage .sf-preview',
    prepare: async (page) => { await page.locator('.sf-tabs').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (window.innerWidth < 900 ? 72 : 8))); await page.waitForTimeout(300); },
  },
  { name: 'snowflake-design', path: '/designer?kind=snowflake', wait: '.sf-layers', only: 'phone' },
  {
    name: 'snowflake-gallery', path: '/designer?kind=snowflake&view=gallery', wait: '.sf-gallery', only: 'desktop',
    prepare: async (page) => { await page.locator('.sf-tabs').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 8)); await page.waitForTimeout(300); },
  },
  {
    name: 'snowflake-template', path: '/designer?kind=snowflake&view=template', wait: '.dz-template__svg svg', only: 'desktop',
    prepare: async (page) => { await page.locator('.dz-template').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 8)); await page.waitForTimeout(300); },
  },
  {
    name: 'snowflake-chart', path: '/designer?kind=snowflake&view=chart', wait: '.ch-svg',
    prepare: async (page) => { await page.locator('.sf-tabs').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (window.innerWidth < 900 ? 72 : 8))); await page.waitForTimeout(300); },
  },
  // snowflake 3D tab: pinned out on the template (default) and "Before blocking" (resting on a table)
  ...(() => {
    const ready = async (page) => { await page.waitForSelector('.sf-sim .sim-stage[data-state="ready"]', { timeout: 90_000 }); await page.waitForTimeout(600); };
    const toSim = async (page) => { await page.locator('.sf-sim').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (window.innerWidth < 900 ? 60 : 8))); await page.waitForTimeout(300); };
    const preset = (name, points) => async (page) => {
      await page.getByRole('button', { name, exact: true }).first().click();
      if (points) await page.locator('button.dz-toggle', { hasText: new RegExp(`^${points}$`) }).first().click();
      await page.waitForTimeout(500);
    };
    const relaxed = async (page) => { await page.getByRole('radio', { name: 'Before blocking' }).click(); };
    const go = (...steps) => async (page) => { for (const s of steps) await s(page); await ready(page); await toSim(page); };
    const path = '/designer?kind=snowflake&view=3d';
    // the presets are in the design pane; on a phone it is a separate pane (switch back to the result)
    const design = async (page) => { const t = page.getByRole('tab', { name: 'Design' }); if (await t.isVisible().catch(() => false)) await t.click(); };
    const result = async (page) => { const t = page.getByRole('tab', { name: 'Snowflake' }); if (await t.isVisible().catch(() => false)) await t.click(); };
    return [
      { name: 'snowflake-3d-blocked', path, wait: '.sf-sim', prepare: go() },
      { name: 'snowflake-3d-relaxed', path, wait: '.sf-sim', prepare: go(relaxed) },
      { name: 'snowflake-3d-blocked-dark', path, wait: '.sf-sim', scheme: 'dark', prepare: go() },
      { name: 'snowflake-3d-relaxed-dark', path, wait: '.sf-sim', scheme: 'dark', only: 'phone', prepare: go(relaxed) },
      { name: 'snowflake-3d-trefoil', path, wait: '.sf-sim', only: 'desktop', prepare: go(design, preset('Trefoil points'), result) },
      { name: 'snowflake-3d-trefoil-relaxed', path, wait: '.sf-sim', only: 'desktop', prepare: go(design, preset('Trefoil points'), result, relaxed) },
      { name: 'snowflake-3d-simple', path, wait: '.sf-sim', only: 'desktop', prepare: go(design, preset('Simple star'), result) },
      { name: 'snowflake-3d-12', path, wait: '.sf-sim', only: 'desktop', prepare: go(design, preset('Double-pointed', 12), result) },
      { name: 'snowflake-3d-12-relaxed', path, wait: '.sf-sim', only: 'desktop', prepare: go(design, preset('Double-pointed', 12), result, relaxed) },
      // phone, scrolled: the sticky top bar must not show the tab row through it
      {
        name: 'snowflake-scrolled', path: '/designer?kind=snowflake&view=3d', wait: '.sf-tabs', only: 'phone', scheme: 'dark',
        prepare: async (page) => { await page.locator('.sf-tabs').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 20)); await page.waitForTimeout(300); },
      },
    ];
  })(),
  // every preset and three random designs (5, 8, 12 points), blocked (template overlaid) and before
  // blocking, light + dark: docs/screenshots/snowflake-3d-<id>-<state>[-dark]-<viewport>.png, and the
  // Preview star of each (snowflake-preview-<id>-<viewport>.png) to compare proportions
  ...(() => {
    const designs = [
      ['simple-star', 'Simple star'], ['fern', 'Fern'], ['trefoil', 'Trefoil points'], ['lacy-hexagon', 'Lacy hexagon'],
      ['double-pointed', 'Double-pointed'], ['tiny', 'Tiny ornament'], ['bold-star', 'Bold eight-point star'],
      ['random-5', null, 5, 21], ['random-8', null, 8, 7], ['random-12', null, 12, 3],
    ];
    const pick = ([, label, points, seed]) => async (page) => {
      const t = page.getByRole('tab', { name: 'Design' }); if (await t.isVisible().catch(() => false)) await t.click();
      if (label) await page.getByRole('button', { name: label, exact: true }).first().click();
      else {
        await page.locator('button.dz-toggle', { hasText: new RegExp(`^${points}$`) }).first().click();
        await page.waitForTimeout(300);
        await page.locator('#sf-seed').fill(String(seed));
      }
      await page.waitForTimeout(600);
      const r = page.getByRole('tab', { name: 'Snowflake' }); if (await r.isVisible().catch(() => false)) await r.click();
    };
    const ready = async (page) => { await page.waitForSelector('.sf-sim .sim-stage[data-state="ready"]', { timeout: 120_000 }); await page.waitForTimeout(800); };
    const toSim = async (page) => { await page.locator('.sf-sim').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (window.innerWidth < 900 ? 60 : 8))); await page.waitForTimeout(300); };
    const relaxed = async (page) => { await page.getByRole('radio', { name: 'Before blocking' }).click(); };
    const out = [];
    for (const d of designs) {
      const id = d[0];
      for (const scheme of ['light', 'dark']) {
        const sfx = scheme === 'dark' ? '-dark' : '';
        out.push({ name: `snowflake-3d-${id}-blocked${sfx}`, path: '/designer?kind=snowflake&view=3d', wait: '.sf-sim', scheme, prepare: async (page) => { await pick(d)(page); await ready(page); await toSim(page); } });
        out.push({ name: `snowflake-3d-${id}-before${sfx}`, path: '/designer?kind=snowflake&view=3d', wait: '.sf-sim', scheme, prepare: async (page) => { await pick(d)(page); await ready(page); await relaxed(page); await ready(page); await toSim(page); } });
      }
      out.push({
        name: `snowflake-preview-${id}`, path: '/designer?kind=snowflake&view=preview', wait: '.sf-stage .sf-preview',
        prepare: async (page) => { await pick(d)(page); await page.locator('.sf-stage').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (window.innerWidth < 900 ? 60 : 8))); await page.waitForTimeout(400); },
      });
    }
    return out;
  })(),
  // the standalone Chart page of a saved snowflake: arms laid out as radial spines (core/chart pointed rounds)
  ...(() => {
    // view: 'arm' / 'all' switches the chart's Whole / One arm buttons (the page's default otherwise)
    const openChart = (preset, points, view) => async (page) => {
      const tab = async (name) => { const t = page.getByRole('tab', { name }); if (await t.isVisible().catch(() => false)) await t.click(); };
      await tab('Design');
      await page.getByRole('button', { name: preset, exact: true }).first().click();
      if (points) await page.locator('button.dz-toggle', { hasText: new RegExp(`^${points}$`) }).first().click();
      await page.waitForTimeout(600);
      await tab('Snowflake');
      await page.getByRole('button', { name: 'Open in…' }).first().click();
      await page.getByRole('menuitem', { name: 'Chart' }).click();
      await page.waitForSelector('.ch-page .ch-svg');
      await page.waitForTimeout(400);
      if (view) {
        const b = page.locator('.ch-viewbar button').nth(view === 'arm' ? 1 : 0);
        if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
        await page.waitForTimeout(400);
        await page.locator('.ch-stage').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (window.innerWidth < 900 ? 64 : 8)));
        await page.waitForTimeout(300);
      }
    };
    const d = '/designer?kind=snowflake';
    return [
      { name: 'chart-snowflake-fern', path: d, wait: '.sf-layers', only: 'desktop', prepare: openChart('Fern') },
      { name: 'chart-snowflake-12', path: d, wait: '.sf-layers', only: 'desktop', prepare: openChart('Double-pointed', 12) },
      // one arm of six, enlarged ("work it ×6"): the default on a phone
      { name: 'chart-snowflake-arm', path: d, wait: '.sf-layers', prepare: openChart('Fern', 0, 'arm') },
      // five points with valley anchors (bridges pinned to a sc in each valley)
      { name: 'chart-snowflake-5pt', path: d, wait: '.sf-layers', only: 'desktop', prepare: openChart('Trefoil points', 5, 'all') },
      // bobble (cluster) tips on sc spines, eight points: one arm
      { name: 'chart-snowflake-bobble', path: d, wait: '.sf-layers', only: 'desktop', prepare: openChart('Bold eight-point star', 0, 'arm') },
    ];
  })(),
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
  // blanket studio: examples loaded with #/blanket?demo=<id>; the results pane is the hero on desktop
  ...(() => {
    const ready = async (page) => { await page.waitForSelector('.bk-hero__svg', { timeout: 30_000, state: 'attached' }); await page.waitForTimeout(900); };
    const toResult = async (page) => { const t = page.getByRole('tab', { name: 'Blanket' }); if (await t.isVisible().catch(() => false)) { await t.click(); await page.waitForTimeout(400); } };
    const toBorder = async (page) => {
      await ready(page);
      await page.locator('.bk-checks').evaluate(scrollToInPane);
      await page.waitForTimeout(400);
    };
    return [
      { name: 'blanket-rect', path: '/blanket?demo=moss-throw', wait: '.bk-controls', prepare: async (page) => { await ready(page); await toResult(page); } },
      { name: 'blanket-granny-stripe', path: '/blanket?demo=granny-stripe-baby', wait: '.bk-controls', only: 'desktop', prepare: ready },
      { name: 'blanket-round', path: '/blanket?demo=giant-granny', wait: '.bk-controls', prepare: async (page) => { await ready(page); await toResult(page); } },
      { name: 'blanket-hexagon', path: '/blanket?demo=hexagon', wait: '.bk-controls', only: 'desktop', prepare: ready },
      { name: 'blanket-c2s', path: '/blanket?demo=circle-to-square', wait: '.bk-controls', only: 'desktop', prepare: ready },
      { name: 'blanket-mandala', path: '/blanket?demo=mandala', wait: '.bk-controls', only: 'desktop', prepare: ready },
      { name: 'blanket-motifs', path: '/blanket?demo=motifs', wait: '.bk-controls', prepare: async (page) => { await ready(page); await toResult(page); } },
      { name: 'blanket-border', path: '/blanket?demo=edge-fit', wait: '.bk-controls', prepare: toBorder },
      { name: 'blanket-design', path: '/blanket?demo=moss-throw', wait: '.bk-controls', only: 'phone', prepare: ready },
    ];
  })(),
  // yarn estimates: editor card (expanded), calibration dialog, counter "yarn left" + ball heads-up, my yarns, amigurumi
  ...(() => {
    const checkTab = async (page) => { const t = page.getByRole('tab', { name: /Check/ }); if (await t.isVisible().catch(() => false)) await t.click(); };
    const openYarn = async (page) => {
      await checkTab(page);
      await page.locator('.ed-yarn .yn-line').click();
      await page.waitForSelector('.ed-yarn .yn-body');
      await page.locator('.ed-yarn').evaluate((el) => {
        el.scrollIntoView({ block: 'start' });
        if (window.innerWidth >= 900) window.scrollTo(0, document.querySelector('.ui-split').getBoundingClientRect().top + window.scrollY - 8);
        else window.scrollBy(0, -72);
      });
      await page.waitForTimeout(300);
    };
    const dlg = (page) => page.locator('dialog[open]');
    return [
      { name: 'yarn-editor', path: '/editor/corpus%3Aspiderweb-doily-10', wait: '.ed-box', prepare: openYarn },
      {
        name: 'yarn-calibrate', path: '/editor/fixture%3Asc_sphere', wait: '.ed-box', only: 'desktop',
        prepare: async (page) => {
          await openYarn(page);
          await page.locator('.ed-yarn').getByRole('button', { name: 'Calibrate with a swatch' }).click();
          const d = dlg(page);
          await d.getByLabel('Weight, tails trimmed').fill('10.4');
          await d.getByRole('button', { name: 'Add a swatch in another stitch' }).click();
          await d.getByLabel('Weight, tails trimmed').nth(1).fill('12.0');
          await d.getByLabel('Ball band').fill('180');
          await d.getByLabel('Name').fill('Merino worsted, teal');
          await d.locator('.ui-dialog__body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
          await page.waitForTimeout(300);
        },
      },
      {
        name: 'yarn-counter', path: '/editor/fixture%3Asc_sphere', wait: '.ed-box', only: 'phone',
        prepare: async (page) => {
          // a 5 g leftover ball, so the counter's "ball runs out" heads-up shows mid-piece
          await openYarn(page);
          await page.locator('.ed-yarn').getByLabel('Ball size').fill('5');
          await page.waitForTimeout(400);
          await page.goto(page.url().replace(/#.*$/, '#/counter/fixture%3Asc_sphere'));
          await page.waitForSelector('.ctr-tap');
          await page.click('.ctr-roundbtn');
          await page.locator('.ctr-rounds__btn', { hasText: 'Rnd 8' }).click();
          await page.waitForTimeout(3600);
          for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(300);
        },
      },
      {
        name: 'yarn-settings', path: '/about', wait: 'main h1', only: 'desktop',
        prepare: async (page) => {
          await page.getByRole('button', { name: 'Add a yarn' }).first().click();
          let d = dlg(page);
          await d.getByLabel('Name').fill('Cotton no. 10, white');
          await d.getByLabel('Weight').selectOption('thread-10');
          await d.getByLabel('Ball band').fill('564');
          await d.getByLabel('Ball size').fill('50');
          await d.getByRole('button', { name: 'Save' }).click();
          await page.waitForTimeout(300);
          await page.getByRole('button', { name: 'Calibrate a new yarn' }).click();
          d = dlg(page);
          await d.getByLabel('Weight, tails trimmed').fill('10.4');
          await d.getByLabel('Ball band').fill('180');
          await d.getByLabel('Name').fill('Merino worsted, teal');
          await d.getByLabel('Ball size').fill('100');
          await d.getByRole('button', { name: 'Save calibration' }).click();
          await page.waitForTimeout(3600);
          await page.locator('#yarns').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80));
          await page.waitForTimeout(300);
        },
      },
      {
        name: 'yarn-gauge', path: '/amigurumi?tab=gauge', wait: '.ami-gauge', only: 'desktop',
        prepare: async (page) => {
          // a blanket-sized rectangle: estimated from counts (too big to compile), several balls
          await page.getByLabel('Width').first().fill('120');
          await page.getByLabel('Height').first().fill('150');
          await page.waitForTimeout(400);
          await page.locator('.ami-yarnline .yn-line').first().click();
          await page.locator('.ami-yarnline').first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 160));
          await page.waitForTimeout(300);
        },
      },
      {
        name: 'yarn-amigurumi', path: '/amigurumi', wait: '.ami-editor', only: 'phone',
        prepare: async (page) => {
          await page.getByRole('tab', { name: /^Pattern/ }).click();
          await page.waitForTimeout(800);
          await page.locator('.ami-yarn .yn-line').click();
          await page.locator('.ami-yarn').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 72));
          await page.waitForTimeout(300);
        },
      },
    ];
  })(),
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
