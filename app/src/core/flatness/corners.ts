/**
 * Corner structure of a piece, from the graph alone (pure):
 *
 *  - `cornerGroups(graph, k)`: the corner groups of round k — the stitches worked into one place
 *    that make a corner: a group with a chain space inside it ("(3 dc, ch 2, 3 dc) in next ch-2 sp",
 *    "(cl, ch 3, cl) in sp") or, when the round has none, the largest groups of three or more
 *    stitches in one place ("3 sc in next st", "5 dc in sp") when every other group is smaller.
 *    Two stitches in one place (an increase) never make a corner.
 *  - `detectPolygon(graph)`: a piece worked from the centre is drawn as a polygon when its corners
 *    are unambiguous: n corner groups (3 ≤ n ≤ 8), evenly spaced, in at least two rounds, with
 *    sides between them, in the last round and in most rounds from the first cornered one on.
 *    Circles (increases spread or staggered, two per place), doilies (no sides between the groups)
 *    and snowflakes (the last round is arms) stay circles.
 *  - `detectStadium(graph)`: a piece worked round both sides of a foundation chain.
 */
import type { Anchor, Graph, Node } from '../graph';
import { anchorId, borderListsCached, nodeCounts } from '../graph/targets';

export interface PolygonInfo {
  n: number;
  /** First round drawn as a polygon. */
  from: number;
  /** Corner groups (node ids, working order) per round, for the rounds that have n of them. */
  groups: Map<number, number[][]>;
  /** a rectangle worked round a foundation chain (`detectStadiumRectangle`), not a regular n-gon */
  stadium?: boolean;
}

/** One anchor shared by every leg of a node (a cluster in one place counts), or null. */
function soleAnchor(n: Node): Anchor | null {
  if (!n.into.length) return null;
  const k = anchorId(n.into[0]);
  for (const a of n.into) if (anchorId(a) !== k) return null;
  return n.into[0];
}

/** Groups of stitch-counting nodes of round k worked into one place (working order), with the round's chain spaces. */
function groupsOf(g: Graph, k: number): { key: string; ids: number[]; chainInside: boolean }[] {
  const R = g.rounds[k];
  if (!R || R.first < 0) return [];
  const by = new Map<string, number[]>();
  const order: string[] = [];
  for (let id = R.first; id <= R.last; id++) {
    const n = g.nodes[id];
    if (!nodeCounts(n) || n.type === 'slst' || n.type === 'ch') continue;
    const a = soleAnchor(n);
    if (!a) continue;
    if ('space' in a) { if (g.spaces[a.space]?.kind === 'ring') continue; }
    else if (g.nodes[a.node]?.round === k) continue;
    const key = anchorId(a);
    let l = by.get(key);
    if (!l) { l = []; by.set(key, l); order.push(key); }
    l.push(id);
  }
  const spaces = g.spaces.filter((s) => s.round === k && s.kind === 'chsp' && s.chains.length);
  return order.map((key) => {
    const ids = by.get(key)!;
    const lo = ids[0], hi = ids[ids.length - 1];
    const chainInside = ids.length >= 2 && spaces.some((s) => s.chains[0] > lo && s.chains[s.chains.length - 1] < hi);
    return { key, ids, chainInside };
  });
}

/** Corner groups of round k (see the module comment); [] when the round has none. */
export function cornerGroups(g: Graph, k: number): number[][] {
  const gs = groupsOf(g, k);
  const A = gs.filter((x) => x.chainInside);
  if (A.length) return A.map((x) => x.ids);
  let max = 0;
  for (const x of gs) max = Math.max(max, x.ids.length);
  if (max < 3) return [];
  const top = gs.filter((x) => x.ids.length === max);
  return top.map((x) => x.ids);
}

/** Corner groups evenly spaced round the round (by stitch count), and stitches between them. */
function evenWithSides(g: Graph, k: number, groups: number[][]): boolean {
  const n = groups.length;
  const R = g.rounds[k];
  const counting: number[] = [];
  for (let id = R.first; id <= R.last; id++) { const m = g.nodes[id]; if (nodeCounts(m) && m.type !== 'slst' && m.type !== 'ch') counting.push(id); }
  const total = counting.length;
  if (!total) return false;
  const inGroup = new Set(groups.flat());
  if (total - inGroup.size < n) return false; // no sides
  const at = new Map(counting.map((id, i) => [id, i] as [number, number]));
  const mid = groups.map((ids) => ((at.get(ids[0]) ?? 0) + (at.get(ids[ids.length - 1]) ?? 0)) / 2).sort((a, b) => a - b);
  const want = total / n;
  for (let j = 0; j < n; j++) {
    const gap = j + 1 < n ? mid[j + 1] - mid[j] : mid[0] + total - mid[n - 1];
    if (Math.abs(gap - want) > Math.max(1.5, 0.3 * want)) return false;
  }
  return true;
}

/** A piece worked round both sides of a foundation chain (an oval / a rectangle in the round). */
export function detectStadium(g: Graph): boolean {
  const R0 = g.rounds[0], R1 = g.rounds[1];
  if (!R0 || !R1 || R0.first < 0 || R1.first < 0) return false;
  if (g.rounds.some((r) => r.kind === 'row')) return false;
  for (let id = R0.first; id <= R0.last; id++) if (g.nodes[id].type !== 'ch') return false;
  if (g.spaces.some((s) => s.kind === 'ring')) return false;
  for (let id = R1.first; id <= R1.last; id++) for (const a of g.nodes[id].into) if ('node' in a && a.part === 'base' && g.nodes[a.node]?.round === 0) return true;
  return false;
}

/** Polygon worked from the centre, or null (see the module comment). */
export function detectPolygon(g: Graph): PolygonInfo | null {
  const rounds = g.rounds;
  if (rounds.length < 3 || rounds.some((r) => r.kind === 'row')) return null;
  if (detectStadium(g)) return null;
  const per: (number[][] | null)[] = rounds.map((R, k) => {
    if (k === 0 || R.first < 0 || R.kind !== 'round') return null;
    const cg = cornerGroups(g, k);
    if (cg.length < 3 || cg.length > 8) return null;
    return evenWithSides(g, k, cg) ? cg : null;
  });
  const last = rounds.length - 1;
  const nLast = per[last]?.length ?? 0;
  if (!nLast) return null;
  const n = nLast;
  const ks = per.map((c, k) => (c && c.length === n ? k : -1)).filter((k) => k >= 0);
  if (ks.length < 2) return null;
  let from = ks[0];
  // most rounds from the first cornered one on have the n corners, no two missing in a row
  const span = last - from + 1;
  if (ks.length < 0.6 * span) return null;
  for (let k = from; k + 1 <= last; k++) if (!ks.includes(k) && !ks.includes(k + 1)) return null;
  // earlier rounds that are all corners (a granny square's round 2: corner groups only) start the polygon
  const allCorners = (k: number) => {
    if (k < 1 || rounds[k].kind !== 'round') return false;
    const cg = cornerGroups(g, k);
    return cg.length === n;
  };
  while (from - 1 >= 1 && allCorners(from - 1)) { from--; ks.unshift(from); }
  const groups = new Map<number, number[][]>();
  for (const k of ks) groups.set(k, per[k] ?? cornerGroups(g, k));
  return { n, from, groups };
}

/**
 * Border rounds of a piece worked in rows (notation.md 3.9): for each round worked into a list with
 * corners, the node ids worked into each corner (working order).
 */
export function borderCornerGroups(g: Graph): Map<number, number[][]> {
  const out = new Map<number, number[][]>();
  for (const [r, list] of borderListsCached(g)) {
    const keys = new Set<string>();
    for (const e of list) {
      if (!e.corner) continue;
      keys.add(e.kind === 'space' ? `s${e.space}` : e.kind === 'rowEnd' ? `n${e.node}:side` : e.kind === 'base' ? `n${e.node}:base` : `n${e.node}`);
    }
    const R = g.rounds[r];
    const by = new Map<string, number[]>();
    for (let id = R.first; id >= 0 && id <= R.last; id++) {
      const n = g.nodes[id];
      if (n.type === 'slst' || !n.into.length) continue;
      const k = anchorId(n.into[0]);
      if (!keys.has(k)) continue;
      let l = by.get(k);
      if (!l) { l = []; by.set(k, l); }
      l.push(id);
    }
    out.set(r, [...by.values()]);
  }
  return out;
}

/**
 * A rectangle worked in the round both sides of a foundation chain (a stadium, `detectStadium`)
 * whose rounds have four corner groups with sides between them — in the last round and in most
 * rounds from the first cornered one on. Its corners need not be evenly spaced (the long sides are
 * longer). An oval (increases spread round the ends) is not one. Used by the flatness check only:
 * the chart draws stadiums from the chain.
 */
export function detectStadiumRectangle(g: Graph): PolygonInfo | null {
  if (!detectStadium(g)) return null;
  const rounds = g.rounds;
  const four = (k: number): number[][] | null => {
    const R = rounds[k];
    if (k < 1 || !R || R.first < 0 || R.kind !== 'round') return null;
    const cg = cornerGroups(g, k);
    if (cg.length !== 4) return null;
    let total = 0;
    for (let id = R.first; id <= R.last; id++) { const m = g.nodes[id]; if (nodeCounts(m) && m.type !== 'slst' && m.type !== 'ch') total++; }
    return total - new Set(cg.flat()).size >= 4 ? cg : null;
  };
  const per = rounds.map((_R, k) => four(k));
  const last = rounds.length - 1;
  if (!per[last]) return null;
  const ks = per.map((c, k) => (c ? k : -1)).filter((k) => k >= 0);
  if (ks.length < 2 || ks.length < 0.6 * (last - ks[0] + 1)) return null;
  const groups = new Map<number, number[][]>();
  for (const k of ks) groups.set(k, per[k]!);
  return { n: 4, from: ks[0], groups, stadium: true };
}
