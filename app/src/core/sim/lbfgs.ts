/**
 * Spring energy with analytic gradient, and a dependency-free L-BFGS minimiser (two-loop recursion,
 * strong-Wolfe line search with cubic interpolation) whose stopping rules mirror scipy's L-BFGS-B
 * as the lab calls it: max|g| <= gtol, or relative decrease (f_k - f_{k+1}) / max(|f_k|, |f_{k+1}|, 1)
 * <= ftol, or the iteration limit. Runs one iteration per `iterate()` so the interactive sim can
 * spread a solve over animation frames.
 */

/** A set of springs over `n` particles (compact indices), with k/L precomputed. */
export interface SpringSet {
  n: number;
  m: number;
  I: Int32Array; J: Int32Array; L: Float64Array; kL: Float64Array;
  slack: Uint8Array;
}

/**
 * E = Σ ½ (k/L)(|x_i − x_j| − L)², tension-only springs use max(0, |d| − L). x and g are flat [3n].
 * Writes the gradient into g (overwritten) and returns E.
 */
export function springEnergy(s: SpringSet, x: Float64Array, g: Float64Array): number {
  g.fill(0);
  let E = 0;
  const { I, J, L, kL, slack, m } = s;
  for (let q = 0; q < m; q++) {
    const a = 3 * I[q], b = 3 * J[q];
    const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let e = r - L[q];
    if (slack[q] && e < 0) e = 0;
    if (e === 0) continue;
    const k = kL[q];
    E += 0.5 * k * e * e;
    const c = (k * e) / (r > 1e-12 ? r : 1e-12);
    const fx = c * dx, fy = c * dy, fz = c * dz;
    g[a] += fx; g[a + 1] += fy; g[a + 2] += fz;
    g[b] -= fx; g[b + 1] -= fy; g[b + 2] -= fz;
  }
  return E;
}

export type Objective = (x: Float64Array, g: Float64Array) => number;

export interface LbfgsOptions {
  /** History size (scipy maxcor). Default 20. */
  m?: number;
  /** Stop when max |g_i| <= gtol. Default 1e-6. */
  gtol?: number;
  /** Stop when the relative decrease <= ftol. Default 1e-15. */
  ftol?: number;
  maxIter?: number;
}

export type LbfgsStatus = 'running' | 'converged' | 'stalled' | 'maxiter';

const dot = (a: Float64Array, b: Float64Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const maxAbs = (a: Float64Array) => { let s = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > s) s = v; } return s; };

export class Lbfgs {
  readonly x: Float64Array;
  readonly g: Float64Array;
  f: number;
  iter = 0;
  evals = 1;
  status: LbfgsStatus = 'running';
  private readonly mMax: number;
  private readonly gtol: number;
  private readonly ftol: number;
  private readonly maxIter: number;
  private S: Float64Array[] = [];
  private Y: Float64Array[] = [];
  private rho: number[] = [];
  private d: Float64Array;
  private xt: Float64Array;
  private gt: Float64Array;
  private alphaBuf: number[];
  private failures = 0;

  constructor(private readonly fg: Objective, x0: Float64Array, opts: LbfgsOptions = {}) {
    const n = x0.length;
    this.mMax = opts.m ?? 20;
    this.gtol = opts.gtol ?? 1e-6;
    this.ftol = opts.ftol ?? 1e-15;
    this.maxIter = opts.maxIter ?? 20000;
    this.x = Float64Array.from(x0);
    this.g = new Float64Array(n);
    this.f = fg(this.x, this.g);
    this.d = new Float64Array(n);
    this.xt = new Float64Array(n);
    this.gt = new Float64Array(n);
    this.alphaBuf = new Array(this.mMax).fill(0);
    if (n === 0 || maxAbs(this.g) <= this.gtol) this.status = 'converged';
  }

  get gnorm(): number { return maxAbs(this.g); }

  /** Run iterations until done or `deadline` (performance.now() ms) passes. */
  run(deadline = Infinity, now: () => number = defaultNow): LbfgsStatus {
    while (this.status === 'running') {
      this.iterate();
      if (deadline !== Infinity && now() >= deadline) break;
    }
    return this.status;
  }

  /** One L-BFGS iteration. */
  iterate(): LbfgsStatus {
    if (this.status !== 'running') return this.status;
    const { x, g, d } = this;
    const n = x.length;
    // search direction d = -H g (two-loop recursion)
    for (let i = 0; i < n; i++) d[i] = -g[i];
    const k = this.S.length;
    for (let j = k - 1; j >= 0; j--) {
      const a = this.rho[j] * dot(this.S[j], d);
      this.alphaBuf[j] = a;
      const y = this.Y[j];
      for (let i = 0; i < n; i++) d[i] -= a * y[i];
    }
    if (k > 0) {
      const gamma = dot(this.S[k - 1], this.Y[k - 1]) / dot(this.Y[k - 1], this.Y[k - 1]);
      for (let i = 0; i < n; i++) d[i] *= gamma;
    }
    for (let j = 0; j < k; j++) {
      const b = this.rho[j] * dot(this.Y[j], d);
      const s = this.S[j], a = this.alphaBuf[j];
      for (let i = 0; i < n; i++) d[i] += s[i] * (a - b);
    }
    let dg = dot(d, g);
    if (!(dg < 0)) {
      // not a descent direction: restart with steepest descent
      this.resetMemory();
      for (let i = 0; i < n; i++) d[i] = -g[i];
      dg = dot(d, g);
    }
    const dn = Math.sqrt(dot(d, d));
    const step0 = k === 0 ? Math.min(1 / dn, 1e10) : 1;
    const f0 = this.f;
    const ok = this.lineSearch(f0, dg, step0);
    if (!ok) {
      this.failures++;
      if (this.S.length === 0 || this.failures >= 2) { this.status = 'stalled'; return this.status; }
      this.resetMemory();
      return this.status;
    }
    this.failures = 0;
    // accept: s = xt - x, y = gt - g
    const s = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0; i < n; i++) { s[i] = this.xt[i] - x[i]; y[i] = this.gt[i] - g[i]; }
    x.set(this.xt);
    g.set(this.gt);
    const f1 = this.f;
    this.iter++;
    const sy = dot(s, y), yy = dot(y, y);
    if (sy > 2.2e-16 * yy) {
      if (this.S.length === this.mMax) { this.S.shift(); this.Y.shift(); this.rho.shift(); }
      this.S.push(s); this.Y.push(y); this.rho.push(1 / sy);
    }
    if (maxAbs(g) <= this.gtol) this.status = 'converged';
    else if ((f0 - f1) / Math.max(Math.abs(f0), Math.abs(f1), 1) <= this.ftol) this.status = 'converged';
    else if (this.iter >= this.maxIter) this.status = 'maxiter';
    return this.status;
  }

  private resetMemory() { this.S = []; this.Y = []; this.rho = []; }

  /** Evaluate at x + a d into xt/gt; returns f. */
  private phi(a: number): number {
    const { x, d, xt } = this;
    for (let i = 0; i < x.length; i++) xt[i] = x[i] + a * d[i];
    this.evals++;
    return this.fg(xt, this.gt);
  }

  /** Strong-Wolfe line search (Nocedal & Wright alg. 3.5/3.6), c1 = 1e-3, c2 = 0.9 as L-BFGS-B. */
  private lineSearch(f0: number, dg0: number, a1: number): boolean {
    const c1 = 1e-3, c2 = 0.9;
    let aPrev = 0, fPrev = f0, dgPrev = dg0;
    let a = a1;
    for (let it = 0; it < 30; it++) {
      const fa = this.phi(a);
      const dga = dot(this.gt, this.d);
      if (!Number.isFinite(fa) || fa > f0 + c1 * a * dg0 || (it > 0 && fa >= fPrev)) {
        return this.zoom(aPrev, fPrev, dgPrev, a, fa, dga, f0, dg0, c1, c2);
      }
      if (Math.abs(dga) <= -c2 * dg0) { this.f = fa; return true; }
      if (dga >= 0) return this.zoom(a, fa, dga, aPrev, fPrev, dgPrev, f0, dg0, c1, c2);
      aPrev = a; fPrev = fa; dgPrev = dga;
      a = Math.min(a * 4, 1e10);
    }
    return false;
  }

  private zoom(lo: number, flo: number, dlo: number, hi: number, fhi: number, dhi: number,
    f0: number, dg0: number, c1: number, c2: number): boolean {
    for (let it = 0; it < 40; it++) {
      // cubic interpolation between lo and hi, safeguarded
      let a = cubicMin(lo, flo, dlo, hi, fhi, dhi);
      const lo2 = Math.min(lo, hi), hi2 = Math.max(lo, hi), w = hi2 - lo2;
      if (!Number.isFinite(a) || a < lo2 + 0.1 * w || a > hi2 - 0.1 * w) a = 0.5 * (lo + hi);
      const fa = this.phi(a);
      const dga = dot(this.gt, this.d);
      if (!Number.isFinite(fa) || fa > f0 + c1 * a * dg0 || fa >= flo) { hi = a; fhi = fa; dhi = dga; }
      else {
        if (Math.abs(dga) <= -c2 * dg0) { this.f = fa; return true; }
        if (dga * (hi - lo) >= 0) { hi = lo; fhi = flo; dhi = dlo; }
        lo = a; flo = fa; dlo = dga;
      }
      if (Math.abs(hi - lo) <= 1e-16 * Math.max(1, Math.abs(lo))) break;
    }
    // accept the best sufficient-decrease point found, if any
    if (lo > 0 && flo < f0) { this.phi(lo); this.f = flo; return true; }
    return false;
  }
}

function cubicMin(a: number, fa: number, da: number, b: number, fb: number, db: number): number {
  const d1 = da + db - (3 * (fa - fb)) / (a - b);
  const disc = d1 * d1 - da * db;
  if (disc < 0) return NaN;
  const d2 = Math.sign(b - a) * Math.sqrt(disc);
  return b - ((b - a) * (db + d2 - d1)) / (db - da + 2 * d2);
}

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export const now = defaultNow;
