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
import { Lbfgs, springEnergy, type SpringSet } from './lbfgs';
import { shapeMetric } from './metrics';
import { COURSE, type Network } from './network';

export type BlockVerdict = 'easy' | 'firm' | 'impossible';

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
  pinned: Uint8Array;
  verdict: BlockVerdict;
  message: string;
}

/** Thresholds for the verdict (not part of the shared spec; UI wording only). */
export const BLOCK_EASY_MEAN_STRAIN = 0.03;

export interface BlockSetup {
  opt: Lbfgs;
  finish: () => BlockResult;
}

/** Prepare the blocked solve of positions X (relaxed). Run `opt` to convergence, then `finish()`. */
export function setupBlock(net: Network, X: Float64Array, config: SimConfig = defaultConfig, gtol = 1e-8): BlockSetup {
  const nN = net.nNodes, N = net.nParticles;
  const placed = new Uint8Array(N);
  for (let p = 0; p < N; p++) placed[p] = Number.isNaN(X[3 * p]) ? 0 : 1;
  const m = shapeMetric(X.subarray(0, 3 * nN), net.particleRound.subarray(0, nN), config);
  const c = m.centroid, n = m.axis;
  // orthonormal in-plane basis (deterministic): e = unit vector of the smallest |n| component
  let kmin = 0;
  for (let d = 1; d < 3; d++) if (Math.abs(n[d]) < Math.abs(n[kmin])) kmin = d;
  const e = [0, 0, 0]; e[kmin] = 1;
  let u = [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]];
  const nu = Math.hypot(u[0], u[1], u[2]);
  u = u.map((x) => x / nu);
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  let last = -1;
  for (let i = 0; i < nN; i++) if (placed[i] && net.particleRound[i] > last) last = net.particleRound[i];
  const pinned = new Uint8Array(N);
  for (let i = 0; i < nN; i++) if (placed[i] && net.particleRound[i] === last) pinned[i] = 1;
  const P = new Float64Array(2 * N);
  const s = config.block_stretch;
  for (let p = 0; p < N; p++) {
    if (!placed[p]) continue;
    const D = [X[3 * p] - c[0], X[3 * p + 1] - c[1], X[3 * p + 2] - c[2]];
    const pu = D[0] * u[0] + D[1] * u[1] + D[2] * u[2];
    const pv = D[0] * v[0] + D[1] * v[1] + D[2] * v[2];
    P[2 * p] = pu; P[2 * p + 1] = pv;
    if (pinned[p]) {
      const z = D[0] * n[0] + D[1] * n[1] + D[2] * n[2];
      const r = Math.hypot(D[0] - z * n[0], D[1] - z * n[1], D[2] - z * n[2]);
      const a = Math.atan2(pv, pu);
      P[2 * p] = s * r * Math.cos(a); P[2 * p + 1] = s * r * Math.sin(a);
    }
  }
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
  const opt = new Lbfgs(fg, x0, { gtol, maxIter: 50000 });

  const finish = (): BlockResult => {
    load(opt.x);
    const pos = new Float64Array(3 * N).fill(NaN);
    for (let p = 0; p < N; p++) {
      if (!placed[p]) continue;
      for (let d = 0; d < 3; d++) pos[3 * p + d] = c[d] + Y[3 * p] * u[d] + Y[3 * p + 1] * v[d];
    }
    const strain = new Float64Array(net.m).fill(NaN);
    let sumAbs = 0, maxAbs = 0, maxComp = -Infinity, maxStr = -Infinity, cnt = 0, nCourse = 0, nBuckle = 0;
    const thr = config.block_buckle_strain;
    for (const q of sel) {
      const a = 3 * net.I[q], b = 3 * net.J[q];
      const d = Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]);
      const st = d / net.L[q] - 1;
      strain[q] = st;
      const eff = net.slack[q] && st < 0 ? 0 : st;
      sumAbs += Math.abs(eff); cnt++;
      maxAbs = Math.max(maxAbs, Math.abs(eff));
      maxComp = Math.max(maxComp, -eff);
      maxStr = Math.max(maxStr, eff);
      if (net.kind[q] === COURSE && !net.slack[q]) { nCourse++; if (st < -thr) nBuckle++; }
    }
    const buckleFraction = nCourse ? nBuckle / nCourse : 0;
    const meanAbsStrain = cnt ? sumAbs / cnt : 0;
    const { verdict, message } = blockVerdict(buckleFraction, meanAbsStrain);
    return {
      positions: pos, energy: opt.f, converged: opt.status === 'converged', strain,
      meanAbsStrain, maxAbsStrain: maxAbs, maxCompression: cnt ? maxComp : 0, maxStretch: cnt ? maxStr : 0,
      buckleFraction, pinned, verdict, message,
    };
  };
  return { opt, finish };
}

export function blockVerdict(buckleFraction: number, meanAbsStrain: number): { verdict: BlockVerdict; message: string } {
  if (buckleFraction > 0) {
    const pct = Math.max(1, Math.round(buckleFraction * 100));
    return { verdict: 'impossible', message: `Will not block flat: ${pct}% of the edge would have to be compressed.` };
  }
  if (meanAbsStrain <= BLOCK_EASY_MEAN_STRAIN) return { verdict: 'easy', message: 'Blocks flat easily.' };
  return { verdict: 'firm', message: 'Blocks flat with firm pinning.' };
}

/** Blocked solve of relaxed positions X, synchronously. */
export function block(net: Network, X: Float64Array, config: SimConfig = defaultConfig, gtol = 1e-8): BlockResult {
  const s = setupBlock(net, X, config, gtol);
  s.opt.run();
  return s.finish();
}
