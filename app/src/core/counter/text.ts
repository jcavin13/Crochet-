/**
 * Instruction text for counter steps.
 *
 * Two sources, best first:
 *  1. the notation AST (when `pattern.notation` is present): each step is printed from the item it
 *     came from, in US or UK terms, with the canonical printer ("3 dc in next ch-2 sp");
 *  2. the graph alone (imported graph JSON): text composed from the nodes (`describeNode` and
 *     friends).
 */
import { anchorsOf, describeNode, stitchKey } from '../graph/queries';
import type { Graph, Node, Terms } from '../graph/types';
import type { Item, PatternAst, RoundAst, Span } from '../notation/ast';
import { print } from '../notation/printer';
import { nameOf } from '../notation/vocab';

const DUMMY_SPAN: Span = { line: 1, col: 1, endLine: 1, endCol: 1 };

/** The printer adds a `terms:` header for UK; the round is the last line. */
const lastLine = (s: string) => s.trim().split('\n').pop() ?? '';

function printItems(items: Item[], terms: Terms): string {
  const ast: PatternAst = {
    headers: [],
    terms,
    rounds: [{ label: { kind: 'round', word: 'Rnd', from: 1, to: 1, range: false, span: DUMMY_SPAN }, items, span: DUMMY_SPAN }],
  };
  return lastLine(print(ast, { terms })).replace(/^Rnd 1: /, '').replace(/\.$/, '');
}

/** One notation item printed on its own, in crocheter's words. */
export function printItem(item: Item, terms: Terms): string {
  switch (item.kind) {
    case 'join':
      if (!item.target) return `${nameOf('slst', terms)} to join`;
      break;
    case 'ring':
      return 'magic ring';
    case 'fasten':
      return 'fasten off';
    case 'stitch':
      // "5 sc" reads as five sc in one place to many crocheters: say "sc in next 5 sts"
      if ((item.count ?? 1) > 1 && !item.target && !item.times && (item.spec.kind === 'basic' || item.spec.kind === 'tog' || item.spec.kind === 'puff' || item.spec.kind === 'popcorn' || item.spec.kind === 'cluster')) {
        return printItems([{ ...item, count: undefined, target: { prep: 'in', place: { kind: 'next', n: item.count, unit: { kind: 'st' } }, span: item.span } }], terms);
      }
      if (item.spec.kind === 'inc' && (item.count ?? 1) === 1 && !item.target && !item.times) {
        return `${printItems([item], terms)} (2 ${nameOf(item.spec.base, terms)} in next st)`;
      }
      break;
    default:
      break;
  }
  return printItems([item], terms);
}

/** A whole round line in the given terms, with the graph's label ("Rnd 7: …. (32)"). */
export function printRound(r: RoundAst, label: string, terms: Terms): string {
  const ast: PatternAst = { headers: [], terms, rounds: [{ ...r, label: { ...r.label, kind: 'round', word: 'Rnd', from: 1, to: 1, range: false } }] };
  return lastLine(print(ast, { terms })).replace(/^Rnd 1:/, `${label}:`);
}

/* --------------------------------------------------------------- graph-derived text */

const anchorKey = (n: Node, i = 0): string | undefined => {
  const a = n.into[i];
  if (!a) return undefined;
  return 'space' in a ? `s${a.space}` : `n${a.node}`;
};

function anchorPhrase(graph: Graph, n: Node, terms: Terms, used: Set<string>): string {
  const a = anchorsOf(graph, n.id)[0];
  if (!a) return '';
  const key = anchorKey(n)!;
  const nextOrSame = used.has(key) ? 'same' : 'next';
  if (a.kind === 'space') {
    if (a.space.kind === 'ring') return 'ring';
    return `${nextOrSame} ch-${a.space.chains.length} sp`;
  }
  const t = a.node;
  if (t.type === 'ch') {
    if (t.countsAs) return t.round === n.round ? 'top of beg ch' : 'top of tch';
    return `${nextOrSame} ch`;
  }
  return `${nextOrSame} ${stitchKey(t, { terms }) ?? 'st'}`;
}

/** "dc, ch 2, dc" from node keys: runs of ch collapse to "ch N". */
function compress(graph: Graph, ids: number[], terms: Terms): string {
  const parts: string[] = [];
  let i = 0;
  while (i < ids.length) {
    const n = graph.nodes[ids[i]];
    if (n.type === 'ch' && !n.countsAs) {
      let j = i;
      while (j + 1 < ids.length && graph.nodes[ids[j + 1]].type === 'ch' && !graph.nodes[ids[j + 1]].countsAs) j++;
      parts.push(`ch ${j - i + 1}`);
      i = j + 1;
      continue;
    }
    if (n.type === 'picot') parts.push(n.chains && n.chains !== 3 ? `ch-${n.chains} picot` : 'picot');
    else parts.push(stitchKey(n, { terms }) ?? nameOf(n.type, terms));
    i++;
  }
  return parts.join(', ');
}

/** Text for a single node (stitch granularity). */
export function nodeText(graph: Graph, id: number, terms: Terms): string {
  const s = describeNode(graph, id, { terms });
  if (s.endsWith(' (join)')) return `${nameOf('slst', terms)} to join`;
  if (/^ch \((turning ch, )?1 of 1(, ch-1 sp)?\)$/.test(s)) return 'ch 1';
  return s;
}

/**
 * Text for a run of nodes without an AST (imported graphs). `used` = anchor keys already used
 * earlier in the round (for "next" vs "same").
 */
export function graphStepText(graph: Graph, ids: number[], terms: Terms, used: Set<string>): string {
  if (ids.length === 0) return '';
  if (ids.length === 1) return nodeText(graph, ids[0], terms);
  const nodes = ids.map((i) => graph.nodes[i]);
  if (nodes.every((n) => n.type === 'ch')) {
    const tch = nodes.filter((n) => n.role === 'tch');
    const top = tch.find((n) => n.countsAs);
    if (top && tch.length > 0) {
      const extra = nodes.length - tch.length;
      return `ch ${nodes.length} (counts as ${nameOf(top.countsAs!, terms)}${extra ? `, ch ${extra}` : ''})`;
    }
    return `ch ${nodes.length}`;
  }
  const worked = nodes.filter((n) => n.into.length > 0);
  const keys = new Set(worked.flatMap((n) => n.into.map((_, i) => anchorKey(n, i))));
  const keysOf = worked.map((n) => stitchKey(n, { terms }));
  const allSameType = nodes.length === worked.length && keysOf.every((k) => k === keysOf[0]);
  if (keys.size === 1 && worked.length > 0) {
    const where = anchorPhrase(graph, worked[0], terms, used);
    const body = allSameType ? `${nodes.length} ${keysOf[0]}` : `(${compress(graph, ids, terms)})`;
    return `${body} in ${where}`;
  }
  if (allSameType) return `${nodes.length} ${keysOf[0]}`;
  return compress(graph, ids, terms);
}

export { anchorKey };
