/**
 * The target list of a finished round and the helpers that match units against it
 * (notation.md 3.3).
 *
 * A round exposes, in working order, every node that counts as a stitch (stitch target) and every
 * chain space it created (space target). Rings are not in the list (they are addressed with
 * `in ring`). The next round walks the list with a cursor; when that round is turned the list is
 * reversed first.
 */
import type { Unit } from '../notation/ast';
import { typeCounts } from '../notation/vocab';
import type { Anchor, Graph, Node, Round, Space } from './types';

/**
 * One entry of a target list. `corner` marks a corner of a border round's list (notation.md 3.9);
 * `side` is the side of the piece it lies on (perimeter lists: 0 top, 1 first side, 2 bottom,
 * 3 second side).
 */
export type Entry = (
  | { kind: 'stitch'; node: number }
  | { kind: 'space'; space: number }
  /** a row end: `node` is the edge stitch of the row on that side */
  | { kind: 'rowEnd'; node: number; row: number }
  /** an unused loop of the foundation chain */
  | { kind: 'base'; node: number }
) & { corner?: boolean; side?: number };

/** Does this node count as a stitch (and so is a target for the next round)? (3.3 / 3.8) */
export function nodeCounts(n: Node): boolean {
  if (n.type === 'ch') return n.countsAs !== undefined;
  return typeCounts(n.type);
}

/** Target list of round `r` in that round's working order. */
export function buildTargets(nodes: readonly Node[], spaces: readonly Space[], r: number, first: number, last: number): Entry[] {
  const items: { pos: number; e: Entry }[] = [];
  if (first >= 0) {
    for (let id = first; id <= last; id++) {
      if (nodeCounts(nodes[id])) items.push({ pos: id, e: { kind: 'stitch', node: id } });
    }
  }
  for (const s of spaces) {
    if (s.round === r && s.kind === 'chsp' && s.chains.length > 0) items.push({ pos: s.chains[0], e: { kind: 'space', space: s.id } });
  }
  items.sort((a, b) => a.pos - b.pos);
  return items.map((x) => x.e);
}

/** Target list of round r of a finished graph (working order of that round). */
export function targetsOfGraphRound(g: Graph, r: number): Entry[] {
  const R = g.rounds[r];
  if (!R) return [];
  return buildTargets(g.nodes, g.spaces, r, R.first, R.last);
}

/**
 * Does entry `e` satisfy `unit`? Chain units match only the foundation-chain entries of a border
 * round (otherwise chains are addressed through the chain cursor, see compile.ts).
 */
export function entryMatches(e: Entry, unit: Unit, nodes: readonly Node[], spaces: readonly Space[]): boolean {
  switch (unit.kind) {
    case 'st':
    case 'any':
      return e.kind === 'stitch' || e.kind === 'base';
    case 'rowEnd':
      return e.kind === 'rowEnd';
    case 'corner':
      return !!e.corner;
    case 'stname': {
      if (e.kind !== 'stitch') return false;
      const n = nodes[e.node];
      if (unit.type === 'cl') return n.tag === 'cluster';
      if (n.countsAs === unit.type) return true;
      return n.type === unit.type && n.tag !== 'cluster';
    }
    case 'space':
      if (e.kind !== 'space') return false;
      return unit.chains === undefined || spaces[e.space].chains.length === unit.chains;
    case 'ch':
      return e.kind === 'base';
  }
}

/** The anchor a stitch worked into entry `e` gets. */
export function entryAnchor(e: Entry): Anchor {
  switch (e.kind) {
    case 'stitch': return { node: e.node };
    case 'space': return { space: e.space };
    case 'rowEnd': return { node: e.node, part: 'side' };
    case 'base': return { node: e.node, part: 'base' };
  }
}

/** Identity of an anchor ("n12", "n12:side", "s3"). */
export function anchorId(a: Anchor): string {
  return 'space' in a ? `s${a.space}` : a.part ? `n${a.node}:${a.part}` : `n${a.node}`;
}

/* ---------------------------------------------------------------------------------------------
 * Border rounds (notation.md 3.9)
 *
 * A `Rnd` that follows `Row`s is worked around the piece. Its target list is the perimeter, in
 * working order from where the yarn is at the end of the last row:
 *   top     — the last row's targets, turned (as the next row would see them);
 *   side 1  — one row end per row, last row down to the first row of the row block;
 *   bottom  — the unused loops of the foundation chain (the chains under the first row);
 *   side 2  — one row end per row, first row up to the last row.
 * The first and last stitch of the top and of the bottom are the four corners.
 * Later rounds see an ordinary target list, but each corner group of the round before (the
 * stitches worked into one corner) marks a corner again: its chain space if it has one inside
 * the group, else its middle stitch.
 * ------------------------------------------------------------------------------------------- */

type RoundLike = Pick<Round, 'kind' | 'first' | 'last' | 'turned'>;

function edgesOf(nodes: readonly Node[], R: RoundLike): { start: number; end: number } | undefined {
  if (R.first < 0) return undefined;
  let start = -1, end = -1;
  for (let id = R.first; id <= R.last; id++) {
    if (nodeCounts(nodes[id])) {
      if (start < 0) start = id;
      end = id;
    }
  }
  return start < 0 ? undefined : { start, end };
}

/** Perimeter target list of the piece whose last row is round `lastRow` (see above). */
export function perimeterTargets(nodes: readonly Node[], spaces: readonly Space[], rounds: readonly RoundLike[], lastRow: number): Entry[] {
  let firstRow = lastRow;
  while (firstRow - 1 >= 0 && rounds[firstRow - 1].kind === 'row') firstRow--;
  const R = rounds[lastRow];
  const top: Entry[] = buildTargets(nodes, spaces, lastRow, R.first, R.last).reverse().map((e) => ({ ...e, side: 0 }));
  const sideA: Entry[] = [];
  const sideB: Entry[] = [];
  for (let k = lastRow; k >= firstRow; k--) {
    const ed = edgesOf(nodes, rounds[k]);
    if (!ed) continue;
    sideA.push({ kind: 'rowEnd', node: (lastRow - k) % 2 === 0 ? ed.start : ed.end, row: k, side: 1 });
  }
  for (let k = firstRow; k <= lastRow; k++) {
    const ed = edgesOf(nodes, rounds[k]);
    if (!ed) continue;
    sideB.push({ kind: 'rowEnd', node: (lastRow - k) % 2 === 0 ? ed.end : ed.start, row: k, side: 3 });
  }
  // bottom: the stretch of foundation chain under the first row
  const bottom: Entry[] = [];
  const R1 = rounds[firstRow];
  if (R1.first >= 0) {
    const worked: number[] = [];
    for (let id = R1.first; id <= R1.last; id++) {
      const n = nodes[id];
      if (n.type === 'ch' && !n.countsAs) continue;
      for (const a of n.into) if ('node' in a && !a.part && nodes[a.node]?.type === 'ch' && !nodes[a.node].countsAs) worked.push(a.node);
    }
    if (worked.length) {
      const lo = Math.min(...worked), hi = Math.max(...worked);
      const ids: number[] = [];
      for (let id = lo; id <= hi; id++) if (nodes[id].type === 'ch') ids.push(id);
      // the first row was worked from worked[0] towards worked[last]
      const rowOrder = worked[0] > worked[worked.length - 1] ? ids.slice().reverse() : ids;
      const ed = edgesOf(nodes, R1);
      // side 1 meets the bottom at the first row's start when (lastRow - firstRow) is even
      const aHasStart = (lastRow - firstRow) % 2 === 0;
      const order = ed && aHasStart ? rowOrder : rowOrder.slice().reverse();
      for (const id of order) bottom.push({ kind: 'base', node: id, side: 2 });
    }
  }
  const markEnds = (xs: Entry[], ok: (e: Entry) => boolean) => {
    const idx = xs.map((e, i) => (ok(e) ? i : -1)).filter((i) => i >= 0);
    if (idx.length) {
      xs[idx[0]].corner = true;
      xs[idx[idx.length - 1]].corner = true;
    }
  };
  markEnds(top, (e) => e.kind === 'stitch');
  markEnds(bottom, () => true);
  return [...top, ...sideA, ...bottom, ...sideB];
}

/**
 * Target list of round `r` (a border round) with its corners marked: one per corner the round
 * worked into (`inputCorners`, the anchors of the corners of the list round r worked).
 */
export function cornerTargets(nodes: readonly Node[], spaces: readonly Space[], r: number, R: RoundLike, inputCorners: readonly Anchor[]): Entry[] {
  const list = buildTargets(nodes, spaces, r, R.first, R.last);
  if (R.first < 0) return list;
  const pos = new Map<string, number>();
  list.forEach((e, i) => pos.set(e.kind === 'space' ? `s${e.space}` : `n${(e as { node: number }).node}`, i));
  for (const c of inputCorners) {
    const key = anchorId(c);
    const group: number[] = [];
    for (let id = R.first; id <= R.last; id++) {
      const n = nodes[id];
      if (nodeCounts(n) && n.into.some((a) => anchorId(a) === key)) group.push(id);
    }
    if (!group.length) continue;
    const lo = group[0], hi = group[group.length - 1];
    const inside = spaces.filter((s) => s.round === r && s.kind === 'chsp' && s.chains.length > 0 && s.chains[0] > lo && s.chains[s.chains.length - 1] < hi);
    const k = inside.length ? pos.get(`s${inside[Math.floor((inside.length - 1) / 2)].id}`) : pos.get(`n${group[Math.floor(group.length / 2)]}`);
    if (k !== undefined) list[k] = { ...list[k], corner: true };
  }
  return list;
}

/**
 * For every round that is worked into a list with corners (a border round), that list, in the
 * order the round walked it. Rounds worked into an ordinary list are absent.
 */
export function borderLists(g: Graph): Map<number, Entry[]> {
  const out = new Map<number, Entry[]>();
  for (let r = 1; r < g.rounds.length; r++) {
    const prev = g.rounds[r - 1];
    const R = g.rounds[r];
    let list: Entry[] | undefined;
    if (prev.kind === 'row' && R.kind === 'round') {
      list = perimeterTargets(g.nodes, g.spaces, g.rounds, r - 1);
    } else if (out.has(r - 1)) {
      const inCorners = out.get(r - 1)!.filter((e) => e.corner).map(entryAnchor);
      list = cornerTargets(g.nodes, g.spaces, r - 1, prev, inCorners);
      if (R.turned) list = list.slice().reverse();
    }
    if (list && list.some((e) => e.corner)) out.set(r, list);
  }
  return out;
}

const BORDER_CACHE = new WeakMap<Graph, Map<number, Entry[]>>();
/** `borderLists`, cached per graph object. */
export function borderListsCached(g: Graph): Map<number, Entry[]> {
  let m = BORDER_CACHE.get(g);
  if (!m) {
    m = borderLists(g);
    BORDER_CACHE.set(g, m);
  }
  return m;
}

/** Human description of a unit for messages: "stitch", "dc", "ch-3 sp", "chain". */
export function unitNoun(unit: Unit, usName: (t: string) => string): string {
  switch (unit.kind) {
    case 'st':
    case 'any':
      return 'stitch';
    case 'stname':
      return unit.type === 'cl' ? 'cluster' : usName(unit.type);
    case 'space':
      return unit.chains !== undefined ? `ch-${unit.chains} ${unit.word}` : unit.word === 'loop' ? 'loop' : 'space';
    case 'ch':
      return 'chain';
    case 'rowEnd':
      return 'row end';
    case 'corner':
      return 'corner';
  }
}
