import { describe, expect, it } from 'vitest';
import { compilePattern } from '../notation';
import { analyzeFlatness } from '../flatness';
import { paramSetById } from '../params';
import { circle, convertGauge, gaugeFromParams, hat, nearestCount, paramsFromGauge, rectangle, tube, startCountFor } from './index';

const worsted = paramSetById('worsted-4_5.0mm')!;

function clean(text: string) {
  const c = compilePattern(text);
  expect(c.diagnostics.filter((d) => d.severity !== 'info').map((d) => d.message), text).toEqual([]);
  return c.pattern!;
}

describe('gauge basics', () => {
  it('gauge from a parameter set: 100 / w, 100 / h', () => {
    const g = gaugeFromParams(worsted, 'sc');
    expect(g.stitches).toBeCloseTo(15.38, 2); // 100 / 6.5
    expect(g.rows).toBeCloseTo(16.19, 2);     // 100 / 6.175
  });
  it('params from a gauge keep the other stitches in proportion', () => {
    const p = paramsFromGauge({ stitches: 20, rows: 20 }, 'sc', worsted);
    expect(p.stitches.sc.width).toBeCloseTo(5, 6);
    expect(p.stitches.sc.height).toBeCloseTo(5, 6);
    expect(p.stitches.dc.height / p.stitches.sc.height).toBeCloseTo(12.35 / 6.175, 6);
    expect(startCountFor(p, 'sc')).toBe(6); // 2π·5/5 = 6.28
  });
  it('nearest count with a repeat constraint', () => {
    expect(nearestCount(32)).toBe(32);
    expect(nearestCount(32, 6, 1)).toBe(31);  // 31 = 5·6+1, 37 is further
    expect(nearestCount(34, 6, 1)).toBe(37);  // |37−34| = 3 = |31−34|: ties go up
    expect(nearestCount(2, 4, 0)).toBe(4);    // at least one repeat
    expect(nearestCount(81.3, 2)).toBe(82);
  });
});

describe('rectangle', () => {
  const g = { stitches: 16, rows: 18 };
  it('20 × 10 cm in sc at 16 × 18', () => {
    const r = rectangle({ gauge: g, widthCm: 20, heightCm: 10 });
    expect(r).toMatchObject({ stitches: 32, rows: 18, turningChain: 1, foundationChain: 33 });
    expect(r.actualWidthCm).toBeCloseTo(20, 6);
    const p = clean(r.text);
    const rows = p.graph.rounds.filter((x) => x.kind === 'row');
    expect(rows).toHaveLength(18);
    expect(rows.every((x) => x.stitchCount === 32)).toBe(true);
  });
  it('ease and a pattern repeat', () => {
    const r = rectangle({ gauge: g, widthCm: 20, heightCm: 10, easePct: 10, multiple: 6, plus: 1 });
    expect(r.stitches).toBe(37); // 35.2 → nearest 6k+1 is 37
    expect(r.rows).toBe(18);     // 10 cm × 1.8 rows/cm: ease widens, it does not lengthen (review N11)
    clean(r.text);
  });
  it('dc: chain = stitches + 3, first dc in 4th ch from hook', () => {
    const r = rectangle({ gauge: g, widthCm: 10, heightCm: 10, stitch: 'dc' });
    expect(r.foundationChain).toBe(19);
    expect(r.text).toMatch(/Foundation: ch 19\.\nRow 1: dc in 4th ch from hook, dc in each ch across\. \(16\)/);
    clean(r.text);
    clean(rectangle({ gauge: g, widthCm: 7, heightCm: 3, stitch: 'hdc' }).text);
  });
});

describe('flat circle', () => {
  it('12 cm in worsted sc: 10 rounds of +6, flat', () => {
    const c = circle({ gauge: gaugeFromParams(worsted, 'sc'), diameterCm: 12, params: worsted });
    expect(c.counts).toEqual([6, 12, 18, 24, 30, 36, 42, 48, 54, 60]);
    expect(c.perRound).toBeCloseTo(5.97, 2);
    expect(c.actualDiameterCm).toBeCloseTo(12.35, 2);
    const p = clean(c.text);
    expect(analyzeFlatness(p.graph, worsted).worst).toBeNull();
  });
  it('a gauge with short stitches adds fewer per round', () => {
    // 20 sts and 25 rows per 10 cm: w = 5, h = 4 → 2π·4/5 = 5.03 per round
    const c = circle({ gauge: { stitches: 20, rows: 25 }, diameterCm: 8, regular: false });
    expect(c.perRound).toBeCloseTo(5.03, 2);
    expect(c.counts).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    clean(c.text);
  });
  it('hdc and dc circles start with 8 and 12', () => {
    expect(circle({ gauge: gaugeFromParams(worsted, 'hdc'), diameterCm: 10, stitch: 'hdc', params: worsted }).counts.slice(0, 3)).toEqual([8, 16, 24]);
    const dc = circle({ gauge: gaugeFromParams(worsted, 'dc'), diameterCm: 10, stitch: 'dc', params: worsted });
    expect(dc.counts.slice(0, 3)).toEqual([12, 24, 36]);
    clean(dc.text);
  });
});

describe('tube', () => {
  it('hat band: 56 cm, −10% ease, multiple of 2', () => {
    const t = tube({ gauge: { stitches: 16, rows: 18 }, circumferenceCm: 56, easePct: -10, heightCm: 5, multiple: 2 });
    expect(t.stitches).toBe(80);   // 56·0.9·1.6 = 80.6 → 80
    expect(t.rounds).toBe(9);      // 5·1.8
    const p = clean(t.text);
    expect(p.graph.rounds.filter((r) => r.stitchCount > 0).every((r) => r.stitchCount === 80)).toBe(true);
  });
});

describe('top-down hat', () => {
  it('56 cm head, 8% negative ease, 20 cm, hdc at the worsted gauge', () => {
    const g = gaugeFromParams(worsted, 'hdc'); // 15.38 sts, 11.83 rows
    const r = hat({ gauge: g, headCm: 56, heightCm: 20, params: worsted });
    // 56·0.92 = 51.52 cm · 1.538 = 79.3 → 79 sts
    expect(r.stitches).toBe(79);
    expect(r.counts.slice(0, 4)).toEqual([8, 16, 24, 32]);
    expect(r.crownRounds).toBe(10);           // 8·10 = 80 ≥ 79
    expect(r.counts[9]).toBe(79);
    expect(r.counts.length).toBe(24);         // 20 cm · 1.183 = 23.7 → 24 rounds
    expect(r.bodyRounds).toBe(14);
    const p = clean(r.text);
    expect(p.graph.rounds.map((x) => x.stitchCount)).toEqual(r.counts);
  });
  it('multiple constraint and warnings', () => {
    const r = hat({ gauge: { stitches: 14, rows: 10 }, headCm: 50, heightCm: 6, multiple: 4, stitch: 'dc' });
    expect(r.stitches % 4).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0); // 6 cm is less than the crown
    clean(r.text);
  });
});

describe('gauge conversion', () => {
  it('pattern 16 sts / 10 cm, mine 18: more stitches, smaller pieces, bigger hook', () => {
    const r = convertGauge({ pattern: { stitches: 16, rows: 18 }, mine: { stitches: 18, rows: 18 }, stitches: 80, rows: 40, hookMm: 5 });
    expect(r.stitches).toBe(90);
    expect(r.rows).toBe(40);
    expect(r.widthFactor).toBeCloseTo(0.889, 3);
    expect(r.diffPct).toBeCloseTo(12.5, 6);
    expect(r.suggestedHookMm).toBe(6); // 12.5% ≈ 2 sizes up from 5: 5.5, 6
    expect(r.hint).toMatch(/larger hook/);
    expect(r.hint).toMatch(/swatch again/);
  });
  it('matching gauge: keep the hook; looser gauge: smaller hook', () => {
    expect(convertGauge({ pattern: { stitches: 16, rows: 18 }, mine: { stitches: 16.2, rows: 18 } }).hint).toMatch(/Keep your hook/);
    const r = convertGauge({ pattern: { stitches: 16, rows: 18 }, mine: { stitches: 15, rows: 17 }, hookMm: 4 });
    expect(r.suggestedHookMm).toBe(3.75);
    expect(r.hint).toMatch(/smaller hook/);
  });
});
