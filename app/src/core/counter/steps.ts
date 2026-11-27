/**
 * Step lists: the counter's view of a pattern. A step is a contiguous range of nodes (the graph's
 * node array is the working order), so the counter is a pointer `nodeIndex` = nodes completed.
 *
 * Granularity:
 *  - 'stitch': one step per node;
 *  - 'group' : one step per notation item occurrence ("ch 3 (counts as dc)", "3 dc in next ch-2 sp",
 *              "(dc, ch 2, dc) in next ch-4 sp", one "inc"); falls back to node.group / chain runs /
 *              node.src when the pattern has no notation;
 *  - 'round' : one step per round.
 *
 * Pure and deterministic; no DOM.
 */
import { anchorsOf, roundSummary, stitchCounting } from '../graph/queries';
import type { Graph, Node, Pattern, SrcSpan, Terms } from '../graph/types';
import type { Item, PatternAst, RoundAst, Span } from '../notation/ast';
import { parse } from '../notation/parser';
import { nameOf } from '../notation/vocab';
import { roundRepeats, type RepeatPos } from './repeats';
import { anchorKey, graphStepText, nodeText, printItem, printRound } from './text';

export type Granularity = 'stitch' | 'group' | 'round';
export const GRANULARITIES: readonly Granularity[] = ['stitch', 'group', 'round'];

export interface Step {
  index: number;
  /** first node id (inclusive) */
  first: number;
  /** last node id (inclusive) */
  last: number;
  round: number;
  /** Instruction, e.g. "3 dc in next ch-2 sp", "ch 3 (counts as dc)", "sl st to join". */
  text: string;
  /** What the first worked node goes into, e.g. "ch-2 sp of Rnd 4", "ring". */
  into?: string;
  /** Stitch-counting nodes of the round before this step. */
  countBefore: number;
  /** Stitch-counting nodes in this step. */
  counts: number;
  /** round.stitchCount */
  roundCount: number;
  /** Position in the round's repeat, when the round is periodic. */
  repeat?: RepeatPos;
  /** Source span of the item (or targeted group) the step comes from, to highlight the notation. */
  src?: SrcSpan;
  /** Span of the enclosing repeat / repeated group, if any. */
  repeatSrc?: SrcSpan;
  /** Last step of its round. */
  endsRound: boolean;
}

export interface RoundInfo {
  index: number;
  label: string;
  /** step index range [firstStep, lastStep] (inclusive); -1 when the round has no nodes */
  firstStep: number;
  lastStep: number;
  /** The round's notation line in the requested terms (from the AST) when available. */
  line?: string;
  /** Period info for repeats in this round. */
  repeats?: { period: number; total: number };
}

export interface StepList {
  granularity: Granularity;
  terms: Terms;
  steps: Step[];
  rounds: RoundInfo[];
  /** stepOfNode[i] = index of the step containing node i */
  stepOfNode: Int32Array;
  /** countPrefix[i] = stitch-counting nodes among nodes[0..i) (length nodes+1) */
  countPrefix: Int32Array;
  nodeCount: number;
  /** true when step texts came from the notation AST */
  fromNotation: boolean;
}

export interface StepOptions {
  granularity?: Granularity;
  terms?: Terms;
  /** Parsed AST of pattern.notation (pass to avoid re-parsing); null = ignore the notation. */
  ast?: PatternAst | null;
}

/* ------------------------------------------------------------------- AST unit index */

interface Unit {
  /** key of the unit (span of the item or targeted group) */
  key: string;
  item: Item;
  span: Span;
  /** order of each leaf inside the unit (for splitting repeated occurrences of a group) */
  leafOrder: Map<string, number>;
  /** for a unit that is the only item of a repeat body: nodes per occurrence (to split runs) */
  perOcc?: number;
  /** the unit makes compound groups (inc/shell/V) one per step */
  splitGroups: boolean;
  /** "2 dc in each st around": one step per target */
  each: boolean;
  repeatSpan?: Span;
  prefix: string[];
  suffix: string[];
}

const spanKey = (s: { line: number; col: number; endLine?: number; endCol?: number }) => `${s.line}:${s.col}-${s.endLine ?? s.line}:${s.endCol ?? s.col}`;

const NO_NODES = new Set<Item['kind']>(['skip', 'turn', 'ring', 'fasten', 'otherSide']);

/** Nodes one occurrence of an item makes, when it is a fixed number. */
function nodesPerOccurrence(it: Item): number | undefined {
  switch (it.kind) {
    case 'chain': return it.n;
    case 'join': case 'ringJoin': return 1;
    case 'stitch': {
      if (it.target?.place.kind === 'each') return undefined;
      const per = it.spec.kind === 'inc' ? 2 : it.spec.kind === 'shell' ? it.spec.n : it.spec.kind === 'v' ? 3 : 1;
      return per * (it.count ?? 1) * (it.times ?? 1);
    }
    case 'group': {
      if (it.times && it.times.kind !== 'n') return undefined;
      let sum = 0;
      for (const c of it.items) {
        if (NO_NODES.has(c.kind)) continue;
        const k = nodesPerOccurrence(c);
        if (k === undefined) return undefined;
        sum += k;
      }
      return sum * (it.times?.kind === 'n' ? it.times.n : 1);
    }
    default: return undefined;
  }
}

function leafSpans(it: Item, out: Span[]): void {
  if (it.kind === 'group' || it.kind === 'repeat') for (const c of it.items) leafSpans(c, out);
  else out.push(it.span);
}

function indexUnits(ast: PatternAst, terms: Terms): { units: Map<string, Unit>; texts: Map<Unit, string> } {
  const units = new Map<string, Unit>();
  const texts = new Map<Unit, string>();
  const visit = (items: Item[], repeatSpan: Span | undefined, single: boolean) => {
    const made: (Unit | undefined)[] = [];
    for (const it of items) {
      if (it.kind === 'repeat' || (it.kind === 'group' && !it.target)) {
        const rs = it.kind === 'repeat' || it.times ? it.span : repeatSpan;
        visit(it.items, rs, it.items.filter((c) => !NO_NODES.has(c.kind)).length === 1 && (it.kind === 'repeat' || !!it.times));
        made.push(undefined);
        continue;
      }
      if (NO_NODES.has(it.kind)) { made.push(undefined); continue; }
      const spans: Span[] = [];
      leafSpans(it, spans);
      const u: Unit = {
        key: spanKey(it.span), item: it, span: it.span, leafOrder: new Map(spans.map((s, i) => [spanKey(s), i])),
        perOcc: single ? nodesPerOccurrence(it) : undefined,
        splitGroups: it.kind === 'stitch', each: false, repeatSpan, prefix: [], suffix: [],
      };
      if (it.kind === 'stitch' && it.target?.place.kind === 'each') {
        u.each = true;
        u.perOcc = nodesPerOccurrence({ ...it, target: undefined, count: it.count ?? 1 });
      }
      for (const s of spans) units.set(spanKey(s), u);
      made.push(u);
    }
    // attach node-less items (sk, turn, mr, fasten off) to a neighbour
    items.forEach((it, i) => {
      if (!NO_NODES.has(it.kind)) return;
      const txt = printItem(it, terms);
      const prev = made[i - 1];
      const next = made[i + 1];
      if (prev && it.kind !== 'ring') prev.suffix.push(txt);
      else if (next) next.prefix.push(txt);
      else if (prev) prev.suffix.push(txt);
    });
  };
  for (const r of ast.rounds) visit(r.items, undefined, false);
  for (const u of new Set(units.values())) {
    texts.set(u, [...u.prefix, printItem(u.item, terms), ...u.suffix].join(', '));
  }
  return { units, texts };
}

/** The item with its count dropped ("6 inc" → "inc") for a unit split into one step per group. */
function singleText(u: Unit, terms: Terms): string {
  const it = u.item;
  if (it.kind !== 'stitch') return printItem(it, terms);
  if (u.each && it.target?.place.kind === 'each') {
    const place = it.target.place;
    const grouped = it.spec.kind === 'inc' || it.spec.kind === 'shell' || it.spec.kind === 'v';
    return printItem({ ...it, count: grouped ? undefined : it.count, times: undefined, target: { ...it.target, place: { kind: 'next', unit: place.unit } } }, terms);
  }
  return printItem({ ...it, count: undefined, times: undefined }, terms);
}

/* ------------------------------------------------------------------- helpers */

function roundOfAstLine(ast: PatternAst): Map<number, RoundAst> {
  const m = new Map<number, RoundAst>();
  for (const r of ast.rounds) m.set(r.label.span.line, r);
  return m;
}

function describeInto(graph: Graph, n: Node, terms: Terms): string | undefined {
  const a = anchorsOf(graph, n.id)[0];
  if (!a) return undefined;
  const label = (r: number) => graph.rounds[r]?.label ?? `round ${r + 1}`;
  if (a.kind === 'space') {
    if (a.space.kind === 'ring') return 'the ring';
    return `ch-${a.space.chains.length} sp of ${label(a.space.round)}`;
  }
  const t = a.node;
  if (t.round === n.round) {
    if (t.type === 'ch' && !t.countsAs) return graph.spaces.some((sp) => sp.kind === 'ring' && sp.chains[0] === t.id) ? 'first ch' : 'ch of this round';
    return 'first st of this round';
  }
  const k = t.type === 'ch' ? (t.countsAs ? `top of ${graph.rounds[t.round]?.kind === 'row' ? 'turning' : 'beg'} ch` : 'ch') : (nodeKey(t, terms));
  return `${k} of ${label(t.round)}`;
}

function nodeKey(t: Node, terms: Terms): string {
  if (t.tag === 'cluster') return 'cl';
  if (t.type === 'picot' || t.type === 'puff') return t.type;
  if (t.type === 'popcorn') return 'pc';
  return nameOf(t.type, terms);
}

const toSrc = (s: Span): SrcSpan => ({ line: s.line, col: s.col, endLine: s.endLine, endCol: s.endCol });

/** Parse the pattern's notation once (or null when it has none). */
export function patternAst(pattern: Pattern): PatternAst | null {
  if (!pattern.notation) return null;
  try { return parse(pattern.notation).ast; } catch { return null; }
}

/* ------------------------------------------------------------------- build */

export function buildSteps(pattern: Pattern, opts: StepOptions = {}): StepList {
  const granularity = opts.granularity ?? 'group';
  const terms = opts.terms ?? 'US';
  const graph = pattern.graph;
  const N = graph.nodes.length;
  const ast = opts.ast === undefined ? patternAst(pattern) : opts.ast;
  const idx = ast ? indexUnits(ast, terms) : undefined;
  const astByLine = ast ? roundOfAstLine(ast) : undefined;

  const countPrefix = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) countPrefix[i + 1] = countPrefix[i] + (stitchCounting(graph.nodes[i]) ? 1 : 0);

  const unitOf = (n: Node): Unit | undefined => (idx && n.src ? idx.units.get(spanKey(n.src)) : undefined);

  // ---- ranges per granularity
  const ranges: { first: number; last: number; unit?: Unit; split?: boolean }[] = [];
  for (const R of graph.rounds) {
    if (R.first < 0) continue;
    if (granularity === 'round') { ranges.push({ first: R.first, last: R.last }); continue; }
    if (granularity === 'stitch') { for (let i = R.first; i <= R.last; i++) ranges.push({ first: i, last: i }); continue; }
    let i = R.first;
    while (i <= R.last) {
      const a = graph.nodes[i];
      const u = unitOf(a);
      let j = i;
      let split = false;
      if (u) {
        let occCount = 1;
        while (j + 1 <= R.last) {
          const b = graph.nodes[j + 1];
          if (unitOf(b) !== u) break;
          const prev = graph.nodes[j];
          if (u.splitGroups && (a.group || b.group) && (prev.group?.id !== b.group?.id)) { split = true; break; }
          if (u.leafOrder.size > 1) {
            const lo = u.leafOrder.get(spanKey(b.src!)) ?? 0;
            const lp = u.leafOrder.get(spanKey(prev.src!)) ?? 0;
            if (lo < lp) break; // a new occurrence of the group starts
          }
          if (u.perOcc && occCount >= u.perOcc) break;
          occCount++;
          j++;
        }
        if ((u.splitGroups && a.group) || u.each) split = true;
      } else {
        // fallback: same src (if any) + same compound group; chain runs; else single node
        while (j + 1 <= R.last) {
          const prev = graph.nodes[j];
          const b = graph.nodes[j + 1];
          if (unitOf(b)) break;
          if (a.src || b.src) {
            if (!a.src || !b.src || spanKey(a.src) !== spanKey(b.src)) break;
            if ((prev.group?.id ?? -1) !== (b.group?.id ?? -1)) break;
          } else if (a.group) {
            if (b.group?.id !== a.group.id || b.group.kind !== a.group.kind) break;
          } else if (a.type === 'ch' && !a.group) {
            if (b.type !== 'ch' || b.group || (prev.countsAs && b.role === 'tch')) break;
          } else break;
          j++;
        }
      }
      ranges.push({ first: i, last: j, unit: u, split });
      i = j + 1;
    }
  }

  // ---- repeats per round
  const repeatByRound = graph.rounds.map((_, r) => roundRepeats(graph, r, terms));

  // ---- steps
  const steps: Step[] = [];
  const stepOfNode = new Int32Array(N).fill(-1);
  let used = new Set<string>();
  let curRound = -1;
  for (const rg of ranges) {
    const n0 = graph.nodes[rg.first];
    const r = n0.round;
    if (r !== curRound) { used = new Set(); curRound = r; }
    const R = graph.rounds[r];
    const ids: number[] = [];
    for (let i = rg.first; i <= rg.last; i++) ids.push(i);
    let text: string;
    let src: SrcSpan | undefined;
    let repeatSrc: SrcSpan | undefined;
    if (granularity === 'round') {
      const ra = R.src && astByLine?.get(R.src.line);
      text = ra ? printRound(ra, R.label, terms) : roundPlain(graph, r, terms);
      if (R.src) src = { line: R.src.line, col: 1, endLine: R.src.endLine ?? R.src.line };
    } else if (granularity === 'stitch') {
      text = nodeText(graph, rg.first, terms);
      const u = unitOf(n0);
      src = n0.src ? { ...n0.src } : undefined;
      if (u?.repeatSpan) repeatSrc = toSrc(u.repeatSpan);
    } else if (rg.unit) {
      text = rg.split ? singleText(rg.unit, terms) : idx!.texts.get(rg.unit)!;
      src = toSrc(rg.unit.span);
      if (rg.unit.repeatSpan) repeatSrc = toSrc(rg.unit.repeatSpan);
    } else {
      text = graphStepText(graph, ids, terms, used);
      src = n0.src ? { ...n0.src } : undefined;
    }
    for (const id of ids) for (let k = 0; k < graph.nodes[id].into.length; k++) { const key = anchorKey(graph.nodes[id], k); if (key) used.add(key); }
    const worked = ids.map((i) => graph.nodes[i]).find((n) => n.into.length > 0);
    const rep = repeatByRound[r];
    let repeat: RepeatPos | undefined;
    if (rep && granularity !== 'round') {
      for (const id of ids) { const p = rep.byNode.get(id); if (p) { repeat = p; break; } }
    }
    const step: Step = {
      index: steps.length, first: rg.first, last: rg.last, round: r, text,
      countBefore: countPrefix[rg.first] - countPrefix[R.first],
      counts: countPrefix[rg.last + 1] - countPrefix[rg.first],
      roundCount: R.stitchCount,
      endsRound: rg.last === R.last,
    };
    if (worked && granularity !== 'round') { const into = describeInto(graph, worked, terms); if (into) step.into = into; }
    if (repeat) step.repeat = repeat;
    if (src) step.src = src;
    if (repeatSrc) step.repeatSrc = repeatSrc;
    for (const id of ids) stepOfNode[id] = step.index;
    steps.push(step);
  }

  const rounds: RoundInfo[] = graph.rounds.map((R, r) => {
    const info: RoundInfo = { index: r, label: R.label, firstStep: -1, lastStep: -1 };
    if (R.first >= 0) { info.firstStep = stepOfNode[R.first]; info.lastStep = stepOfNode[R.last]; }
    const ra = R.src && astByLine?.get(R.src.line);
    if (ra) info.line = printRound(ra, R.label, terms);
    const rep = repeatByRound[r];
    if (rep) info.repeats = { period: rep.period, total: rep.total };
    return info;
  });

  return { granularity, terms, steps, rounds, stepOfNode, countPrefix, nodeCount: N, fromNotation: !!idx };
}

function roundPlain(graph: Graph, r: number, terms: Terms): string {
  const e = roundExpectation(graph, r, terms);
  return `${graph.rounds[r].label}: ${e.parts.join(', ') || 'no stitches'}`;
}

/* ------------------------------------------------------------------- queries */

/** Step containing the pointer; steps.length when the piece is finished. */
export function stepAt(list: StepList, nodeIndex: number): number {
  if (nodeIndex >= list.nodeCount) return list.steps.length;
  if (nodeIndex < 0) return 0;
  return list.stepOfNode[nodeIndex];
}

export interface Position {
  round: number;
  /** stitch-counting nodes completed in the round */
  done: number;
  /** round.stitchCount */
  total: number;
  /** nodes completed in the round / nodes in the round */
  nodeFraction: number;
  /** nodes completed / all nodes */
  pieceFraction: number;
  finished: boolean;
}

export function positionOf(list: StepList, graph: Graph, nodeIndex: number): Position {
  const N = list.nodeCount;
  const finished = nodeIndex >= N;
  if (N === 0) return { round: 0, done: 0, total: 0, nodeFraction: 0, pieceFraction: 1, finished: true };
  const id = Math.min(Math.max(nodeIndex, 0), N - 1);
  const r = finished ? graph.nodes[N - 1].round : graph.nodes[id].round;
  const R = graph.rounds[r];
  const upto = finished ? N : nodeIndex;
  const done = list.countPrefix[upto] - list.countPrefix[R.first];
  const len = R.last - R.first + 1;
  return {
    round: r, done, total: R.stitchCount,
    nodeFraction: len > 0 ? (upto - R.first) / len : 1,
    pieceFraction: upto / N, finished,
  };
}

/** "stitch 14 of 32" (the first stitch the step makes), or "after stitch 13 of 32" for chains/sl sts. */
export function positionText(step: Step): string {
  if (step.roundCount === 0) return '';
  if (step.counts === 0) return step.countBefore === 0 ? `before stitch 1 of ${step.roundCount}` : `after stitch ${step.countBefore} of ${step.roundCount}`;
  if (step.counts === 1) return `stitch ${step.countBefore + 1} of ${step.roundCount}`;
  return `stitches ${step.countBefore + 1}–${step.countBefore + step.counts} of ${step.roundCount}`;
}

export interface Expectation {
  total: number;
  /** ["32 dc", "16 ch-2 spaces"] */
  parts: string[];
  /** "You should have 32 dc and 16 ch-2 spaces" */
  text: string;
}

const plural = (n: number, w: string) => (n === 1 || w === 'ch' ? w : w.endsWith('ch') ? `${w}es` : `${w}s`);

/** What to count at the end of round r. */
export function roundExpectation(graph: Graph, r: number, terms: Terms = 'US'): Expectation {
  const s = roundSummary(graph, r, { terms });
  const skip = new Set(['ch', nameOf('slst', terms)]);
  const parts: string[] = [];
  const types = Object.entries(s.byType).filter(([k]) => !skip.has(k));
  for (const [k, n] of types) parts.push(`${n} ${k === 'picot' ? plural(n, 'picot') : k}`);
  const lens = Object.keys(s.spaces).map(Number).sort((a, b) => b - a);
  for (const len of lens) { const n = s.spaces[len]; parts.push(`${n} ch-${len} ${n === 1 ? 'space' : 'spaces'}`); }
  const total = s.stitchCount;
  const list = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const stitchTypes = types.filter(([k]) => k !== 'picot').length;
  let text = parts.length ? `You should have ${list}` : `You should have ${total} ${plural(total, 'stitch')}`;
  if (stitchTypes > 1 && total > 0) text += ` (${total} stitches in all)`;
  return { total, parts, text };
}
