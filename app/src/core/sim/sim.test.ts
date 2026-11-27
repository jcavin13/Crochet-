// Cross-sim agreement (the CI contract of docs/architecture.md) and solver checks.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pattern } from '../graph';
import { paramsFor, simConfig } from '../params';
import {
  block, buildNetwork, createSim, Grower, Lbfgs, Placer, shapeMetric, simulate, springEnergy, type SimResult,
} from './index';
import { gather, subProblem } from './solve';
import { eigSym3 } from './metrics';

const fixtures = fileURLToPath(new URL('../../../../spec/fixtures/', import.meta.url));
const names = readdirSync(fixtures).filter((f) => f.endsWith('.lab.json')).map((f) => f.slice(0, -'.lab.json'.length));
const load = (name: string) => JSON.parse(readFileSync(fixtures + name + '.graph.json', 'utf8')) as Pattern;
const json = (f: string) => JSON.parse(readFileSync(fixtures + f, 'utf8'));

/**
 * Note: ruffles and closed shapes are multistable at the level of floating-point rounding (the
 * network has zero-stiffness isometric modes). The sim therefore uses engine-independent math
 * (detmath.ts) and numpy's operation order in placement, so that its growth follows the lab's:
 * sc_sphere lands in the lab's minimum (with Math.sin/Math.hypot it landed at A 1.62 in node and
 * 1.53 in Chromium vs the lab's 2.13); hyperbolic_plane diverges at its round-2 bifurcation
 * through L-BFGS-B-internal rounding and ends at W 0.52 vs 0.60, within agree_abs.
 */

const cache = new Map<string, SimResult>();
function sim(name: string): SimResult {
  if (!cache.has(name)) {
    const pat = load(name);
    cache.set(name, simulate(pat, paramsFor(pat)));
  }
  return cache.get(name)!;
}
const metricOf = (r: SimResult) => shapeMetric(r.positions, r.network.particleRound.subarray(0, r.network.nNodes));

describe('cross-sim agreement with the lab reference (spec/fixtures/*.lab.json)', () => {
  for (const name of names) {
    it(name, () => {
      const lab = json(name + '.lab.json');
      const expected = json(name + '.expected.json');
      const r = sim(name);
      const m = metricOf(r);
      expect(r.converged).toBe(true);
      expect(r.ms).toBeLessThan(15000);
      expect(m.class).toBe(expected.shape);
      expect(m.class).toBe(lab.class);
      expect(Math.abs(m.Rg - lab.Rg)).toBeLessThanOrEqual(simConfig.agree_rg_rel * lab.Rg);
      expect(Math.abs(m.W - lab.W)).toBeLessThanOrEqual(simConfig.agree_abs);
      expect(Math.abs(m.A - lab.A)).toBeLessThanOrEqual(simConfig.agree_abs);
      expect(r.network.nNodes).toBe(lab.n_nodes);
    });
  }
});

describe('solver', () => {
  it('placement + relaxation are deterministic, and the incremental API reproduces simulate()', () => {
    const pat = load('sc_cone');
    const a = simulate(pat, paramsFor(pat));
    const b = simulate(pat, paramsFor(pat));
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
    const h = createSim(pat, paramsFor(pat));
    let st = h.step(0.5);
    let guard = 0;
    while (!st.done && guard++ < 100000) st = h.step(0.5);
    expect(st.done).toBe(true);
    const pos = Float32Array.from(a.positions);
    expect(Array.from(h.positions)).toEqual(Array.from(pos));
    // scrubbing to an earlier round is instant (snapshot) and equals that round's snapshot
    h.setUptoRound(2);
    expect(h.step(1).done).toBe(true);
    expect(Array.from(h.positions)).toEqual(Array.from(Float32Array.from(a.snapshots[2])));
    expect(h.metric()!.class).toBe(json('sc_cone.lab.json').per_round[2].class);
    h.dispose();
  });

  it('round-by-round: energy after relaxing is below the energy of the placed state, and iterations never increase it', () => {
    const pat = load('hyperbolic_plane');
    const net = buildNetwork(pat, paramsFor(pat));
    const pl = new Placer(net, simConfig);
    for (let r = 0; r < net.graph.rounds.length; r++) {
      pl.placeRound(r);
      const sp = subProblem(net, pl.placedMask());
      const opt = new Lbfgs((x, g) => springEnergy(sp.springs, x, g), gather(pl.X, sp.idx), { gtol: 1e-6 });
      const E0 = opt.f;
      let prev = E0;
      while (opt.status === 'running') {
        opt.iterate();
        expect(opt.f).toBeLessThanOrEqual(prev + 1e-12 * Math.max(1, prev));
        prev = opt.f;
      }
      expect(opt.f).toBeLessThanOrEqual(E0);
      sp.idx.forEach((p, q) => { for (let d = 0; d < 3; d++) pl.X[3 * p + d] = opt.x[3 * q + d]; });
    }
  });

  it('analytic gradient matches finite differences (including tension-only springs, slack and taut)', () => {
    const pat = load('chain_space_motif');
    const net = buildNetwork(pat, paramsFor(pat));
    const gr = new Grower(net, simConfig, { uptoRound: 1 });
    gr.advance();
    const sp = subProblem(net, gr.placer.placedMask());
    expect(Array.from(sp.springs.slack).some((s) => s === 1)).toBe(true);
    const x = gather(gr.X, sp.idx);
    // shake so that springs are off rest length both ways
    for (let i = 0; i < x.length; i++) x[i] += 0.3 * Math.sin(1.7 * i + 0.3);
    const g = new Float64Array(x.length);
    springEnergy(sp.springs, x, g);
    const tmp = new Float64Array(x.length);
    let slackTaut = 0, slackLoose = 0;
    for (let q = 0; q < sp.springs.m; q++) {
      if (!sp.springs.slack[q]) continue;
      const a = 3 * sp.springs.I[q], b = 3 * sp.springs.J[q];
      const d = Math.hypot(x[a] - x[b], x[a + 1] - x[b + 1], x[a + 2] - x[b + 2]);
      if (d > sp.springs.L[q]) slackTaut++; else slackLoose++;
    }
    expect(slackTaut).toBeGreaterThan(0);
    expect(slackLoose).toBeGreaterThan(0);
    const h = 1e-6;
    let worst = 0;
    for (let i = 0; i < x.length; i += 7) {
      const xp = Float64Array.from(x); xp[i] += h;
      const xm = Float64Array.from(x); xm[i] -= h;
      const fd = (springEnergy(sp.springs, xp, tmp) - springEnergy(sp.springs, xm, tmp)) / (2 * h);
      worst = Math.max(worst, Math.abs(fd - g[i]) / Math.max(1e-3, Math.abs(g[i])));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it('partial growth (uptoRound) matches the per-round snapshot of the full run', () => {
    const r = sim('flat_sc_circle');
    const pat = load('flat_sc_circle');
    const part = simulate(pat, paramsFor(pat), { uptoRound: 3 });
    expect(part.roundsDone).toBe(4);
    expect(Array.from(part.snapshots[3])).toEqual(Array.from(r.snapshots[3]));
    const lab = json('flat_sc_circle.lab.json');
    const m3 = shapeMetric(r.snapshots[3], r.network.particleRound.subarray(0, r.network.nNodes));
    expect(m3.class).toBe(lab.per_round[3].class);
    expect(Math.abs(m3.Rg - lab.per_round[3].Rg)).toBeLessThan(0.01 * lab.per_round[3].Rg);
  });
});

describe('shape metric', () => {
  it('PCA axis: least-variance eigenvector with its largest component positive', () => {
    // a tilted flat disc with normal ±(0, -0.6, 0.8): the largest-magnitude component (z) is made positive
    const X: number[] = [], rounds: number[] = [];
    const n = [0, -0.6, 0.8], u = [1, 0, 0], v = [0, 0.8, 0.6];
    for (let r = 1; r <= 3; r++) for (let k = 0; k < 12; k++) {
      const t = (2 * Math.PI * k) / 12;
      for (let d = 0; d < 3; d++) X.push(5 * r * (Math.cos(t) * u[d] + Math.sin(t) * v[d]));
      rounds.push(r);
    }
    const m = shapeMetric(X, rounds);
    expect(m.axisKind).toBe('pca');
    expect(m.axis[0]).toBeCloseTo(n[0], 9);
    expect(m.axis[1]).toBeCloseTo(n[1], 9);
    expect(m.axis[2]).toBeCloseTo(n[2], 9);
    expect(m.class).toBe('flat');
    expect(m.A).toBeLessThan(1e-12);
    expect(m.outer_radius).toBeCloseTo(15, 9);
  });
  it('eigSym3 decomposes', () => {
    const { values, vectors } = eigSym3([[4, 1, 0], [1, 3, 0.5], [0, 0.5, 1]]);
    for (let k = 0; k < 3; k++) {
      const v = vectors[k];
      const Av = [4 * v[0] + v[1], v[0] + 3 * v[1] + 0.5 * v[2], 0.5 * v[1] + v[2]];
      for (let d = 0; d < 3; d++) expect(Av[d]).toBeCloseTo(values[k] * v[d], 10);
    }
    expect(values[0]).toBeLessThan(values[1]);
  });
  it('per-round metrics of the lab are reproduced on a solid fixture', () => {
    const r = sim('sc_cone');
    const lab = json('sc_cone.lab.json');
    r.snapshots.forEach((X, k) => {
      const m = shapeMetric(X, r.network.particleRound.subarray(0, r.network.nNodes));
      expect(m.class, `round ${k}`).toBe(lab.per_round[k].class);
      expect(Math.abs(m.A - lab.per_round[k].A)).toBeLessThan(simConfig.agree_abs);
    });
  });
});

describe('blocking (physics.md §6)', () => {
  const blk = (name: string) => { const r = sim(name); return block(r.network, r.positions); };
  it('lace fixtures block flat; positions lie in a plane, outer round pinned at block_stretch', () => {
    for (const name of ['simple_doily', 'chain_space_motif']) {
      const b = blk(name);
      expect(b.converged).toBe(true);
      expect(b.verdict).not.toBe('impossible');
      expect(b.buckleFraction).toBeLessThan(0.05);
    }
    const r = sim('chain_space_motif');
    const b = block(r.network, r.positions);
    expect(b.verdict).toBe('easy');
    // planarity: all blocked positions in one plane
    const m = metricOf(r);
    let maxOff = 0;
    for (let p = 0; p < r.network.nParticles; p++) {
      const off = (b.positions[3 * p] - m.centroid[0]) * m.axis[0] + (b.positions[3 * p + 1] - m.centroid[1]) * m.axis[1]
        + (b.positions[3 * p + 2] - m.centroid[2]) * m.axis[2];
      maxOff = Math.max(maxOff, Math.abs(off));
    }
    expect(maxOff).toBeLessThan(1e-9);
    // pinned nodes: in-plane distance from c = block_stretch × relaxed distance from the axis
    let pins = 0;
    for (let p = 0; p < r.network.nNodes; p++) {
      if (!b.pinned[p]) continue;
      pins++;
      const radial = (Y: ArrayLike<number>) => {
        const D = [Y[3 * p] - m.centroid[0], Y[3 * p + 1] - m.centroid[1], Y[3 * p + 2] - m.centroid[2]];
        const z = D[0] * m.axis[0] + D[1] * m.axis[1] + D[2] * m.axis[2];
        return Math.hypot(D[0] - z * m.axis[0], D[1] - z * m.axis[1], D[2] - z * m.axis[2]);
      };
      expect(radial(b.positions)).toBeCloseTo(simConfig.block_stretch * radial(r.positions), 9);
    }
    expect(pins).toBeGreaterThan(0);
  });
  it('flat circle blocks easily; hyperbolic plane will not (lab: buckle 0 / 0.36)', () => {
    const f = blk('flat_sc_circle');
    expect(f.buckleFraction).toBe(0);
    expect(f.maxCompression).toBeLessThan(0.1);
    expect(f.verdict).toBe('easy');
    const h = blk('hyperbolic_plane');
    expect(h.buckleFraction).toBeGreaterThan(0.2);
    expect(h.buckleFraction).toBeLessThan(0.6);
    expect(h.meanAbsStrain).toBeGreaterThan(3 * f.meanAbsStrain);
    expect(h.verdict).toBe('impossible');
    expect(h.message).toMatch(/Will not block flat: \d+% of the edge would have to be compressed/);
  });
});
