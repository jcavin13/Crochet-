/**
 * Pointed rounds in the chart: snowflake arms (chain spines worked back along) and long pointed
 * chain loops are laid out as radial arms, not bunched on the round's circle.
 */
import { describe, expect, it } from 'vitest';
import { compilePattern } from '../notation';
import { paramSetById, paramsFor, stitchParam } from '../params';
import { generateSnowflake, randomSnowflake, SNOWFLAKE_PRESETS, type SnowflakeResult, type SnowflakeSpec } from '../generate/snowflake';
import { buildHitIndex, chartToSvg, hitTest, layoutChart, POINTED_NOTE, roundAt } from './index';
import type { ChartLayout, ChartNode, ChartRound } from './types';

const THREAD = paramSetById('thread-10_1.5mm')!;
const PITCH = stitchParam(THREAD, 'ch').width / stitchParam(THREAD, 'sc').width;

const angle = (n: { x: number; y: number }) => Math.atan2(-n.y, n.x);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function pointedRound(L: ChartLayout): ChartRound {
  const p = L.rounds.filter((r) => r.pointed);
  expect(p.length).toBeGreaterThanOrEqual(1);
  return p[p.length - 1];
}

/** Everything a laid-out snowflake must satisfy. Returns the number of arm pairs checked for overlap. */
function checkSnowflake(r: SnowflakeResult, where: string): number {
  const g = r.pattern!.graph;
  const L = layoutChart(g, THREAD);
  const n = r.spec.points;
  for (const m of L.nodes) {
    for (const v of [m.x, m.y, m.cx, m.cy, m.rot, m.s, m.r]) expect(Number.isFinite(v), `${where} node ${m.id}`).toBe(true);
    for (const p of m.legs) expect(Number.isFinite(p.x) && Number.isFinite(p.y), `${where} leg of ${m.id}`).toBe(true);
  }
  for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(Number.isFinite(L.bounds[k])).toBe(true);
  // only the arm round is pointed; the body rounds are ordinary rounds
  const R = pointedRound(L);
  expect(R.index, where).toBe(g.rounds.length - 1);
  expect(L.rounds.filter((x) => x.pointed).length, where).toBe(1);
  const arms = R.arms!;
  expect(arms.length % n, `${where} arms`).toBe(0);
  expect(arms.length, where).toBeGreaterThanOrEqual(n);
  // the course stays ordered (the arm takes one place at its base)
  const course = L.nodes.slice(R.first, R.last + 1).filter((m) => m.course);
  for (let i = 1; i < course.length; i++) expect(R.dir * (course[i].s - course[i - 1].s), `${where} course`).toBeGreaterThanOrEqual(-1e-9);

  for (const a of arms) {
    if (a.kind !== 'spine') continue;
    const u = { x: Math.cos(a.s), y: -Math.sin(a.s) };
    // spine chains collinear with the centre, monotone outward, one chain length apart
    let prev = a.r0;
    for (const c of a.spine) {
      const m = L.nodes[c];
      expect(Math.abs(m.x * u.y - m.y * u.x), `${where} spine chain ${c} off the radius`).toBeLessThan(1e-6);
      expect(m.x * u.x + m.y * u.y, `${where} spine chain ${c} outward`).toBeGreaterThan(prev);
      prev = m.x * u.x + m.y * u.y;
      expect(m.arm).toBe('spine');
    }
    // the tip stands about a spine length beyond the base
    expect(a.r1 - a.r0, `${where} tip radius`).toBeGreaterThanOrEqual(a.spine.length * PITCH * 0.98);
    // returning stitches sit on the chain they are worked into
    const onSpine = new Set(a.spine);
    for (let id = a.first; id <= a.last; id++) {
      const nd = g.nodes[id];
      const an = nd.into[0];
      if (!an || !('node' in an) || !onSpine.has(an.node)) continue;
      const c = L.nodes[an.node], m = L.nodes[id];
      const at = m.kind === 'stitch' ? m.legs[0] : m;
      if (m.arm === 'tip') continue; // a cluster / bobble at the hook end stands on the spine's end
      expect(Math.hypot(at.x - c.x, at.y - c.y), `${where} ${nd.type} ${id} on its chain`).toBeLessThan(0.35);
    }
  }

  // n-fold symmetric: rotating the round by 2π/n maps every symbol onto one of the same kind
  const ns = L.nodes.slice(R.first, R.last + 1).filter((m) => m.arm || m.kind === 'stitch' || (m.kind === 'chain' && !m.role));
  const rot = (2 * Math.PI) / n, cs = Math.cos(rot), sn = Math.sin(rot);
  let worst = 0;
  for (const m of ns) {
    // y is down: a counter-clockwise turn by `rot` on the page
    const x = m.cx * cs + m.cy * sn, y = -m.cx * sn + m.cy * cs;
    let best = Infinity;
    for (const q of ns) if (q.symbol.key === m.symbol.key) best = Math.min(best, Math.hypot(q.cx - x, q.cy - y));
    // tolerance: 0.25 units plus ~0.6° of arc (the body rounds' own small seam effects, carried out along the arms)
    worst = Math.max(worst, best - 0.01 * Math.hypot(m.cx, m.cy));
  }
  expect(worst, `${where} ${n}-fold symmetry`).toBeLessThan(0.25);

  // neighbouring arms keep clear of each other (for designs that block crisply)
  let pairs = 0;
  if (r.check.ok) {
    const sorted = [...arms].sort((a, b) => a.s - b.s);
    const glyphs = (a: (typeof arms)[number]) => L.nodes.slice(a.first, a.last + 1);
    for (let i = 0; i < sorted.length; i++) {
      const A = glyphs(sorted[i]), B = glyphs(sorted[(i + 1) % sorted.length]);
      let d = Infinity;
      for (const p of A) for (const q of B) d = Math.min(d, Math.hypot(p.cx - q.cx, p.cy - q.cy));
      expect(d, `${where} arms ${sorted[i].first} / ${sorted[(i + 1) % sorted.length].first}`).toBeGreaterThan(0.4);
      pairs++;
    }
  }
  // the arms extend the bounds
  for (const a of arms) for (let id = a.first; id <= a.last; id++) {
    const m = L.nodes[id];
    expect(m.cx >= L.bounds.minX && m.cx <= L.bounds.maxX && m.cy >= L.bounds.minY && m.cy <= L.bounds.maxY, `${where} bounds`).toBe(true);
  }
  return pairs;
}

describe('chart layout of snowflakes (pointed rounds)', () => {
  it.each(SNOWFLAKE_PRESETS.map((p) => [p.id, p.spec] as [string, SnowflakeSpec]))('preset %s: radial arms', (id, spec) => {
    const r = generateSnowflake(spec, THREAD);
    expect(r.pattern, id).toBeDefined();
    checkSnowflake(r, id);
  });

  for (const points of [5, 6, 8, 12]) {
    it(`30 random ${points}-point snowflakes: radial, symmetric, arms clear`, () => {
      let pairs = 0;
      for (let s = 0; s < 30; s++) {
        const seed = 9100 + points * 100 + s;
        const spec = randomSnowflake(seed, { points, ornate: (s % 5) / 4, spiky: (s % 4) / 3, bold: (s % 3) / 2 });
        const r = generateSnowflake(spec, THREAD);
        if (!r.pattern) continue;
        pairs += checkSnowflake(r, `seed ${seed} n=${points}`);
      }
      expect(pairs).toBeGreaterThan(0);
    }, 60_000);
  }

  it('the fern preset: graded branch picots alternate sides of the spine as pairs', () => {
    const r = generateSnowflake(SNOWFLAKE_PRESETS.find((p) => p.id === 'fern')!.spec, THREAD);
    const L = layoutChart(r.pattern!.graph, THREAD);
    const a = pointedRound(L).arms![0];
    const u = { x: Math.cos(a.s), y: -Math.sin(a.s) };
    const side = (m: ChartNode) => Math.sign(u.x * (m.cy) - u.y * (m.cx));
    const pics = L.nodes.slice(a.first, a.last + 1).filter((m) => m.kind === 'picot');
    expect(pics.length).toBe(6);
    for (let i = 0; i < pics.length; i += 2) expect(side(pics[i]) * side(pics[i + 1])).toBe(-1);
    // each points outward, about 50° off the spine
    for (const p of pics) {
      const off = Math.abs(wrap(Math.atan2(-Math.sin(p.rot), Math.cos(p.rot)) - a.s));
      expect(off).toBeGreaterThan(0.6);
      expect(off).toBeLessThan(1.2);
    }
    // the row counter walks up the spine and back down it: ids in order, chains outward then stitches inward
    const back = L.nodes.slice(a.first, a.last + 1).filter((m) => m.arm === 'back');
    for (let i = 1; i < back.length; i++) expect(Math.hypot(back[i].x, back[i].y)).toBeLessThan(Math.hypot(back[i - 1].x, back[i - 1].y));
  });

  it('hit tests a spine chain and finds the pointed round out on its arms', () => {
    const r = generateSnowflake(SNOWFLAKE_PRESETS[0].spec, THREAD);
    const L = layoutChart(r.pattern!.graph, THREAD);
    const R = pointedRound(L);
    const a = R.arms![0];
    const c = L.nodes[a.spine[Math.floor(a.spine.length / 2)]];
    expect(hitTest(buildHitIndex(L), c.cx, c.cy, 0.3)).toBe(c.id);
    expect(roundAt(L, c.x * 1.02, c.y * 1.02)).toBe(R.index);
    // between two arms, beyond the bridges, is outside the piece
    const mid = (a.s + R.arms![1].s) / 2, far = a.r1;
    expect(roundAt(L, far * Math.cos(mid), -far * Math.sin(mid))).toBe(-1);
  });

  it('SVG export: the pointed round gets its outline and the "judged by blocking" key, not a flatness tint', () => {
    const r = generateSnowflake(SNOWFLAKE_PRESETS[1].spec, THREAD);
    const L = layoutChart(r.pattern!.graph, THREAD);
    const svg = chartToSvg(L, { title: 'Fern' });
    expect(svg).toContain(POINTED_NOTE);
    expect(svg).toContain(`${pointedRound(L).label}: ${POINTED_NOTE}`);
    expect(svg.match(/data-node="/g)!.length).toBe(L.nodes.length);
    // the arms widen the exported picture to the tips
    const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+)/.exec(svg)!.slice(1).map(Number);
    const tip = Math.max(...pointedRound(L).arms!.map((a) => a.r1));
    expect(vb[2]).toBeGreaterThan(1.5 * tip);
  });

  it('a hand-written pointed doily: spines and picot-topped chain loops from the graph alone', () => {
    const res = compilePattern([
      'title: Hand star',
      'Rnd 1: ch 4, join to form ring, ch 1, 12 sc in ring, join. (12)',
      'Rnd 2: ch 1, *sc in next st, ch 9, sl st in 4th ch from hook, ch-4 picot, sl st in next 5 ch, sc in next st* x6, join. (12 sc)',
      'Rnd 3: ch 1, *sc in next sc, ch 6, picot, ch 6, sc in next sc* x6, join. (12 sc)',
    ].join('\n'));
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const g = res.pattern!.graph;
    const L = layoutChart(g, paramsFor(res.pattern));
    expect(L.rounds[0].pointed).toBeUndefined();
    expect(L.rounds[1].arms!.map((a) => a.kind)).toEqual(Array(6).fill('spine'));
    expect(L.rounds[1].arms![0].tip.length).toBe(3);
    expect(L.rounds[2].arms!.map((a) => a.kind)).toEqual(Array(6).fill('loop'));
    // the loop's picot is its apex
    const lp = L.rounds[2].arms![0];
    const pic = L.nodes[lp.tip[0]];
    for (const c of lp.spine) expect(Math.hypot(L.nodes[c].x, L.nodes[c].y)).toBeLessThan(Math.hypot(pic.cx, pic.cy));
    expect(lp.r1 - lp.r0).toBeGreaterThan(6 * PITCH * 0.8);
  });
});
