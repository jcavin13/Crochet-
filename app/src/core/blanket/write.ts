/**
 * Writing helpers: turn a stream of per-target operations into short, readable notation
 * ("sc in next 37 sts", "*2 sc in next row end, sc in next row end* x40"), and row lists into
 * range labels ("Rows 2-120:", "Rows 2-120 (even):" + "Rows 3-121 (odd):").
 *
 * Everything written here must parse and compile to exactly what the engine simulated; the
 * blanket tests compile every generated pattern to check that.
 */

/** A run of identical operations: `phrase(n)` writes n of them ("sc in next 5 sts"). */
export interface Seg {
  key: string;
  n: number;
  phrase: (n: number) => string;
  /** a fixed piece (corner group, turning chain): never merged or repeated */
  fixed?: boolean;
}

/** Merge consecutive segments with the same key. */
export function mergeRuns(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && !last.fixed && !s.fixed && last.key === s.key) out[out.length - 1] = { ...last, n: last.n + s.n };
    else out.push({ ...s });
  }
  return out;
}

const segText = (s: Seg) => s.phrase(s.n);
const sameSeg = (a: Seg, b: Seg) => !a.fixed && !b.fixed && a.key === b.key && a.n === b.n;

/** Best periodic stretch of `runs` (period ≤ maxP, at least 2 repetitions), by segments saved. */
function bestPeriod(runs: Seg[], minP: number, maxP: number, eq: (a: Seg, b: Seg) => boolean): { start: number; period: number; reps: number } | undefined {
  let best: { start: number; period: number; reps: number; save: number } | undefined;
  for (let p = minP; p <= maxP; p++) {
    for (let start = 0; start + 2 * p <= runs.length; start++) {
      let reps = 1;
      while (start + (reps + 1) * p <= runs.length) {
        let ok = true;
        for (let k = 0; k < p; k++) if (!eq(runs[start + k], runs[start + reps * p + k])) { ok = false; break; }
        if (!ok) break;
        reps++;
      }
      if (reps < 2) continue;
      const save = (reps - 1) * p;
      if (!best || save > best.save) best = { start, period: p, reps, save };
    }
  }
  return best;
}

/** Level 1: periodic stretches of 2–3 runs become "(a, b) xN" groups (repeated until none left). */
function groupRepeats(runs: Seg[]): Seg[] {
  let cur = runs;
  for (let guard = 0; guard < 50; guard++) {
    const b = bestPeriod(cur, 2, 3, sameSeg);
    if (!b) return cur;
    const body = cur.slice(b.start, b.start + b.period);
    // a group may not contain a star repeat or another group (one level each)
    if (body.some((x) => x.key.startsWith('grp:'))) return cur;
    const inner = body.map(segText).join(', ');
    const g: Seg = { key: `grp:${inner}:${b.reps}`, n: 1, phrase: () => `(${inner}) x${b.reps}` };
    cur = [...cur.slice(0, b.start), g, ...cur.slice(b.start + b.period * b.reps)];
  }
  return cur;
}

/**
 * Text of a run list: runs merged ("sc in next 5 sts"), short periodic stretches grouped
 * ("(3 dc in next ch-1 sp, ch 1) x4"), and the longest-saving periodic stretch of what is left
 * written as a star repeat ("*…* x3"). The notation allows a group inside a star repeat, not a
 * star inside a star.
 */
export function writeSegs(segs: Seg[], allowRepeat = true): string {
  let runs = mergeRuns(segs);
  if (!allowRepeat) return runs.map(segText).join(', ');
  runs = groupRepeats(runs);
  const eq = (a: Seg, b: Seg) => a.key === b.key && a.n === b.n && (!a.fixed || a.phrase(a.n) === b.phrase(b.n));
  const best = bestPeriod(runs, 1, 16, eq);
  if (!best || (best.period === 1 && !runs[best.start].fixed && !runs[best.start].key.startsWith('grp:'))) return runs.map(segText).join(', ');
  const pre = runs.slice(0, best.start).map(segText);
  const body = runs.slice(best.start, best.start + best.period).map(segText).join(', ');
  const post = runs.slice(best.start + best.period * best.reps).map(segText);
  return [...pre, `*${body}* x${best.reps}`, ...post].join(', ');
}

/* ------------------------------------------------------------------ phrases */

export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** "sc in next st" / "sc in next 5 sts" / "2 sc in each of next 5 sts" */
export function intoNext(stitch: string, perTarget: number, unitOne: string, unitMany: string, n: number): string {
  const per = perTarget === 1 ? '' : `${perTarget} `;
  if (n === 1) return `${per}${stitch} in next ${unitOne}`;
  if (perTarget === 1) return `${stitch} in next ${n} ${unitMany}`;
  return `${per}${stitch} in each of next ${n} ${unitMany}`;
}

/* ------------------------------------------------------------------ row ranges */

export interface RowLine {
  /** row (or round) number */
  n: number;
  text: string;
  /** count annotation, e.g. "(40)" — part of the identity of a line */
  count: string;
  /** comment lines to put before this row (colour changes), already without '#' */
  comments?: string[];
}

/**
 * Lines for consecutive rows. Identical rows become a range ("Rows 3-120: …"); a stretch that
 * alternates between two instructions becomes an odd/even pair ("Rows 2-120 (even): …" and
 * "Rows 3-121 (odd): …"). A row with comments always starts a new block.
 */
export function rowRanges(rows: RowLine[], word: 'Row' | 'Rnd'): string[] {
  const out: string[] = [];
  const plural = word === 'Row' ? 'Rows' : 'Rnds';
  const body = (r: RowLine) => `${r.text}.${r.count ? ` ${r.count}` : ''}`;
  let i = 0;
  while (i < rows.length) {
    for (const c of rows[i].comments ?? []) out.push(`# ${c}`);
    // block: rows i..j-1 with no comments inside (after the first)
    let j = i + 1;
    while (j < rows.length && !(rows[j].comments && rows[j].comments!.length)) j++;
    const block = rows.slice(i, j);
    let k = 0;
    while (k < block.length) {
      const a = block[k];
      // identical run
      let e = k + 1;
      while (e < block.length && body(block[e]) === body(a)) e++;
      if (e - k >= 2 || k + 1 >= block.length) {
        out.push(e - k === 1 ? `${word} ${a.n}: ${body(a)}` : `${plural} ${a.n}-${block[e - 1].n}: ${body(a)}`);
        k = e;
        continue;
      }
      // alternating run a, b, a, b, …
      const b = block[k + 1];
      let f = k + 2;
      while (f < block.length && body(block[f]) === body(block[f - 2])) f++;
      const len = f - k;
      if (len >= 4 && body(a) !== body(b)) {
        const lastA = (len - 1) % 2 === 0 ? block[f - 1] : block[f - 2];
        const lastB = (len - 1) % 2 === 1 ? block[f - 1] : block[f - 2];
        const par = (n: number) => (n % 2 === 0 ? 'even' : 'odd');
        out.push(`${plural} ${a.n}-${lastA.n} (${par(a.n)}): ${body(a)}`);
        out.push(`${plural} ${b.n}-${lastB.n} (${par(b.n)}): ${body(b)}`);
        k = f;
        continue;
      }
      out.push(`${word} ${a.n}: ${body(a)}`);
      k++;
    }
    i = j;
  }
  return out;
}
