/**
 * Spines: chains with stitches worked back along them (lab/SPEC_NOTES.md N5, P7). A line-by-line
 * port of `lab/src/crolab/spine.py` — see its docstring for the exact definitions and layout.
 *
 * A snowflake arm (`ch 16, sl st in 4th ch from hook, sl st in next 3 ch, picot, picot, …`) is a
 * doubled cord: a stem of chains, a tip loop (the chains skipped at the hook end), return stitches
 * lying on the stem chains and picots sticking out at ±50° (±60° straight after the tip). Each spine
 * is laid out flat in its own frame (s outward along the stem from its base stitch, t sideways); the
 * network takes the rest length of every spring between two nodes of one spine from that layout.
 */
import type { Graph } from '../graph';
import { dcos, dsin } from './detmath';

export const BRANCH_ANGLE = (50 * Math.PI) / 180;
export const TIP_PICOT_ANGLE = (60 * Math.PI) / 180;

export interface Spine {
  base: number;
  stem: number[];
  tip: number[];
  ret: number[];
  picots: number[];
  /** node → [s, t] reference position in the spine frame (base at the origin). */
  pos: Map<number, [number, number]>;
  /** Spine nodes in increasing id. */
  nodes: number[];
}

export function findSpines(g: Graph, w: ArrayLike<number>, h: ArrayLike<number>, wCh: number): Spine[] {
  const n = g.nodes.length;
  const inSpace = new Set<number>();
  for (const s of g.spaces) for (const c of s.chains) inSpace.add(c);
  const free = (i: number) => {
    const nd = g.nodes[i];
    return nd.type === 'ch' && nd.role !== 'tch' && !nd.countsAs && !inSpace.has(i);
  };
  const recv = new Map<number, number[]>();
  for (const nd of g.nodes) {
    const i = nd.id;
    for (const a of nd.into) {
      if (!('node' in a)) continue;
      const c = a.node;
      if (c >= i || !free(c) || g.nodes[c].round !== nd.round) continue;
      const lst = recv.get(c) ?? [];
      if (!lst.includes(i)) lst.push(i);
      recv.set(c, lst);
    }
  }
  const Lc = (a: number, b: number) => 0.5 * (w[a] + w[b]);
  const out: Spine[] = [];
  let i = 0;
  while (i < n) {
    if (!free(i)) { i++; continue; }
    let j = i;
    while (j + 1 < n && free(j + 1) && g.nodes[j + 1].round === g.nodes[i].round) j++;
    const got: number[] = [];
    for (let c = i; c <= j; c++) if (recv.has(c)) got.push(c);
    if (got.length && i >= 1) {
      const q = got[got.length - 1];
      const stem: number[] = [], tip: number[] = [];
      for (let c = i; c <= q; c++) stem.push(c);
      for (let c = q + 1; c <= j; c++) tip.push(c);
      const rs = new Set<number>();
      for (const c of stem) for (const r of recv.get(c) ?? []) rs.add(r);
      const sp: Spine = { base: i - 1, stem, tip, ret: [...rs].sort((a, b) => a - b), picots: [], pos: new Map(), nodes: [] };
      layout(g, sp, h, wCh, Lc);
      sp.nodes = [...sp.pos.keys()].sort((a, b) => a - b);
      out.push(sp);
    }
    i = j + 1;
  }
  return out;
}

/**
 * Pointed loops (SPEC_NOTES N6): `ch ≥ 4, picot(s), ch ≥ 4` worked off one stitch — the two chain
 * runs are whole chain spaces of the same round (the picot splits them), nothing is worked into
 * either space or into their chains by any node, and the loop closes on the next node of the round
 * (`(sc, ch 10, ch-4 picot, ch 10, sc) in next sp`). `base` is the node before the first run,
 * `close` the node after the second.
 */
export interface PointedLoop {
  base: number;
  close: number;
  a: number[];
  picots: number[];
  b: number[];
  /** node → [s, t] reference position (base at the origin, +t towards `close`); includes base and close. */
  pos: Map<number, [number, number]>;
  /** a, picots, b in increasing id (base and close excluded). */
  nodes: number[];
}

/** Shortest chain run on either side of the picot of a pointed loop (the chart's LOOP_MIN). */
export const POINTED_LOOP_MIN = 4;

export function findPointedLoops(g: Graph, w: ArrayLike<number>): PointedLoop[] {
  const n = g.nodes.length;
  const spaceOf = new Map<number, number>();
  for (const s of g.spaces) if (s.kind === 'chsp') for (const c of s.chains) spaceOf.set(c, s.id);
  const used = new Set<number>();   // chains worked into, and spaces with members
  for (const nd of g.nodes) {
    for (const a of nd.into) {
      if ('node' in a) used.add(a.node);
      else used.add(-1 - a.space);
    }
  }
  const free = (s: number) => {
    const sp = g.spaces[s];
    return !used.has(-1 - s) && sp.chains.every((c) => !used.has(c) && g.nodes[c].role !== 'tch');
  };
  const out: PointedLoop[] = [];
  for (const s1 of g.spaces) {
    if (s1.kind !== 'chsp' || s1.chains.length < POINTED_LOOP_MIN || !free(s1.id)) continue;
    const a = s1.chains;
    const base = a[0] - 1;
    let p = a[a.length - 1] + 1;
    const picots: number[] = [];
    while (p < n && g.nodes[p].type === 'picot' && g.nodes[p].round === s1.round) picots.push(p++);
    if (!picots.length || p >= n || base < 0) continue;
    const s2 = spaceOf.get(p);
    if (s2 === undefined || g.spaces[s2].chains[0] !== p || g.spaces[s2].round !== s1.round) continue;
    const b = g.spaces[s2].chains;
    if (b.length < POINTED_LOOP_MIN || !free(s2)) continue;
    const close = b[b.length - 1] + 1;
    if (close >= n || g.nodes[close].round !== s1.round || g.nodes[base].round !== s1.round || g.nodes[base].type === 'ch' || g.nodes[close].type === 'ch') continue;
    out.push(pointedLoop(base, [...a], picots, [...b], close, w));
  }
  return out;
}

/**
 * N6 layout: the feet `base` (0, 0) and `close` (0, d), d = (w_base + w_close)/2 (two stitches
 * side by side); the path base → a → picots → b → close (course rest lengths, total S) folded into
 * an isosceles triangle with legs S/2: a node at path length l lies on the first leg at l/(S/2) of
 * the way to the apex (H, d/2), H = sqrt((S/2)² − (d/2)²), beyond S/2 on the second leg.
 */
export function pointedLoop(base: number, a: number[], picots: number[], b: number[], close: number, w: ArrayLike<number>): PointedLoop {
  const pl: PointedLoop = { base, close, a, picots, b, pos: new Map(), nodes: [...a, ...picots, ...b] };
  loopLayout(pl, w);
  return pl;
}

function loopLayout(pl: PointedLoop, w: ArrayLike<number>) {
  const path = [pl.base, ...pl.nodes, pl.close];
  const cum = [0];
  for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + 0.5 * (w[path[k - 1]] + w[path[k]]));
  const S = cum[cum.length - 1];
  const d = 0.5 * (w[pl.base] + w[pl.close]);
  const half = S / 2;
  const H = Math.sqrt(Math.max(0, half * half - 0.25 * d * d));
  path.forEach((v, k) => {
    const l = cum[k];
    if (l <= half) { const f = half > 0 ? l / half : 0; pl.pos.set(v, [f * H, f * 0.5 * d]); }
    else { const f = (S - l) / half; pl.pos.set(v, [f * H, d - f * 0.5 * d]); }
  });
}

/**
 * Bases of arms, from the graph alone: the node before a spine's first chain (N5: a run of free
 * chains with a return stitch) and the base of every pointed loop (N6). Used by the seam rule N7.
 */
export function armBases(g: Graph, loops: PointedLoop[]): Set<number> {
  const n = g.nodes.length;
  const inSpace = new Set<number>();
  for (const s of g.spaces) for (const c of s.chains) inSpace.add(c);
  const free = (i: number) => { const nd = g.nodes[i]; return nd.type === 'ch' && nd.role !== 'tch' && !nd.countsAs && !inSpace.has(i); };
  const out = new Set<number>(loops.map((l) => l.base));
  const back = new Set<number>();
  for (const nd of g.nodes) for (const a of nd.into) if ('node' in a && a.node < nd.id && free(a.node) && g.nodes[a.node].round === nd.round) back.add(a.node);
  let i = 0;
  while (i < n) {
    if (!free(i)) { i++; continue; }
    let j = i;
    while (j + 1 < n && free(j + 1) && g.nodes[j + 1].round === g.nodes[i].round) j++;
    let got = false;
    for (let c = i; c <= j; c++) if (back.has(c)) got = true;
    if (got && i >= 1) out.add(i - 1);
    i = j + 1;
  }
  return out;
}

function layout(g: Graph, sp: Spine, h: ArrayLike<number>, wCh: number, Lc: (a: number, b: number) => number) {
  const pos = sp.pos;
  let s = 0;
  let prev = sp.base;
  for (const c of sp.stem) { s += Lc(prev, c); pos.set(c, [s, 0]); prev = c; }
  const q = sp.stem[sp.stem.length - 1];
  const sq = pos.get(q)![0];
  const retset = new Set(sp.ret);
  const r1 = sp.tip.length ? sp.tip[sp.tip.length - 1] + 1 : -1;
  const closes = r1 >= 0 && retset.has(r1) && g.nodes[r1].into.some((a) => 'node' in a && a.node === q);
  if (sp.tip.length && closes) {
    const path = [q, ...sp.tip, r1];
    const seg: number[] = [];
    for (let k = 0; k + 1 < path.length; k++) seg.push(Lc(path[k], path[k + 1]));
    let P = 0;
    for (const x of seg) P += x;
    P += h[r1];
    const R = P / (2 * Math.PI);
    const half = h[r1] / (2 * R);
    const cs = sq + R * dcos(half);
    const ct = R * dsin(half);
    let x = 0;
    path.forEach((node, k) => {
      const ang = half + x / R;
      if (k === 0) pos.set(node, [sq, 0]);
      else pos.set(node, [cs - R * dcos(ang), ct - R * dsin(ang)]);
      if (k < seg.length) x += seg[k];
    });
    pos.set(r1, [sq, 2 * ct]);
  } else {
    let s2 = sq;
    let pv = q;
    for (const c of sp.tip) { s2 += Lc(pv, c); pos.set(c, [s2, 0]); pv = c; }
  }
  const stemSet = new Set(sp.stem);
  for (const r of sp.ret) {
    if (pos.has(r)) continue;
    const ss: number[] = [];
    for (const a of g.nodes[r].into) if ('node' in a && pos.has(a.node) && stemSet.has(a.node)) ss.push(pos.get(a.node)![0]);
    let sum = 0;
    for (const v of ss) sum += v;
    pos.set(r, [sum / ss.length, h[r]]);
  }
  const lo = sp.ret[0], hi = sp.ret[sp.ret.length - 1];
  let k = hi + 1;
  while (k < g.nodes.length && g.nodes[k].type === 'picot') k++;
  const picots: number[] = [];
  for (let p = lo + 1; p < k; p++) if (g.nodes[p].type === 'picot' && !pos.has(p)) picots.push(p);
  sp.picots = picots;
  const pset = new Set(picots);
  let run = 0;
  let base = -1;
  for (let p = lo; p < k; p++) {
    const nd = g.nodes[p];
    if (nd.type !== 'picot') {
      if (pos.has(p)) base = p;
      run = 0;
      continue;
    }
    if (base < 0 || !pset.has(p)) continue;
    const a = closes && base === r1 ? TIP_PICOT_ANGLE : BRANCH_ANGLE;
    const sign = run % 2 === 0 ? 1 : -1;
    const reach = ((nd.chains ?? 3) * wCh) / 2;
    const [bs, bt] = pos.get(base)!;
    pos.set(p, [bs + reach * dcos(a), bt + sign * reach * dsin(a)]);
    run++;
  }
}
