/**
 * Ordered 1-D spacing solver used by the chart layout.
 *
 * Given items in working order with desired positions t_i, weights w_i and minimum gaps g_i
 * between item i and i+1, find positions θ minimising Σ w_i (θ_i − t_i)² subject to
 * θ_{i+1} − θ_i ≥ g_i (order kept, no overlap) and, optionally, θ_{n−1} − θ_0 ≤ span (a closed
 * round must fit in one turn). Substituting ψ_i = θ_i − Σ_{j<i} g_j turns the gap constraints
 * into ψ non-decreasing: isotonic regression, solved exactly by pool-adjacent-violators (O(n)).
 * The span constraint is enforced through its Lagrange multiplier (bisection; the span of the
 * isotonic fit is monotone in it).
 */

function pava(y: Float64Array, w: Float64Array, out: Float64Array): void {
  const n = y.length;
  const bv = new Float64Array(n); // block mean
  const bw = new Float64Array(n); // block weight
  const bn = new Int32Array(n); // block size
  let top = 0;
  for (let i = 0; i < n; i++) {
    bv[top] = y[i]; bw[top] = w[i]; bn[top] = 1; top++;
    while (top > 1 && bv[top - 2] > bv[top - 1]) {
      const W = bw[top - 2] + bw[top - 1];
      bv[top - 2] = (bv[top - 2] * bw[top - 2] + bv[top - 1] * bw[top - 1]) / W;
      bw[top - 2] = W; bn[top - 2] += bn[top - 1]; top--;
    }
  }
  let k = 0;
  for (let b = 0; b < top; b++) for (let j = 0; j < bn[b]; j++) out[k++] = bv[b];
}

export interface SolveInput {
  target: ArrayLike<number>;
  weight: ArrayLike<number>;
  /** gap[i] between item i and i+1 (length n−1, or n with a trailing wrap gap ignored here). */
  gap: ArrayLike<number>;
  /** If set: θ_{n−1} − θ_0 must not exceed this. */
  maxSpan?: number;
}

/** Returns positions; gaps are scaled down uniformly if they cannot fit in maxSpan. */
export function solveOrdered({ target, weight, gap, maxSpan }: SolveInput): Float64Array {
  const n = target.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = Math.max(1e-6, weight[i]);
  const D = new Float64Array(n);
  let scale = 1;
  let total = 0;
  for (let i = 0; i + 1 < n; i++) total += Math.max(0, gap[i]);
  if (maxSpan !== undefined && total > maxSpan) scale = maxSpan / total;
  for (let i = 1; i < n; i++) D[i] = D[i - 1] + Math.max(0, gap[i - 1]) * scale;
  const y = new Float64Array(n);
  const psi = new Float64Array(n);
  const fit = (lambda: number) => {
    for (let i = 0; i < n; i++) y[i] = target[i] - D[i];
    if (lambda > 0 && n > 1) { y[0] += lambda / w[0]; y[n - 1] -= lambda / w[n - 1]; }
    pava(y, w, psi);
    return psi[n - 1] - psi[0];
  };
  let span = fit(0);
  if (maxSpan !== undefined && n > 1) {
    const S = maxSpan - D[n - 1];
    if (span > S + 1e-9) {
      let lo = 0, hi = 1;
      while (fit(hi) > S && hi < 1e12) hi *= 2;
      for (let it = 0; it < 50; it++) {
        const mid = (lo + hi) / 2;
        if (fit(mid) > S) lo = mid; else hi = mid;
      }
      span = fit(hi);
    }
  }
  for (let i = 0; i < n; i++) out[i] = psi[i] + D[i];
  return out;
}
