/**
 * Structural validation of a stitch graph from any source (compiler, generators, lab, files).
 *
 * This checks the invariants the JSON Schema cannot express. It does not need the notation.
 * Errors mean other tools may misbehave on the graph; warnings are legal but unusual
 * (e.g. an anchor two rounds back — spike stitches are out of scope for the notation, not for
 * the format).
 */
import { nodeCounts } from './targets';
import { STITCH_TYPES, type Graph, type Pattern } from './types';

export type GraphIssueCode =
  | 'G_FORMAT'
  | 'G_ID'
  | 'G_ROUND_INDEX'
  | 'G_ROUND_RANGE'
  | 'G_NODE_ROUND'
  | 'G_STITCH_COUNT'
  | 'G_DECLARED_COUNT'
  | 'G_TYPE'
  | 'G_ANCHOR_RANGE'
  | 'G_ANCHOR_FORWARD'
  | 'G_ANCHOR_ROUND'
  | 'G_ANCHOR_COUNT'
  | 'G_ANCHOR_PART'
  | 'G_CLUSTER'
  | 'G_SPACE'
  | 'G_COUNTS_AS'
  | 'G_GROUP';

export interface GraphIssue {
  severity: 'error' | 'warning';
  code: GraphIssueCode;
  message: string;
  node?: number;
  space?: number;
  round?: number;
}

export interface ValidateOptions {
  /** Max issues to collect (default 200). */
  limit?: number;
}

/** Validate a whole pattern object (format/version + graph). */
export function validatePattern(p: Pattern, opts: ValidateOptions = {}): GraphIssue[] {
  const out: GraphIssue[] = [];
  if (!p || typeof p !== 'object') return [{ severity: 'error', code: 'G_FORMAT', message: 'not an object' }];
  if (p.format !== 'crochet-pattern') out.push({ severity: 'error', code: 'G_FORMAT', message: `format must be "crochet-pattern" but is ${JSON.stringify(p.format)}` });
  if (p.version !== '0.1') out.push({ severity: 'error', code: 'G_FORMAT', message: `version must be "0.1" but is ${JSON.stringify(p.version)}` });
  if (!p.meta || typeof p.meta.title !== 'string') out.push({ severity: 'error', code: 'G_FORMAT', message: 'meta.title is missing' });
  if (!p.graph) {
    out.push({ severity: 'error', code: 'G_FORMAT', message: 'graph is missing' });
    return out;
  }
  return out.concat(validateGraph(p.graph, opts));
}

/** Validate graph structure. Returns [] for a valid graph. */
export function validateGraph(g: Graph, opts: ValidateOptions = {}): GraphIssue[] {
  const limit = opts.limit ?? 200;
  const out: GraphIssue[] = [];
  const add = (i: GraphIssue) => {
    if (out.length < limit) out.push(i);
  };
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.spaces) || !Array.isArray(g.rounds)) {
    return [{ severity: 'error', code: 'G_FORMAT', message: 'graph needs nodes, spaces and rounds arrays' }];
  }
  const { nodes, spaces, rounds } = g;

  // ids = indexes
  nodes.forEach((n, i) => {
    if (n.id !== i) add({ severity: 'error', code: 'G_ID', message: `nodes[${i}].id is ${n.id}, expected ${i}`, node: i });
    if (!STITCH_TYPES.includes(n.type)) add({ severity: 'error', code: 'G_TYPE', message: `node ${i} has unknown type ${JSON.stringify(n.type)}`, node: i });
  });
  spaces.forEach((s, i) => {
    if (s.id !== i) add({ severity: 'error', code: 'G_ID', message: `spaces[${i}].id is ${s.id}, expected ${i}`, space: i });
  });
  rounds.forEach((r, i) => {
    if (r.index !== i) add({ severity: 'error', code: 'G_ROUND_INDEX', message: `rounds[${i}].index is ${r.index}, expected ${i}`, round: i });
  });

  // rounds cover the nodes contiguously, in order
  let expectFirst = 0;
  rounds.forEach((r, i) => {
    if (r.first === -1 || r.last === -1) {
      if (r.first !== r.last) add({ severity: 'error', code: 'G_ROUND_RANGE', message: `${r.label}: first/last must both be -1 for an empty round`, round: i });
      if (r.stitchCount !== 0) add({ severity: 'error', code: 'G_STITCH_COUNT', message: `${r.label}: empty round with stitchCount ${r.stitchCount}`, round: i });
      return;
    }
    if (r.first !== expectFirst) add({ severity: 'error', code: 'G_ROUND_RANGE', message: `${r.label}: first is ${r.first}, expected ${expectFirst} (rounds must be contiguous)`, round: i });
    if (r.last < r.first || r.last >= nodes.length) {
      add({ severity: 'error', code: 'G_ROUND_RANGE', message: `${r.label}: last ${r.last} out of range`, round: i });
      return;
    }
    let count = 0;
    for (let id = r.first; id <= r.last; id++) {
      const n = nodes[id];
      if (n.round !== i) add({ severity: 'error', code: 'G_NODE_ROUND', message: `node ${id} says round ${n.round} but lies in ${r.label} (round ${i})`, node: id, round: i });
      if (nodeCounts(n)) count++;
    }
    if (count !== r.stitchCount) add({ severity: 'error', code: 'G_STITCH_COUNT', message: `${r.label}: stitchCount is ${r.stitchCount} but the round has ${count} stitch-counting nodes`, round: i });
    if (r.declaredCount !== undefined && r.declaredCount !== count) add({ severity: 'warning', code: 'G_DECLARED_COUNT', message: `${r.label}: declaredCount ${r.declaredCount} differs from ${count}`, round: i });
    expectFirst = r.last + 1;
  });
  if (expectFirst !== nodes.length) add({ severity: 'error', code: 'G_ROUND_RANGE', message: `rounds cover nodes 0..${expectFirst - 1} but there are ${nodes.length} nodes` });

  // spaces
  const chainOwner = new Map<number, number>();
  spaces.forEach((s, i) => {
    if (s.round < 0 || s.round >= rounds.length) add({ severity: 'error', code: 'G_SPACE', message: `space ${i} has round ${s.round} out of range`, space: i });
    if (s.kind === 'chsp' && s.chains.length === 0) add({ severity: 'error', code: 'G_SPACE', message: `chain space ${i} has no chains`, space: i });
    s.chains.forEach((c, k) => {
      const n = nodes[c];
      if (!n) { add({ severity: 'error', code: 'G_SPACE', message: `space ${i} lists chain ${c}, which does not exist`, space: i }); return; }
      if (n.type !== 'ch') add({ severity: 'error', code: 'G_SPACE', message: `space ${i} lists node ${c} (${n.type}), which is not a chain`, space: i, node: c });
      if (n.round !== s.round) add({ severity: 'error', code: 'G_SPACE', message: `space ${i} (round ${s.round}) lists chain ${c} of round ${n.round}`, space: i, node: c });
      if (n.role === 'tch') add({ severity: 'error', code: 'G_SPACE', message: `space ${i} lists turning chain ${c}`, space: i, node: c });
      if (k > 0 && c !== s.chains[k - 1] + 1) add({ severity: 'error', code: 'G_SPACE', message: `space ${i}: chains must be consecutive nodes in working order`, space: i });
      if (chainOwner.has(c)) add({ severity: 'error', code: 'G_SPACE', message: `chain ${c} belongs to spaces ${chainOwner.get(c)} and ${i}`, space: i, node: c });
      chainOwner.set(c, i);
    });
  });

  // nodes: anchors and attributes
  const groups = new Map<number, { kind: string; nodes: number[] }>();
  nodes.forEach((n, id) => {
    const into = Array.isArray(n.into) ? n.into : [];
    if (n.type === 'picot' && into.length) add({ severity: 'error', code: 'G_ANCHOR_COUNT', message: `picot ${id} must have no anchors`, node: id });
    if (n.type === 'ch' && into.length && n.countsAs === undefined) add({ severity: 'error', code: 'G_ANCHOR_COUNT', message: `chain ${id} has anchors but is not a counting turning-chain top`, node: id });
    if (n.type !== 'ch' && n.type !== 'picot' && into.length === 0) add({ severity: 'error', code: 'G_ANCHOR_COUNT', message: `${n.type} ${id} is not worked into anything`, node: id });
    if (n.countsAs !== undefined) {
      if (n.type !== 'ch' || n.role !== 'tch') add({ severity: 'error', code: 'G_COUNTS_AS', message: `node ${id}: countsAs is only allowed on a turning-chain top (type ch, role tch)`, node: id });
      if (n.countsAs === 'ch' || n.countsAs === 'picot' || n.countsAs === 'slst') add({ severity: 'error', code: 'G_COUNTS_AS', message: `node ${id}: cannot count as ${n.countsAs}`, node: id });
    }
    if (n.role === 'tch' && n.type !== 'ch') add({ severity: 'error', code: 'G_COUNTS_AS', message: `node ${id}: role tch on a ${n.type}`, node: id });
    if (n.tag === 'cluster') {
      if (into.length < 2) add({ severity: 'error', code: 'G_CLUSTER', message: `cluster ${id} needs at least 2 legs`, node: id });
      const k0 = JSON.stringify(into[0]);
      if (into.some((a) => JSON.stringify(a) !== k0)) add({ severity: 'warning', code: 'G_CLUSTER', message: `cluster ${id}: legs go into different places`, node: id });
    }
    const R = rounds[n.round];
    for (const a of into) {
      if ('node' in a) {
        const t = nodes[a.node];
        if (!t) { add({ severity: 'error', code: 'G_ANCHOR_RANGE', message: `node ${id} is worked into node ${a.node}, which does not exist`, node: id }); continue; }
        if (a.node >= id) { add({ severity: 'error', code: 'G_ANCHOR_FORWARD', message: `node ${id} is worked into node ${a.node}, which is made later`, node: id }); continue; }
        if (a.part !== undefined) {
          // row ends and the other side of a foundation chain are reached from a border round,
          // however many rows back they lie (notation.md 3.9)
          if (a.part === 'side' && !nodeCounts(t)) add({ severity: 'error', code: 'G_ANCHOR_PART', message: `node ${id} is worked into the row end of node ${a.node} (${t.type}), which is not a stitch`, node: id });
          else if (a.part === 'base' && t.type !== 'ch') add({ severity: 'error', code: 'G_ANCHOR_PART', message: `node ${id} is worked into the unused loops of node ${a.node} (${t.type}), which is not a chain`, node: id });
          else if (a.part !== 'side' && a.part !== 'base') add({ severity: 'error', code: 'G_ANCHOR_PART', message: `node ${id} has an anchor with unknown part ${JSON.stringify(a.part)}`, node: id });
          continue;
        }
        if (R && t.round !== n.round && t.round !== n.round - 1) {
          add({ severity: 'warning', code: 'G_ANCHOR_ROUND', message: `node ${id} (${R.label}) is worked into node ${a.node} of round ${t.round}, not the previous round`, node: id });
        }
      } else if ('space' in a) {
        const s = spaces[a.space];
        if (!s) { add({ severity: 'error', code: 'G_ANCHOR_RANGE', message: `node ${id} is worked into space ${a.space}, which does not exist`, node: id }); continue; }
        if (s.round > n.round) add({ severity: 'error', code: 'G_ANCHOR_FORWARD', message: `node ${id} is worked into space ${a.space} of a later round`, node: id });
        if (s.chains.length && s.chains[s.chains.length - 1] >= id) add({ severity: 'error', code: 'G_ANCHOR_FORWARD', message: `node ${id} is worked into space ${a.space} before its chains are made`, node: id });
        if (s.round < n.round - 1) add({ severity: 'warning', code: 'G_ANCHOR_ROUND', message: `node ${id} is worked into space ${a.space} of round ${s.round}, not the previous round`, node: id });
        if (s.round === n.round && s.kind === 'chsp') add({ severity: 'warning', code: 'G_ANCHOR_ROUND', message: `node ${id} is worked into chain space ${a.space} of its own round`, node: id });
      } else {
        add({ severity: 'error', code: 'G_ANCHOR_RANGE', message: `node ${id} has an anchor with neither node nor space`, node: id });
      }
    }
    if (n.group) {
      const e = groups.get(n.group.id) ?? { kind: n.group.kind, nodes: [] };
      if (e.kind !== n.group.kind) add({ severity: 'error', code: 'G_GROUP', message: `group ${n.group.id} mixes kinds ${e.kind} and ${n.group.kind}`, node: id });
      e.nodes.push(id);
      groups.set(n.group.id, e);
    }
  });
  for (const [gid, e] of groups) {
    const ids = e.nodes;
    if (ids[ids.length - 1] - ids[0] !== ids.length - 1) add({ severity: 'warning', code: 'G_GROUP', message: `group ${gid} (${e.kind}) is not a consecutive run of nodes`, node: ids[0] });
    if (e.kind === 'inc' && ids.length < 2) add({ severity: 'warning', code: 'G_GROUP', message: `inc group ${gid} has only one node`, node: ids[0] });
  }
  return out;
}

/** true if there are no error-severity issues. */
export function isValidGraph(g: Graph): boolean {
  return !validateGraph(g).some((i) => i.severity === 'error');
}
