// Blanket designer core: every generated pattern compiles cleanly, the closed-form counts equal
// the compiled graph's, sizes hit the target, borders and polygons pass their checks.
import { describe, expect, it } from 'vitest';
import { compilePattern } from '../notation';
import type { Graph, Node, Pattern } from '../graph';
import { paramSetById } from '../params';
import { analyzeSymmetry } from '../symmetry';
import {
  BORDER_PRESETS, BORDERS, DEFAULT_SPEC, ROUND_STYLES, STITCH_PATTERNS, blanketParams, designBlanket, planMotifs, planStripes,
  randomBlanket, colorRuns, STRIPE_KINDS, ROW_END_RULES, type BlanketSpec, type StripePlan,
} from './index';
import { rowRanges, writeSegs } from './write';
import { buildRect } from './rect';

/** Same keys as the yarn estimator (spec/yarn.md): node → 'ch' / 'turning ch' / 'sl st' / 'sc' / 'dc3tog' / '5-dc cl'… */
function yarnKeyOf(n: Node): string {
  if (n.type === 'ch') return n.role === 'tch' || n.countsAs ? 'turning ch' : 'ch';
  if (n.type === 'slst') return 'sl st';
  if (n.type === 'picot') return 'picot';
  const post = n.loop === 'fp' || n.loop === 'bp' ? n.loop : '';
  if (n.tag === 'cluster') return `${post}${n.into.length}-${n.type} cl`;
  if (n.into.length >= 2) return `${post}${n.type}${n.into.length}tog`;
  return `${post}${n.type}`;
}
const graphKeys = (g: Graph) => {
  const out: Record<string, number> = {};
  for (const n of g.nodes) out[yarnKeyOf(n)] = (out[yarnKeyOf(n)] ?? 0) + 1;
  return out;
};
const graphKeysByColor = (g: Graph, colors: string[]) => {
  const out: Record<string, Record<string, number>> = {};
  for (const n of g.nodes) {
    const c = colors[n.round];
    out[c] = out[c] ?? {};
    out[c][yarnKeyOf(n)] = (out[c][yarnKeyOf(n)] ?? 0) + 1;
  }
  return out;
};
const clean = (text: string): Pattern => {
  const r = compilePattern(text);
  const bad = r.diagnostics.filter((d) => d.severity !== 'info');
  expect(bad.map((d) => `${d.line}: ${d.message}`)).toEqual([]);
  expect(r.pattern).toBeDefined();
  return r.pattern!;
};

const spec = (p: Partial<BlanketSpec>): BlanketSpec => ({ ...DEFAULT_SPEC, ...p });

describe('rectangle bodies: every stitch pattern × size × gauge', () => {
  const sizes = [{ widthCm: 30, heightCm: 30 }, { widthCm: 45, heightCm: 60 }];
  const gauges: { paramsId: string; gauge?: { sts: number; rows: number } }[] = [
    { paramsId: 'worsted-4_5.0mm' }, { paramsId: 'dk-3_4.0mm' }, { paramsId: 'worsted-4_5.0mm', gauge: { sts: 14, rows: 9 } },
  ];
  for (const pat of STITCH_PATTERNS) {
    for (const size of sizes) {
      for (const g of gauges) {
        it(`${pat.id} ${size.widthCm}×${size.heightCm} ${g.paramsId}${g.gauge ? ' my gauge' : ''}`, () => {
          const d = designBlanket(spec({ body: { pattern: pat.id }, size, ...g, stripes: { kind: 'even', rows: 3, colors: ['A', 'B'] } }));
          expect(d.compiled).toBe('full');
          const p = clean(d.text);
          expect(d.diagnostics.swatch.filter((x) => x.severity !== 'info')).toEqual([]);
          expect(d.swatch).toBeDefined();
          // closed-form counts = graph counts, in total and per colour
          expect(d.counts.keys).toEqual(graphKeys(p.graph));
          expect(d.counts.byColor).toEqual(graphKeysByColor(p.graph, d.roundColors));
          expect(d.roundColors).toHaveLength(p.graph.rounds.length);
          // achieved size within one repeat of the target
          const colW = d.params.stitches[pat.unit].width * pat.wRatio;
          expect(Math.abs(d.size.achieved.widthCm - size.widthCm) * 10).toBeLessThanOrEqual(pat.multiple * colW / 2 + 0.6 * colW + 1e-6);
          expect(Math.abs(d.size.achieved.heightCm - size.heightCm) * 10).toBeLessThanOrEqual(d.params.stitches[pat.unit].height * pat.hRatio + 1e-6);
          // edge fit and corners after the automatic choices
          expect(d.checks.edges.every((e) => e.class === 'ok')).toBe(true);
          expect(d.checks.polygon.filter((x) => x.class !== 'flat' && !x.intended).map((x) => x.message)).toEqual([]);
          expect(d.warnings).toEqual([]);
        });
      }
    }
  }
  it('notes the ripple outline and lists what cannot be expressed', async () => {
    const d = designBlanket(spec({ body: { pattern: 'ripple' }, size: { widthCm: 40, heightCm: 40 } }));
    expect(d.checks.notes.join(' ')).toMatch(/wavy/);
    const { NOT_EXPRESSIBLE } = await import('./stitches');
    expect(NOT_EXPRESSIBLE.map((x) => x.name).join(' ')).toMatch(/C2C/);
  });
});

describe('borders: every layer × body stitch × corner style', () => {
  const P = paramSetById('worsted-4_5.0mm')!;
  const bodies = ['sc', 'hdc', 'dc', 'moss', 'granny', 'mesh'];
  for (const b of BORDERS) {
    for (const body of bodies) {
      for (const edgeCorner of ['sc3', 'ch2'] as const) {
        it(`${b.kind} on ${body}, ${edgeCorner} edge corners`, () => {
          const pat = STITCH_PATTERNS.find((p) => p.id === body)!;
          const W = (pat.minRepeats + 2) * pat.multiple + pat.plus, N = 9;
          const layers = [{ kind: 'sc' as const }, { kind: b.kind }, ...(b.final ? [] : [{ kind: 'sc' as const }])];
          const built = buildRect({ pattern: pat, W, N, colW: P.stitches[pat.unit].width * pat.wRatio, rowH: P.stitches[pat.unit].height * pat.hRatio, P, border: { enabled: true, rowEnds: 'auto', edgeCorner, layers }, rowColors: Array(N).fill('A') });
          const text = ['title: t', `Foundation: ${built.lines[0].text}.`, ...rowRanges(built.lines.filter((l) => l.label === 'Row').map((l) => ({ n: l.n, text: l.text, count: l.count })), 'Row'),
            ...built.lines.filter((l) => l.label === 'Rnd').map((l) => `Rnd ${l.n}: ${l.text}. ${l.count}`)].join('\n');
          const p = clean(text);
          // exact counts per round (the count annotations were checked by the compiler) and per key
          const keys = built.lines.reduce((a, l) => { for (const [k, v] of Object.entries(l.keys)) a[k] = (a[k] ?? 0) + v; return a; }, {} as Record<string, number>);
          expect(keys).toEqual(graphKeys(p.graph));
          expect(built.edges.every((e) => e.class === 'ok')).toBe(true);
          expect(built.polygon.filter((x) => x.class !== 'flat' && !x.intended).map((x) => x.message)).toEqual([]);
          if (b.ruffle) expect(built.polygon.some((x) => x.class === 'ruffle' && x.intended)).toBe(true);
        });
      }
    }
  }
  it('every border preset compiles on a throw-sized body (full compile, under the cap)', () => {
    for (const preset of BORDER_PRESETS) {
      const d = designBlanket(spec({ body: { pattern: 'dc' }, size: { widthCm: 90, heightCm: 90 }, border: { ...DEFAULT_SPEC.border, layers: preset.layers.map((k) => ({ kind: k })) } }));
      expect(d.diagnostics.full.filter((x) => x.severity !== 'info')).toEqual([]);
      expect(d.compiled).toBe('full');
    }
  });
  it('edge fit: a wrong row-end rule is flagged with the fix, and auto fixes it', () => {
    const d = designBlanket(spec({ body: { pattern: 'dc' }, size: { widthCm: 60, heightCm: 90 }, border: { ...DEFAULT_SPEC.border, rowEnds: { num: 3, den: 1 } } }));
    const left = d.checks.edges.find((e) => e.side === 'Left side')!;
    expect(left.class).toBe('wavy');
    expect(left.message).toMatch(/Left side: 3 sc per row end gives \d+ sts over [\d.]+ cm — about \d+ too many, the edge will wave; use 2 sc per row end/);
    const fixed = designBlanket(spec({ body: { pattern: 'dc' }, size: { widthCm: 60, heightCm: 90 }, border: { ...DEFAULT_SPEC.border, rowEnds: 'auto' } }));
    expect(fixed.checks.edges.every((e) => e.class === 'ok')).toBe(true);
    const few = designBlanket(spec({ body: { pattern: 'dc' }, size: { widthCm: 60, heightCm: 90 }, border: { ...DEFAULT_SPEC.border, rowEnds: ROW_END_RULES.find((r) => r.num === 1 && r.den === 1)! } }));
    expect(few.checks.edges.find((e) => e.side === 'Left side')!.class).toBe('puckered');
  });
});

describe('in-the-round styles', () => {
  const orders: Record<string, number> = { 'granny-square': 4, 'solid-square': 4, 'mitred-square': 4, 'hexagon': 6, 'octagon': 8, circle: 6, mandala: 6 };
  for (const st of ROUND_STYLES) {
    it(`${st.id} reaches the target, compiles, passes its shape check`, () => {
      const d = designBlanket(spec({ construction: 'round', size: { widthCm: 60, heightCm: 45 }, round: { style: st.id, textures: st.defaultTextures, corner: 'auto' }, stripes: { kind: 'even', rows: 2, colors: ['A', 'B', 'C'] } }));
      expect(d.compiled).toBe('full');
      const p = clean(d.text);
      expect(d.counts.keys).toEqual(graphKeys(p.graph));
      expect(d.counts.byColor).toEqual(graphKeysByColor(p.graph, d.roundColors));
      const want = st.squareOnly ? 60 : 60;
      const h = d.params.stitches.dc.height / 10;
      expect(d.size.achieved.widthCm).toBeGreaterThan(want - 2 * h);
      expect(d.size.achieved.widthCm).toBeLessThan(want + 2 * h);
      if (!st.squareOnly) expect(Math.abs(d.size.achieved.heightCm - 45)).toBeLessThan(3 * h);
      expect(d.checks.polygon.filter((x) => x.class !== 'flat').map((x) => x.message)).toEqual([]);
      expect(d.warnings).toEqual([]);
      if (orders[st.id]) expect(analyzeSymmetry(p.graph).order % orders[st.id]).toBe(0);
    });
  }
  it('texture rounds compile (solid square, hexagon, rectangle)', () => {
    for (const style of ['solid-square', 'hexagon', 'rect-round', 'circle'] as const) {
      const d = designBlanket(spec({ construction: 'round', size: { widthCm: 40, heightCm: 30 }, round: { style, textures: ['dc', 'sc-blo', 'hdc'], corner: 'auto' } }));
      clean(d.text);
    }
  });
  it('corner styles solid / chain both stay flat', () => {
    for (const corner of ['solid', 'chain'] as const) {
      const d = designBlanket(spec({ construction: 'round', size: { widthCm: 50, heightCm: 50 }, round: { style: 'solid-square', textures: ['dc'], corner } }));
      clean(d.text);
      expect(d.checks.polygon.filter((x) => x.class !== 'flat')).toEqual([]);
    }
  });
});

describe('big blankets', () => {
  it('a king-size dc blanket is over the cap: closed-form counts, swatch compiled, text short', () => {
    const d = designBlanket(spec({ body: { pattern: 'dc' }, size: { preset: 'king', widthCm: 275, heightCm: 230 }, stripes: { kind: 'fibonacci', unit: 2, colors: ['A', 'B', 'C'] } }));
    expect(d.compiled).toBe('swatch');
    expect(d.pattern).toBeUndefined();
    expect(d.counts.nodes).toBeGreaterThan(50000);
    expect(d.warnings[0]).toMatch(/over the 50,000-node limit/);
    clean(d.swatchText);
    // the written pattern stays short thanks to row ranges
    expect(d.text.split('\n').length).toBeLessThan(200);
    // still valid notation: it fails only on the size cap
    const r = compilePattern(d.text);
    expect(r.diagnostics.filter((x) => x.severity === 'error').map((x) => x.code)).toEqual(['E_SYNTAX']);
    expect(r.diagnostics.find((x) => x.severity === 'error')!.message).toMatch(/grows past 50,000/);
  });
});

describe('colour plans', () => {
  const plans: StripePlan[] = [
    { kind: 'solid' }, { kind: 'even', rows: 4 }, { kind: 'fibonacci', unit: 1 }, { kind: 'random', seed: 3, min: 1, max: 6 },
    { kind: 'gradient' }, { kind: 'custom', seq: [{ color: 'A', rows: 2 }, { color: 'C', rows: 5 }] },
  ];
  it.each(plans.map((p) => [p.kind, p] as const))('%s partitions the rows into palette colours', (_k, plan) => {
    const keys = ['A', 'B', 'C', 'D'];
    for (const n of [1, 7, 120]) {
      const c = planStripes(plan, n, keys);
      expect(c).toHaveLength(n);
      expect(c.every((x) => keys.includes(x))).toBe(true);
      const runs = colorRuns(c);
      expect(runs.reduce((a, r) => a + r.to - r.from + 1, 0)).toBe(n);
    }
  });
  it('random stripes never repeat a colour twice in a row, gradient runs through the colours in order', () => {
    const c = planStripes({ kind: 'random', seed: 9, min: 1, max: 3 }, 200, ['A', 'B', 'C']);
    const runs = colorRuns(c);
    expect(runs.every((r, i) => i === 0 || r.color !== runs[i - 1].color)).toBe(true);
    const g = planStripes({ kind: 'gradient' }, 60, ['A', 'B', 'C']);
    expect(g[0]).toBe('A');
    expect(g[59]).toBe('C');
  });
  it('every planner kind is offered', () => {
    expect(STRIPE_KINDS.map((k) => k.kind).sort()).toEqual(plans.map((p) => p.kind).sort());
  });
});

describe('motif planner', () => {
  it('totals per colourway, size with joins, yarn per colour = per motif × count + joins', () => {
    const P = blanketParams('worsted-4_5.0mm');
    for (const layout of ['random', 'checkerboard', 'diagonal', 'gradient'] as const) {
      for (const style of ['granny-square', 'solid-square', 'hexagon'] as const) {
        const m = planMotifs({ style, rounds: 4, cols: 5, rows: 6, join: 'sc', layout, colorways: 3, seed: 4 }, P, ['A', 'B', 'C', 'D']);
        expect(m.totals.reduce((a, b) => a + b, 0)).toBe(30);
        expect(m.grid.flat().every((v) => v >= 0 && v < m.colorways.length)).toBe(true);
        // stitches by colour add up to motifs × stitches per motif + the joins
        const perMotif = m.lines.reduce((a, l) => a + Object.values(l.keys).reduce((x, y) => x + y, 0), 0);
        const all = Object.values(m.keysByColor).reduce((a, k) => a + Object.values(k).reduce((x, y) => x + y, 0), 0);
        const joins = Object.values(m.joinKeys).reduce((a, b) => a + b, 0);
        expect(all).toBe(30 * perMotif + joins);
        expect(m.widthMm).toBeGreaterThan(5 * m.acrossMm - 1);
        clean(['title: m', ...m.lines.map((l) => `Rnd ${l.n}: ${l.text}. ${l.count}`)].join('\n'));
      }
    }
    expect(planMotifs({ style: 'granny-square', rounds: 3, cols: 4, rows: 4, join: 'whip', layout: 'checkerboard', colorways: 2, seed: 1 }, P, ['A', 'B']).grid[0]).toEqual([0, 1, 0, 1]);
  });
  it('designBlanket for a motif blanket compiles the motif', () => {
    const d = designBlanket(spec({ construction: 'motif' }));
    expect(d.compiled).toBe('full');
    expect(d.motif!.totals.reduce((a, b) => a + b, 0)).toBe(DEFAULT_SPEC.motif.cols * DEFAULT_SPEC.motif.rows);
    expect(d.sections.some((s) => s.kind === 'joining')).toBe(true);
  });
});

describe('determinism and writing', () => {
  it('the same spec gives the same design; random blankets are seeded', () => {
    const a = designBlanket(DEFAULT_SPEC, undefined, { compile: false });
    const b = designBlanket(DEFAULT_SPEC, undefined, { compile: false });
    expect(a.text).toBe(b.text);
    expect(randomBlanket(42)).toEqual(randomBlanket(42));
    expect(JSON.stringify(randomBlanket(42))).not.toBe(JSON.stringify(randomBlanket(43)));
  });
  it('random blankets compile', () => {
    for (let s = 1; s <= 12; s++) {
      const sp = randomBlanket(s);
      const small = { ...sp, size: { widthCm: 50, heightCm: 60 } };
      const d = designBlanket(small);
      clean(d.compiled === 'full' ? d.text : d.swatchText);
    }
  });
  it('UK terms: the same graph, comments kept', () => {
    const us = designBlanket(spec({ size: { widthCm: 40, heightCm: 40 } }));
    const uk = designBlanket(spec({ size: { widthCm: 40, heightCm: 40 }, terms: 'UK' }));
    expect(uk.text).toMatch(/^terms: UK$/m);
    expect(uk.text).toMatch(/# Rows 1-12: colour A/);
    const strip = (p: Pattern) => JSON.parse(JSON.stringify(p.graph, (k, v) => (k === 'src' ? undefined : v)));
    expect(strip(clean(uk.text))).toEqual(strip(clean(us.text)));
  });
  it('rowRanges: identical rows and alternating pairs', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => ({ n, text: n === 1 ? 'a' : n % 2 ? 'c' : 'b', count: '' }));
    expect(rowRanges(rows, 'Row')).toEqual(['Row 1: a.', 'Rows 2-6 (even): b.', 'Rows 3-5 (odd): c.']);
    expect(rowRanges([1, 2, 3].map((n) => ({ n, text: 'x', count: '(4)' })), 'Rnd')).toEqual(['Rnds 1-3: x. (4)']);
  });
  it('writeSegs groups and repeats', () => {
    const seg = (key: string, p: string) => ({ key, n: 1, phrase: (n: number) => (n === 1 ? p : `${p} x${n}`) });
    const s = [seg('a', 'A'), seg('b', 'B'), seg('a', 'A'), seg('b', 'B'), seg('a', 'A'), seg('b', 'B')];
    expect(writeSegs(s)).toBe('(A, B) x3');
  });
});
