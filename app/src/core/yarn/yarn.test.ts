import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compilePattern } from '../notation/index';
import type { Pattern } from '../graph/types';
import { paramSetById, paramsFor, paramsFile, type ParamSet } from '../params/index';
import {
  ballsNeeded, calibrationFromSwatch, calibrationFromSwatches, countsOf, estimateYarn, estimateYarnFromCounts, formatBalls,
  formatLength, formatMass, gramsToMeters, gramsToOunces, metersToGrams, metersToYards, nodeFromKey, nodeLengthMm, ouncesToGrams,
  remainingYarn, rescaleEstimate, resolveYarn, swatchModel, yarnDefaultsFor, yarnKey, yardsToMeters, categoryKey, type NodeLike,
  type YarnSpec,
} from './index';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (p: string) => readFileSync(`${root}${p}`, 'utf8');
const compiled = (text: string): Pattern => {
  const r = compilePattern(text);
  if (!r.pattern) throw new Error(r.diagnostics.map((d) => d.message).join('\n'));
  return r.pattern;
};
const worsted = paramSetById('worsted-4_5.0mm')!;
const thread = paramSetById('thread-10_1.5mm')!;
const PI = Math.PI;

const sources: [string, string][] = [
  ...readdirSync(`${root}spec/fixtures`).filter((f) => f.endsWith('.cro')).map((f): [string, string] => [`fixture:${f}`, read(`spec/fixtures/${f}`)]),
  ...readdirSync(`${root}spec/fixtures/extra`).filter((f) => f.endsWith('.cro')).map((f): [string, string] => [`extra:${f}`, read(`spec/fixtures/extra/${f}`)]),
  ...readdirSync(`${root}data/corpus`).filter((f) => f.endsWith('.cro')).map((f): [string, string] => [`corpus:${f}`, read(`data/corpus/${f}`)]),
  ['example:tiny', read('spec/examples/tiny.cro')],
];

describe('per-stitch model', () => {
  const y = resolveYarn(worsted);
  const L = (k: string, set: ParamSet = worsted) => nodeLengthMm(nodeFromKey(k)!, set, resolveYarn(set));
  it('hand-computed lengths (worsted, d = 2.5 mm)', () => {
    expect(y.diameterMm).toBe(2.5);
    expect(L('sc')).toBeCloseTo(2 * 6.5 + 2 * 6.175 + 3 * PI * 2.5, 12);
    expect(L('ch')).toBeCloseTo(2 * 4.55 + PI * 2.5, 12);
    expect(L('dc')).toBeCloseTo(2 * 6.5 + 3 * 12.35 + 5 * PI * 2.5, 12);
    expect(L('sc2tog')).toBeCloseTo(2 * 6.5 + 4 * 6.175 + 5 * PI * 2.5, 12);
    expect(L('picot')).toBeCloseTo(3 * L('ch') + L('sl st'), 12);
    expect(L('pc')).toBeCloseTo(5 * L('dc') + 9.1 + PI * 2.5, 12);
    expect(L('fpdc')).toBeCloseTo(1.2 * L('dc'), 12);
  });
  it('monotonic in stitch height: sl st < sc < hdc < dc < tr < dtr, for every param set', () => {
    for (const set of paramsFile.sets) {
      const xs = ['sl st', 'sc', 'hdc', 'dc', 'tr', 'dtr'].map((k) => L(k, set));
      for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  });
  it('rule of thumb: a dc uses 1.6–2 × an sc', () => {
    for (const set of paramsFile.sets) {
      const r = L('dc', set) / L('sc', set);
      expect(r).toBeGreaterThan(1.6);
      expect(r).toBeLessThan(2);
    }
  });
  it('decreases and clusters cost more than one leg, less than separate stitches + nothing', () => {
    expect(L('sc2tog')).toBeGreaterThan(L('sc'));
    expect(L('sc2tog')).toBeLessThan(2 * L('sc'));
    expect(L('3-dc cl')).toBeLessThan(3 * L('dc'));
    expect(L('puff 4-loop')).toBeGreaterThan(L('puff'));
  });
  it('yarnKey ⇄ nodeFromKey round-trips', () => {
    for (const k of ['ch', 'turning ch', 'sl st', 'sc', 'hdc', 'dc', 'tr', 'dtr', 'sc2tog', 'dc3tog', 'fpdc', 'bphdc', '3-dc cl', '5-hdc cl', 'puff', 'puff 4-loop', 'pc', 'pc 6-dc', 'picot', 'picot ch-5']) {
      expect(yarnKey(nodeFromKey(k)!)).toBe(k);
    }
    expect(nodeFromKey('nonsense')).toBeUndefined();
  });
});

describe('hand-computed totals', () => {
  it('tiny example: 12 sc, 3 sl st, 8 ch, 3 dc', () => {
    const p = compiled(read('spec/examples/tiny.cro'));
    const e = estimateYarn(p, worsted);
    // 12·(25.35 + 7.5π) + 3·(9.1 + 5π) + 8·(9.1 + 2.5π) + 3·(50.05 + 12.5π) mm
    expect(e.net.meters).toBeCloseTo((554.45 + 162.5 * PI) / 1000, 12);
    expect(e.total.meters).toBeCloseTo(e.net.meters * 1.1, 12);
    expect(e.byStitch).toMatchObject({ sc: expect.any(Number), 'sl st': expect.any(Number), ch: expect.any(Number), 'turning ch': expect.any(Number), dc: expect.any(Number) });
    expect(e.stitches).toBe(26);
  });
  it('flat sc circle: 216 sc', () => {
    const p = compiled(read('spec/fixtures/flat_sc_circle.cro'));
    const e = estimateYarn(p, paramsFor(p));
    expect(e.net.meters).toBeCloseTo((216 * (25.35 + 7.5 * PI)) / 1000, 12);
    expect(e.net.grams).toBeCloseTo((e.net.meters * 100) / 180, 12);
    expect(e.net.metersLow).toBeCloseTo(e.net.meters * 0.8, 12);
    expect(e.net.metersHigh).toBeCloseTo(e.net.meters * 1.2, 12);
    expect(e.status).toBe('nominal');
  });
});

describe('every fixture and corpus pattern', () => {
  it.each(sources)('%s: finite positive totals, per-round sums = total, by colour = total', (_name, text) => {
    const p = compiled(text);
    const set = paramsFor(p);
    const e = estimateYarn(p, set, { colorOfRound: (r) => (r % 3 === 0 ? 'A' : r % 3 === 1 ? 'B' : 'main') });
    expect(Number.isFinite(e.net.meters) && e.net.meters > 0).toBe(true);
    expect(Number.isFinite(e.total.grams!) && e.total.grams! > 0).toBe(true);
    const perRound = e.perRound.reduce((s, r) => s + r.meters, 0);
    expect(perRound).toBeCloseTo(e.net.meters, 9);
    expect(e.perRound[e.perRound.length - 1].cumulative).toBeCloseTo(e.net.meters, 9);
    expect(e.perRound.length).toBe(p.graph.rounds.length);
    const byColor = Object.values(e.byColor!).reduce((s, a) => s + a.meters, 0);
    expect(byColor).toBeCloseTo(e.net.meters, 9);
    const byStitch = Object.values(e.byStitch).reduce((s, m) => s + m, 0);
    expect(byStitch).toBeCloseTo(e.net.meters, 9);
    // the counts-based estimate equals the graph-based one by construction
    expect(estimateYarnFromCounts(countsOf(p.graph), set).net.meters).toBeCloseTo(e.net.meters, 9);
    // uptoRound and remainingYarn partition the piece
    const half = Math.floor(p.graph.rounds.length / 2);
    const part = estimateYarn(p, set, { uptoRound: half });
    expect(part.net.meters).toBeCloseTo(e.perRound[half].cumulative, 9);
    const R = p.graph.rounds[half + 1];
    if (R && R.first >= 0) expect(remainingYarn(p, set, R.first).net.meters + part.net.meters).toBeCloseTo(e.net.meters, 9);
  });
});

describe('counts-based', () => {
  it('equals the graph-based estimate for a plain rectangle', () => {
    const text = 'title: Rect\nFoundation: ch 13.\nRow 1: sc in 2nd ch from hook, sc in each ch across. (12)\nRows 2-10: ch 1, turn, sc in each st across. (12)\n';
    const p = compiled(text);
    const g = estimateYarn(p, worsted);
    const counts = { ch: 12, sc: 120, 'turning ch': 10 }; // the compiler counts the skipped chain as a turning chain
    expect(countsOf(p.graph)).toEqual(counts);
    expect(estimateYarnFromCounts(counts, worsted).net.meters).toBeCloseTo(g.net.meters, 12);
    expect(estimateYarnFromCounts({ ch: 22, sc: 120 }, worsted).net.meters).toBeCloseTo(g.net.meters, 12);
  });
  it('unknown keys are reported, not counted', () => {
    const e = estimateYarnFromCounts({ sc: 10, wiggle: 5 }, worsted);
    expect(e.net.meters).toBeCloseTo(10 * nodeLengthMm(nodeFromKey('sc')!, worsted, resolveYarn(worsted)) / 1000, 12);
    expect(e.notes.join(' ')).toMatch(/wiggle/);
  });
});

describe('yarn, allowance, balls, units', () => {
  it('defaults from the param set', () => {
    expect(yarnDefaultsFor(worsted).key).toBe('medium-4');
    expect(yarnDefaultsFor(thread).key).toBe('thread-10');
    expect(categoryKey('crochet cotton no. 20')).toBe('thread-20');
    expect(categoryKey('worsted-4')).toBe('medium-4');
    expect(categoryKey('dk-3')).toBe('light-3');
    expect(categoryKey('chunky')).toBe('bulky-5');
    const y = resolveYarn(worsted);
    expect(y.defaulted).toEqual({ metersPer100g: true, ballGrams: true });
    expect(y.allowance).toBe(0.1);
  });
  it('a lighter yarn of the category is thinner (d ∝ 1/sqrt(m/g))', () => {
    expect(resolveYarn(worsted, { metersPer100g: 720 }).diameterMm).toBeCloseTo(1.25, 12);
  });
  it('allowance is kept separate from the net figure', () => {
    const p = compiled(read('spec/fixtures/sc_sphere.cro'));
    const a = estimateYarn(p, worsted, { yarn: { allowance: 0 } });
    const b = estimateYarn(p, worsted, { yarn: { allowance: 0.25 } });
    expect(a.net.meters).toBe(b.net.meters);
    expect(a.total.meters).toBe(a.net.meters);
    expect(b.total.meters).toBeCloseTo(a.net.meters * 1.25, 12);
  });
  it('balls always round up', () => {
    expect(ballsNeeded(240, 100)).toEqual({ balls: 3, exact: 2.4 });
    expect(ballsNeeded(200, 100).balls).toBe(2);
    expect(ballsNeeded(200.0000000001, 100).balls).toBe(2);
    expect(ballsNeeded(200.01, 100).balls).toBe(3);
    expect(ballsNeeded(3, 50).balls).toBe(1);
    expect(formatBalls(240, 100)).toBe('3 balls (2.4)');
    expect(formatBalls(30, 100)).toBe('1 ball (0.3)');
  });
  it('unit conversions', () => {
    expect(metersToYards(0.9144)).toBeCloseTo(1, 12);
    expect(yardsToMeters(metersToYards(123.4))).toBeCloseTo(123.4, 12);
    expect(gramsToOunces(28.349523125)).toBeCloseTo(1, 12);
    expect(ouncesToGrams(gramsToOunces(62))).toBeCloseTo(62, 12);
    expect(metersToGrams(180, 180)).toBe(100);
    expect(gramsToMeters(50, 230)).toBe(115);
    expect(formatLength(182.4)).toBe('180 m');
    expect(formatLength(182.4, 'imperial')).toBe('200 yd');
    expect(formatMass(62.3)).toBe('62 g');
    expect(formatMass(62.3, 'imperial')).toBe('2.2 oz');
  });
  it('ball breaks: the second ball starts where the cumulative yarn passes one ball', () => {
    const p = compiled(read('data/corpus/spiderweb-doily-10.cro'));
    const e = estimateYarn(p, thread, { yarn: { ballGrams: 1 } });
    const ballM = (1 * e.yarn!.metersPer100g) / 100;
    expect(e.ballBreaks!.length).toBe(Math.min(60, Math.ceil(e.net.meters / ballM) - 1));
    const b = e.ballBreaks![0];
    expect(b.ball).toBe(2);
    expect(e.perRound[b.round].cumulative).toBeGreaterThanOrEqual(ballM);
  });
});

describe('calibration', () => {
  const d = resolveYarn(worsted).diameterMm;
  const synth = (stitch: string, n: number, rows: number, kw: number, kh: number, m100 = 180) => {
    const m = swatchModel({ stitch, stitches: n, rows }, worsted, d);
    const meters = kw * m.loop + kh * m.height;
    return { stitch, stitches: n, rows, grams: (meters * 100) / m100, metersPer100g: m100 };
  };
  it('recovers a known single factor from one synthetic swatch', () => {
    const c = calibrationFromSwatch(synth('sc', 20, 20, 1.17, 1.17), worsted, d);
    expect(c.kind).toBe('single');
    expect(c.factor).toBeCloseTo(1.17, 12);
  });
  it('recovers separate loop / height factors from two stitches', () => {
    const c = calibrationFromSwatches([synth('sc', 20, 20, 0.9, 1.25), synth('dc', 18, 10, 0.9, 1.25)], worsted, d);
    expect(c.kind).toBe('split');
    expect(c.width).toBeCloseTo(0.9, 9);
    expect(c.height).toBeCloseTo(1.25, 9);
  });
  it('frogged metres win over grams; invalid input says so', () => {
    const c = calibrationFromSwatch({ stitch: 'sc', stitches: 10, rows: 10, meters: 6, grams: 999, metersPer100g: 180 }, worsted, d);
    expect(c.factor).toBeCloseTo(6 / swatchModel({ stitch: 'sc', stitches: 10, rows: 10 }, worsted, d).meters, 12);
    expect(calibrationFromSwatch({ stitch: 'sc', stitches: 10, rows: 10, grams: 5 }, worsted, d).kind).toBe('invalid');
  });
  it('calibrated status narrows the band', () => {
    const p = compiled(read('spec/fixtures/sc_sphere.cro'));
    const n = estimateYarn(p, worsted);
    const c = estimateYarn(p, worsted, { yarn: { calibration: 1.1 } });
    const s = estimateYarn(p, worsted, { yarn: { calibrationSplit: { width: 1.1, height: 1.1 } } });
    expect(c.status).toBe('calibrated');
    expect(c.net.meters).toBeCloseTo(n.net.meters * 1.1, 9);
    expect(s.net.meters).toBeCloseTo(c.net.meters, 9);
    const w = (e: typeof n) => (e.net.metersHigh - e.net.metersLow) / e.net.meters;
    expect(w(c)).toBeLessThan(w(n));
    expect(w(s)).toBeLessThan(w(c));
  });
  it('rescaleEstimate follows the yarn (grams, balls, calibration)', () => {
    const e = estimateYarnFromCounts({ dc: 1000 }, worsted);
    const r = rescaleEstimate(e, worsted, { metersPer100g: 90, ballGrams: 50, calibration: 1.2 });
    expect(r.net.meters).toBeCloseTo(e.net.meters * 1.2, 9);
    expect(r.net.grams).toBeCloseTo((r.net.meters * 100) / 90, 9);
  });
});

/* ------------------------------------------------------------------ cross-language golden */

interface Golden {
  nodes: NodeLike[];
  node_cases: { params: string; yarn: YarnSpec | null; diameter_mm: number; mm: number[] }[];
  patterns: { graph: string; params: string; yarn: YarnSpec | null; net_m: number; total_m: number; low_m: number; high_m: number; net_g: number; balls: number }[];
  swatch_cases: { params: string; diameter_mm: number; swatches: Parameters<typeof calibrationFromSwatches>[0]; model_loop_height_m: [number, number][]; result: { kind: string; factor: number; width?: number; height?: number } }[];
}

describe('spec/yarn_golden.json (shared with lab/tests/test_yarn.py)', () => {
  const G = JSON.parse(read('spec/yarn_golden.json')) as Golden;
  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));
  it('per-node lengths', () => {
    expect(G.node_cases.length).toBeGreaterThan(10);
    for (const c of G.node_cases) {
      const set = paramSetById(c.params)!;
      const y = resolveYarn(set, c.yarn ?? undefined);
      near(y.diameterMm, c.diameter_mm);
      c.mm.forEach((mm, i) => near(nodeLengthMm(G.nodes[i], set, y), mm));
    }
  });
  it('pattern totals from graph JSON', () => {
    for (const c of G.patterns) {
      const p = JSON.parse(read(`spec/${c.graph}`)) as Pattern;
      const set = paramSetById(c.params)!;
      const e = estimateYarn(p, set, { yarn: c.yarn ?? undefined });
      near(e.net.meters, c.net_m);
      near(e.total.meters, c.total_m);
      near(e.net.metersLow, c.low_m);
      near(e.net.metersHigh, c.high_m);
      near(e.net.grams!, c.net_g);
      expect(ballsNeeded(e.total.grams!, e.yarn!.ballGrams).balls).toBe(c.balls);
    }
  });
  it('swatch models and calibration fits', () => {
    for (const c of G.swatch_cases) {
      const set = paramSetById(c.params)!;
      c.swatches.forEach((sw, i) => {
        const m = swatchModel(sw, set, c.diameter_mm);
        near(m.loop, c.model_loop_height_m[i][0]);
        near(m.height, c.model_loop_height_m[i][1]);
      });
      const r = calibrationFromSwatches(c.swatches, set, c.diameter_mm);
      expect(r.kind).toBe(c.result.kind);
      near(r.factor, c.result.factor);
      if (c.result.width !== undefined) { near(r.width!, c.result.width); near(r.height!, c.result.height!); }
    }
  });
});
