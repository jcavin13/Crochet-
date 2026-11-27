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
import type { Graph, Node, Space } from './types';

export type Entry = { kind: 'stitch'; node: number } | { kind: 'space'; space: number };

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

/** Does entry `e` satisfy `unit`? Chain units never match list entries (see compile.ts). */
export function entryMatches(e: Entry, unit: Unit, nodes: readonly Node[], spaces: readonly Space[]): boolean {
  switch (unit.kind) {
    case 'st':
    case 'any':
      return e.kind === 'stitch';
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
      return false;
  }
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
  }
}
