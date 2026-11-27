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
