/**
 * The spring network of spec/physics.md §1–3 as amended by lab/SPEC_NOTES.md (C1–C5, N1–N7):
 * a line-by-line port of `lab/src/crolab/network.py` (`variant="metric"`).
 *
 * Particle indexing (C5): particle i < nNodes is node i (the top of the stitch); particles
 * nNodes.. are the virtual particles of the magic rings, in increasing space id.
 *
 * Parity with the lab is enforced by network.test.ts against spec/fixtures/<name>.network.json
 * (written by `python -m crolab.export_network`).
 */
import type { Graph, Node, Pattern } from '../graph';
import { analyzeFlatness } from '../flatness';
import { simConfig as defaultConfig, type ParamSet, type SimConfig } from '../params';
import { hyp, sq } from './lbfgs';
import { dsin, npMean } from './detmath';
import { armBases, findPointedLoops, findSpines, type PointedLoop, type Spine } from './spine';

export const COURSE = 0, WALE = 1, SHEAR = 2, BEND_COURSE = 3, BEND_WALE = 4;
export type SpringKind = 0 | 1 | 2 | 3 | 4;
export const KIND_NAMES = ['course', 'wale', 'shear', 'bend_course', 'bend_wale'] as const;

export interface Spring { i: number; j: number; L: number; k: number; kind: SpringKind; slack: boolean }

export interface Network {
  nNodes: number;
  nParticles: number;
  /** Number of springs. */
  m: number;
  /** Springs in generation order (lab order), i < j. Typed-array views of the same data below. */
  I: Int32Array; J: Int32Array; L: Float64Array; k: Float64Array; kind: Uint8Array;
  /** 1 = tension-only spring (N4). */
  slack: Uint8Array;
  /** The same springs as plain objects, in generation order (i < j). */
  springs: Spring[];
  /** Round per particle (virtual ring particles: the ring's round). */
  particleRound: Int32Array;
  /** virtual particle -> magic ring space id, and back. */
  virtualSpace: Map<number, number>;
  spaceParticle: Map<number, number>;
  /** Per node: distinct anchor particles in leg order. */
  anchors: number[][];
  /** Course width / effective height per node. */
  width: Float64Array;
  height: Float64Array;
  graph: Graph;
  params: ParamSet;
  /** Spines (chains with stitches worked back along them), SPEC_NOTES N5. */
  spines: Spine[];
  /** Pointed loops (`ch ≥ 4, picot, ch ≥ 4` off one stitch, nothing worked into them), SPEC_NOTES N6. */
  pointedLoops: PointedLoop[];
}

/** Plain-object view of the springs (for tests and debugging). */
export function springsOf(net: Network): Spring[] {
  const out: Spring[] = [];
  for (let s = 0; s < net.m; s++) {
    out.push({ i: net.I[s], j: net.J[s], L: net.L[s], k: net.k[s], kind: net.kind[s] as SpringKind, slack: net.slack[s] === 1 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// graph helpers (mirror crolab.graph.Graph)
// ---------------------------------------------------------------------------------------------
const NON_COUNTING = new Set(['ch', 'slst', 'picot']);

export function countsAsStitch(n: Node): boolean {
  if (n.countsAs) return true;
  if (n.role === 'tch') return false;
  return !NON_COUNTING.has(n.type);
}
export const effectiveType = (n: Node): string => n.countsAs ?? n.type;
export function roundNodeIds(g: Graph, r: number): number[] {
  const rd = g.rounds[r];
  if (!rd || rd.first < 0) return [];
  const out: number[] = [];
  for (let i = rd.first; i <= rd.last; i++) out.push(i);
  return out;
}
/** Distinct nodes anchored in space s, in working order. */
export function nodesInSpace(g: Graph, s: number): number[] {
  const out: number[] = [];
  for (const n of g.nodes) if (n.into.some((a) => 'space' in a && a.space === s)) out.push(n.id);
  return out;
}
export const isMagicRing = (g: Graph, s: number) => g.spaces[s].kind === 'ring' && g.spaces[s].chains.length === 0;

function param(set: ParamSet, t: string, key: 'width' | 'height' | 'stiffness'): number {
  const p = set.stitches[t];
  if (!p) throw new Error(`stitch parameter set ${set.id} has no '${t}'`);
  return p[key];
}

/**
 * Seam slip stitches of arm spaces (SPEC_NOTES N7): a chain space that carries an arm (a member is
 * the base of a spine or of a pointed loop) and whose first member is a slip stitch that starts its
 * round (only slip stitches before it in the round: `sl st in next ch-2 sp, ch 1, (sc, <arm>, sc) in
 * same sp`). Returns that slip stitch per space. In such a space the slip stitch takes no share of
 * the chains: the other members are distributed as if it were not there, and it attaches to the
 * chain of the first of them (it only carries the hook to where the round's first stitch is made;
 * stitches worked into a space slide along the loop, so the arm sits where it sits in every repeat).
 */
export function seamSlipStitches(g: Graph, bases: Set<number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of g.spaces) {
    if (s.kind !== 'chsp') continue;
    const mem = nodesInSpace(g, s.id);
    if (mem.length < 2 || !mem.some((v) => bases.has(v))) continue;
    const f = mem[0], nd = g.nodes[f];
    if (nd.type !== 'slst') continue;
    const rd = g.rounds[nd.round];
    let lead = true;
    for (let i = rd.first; i < f; i++) if (g.nodes[i].type !== 'slst') lead = false;
    if (lead) out.set(s.id, f);
  }
  return out;
}

export function resolveAnchorParticles(g: Graph, spaceParticle: Map<number, number>, seam: Map<number, number> = new Map()): number[][] {
  const orderInSpace = new Map<number, Map<number, number>>();
  for (const s of g.spaces) {
    const m = new Map<number, number>();
    // N7: a seam slip stitch of an arm space takes no share; it attaches where the first other member does
    const sl = seam.get(s.id);
    nodesInSpace(g, s.id).filter((v) => v !== sl).forEach((nid, idx) => m.set(nid, idx + 1));
    orderInSpace.set(s.id, m);
  }
  const out: number[][] = [];
  for (const nd of g.nodes) {
    const ps: number[] = [];
    for (const a of nd.into) {
      let p: number;
      if ('node' in a) p = a.node;
      else {
        const s = a.space;
        const sp = g.spaces[s];
        const chains = sp.chains;
        const ord = orderInSpace.get(s)!;
        const m = ord.size;
        const jj = ord.get(nd.id) ?? 1;   // N7: the seam slip stitch goes where the first other member goes
        if (sp.kind === 'ring' && chains.length === 0) p = spaceParticle.get(s)!;
        else if (sp.kind === 'ring') {
          const n = chains.length;
          const q = Math.floor(((jj - 1) * n) / m) + 1;
          p = chains[q - 1];
        } else {
          const n = chains.length;
          let q = Math.floor((jj * (n + 1)) / (m + 1) + 0.5);
          q = Math.min(Math.max(q, 1), n);
          p = chains[q - 1];
        }
      }
      if (!ps.includes(p)) ps.push(p);
    }
    out.push(ps);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// reference ("prescribed metric") geometry — SPEC_NOTES N1
// ---------------------------------------------------------------------------------------------
/** Course key: round r → r; chain ring of space s → nRounds + s. */
interface CourseGroups {
  group: Int32Array;
  isRing: (key: number) => boolean;
  u: Float64Array;
  C: Map<number, number>;
  closed: Map<number, boolean>;
  rhoG: Map<number, number>;
  Cnode: Float64Array;
}

const TAU = 2 * Math.PI;

function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return xs.length ? s / xs.length : NaN;
}

function courseGroups(g: Graph, w: Float64Array, wEff: Float64Array, h: Float64Array, cfg: SimConfig, params: ParamSet): CourseGroups {
  const n = g.nodes.length;
  const nR = g.rounds.length;
  const cn = cfg.flatness?.chain_nominal ?? 0.85;
  const smin = cfg.flatness?.chain_slack_min ?? 0.3;
  const flRound = new Map<number, { cls: string; cMin: number; cMax: number; rho: number; r: number }>();
  if (g.spaces.some((sp) => sp.kind === 'chsp')) {
    const rep = analyzeFlatness(g, params, { tol: cfg.flatness?.tol, chainSlackMin: cfg.flatness?.chain_slack_min, chainNominal: cfg.flatness?.chain_nominal });
    for (const row of rep.rounds) flRound.set(row.round, { cls: row.class, cMin: row.cMin, cMax: row.cMax, rho: row.rho, r: row.r });
  }
  const chainFrac = new Map<number, number>();
  for (const [r, row] of flRound) {
    if (row.cls === 'n/a' || row.cMax <= row.cMin) continue;
    const sumSt = row.cMin - (smin * (row.cMax - row.cMin)) / (1 - smin);
    const sumCh = (row.cMax - row.cMin) / (1 - smin);
    const f = (TAU * row.rho - sumSt) / sumCh;
    chainFrac.set(r, Math.min(1, Math.max(smin, f)));
  }
  const ringChain = new Map<number, number>();
  for (const s of g.spaces) if (s.kind === 'ring') for (const ch of s.chains) ringChain.set(ch, s.id);
  const chainSpace = new Map<number, number>();
  for (const s of g.spaces) for (const ch of s.chains) chainSpace.set(ch, s.id);

  const group = new Int32Array(n);
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const nd = g.nodes[i];
    if (ringChain.has(i)) { group[i] = nR + ringChain.get(i)!; c[i] = w[i]; continue; }
    const r = nd.round;
    group[i] = r;
    if (countsAsStitch(nd)) c[i] = wEff[i];
    else if (chainSpace.has(i) && g.spaces[chainSpace.get(i)!].kind === 'chsp' && g.spaces[chainSpace.get(i)!].round === r) {
      c[i] = (chainFrac.has(r) ? chainFrac.get(r)! : cn) * w[i];
    }
  }
  const cum = new Map<number, number>();
  const u = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const key = group[i];
    const s0 = cum.get(key) ?? 0;
    u[i] = s0 + 0.5 * c[i];
    cum.set(key, s0 + c[i]);
  }
  const C = new Map(cum);
  for (let i = 0; i < n; i++) { const Cg = C.get(group[i])!; u[i] = Cg > 0 ? u[i] / Cg : 0; }
  const isRing = (key: number) => key >= nR;
  const closed = new Map<number, boolean>();
  for (const key of C.keys()) closed.set(key, isRing(key) || g.rounds[key].kind === 'round');
  const rhoG = geodesicRadii(g, C, h, closed, isRing, nR);
  const Cnode = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    Cnode[i] = C.get(group[i])!;
    const r = g.nodes[i].round;
    if (c[i] > 0 && !countsAsStitch(g.nodes[i]) && !isRing(group[i]) && flRound.has(r)) {
      const row = flRound.get(r)!;
      Cnode[i] += TAU * (row.r - row.rho);
    }
  }
  return { group, isRing, u, C, closed, rhoG, Cnode };
}

function geodesicRadii(g: Graph, C: Map<number, number>, h: Float64Array, closed: Map<number, boolean>,
  isRing: (k: number) => boolean, nR: number): Map<number, number> {
  const hb: number[] = [];
  for (let r = 0; r < nR; r++) {
    const st = roundNodeIds(g, r).filter((i) => countsAsStitch(g.nodes[i]));
    hb.push(st.length ? npMean(st.map((i) => h[i])) : 0);
  }
  const rr: number[] = [];
  for (let r = 0; r < nR; r++) if (closed.get(r) && (C.get(r) ?? 0) > 0) rr.push(r);
  const out = new Map<number, number>();
  for (const [key, Ck] of C) if (isRing(key)) out.set(key, Ck / TAU);
  rr.forEach((r, idx) => {
    const Cr = C.get(r)!;
    const intoRing = roundNodeIds(g, r).some((i) => countsAsStitch(g.nodes[i])
      && g.nodes[i].into.some((a) => 'space' in a && isMagicRing(g, a.space)));
    if (intoRing || rr.length === 1) { out.set(r, Cr / TAU); return; }
    const lo = idx > 0 ? rr[idx - 1] : r;
    const hi = idx + 1 < rr.length ? rr[idx + 1] : r;
    const dC = C.get(hi)! - C.get(lo)!;
    const dr = (hi !== r ? hb[hi] : 0) + (lo !== r ? hb[r] : 0);
    const slope = dr > 0 ? dC / dr : 0;
    out.set(r, Math.abs(slope) > 1e-9 ? Math.abs(Cr / slope) : Infinity);
  });
  return out;
}

const wrap = (x: number) => x - Math.floor(x + 0.5);

class Reference {
  readonly lace = new Set<number>();
  readonly counting: boolean[];
  readonly sigma = new Map<string, number>();
  readonly shift = new Map<string, number>();
  constructor(g: Graph, anchors: number[][], readonly cg: CourseGroups, n: number) {
    const G = cg.group;
    for (const s of g.spaces) if (s.kind === 'chsp') for (const ch of s.chains) this.lace.add(G[ch]);
    this.counting = g.nodes.map(countsAsStitch);
    const pairs = new Map<string, [number, number][]>();
    for (let i = 0; i < n; i++) {
      for (const a of anchors[i]) {
        if (a < n && G[a] !== G[i] && this.counting[i]) {
          const key = `${G[i]},${G[a]}`;
          if (!pairs.has(key)) pairs.set(key, []);
          pairs.get(key)!.push([i, a]);
        }
      }
    }
    for (const [key, lst] of pairs) {
      let tot = 0;
      let prev: number | null = null;
      const sorted = [...lst].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      for (const [i, a] of sorted) {
        if (anchors[i][0] !== a) continue;
        if (prev !== null && prev !== a) tot += a > prev ? 1 : -1;
        prev = a;
      }
      this.sigma.set(key, tot < 0 ? -1 : 1);
      this.shift.set(key, 0);
      const [gi, ga] = key.split(',').map(Number);
      this.shift.set(key, npMean(lst.map(([i, a]) => this.raw(i, a, gi, ga))));
    }
  }
  has(i: number, p: number): boolean {
    return this.counting[i] && this.sigma.has(`${this.cg.group[i]},${this.cg.group[p]}`);
  }
  private raw(i: number, p: number, gi: number, ga: number): number {
    const cg = this.cg;
    const v = this.sigma.get(`${gi},${ga}`)! > 0 ? cg.u[i] : 1 - cg.u[i];
    if (cg.closed.get(ga)) return wrap(v - cg.u[p]);
    return v * cg.C.get(gi)! - cg.u[p] * cg.C.get(ga)!;
  }
  offset(i: number, p: number): number {
    const gi = this.cg.group[i], ga = this.cg.group[p];
    const x = this.raw(i, p, gi, ga) - this.shift.get(`${gi},${ga}`)!;
    return this.cg.closed.get(ga) ? wrap(x) : x;
  }
  closedPair(i: number, p: number): boolean {
    return !!this.cg.closed.get(this.cg.group[i]) && !!this.cg.closed.get(this.cg.group[p]);
  }
  cell(i: number, p: number, h: number): number {
    const cg = this.cg;
    const x = this.offset(i, p);
    if (!this.closedPair(i, p)) return hyp(h, x);
    const Ct = cg.Cnode[i], Cb = cg.Cnode[p];
    const dC = Math.abs(Ct - Cb);
    if (dC < 1e-9 * Math.max(Ct, Cb)) return hyp(h, x * Ct);
    const rb = (h * Cb) / dC, rt = (h * Ct) / dC, alpha = dC / h;
    return Math.sqrt(h * h + 4 * rt * rb * sq(dsin(0.5 * alpha * x)));
  }
  waleBend(i: number, a: number, b: number, hi: number, ha: number): number {
    const cg = this.cg;
    const x = this.offset(i, a) + this.offset(a, b);
    const lat = this.closedPair(i, a) && this.closedPair(a, b) ? x * Math.sqrt(cg.Cnode[i] * cg.Cnode[b]) : x;
    return hyp(hi + ha, lat);
  }
}

/** Chord of an arc of length `arc` on a circle of radius R (R infinite, missing or <= 0: straight). */
export function circleChord(arc: number, R: number | undefined): number {
  if (R === undefined || !(R > 0 && R < Infinity)) return arc;
  const x = Math.min(arc / (2 * R), Math.PI / 2);
  return 2 * R * dsin(x);
}

// ---------------------------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------------------------
export function buildNetwork(input: Pattern | Graph, params: ParamSet, config: SimConfig = defaultConfig): Network {
  const g: Graph = 'graph' in input ? input.graph : input;
  const cfg = config;
  const n = g.nodes.length;
  const types = g.nodes.map((nd) => nd.type as string);
  const eff = g.nodes.map(effectiveType);
  const w = Float64Array.from(eff, (t) => param(params, t, 'width'));      // N2
  const wEff = Float64Array.from(eff, (t) => param(params, t, 'width'));
  const h = Float64Array.from(eff, (t) => param(params, t, 'height'));
  const sCourse = Float64Array.from(types, (t) => param(params, t, 'stiffness'));
  const sWale = Float64Array.from(eff, (t) => param(params, t, 'stiffness'));
  const counting = g.nodes.map(countsAsStitch);

  const spaceParticle = new Map<number, number>();
  const virtualSpace = new Map<number, number>();
  const prounds: number[] = g.nodes.map((nd) => nd.round);
  for (const s of g.spaces) {
    if (!isMagicRing(g, s.id)) continue;
    const p = n + spaceParticle.size;
    spaceParticle.set(s.id, p);
    virtualSpace.set(p, s.id);
    prounds.push(s.round);
  }
  const nParticles = n + spaceParticle.size;
  const pointedLoops = findPointedLoops(g, w);
  const anchors = resolveAnchorParticles(g, spaceParticle, seamSlipStitches(g, armBases(g, pointedLoops)));

  const ringLen = new Map<number, number>();
  for (const [s, p] of spaceParticle) {
    const members = nodesInSpace(g, s);
    if (members.length) ringLen.set(p, (members.length * npMean(members.map((i) => wEff[i]))) / TAU);
  }
  const Lc = (a: number, b: number) => 0.5 * (w[a] + w[b]);
  const tchChain = g.nodes.map((nd) => nd.role === 'tch' && !nd.countsAs);
  const chspChain = new Uint8Array(n);
  for (const sp of g.spaces) if (sp.kind === 'chsp') for (const ch of sp.chains) chspChain[ch] = 1;
  const cg = courseGroups(g, w, wEff, h, cfg, params);
  const ref = new Reference(g, anchors, cg, n);
  const G = cg.group;
  const seam = (a: number, b: number) => counting[a] && counting[b] && G[a] !== G[b] && ref.has(b, a);

  const gi: number[] = [], gj: number[] = [], gL: number[] = [], gk: number[] = [], gt: number[] = [];
  const push = (a: number, b: number, L: number, k: number, t: number) => { gi.push(a); gj.push(b); gL.push(L); gk.push(k); gt.push(t); };
  const kc = cfg.k_course, kw = cfg.k_wale, ks = cfg.k_shear, kb = cfg.k_bend;

  for (let i = 1; i < n; i++) {
    let L = Lc(i - 1, i);
    if (G[i - 1] === G[i] && cg.closed.get(G[i]) && !ref.lace.has(G[i])) L = circleChord(L, cg.rhoG.get(G[i]));
    else if (seam(i - 1, i)) L = ref.cell(i, i - 1, h[i]);
    push(i - 1, i, L, kc * Math.min(sCourse[i - 1], sCourse[i]), COURSE);
  }
  for (let i = 0; i < n; i++) {
    for (const p of anchors[i]) {
      let L: number;
      if (virtualSpace.has(p)) L = Math.max(h[i], ringLen.get(p) ?? 0);
      else L = ref.has(i, p) ? ref.cell(i, p, h[i]) : h[i];
      push(i, p, L, kw * sWale[i], WALE);
    }
  }
  for (let i = 0; i < n; i++) {
    if (!counting[i]) continue;                          // N3
    for (const a of anchors[i]) {
      if (a >= n || chspChain[a]) continue;              // N4
      for (const nb of [a - 1, a + 1]) {
        if (nb >= 0 && nb < n && prounds[nb] === prounds[a] && nb !== i && !(tchChain[nb] || chspChain[nb])) {
          const L = ref.has(i, a) && G[nb] === G[a] ? ref.cell(i, nb, h[i]) : hyp(h[i], Lc(a, nb));
          push(i, nb, L, ks * sWale[i], SHEAR);
        }
      }
    }
  }
  for (let i = 2; i < n; i++) {
    if (tchChain[i - 2] || tchChain[i - 1] || tchChain[i]) continue;
    const arc = Lc(i - 2, i - 1) + Lc(i - 1, i);
    const k1 = G[i - 1];
    const cont = G[i - 2] === k1 && k1 === G[i] && !!cg.closed.get(k1) && !ref.lace.has(k1);
    let L = cont ? circleChord(arc, cg.rhoG.get(k1)) : arc;
    if (!cont && seam(i - 2, i)) L = ref.cell(i, i - 2, h[i]);
    push(i - 2, i, L, kb, BEND_COURSE);
  }
  for (let i = 0; i < n; i++) {
    if (!anchors[i].length) continue;
    const a = anchors[i][0];
    if (a >= n || !anchors[a].length) continue;
    const b = anchors[a][0];
    if (b >= n || b === i) continue;
    let L = h[i] + h[a];
    if (ref.has(i, a) && ref.has(a, b)) L = ref.waleBend(i, a, b, h[i], h[a]);
    push(i, b, L, kb, BEND_WALE);
  }

  // N5: every spring between two nodes of one spine takes its rest length from the spine's flat
  // reference layout; course bends along the stem and along the return row get course stiffness
  const spines = findSpines(g, w, h, param(params, 'ch', 'width'));
  if (spines.length) {
    const owner = new Map<number, number>();
    const stem = new Set<number>(), ret = new Set<number>();
    spines.forEach((sp, si) => {
      for (const v of sp.pos.keys()) owner.set(v, si);
      for (const v of sp.stem) stem.add(v);
      for (const v of sp.ret) ret.add(v);
    });
    for (let idx = 0; idx < gi.length; idx++) {
      const a = gi[idx], b = gj[idx];
      const sa = owner.get(a), sb = owner.get(b);
      if (sa === undefined || sa !== sb) continue;
      const pa = spines[sa].pos.get(a)!, pb = spines[sa].pos.get(b)!;
      gL[idx] = hyp(pa[0] - pb[0], pa[1] - pb[1]);
      if (gt[idx] === BEND_COURSE) {
        const lo = Math.min(a, b);
        const trip = [lo, lo + 1, lo + 2];
        if (trip.every((v) => stem.has(v)) || trip.every((v) => ret.has(v))) gk[idx] = kc * Math.min(sCourse[lo], sCourse[lo + 1], sCourse[lo + 2]);
      }
    }
  }

  // N6: pointed loops are starched open loops: every spring between two nodes of one loop (its feet
  // included) takes its rest length from the loop's flat layout and is two-sided; course bends along
  // the loop get course stiffness
  const loopOwner = new Map<number, number>();
  if (pointedLoops.length) {
    pointedLoops.forEach((pl, li) => { for (const v of pl.pos.keys()) loopOwner.set(v, li); });
    for (let idx = 0; idx < gi.length; idx++) {
      const a = gi[idx], b = gj[idx];
      const la = loopOwner.get(a), lb = loopOwner.get(b);
      if (la === undefined || la !== lb) continue;
      const pa = pointedLoops[la].pos.get(a)!, pb = pointedLoops[la].pos.get(b)!;
      gL[idx] = hyp(pa[0] - pb[0], pa[1] - pb[1]);
      if (gt[idx] === BEND_COURSE) {
        const lo = Math.min(a, b);
        gk[idx] = kc * Math.min(sCourse[lo], sCourse[lo + 1], sCourse[lo + 2]);
      }
    }
  }

  // C4: duplicates keep the largest k; on a tie the first generated
  const best = new Map<number, number>();
  for (let idx = 0; idx < gi.length; idx++) {
    const a = gi[idx], b = gj[idx];
    if (a === b) continue;
    const key = Math.min(a, b) * nParticles + Math.max(a, b);
    const cur = best.get(key);
    if (cur === undefined || gk[idx] > gk[cur]) best.set(key, idx);
  }
  const keep = [...best.values()].sort((x, y) => x - y);
  const m = keep.length;
  const I = new Int32Array(m), J = new Int32Array(m), L = new Float64Array(m), K = new Float64Array(m);
  const kind = new Uint8Array(m), slack = new Uint8Array(m);
  keep.forEach((idx, s) => {
    const a = Math.min(gi[idx], gj[idx]), b = Math.max(gi[idx], gj[idx]);
    I[s] = a; J[s] = b; L[s] = gL[idx]; K[s] = gk[idx]; kind[s] = gt[idx];
    const lo = loopOwner.get(a);
    if ((gt[idx] === COURSE || gt[idx] === BEND_COURSE) && !(lo !== undefined && lo === loopOwner.get(b))) {
      for (let q = a; q <= b && q < n; q++) if (chspChain[q]) { slack[s] = 1; break; }
    }
  });
  const springs: Spring[] = [];
  for (let q = 0; q < m; q++) springs.push({ i: I[q], j: J[q], L: L[q], k: K[q], kind: kind[q] as SpringKind, slack: slack[q] === 1 });
  return {
    nNodes: n, nParticles, m, I, J, L, k: K, kind, slack, springs,
    particleRound: Int32Array.from(prounds), virtualSpace, spaceParticle, anchors,
    width: w, height: h, graph: g, params, spines, pointedLoops,
  };
}
