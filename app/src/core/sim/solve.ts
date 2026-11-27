/**
 * Quasi-static solver (spec/physics.md §4 + lab/SPEC_NOTES.md C6): round-by-round growth with the
 * exact placement rules P0–P6 of `crolab/sim.py`, L-BFGS relaxation of everything placed so far
 * after each round (gtol 1e-6), then a final L-BFGS run (gtol 1e-8).
 *
 * Two entry points:
 *  * `simulate(graph, params)` — synchronous, runs to the end (tests, reference agreement);
 *  * `Grower` — the same computation as a resumable state machine (`advance(deadline)`), used by
 *    the incremental `createSim` API (sim.ts) so the UI can grow the piece across frames.
 */
import type { Graph, Pattern } from '../graph';
import { simConfig as defaultConfig, type ParamSet, type SimConfig } from '../params';
import { Lbfgs, springEnergy, now, type SpringSet } from './lbfgs';
import { buildNetwork, nodesInSpace, roundNodeIds, WALE, type Network } from './network';
import { dcos, dsin, npMean, npSum } from './detmath';

export const GOLDEN = 2.399963;

export interface SolveOptions {
  /** Grow rounds 0..uptoRound (0-based, inclusive). Default: all. */
  uptoRound?: number;
  gtolRound?: number;
  gtolFinal?: number;
  maxIter?: number;
  config?: SimConfig;
  /** Reuse a network built earlier. */
  network?: Network;
}

export interface SimResult {
  network: Network;
  /** [3 nParticles] final positions; NaN for particles not made (rounds beyond uptoRound). */
  positions: Float64Array;
  energy: number;
  converged: boolean;
  /** Per round: positions after relaxing that round (same layout). */
  snapshots: Float64Array[];
  /** Energy after each round's relaxation. */
  roundEnergies: number[];
  roundsDone: number;
  iterations: number;
  ms: number;
}

// ---------------------------------------------------------------------------------------------
// vector helpers on a flat [3n] array
// ---------------------------------------------------------------------------------------------
type V3 = [number, number, number];
const isPlaced = (X: Float64Array, i: number) => !Number.isNaN(X[3 * i]);
const get = (X: Float64Array, i: number): V3 => [X[3 * i], X[3 * i + 1], X[3 * i + 2]];
const set = (X: Float64Array, i: number, v: V3) => { X[3 * i] = v[0]; X[3 * i + 1] = v[1]; X[3 * i + 2] = v[2]; };
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3) => Math.sqrt(dot3(a, a));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const div = (a: V3, s: number): V3 => [a[0] / s, a[1] / s, a[2] / s];
const unit = (v: V3): [V3, number] => { const n = norm(v); return [n > 0 ? div(v, n) : v, n]; };
const Z: V3 = [0, 0, 1];

// ---------------------------------------------------------------------------------------------
// placement (crolab.sim._Placer)
// ---------------------------------------------------------------------------------------------
export class Placer {
  readonly X: Float64Array;
  private readonly walePairs = new Map<number, number>();
  private readonly ringChain = new Map<number, [number, number, number]>();
  private readonly ringCenter = new Map<number, V3>();
  private readonly ringMembers = new Map<number, number[]>();
  private roundCentroid: V3 = [0, 0, 0];
  private readonly g: Graph;

  constructor(readonly net: Network, private readonly cfg: SimConfig) {
    this.g = net.graph;
    this.X = new Float64Array(3 * net.nParticles).fill(NaN);
    const P = net.nParticles;
    for (let s = 0; s < net.m; s++) {
      if (net.kind[s] === WALE) {
        this.walePairs.set(net.I[s] * P + net.J[s], net.L[s]);
        this.walePairs.set(net.J[s] * P + net.I[s], net.L[s]);
      }
    }
    for (const sp of this.g.spaces) {
      if (sp.kind === 'ring' && sp.chains.length) sp.chains.forEach((c, k) => this.ringChain.set(c, [sp.id, k, sp.chains.length]));
    }
    for (const s of net.spaceParticle.keys()) this.ringMembers.set(s, nodesInSpace(this.g, s));
  }

  placedMask(): Uint8Array {
    const m = new Uint8Array(this.net.nParticles);
    for (let i = 0; i < m.length; i++) m[i] = isPlaced(this.X, i) ? 1 : 0;
    return m;
  }

  centroid(): V3 {
    let c: V3 = [0, 0, 0], k = 0;
    for (let i = 0; i < this.net.nParticles; i++) if (isPlaced(this.X, i)) { c = add(c, get(this.X, i)); k++; }
    return k ? div(c, k) : [0, 0, 0];
  }

  tangent(a: number): V3 {
    const n = this.net.nNodes, rr = this.net.particleRound, X = this.X;
    if (a >= n) return [0, 0, 0];
    const lo = a - 1 >= 0 && rr[a - 1] === rr[a] && isPlaced(X, a - 1) ? a - 1 : a;
    const hi = a + 1 < n && rr[a + 1] === rr[a] && isPlaced(X, a + 1) ? a + 1 : a;
    return unit(sub(get(X, hi), get(X, lo)))[0];
  }

  waleLen(i: number, p: number): number {
    return this.walePairs.get(i * this.net.nParticles + p) ?? this.net.height[i];
  }

  placeRound(r: number): number[] {
    const { net, g, X } = this;
    const nn = net.nNodes;
    const added: number[] = [];
    this.roundCentroid = this.centroid();
    // P0 virtual particles of magic rings made in this round
    for (const [s, p] of net.spaceParticle) {
      if (g.spaces[s].round === r) {
        const c = this.centroid();
        set(X, p, c);
        this.ringCenter.set(s, c);
      }
    }
    const ids = roundNodeIds(g, r);
    // P1 chain-ring chains
    for (const i of ids) {
      const rc = this.ringChain.get(i);
      if (!rc) continue;
      const [s, k, n] = rc;
      if (!this.ringCenter.has(s)) this.ringCenter.set(s, this.centroid());
      const c = this.ringCenter.get(s)!;
      const R = (n * net.width[i]) / (2 * Math.PI);
      const th = (2 * Math.PI * k) / n;
      set(X, i, add(c, [R * dcos(th), R * dsin(th), 0]));
    }
    const byP3 = new Map<number, string>();
    for (const i of ids) {
      if (this.ringChain.has(i)) continue;
      const A = net.anchors[i];
      if (A.length === 1 && A[0] >= nn) {
        // P2
        const p = A[0];
        const s = net.virtualSpace.get(p)!;
        const mem = this.ringMembers.get(s)!;
        const j = mem.indexOf(i);
        const th = (2 * Math.PI * j) / mem.length;
        set(X, i, add(get(X, p), scale([dcos(th), dsin(th), 0], this.waleLen(i, p))));
      } else if (A.length) {
        // P3
        let base: V3 = [0, 0, 0];
        for (const a of A) base = add(base, get(X, a));
        base = div(base, A.length);
        let v: V3 = [0, 0, 0];
        for (const a of A) if (a < nn && net.anchors[a].length) v = add(v, sub(get(X, a), get(X, net.anchors[a][0])));
        let [u, nv] = unit(v);
        if (nv < 1e-9) {
          const t = this.tangent(A[0]);
          let w = sub(base, this.centroid());
          w = sub(w, scale(t, dot3(w, t)));
          [u, nv] = unit(w);
          if (nv < 1e-6) {
            [u, nv] = unit(cross(Z, t));
            if (nv < 1e-9) u = [1, 0, 0];
          }
        }
        const Lw = npMean(A.map((a) => this.waleLen(i, a)));
        set(X, i, add(base, scale(u, Lw)));
        byP3.set(i, A.join(','));
      } else {
        // P4
        if (i === 0 || !isPlaced(X, i - 1)) set(X, i, i === 0 ? [0, 0, 0] : this.centroid());
        else {
          let d: V3 = [1, 0, 0];
          if (i >= 2 && isPlaced(X, i - 2)) {
            const [dd, nd] = unit(sub(get(X, i - 1), get(X, i - 2)));
            if (nd > 1e-9) d = dd;
          }
          set(X, i, add(get(X, i - 1), scale(d, 0.5 * (net.width[i - 1] + net.width[i]))));
        }
      }
      added.push(i);
    }
    // P5 spread runs sharing the same anchors
    let k = 0;
    while (k < ids.length) {
      const i = ids[k];
      const key = byP3.get(i);
      if (key === undefined) { k++; continue; }
      const run = [i];
      while (k + run.length < ids.length && byP3.get(ids[k + run.length]) === key) run.push(ids[k + run.length]);
      if (run.length >= 2) {
        const t = this.tangent(net.anchors[i][0]);
        const wb = npMean(run.map((q) => net.width[q]));
        const m = run.length;
        run.forEach((nid, q0) => set(X, nid, add(get(X, nid), scale(t, (q0 + 1 - (m + 1) / 2) * (wb / 2)))));
      }
      k += run.length;
    }
    // P4' chain-space loops on an outward arc
    this.placeLoops(r, ids);
    // P6 perturbation
    if (ids.length) {
      const wbar = npMean(ids.map((i) => net.width[i]));
      const eps = this.cfg.perturb_eps;
      for (const i of ids) X[3 * i + 2] += eps * wbar * dsin(GOLDEN * (i + 1));
    }
    return added;
  }

  private placeLoops(r: number, ids: number[]) {
    const { net, g, X } = this;
    const idset = new Set(ids);
    for (const sp of g.spaces) {
      if (sp.kind !== 'chsp' || sp.round !== r || !sp.chains.length) continue;
      const ch = sp.chains;
      const a = ch[0] - 1, b = ch[ch.length - 1] + 1;
      if (!idset.has(a) || !idset.has(b) || !isPlaced(X, a) || !isPlaced(X, b)) continue;
      const seq = [a, ...ch, b];
      const rest: number[] = [];
      for (let q = 0; q + 1 < seq.length; q++) rest.push(0.5 * (net.width[seq[q]] + net.width[seq[q + 1]]));
      const S = npSum(rest);
      const xa = get(X, a), xb = get(X, b);
      const d = sub(xb, xa);
      const D = norm(d);
      const t: number[] = [];
      let cum = 0;
      for (let q = 0; q < ch.length; q++) { cum += rest[q]; t.push(cum / S); }
      let dHat: V3;
      if (D < 1e-9) { const ta = this.tangent(a); dHat = norm(ta) > 0 ? ta : [1, 0, 0]; }
      else dHat = div(d, D);
      const mid = scale(add(xa, xb), 0.5);
      let o = sub(mid, this.roundCentroid);
      o = sub(o, scale(dHat, dot3(o, dHat)));
      let no: number;
      [o, no] = unit(o);
      if (no < 1e-9) [o, no] = unit(cross(Z, dHat));
      if (S <= D * (1 + 1e-9) || (D < 1e-9 && S <= 0)) {
        ch.forEach((c, q) => set(X, c, add(xa, scale(d, t[q]))));
        continue;
      }
      const th = D > 1e-9 ? arcAngle(S / Math.max(D, 1e-9 * S)) : 1.95 * Math.PI;
      const R = S / th;
      const C0 = sub(mid, scale(scale(o, R), dcos(th / 2)));
      ch.forEach((c, q) => {
        const ph = -th / 2 + t[q] * th;
        set(X, c, add(C0, scale(add(scale(dHat, dsin(ph)), scale(o, dcos(ph))), R)));
      });
    }
  }
}

/** theta in (0, 1.95 pi] with theta / (2 sin(theta/2)) = ratio (arc length / chord). */
export function arcAngle(ratio: number): number {
  let lo = 1e-9, hi = 1.95 * Math.PI;
  const f = (t: number) => t / (2 * dsin(t / 2)) - ratio;
  if (f(hi) < 0) return hi;
  for (let k = 0; k < 80; k++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) > 0) hi = mid; else lo = mid;
  }
  return 0.5 * (lo + hi);
}

// ---------------------------------------------------------------------------------------------
// relaxation of the placed sub-network
// ---------------------------------------------------------------------------------------------
export interface SubProblem { idx: Int32Array; springs: SpringSet }

/** Springs with both ends placed, re-indexed to the placed particles (crolab.sim._relax_placed). */
export function subProblem(net: Network, mask: Uint8Array): SubProblem {
  const remap = new Int32Array(net.nParticles).fill(-1);
  const idxList: number[] = [];
  for (let p = 0; p < net.nParticles; p++) if (mask[p]) { remap[p] = idxList.length; idxList.push(p); }
  const sel: number[] = [];
  for (let s = 0; s < net.m; s++) if (mask[net.I[s]] && mask[net.J[s]]) sel.push(s);
  const m = sel.length;
  const I = new Int32Array(m), J = new Int32Array(m), L = new Float64Array(m), kL = new Float64Array(m), slack = new Uint8Array(m);
  sel.forEach((s, q) => { I[q] = remap[net.I[s]]; J[q] = remap[net.J[s]]; L[q] = net.L[s]; kL[q] = net.k[s] / net.L[s]; slack[q] = net.slack[s]; });
  return { idx: Int32Array.from(idxList), springs: { n: idxList.length, m, I, J, L, kL, slack } };
}

export function gather(X: Float64Array, idx: Int32Array): Float64Array {
  const x = new Float64Array(3 * idx.length);
  idx.forEach((p, q) => { x[3 * q] = X[3 * p]; x[3 * q + 1] = X[3 * p + 1]; x[3 * q + 2] = X[3 * p + 2]; });
  return x;
}
export function scatter(X: Float64Array, idx: Int32Array, x: Float64Array) {
  idx.forEach((p, q) => { X[3 * p] = x[3 * q]; X[3 * p + 1] = x[3 * q + 1]; X[3 * p + 2] = x[3 * q + 2]; });
}

/** Total energy of the network at X (unplaced particles and their springs ignored). */
export function networkEnergy(net: Network, X: Float64Array): number {
  const mask = new Uint8Array(net.nParticles);
  for (let p = 0; p < net.nParticles; p++) mask[p] = isPlaced(X, p) ? 1 : 0;
  const sp = subProblem(net, mask);
  return springEnergy(sp.springs, gather(X, sp.idx), new Float64Array(3 * sp.idx.length));
}

/** Per-spring strain |d|/L − 1 (NaN where an end is not placed). */
export function springStrain(net: Network, X: Float64Array): Float64Array {
  const out = new Float64Array(net.m);
  for (let s = 0; s < net.m; s++) {
    const a = 3 * net.I[s], b = 3 * net.J[s];
    const dx = X[a] - X[b], dy = X[a + 1] - X[b + 1], dz = X[a + 2] - X[b + 2];
    out[s] = Math.sqrt(dx * dx + dy * dy + dz * dz) / net.L[s] - 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// growth as a resumable state machine
// ---------------------------------------------------------------------------------------------
export type GrowPhase = 'round' | 'final' | 'done';

export class Grower {
  readonly placer: Placer;
  readonly snapshots: Float64Array[] = [];
  readonly roundEnergies: number[] = [];
  /** Round being relaxed (phase 'round'). */
  round = -1;
  phase: GrowPhase = 'round';
  energy = 0;
  iterations = 0;
  converged = true;
  private opt: Lbfgs | null = null;
  private sub: SubProblem | null = null;
  readonly lastRound: number;
  private readonly gtolRound: number;
  private readonly gtolFinal: number;
  private readonly maxIter: number;
  private readonly maxIterFinal: number;

  constructor(readonly net: Network, cfg: SimConfig, opts: { uptoRound?: number; gtolRound?: number; gtolFinal?: number; maxIter?: number; maxIterFinal?: number } = {}) {
    this.placer = new Placer(net, cfg);
    const R = net.graph.rounds.length;
    this.lastRound = opts.uptoRound === undefined ? R - 1 : Math.min(opts.uptoRound, R - 1);
    this.gtolRound = opts.gtolRound ?? 1e-6;
    this.gtolFinal = opts.gtolFinal ?? 1e-8;
    this.maxIter = opts.maxIter ?? 20000;
    // the lab allows 20000 for every L-BFGS run; the final gtol 1e-8 pass on the near-isometric
    // flat circles can need ~40000 from a slightly different path
    this.maxIterFinal = opts.maxIterFinal ?? 50000;
    if (this.lastRound < 0) this.phase = 'done';
  }

  /** Current positions (the optimiser's iterate written back). */
  get X(): Float64Array { return this.placer.X; }

  private start(gtol: number, maxIter: number) {
    const mask = this.placer.placedMask();
    this.sub = subProblem(this.net, mask);
    const sp = this.sub.springs;
    this.opt = new Lbfgs((x, g) => springEnergy(sp, x, g), gather(this.placer.X, this.sub.idx), { gtol, maxIter });
  }

  /** Write the optimiser's current iterate into X (for live display). */
  sync() { if (this.opt && this.sub) scatter(this.placer.X, this.sub.idx, this.opt.x); }

  /** Work until done or the deadline (ms, `now()` clock). Returns true when finished. */
  advance(deadline = Infinity): boolean {
    while (this.phase !== 'done') {
      if (!this.opt) {
        if (this.phase === 'round') { this.round++; this.placer.placeRound(this.round); this.start(this.gtolRound, this.maxIter); }
        else this.start(this.gtolFinal, this.maxIterFinal);
      }
      const opt = this.opt!;
      const st = opt.run(deadline);
      if (st === 'running') { this.sync(); return false; }
      this.sync();
      this.iterations += opt.iter;
      this.energy = opt.f;
      this.opt = null;
      if (this.phase === 'round') {
        this.snapshots.push(Float64Array.from(this.placer.X));
        this.roundEnergies.push(opt.f);
        if (this.round >= this.lastRound) this.phase = 'final';
      } else {
        this.converged = st === 'converged' || opt.gnorm <= 10 * this.gtolFinal;
        this.phase = 'done';
      }
      if (deadline !== Infinity && now() >= deadline) return this.phase === 'done';
    }
    return true;
  }
}

/** Grow and relax the whole piece synchronously (crolab.sim.simulate). */
export function simulate(input: Pattern | Graph, params: ParamSet, opts: SolveOptions = {}): SimResult {
  const t0 = now();
  const cfg = opts.config ?? defaultConfig;
  const net = opts.network ?? buildNetwork(input, params, cfg);
  const gr = new Grower(net, cfg, opts);
  gr.advance();
  return {
    network: net, positions: gr.X, energy: gr.energy, converged: gr.converged, snapshots: gr.snapshots,
    roundEnergies: gr.roundEnergies, roundsDone: gr.snapshots.length, iterations: gr.iterations, ms: now() - t0,
  };
}
