/**
 * Planar reference layouts for pieces with corners (lab/SPEC_NOTES.md N8–N10, P9): rows, the
 * border rounds worked around them (notation.md 3.9), and polygons worked from the centre with
 * their increases concentrated at the corners (granny squares, mitred squares, hexagons, …).
 * A line-by-line port of `lab/src/crolab/outline.py`.
 *
 * N1's reference cells assume a round is a circle round a centre. A row piece has no centre: its
 * rows are straight open courses, its border rounds run round a rectangle with four corners, and a
 * square from the centre has straight sides. For these the reference geometry is an explicit flat
 * layout Q (one 2D point per node), like the spine layouts of N5:
 *
 *  * Foundation span (the chains under the first row): one straight course whose length is the
 *    first row's (the chain stretches to the row it carries), y = 0.
 *  * Rows: straight courses one above the other, x by the row's own course coordinate in a global
 *    frame (the direction flips with every turned row; the offset aligns the row with the row
 *    below on average, as N1 does for open courses), y = base of the row + the stitch's height.
 *  * Outline rounds (border rounds, polygon rounds): the reference curve of round k is the mitred
 *    offset of round k−1's (the body rectangle for a border; a regular n-gon for the round under
 *    the first polygon round) by the round's mean height. Its corner groups (the stitches worked
 *    into a corner) are mapped, by their own course coordinate, onto the corner section — the
 *    corner entry's share projected outward plus the corner's fan of length 2·h·tan(θ/2) — and the
 *    stitches between two corners onto the straight section between the two corner sections. So a
 *    side with the right number of stitches and corners with the right increases lie exactly in
 *    the reference; a side with too many stitches is squeezed into its section (the stitches'
 *    course springs are longer than the room they have: the edge waves), too few are stretched
 *    over it (it puckers), missing corner increases stretch the corner (it cups).
 *
 * The polygon is mitred, not rounded: a flat n-gon's perimeter grows 2·n·h·tan(π/n) per round of
 * height h (8h for a square), which is what real granny squares do and what the blanket studio's
 * polygon check (core/blanket/checks.ts) assumes; a rounded offset (2πh) would call every flat
 * granny square 27 % over at the corners.
 */
import type { Anchor, Graph } from '../graph';
import { borderLists, type Entry } from '../graph/targets';
import { cornerGroups, detectPolygon } from '../flatness/corners';
import { dcos, dsin, npMean } from './detmath';

export type OutlineKind = 'foundation' | 'row' | 'border' | 'polygon' | 'polybase';
type P2 = [number, number];

/** Convex polygon with arc-length parametrisation from vertex 0. */
export interface Poly {
  V: P2[];
  L: number[];
  cum: number[];
  P: number;
  t: P2[];
  n: P2[];
}

export interface OutlineCorner { key: string; vertex: number; nodes: number[] }

/** One outline round (border or polygon round). */
export interface OutlineCourse {
  round: number;
  kind: 'border' | 'polygon';
  /** reference curve of the round (mean height) */
  poly: Poly;
  /** +1: the round runs with increasing arc-length, −1 against it */
  dir: number;
  h: number;
  corners: OutlineCorner[];
  /** the round's nodes in working order, starting at the first corner's core */
  order: number[];
  /** segments in working order: corner group q then the side after it (own and section lengths, mm) */
  segments: { region: 2 | 3; index: number; own: number; len: number }[];
}

export interface Outline {
  /** reference position per node (NaN where none) */
  qx: Float64Array;
  qy: Float64Array;
  has: Uint8Array;
  /** course contribution per node in the outline courses (mm) */
  c: Float64Array;
  /** arc-length of the node on its round's reference curve (outline rounds; NaN otherwise) */
  S: Float64Array;
  /** per round: its part in the layout (null: none) */
  roundKind: (OutlineKind | null)[];
  courses: Map<number, OutlineCourse>;
  /** region per node: 0 none, 1 body, 2 side, 3 corner; index = edge / vertex of the polygon */
  region: Uint8Array;
  regionIndex: Int16Array;
  /** the body rectangle of a row piece (O_0), null for polygon pieces */
  body: Poly | null;
  /** the n-gon of the base round of a polygon piece (centred at the origin), null otherwise */
  base: Poly | null;
  /** number of corners of the outline courses (0: rows only) */
  K: number;
  /** foundation span (chains under the first row) */
  span: number[];
  /**
   * Turning-chain columns: per turning chain in a run between two laid-out nodes, the factor its
   * run's course springs are scaled by so that the run is a straight column between them (0: none).
   */
  colScale: Float64Array;
  /**
   * Compliance factor per node of an outline round (N9): the course rest lengths of its segment
   * (side run or corner group) are its stitch widths × this; 1 elsewhere. See `segLam`.
   */
  lam: Float64Array;
}

// ---------------------------------------------------------------------------------------------
// small geometry
// ---------------------------------------------------------------------------------------------
const hyp2 = (x: number, y: number) => Math.sqrt(x * x + y * y);
const mod = (x: number, P: number) => x - P * Math.floor(x / P);
/** x wrapped into (−P/2, P/2]. */
const wrapc = (x: number, P: number) => x - P * Math.floor(x / P + 0.5);

export function makePoly(V: P2[]): Poly {
  const K = V.length;
  let A2 = 0;
  for (let j = 0; j < K; j++) { const a = V[j], b = V[(j + 1) % K]; A2 += a[0] * b[1] - a[1] * b[0]; }
  const L: number[] = [], cum: number[] = [], t: P2[] = [], n: P2[] = [];
  let s = 0;
  for (let j = 0; j < K; j++) {
    const a = V[j], b = V[(j + 1) % K];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = hyp2(dx, dy);
    L.push(l); cum.push(s); s += l;
    const tj: P2 = l > 0 ? [dx / l, dy / l] : [1, 0];
    t.push(tj);
    n.push(A2 > 0 ? [tj[1], -tj[0]] : [-tj[1], tj[0]]);
  }
  return { V, L, cum, P: s, t, n };
}

/** S taken into [0, P). */
function norm(poly: Poly, S: number): number {
  let s = mod(S, poly.P);
  if (!(s < poly.P)) s = 0;
  if (s < 0) s = 0;
  return s;
}

/** Edge index containing arc-length S (cum_j ≤ S < cum_j + L_j), S taken into [0, P). */
function edgeAt(poly: Poly, S: number): number {
  const s = norm(poly, S);
  let j = poly.V.length - 1;
  for (let q = 0; q < poly.V.length; q++) if (s < poly.cum[q] + poly.L[q]) { j = q; break; }
  return j;
}

export function pointAt(poly: Poly, S: number): P2 {
  const s = norm(poly, S);
  const j = edgeAt(poly, s);
  const u = Math.min(Math.max(s - poly.cum[j], 0), poly.L[j]);
  return [poly.V[j][0] + poly.t[j][0] * u, poly.V[j][1] + poly.t[j][1] * u];
}

function normalAt(poly: Poly, S: number): P2 { return poly.n[edgeAt(poly, S)]; }

/** Closest boundary point's arc-length (first edge on ties). */
export function locate(poly: Poly, p: P2): number {
  let best = Infinity, S = 0;
  for (let j = 0; j < poly.V.length; j++) {
    const v = poly.V[j];
    let u = (p[0] - v[0]) * poly.t[j][0] + (p[1] - v[1]) * poly.t[j][1];
    u = Math.min(Math.max(u, 0), poly.L[j]);
    const d = hyp2(p[0] - v[0] - poly.t[j][0] * u, p[1] - v[1] - poly.t[j][1] * u);
    if (d < best - 1e-12) { best = d; S = poly.cum[j] + u; }
  }
  return S;
}

/** Corner extension e_j = h·tan(θ_j/2) at every vertex (θ_j = turning angle at vertex j). */
function extensions(poly: Poly, h: number): number[] {
  const K = poly.V.length;
  const e: number[] = [];
  for (let j = 0; j < K; j++) {
    const a = poly.t[(j + K - 1) % K], b = poly.t[j];
    const cr = Math.abs(a[0] * b[1] - a[1] * b[0]);
    const dt = a[0] * b[0] + a[1] * b[1];
    e.push(1 + dt > 1e-12 ? (h * cr) / (1 + dt) : 0);
  }
  return e;
}

/** Mitred outward offset by h. Returns the new polygon and the extensions. */
export function offsetPoly(poly: Poly, h: number): { poly: Poly; e: number[] } {
  const K = poly.V.length;
  const V: P2[] = [];
  for (let j = 0; j < K; j++) {
    const a = poly.n[(j + K - 1) % K], b = poly.n[j];
    const d = 1 + a[0] * b[0] + a[1] * b[1];
    V.push([poly.V[j][0] + (h * (a[0] + b[0])) / d, poly.V[j][1] + (h * (a[1] + b[1])) / d]);
  }
  return { poly: makePoly(V), e: extensions(poly, h) };
}

/**
 * Arc-length S on `old` → arc-length on its offset `neu` (extensions e): the point moves along
 * the outward normal of its edge. A point exactly at a vertex belongs to the edge after it
 * (`end` false) or before it (`end` true).
 */
function project(old: Poly, neu: Poly, e: number[], S: number, end: boolean): number {
  const K = old.V.length;
  const s = norm(old, S);
  let j = edgeAt(old, s);
  let u = s - old.cum[j];
  if (end && u < 1e-9 * Math.max(1, old.P)) { j = (j + K - 1) % K; u = old.L[j]; }
  return neu.cum[j] + e[j] + u;
}

// ---------------------------------------------------------------------------------------------
// graph helpers
// ---------------------------------------------------------------------------------------------
const NON_COUNTING = new Set(['ch', 'slst', 'picot']);
function counts(g: Graph, i: number): boolean {
  const n = g.nodes[i];
  if (n.countsAs) return true;
  if (n.role === 'tch') return false;
  return !NON_COUNTING.has(n.type);
}
const keyOf = (a: Anchor): string => ('space' in a ? `s${a.space}` : a.part ? `n${a.node}:${a.part}` : `n${a.node}`);
function entryKey(e: Entry): string {
  if (e.kind === 'space') return `s${e.space}`;
  if (e.kind === 'rowEnd') return `n${e.node}:side`;
  if (e.kind === 'base') return `n${e.node}:base`;
  return `n${e.node}`;
}
function roundIds(g: Graph, r: number): number[] {
  const R = g.rounds[r];
  const out: number[] = [];
  if (R.first >= 0) for (let i = R.first; i <= R.last; i++) out.push(i);
  return out;
}

/** Minimal cyclic arc (positions in 0..m−1) covering the sorted positions `pos`. */
function cyclicArc(pos: number[], m: number): [number, number] {
  if (pos.length === 1) return [pos[0], pos[0]];
  let gapAt = pos.length - 1, gap = pos[0] + m - pos[pos.length - 1];
  for (let q = 0; q + 1 < pos.length; q++) {
    const d = pos[q + 1] - pos[q];
    if (d > gap) { gap = d; gapAt = q; }
  }
  return [pos[(gapAt + 1) % pos.length], pos[gapAt]];
}


/** Share of a corner entry on the previous curve: a node's own share, or the union of a space's chains'. */
function entryShare(g: Graph, key: string, sh: Map<number, Share>, P: number): Share | null {
  if (key.startsWith('s')) {
    const xs = g.spaces[Number(key.slice(1))].chains.filter((ch) => sh.has(ch)).map((ch) => sh.get(ch)!);
    if (!xs.length) return null;
    const ref = xs[0].lo;
    let lo = ref, hi = xs[0].hi;
    for (const x of xs.slice(1)) {
      const a = ref + wrapc(x.lo - ref, P);
      lo = Math.min(lo, a);
      hi = Math.max(hi, a + (x.hi - x.lo));
    }
    return { lo, hi };
  }
  return sh.get(Number(key.slice(1).split(':')[0])) ?? null;
}

// ---------------------------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------------------------
interface Share { lo: number; hi: number }
interface Acc { A: number; B: number; R: number }

export function buildOutline(g: Graph, wEff: ArrayLike<number>, w: ArrayLike<number>, h: ArrayLike<number>, chainNominal: number, tol: number): Outline | null {
  const out = buildLayout(g, wEff, w, h, chainNominal, tol);
  if (out) tchColumns(g, out, w, h);
  return out;
}

/**
 * Joining slip stitches (N9): a slip stitch of an outline round worked into a laid-out stitch of
 * its own round (the `join`) lies on that stitch, its own height away from it towards the node
 * before it (no reference cells: it is not a stitch-counting node; region none).
 *
 * Turning-chain columns (N8): a maximal run of turning chains (not counting) whose neighbours a
 * (before) and b (after) both have reference positions, b in a's round or the next, is a straight
 * column from a to b: its chains get reference positions evenly along it by course rest length, and
 * the run's course springs (a → first chain … last chain → b) are scaled by |Q_b − Q_a| / (their
 * summed width rest lengths). Without it, the 15.6 mm of yarn of a dc row's `ch 3` over a 12.35 mm
 * row bulges out of the fabric at every row end.
 */
function tchColumns(g: Graph, out: Outline, w: ArrayLike<number>, h: ArrayLike<number>) {
  const n = g.nodes.length;
  // a joining slip stitch of an outline round lies on the stitch it is worked into
  for (let i = 0; i < n; i++) {
    const nd = g.nodes[i];
    const k = out.roundKind[nd.round];
    if (nd.type !== 'slst' || out.has[i] || !(k === 'border' || k === 'polygon') || nd.into.length !== 1) continue;
    const a = nd.into[0];
    if (!('node' in a) || a.part || !out.has[a.node] || g.nodes[a.node].round !== nd.round) continue;
    // on the stitch it joins, its height away towards the stitch before it
    let ux = 0, uy = 0;
    if (i > 0 && out.has[i - 1]) {
      const dx = out.qx[i - 1] - out.qx[a.node], dy = out.qy[i - 1] - out.qy[a.node];
      const dd = hyp2(dx, dy);
      if (dd > 0) { const f = Math.min(h[i], dd) / dd; ux = f * dx; uy = f * dy; }
    }
    out.qx[i] = out.qx[a.node] + ux; out.qy[i] = out.qy[a.node] + uy; out.has[i] = 1;
  }
  const tch = (i: number) => g.nodes[i].type === 'ch' && g.nodes[i].role === 'tch' && !g.nodes[i].countsAs;
  let i = 0;
  while (i < n) {
    if (!tch(i)) { i++; continue; }
    let j = i;
    while (j + 1 < n && tch(j + 1)) j++;
    const a = i - 1, b = j + 1;
    if (a >= 0 && b < n && out.has[a] && out.has[b] && !out.has[i] && g.nodes[b].round >= g.nodes[a].round && g.nodes[b].round <= g.nodes[a].round + 1) {
      const D = hyp2(out.qx[b] - out.qx[a], out.qy[b] - out.qy[a]);
      let S = 0;
      for (let q = a; q < b; q++) S += 0.5 * (w[q] + w[q + 1]);
      if (S > 0) {
        const f = D / S;
        let cum = 0;
        for (let q = i; q <= j; q++) {
          cum += 0.5 * (w[q - 1] + w[q]);
          const t = cum / S;
          out.qx[q] = out.qx[a] + t * (out.qx[b] - out.qx[a]);
          out.qy[q] = out.qy[a] + t * (out.qy[b] - out.qy[a]);
          out.has[q] = 1;
          out.colScale[q] = f;
          out.region[q] = out.region[a] === 1 || out.region[b] === 1 ? 1 : 0;
        }
      }
    }
    i = j + 1;
  }
}

function buildLayout(g: Graph, wEff: ArrayLike<number>, w: ArrayLike<number>, h: ArrayLike<number>, chainNominal: number, tol: number): Outline | null {
  const n = g.nodes.length, nR = g.rounds.length;
  const out: Outline = {
    qx: new Float64Array(n).fill(NaN), qy: new Float64Array(n).fill(NaN), has: new Uint8Array(n), c: new Float64Array(n),
    S: new Float64Array(n).fill(NaN), roundKind: new Array(nR).fill(null), courses: new Map(), region: new Uint8Array(n),
    regionIndex: new Int16Array(n).fill(-1), body: null, base: null, K: 0, span: [], colScale: new Float64Array(n), lam: new Float64Array(n).fill(1),
  };
  // course contributions: counting nodes w_X, chains of a chain space of their round chain_nominal·w_ch
  const chsp = new Map<number, number>();
  for (const s of g.spaces) if (s.kind === 'chsp') for (const ch of s.chains) chsp.set(ch, s.round);
  for (let i = 0; i < n; i++) {
    if (counts(g, i)) out.c[i] = wEff[i];
    else if (chsp.get(i) === g.nodes[i].round) out.c[i] = chainNominal * w[i];
  }
  const set = (i: number, x: number, y: number) => { out.qx[i] = x; out.qy[i] = y; out.has[i] = 1; };
  const hbar = (r: number) => {
    const st = roundIds(g, r).filter((i) => counts(g, i));
    return st.length ? npMean(st.map((i) => h[i])) : 0;
  };

  let shares: Map<number, Share> | null = null;   // node shares on the previous outline curve
  const acc = new Map<string, Acc>();             // cumulative compliance per side / corner
  let prev: Poly | null = null;
  let r0 = -1;   // first round handled as an outline round
  let K = 0;

  // ---------------- rows (N8) ----------------
  const rowPiece = nR >= 2 && g.rounds[0].kind === 'foundation' && g.rounds[1].kind === 'row';
  if (rowPiece) {
    let last = 1;
    while (last + 1 < nR && g.rounds[last + 1].kind === 'row') last++;
    // foundation span: the chains under the first row
    const worked: number[] = [];
    for (const i of roundIds(g, 1)) {
      const nd = g.nodes[i];
      if (nd.type === 'ch' && !nd.countsAs) continue;
      for (const a of nd.into) if ('node' in a && !a.part && g.nodes[a.node].round === 0 && g.nodes[a.node].type === 'ch' && !g.nodes[a.node].countsAs) worked.push(a.node);
    }
    if (!worked.length) return null;
    // a chain space in a row sits over the stitches it skips: each of its chains takes the row's
    // mean stitch width (the blanket library's convention: a ch-1 sp in moss or mesh is a column)
    for (let r = 1; r <= last; r++) {
      const ids = roundIds(g, r);
      const st = ids.filter((i) => counts(g, i));
      if (!st.length) continue;
      const wr = npMean(st.map((i) => wEff[i]));
      for (const i of ids) if (!counts(g, i) && chsp.get(i) === r) out.c[i] = wr;
    }
    const lo = Math.min(...worked), hi = Math.max(...worked);
    const span: number[] = [];
    for (let i = lo; i <= hi; i++) if (g.nodes[i].type === 'ch') span.push(i);
    let C1 = 0;
    for (const i of roundIds(g, 1)) C1 += out.c[i];
    if (!(C1 > 0)) return null;
    const cs = C1 / span.length;
    span.forEach((i, k) => { out.c[i] = cs; set(i, cs * (k + 0.5), 0); });
    out.span = span;
    out.roundKind[0] = 'foundation';
    let course = new Set(span);
    let f = 1, ybase = 0;
    for (let r = 1; r <= last; r++) {
      const ids = roundIds(g, r);
      const s = new Float64Array(n);
      let cum = 0;
      for (const i of ids) { s[i] = cum + 0.5 * out.c[i]; cum += out.c[i]; }
      const pairs: [number, number][] = [];
      for (const i of ids) {
        if (!counts(g, i)) continue;
        const seen = new Set<number>();
        for (const a of g.nodes[i].into) if ('node' in a && !a.part && course.has(a.node) && !seen.has(a.node)) { seen.add(a.node); pairs.push([i, a.node]); }
      }
      if (!pairs.length) return null;
      let tot = 0, prevA: number | null = null;
      for (const i of ids) {
        if (!counts(g, i)) continue;
        const a0 = g.nodes[i].into.find((a) => 'node' in a && !a.part && course.has(a.node)) as { node: number } | undefined;
        if (!a0) continue;
        if (prevA !== null && prevA !== a0.node) tot += a0.node > prevA ? 1 : -1;
        prevA = a0.node;
      }
      f = f * (tot < 0 ? -1 : 1);
      const x0 = npMean(pairs.map(([i, p]) => out.qx[p] - f * s[i]));
      const hb = hbar(r);
      for (const i of ids) {
        if (!(out.c[i] > 0)) continue;
        set(i, x0 + f * s[i], ybase + (counts(g, i) ? h[i] : hb));
        out.region[i] = 1;
      }
      out.roundKind[r] = 'row';
      ybase += hb;
      course = new Set(ids.filter((i) => out.c[i] > 0));
    }
    for (const i of span) out.region[i] = 1;
    // body rectangle
    let xL = Infinity, xR = -Infinity;
    for (let i = 0; i < n; i++) if (out.has[i]) { xL = Math.min(xL, out.qx[i] - 0.5 * out.c[i]); xR = Math.max(xR, out.qx[i] + 0.5 * out.c[i]); }
    const lists = borderLists(g);
    const list = lists.get(last + 1);
    if (!list || g.rounds[last + 1]?.kind !== 'round') return out;
    const cornersE = list.filter((e) => e.corner);
    if (cornersE.length !== 4) return out;
    // vertices in list order: the rectangle corner nearest each corner entry
    const V: P2[] = cornersE.map((e) => {
      const i = (e as { node: number }).node;
      const y = e.kind === 'base' ? 0 : ybase;
      return [Math.abs(out.qx[i] - xL) <= Math.abs(out.qx[i] - xR) ? xL : xR, y];
    });
    const keyset = new Set(V.map((v) => `${v[0]},${v[1]}`));
    if (keyset.size !== 4 || !(xR > xL) || !(ybase > 0)) return out;
    const O0 = makePoly(V);
    out.body = O0;
    shares = new Map();
    for (const e of cornersE) {
      const i = (e as { node: number }).node;
      const y = e.kind === 'base' ? 0 : ybase;
      const a = locate(O0, [out.qx[i] - 0.5 * out.c[i], y]), b = locate(O0, [out.qx[i] + 0.5 * out.c[i], y]);
      const lo2 = a, hi2 = a + wrapc(b - a, O0.P);
      shares.set(i, { lo: Math.min(lo2, hi2), hi: Math.max(lo2, hi2) });
    }
    prev = O0;
    r0 = last + 1;
    K = 4;
    // border rounds: every following round with a corner list
    const cornerKeys = new Map<number, string[]>();
    cornerKeys.set(r0, cornersE.map(entryKey));
    for (let r = r0 + 1; r < nR && lists.has(r); r++) cornerKeys.set(r, lists.get(r)!.filter((e) => e.corner).map(entryKey));
    for (let r = r0; r < nR && cornerKeys.has(r); r++) {
      const res = outlineRound(g, out, r, 'border', cornerKeys.get(r)!, prev!, shares!, K, h, hbar(r), tol, acc);
      if (!res) break;
      prev = res.poly; shares = res.shares;
    }
    out.K = K;
    return out;
  }

  // ---------------- polygons from the centre (N10) ----------------
  const runs = polygonRuns(g, out.c, h);
  if (!runs) return null;
  const { first, last: lastR, n: nc, corners } = runs;
  // the round under the first polygon round: a regular n-gon of its own course length, its corner
  // entries' centres at the vertices, the rest of it piecewise linear between them
  const base = first - 1;
  const ids = roundIds(g, base);
  const s = new Map<number, number>();
  let C = 0;
  for (const i of ids) { s.set(i, C + 0.5 * out.c[i]); C += out.c[i]; }
  if (!(C > 0)) return null;
  const keys0 = corners.get(first)!;
  const centre = (key: string): number => {
    if (key.startsWith('s')) {
      const ch = g.spaces[Number(key.slice(1))].chains;
      return 0.5 * (s.get(ch[0])! - 0.5 * out.c[ch[0]] + s.get(ch[ch.length - 1])! + 0.5 * out.c[ch[ch.length - 1]]);
    }
    return s.get(Number(key.slice(1)))!;
  };
  const cs0 = keys0.map(centre);
  const Rc = C / (2 * nc * dsin(Math.PI / nc));
  const V: P2[] = [];
  for (let j = 0; j < nc; j++) {
    const th = (2 * Math.PI * j) / nc;
    V.push([Rc * dcos(th), Rc * dsin(th)]);
  }
  const O = makePoly(V);
  out.base = O;
  const side = O.P / nc;
  // own coordinate → arc-length: corner centre q at vertex q (cum_q), linear in between (cyclic)
  const mapBase = (x: number): number => {
    const xm = mod(x - cs0[0], C);
    for (let q = 0; q < nc; q++) {
      const a = mod(cs0[q] - cs0[0], C), b = q + 1 < nc ? mod(cs0[q + 1] - cs0[0], C) : C;
      if (xm >= a && (xm < b || q === nc - 1)) return mod(O.cum[q] + ((xm - a) / Math.max(b - a, 1e-12)) * side, O.P);
    }
    return 0;
  };
  shares = new Map();
  for (const i of ids) {
    if (!(out.c[i] > 0)) continue;
    const Si = mapBase(s.get(i)!);
    const a = mapBase(s.get(i)! - 0.5 * out.c[i]);
    const b = mapBase(s.get(i)! + 0.5 * out.c[i]);
    const lo2 = Si + wrapc(a - Si, O.P), hi2 = Si + wrapc(b - Si, O.P);
    shares.set(i, { lo: Math.min(lo2, hi2), hi: Math.max(lo2, hi2) });
    // the n-gon is where this round's tops are (the next round is worked into them): no height offset
    const p = pointAt(O, Si);
    set(i, p[0], p[1]);
    out.S[i] = norm(O, Si);
    out.region[i] = 1;
  }
  out.roundKind[base] = 'polybase';
  for (let r = 0; r < base; r++) for (const i of roundIds(g, r)) out.region[i] = 1;
  prev = O;
  for (let r = first; r <= lastR; r++) {
    const res = outlineRound(g, out, r, 'polygon', corners.get(r)!, prev, shares, nc, h, hbar(r), tol, acc);
    if (!res) break;
    prev = res.poly; shares = res.shares;
  }
  if (!out.courses.size) return null;
  out.K = nc;
  return out;
}

/**
 * One outline round: offset the previous curve, find the corner groups, map the round's nodes.
 * Returns null (and leaves the round alone) when the corners cannot be matched to the vertices.
 */
function outlineRound(
  g: Graph, out: Outline, r: number, kind: 'border' | 'polygon', keys: string[], prev: Poly, shares: Map<number, Share>, K: number,
  h: ArrayLike<number>, hb: number, tol: number, acc: Map<string, Acc>,
): { poly: Poly; shares: Map<number, Share> } | null {
  if (keys.length !== K || !(hb > 0)) return null;
  const ids = roundIds(g, r);
  const m = ids.length;
  if (!m) return null;
  // corner entries → shares on the previous curve → vertices
  const sh: Share[] = [];
  for (const k of keys) { const x = entryShare(g, k, shares, prev.P); if (!x) return null; sh.push(x); }
  const vtx = sh.map((x) => {
    const mid = 0.5 * (x.lo + x.hi);
    let best = 0, bd = Infinity;
    for (let j = 0; j < K; j++) { const d = Math.abs(wrapc(mid - prev.cum[j], prev.P)); if (d < bd - 1e-12) { bd = d; best = j; } }
    return best;
  });
  const d = K >= 2 && vtx[1] === (vtx[0] + K - 1) % K ? -1 : 1;
  for (let q = 0; q < K; q++) if (vtx[(q + 1) % K] !== (((vtx[q] + d) % K) + K) % K) return null;
  // corner groups: the minimal cyclic run of the round's nodes worked into each corner entry
  const groups: [number, number][] = [];
  for (const k of keys) {
    const ps: number[] = [];
    ids.forEach((i, q) => { if (g.nodes[i].into.some((a) => keyOf(a) === k)) ps.push(q); });
    if (!ps.length) return null;
    groups.push(cyclicArc(ps, m));
  }
  // rotate the round to start at the first group; groups must follow one another without overlap
  const start = groups[0][0];
  const rel = (q: number) => mod(q - start, m);
  const G = groups.map(([a, b]) => [rel(a), rel(b)] as [number, number]);
  for (let q = 0; q < K; q++) {
    if (G[q][1] < G[q][0]) return null;
    if (q + 1 < K && G[q + 1][0] <= G[q][1]) return null;
  }
  const order = ids.map((_, k) => ids[(start + k) % m]);
  const cumAt: number[] = [0];
  for (const i of order) cumAt.push(cumAt[cumAt.length - 1] + out.c[i]);
  const C = cumAt[m];
  if (!(C > 0)) return null;
  // new curve, corner sections
  const { poly, e } = offsetPoly(prev, hb);
  const P = poly.P;
  const secA: number[] = [], secB: number[] = [];
  for (let q = 0; q < K; q++) {
    const v = vtx[q];
    const cv = poly.cum[v];
    const a = cv + wrapc(project(prev, poly, e, sh[q].lo, false) - cv, P);
    const b = cv + wrapc(project(prev, poly, e, sh[q].hi, true) - cv, P);
    secA.push(Math.min(cv - e[v], a, b));
    secB.push(Math.max(cv + e[v], a, b));
  }
  // corner segments in own coordinate: the whole group, or — for a group with a chain space inside
  // it (the next round's corner, cornerTargets) — its core centred on that space, no longer than the
  // corner's section (a granny's `(3 dc, ch 2, 3 dc)`: the 3-dc halves lie along the sides)
  const core: [number, number][] = [];
  const kIn = new Map<number, number>();
  order.forEach((i, k) => kIn.set(i, k));
  for (let q = 0; q < K; q++) {
    const g0 = cumAt[G[q][0]], g1 = cumAt[G[q][1] + 1];
    const lo = order[G[q][0]], hi = order[G[q][1]];
    const inside = g.spaces.filter((sp) => sp.kind === 'chsp' && sp.round === r && sp.chains.length > 0
      && kIn.has(sp.chains[0]) && kIn.get(sp.chains[0])! > kIn.get(lo)! && kIn.get(sp.chains[sp.chains.length - 1])! < kIn.get(hi)!);
    const need = secB[q] - secA[q];
    if (inside.length && g1 - g0 > need) {
      const sp = inside[Math.floor((inside.length - 1) / 2)];
      const k0 = kIn.get(sp.chains[0])!, k1 = kIn.get(sp.chains[sp.chains.length - 1])!;
      const cen = 0.5 * (cumAt[k0] + cumAt[k1 + 1]);
      let c0 = cen - 0.5 * need;
      c0 = Math.min(Math.max(c0, g0), g1 - need);
      core.push([c0, c0 + need]);
    } else core.push([g0, g1]);
  }
  // segments in round order from the first corner's core: corner q, then the side to corner q+1
  type Seg = { s0: number; s1: number; len: number; region: number; index: number };
  const segs: Seg[] = [];
  let total = 0;
  const base0 = core[0][0];
  for (let q = 0; q < K; q++) {
    const cl = secB[q] - secA[q];
    segs.push({ s0: core[q][0], s1: core[q][1], len: cl, region: 3, index: vtx[q] });
    const nq = (q + 1) % K;
    const sl = d > 0 ? mod(secA[nq] - secB[q], P) : mod(secA[q] - secB[nq], P);
    const s1 = q + 1 < K ? core[nq][0] : base0 + C;
    if (s1 < core[q][1] - 1e-9) return null;
    segs.push({ s0: core[q][1], s1, len: sl, region: 2, index: d > 0 ? vtx[q] : vtx[nq] });
    total += cl + sl;
  }
  if (Math.abs(total - P) > 1e-6 * P) return null;
  const T0 = d > 0 ? secA[0] : secB[0];
  const segStart: number[] = [];
  let T = T0;
  for (const sg of segs) { segStart.push(T); T += d * sg.len; }
  /** own coordinate (cyclic, from the rotated start) → segment index */
  const segIdx = (x0: number): number => {
    const x = x0 < base0 - 1e-12 ? x0 + C : x0;
    for (let q = 0; q < segs.length; q++) if (x < segs[q].s1 - 1e-12) return q;
    return segs.length - 1;
  };
  const mapS = (x0: number, q = segIdx(x0)): number => {
    const x = x0 < base0 - 1e-12 ? x0 + C : x0;
    const sg = segs[q];
    const f = sg.s1 > sg.s0 ? (x - sg.s0) / (sg.s1 - sg.s0) : 0.5;
    return segStart[q] + d * f * sg.len;
  };
  const segOf = (x: number): Seg => segs[segIdx(x)];
  // cumulative compliance (N9): per side / corner, the natural excess A (own − section) accumulates
  // over the outline rounds; up to tol of the accumulated own length B is absorbed; a round's
  // course springs take its section plus the growth of the residual R this round
  const segLam = segs.map((sg) => {
    const own = sg.s1 - sg.s0;
    const key = `${sg.region}:${sg.index}`;
    const st = acc.get(key) ?? { A: 0, B: 0, R: 0 };
    st.A += own - sg.len;
    st.B += tol * own;
    const Rn = Math.sign(st.A) * Math.max(0, Math.abs(st.A) - st.B);
    const eff = sg.len + Rn - st.R;
    st.R = Rn;
    acc.set(key, st);
    return own > 0 ? Math.min(2, Math.max(0.5, eff / own)) : 1;
  });
  const newShares = new Map<number, Share>();
  order.forEach((i, k) => {
    if (!(out.c[i] > 0)) return;
    const sc = 0.5 * (cumAt[k] + cumAt[k + 1]);
    const qs = segIdx(sc);
    const Si = mapS(sc, qs);
    // the node's share: its own interval through the map (continuous across segment boundaries)
    const a = mapS(cumAt[k]), b = mapS(cumAt[k + 1] - 1e-9 * C);
    newShares.set(i, { lo: Math.min(a, b), hi: Math.max(a, b) });
    const p = pointAt(poly, Si), nn = normalAt(poly, Si);
    const dh = counts(g, i) ? h[i] - hb : 0;
    out.qx[i] = p[0] + dh * nn[0]; out.qy[i] = p[1] + dh * nn[1]; out.has[i] = 1;
    out.S[i] = norm(poly, Si);
    const sg = segOf(sc);
    out.region[i] = sg.region; out.regionIndex[i] = sg.index;
    out.lam[i] = segLam[segs.indexOf(sg)];
  });
  out.roundKind[r] = kind;
  // the round's order for measuring, from the first corner's core
  let k0 = 0;
  while (k0 < m && 0.5 * (cumAt[k0] + cumAt[k0 + 1]) < base0 - 1e-12) k0++;
  const order2 = [...order.slice(k0), ...order.slice(0, k0)];
  out.courses.set(r, { round: r, kind, poly, dir: d, h: hb, order: order2, segments: segs.map((sg) => ({ region: sg.region as 2 | 3, index: sg.index, own: sg.s1 - sg.s0, len: sg.len })), corners: keys.map((key, q) => ({ key, vertex: vtx[q], nodes: order.slice(G[q][0], G[q][1] + 1) })) });
  return { poly, shares: newShares };
}

// ---------------------------------------------------------------------------------------------
// polygon detection (N10)
// ---------------------------------------------------------------------------------------------
/** a polygon is built over several rounds: a single cornered round is lace (stitches in spaces) */
export const POLY_MIN_RUN = 2;

/**
 * The polygon rounds of a piece worked from the centre, from the shared corner detector
 * (core/flatness/corners.ts `detectPolygon`, the chart's and the corner rule's): from its first
 * cornered round (later, past any round whose stitches differ in height by more than 1.5× — a
 * squaring round makes corners from height, not increases), every following round that has the n
 * corner groups; at least POLY_MIN_RUN of them. Corner entries: the place each group is worked into.
 */
export function polygonRuns(g: Graph, c: ArrayLike<number>, h?: ArrayLike<number>): { first: number; last: number; n: number; corners: Map<number, string[]> } | null {
  void c;
  const info = detectPolygon(g);
  if (!info) return null;
  const n = info.n, nR = g.rounds.length;
  const groupsAt = new Map<number, number[][]>();
  /** the round's corner groups: the detector's, else carried from the round below (cornerTargets' rule) */
  const groupsOf = (k: number): number[][] | null => {
    if (groupsAt.has(k)) return groupsAt.get(k)!;
    let gs: number[][] | null = info.groups.get(k) ?? cornerGroups(g, k);
    if (gs.length !== n) {
      gs = null;
      const prev = k > 0 && k - 1 >= info.from ? groupsOf(k - 1) : null;
      const R = g.rounds[k];
      if (prev && R.first >= 0) {
        const out: number[][] = [];
        for (const ids of prev) {
          const lo = ids[0], hi = ids[ids.length - 1];
          const inside = g.spaces.filter((sp) => sp.round === k - 1 && sp.kind === 'chsp' && sp.chains.length > 0 && sp.chains[0] > lo && sp.chains[sp.chains.length - 1] < hi);
          const key = inside.length ? `s${inside[Math.floor((inside.length - 1) / 2)].id}` : `n${ids[Math.floor(ids.length / 2)]}`;
          const mine: number[] = [];
          for (let id = R.first; id <= R.last; id++) if (counts(g, id) && g.nodes[id].into.some((a) => keyOf(a) === key)) mine.push(id);
          if (!mine.length) { out.length = 0; break; }
          out.push(mine);
        }
        if (out.length === n) gs = out;
      }
    }
    if (gs) groupsAt.set(k, gs);
    return gs;
  };
  const keysOf = (k: number): string[] | null => {
    const groups = groupsOf(k);
    return groups ? groups.map((ids) => keyOf(g.nodes[ids[0]].into[0])) : null;
  };
  let first = info.from;
  while (first < nR && (first < 1 || (h && !evenHeights(g, first, h)) || !keysOf(first))) first++;
  const corners = new Map<number, string[]>();
  let last = first - 1;
  for (let k = first; k < nR; k++) {
    if (h && !evenHeights(g, k, h)) break;
    const ks = keysOf(k);
    if (!ks) break;
    corners.set(k, ks);
    last = k;
  }
  if (last - first + 1 < POLY_MIN_RUN) return null;
  return { first, last, n, corners };
}

/** No counting node of round r is more than 1.5× as tall as another (not a squaring round). */
export function evenHeights(g: Graph, r: number, h: ArrayLike<number>): boolean {
  let lo = Infinity, hi = 0;
  for (const i of roundIds(g, r)) if (counts(g, i)) { lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]); }
  return !(hi > 1.5 * lo);
}

/**
 * Pins for blocking an outline piece (viewer, physics.md §6 explicit pins): the outermost outline
 * round's stitches (and chain-space chains) at their reference positions — a border pinned to its
 * reference rectangle, a polygon to its polygon; a piece of rows alone: its perimeter (the last
 * row, the first and last stitch of every row, the foundation span). Null without an outline.
 */
export function outlinePins(net: { nNodes: number; graph: Graph; outline: Outline | null }): { node: number; x: number; y: number }[] | null {
  const o = net.outline;
  if (!o) return null;
  const rounds = [...o.courses.keys()].sort((a, b) => a - b);
  const ids: number[] = [];
  if (rounds.length) {
    for (const i of o.courses.get(rounds[rounds.length - 1])!.order) if (o.has[i] && o.c[i] > 0) ids.push(i);
  } else {
    const rows = o.roundKind.map((k, r) => (k === 'row' ? r : -1)).filter((r) => r >= 0);
    const set = new Set<number>(o.span);
    rows.forEach((r, k) => {
      const st = roundIds(net.graph, r).filter((i) => o.has[i] && o.c[i] > 0);
      if (!st.length) return;
      if (k === rows.length - 1) for (const i of st) set.add(i);
      set.add(st[0]); set.add(st[st.length - 1]);
    });
    ids.push(...[...set].sort((a, b) => a - b));
  }
  return ids.map((i) => ({ node: i, x: o.qx[i], y: o.qy[i] }));
}
