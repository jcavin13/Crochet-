// Snowflakes in the spring sim (user report 2026-11-27: the 3D tab showed a tangled blob):
// spines are stiff cords (N5/P7), blocking with the template's pins gives a crisp n-pointed star,
// and the "before blocking" view (resting on a table) lies flat with n distinguishable arms.
import { describe, expect, it } from 'vitest';
import { generateSnowflake, randomSnowflake, snowflakePins, SNOWFLAKE_PRESETS, type SnowflakeResult } from '../generate/snowflake';
import { paramSetById } from '../params';
import { createSim, simulate, type SimHandle } from './index';

const params = paramSetById('thread-10_1.5mm')!;
const results = new Map<string, SnowflakeResult>();
const gen = (key: string, spec: Parameters<typeof generateSnowflake>[0]) => {
  if (!results.has(key)) results.set(key, generateSnowflake(spec, params));
  return results.get(key)!;
};
const presets = SNOWFLAKE_PRESETS.map((p) => [p.id, gen(p.id, p.spec)] as const);

function run(sim: SimHandle) {
  let st;
  do { st = sim.step(1e9); } while (!st.done);
}

const nodeXY = (X: ArrayLike<number>, i: number): [number, number, number] => [X[3 * i], X[3 * i + 1], X[3 * i + 2]];

describe('spines are stiff cords (relaxed sim, no table)', () => {
  for (const [id, res] of presets) {
    it(`${id}: every stem stays at least 85 % of its rest length end to end`, () => {
      const sim = simulate(res.pattern!.graph, params, { gtolRound: 1e-4, gtolFinal: 1e-5 });
      const X = sim.positions;
      for (const sp of sim.network.spines) {
        const a = sp.stem[0], b = sp.stem[sp.stem.length - 1];
        const rest = sp.pos.get(b)![0] - sp.pos.get(a)![0];
        const [ax, ay, az] = nodeXY(X, a), [bx, by, bz] = nodeXY(X, b);
        expect(Math.hypot(bx - ax, by - ay, bz - az) / rest, `${id} spine at ${sp.base}`).toBeGreaterThanOrEqual(0.85);
      }
    });
  }
  it('arms written as hook-addressed chains are found as spines (one per point and minor arm)', () => {
    const fern = results.get('fern')!;
    const sim = simulate(fern.pattern!.graph, params, { uptoRound: 0 });
    expect(sim.network.spines.length).toBe(6);
  });
});

/** Blocked with the template's pins; checks pins exact, tips at the template radius, n-fold symmetric spines. */
function checkBlocked(res: SnowflakeResult, label: string) {
  const g = res.pattern!.graph;
  const pins = snowflakePins(res);
  const n = res.spec.points;
  expect(pins.filter((p) => p.kind === 'tip').length, label).toBe(n);
  const sim = createSim(g, params, { table: true, pins, blocked: true, accuracy: 'fast' });
  run(sim);
  const b = sim.block()!;
  expect(b.pinCount, label).toBe(pins.length);
  expect(b.pinStretch, label).toBeDefined();
  const X = sim.positions;
  // the blocked piece is planar
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < g.nodes.length; i++) { zmin = Math.min(zmin, X[3 * i + 2]); zmax = Math.max(zmax, X[3 * i + 2]); }
  expect(zmax - zmin, label).toBeLessThan(1e-3);
  // pinned nodes sit exactly on the template: distances between pins are the template's
  const tips = pins.filter((p) => p.kind === 'tip');
  const d = (i: number, j: number) => Math.hypot(X[3 * tips[i].node] - X[3 * tips[j].node], X[3 * tips[i].node + 1] - X[3 * tips[j].node + 1]);
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const want = Math.hypot(tips[k].x - tips[j].x, tips[k].y - tips[j].y);
    expect(Math.abs(d(k, j) - want), label).toBeLessThan(2e-3);
  }
  // tips at the predicted radius: centre = mean of the tip pins
  let cx = 0, cy = 0;
  for (const t of tips) { cx += X[3 * t.node]; cy += X[3 * t.node + 1]; }
  cx /= n; cy /= n;
  for (const t of tips) {
    expect(Math.abs(Math.hypot(X[3 * t.node] - cx, X[3 * t.node + 1] - cy) - res.shape.tipR), label).toBeLessThan(0.01 * res.shape.tipR);
  }
  // n-fold symmetry: every major spine, rotated back by its angle, lies on the first one
  const spines = sim.network.spines.filter((sp) => tips.some((t) => sp.tip.includes(t.node) || sp.stem.includes(t.node)));
  // pointed-loop arms (tip style 'loop') have no spine: their symmetry is the tips' (pinned) one
  expect([0, n], label).toContain(spines.length);
  if (!spines.length) return b;
  const polar = (i: number) => { const x = X[3 * i] - cx, y = X[3 * i + 1] - cy; return [Math.hypot(x, y), Math.atan2(y, x)] as const; };
  // arm-to-arm distance (RMS over the spine's nodes, after rotating by the angle between the arms;
  // dihedral: an arm may also be the mirror image about its own axis)
  const dist = (sp: typeof spines[number], ref: typeof spines[number]) => {
    if (sp.nodes.length !== ref.nodes.length) return 0;
    const a0 = polar(ref.stem[ref.stem.length - 1])[1];
    const da = polar(sp.stem[sp.stem.length - 1])[1] - a0;
    let best = Infinity;
    for (const m of [1, -1]) {
      let w = 0;
      sp.nodes.forEach((v, q) => {
        const [r, a] = polar(v), [r0, b0] = polar(ref.nodes[q]);
        const ang = a0 + m * (a - da - a0);
        w += (r * Math.cos(ang) - r0 * Math.cos(b0)) ** 2 + (r * Math.sin(ang) - r0 * Math.sin(b0)) ** 2;
      });
      best = Math.min(best, Math.sqrt(w / sp.nodes.length));
    }
    return best;
  };
  // reference: the medoid arm. One arm may differ: the round's start, join and the seams of the
  // rounds below are a real asymmetry of the worked piece (e.g. seed 6 × 6: one arm base sits 4 mm out)
  const sums = spines.map((sp) => spines.reduce((acc, o) => acc + dist(sp, o), 0));
  const ref = spines[sums.indexOf(Math.min(...sums))];
  const tol = 0.05 * res.shape.tipR;
  const off = spines.map((sp) => dist(sp, ref)).filter((d) => d > tol);
  expect(off.length, `${label}: arms off the symmetric shape by ${off.map((d) => d.toFixed(2)).join(', ')} mm RMS`).toBeLessThanOrEqual(1);
  return b;
}

describe('blocked with the template pins: a crisp n-pointed star', () => {
  for (const [id, res] of presets) {
    it(id, () => {
      const b = checkBlocked(res, id);
      // the default (Fern) and the simple presets pin out without overstretching anything
      if (id === 'fern' || id === 'simple-star' || id === 'trefoil') expect(Math.max(b.pinStretch!.spines, b.pinStretch!.chains, b.pinStretch!.body), id).toBeLessThan(0.15);
    });
  }
  for (const points of [5, 6, 8, 12]) {
    it(`20 random ${points}-point snowflakes`, () => {
      for (let seed = 1; seed <= 20; seed++) checkBlocked(gen(`r${points}-${seed}`, randomSnowflake(seed, { params, points })), `seed ${seed} × ${points}`);
    }, 240_000);
  }
});

describe('before blocking, resting on a table', () => {
  for (const [id, res] of presets) {
    it(`${id}: lies flat and shows ${res.spec.points} arms`, () => {
      const n = res.spec.points;
      const sim = createSim(res.pattern!.graph, params, { table: true, accuracy: 'fast' });
      run(sim);
      const X = sim.positions;
      const nn = sim.network.nNodes;
      let zmin = Infinity, zmax = -Infinity, cx = 0, cy = 0;
      for (let i = 0; i < nn; i++) { zmin = Math.min(zmin, X[3 * i + 2]); zmax = Math.max(zmax, X[3 * i + 2]); cx += X[3 * i]; cy += X[3 * i + 1]; }
      cx /= nn; cy /= nn;
      expect(zmax - zmin, id).toBeLessThan(0.5);
      if (id === 'lacy-hexagon') return; // pointed chain loops, not spines: floppy by design
      // angular histogram of the outermost nodes: one peak per arm
      const pts = Array.from({ length: nn }, (_, i) => ({ r: Math.hypot(X[3 * i] - cx, X[3 * i + 1] - cy), a: Math.atan2(X[3 * i + 1] - cy, X[3 * i] - cx) }));
      const rmax = Math.max(...pts.map((p) => p.r));
      const bins = 72;
      const h = new Array(bins).fill(0);
      for (const p of pts) if (p.r > 0.7 * rmax) h[Math.floor(((p.a + Math.PI) / (2 * Math.PI)) * bins) % bins]++;
      // peaks: maximal runs of bins holding at least 2 nodes (a lone chain of a hanging valley loop is not an arm)
      let peaks = 0;
      for (let k = 0; k < bins; k++) if (h[k] >= 2 && h[(k + bins - 1) % bins] < 2) peaks++;
      const arms = res.shape.anchorPins.filter((a) => a.kind !== 'valley').length;
      expect(peaks, `${id}: ${h.join(',')}`).toBeGreaterThanOrEqual(n);
      expect(peaks, `${id}: ${h.join(',')}`).toBeLessThanOrEqual(arms);
    });
  }
});
