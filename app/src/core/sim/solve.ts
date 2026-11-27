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
import { addTableEnergy, type TableOptions } from './table';

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
  /**
   * Viewer-level option (not part of the shared spec): grow the piece flat in the xy-plane, then
   * let it go resting on a table — see table.ts. Off by default; classification and agreement never
   * use it.
   */
  table?: boolean | TableOptions;
}

export interface SimResult {
  network: Network;
  /** [3 nParticles] final positions; NaN for particles not made (rounds beyond uptoRound). */
  positions: Float64Array;
  energy: number;
  converged: boolean;
  /** Per round: did that round's relaxation reach its tolerance (false: iteration cap or stall)? */
  roundsConverged: boolean[];
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

  /**
   * Viewer-level (table mode only, not the shared spec): the P3 radial fallback points away from
   * the centroid of the piece *before this round* instead of the running centroid, which the
   * round's own earlier nodes pull off-centre (a spoked chain-ring centre then starts folded).
   */
  radialFromRoundCentroid = false;

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
    const o = net.outline;
    const p9 = !!o && (o.roundKind[r] === 'foundation' || o.roundKind[r] === 'row' || o.roundKind[r] === 'border' || o.roundKind[r] === 'polygon');
    const fr = p9 ? this.outlineFrame() : null;
    const [e1, e2] = fr ? [fr.e1, fr.e2] : [Z, Z];
    for (const i of ids) {
      if (this.ringChain.has(i)) continue;
      const A = net.anchors[i];
      const b9 = p9 && o!.has[i] ? this.outlineBase(i, r) : -1;
      if (b9 >= 0) {
        // P9: in the reference layout — in the fitted plane of the piece when the fit is planar,
        // else relative to a placed reference particle (SPEC_NOTES P9)
        if (fr!.planar) set(X, i, add(fr!.c, add(scale(e1, o!.qx[i] - fr!.q[0]), scale(e2, o!.qy[i] - fr!.q[1]))));
        else set(X, i, add(get(X, b9), add(scale(e1, o!.qx[i] - o!.qx[b9]), scale(e2, o!.qy[i] - o!.qy[b9]))));
      } else if (A.length === 1 && A[0] >= nn) {
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
          let w = sub(base, this.radialFromRoundCentroid ? this.roundCentroid : this.centroid());
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
    // P7 spines: radially outward from their base, in their reference layout
    this.placeSpines(r);
    // P8 pointed loops: likewise, a narrow outward loop with the picot at its apex
    this.placePointedLoops(r);
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

  /**
   * P9 base of node i: its first anchor particle that has a reference position and is placed, else
   * the nearest earlier node that has one and is placed; −1 if none.
   */
  private outlineBase(i: number, r: number): number {
    const o = this.net.outline!, X = this.X, nn = this.net.nNodes;
    for (const a of this.net.anchors[i]) if (a < nn && o.has[a] && isPlaced(X, a)) return a;
    for (let j = i - 1; j >= 0; j--) if (o.has[j] && isPlaced(X, j)) return j;
    return -1;
  }

  /**
   * P9 frame: the orthonormal in-plane frame (e1, e2) of the least-squares affine map from the
   * reference layout to the placed positions, over every placed node with a reference position,
   * with the centroids c (positions) and q (references) (crolab.sim._outline_frame). `planar`:
   * the references span a plane (det S > 1e-9 tr(S)²). Collinear references (the foundation chain
   * alone): e1 along the fitted direction of the line, e2 = unit(z × e1) (fallback unit(e1 × x));
   * fewer than two: x, y.
   */
  outlineFrame(): { e1: V3; e2: V3; c: V3; q: [number, number]; planar: boolean } {
    const o = this.net.outline!, X = this.X;
    const ps: number[] = [];
    for (let p = 0; p < this.net.nNodes; p++) if (o.has[p] && isPlaced(X, p)) ps.push(p);
    if (ps.length < 2) return { e1: [1, 0, 0], e2: [0, 1, 0], c: [0, 0, 0], q: [0, 0], planar: false };
    const qx = npMean(ps.map((p) => o.qx[p])), qy = npMean(ps.map((p) => o.qy[p]));
    const xb: V3 = [npMean(ps.map((p) => X[3 * p])), npMean(ps.map((p) => X[3 * p + 1])), npMean(ps.map((p) => X[3 * p + 2]))];
    let sxx = 0, sxy = 0, syy = 0;
    const cx: V3 = [0, 0, 0], cy: V3 = [0, 0, 0];
    for (const p of ps) {
      const ux = o.qx[p] - qx, uy = o.qy[p] - qy;
      sxx += ux * ux; sxy += ux * uy; syy += uy * uy;
      for (let d = 0; d < 3; d++) { const v = X[3 * p + d] - xb[d]; cx[d] += v * ux; cy[d] += v * uy; }
    }
    const tr = sxx + syy;
    if (!(tr > 0)) return { e1: [1, 0, 0], e2: [0, 1, 0], c: xb, q: [qx, qy], planar: false };
    const det = sxx * syy - sxy * sxy;
    let e1: V3, e2: V3;
    const planar = det > 1e-9 * tr * tr;
    if (planar) {
      const m1 = scale(add(scale(cx, syy), scale(cy, -sxy)), 1 / det);
      const m2 = scale(add(scale(cy, sxx), scale(cx, -sxy)), 1 / det);
      let [u, nu] = unit(m1);
      if (nu < 1e-12) u = [1, 0, 0];
      e1 = u;
      [e2, nu] = unit(sub(m2, scale(e1, dot3(m2, e1))));
      if (nu < 1e-12) e2 = this.perp(e1);
    } else {
      // collinear: q̂ = principal direction of the references, e_q its fitted image
      let qh: [number, number] = sxx >= syy ? [sxx, sxy] : [sxy, syy];
      const nq = Math.sqrt(qh[0] * qh[0] + qh[1] * qh[1]);
      qh = nq > 0 ? [qh[0] / nq, qh[1] / nq] : [1, 0];
      let [eq, ne] = unit(add(scale(cx, qh[0]), scale(cy, qh[1])));
      if (ne < 1e-12) eq = [1, 0, 0];
      const ep = this.perp(eq);
      e1 = add(scale(eq, qh[0]), scale(ep, -qh[1]));
      e2 = add(scale(eq, qh[1]), scale(ep, qh[0]));
    }
    return { e1, e2, c: xb, q: [qx, qy], planar };
  }

  private perp(e: V3): V3 {
    let [v, nv] = unit(cross(Z, e));
    if (nv < 1e-9) [v] = unit(cross(e, [1, 0, 0]));
    return v;
  }

  /**
   * P7 (crolab.sim._place_spines): every spine of round r whose base is placed is laid out in its
   * reference layout (s, t): x = x_base + s u + t v, u = unit(x_base − centroid before the round)
   * (fallback +x), v = unit(z × u) (fallback unit(u × x)).
   */
  private placeSpines(r: number) {
    const { net, g, X } = this;
    for (const sp of net.spines) {
      if (g.nodes[sp.stem[0]].round !== r || !isPlaced(X, sp.base)) continue;
      const o = get(X, sp.base);
      let [u, nu] = unit(sub(o, this.roundCentroid));
      if (nu < 1e-9) u = [1, 0, 0];
      let [t, nt] = unit(cross(Z, u));
      if (nt < 1e-9) [t] = unit(cross(u, [1, 0, 0]));
      for (const v of sp.nodes) {
        const [s_, t_] = sp.pos.get(v)!;
        set(X, v, add(add(o, scale(u, s_)), scale(t, t_)));
      }
    }
  }

  /**
   * P8 (crolab.sim._place_pointed_loops): every pointed loop (N6) of round r whose base and close
   * are placed is laid out like a spine (P7): x = x_base + s u + σ t v, with u, v as in P7 and
   * σ = −1 when the close node lies on the −v side of the base ((x_close − x_base)·v < 0), else +1.
   */
  private placePointedLoops(r: number) {
    const { net, g, X } = this;
    for (const pl of net.pointedLoops) {
      if (g.nodes[pl.base].round !== r || !isPlaced(X, pl.base) || !isPlaced(X, pl.close)) continue;
      const o = get(X, pl.base);
      let [u, nu] = unit(sub(o, this.roundCentroid));
      if (nu < 1e-9) u = [1, 0, 0];
      let [t, nt] = unit(cross(Z, u));
      if (nt < 1e-9) [t] = unit(cross(u, [1, 0, 0]));
      const sg = dot3(sub(get(X, pl.close), o), t) < 0 ? -1 : 1;
      for (const v of pl.nodes) {
        const [s_, t_] = pl.pos.get(v)!;
        set(X, v, add(add(o, scale(u, s_)), scale(t, sg * t_)));
      }
    }
  }

  private p9Placed(i: number): boolean {
    const o = this.net.outline;
    if (!o || !o.has[i]) return false;
    const k = o.roundKind[this.g.nodes[i].round];
    return k === 'foundation' || k === 'row' || k === 'border' || k === 'polygon';
  }

  private placeLoops(r: number, ids: number[]) {
    const { net, g, X } = this;
    const idset = new Set(ids);
    const inLoop = new Set<number>();
    for (const pl of net.pointedLoops) for (const v of pl.nodes) inLoop.add(v);
    for (const sp of g.spaces) {
      if (sp.kind !== 'chsp' || sp.round !== r || !sp.chains.length || inLoop.has(sp.chains[0])) continue;
      if (this.p9Placed(sp.chains[0])) continue;   // P9 placed them in the reference layout
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
export type GrowPhase = 'round' | 'final' | 'release' | 'done';

export class Grower {
  readonly placer: Placer;
  readonly snapshots: Float64Array[] = [];
  readonly roundEnergies: number[] = [];
  /** Per round: the round's relaxation reached gtolRound (false: hit maxIter or stalled). */
  readonly roundConverged: boolean[] = [];
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
  private readonly table: TableOptions | null;
  private readonly cfg: SimConfig;
  /** Table mode: the planar grown state (before the release onto the table). */
  planar: Float64Array | null = null;
  /** Table mode: stop after the planar growth (no release onto the table). */
  planarOnly = false;

  constructor(readonly net: Network, cfg: SimConfig, opts: { uptoRound?: number; gtolRound?: number; gtolFinal?: number; maxIter?: number; maxIterFinal?: number; table?: boolean | TableOptions } = {}) {
    this.placer = new Placer(net, cfg);
    this.cfg = cfg;
    if (opts.table) this.placer.radialFromRoundCentroid = true;
    const R = net.graph.rounds.length;
    this.lastRound = opts.uptoRound === undefined ? R - 1 : Math.min(opts.uptoRound, R - 1);
    this.gtolRound = opts.gtolRound ?? 1e-6;
    this.gtolFinal = opts.gtolFinal ?? 1e-8;
    this.maxIter = opts.maxIter ?? 20000;
    // the lab allows 20000 for every L-BFGS run; the final gtol 1e-8 pass on the near-isometric
    // flat circles can need ~40000 from a slightly different path
    this.maxIterFinal = opts.maxIterFinal ?? 50000;
    this.table = opts.table ? (opts.table === true ? {} : opts.table) : null;
    if (this.lastRound < 0) this.phase = 'done';
  }

  /** Current positions (the optimiser's iterate written back). */
  get X(): Float64Array { return this.placer.X; }

  private start(gtol: number, maxIter: number) {
    const mask = this.placer.placedMask();
    this.sub = subProblem(this.net, mask);
    const sp = this.sub.springs;
    let fg = (x: Float64Array, g: Float64Array) => springEnergy(sp, x, g);
    const table = this.table;
    if (table && this.phase !== 'release') {
      // table mode, growth: strictly in the xy-plane (z = 0, no z gradient)
      const X = this.placer.X;
      for (let p = 0; p < this.net.nParticles; p++) if (mask[p]) X[3 * p + 2] = 0;
      fg = (x, g) => { const E = springEnergy(sp, x, g); for (let q = 2; q < g.length; q += 3) g[q] = 0; return E; };
    } else if (table) {
      // release: a small deterministic lift off the table (P6-like), then gravity + table in 3D
      const X = this.placer.X, w = this.net.width;
      const wbar = npMean(Array.from(w));
      for (let p = 0; p < this.net.nParticles; p++) {
        if (mask[p]) X[3 * p + 2] = 0.5 * this.cfg.perturb_eps * wbar * (1 + dsin(GOLDEN * (p + 1)));
      }
      const opts = { ...table, z0: table.z0 ?? -1e-3 };
      fg = (x, g) => addTableEnergy(x, g, springEnergy(sp, x, g), opts);
    }
    this.opt = new Lbfgs(fg, gather(this.placer.X, this.sub.idx), { gtol, maxIter });
  }

  /** Write the optimiser's current iterate into X (for live display). */
  sync() { if (this.opt && this.sub) scatter(this.placer.X, this.sub.idx, this.opt.x); }

  /** Work until done or the deadline (ms, `now()` clock). Returns true when finished. */
  advance(deadline = Infinity): boolean {
    while (this.phase !== 'done') {
      if (!this.opt) {
        if (this.phase === 'round') { this.round++; this.placer.placeRound(this.round); this.start(this.gtolRound, this.maxIter); }
        else if (this.phase === 'final') this.start(this.gtolFinal, this.maxIterFinal);
        else this.start(this.gtolRound, this.maxIterFinal);
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
        this.roundConverged.push(st === 'converged' || opt.gnorm <= 10 * this.gtolRound);
        if (this.round >= this.lastRound) this.phase = 'final';
      } else if (this.phase === 'final') {
        this.converged = st === 'converged' || opt.gnorm <= 10 * this.gtolFinal;
        if (this.table) { this.planar = Float64Array.from(this.placer.X); this.phase = this.planarOnly ? 'done' : 'release'; }
        else this.phase = 'done';
      } else {
        this.converged = this.converged && (st === 'converged' || opt.gnorm <= 10 * this.gtolRound);
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
    network: net, positions: gr.X, energy: gr.energy, converged: gr.converged, roundsConverged: gr.roundConverged, snapshots: gr.snapshots,
    roundEnergies: gr.roundEnergies, roundsDone: gr.snapshots.length, iterations: gr.iterations, ms: now() - t0,
  };
}
