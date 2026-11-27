/**
 * Repeat position from the periodicity of a round's work: each node becomes a token (stitch key +
 * whether it is worked into a stitch or a space); turning chains and slip stitches are left out, so a
 * written-out first repeat ("ch 3 (counts as dc), dc in same sp, ch 1") lines up with the body
 * ("2 dc in next ch-1 sp, ch 1"). The smallest period (≥ 2 tokens) that covers the most of the round
 * with whole repetitions wins.
 */
import { stitchKey } from '../graph/queries';
import type { Graph, Terms } from '../graph/types';

export interface RepeatPos {
  /** 1-based repetition */
  index: number;
  total: number;
}

export interface RoundRepeats {
  period: number;
  total: number;
  /** node id → position (only nodes inside the periodic region) */
  byNode: Map<number, RepeatPos>;
}

function token(graph: Graph, id: number, terms: Terms): string | undefined {
  const n = graph.nodes[id];
  if (n.type === 'slst') return undefined;
  const k = stitchKey(n, { terms });
  if (!k) return undefined;
  const a = n.into[0];
  const where = !a ? '' : 'space' in a ? '@sp' : '@st';
  const loop = n.loop ? `/${n.loop}` : '';
  // a second leg into the same place as the previous node (inc, shell, V)
  const prev = graph.nodes[id - 1];
  const pa = prev?.into[0];
  const same = a && pa && prev.round === n.round && JSON.stringify(a) === JSON.stringify(pa) ? '+' : '';
  return `${k}${loop}${where}${same}`;
}

/** Best period of a token sequence: {start, period, reps} or undefined. */
export function findPeriod(tokens: string[], minReps = 2, minPeriod = 2): { start: number; period: number; reps: number } | undefined {
  const n = tokens.length;
  let best: { start: number; period: number; reps: number } | undefined;
  let bestCover = 0;
  for (let p = minPeriod; p <= n / 2; p++) {
    // longest run of i with tokens[i] === tokens[i+p]
    let runStart = 0;
    for (let i = 0; i <= n - p; i++) {
      const match = i < n - p && tokens[i] === tokens[i + p];
      if (!match) {
        const len = i - runStart + p; // periodic region [runStart, i + p)
        const reps = Math.floor(len / p);
        const cover = reps * p;
        if (reps >= minReps && cover > bestCover) { bestCover = cover; best = { start: runStart, period: p, reps }; }
        runStart = i + 1;
      }
    }
  }
  return best;
}

export function roundRepeats(graph: Graph, r: number, terms: Terms = 'US'): RoundRepeats | undefined {
  const R = graph.rounds[r];
  if (!R || R.first < 0) return undefined;
  const ids: number[] = [];
  const toks: string[] = [];
  for (let i = R.first; i <= R.last; i++) {
    const t = token(graph, i, terms);
    if (t !== undefined) { ids.push(i); toks.push(t); }
  }
  const f = findPeriod(toks);
  if (!f || f.reps * f.period < toks.length * 0.5) return undefined;
  // a period whose tokens are all alike is just "the same stitch around": no repeat to report
  const unit = toks.slice(f.start, f.start + f.period);
  if (unit.every((t) => t === unit[0])) return undefined;
  const byNode = new Map<number, RepeatPos>();
  for (let k = 0; k < f.reps * f.period; k++) {
    byNode.set(ids[f.start + k], { index: Math.floor(k / f.period) + 1, total: f.reps });
  }
  return { period: f.period, total: f.reps, byNode };
}
