/**
 * Shape metric and flat / cup / ruffle classifier (spec/physics.md §5) — a port of
 * `crolab/metrics.py` including the PCA sign convention (SPEC_NOTES: flip the least-variance
 * eigenvector so that its largest-magnitude component is positive).
 */
import { simConfig as defaultConfig, type SimConfig } from '../params';
import type { ShapeClass } from '../flatness';
import { hyp, sq } from './lbfgs';

export interface ShapeMetric {
  class: ShapeClass;
  A: number;
  W: number;
  Rg: number;
  outer_radius: number;
  axis: [number, number, number];
  centroid: [number, number, number];
  axisKind: 'rounds' | 'pca';
}

/** Eigen-decomposition of a symmetric 3×3 matrix (cyclic Jacobi). Columns of V are eigenvectors. */
export function eigSym3(Ain: number[][]): { values: number[]; vectors: number[][] } {
  const A = Ain.map((r) => r.slice());
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = sq(A[0][1]) + sq(A[0][2]) + sq(A[1][2]);
    if (off < 1e-30 * (sq(A[0][0]) + sq(A[1][1]) + sq(A[2][2]) + 1e-300)) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((a, b) => A[a][a] - A[b][b]);
  return { values: order.map((i) => A[i][i]), vectors: order.map((i) => [V[0][i], V[1][i], V[2][i]]) };
}

/**
 * X: flat [3·n] positions of the real (node) particles (extra entries ignored); nodeRounds: round
 * per node. Rows with NaN are particles not yet made and are skipped.
 */
export function shapeMetric(X: ArrayLike<number>, nodeRounds: ArrayLike<number>, config: SimConfig = defaultConfig): ShapeMetric {
  const n = nodeRounds.length;
  const sel: number[] = [];
  for (let i = 0; i < n; i++) if (!Number.isNaN(X[3 * i])) sel.push(i);
  const c: [number, number, number] = [0, 0, 0];
  for (const i of sel) for (let d = 0; d < 3; d++) c[d] += X[3 * i + d];
  for (let d = 0; d < 3; d++) c[d] /= sel.length || 1;
  const D = sel.map((i) => [X[3 * i] - c[0], X[3 * i + 1] - c[1], X[3 * i + 2] - c[2]]);
  let ss = 0;
  for (const v of D) ss += v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const Rg = sel.length ? Math.sqrt(ss / sel.length) : 0;
  const rr = sel.map((i) => nodeRounds[i]);
  const rounds = [...new Set(rr)].sort((a, b) => a - b);
  const centroidOf = (r: number) => {
    const m = [0, 0, 0]; let k = 0;
    sel.forEach((i, q) => { if (rr[q] === r) { for (let d = 0; d < 3; d++) m[d] += X[3 * i + d]; k++; } });
    return m.map((v) => v / k);
  };
  let axis: [number, number, number] = [0, 0, 1];
  let axisKind: 'rounds' | 'pca' = 'pca';
  if (rounds.length) {
    const f = centroidOf(rounds[0]), l = centroidOf(rounds[rounds.length - 1]);
    const a = [l[0] - f[0], l[1] - f[1], l[2] - f[2]];
    const na = hyp(a[0], a[1], a[2]);
    if (Rg > 0 && na > config.axis_min * Rg) {
      axis = [a[0] / na, a[1] / na, a[2] / na];
      axisKind = 'rounds';
    } else {
      const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const v of D) for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) cov[p][q] += v[p] * v[q];
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) cov[p][q] /= D.length || 1;
      const v = eigSym3(cov).vectors[0];
      let k = 0;
      for (let d = 1; d < 3; d++) if (Math.abs(v[d]) > Math.abs(v[k])) k = d;
      const sgn = v[k] < 0 ? -1 : 1;
      axis = [sgn * v[0], sgn * v[1], sgn * v[2]];
    }
  }
  const z = D.map((v) => v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2]);
  const zbar: number[] = [], sig: number[] = [];
  for (const r of rounds) {
    const zs = z.filter((_, q) => rr[q] === r);
    if (zs.length >= 3) {
      const m = zs.reduce((s, v) => s + v, 0) / zs.length;
      zbar.push(m);
      sig.push(Math.sqrt(zs.reduce((s, v) => s + sq(v - m), 0) / zs.length));
    }
  }
  let A = 0, W = 0;
  if (Rg > 0 && zbar.length) {
    A = (Math.max(...zbar) - Math.min(...zbar)) / Rg;
    W = Math.max(...sig) / Rg;
  }
  const tau = config.tau_flat;
  const cls: ShapeClass = A < tau && W < tau ? 'flat' : W > A ? 'ruffle' : 'cup';
  let outer = 0;
  if (rounds.length) {
    const last = rounds[rounds.length - 1];
    let s = 0, k = 0;
    D.forEach((v, q) => {
      if (rr[q] !== last) return;
      const t = z[q];
      s += hyp(v[0] - t * axis[0], v[1] - t * axis[1], v[2] - t * axis[2]);
      k++;
    });
    outer = k ? s / k : 0;
  }
  return { class: cls, A, W, Rg, outer_radius: outer, axis, centroid: c, axisKind };
}
