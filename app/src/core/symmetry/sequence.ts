/**
 * Per-round cyclic "element" sequences of a stitch graph — the structural tokens symmetry analysis
 * works on (see README.md in this folder).
 *
 * One element per course item of a round, in working order:
 *   * a stitch (stitch type, legs, loop modifier, cluster/puff/popcorn size) with its anchors;
 *     a turning chain that counts as X is an X standing on its base;
 *   * a chain space (one element for the whole run, labelled by its length);
 *   * a picot; a plain chain that is neither a space nor a turning chain (foundation chains).
 * Left out, because they are artefacts of where a round starts and not part of the fabric's
 * symmetry: turning chains that do not count, slip stitches that travel at the start of a round,
 * the join (and any slip stitch into the round's own stitches), and the chains of a chain ring.
 */
import type { Graph, Node } from '../graph';
import { stitchCounting } from '../graph';

/** One leg of an element: where it is worked. `round` −1 = the centre ring (no position). */
export interface Leg {
  round: number;
  /** Element index in that round's sequence (−1 for the ring / unresolved). */
  pos: number;
  /** Chain offset when worked into an individual chain of a space; −1 otherwise. */
  sub: number;
  /** Number of chains of the target space (to mirror `sub`). */
  size: number;
  /** Structural label of the target ("dc", "sp5", "ring"). */
  tl: string;
}

export interface Elem {
  /** Node ids that make this element (a space: its chains). */
  nodes: number[];
  /** Representative node (a space: its middle chain) — for drawing. */
  rep: number;
  /** Structural label of the element itself, without anchors: "dc", "dc3tog", "sp5", "picot3". */
  base: string;
  /** Crocheter's words for it: "dc", "ch 5", "picot", "3-tr cl". */
  human: string;
  legs: Leg[];
  /** Counts as a stitch (notation.md 3.3). */
  stitch: boolean;
  kind: 'st' | 'sp' | 'picot' | 'ch';
}

export interface RoundSeq {
  round: number;
  label: string;
  elems: Elem[];
  /** +1 / −1: working direction relative to round 0 (flips on turned rounds). */
  dir: 1 | -1;
}

export interface Sequences {
  rounds: RoundSeq[];
  /** node id → [round, element index] for nodes that are elements (stitches, picots, plain ch). */
  where: Map<number, [number, number]>;
  applicable: boolean;
}

const HUMAN_TYPE: Record<string, string> = { slst: 'sl st', popcorn: 'pc' };

function stitchBase(n: Node, extraLegs = 0): { base: string; human: string } {
  const type = n.type === 'ch' ? (n.countsAs ?? 'ch') : n.type;
  const legs = (n.type === 'ch' ? 1 : n.into.length) + extraLegs;
  let base: string = type;
  let human = HUMAN_TYPE[type] ?? type;
  if (n.type === 'puff') { base = `puff${n.loops ?? 3}`; human = (n.loops ?? 3) === 3 ? 'puff' : `${n.loops}-loop puff`; }
  else if (n.type === 'popcorn') { base = `pc${n.legs ?? 5}`; human = `${n.legs ?? 5}-dc pc`; }
  else if (n.tag === 'cluster') { base = `${type}${legs}cl`; human = `${legs}-${type} cl`; }
  else if (legs >= 2) { base = `${type}${legs}tog`; human = `${type}${legs}tog`; }
  if (n.loop) { base += `:${n.loop}`; human = n.loop === 'fp' || n.loop === 'bp' ? `${n.loop}${human}` : `${human} ${n.loop}`; }
  return { base, human };
}

export function buildSequences(graph: Graph): Sequences {
  const rounds: RoundSeq[] = [];
  const where = new Map<number, [number, number]>();
  const applicable = graph.rounds.length > 0 && !graph.rounds.some((r) => r.kind === 'row');
  const spaceOfChain = new Map<number, number>();
  const ringChains = new Set<number>();
  for (const s of graph.spaces) {
    if (s.kind === 'ring') s.chains.forEach((c) => ringChains.add(c));
    else s.chains.forEach((c) => spaceOfChain.set(c, s.id));
  }
  // space id → [round, element index]
  const spaceAt = new Map<number, [number, number]>();
  let dir: 1 | -1 = 1;
  const beginExtra = new Set<number>();

  for (const R of graph.rounds) {
    if (R.turned) dir = (dir === 1 ? -1 : 1);
    const elems: Elem[] = [];
    const raw: { n: Node; legsFrom: Node }[] = [];
    if (R.first >= 0) {
      let started = false;
      for (let id = R.first; id <= R.last; id++) {
        const n = graph.nodes[id];
        if (ringChains.has(id)) continue;
        if (n.type === 'slst') {
          // travel before the first stitch, joins and ring joins (anchored in this round)
          const own = n.into.some((a) => 'node' in a && graph.nodes[a.node]?.round === R.index);
          if (!started || own) continue;
        }
        if (n.type === 'ch' && n.role === 'tch' && !n.countsAs) continue;
        if (n.type !== 'ch' && n.type !== 'slst') started = true;
        if (n.countsAs) started = true;
        raw.push({ n, legsFrom: n });
      }
    }
    const pending: { e: Elem; n: Node }[] = [];
    let i = 0;
    while (i < raw.length) {
      const n = raw[i].n;
      const sp = n.type === 'ch' && !n.countsAs ? spaceOfChain.get(n.id) : undefined;
      if (sp !== undefined) {
        const chains = graph.spaces[sp].chains;
        const e: Elem = {
          nodes: [...chains], rep: chains[Math.floor((chains.length - 1) / 2)], base: `sp${chains.length}`,
          human: `ch ${chains.length}`, legs: [], stitch: false, kind: 'sp',
        };
        spaceAt.set(sp, [R.index, elems.length]);
        elems.push(e);
        // skip the rest of the run
        const last = chains[chains.length - 1];
        while (i < raw.length && raw[i].n.id <= last) i++;
        continue;
      }
      let e: Elem;
      if (n.type === 'picot') {
        e = { nodes: [n.id], rep: n.id, base: `picot${n.chains ?? 3}`, human: (n.chains ?? 3) === 3 ? 'picot' : `ch-${n.chains} picot`, legs: [], stitch: false, kind: 'picot' };
      } else if (n.type === 'ch' && !n.countsAs) {
        e = { nodes: [n.id], rep: n.id, base: 'ch', human: 'ch', legs: [], stitch: false, kind: 'ch' };
      } else {
        const b = stitchBase(n);
        e = { nodes: [n.id], rep: n.id, base: b.base, human: b.human, legs: [], stitch: stitchCounting(n), kind: 'st' };
        pending.push({ e, n });
      }
      where.set(n.id, [R.index, elems.length]);
      elems.push(e);
      i++;
    }
    // Beginning cluster: "ch 3, 2-dc cl in same sp" stands for a 3-dc cl. Use the one-more-leg
    // label when that is what the round's other clusters are.
    const firstSt = pending[0];
    if (firstSt && firstSt.n.tag === 'cluster' && R.first >= 0) {
      const tchBefore = graph.nodes.slice(R.first, firstSt.n.id).some((x) => x.type === 'ch' && x.role === 'tch' && !x.countsAs);
      if (tchBefore) {
        const alt = stitchBase(firstSt.n, 1);
        const cAlt = pending.filter((p) => p.e.base === alt.base).length;
        const cOrig = pending.filter((p) => p.e.base === firstSt.e.base).length;
        const oneTarget = firstSt.n.into.every((a) => JSON.stringify(a) === JSON.stringify(firstSt.n.into[0]));
        if (cAlt > cOrig - 1 && oneTarget) { firstSt.e.base = alt.base; firstSt.e.human = alt.human; beginExtra.add(firstSt.n.id); }
      }
    }
    rounds.push({ round: R.index, label: R.label, elems, dir });
  }

  // resolve anchors now that every round's elements are known
  const elemAt = (r: number, p: number) => rounds[r]?.elems[p];
  for (const rs of rounds) {
    for (const e of rs.elems) {
      if (e.kind !== 'st') continue;
      const n = graph.nodes[e.nodes[0]];
      for (const a of n.into) {
        let leg: Leg;
        if ('space' in a) {
          const s = graph.spaces[a.space];
          if (!s || s.kind === 'ring') leg = { round: -1, pos: -1, sub: -1, size: 0, tl: 'ring' };
          else {
            const at = spaceAt.get(s.id);
            leg = at ? { round: at[0], pos: at[1], sub: -1, size: s.chains.length, tl: `sp${s.chains.length}` } : { round: -1, pos: -1, sub: -1, size: 0, tl: '?' };
          }
        } else {
          const t = a.node;
          if (ringChains.has(t)) leg = { round: -1, pos: -1, sub: -1, size: 0, tl: 'ring' };
          else if (spaceOfChain.has(t) && !graph.nodes[t].countsAs) {
            const s = graph.spaces[spaceOfChain.get(t)!];
            const at = spaceAt.get(s.id);
            leg = at ? { round: at[0], pos: at[1], sub: s.chains.indexOf(t), size: s.chains.length, tl: `sp${s.chains.length}` } : { round: -1, pos: -1, sub: -1, size: 0, tl: '?' };
          } else {
            const at = where.get(t);
            leg = at ? { round: at[0], pos: at[1], sub: -1, size: 0, tl: elemAt(at[0], at[1])!.base } : { round: -1, pos: -1, sub: -1, size: 0, tl: '?' };
          }
        }
        e.legs.push(leg);
      }
      if (beginExtra.has(n.id) && e.legs.length) e.legs.push({ ...e.legs[0] });
    }
  }
  return { rounds, where, applicable };
}
