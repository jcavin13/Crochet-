/**
 * Counter progress: a pointer into the node array plus bookkeeping. All functions are pure reducers
 * `(progress, …) → progress`; `now` is passed in so they stay deterministic.
 */
import type { Graph, Pattern } from '../graph/types';
import { stepAt, type Granularity, type StepList } from './steps';

export interface RoundTime { start?: number; end?: number }

export interface CounterProgress {
  v: 1;
  patternId: string;
  /** hash of the notation (or graph) the pointer refers to */
  textHash: string;
  /** pointer = number of nodes completed (0 … nodeCount) */
  nodeIndex: number;
  /** node count of the graph when last saved */
  nodeCount: number;
  granularity: Granularity;
  startedAt: number;
  updatedAt: number;
  /** previous pointer values, most recent last (undo) */
  history: number[];
  /** per-round timestamps (pace estimate) */
  roundTimes: Record<number, RoundTime>;
  /** per-round notes */
  notes: Record<number, string>;
  /** where the pointer is, by round + node offset (to survive pattern edits) */
  anchor: { round: number; offset: number; label: string };
}

export const HISTORY_LIMIT = 200;

/** FNV-1a 32-bit, hex. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Hash of what the pointer refers to: the notation text, else the graph's node/round shape. */
export function patternHash(pattern: Pattern): string {
  if (pattern.notation) return hashText(pattern.notation);
  const g = pattern.graph;
  return hashText(g.nodes.map((n) => `${n.type}${n.round}`).join(',') + '|' + g.rounds.map((r) => `${r.first}-${r.last}`).join(','));
}

function anchorFor(graph: Graph, nodeIndex: number): CounterProgress['anchor'] {
  const N = graph.nodes.length;
  if (N === 0) return { round: 0, offset: 0, label: '' };
  const id = Math.min(nodeIndex, N - 1);
  const r = graph.nodes[id].round;
  const R = graph.rounds[r];
  return { round: r, offset: nodeIndex - R.first, label: R.label };
}

export function newProgress(patternId: string, pattern: Pattern, now: number, granularity: Granularity = 'group'): CounterProgress {
  return {
    v: 1, patternId, textHash: patternHash(pattern), nodeIndex: 0, nodeCount: pattern.graph.nodes.length,
    granularity, startedAt: now, updatedAt: now, history: [], roundTimes: {}, notes: {},
    anchor: anchorFor(pattern.graph, 0),
  };
}

/** Move the pointer. `record` pushes the old pointer on the undo history. */
export function moveTo(p: CounterProgress, graph: Graph, nodeIndex: number, now: number, record = true): CounterProgress {
  const N = graph.nodes.length;
  const to = Math.max(0, Math.min(N, Math.round(nodeIndex)));
  if (to === p.nodeIndex) return p;
  const history = record ? [...p.history, p.nodeIndex].slice(-HISTORY_LIMIT) : p.history;
  return { ...p, nodeIndex: to, nodeCount: N, history, updatedAt: now, anchor: anchorFor(graph, to) };
}

/** Complete the current step. Records round start/end times when the pointer crosses rounds. */
export function next(p: CounterProgress, list: StepList, graph: Graph, now: number): CounterProgress {
  const s = stepAt(list, p.nodeIndex);
  const step = list.steps[s];
  if (!step) return p;
  const moved = moveTo(p, graph, step.last + 1, now);
  if (moved === p) return p;
  const roundTimes = { ...p.roundTimes };
  const r = step.round;
  if (roundTimes[r]?.start === undefined) roundTimes[r] = { ...roundTimes[r], start: now };
  if (step.endsRound) {
    roundTimes[r] = { ...roundTimes[r], end: now };
    const nr = moved.nodeIndex < graph.nodes.length ? graph.nodes[moved.nodeIndex].round : undefined;
    if (nr !== undefined && roundTimes[nr]?.start === undefined) roundTimes[nr] = { ...roundTimes[nr], start: now };
  }
  return { ...moved, roundTimes };
}

/** Back one step (to the start of the current step if the pointer is mid-step). */
export function prev(p: CounterProgress, list: StepList, graph: Graph, now: number): CounterProgress {
  const s = stepAt(list, p.nodeIndex);
  const cur = list.steps[s];
  if (cur && p.nodeIndex > cur.first) return moveTo(p, graph, cur.first, now);
  const before = list.steps[s - 1];
  if (!before) return p;
  return moveTo(p, graph, before.first, now);
}

export function jumpToRound(p: CounterProgress, graph: Graph, r: number, now: number): CounterProgress {
  for (let k = r; k < graph.rounds.length; k++) {
    if (graph.rounds[k].first >= 0) return moveTo(p, graph, graph.rounds[k].first, now);
  }
  return moveTo(p, graph, graph.nodes.length, now);
}

/** Make node `id` the next stitch to work. */
export function jumpToNode(p: CounterProgress, graph: Graph, id: number, now: number): CounterProgress {
  return moveTo(p, graph, id, now);
}

/** Change granularity; the pointer is preserved (it may then sit mid-step). */
export function setGranularity(p: CounterProgress, g: Granularity, now: number): CounterProgress {
  if (p.granularity === g) return p;
  return { ...p, granularity: g, updatedAt: now };
}

/** Back to the beginning (undoable); round times are cleared, notes kept. */
export function reset(p: CounterProgress, graph: Graph, now: number): CounterProgress {
  const moved = moveTo(p, graph, 0, now);
  return { ...moved, roundTimes: {}, startedAt: now, updatedAt: now };
}

export function undo(p: CounterProgress, graph: Graph, now: number): CounterProgress {
  if (!p.history.length) return p;
  const history = p.history.slice(0, -1);
  const moved = moveTo({ ...p, history }, graph, p.history[p.history.length - 1], now, false);
  return moved === p ? { ...p, history } : moved;
}

export function setNote(p: CounterProgress, round: number, text: string, now: number): CounterProgress {
  const notes = { ...p.notes };
  if (text.trim()) notes[round] = text;
  else delete notes[round];
  return { ...p, notes, updatedAt: now };
}

export interface Reconciled {
  progress: CounterProgress;
  /** Set when the pattern changed since the progress was saved. */
  message?: string;
  changed: boolean;
}

/**
 * Bring saved progress in line with the current pattern. If the pattern text changed (hash
 * mismatch), keep the pointer by round + offset when that is still valid and say so.
 */
export function reconcile(p: CounterProgress, pattern: Pattern, now: number): Reconciled {
  const graph = pattern.graph;
  const hash = patternHash(pattern);
  const N = graph.nodes.length;
  if (p.textHash === hash && p.nodeCount === N && p.nodeIndex <= N) return { progress: p, changed: false };
  const { round, offset, label } = p.anchor;
  const R = graph.rounds[round];
  let nodeIndex: number;
  let message: string;
  if (R && R.first >= 0 && offset >= 0 && offset <= R.last - R.first + 1) {
    nodeIndex = R.first + offset;
    message = `The pattern changed since you last counted. Your place was kept: ${R.label}, ${offset} ${offset === 1 ? 'stitch' : 'stitches'} in.`;
  } else if (R && R.first >= 0) {
    nodeIndex = R.first;
    message = `The pattern changed since you last counted and ${label || R.label} is shorter now; moved to the start of ${R.label}.`;
  } else {
    nodeIndex = N;
    for (let k = Math.min(round, graph.rounds.length - 1); k >= 0; k--) {
      if (graph.rounds[k].first >= 0) { nodeIndex = graph.rounds[k].first; break; }
    }
    message = `The pattern changed since you last counted and ${label || 'that round'} no longer exists; moved to the last round.`;
  }
  nodeIndex = Math.max(0, Math.min(N, nodeIndex));
  const progress: CounterProgress = {
    ...p, textHash: hash, nodeCount: N, nodeIndex, history: [], updatedAt: now, anchor: anchorFor(graph, nodeIndex),
  };
  return { progress, message, changed: true };
}

export interface Pace {
  /** median ms per node over timed rounds */
  msPerNode?: number;
  /** estimate for the rest of the piece */
  remainingMs?: number;
  /** estimate for the rest of the current round */
  roundRemainingMs?: number;
  roundsTimed: number;
}

/** Simple pace estimate from completed, timed rounds. */
export function pace(p: CounterProgress, graph: Graph): Pace {
  const rates: number[] = [];
  for (const [k, t] of Object.entries(p.roundTimes)) {
    const R = graph.rounds[Number(k)];
    if (!R || R.first < 0 || t.start === undefined || t.end === undefined || t.end <= t.start) continue;
    rates.push((t.end - t.start) / (R.last - R.first + 1));
  }
  if (!rates.length) return { roundsTimed: 0 };
  rates.sort((a, b) => a - b);
  const msPerNode = rates[Math.floor(rates.length / 2)];
  const N = graph.nodes.length;
  const out: Pace = { msPerNode, roundsTimed: rates.length, remainingMs: (N - p.nodeIndex) * msPerNode };
  if (p.nodeIndex < N) {
    const R = graph.rounds[graph.nodes[p.nodeIndex].round];
    out.roundRemainingMs = (R.last + 1 - p.nodeIndex) * msPerNode;
  }
  return out;
}
