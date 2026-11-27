/**
 * Blocked solve (spec/physics.md §6, port of `crolab/blocking.py`): same network, different
 * boundary conditions. All particles are constrained to the plane through the shape-metric
 * centroid c normal to the axis n; the nodes of the outermost round are pinned at
 * `block_stretch` × their relaxed distance from the axis (angles preserved); the rest relax
 * in-plane (L-BFGS, 2 dof each).
 *
 * Reported: mean and max |strain| (tension-only springs count only when stretched), and the
 * fraction of course springs compressed by more than `block_buckle_strain` (slack chain springs
 * excluded), plus a plain-language verdict.
 */
import { simConfig as defaultConfig, type SimConfig } from '../params';
import { hyp, Lbfgs, now as clock, springEnergy, type LbfgsStatus, type SpringSet } from './lbfgs';
import { eigSym3, shapeMetric } from './metrics';
import { COURSE, WALE, type Network } from './network';

export type BlockVerdict = 'easy' | 'firm' | 'impossible';

/**
 * An explicit pin: node `node` is pinned at (x, y) mm in the plane of the blocked piece. The pin
 * set is a shape: it is aligned to the piece by the rigid motion (rotation, optionally a
 * reflection, and translation — never a scaling) that best fits the pinned nodes' relaxed
 * positions projected to the plane, so the caller's frame (e.g. a template with y down) does not
 * matter.
 */
export interface BlockPin { node: number; x: number; y: number }

/** Largest stretch per part of the piece when pinned (tension-only springs count only when stretched). */
export interface PinStretch {
  /** Spines (arms): springs between two nodes of one spine. Only course and wale springs count. */
  spines: number;
  /** Chain loops: tension-only chain-space springs (valley bridges, loops of the body). */
  chains: number;
  /** Everything else (the body's fabric). */
  body: number;
}

export interface BlockResult {
  /** [3 nParticles] blocked positions (NaN for particles not made). */
  positions: Float64Array;
  energy: number;
  converged: boolean;
  strain: Float64Array;
  meanAbsStrain: number;
  maxAbsStrain: number;
  maxCompression: number;
  maxStretch: number;
  buckleFraction: number;
  /** Fraction of all non-slack springs (courses, wales, shear, bends) compressed by more than `block_buckle_strain`. */
  compressedFraction: number;
  pinned: Uint8Array;
  verdict: BlockVerdict;
  message: string;
  /** Explicit pins only: aligned targets [x, y] in the plane basis, and the stretch per part. */
  pins?: { node: number; x: number; y: number }[];
  pinStretch?: PinStretch;
  /** Plane basis: centroid c, in-plane unit vectors u, v (positions = c + x u + y v). */
  plane: { c: number[]; u: number[]; v: number[] };
}

/**
 * Thresholds for the verdict (UI wording only, not part of the shared spec). Measured on the
 * fixtures (course buckle / all-spring compressed fractions): flat sc 0/0, chain-space motif 0/0,
 * flat dc 1.6%/0.5%, simple doily 3.3%/1.4% (two slip stitches in one stitch), cone 1.5%/30%
 * (its wales would have to fold), sphere 4%/19%, hyperbolic 36%/40%.
 */
export const BLOCK_EASY_MEAN_STRAIN = 0.06;
export const BLOCK_IMPOSSIBLE_FRACTION = 0.1;

/** The minimiser of a blocked solve: one L-BFGS run, or a staged one (pin continuation). */
export interface BlockOptimizer {
  readonly x: Float64Array;
  readonly f: number;
  readonly status: LbfgsStatus;
  readonly iter: number;
  run(deadline?: number): LbfgsStatus;
  /** Fraction of the solve done (stages), 0…1. */
  progress(): number;
}

export interface BlockSetup {
  opt: BlockOptimizer;
  finish: () => BlockResult;
}

/**
 * Stages of the pinned solve (pin continuation). The pins move from where their nodes lie in the
 * unblocked piece to the template in PIN_STAGES equal steps, each solve warm-started from the last
 * (intermediate stages to a looser tolerance). Snapping the pins to the template in one go let
 * the solver settle into folded minima — e.g. a pair of branch picots pulled through the spine so
 * they point inwards, the arm sliding 4 mm outwards (seed 6 × 6) — which the continuation avoids.
 */
export const PIN_STAGES = 4;
const STAGE_GTOL = 1e-3;

class StagedOptimizer implements BlockOptimizer {
  private k = 0;
  private cur: Lbfgs;
  private iters = 0;
  constructor(private readonly make: (k: number, x0: Float64Array | null) => Lbfgs, private readonly K: number) {
    this.cur = make(0, null);
  }
  get x() { return this.cur.x; }
  get f() { return this.cur.f; }
  get iter() { return this.iters + this.cur.iter; }
  get status(): LbfgsStatus { return this.k < this.K - 1 && this.cur.status !== 'running' ? 'running' : this.cur.status; }
  progress() { return Math.min(1, (this.k + (this.cur.status === 'running' ? 0.5 : 1)) / this.K); }
  run(deadline = Infinity): LbfgsStatus {
    for (;;) {
      const st = this.cur.run(deadline);
      if (st === 'running') return 'running';
      if (this.k >= this.K - 1) return st;
      this.iters += this.cur.iter;
      this.k++;
      this.cur = this.make(this.k, this.cur.x);
      if (deadline !== Infinity && clock() >= deadline) return 'running';
    }
  }
}

/** Least-variance direction (PCA normal) and centroid of the placed node particles. */
function pcaPlane(X: Float64Array, nN: number): { c: [number, number, number]; n: [number, number, number] } {
  const c: [number, number, number] = [0, 0, 0];
  let k = 0;
  for (let i = 0; i < nN; i++) {
    if (Number.isNaN(X[3 * i])) continue;
    for (let d = 0; d < 3; d++) c[d] += X[3 * i + d];
    k++;
  }
  for (let d = 0; d < 3; d++) c[d] /= Math.max(1, k);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < nN; i++) {
    if (Number.isNaN(X[3 * i])) continue;
    const D = [X[3 * i] - c[0], X[3 * i + 1] - c[1], X[3 * i + 2] - c[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += D[a] * D[b];
  }
  const v0 = eigSym3(C).vectors[0];   // eigenvalues ascending: the least-variance direction
  const n: [number, number, number] = [v0[0], v0[1], v0[2]];
  return { c, n };
}

/**
 * Prepare the blocked solve of positions X (relaxed). Run `opt` to convergence, then `finish()`.
 *
 * Without `pins`: physics.md §6 (outermost round at `block_stretch` × its relaxed radius).
 * With `pins` (viewer extension, e.g. the snowflake template): the plane is the PCA plane of X, the
 * pinned nodes are fixed at the aligned pin targets (see BlockPin) and everything else relaxes
 * in-plane. Reported in addition: the largest stretch per part (`pinStretch`).
 */
export function setupBlock(net: Network, X: Float64Array, config: SimConfig = defaultConfig, gtol = 1e-8, pinsIn?: BlockPin[]): BlockSetup {
  const nN = net.nNodes, N = net.nParticles;
  const placed = new Uint8Array(N);
  for (let p = 0; p < N; p++) placed[p] = Number.isNaN(X[3 * p]) ? 0 : 1;
  const pinList = (pinsIn ?? []).filter((p) => p.node >= 0 && p.node < nN && placed[p.node]);
  const usePins = pinList.length >= 2;
  let c: number[], n: number[];
  if (usePins) ({ c, n } = pcaPlane(X, nN));
  else { const m = shapeMetric(X.subarray(0, 3 * nN), net.particleRound.subarray(0, nN), config); c = m.centroid; n = m.axis; }
  // orthonormal in-plane basis (deterministic): e = unit vector of the smallest |n| component
  let kmin = 0;
  for (let d = 1; d < 3; d++) if (Math.abs(n[d]) < Math.abs(n[kmin])) kmin = d;
  const e = [0, 0, 0]; e[kmin] = 1;
  let u = [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]];
  const nu = hyp(u[0], u[1], u[2]);
  u = u.map((x) => x / nu);
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  let last = -1;
  for (let i = 0; i < nN; i++) if (placed[i] && net.particleRound[i] > last) last = net.particleRound[i];
  const pinned = new Uint8Array(N);
  if (usePins) for (const p of pinList) pinned[p.node] = 1;
  else for (let i = 0; i < nN; i++) if (placed[i] && net.particleRound[i] === last) pinned[i] = 1;
  const P = new Float64Array(2 * N);
  const s = config.block_stretch;
  for (let p = 0; p < N; p++) {
    if (!placed[p]) continue;
    const D = [X[3 * p] - c[0], X[3 * p + 1] - c[1], X[3 * p + 2] - c[2]];
    const pu = D[0] * u[0] + D[1] * u[1] + D[2] * u[2];
    const pv = D[0] * v[0] + D[1] * v[1] + D[2] * v[2];
    P[2 * p] = pu; P[2 * p + 1] = pv;
    if (pinned[p] && !usePins) {
      const z = D[0] * n[0] + D[1] * n[1] + D[2] * n[2];
      const r = hyp(D[0] - z * n[0], D[1] - z * n[1], D[2] - z * n[2]);
      // angle preserved: (cos, sin) of atan2(pv, pu), computed without engine-dependent trig
      const h = hyp(pu, pv);
      const ca = h > 0 ? pu / h : 1, sa = h > 0 ? pv / h : 0;
      P[2 * p] = s * r * ca; P[2 * p + 1] = s * r * sa;
    }
  }
  let aligned: { node: number; x: number; y: number }[] | undefined;
  // pin continuation: start (relaxed, projected) and end (template) positions of the pinned nodes
  let pinFrom: Float64Array | null = null;
  if (usePins) {
    aligned = alignPins(pinList, (i) => [P[2 * i], P[2 * i + 1]]);
    pinFrom = new Float64Array(2 * aligned.length);
    aligned.forEach((a, q) => { pinFrom![2 * q] = P[2 * a.node]; pinFrom![2 * q + 1] = P[2 * a.node + 1]; });
    for (const a of aligned) { P[2 * a.node] = a.x; P[2 * a.node + 1] = a.y; }
  }
  const pinStage = (t: number) => {
    if (!aligned || !pinFrom) return;
    aligned.forEach((a, q) => {
      P[2 * a.node] = pinFrom![2 * q] + t * (a.x - pinFrom![2 * q]);
      P[2 * a.node + 1] = pinFrom![2 * q + 1] + t * (a.y - pinFrom![2 * q + 1]);
    });
  };
  // springs between placed particles (all particles, pinned ones fixed)
  const sel: number[] = [];
  for (let q = 0; q < net.m; q++) if (placed[net.I[q]] && placed[net.J[q]]) sel.push(q);
  const springs: SpringSet = {
    n: N, m: sel.length,
    I: Int32Array.from(sel, (q) => net.I[q]), J: Int32Array.from(sel, (q) => net.J[q]),
    L: Float64Array.from(sel, (q) => net.L[q]), kL: Float64Array.from(sel, (q) => net.k[q] / net.L[q]),
    slack: Uint8Array.from(sel, (q) => net.slack[q]),
  };
  const free: number[] = [];
  for (let p = 0; p < N; p++) if (placed[p] && !pinned[p]) free.push(p);
  const Y = new Float64Array(3 * N), G = new Float64Array(3 * N);
  const load = (x: Float64Array) => {
    for (let p = 0; p < N; p++) { Y[3 * p] = P[2 * p]; Y[3 * p + 1] = P[2 * p + 1]; Y[3 * p + 2] = 0; }
    free.forEach((p, q) => { Y[3 * p] = x[2 * q]; Y[3 * p + 1] = x[2 * q + 1]; });
  };
  const fg = (x: Float64Array, g: Float64Array) => {
    load(x);
    const E = springEnergy(springs, Y, G);
    free.forEach((p, q) => { g[2 * q] = G[3 * p]; g[2 * q + 1] = G[3 * p + 1]; });
    return E;
  };
  const x0 = new Float64Array(2 * free.length);
  free.forEach((p, q) => { x0[2 * q] = P[2 * p]; x0[2 * q + 1] = P[2 * p + 1]; });
  let opt: BlockOptimizer;
  if (usePins) {
    const K = PIN_STAGES;
    opt = new StagedOptimizer((k, xPrev) => {
      pinStage((k + 1) / K);
      return new Lbfgs(fg, xPrev ?? x0, { gtol: k === K - 1 ? gtol : Math.max(gtol, STAGE_GTOL), maxIter: 50000 });
    }, K);
  } else {
    const l = new Lbfgs(fg, x0, { gtol, maxIter: 50000 });
    opt = Object.assign(l, { progress: () => (l.status === 'running' ? 0.5 : 1) });
  }

  const finish = (): BlockResult => {
    load(opt.x);
    const pos = new Float64Array(3 * N).fill(NaN);
    for (let p = 0; p < N; p++) {
      if (!placed[p]) continue;
      for (let d = 0; d < 3; d++) pos[3 * p + d] = c[d] + Y[3 * p] * u[d] + Y[3 * p + 1] * v[d];
    }
    const strain = new Float64Array(net.m).fill(NaN);
    let sumAbs = 0, maxAbs = 0, maxComp = -Infinity, maxStr = -Infinity, cnt = 0, nCourse = 0, nBuckle = 0, nSolid = 0, nComp = 0;
    const thr = config.block_buckle_strain;
    for (const q of sel) {
      const a = 3 * net.I[q], b = 3 * net.J[q];
      const d = hyp(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]);
      const st = d / net.L[q] - 1;
      strain[q] = st;
      const eff = net.slack[q] && st < 0 ? 0 : st;
      sumAbs += Math.abs(eff); cnt++;
      maxAbs = Math.max(maxAbs, Math.abs(eff));
      maxComp = Math.max(maxComp, -eff);
      maxStr = Math.max(maxStr, eff);
      if (net.kind[q] === COURSE && !net.slack[q]) { nCourse++; if (st < -thr) nBuckle++; }
      if (!net.slack[q]) { nSolid++; if (st < -thr) nComp++; }
    }
    const buckleFraction = nCourse ? nBuckle / nCourse : 0;
    const meanAbsStrain = cnt ? sumAbs / cnt : 0;
    const compressedFraction = nSolid ? nComp / nSolid : 0;
    let { verdict, message } = blockVerdict(buckleFraction, meanAbsStrain, compressedFraction);
    let pinStretch: PinStretch | undefined;
    if (usePins) {
      const owner = new Map<number, number>();
      net.spines.forEach((sp, si) => { for (const v of sp.nodes) owner.set(v, si); });
      // N6 pointed loops count as arms; a round's travel stitches (its leading slip stitches and its
      // turning chain, N3: not fabric) are left out — at the seam the spring model ties `sl st, ch 1`
      // to fixed chains where the real stitches slide along the loop, so their stretch is an artefact
      // of the attachment, not thread the template asks for
      net.pointedLoops.forEach((pl, li) => { for (const v of pl.nodes) owner.set(v, net.spines.length + li); });
      const g = net.graph;
      // the seam's travel stitches: turning chains, and the slip stitches a round starts with
      const travel = new Uint8Array(net.nNodes);
      for (const rd of g.rounds) {
        for (let i = rd.first; i >= 0 && i <= rd.last && (g.nodes[i].type === 'slst' || (g.nodes[i].role === 'tch' && !g.nodes[i].countsAs)); i++) travel[i] = 1;
      }
      for (let i = 0; i < net.nNodes; i++) if (g.nodes[i].role === 'tch' && !g.nodes[i].countsAs) travel[i] = 1;
      const tch = (i: number) => i < net.nNodes && travel[i] === 1;
      pinStretch = { spines: 0, chains: 0, body: 0 };
      const wch = net.params.stitches.ch?.width ?? 1;
      for (const q of sel) {
        // stretch of a piece of thread at least one chain long: a slip stitch's 0.48 mm wale pulled by
        // 0.08 mm is not "17 %" of anything a crocheter could see
        const st = net.L[q] >= wch ? strain[q] : (strain[q] * net.L[q]) / wch;
        // thread lengths only (course and wale springs): bend and shear springs measure a change of
        // shape or a skewed stitch, not stretched thread
        if (!(st > 0) || (net.kind[q] !== COURSE && net.kind[q] !== WALE) || tch(net.I[q]) || tch(net.J[q])) continue;
        const oi = owner.get(net.I[q]);
        const part: keyof PinStretch = oi !== undefined && oi === owner.get(net.J[q]) ? 'spines' : net.slack[q] ? 'chains' : 'body';
        pinStretch[part] = Math.max(pinStretch[part], st);
      }
      const over = pinOverstretch(pinStretch);
      if (over) { message = over; if (verdict === 'easy') verdict = 'firm'; }
      else if (verdict !== 'impossible') message = 'Pins out to the template without overstretching.';
    }
    return {
      positions: pos, energy: opt.f, converged: opt.status === 'converged', strain,
      meanAbsStrain, maxAbsStrain: maxAbs, maxCompression: cnt ? maxComp : 0, maxStretch: cnt ? maxStr : 0,
      buckleFraction, compressedFraction, pinned, verdict, message, pins: aligned, pinStretch, plane: { c, u, v },
    };
  };
  return { opt, finish };
}

/**
 * Stretch above which pinning counts as overstretching: block_stretch (5 %) is what blocking is
 * meant to do; more than this means the template asks for more than the thread gives.
 */
export const PIN_OVERSTRETCH = 0.15;

/** Plain-language warning when pinning stretches a part by more than PIN_OVERSTRETCH, else ''. */
export function pinOverstretch(s: PinStretch): string {
  const parts: [keyof PinStretch, string][] = [['spines', 'the arms'], ['chains', 'the chain loops'], ['body', 'the body']];
  const bad = parts.filter(([k]) => s[k] > PIN_OVERSTRETCH).sort((a, b) => s[b[0]] - s[a[0]]);
  if (!bad.length) return '';
  return `Pinning to the template stretches ${bad.map(([k, w]) => `${w} ${Math.round(s[k] * 100)} %`).join(' and ')}.`;
}

/**
 * Rigid 2D fit of the pin targets onto the current positions of their nodes; returns the moved
 * targets. The handedness is not fitted (an n-fold star fits its mirror image just as well): the
 * targets are reflected when the winding of the pins taken in working (node id) order differs from
 * the winding of their nodes' current positions, then the best rotation and translation is used.
 */
export function alignPins(pins: BlockPin[], cur: (node: number) => [number, number]): { node: number; x: number; y: number }[] {
  const m = pins.length;
  let tx = 0, ty = 0, px = 0, py = 0;
  for (const p of pins) { const [a, b] = cur(p.node); tx += p.x; ty += p.y; px += a; py += b; }
  tx /= m; ty /= m; px /= m; py /= m;
  const order = [...pins].sort((a, b) => a.node - b.node);
  let wt = 0, wc = 0;
  for (let k = 0; k < m; k++) {
    const a = order[k], b = order[(k + 1) % m];
    wt += (a.x - tx) * (b.y - ty) - (a.y - ty) * (b.x - tx);
    const [ax, ay] = cur(a.node), [bx, by] = cur(b.node);
    wc += (ax - px) * (by - py) - (ay - py) * (bx - px);
  }
  const refl = wt * wc < 0 ? -1 : 1;
  let A = 0, B = 0;
  for (const p of pins) {
    const X = p.x - tx, Y = refl * (p.y - ty);
    const [a0, b0] = cur(p.node);
    const a = a0 - px, b = b0 - py;
    A += X * a + Y * b; B += X * b - Y * a;
  }
  const h = Math.sqrt(A * A + B * B) || 1;
  const co = A / h, si = B / h;
  return pins.map((p) => {
    const X = p.x - tx, Y = refl * (p.y - ty);
    return { node: p.node, x: px + co * X - si * Y, y: py + si * X + co * Y };
  });
}

export function blockVerdict(buckleFraction: number, meanAbsStrain: number, compressedFraction = 0): { verdict: BlockVerdict; message: string } {
  const pct = (x: number) => Math.max(1, Math.round(x * 100));
  if (buckleFraction > BLOCK_IMPOSSIBLE_FRACTION || compressedFraction > BLOCK_IMPOSSIBLE_FRACTION) {
    const message = buckleFraction > BLOCK_IMPOSSIBLE_FRACTION
      ? `Will not block flat: ${pct(buckleFraction)}% of the edge would have to be compressed.`
      : `Will not block flat: ${pct(compressedFraction)}% of the fabric would have to be compressed (it would fold).`;
    return { verdict: 'impossible', message };
  }
  if (buckleFraction > 0 || compressedFraction > 0 || meanAbsStrain > BLOCK_EASY_MEAN_STRAIN) {
    return { verdict: 'firm', message: 'Blocks flat with firm pinning.' };
  }
  return { verdict: 'easy', message: 'Blocks flat easily.' };
}

/** Blocked solve of relaxed positions X, synchronously. */
export function block(net: Network, X: Float64Array, config: SimConfig = defaultConfig, gtol = 1e-8, pins?: BlockPin[]): BlockResult {
  const s = setupBlock(net, X, config, gtol, pins);
  s.opt.run();
  return s.finish();
}
