import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compilePattern } from '../notation';
import { paramsFor } from '../params';
import type { Pattern } from '../graph';
import { boundsUpto, buildHitIndex, hitTest, layoutChart, roundAt, solveOrdered } from './index';
import type { ChartLayout } from './types';

const fixDir = fileURLToPath(new URL('../../../../spec/fixtures/', import.meta.url));
const corpusDir = fileURLToPath(new URL('../../../../data/corpus/', import.meta.url));
const list = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.cro')).sort().map((f) => dir + f) : []);
const FILES = [...list(fixDir), ...list(corpusDir)];

const compiled = new Map<string, Pattern>();
function load(file: string): Pattern | undefined {
  if (!compiled.has(file)) {
    const r = compilePattern(readFileSync(file, 'utf8'));
    if (r.pattern) compiled.set(file, r.pattern);
  }
  return compiled.get(file);
}
const name = (f: string) => f.split('/').pop()!;

const ROW_SWATCH = [
  'title: Swatch',
  'Foundation: ch 11.',
  'Row 1: sc in 2nd ch from hook, sc in each ch across. (10)',
  'Rows 2-3: ch 1, sc blo in each st across. (10)',
  'Row 4: ch 3 (counts as dc), dc in each of next 8 sts, dc in top of tch. (10)',
  'Row 5: ch 1, sc, ch 3, sk 2 sts, sc in next st, 2 sc in next st, dc2tog, sc in next 3 sts. (8)',
].join('\n');

function checkLayout(L: ChartLayout, label: string) {
  // finite coordinates
  for (const n of L.nodes) {
    for (const v of [n.x, n.y, n.cx, n.cy, n.rot, n.s, n.r]) expect(Number.isFinite(v), `${label} node ${n.id}`).toBe(true);
    for (const p of n.legs) expect(Number.isFinite(p.x) && Number.isFinite(p.y), `${label} leg of ${n.id}`).toBe(true);
  }
  for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(Number.isFinite(L.bounds[k])).toBe(true);
  for (const R of L.rounds) {
    if (R.first < 0) continue;
    const course = L.nodes.slice(R.first, R.last + 1).filter((n) => n.course);
    // monotone course coordinate in the round's working direction
    for (let i = 1; i < course.length; i++) {
      expect(R.dir * (course[i].s - course[i - 1].s), `${label} ${R.label}: nodes ${course[i - 1].id}→${course[i].id}`).toBeGreaterThanOrEqual(-1e-9);
    }
    // a closed round fits in one turn (the join sits in the gap between the last and first stitch)
    const body = course.filter((n) => n.role !== 'join');
    if (L.mode === 'radial' && body.length > 1) {
      expect(R.dir * (body[body.length - 1].s - body[0].s), `${label} ${R.label} span`).toBeLessThanOrEqual(2 * Math.PI + 1e-6);
    }
  }
}

/** Smallest distance between glyph centres of two symbols in the same round (travelling sl sts sit on their anchor and are excluded). */
function minSpacing(L: ChartLayout): { d: number; where: string } {
  let best = { d: Infinity, where: '' };
  for (const R of L.rounds) {
    if (R.first < 0) continue;
    const ns = L.nodes.slice(R.first, R.last + 1).filter((n) => n.role !== 'travel' && n.role !== 'ringjoin');
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const d = Math.hypot(ns[i].cx - ns[j].cx, ns[i].cy - ns[j].cy);
        if (d < best.d) best = { d, where: `${R.label}: ${ns[i].id}/${ns[j].id} (${ns[i].symbol.key}/${ns[j].symbol.key})` };
      }
    }
  }
  return best;
}

describe('layoutChart', () => {
  it('finds the fixtures and the corpus', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(7);
  });

  it.each(FILES.map((f) => [name(f), f] as const))('%s lays out with finite, ordered, non-overlapping symbols', (label, file) => {
    const p = load(file);
    if (!p) return; // corpus files with errors are reported by the notation suite
    const L = layoutChart(p.graph, paramsFor(p));
    expect(L.nodes.length).toBe(p.graph.nodes.length);
    expect(L.rounds.length).toBe(p.graph.rounds.length);
    expect(L.mode).toBe('radial');
    checkLayout(L, label);
    const sp = minSpacing(L);
    expect(sp.d, `${label} closest pair ${sp.where}`).toBeGreaterThan(0.2);
  });

  it('is deterministic', () => {
    const p = load(fixDir + 'simple_doily.cro')!;
    const a = layoutChart(p.graph, paramsFor(p)), b = layoutChart(p.graph, paramsFor(p));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  // n-fold fixtures: rotating the stitch tops of each round by 2π/n maps them onto themselves
  it.each([
    ['simple_doily.cro', 16],
    ['chain_space_motif.cro', 8],
    ['flat_dc_circle.cro', 12],
    ['flat_sc_circle.cro', 6],
    ['sc_cone.cro', 3],
  ] as const)('%s is %i-fold symmetric', (file, n) => {
    const p = load(fixDir + file)!;
    const L = layoutChart(p.graph, paramsFor(p));
    const a = (2 * Math.PI) / n, c = Math.cos(a), s = Math.sin(a);
    let worst = 0;
    for (const R of L.rounds) {
      if (R.first < 0) continue;
      const tops = L.nodes.slice(R.first, R.last + 1).filter((m) => m.kind === 'stitch' || (m.kind === 'tch' && p.graph.nodes[m.id].countsAs));
      if (tops.length < n) continue;
      // the top of each stitch (a counting turning chain's top is r along its angle)
      const top = (m: (typeof tops)[number]) => { const a0 = Math.atan2(-m.y, m.x); return { x: m.r * Math.cos(a0), y: -m.r * Math.sin(a0), r: m.r }; };
      const T = tops.map(top);
      for (const t of T) {
        const x = t.x * c + t.y * s, y = -t.x * s + t.y * c;
        let best = Infinity;
        for (const q of T) {
          // spiral rounds rise over the turn: compare angles at the node's own radius
          const d = R.spiral
            ? Math.abs(Math.atan2(Math.sin(Math.atan2(-y, x) - Math.atan2(-q.y, q.x)), Math.cos(Math.atan2(-y, x) - Math.atan2(-q.y, q.x)))) * t.r
            : Math.hypot(q.x - x, q.y - y);
          best = Math.min(best, d);
        }
        worst = Math.max(worst, best);
      }
    }
    expect(worst).toBeLessThan(0.25);
  });

  it('lays out 2500 nodes in well under 100 ms', () => {
    const files = FILES.filter((f) => (load(f)?.graph.nodes.length ?? 0) > 2000);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const p = load(f)!;
      layoutChart(p.graph, paramsFor(p)); // warm up
      const t0 = performance.now();
      layoutChart(p.graph, paramsFor(p));
      expect(performance.now() - t0, name(f)).toBeLessThan(100);
    }
  });

  it('keeps the radial proportions of the flatness radii and spaces rounds', () => {
    const p = load(fixDir + 'flat_dc_circle.cro')!;
    const L = layoutChart(p.graph, paramsFor(p));
    for (let k = 1; k < L.rounds.length; k++) expect(L.rounds[k].r - L.rounds[k - 1].r).toBeGreaterThanOrEqual(0.8 - 1e-9);
    // dc rounds are one dc height (1.9 sc widths) apart
    const steps = L.rounds.slice(1).map((r, k) => r.r - L.rounds[k].r);
    for (const d of steps) expect(d).toBeCloseTo(1.9, 0);
    // flatness attached for the band
    expect(L.rounds.every((r) => r.flat && r.flat.class === 'flat')).toBe(true);
  });

  it('fans increases and shells round their anchor', () => {
    const p = load(fixDir + 'flat_dc_circle.cro')!;
    const L = layoutChart(p.graph, paramsFor(p));
    // Rnd 2: "dc in same st" pairs share an anchor; their tops straddle it
    const g = p.graph;
    const R = g.rounds[1];
    for (let id = R.first; id <= R.last; id++) {
      const n = g.nodes[id], m = g.nodes[id + 1];
      if (!m || n.type !== 'dc' || m.type !== 'dc' || !('node' in n.into[0]) || !('node' in m.into[0])) continue;
      if (n.into[0].node !== m.into[0].node) continue;
      const anchor = L.nodes[n.into[0].node];
      const ang = (q: { x: number; y: number }) => Math.atan2(-q.y, q.x);
      const da = Math.atan2(Math.sin(ang(L.nodes[id]) - ang(anchor)), Math.cos(ang(L.nodes[id]) - ang(anchor)));
      const db = Math.atan2(Math.sin(ang(L.nodes[id + 1]) - ang(anchor)), Math.cos(ang(L.nodes[id + 1]) - ang(anchor)));
      expect(Math.sign(da) * Math.sign(db)).toBeLessThanOrEqual(0);
    }
  });

  it('lays chains of a chain space on an arc between the neighbouring stitches', () => {
    const p = load(fixDir + 'chain_space_motif.cro')!;
    const L = layoutChart(p.graph, paramsFor(p));
    const sps = p.graph.spaces.filter((s) => s.kind === 'chsp');
    expect(L.spaces.filter((s) => s.kind === 'chsp').length).toBe(sps.length);
    for (const sp of sps) {
      const first = L.nodes[sp.chains[0]], last = L.nodes[sp.chains[sp.chains.length - 1]];
      const prev = L.nodes[sp.chains[0] - 1], next = L.nodes[sp.chains[sp.chains.length - 1] + 1];
      // the chains run from next to the previous symbol to next to the following one
      expect(Math.hypot(first.x - prev.x, first.y - prev.y)).toBeLessThan(Math.hypot(last.x - prev.x, last.y - prev.y) + 1e-9);
      if (next) expect(Math.hypot(last.x - next.x, last.y - next.y)).toBeLessThan(Math.hypot(first.x - next.x, first.y - next.y) + 1e-9);
    }
  });

  it('stacks a counting turning chain from its base to the top of the round', () => {
    const p = load(fixDir + 'flat_dc_circle.cro')!;
    const L = layoutChart(p.graph, paramsFor(p));
    const tch = p.graph.nodes.filter((n) => n.round === 2 && n.role === 'tch');
    expect(tch.length).toBe(3);
    const rs = tch.map((n) => L.nodes[n.id].r);
    expect(rs[0]).toBeLessThan(rs[1]);
    expect(rs[1]).toBeLessThan(rs[2]);
  });

  it('lays out rows as a grid', () => {
    const r = compilePattern(ROW_SWATCH);
    expect(r.pattern).toBeDefined();
    const g = r.pattern!.graph;
    const L = layoutChart(g, paramsFor(r.pattern));
    expect(L.mode).toBe('rows');
    checkLayout(L, 'swatch');
    // rows go up, alternate direction
    const h = L.rounds.map((R) => R.r);
    for (let k = 1; k < h.length; k++) expect(h[k]).toBeGreaterThan(h[k - 1]);
    expect(L.rounds[1].dir).toBe(-L.rounds[2].dir);
    expect(minSpacing(L).d).toBeGreaterThan(0.2);
  });

  it('hit tests nodes and rounds', () => {
    const p = load(fixDir + 'simple_doily.cro')!;
    const L = layoutChart(p.graph, paramsFor(p));
    const ix = buildHitIndex(L);
    for (const id of [0, 30, 120, 300]) expect(hitTest(ix, L.nodes[id].cx, L.nodes[id].cy, 0.3)).toBe(id);
    expect(hitTest(ix, 1e6, 1e6)).toBe(-1);
    const r2 = L.rounds[2];
    expect(roundAt(L, 0, -(r2.r0 + r2.r) / 2)).toBe(2);
    const b = boundsUpto(L, 1);
    expect(b.maxX - b.minX).toBeLessThan(L.bounds.maxX - L.bounds.minX);
  });
});

describe('solveOrdered', () => {
  it('keeps order and gaps and fits a closed span', () => {
    const t = [0, 0, 0, 0.1, 5];
    const x = solveOrdered({ target: t, weight: [1, 1, 1, 1, 1], gap: [0.5, 0.5, 0.5, 0.5], maxSpan: 2 });
    for (let i = 1; i < x.length; i++) expect(x[i] - x[i - 1]).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(x[4] - x[0]).toBeLessThanOrEqual(2 + 1e-6);
    // a fan of three spreads symmetrically round its target
    const y = solveOrdered({ target: [1, 1, 1], weight: [1, 1, 1], gap: [0.2, 0.2] });
    expect(y[0]).toBeCloseTo(0.8);
    expect(y[2]).toBeCloseTo(1.2);
  });
});

describe('sc glyph orientation (review R23)', () => {
  // the two strokes of every sc cross: slopes ±1 for "×", 0 / ∞ for "+", whatever the round angle
  const segs = (d: string) => [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)].map((m) => m.slice(1).map(Number));
  const pat = load(fixDir + 'flat_sc_circle.cro')!;
  const layout = layoutChart(pat.graph, paramsFor(pat));
  const scs = layout.nodes.filter((n) => n.symbol.base === 'sc' && n.symbol.legs === 1);
  it('× never turns into +', async () => {
    const { glyph } = await import('./index');
    expect(scs.length).toBeGreaterThan(100);
    for (const n of scs) {
      const s = segs(glyph(n, { sc: 'x' }).stroke).slice(-2);
      for (const [x1, y1, x2, y2] of s) expect(Math.abs(Math.abs((y2 - y1) / (x2 - x1)) - 1)).toBeLessThan(0.05);
    }
  });
  it('+ stays +', async () => {
    const { glyph } = await import('./index');
    for (const n of scs) {
      const s = segs(glyph(n, { sc: 'plus' }).stroke).slice(-2);
      for (const [x1, y1, x2, y2] of s) expect(Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1))).toBeLessThan(0.01);
    }
  });
});
