/**
 * Read-only helpers over a stitch graph, for the chart, counter, flatness and sim features.
 * All functions are pure and work on any schema-valid graph (not only compiler output).
 */
import { nameOf } from '../notation/vocab';
import { nodeCounts, targetsOfGraphRound, type Entry } from './targets';
import type { Graph, Node, Space, Terms } from './types';

export type { Entry } from './targets';

/** Does the node count as a stitch (and is a target for the next round)? (notation.md 3.3) */
export function stitchCounting(node: Node): boolean {
  return nodeCounts(node);
}

/** Nodes of round r, in working order. */
export function roundNodes(graph: Graph, r: number): Node[] {
  const R = graph.rounds[r];
  if (!R || R.first < 0) return [];
  return graph.nodes.slice(R.first, R.last + 1);
}

/** Target list round r exposes to the next round, in round r's working order. */
export function targetsOfRound(graph: Graph, r: number): Entry[] {
  return targetsOfGraphRound(graph, r);
}

/** Nodes that have at least one leg in space `spaceId`. */
export function spaceNodesInto(graph: Graph, spaceId: number): Node[] {
  return graph.nodes.filter((n) => n.into.some((a) => 'space' in a && a.space === spaceId));
}

export type ResolvedAnchor = { kind: 'node'; node: Node } | { kind: 'space'; space: Space };

/** The anchors of node `id`, resolved to the node / space objects (one entry per leg). */
export function anchorsOf(graph: Graph, id: number): ResolvedAnchor[] {
  const n = graph.nodes[id];
  if (!n) return [];
  const out: ResolvedAnchor[] = [];
  for (const a of n.into) {
    if ('node' in a) {
      const t = graph.nodes[a.node];
      if (t) out.push({ kind: 'node', node: t });
    } else {
      const s = graph.spaces[a.space];
      if (s) out.push({ kind: 'space', space: s });
    }
  }
  return out;
}

export interface Children {
  /** nodes[i] = ids of nodes with a leg in node i (each id once) */
  nodes: number[][];
  /** spaces[s] = ids of nodes with a leg in space s (each id once) */
  spaces: number[][];
}

/** Reverse index of anchors. */
export function childrenOf(graph: Graph): Children {
  const nodes: number[][] = graph.nodes.map(() => []);
  const spaces: number[][] = graph.spaces.map(() => []);
  for (const n of graph.nodes) {
    const seenN = new Set<number>();
    const seenS = new Set<number>();
    for (const a of n.into) {
      if ('node' in a) {
        if (!seenN.has(a.node) && nodes[a.node]) { nodes[a.node].push(n.id); seenN.add(a.node); }
      } else if (!seenS.has(a.space) && spaces[a.space]) { spaces[a.space].push(n.id); seenS.add(a.space); }
    }
  }
  return { nodes, spaces };
}

export interface QueryOptions {
  terms?: Terms;
}

/**
 * Short stitch key for summaries: "sc", "dc", "sc2tog", "cl", "fpdc", "sl st", "ch", "picot"…
 * A counting turning chain reports the stitch it counts as. Returns undefined for the chains of a
 * turning chain (they are not part of the round's course).
 */
export function stitchKey(n: Node, opts: QueryOptions = {}): string | undefined {
  const t = opts.terms ?? 'US';
  if (n.type === 'ch') {
    if (n.countsAs) return nameOf(n.countsAs, t);
    if (n.role === 'tch') return undefined;
    return 'ch';
  }
  if (n.type === 'picot' || n.type === 'puff') return n.type;
  if (n.type === 'popcorn') return 'pc';
  if (n.tag === 'cluster') return 'cl';
  const base = nameOf(n.type, t);
  const post = n.loop === 'fp' || n.loop === 'bp' ? n.loop : '';
  if (n.into.length >= 2) return `${post}${base}${n.into.length}tog`;
  return `${post}${base}`;
}

export interface RoundSummary {
  index: number;
  label: string;
  kind: string;
  stitchCount: number;
  declaredCount?: number;
  joined: boolean;
  turned: boolean;
  nodes: number;
  /** count by stitchKey (turning chains omitted; a counting tch is listed as its stitch) */
  byType: Record<string, number>;
  /** chain spaces made in this round: chain length → number of spaces */
  spaces: Record<number, number>;
  rings: number;
}

export function roundSummary(graph: Graph, r: number, opts: QueryOptions = {}): RoundSummary {
  const R = graph.rounds[r];
  const byType: Record<string, number> = {};
  for (const n of roundNodes(graph, r)) {
    const k = stitchKey(n, opts);
    if (k) byType[k] = (byType[k] ?? 0) + 1;
  }
  const spaces: Record<number, number> = {};
  let rings = 0;
  for (const s of graph.spaces) {
    if (s.round !== r) continue;
    if (s.kind === 'ring') rings++;
    else spaces[s.chains.length] = (spaces[s.chains.length] ?? 0) + 1;
  }
  const out: RoundSummary = {
    index: r, label: R?.label ?? `#${r}`, kind: R?.kind ?? 'round', stitchCount: R?.stitchCount ?? 0,
    joined: !!R?.joined, turned: !!R?.turned, nodes: roundNodes(graph, r).length, byType, spaces, rings,
  };
  if (R?.declaredCount !== undefined) out.declaredCount = R.declaredCount;
  return out;
}

function describeSpace(s: Space): string {
  if (s.kind === 'ring') return 'ring';
  return `ch-${s.chains.length} sp`;
}

function describeTargetNode(graph: Graph, self: Node, t: Node, terms: Terms): string {
  if (t.type === 'ch') {
    if (t.countsAs) return t.round === self.round ? 'top of beg ch' : 'top of tch';
    return 'ch';
  }
  if (t.round === self.round) {
    const R = graph.rounds[self.round];
    if (R) {
      for (let id = R.first; id >= 0 && id <= R.last; id++) {
        if (nodeCounts(graph.nodes[id])) {
          if (id === t.id) return 'first st';
          break;
        }
      }
    }
  }
  return stitchKey(t, { terms }) ?? nameOf(t.type, terms);
}

/**
 * Short human text for one node, e.g. "dc in ch-2 sp", "sc in sc (inc 1/2)", "sc2tog over 2 sts",
 * "ch (2 of 5, ch-5 sp)", "ch 3 (counts as dc)", "sl st in first st (join)".
 */
export function describeNode(graph: Graph, id: number, opts: QueryOptions = {}): string {
  const terms = opts.terms ?? 'US';
  const n = graph.nodes[id];
  if (!n) return '';
  const groupSuffix = () => {
    if (!n.group) return '';
    const members = graph.nodes.filter((m) => m.group && m.group.id === n.group!.id && m.group.kind === n.group!.kind);
    const pos = members.findIndex((m) => m.id === n.id) + 1;
    const kind = n.group.kind === 'v' ? 'V-st' : n.group.kind;
    return ` (${kind} ${pos}/${members.length})`;
  };
  if (n.type === 'ch') {
    if (n.role === 'tch') {
      // find the run of tch chains this node belongs to
      let a = id;
      while (a > 0 && graph.nodes[a - 1].type === 'ch' && graph.nodes[a - 1].role === 'tch' && !graph.nodes[a - 1].countsAs && graph.nodes[a - 1].round === n.round) a--;
      let b = id;
      while (!graph.nodes[b].countsAs && b + 1 < graph.nodes.length && graph.nodes[b + 1].type === 'ch' && graph.nodes[b + 1].role === 'tch' && graph.nodes[b + 1].round === n.round) b++;
      const len = b - a + 1;
      if (n.countsAs) return `ch ${len} (counts as ${nameOf(n.countsAs, terms)})`;
      return `ch (turning ch, ${id - a + 1} of ${len})`;
    }
    const sp = graph.spaces.find((s) => s.chains.includes(id));
    if (sp) {
      const k = sp.chains.indexOf(id) + 1;
      return sp.kind === 'ring'
        ? `ch (${k} of ${sp.chains.length}, ring)`
        : `ch (${k} of ${sp.chains.length}, ch-${sp.chains.length} sp)${groupSuffix()}`;
    }
    return `ch${groupSuffix()}`;
  }
  if (n.type === 'picot') return `picot (ch ${n.chains ?? 3})`;
  const name = stitchKey(n, { terms }) ?? nameOf(n.type, terms);
  const loop = n.loop === 'flo' || n.loop === 'blo' ? ` ${n.loop}` : '';
  const anchors = anchorsOf(graph, id);
  const describe = (a: ResolvedAnchor) => (a.kind === 'space' ? describeSpace(a.space) : describeTargetNode(graph, n, a.node, terms));
  let where = '';
  if (anchors.length >= 2) {
    const all = anchors.map(describe);
    const same = anchors.every((a) => (a.kind === 'space' ? `s${a.space.id}` : `n${a.node.id}`) === (anchors[0].kind === 'space' ? `s${anchors[0].space.id}` : `n${anchors[0].node.id}`));
    where = same ? ` in ${all[0]}` : ` over ${anchors.length} sts`;
  } else if (anchors.length === 1) {
    where = ` ${n.loop === 'fp' || n.loop === 'bp' ? 'around' : 'in'} ${describe(anchors[0])}`;
  }
  let s = `${name}${loop}${where}${groupSuffix()}`;
  const a0 = anchors[0];
  if (n.type === 'slst' && anchors.length === 1 && a0.kind === 'node' && a0.node.round === n.round) {
    const t = a0.node;
    if (nodeCounts(t)) s += ' (join)';
    else if (t.type === 'ch') {
      const ring = graph.spaces.find((sp) => sp.kind === 'ring' && sp.chains[0] === t.id);
      if (ring) s = `${nameOf('slst', terms)} in first ch (join to form ring)`;
    }
  }
  return s;
}
