/**
 * Engine-independent math for the sim. The relaxed shapes of ruffles and closed pieces depend on
 * last-bit differences in the initial placement (the network has zero-stiffness isometric modes),
 * and `Math.sin`/`Math.cos`/`Math.hypot` differ between JS engines (node 22 vs Chromium 158 differ
 * on ~3 % of the sin arguments the sim uses). Everything here uses only IEEE-754 exact operations,
 * so results are bit-identical everywhere:
 *
 *  * `dsin`, `dcos`: argument reduction and Taylor series in double-double arithmetic, rounded
 *    once at the end — correctly rounded in practice, which is also what glibc (and so the Python
 *    lab) returns for almost all arguments;
 *  * `npSum`/`npMean`: numpy's pairwise summation of a 1-D float64 array (np.mean), so means match
 *    the lab bit for bit.
 */

const SPLIT = 134217729; // 2^27 + 1

/** a + b = s + e exactly */
function twoSum(a: number, b: number): [number, number] {
  const s = a + b;
  const bb = s - a;
  return [s, (a - (s - bb)) + (b - bb)];
}
/** a · b = p + e exactly (Dekker) */
function twoProd(a: number, b: number): [number, number] {
  const p = a * b;
  let t = SPLIT * a;
  const ah = t - (t - a), al = a - ah;
  t = SPLIT * b;
  const bh = t - (t - b), bl = b - bh;
  return [p, ((ah * bh - p) + ah * bl + al * bh) + al * bl];
}
type DD = [number, number];
function ddAdd(a: DD, b: DD): DD {
  const [s, e] = twoSum(a[0], b[0]);
  const [t, f] = twoSum(a[1], b[1]);
  let [hi, lo] = twoSum(s, e + t);
  [hi, lo] = twoSum(hi, lo + f);
  return [hi, lo];
}
function ddMul(a: DD, b: DD): DD {
  const [p, e] = twoProd(a[0], b[0]);
  const [hi, lo] = twoSum(p, e + (a[0] * b[1] + a[1] * b[0]));
  return [hi, lo];
}
function ddMulD(a: DD, b: number): DD {
  const [p, e] = twoProd(a[0], b);
  const [hi, lo] = twoSum(p, e + a[1] * b);
  return [hi, lo];
}

// π/2 in three 33-bit pieces plus a tail (fdlibm's pio2_1, pio2_2, pio2_3, pio2_3t): k·piece is exact
// for |k| < 2^20.
const P1 = 1.57079632673412561417e+00;
const P2 = 6.07710050630396597660e-11;
const P3 = 2.02226624871116645580e-21;
const P3T = 8.47842766036889956997e-32;
const INV_PIO2 = 6.36619772367581382433e-01;

/** x − k·π/2 in double-double, k = round(x·2/π). Exact enough for |x| < 2^20·π/2. */
function reduce(x: number): { k: number; r: DD } {
  const k = Math.round(x * INV_PIO2);
  // x − k·P1 is exact (Sterbenz), then subtract the remaining pieces in double-double
  let r: DD = [x - k * P1, 0];
  r = ddAdd(r, [-k * P2, 0]);
  r = ddAdd(r, [-k * P3, 0]);
  r = ddAdd(r, [-k * P3T, 0]);
  return { k, r };
}

// 1/n! as double-double, n = 0..29
const INV_FACT: DD[] = (() => {
  const out: DD[] = [[1, 0]];
  let f: DD = [1, 0];
  for (let n = 1; n <= 29; n++) {
    // 1/n! = (1/(n-1)!) / n — division in double-double: q = f / n with one correction step
    const q = f[0] / n;
    const [p, e] = twoProd(q, n);
    const rem = (f[0] - p - e + f[1]) / n;
    f = twoSum(q, rem);
    out.push(f);
  }
  return out;
})();

/** sin and cos of a reduced argument |r| ≤ π/4 (double-double). */
function sinCosDD(r: DD): { s: DD; c: DD } {
  const r2 = ddMul(r, r);
  // Horner in r²: sin r = r (1 − r²/3! + r⁴/5! − …), cos r = 1 − r²/2! + r⁴/4! − …
  let s: DD = [0, 0], c: DD = [0, 0];
  for (let n = 27; n >= 1; n -= 2) {
    const sgn = ((n - 1) / 2) % 2 === 0 ? 1 : -1;
    s = ddAdd(ddMul(s, r2), [sgn * INV_FACT[n][0], sgn * INV_FACT[n][1]]);
  }
  s = ddMul(s, r);
  for (let n = 28; n >= 0; n -= 2) {
    const sgn = (n / 2) % 2 === 0 ? 1 : -1;
    c = ddAdd(ddMul(c, r2), [sgn * INV_FACT[n][0], sgn * INV_FACT[n][1]]);
  }
  return { s, c };
}

function trig(x: number, wantCos: boolean): number {
  if (!Number.isFinite(x)) return NaN;
  if (x === 0) return wantCos ? 1 : x;
  if (Math.abs(x) > 1e6) return wantCos ? Math.cos(x) : Math.sin(x); // not used by the sim
  const { k, r } = reduce(x);
  const { s, c } = sinCosDD(r);
  const q = ((k % 4) + 4) % 4 + (wantCos ? 1 : 0);
  // sin(r + qπ/2): q=0 sin, 1 cos, 2 −sin, 3 −cos
  const v = q % 4 === 0 ? s : q % 4 === 1 ? c : q % 4 === 2 ? [-s[0], -s[1]] as DD : [-c[0], -c[1]] as DD;
  return v[0] + v[1];
}

export const dsin = (x: number) => trig(x, false);
export const dcos = (x: number) => trig(x, true);

/** numpy's pairwise_sum for float64 (np.add.reduce of a contiguous 1-D array). */
function pairwise(a: ArrayLike<number>, lo: number, n: number): number {
  if (n < 8) {
    let res = -0;
    for (let i = 0; i < n; i++) res += a[lo + i];
    return res;
  }
  if (n <= 128) {
    const r = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
    let i = 8;
    for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] += a[lo + i + j];
    let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < n; i++) res += a[lo + i];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return pairwise(a, lo, n2) + pairwise(a, lo + n2, n - n2);
}

/** np.sum of a 1-D float64 array (exactly numpy's association). */
export function npSum(a: ArrayLike<number>): number {
  return a.length ? pairwise(a, 0, a.length) : 0;
}
/** np.mean of a 1-D float64 array. */
export function npMean(a: ArrayLike<number>): number {
  return a.length ? npSum(a) / a.length : NaN;
}
