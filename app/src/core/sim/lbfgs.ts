/**
 * Spring energy with analytic gradient, and a dependency-free L-BFGS minimiser (two-loop recursion,
 * More–Thuente line search as in L-BFGS-B) whose stopping rules mirror scipy's L-BFGS-B
 * as the lab calls it: max|g| <= gtol, or relative decrease (f_k - f_{k+1}) / max(|f_k|, |f_{k+1}|, 1)
 * <= ftol, or the iteration limit. Runs one iteration per `iterate()` so the interactive sim can
 * spread a solve over animation frames.
 */

/**
 * Arithmetic helpers that use only IEEE-754 exact operations (+ − × ÷ √), so results are
 * bit-identical across JS engines (Math.hypot and ** are not specified to be; the relaxed shapes
 * of ruffles and closed pieces are sensitive to last-bit differences).
 */
export const sq = (x: number) => x * x;
export const hyp = (a: number, b: number, c = 0) => Math.sqrt(a * a + b * b + c * c);

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
  // gradient accumulated as numpy's bincount(I, f) − bincount(J, f) (same association as the lab)
  const n3 = 3 * s.n;
  if (!scratch || scratch.length < n3) scratch = new Float64Array(n3);
  const gJ = scratch;
  g.fill(0);
  gJ.fill(0, 0, n3);
  let sum = 0;
  const { I, J, L, kL, slack, m } = s;
  for (let q = 0; q < m; q++) {
    const a = 3 * I[q], b = 3 * J[q];
    const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let e = r - L[q];
    if (slack[q] && e < 0) e = 0;
    const k = kL[q];
    sum += k * (e * e);
    const c = (k * e) / (r > 1e-12 ? r : 1e-12);
    const fx = dx * c, fy = dy * c, fz = dz * c;
    g[a] += fx; g[a + 1] += fy; g[a + 2] += fz;
    gJ[b] += fx; gJ[b + 1] += fy; gJ[b + 2] += fz;
  }
  for (let i = 0; i < n3; i++) g[i] -= gJ[i];
  return 0.5 * sum;
}
let scratch: Float64Array | null = null;

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

  /** One L-BFGS iteration (as scipy's L-BFGS-B mainlb for an unbounded problem). */
  iterate(): LbfgsStatus {
    if (this.status !== 'running') return this.status;
    const { x, g, d } = this;
    const n = x.length;
    // search direction d = -H g (two-loop recursion; H0 = s'y / y'y of the newest pair)
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
    const dg = dot(d, g);
    if (!(dg < 0)) {
      // not a descent direction: refresh the memory (L-BFGS-B does the same)
      if (k === 0) { this.status = 'stalled'; return this.status; }
      this.resetMemory();
      return this.status;
    }
    const dn = Math.sqrt(dot(d, d));
    const step0 = this.iter === 0 && !this.refreshed ? Math.min(1 / dn, 1e10) : 1;
    const f0 = this.f;
    const stp = this.lineSearch(f0, dg, step0);
    if (stp === null) {
      // restore x, g (still in x / g) and refresh the memory; give up if there was none
      if (k === 0) { this.status = 'stalled'; return this.status; }
      this.resetMemory();
      return this.status;
    }
    // accept: s = xt - x, y = gt - g
    const s = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0; i < n; i++) { s[i] = this.xt[i] - x[i]; y[i] = this.gt[i] - g[i]; }
    const sg0 = stp * dg;   // s'g_old
    x.set(this.xt);
    g.set(this.gt);
    const f1 = this.f;
    this.iter++;
    if (maxAbs(g) <= this.gtol) this.status = 'converged';
    else if (f0 - f1 <= this.ftol * Math.max(Math.abs(f0), Math.abs(f1), 1)) this.status = 'converged';
    else if (this.iter >= this.maxIter) this.status = 'maxiter';
    // L-BFGS-B skips the update when s'y <= eps * (-s'g_old)
    const sy = dot(s, y);
    if (sy > 2.220446049250313e-16 * -sg0) {
      if (this.S.length === this.mMax) { this.S.shift(); this.Y.shift(); this.rho.shift(); }
      this.S.push(s); this.Y.push(y); this.rho.push(1 / sy);
    }
    return this.status;
  }

  private refreshed = false;
  private resetMemory() { this.S = []; this.Y = []; this.rho = []; this.refreshed = true; }

  /** Evaluate at x + a d into xt/gt; returns f. */
  private phi(a: number): number {
    const { x, d, xt } = this;
    for (let i = 0; i < x.length; i++) xt[i] = x[i] + a * d[i];
    this.evals++;
    return this.fg(xt, this.gt);
  }

  /**
   * More–Thuente line search (MINPACK-2 dcsrch) with L-BFGS-B's settings: ftol 1e-3, gtol 0.9,
   * xtol 0.1, stpmin 0, stpmax 1e10, at most 20 evaluations. Warnings count as success, as in
   * L-BFGS-B. Returns the accepted step (xt, gt, f hold the new point) or null on failure.
   */
  private lineSearch(finit: number, ginit: number, stp0: number): number | null {
    const ftol = 1e-3, gtol = 0.9, xtol = 0.1, stpmin = 0, stpmax = 1e10;
    const xtrapl = 1.1, xtrapu = 4.0;
    let stp = stp0;
    let brackt = false, stage = 1;
    const gtest = ftol * ginit;
    let width = stpmax - stpmin, width1 = width / 0.5;
    const st: StepState = { stx: 0, fx: finit, gx: ginit, sty: 0, fy: finit, gy: ginit, brackt: false };
    let stmin = 0, stmax = stp + xtrapu * stp;
    for (let nfev = 1; nfev <= 20; nfev++) {
      const f = this.phi(stp);
      const gp = dot(this.gt, this.d);
      if (!Number.isFinite(f)) {
        // outside the domain: shrink (not in MINPACK; protects against overflow)
        stp = st.stx + 0.5 * (stp - st.stx);
        brackt = true; st.brackt = true; stmax = stp * 2;
        continue;
      }
      const ftest = finit + stp * gtest;
      if (stage === 1 && f <= ftest && gp >= 0) stage = 2;
      const accept = () => { this.f = f; return stp; };
      if (brackt && (stp <= stmin || stp >= stmax)) return accept();   // rounding warning (accepted, as L-BFGS-B)
      if (brackt && stmax - stmin <= xtol * stmax) return accept();     // xtol warning
      if (stp === stpmax && f <= ftest && gp <= gtest) return accept();
      if (stp === stpmin && (f > ftest || gp >= gtest)) return accept();
      if (f <= ftest && Math.abs(gp) <= gtol * -ginit) return accept();                      // convergence
      st.brackt = brackt;
      if (stage === 1 && f <= st.fx && f > ftest) {
        const fm = f - stp * gtest;
        const m: StepState = {
          stx: st.stx, fx: st.fx - st.stx * gtest, gx: st.gx - gtest,
          sty: st.sty, fy: st.fy - st.sty * gtest, gy: st.gy - gtest, brackt,
        };
        stp = dcstep(m, stp, fm, gp - gtest, stmin, stmax);
        st.stx = m.stx; st.sty = m.sty; st.brackt = m.brackt;
        st.fx = m.fx + m.stx * gtest; st.fy = m.fy + m.sty * gtest;
        st.gx = m.gx + gtest; st.gy = m.gy + gtest;
      } else {
        stp = dcstep(st, stp, f, gp, stmin, stmax);
      }
      brackt = st.brackt;
      if (brackt) {
        if (Math.abs(st.sty - st.stx) >= 0.66 * width1) stp = st.stx + 0.5 * (st.sty - st.stx);
        width1 = width;
        width = Math.abs(st.sty - st.stx);
        stmin = Math.min(st.stx, st.sty); stmax = Math.max(st.stx, st.sty);
      } else {
        stmin = stp + xtrapl * (stp - st.stx);
        stmax = stp + xtrapu * (stp - st.stx);
      }
      stp = Math.min(Math.max(stp, stpmin), stpmax);
      if ((brackt && (stp <= stmin || stp >= stmax)) || (brackt && stmax - stmin <= xtol * stmax)) stp = st.stx;
    }
    return null;
  }
}

interface StepState { stx: number; fx: number; gx: number; sty: number; fy: number; gy: number; brackt: boolean }

/** MINPACK-2 dcstep: safeguarded cubic/quadratic step; updates the interval in `s`, returns the new step. */
function dcstep(s: StepState, stp: number, fp: number, dp: number, stpmin: number, stpmax: number): number {
  const { stx, fx, gx: dx, sty, fy, gy: dy } = s;
  const sgnd = dp * (dx / Math.abs(dx));
  let stpf: number;
  if (fp > fx) {
    const theta = (3 * (fx - fp)) / (stp - stx) + dx + dp;
    const sc = Math.max(Math.abs(theta), Math.abs(dx), Math.abs(dp));
    let gamma = sc * Math.sqrt(sq(theta / sc) - (dx / sc) * (dp / sc));
    if (stp < stx) gamma = -gamma;
    const p = gamma - dx + theta, q = gamma - dx + gamma + dp, r = p / q;
    const stpc = stx + r * (stp - stx);
    const stpq = stx + (dx / ((fx - fp) / (stp - stx) + dx) / 2) * (stp - stx);
    stpf = Math.abs(stpc - stx) < Math.abs(stpq - stx) ? stpc : stpc + (stpq - stpc) / 2;
    s.brackt = true;
  } else if (sgnd < 0) {
    const theta = (3 * (fx - fp)) / (stp - stx) + dx + dp;
    const sc = Math.max(Math.abs(theta), Math.abs(dx), Math.abs(dp));
    let gamma = sc * Math.sqrt(sq(theta / sc) - (dx / sc) * (dp / sc));
    if (stp > stx) gamma = -gamma;
    const p = gamma - dp + theta, q = gamma - dp + gamma + dx, r = p / q;
    const stpc = stp + r * (stx - stp);
    const stpq = stp + (dp / (dp - dx)) * (stx - stp);
    stpf = Math.abs(stpc - stp) > Math.abs(stpq - stp) ? stpc : stpq;
    s.brackt = true;
  } else if (Math.abs(dp) < Math.abs(dx)) {
    const theta = (3 * (fx - fp)) / (stp - stx) + dx + dp;
    const sc = Math.max(Math.abs(theta), Math.abs(dx), Math.abs(dp));
    let gamma = sc * Math.sqrt(Math.max(0, sq(theta / sc) - (dx / sc) * (dp / sc)));
    if (stp > stx) gamma = -gamma;
    const p = gamma - dp + theta, q = gamma + (dx - dp) + gamma, r = p / q;
    let stpc: number;
    if (r < 0 && gamma !== 0) stpc = stp + r * (stx - stp);
    else if (stp > stx) stpc = stpmax;
    else stpc = stpmin;
    const stpq = stp + (dp / (dp - dx)) * (stx - stp);
    if (s.brackt) {
      stpf = Math.abs(stpc - stp) < Math.abs(stpq - stp) ? stpc : stpq;
      stpf = stp > stx ? Math.min(stp + 0.66 * (sty - stp), stpf) : Math.max(stp + 0.66 * (sty - stp), stpf);
    } else {
      stpf = Math.abs(stpc - stp) > Math.abs(stpq - stp) ? stpc : stpq;
      stpf = Math.max(stpmin, Math.min(stpmax, stpf));
    }
  } else {
    if (s.brackt) {
      const theta = (3 * (fp - fy)) / (sty - stp) + dy + dp;
      const sc = Math.max(Math.abs(theta), Math.abs(dy), Math.abs(dp));
      let gamma = sc * Math.sqrt(sq(theta / sc) - (dy / sc) * (dp / sc));
      if (stp > sty) gamma = -gamma;
      const p = gamma - dp + theta, q = gamma - dp + gamma + dy, r = p / q;
      stpf = stp + r * (sty - stp);
    } else stpf = stp > stx ? stpmax : stpmin;
  }
  if (fp > fx) { s.sty = stp; s.fy = fp; s.gy = dp; }
  else {
    if (sgnd < 0) { s.sty = stx; s.fy = fx; s.gy = dx; }
    s.stx = stp; s.fx = fp; s.gx = dp;
  }
  return stpf;
}

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export const now = defaultNow;
