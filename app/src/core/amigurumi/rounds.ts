/**
 * Round planning shared by the surface-of-revolution generator and the gauge calculators:
 * spread a round's increases/decreases evenly, stagger them against the rounds below, compress the
 * stitch sequence into readable notation, and assemble a `.cro` pattern (spec/notation.md).
 * Pure; no DOM.
 */

export type AmiStitch = 'sc' | 'hdc' | 'dc';
export const AMI_STITCHES: AmiStitch[] = ['sc', 'hdc', 'dc'];
/** One "unit" of a round: a plain stitch, an increase (2 into 1) or a decrease (1 from 2). */
export type Unit = 'st' | 'inc' | 'dec';

export interface SpreadResult {
  units: Unit[];
  /** Angular position (0..1 around the round) of each increase/decrease. */
  angles: number[];
  /** Rotation applied to the evenly spaced base sequence (0 = textbook "*n sc, inc*"). */
  offset: number;
}

const circ = (a: number, b: number) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };

/** Angular positions of the specials of a unit sequence (output stitch positions / count). */
export function specialAngles(units: Unit[], count: number): number[] {
  const out: number[] = [];
  let q = 0;
  for (const u of units) {
    if (u === 'inc') { out.push(((q + 1) / count) % 1); q += 2; }
    else if (u === 'dec') { out.push(((q + 0.5) / count) % 1); q += 1; }
    else q += 1;
  }
  return out;
}

/**
 * Units that turn a round of `prev` stitches into one of `next`.
 *
 * Even spacing (Bresenham): with m units of which d are special, unit i is special when
 * ⌊(i+1)·d/m⌋ > ⌊i·d/m⌋. That puts one special at the end of each of d blocks whose lengths differ
 * by at most one, cyclically — the textbook "*3 sc, inc* x6" when d divides m.
 *
 * Staggering (the "hexagon problem"): if every round starts its blocks at the same place, each
 * increase sits on top of the one below and the piece grows d visible corners. With `stagger`,
 * the block sequence is rotated by the offset that places this round's specials as far as possible
 * (in angle around the round) from those of the previous inc/dec round — i.e. midway between them
 * — with the round before that as a weaker tie-breaker (score = d₁ + ½·d₂ of the smallest angular
 * distances). For a constant +6 sphere this alternates half-a-repeat shifts, the usual "start every
 * other round with half the sc" trick; for changing d it finds the best fit on the stitch grid.
 * Rotation keeps the cyclic gaps, so spacing stays even. `history[0]` is the most recent.
 */
export function spreadEvenly(prev: number, next: number, opts: { stagger?: boolean; history?: number[][] } = {}): SpreadResult {
  if (next === prev || prev <= 0) return { units: Array(Math.max(next, 0)).fill('st'), angles: [], offset: 0 };
  const inc = next > prev;
  if (inc && next > 2 * prev) throw new Error(`cannot grow ${prev} → ${next} in one round (more than doubling)`);
  if (!inc && next * 2 < prev) throw new Error(`cannot shrink ${prev} → ${next} in one round (more than halving)`);
  const d = inc ? next - prev : prev - next;
  const m = inc ? prev : next;
  const sp: Unit = inc ? 'inc' : 'dec';
  const base: Unit[] = Array.from({ length: m }, (_, i) => (Math.floor(((i + 1) * d) / m) > Math.floor((i * d) / m) ? sp : 'st'));
  const baseAngles = specialAngles(base, next);
  const hist = (opts.history ?? []).filter((h) => h.length > 0);
  let best = 0;
  if (opts.stagger && hist.length > 0 && d < m) {
    // output stitches produced by the first o units = the rotation's angular shift
    const outOf = (u: Unit) => (u === 'inc' ? 2 : 1);
    let shift = 0, bestScore = -Infinity;
    for (let o = 0; o < m; o++) {
      if (o > 0) shift += outOf(base[o - 1]);
      const angs = baseAngles.map((a) => (a - shift / next + 1) % 1);
      const minTo = (h: number[]) => { let mn = Infinity; for (const a of angs) for (const b of h) mn = Math.min(mn, circ(a, b)); return mn; };
      const score = minTo(hist[0]) + (hist[1] ? 0.5 * minTo(hist[1]) : 0);
      if (score > bestScore + 1e-9) { bestScore = score; best = o; }
    }
  }
  const units = best ? [...base.slice(best), ...base.slice(0, best)] : base;
  return { units, angles: specialAngles(units, next), offset: best };
}

/** Cyclic gaps (plain units) between consecutive specials. */
export function specialGaps(units: Unit[]): number[] {
  const idx = units.map((u, i) => (u === 'st' ? -1 : i)).filter((i) => i >= 0);
  if (idx.length === 0) return [];
  return idx.map((p, j) => {
    const q = j + 1 < idx.length ? idx[j + 1] : idx[0] + units.length;
    return q - p - 1;
  });
}

/* ------------------------------------------------------------------ compression */

export function unitName(u: Unit, stitch: AmiStitch): string {
  if (u === 'st') return stitch;
  if (u === 'inc') return stitch === 'sc' ? 'inc' : `${stitch} inc`;
  return stitch === 'sc' ? 'dec' : `${stitch}2tog`;
}
function runText(u: Unit, n: number, stitch: AmiStitch): string {
  const name = unitName(u, stitch);
  if (n === 1) return name;
  return u === 'st' ? `${n} ${name}` : `${name} x${n}`;
}
function runsOf(units: Unit[], from: number, to: number): [Unit, number][] {
  const out: [Unit, number][] = [];
  for (let i = from; i < to; i++) {
    const last = out[out.length - 1];
    if (last && last[0] === units[i]) last[1]++;
    else out.push([units[i], 1]);
  }
  return out;
}

const MAX_PERIOD = 96;

/**
 * Shortest readable notation for a unit sequence: plain runs ("3 sc", "inc x2") and `*…* xN`
 * repeats where a block recurs (no nesting, per the notation). Dynamic programming over
 * positions; cost = number of items (a repeat costs its block's items + 1).
 */
export function compressUnits(units: Unit[], stitch: AmiStitch): string {
  const m = units.length;
  if (m === 0) return '';
  if (units.every((u) => u === 'st')) return `${stitch} in each st around`;
  // longest common extension of suffixes i and j (j > i), only for j - i <= MAX_PERIOD
  const P = Math.min(MAX_PERIOD, Math.floor(m / 2));
  const lce: Int32Array[] = Array.from({ length: P + 1 }, () => new Int32Array(m + 1));
  for (let p = 1; p <= P; p++) {
    const row = lce[p];
    for (let i = m - p - 1; i >= 0; i--) row[i] = units[i] === units[i + p] ? row[i + 1] + 1 : 0;
  }
  // number of runs in units[i..j): 1 + boundaries strictly inside
  const bnd = new Int32Array(m + 1);
  for (let i = 1; i < m; i++) bnd[i + 1] = bnd[i] + (units[i] !== units[i - 1] ? 1 : 0);
  const runsIn = (i: number, j: number) => 1 + (bnd[j] - bnd[i + 1]);

  const cost = new Float64Array(m + 1);
  const choice: ({ kind: 'run'; len: number } | { kind: 'rep'; p: number; n: number })[] = new Array(m + 1);
  cost[m] = 0;
  for (let i = m - 1; i >= 0; i--) {
    let best = Infinity, ch: (typeof choice)[number] = { kind: 'run', len: 1 };
    // a run of the same unit, any length (splitting runs can enable a repeat after it)
    for (let len = 1; i + len <= m && units[i + len - 1] === units[i]; len++) {
      // splitting a run ("2 sc, *5 sc…") reads worse than keeping it whole: small penalty
      const split = i + len < m && units[i + len] === units[i] ? 0.02 : 0;
      const c = 1 + split + cost[i + len];
      if (c < best - 1e-9) { best = c; ch = { kind: 'run', len }; }
    }
    for (let p = 2; p <= P && i + 2 * p <= m; p++) {
      const block = runsIn(i, i + p);
      if (block < 2) continue; // a block of one kind is just a run
      const nMax = 1 + Math.floor(lce[p][i] / p);
      for (let n = nMax; n >= 2; n--) {
        // tiny bonus for covering more with one repeat, so ties prefer the textbook form
        const c = block + 1.01 + cost[i + n * p] - 1e-4 * n;
        if (c < best - 1e-9) { best = c; ch = { kind: 'rep', p, n }; }
      }
    }
    cost[i] = best;
    choice[i] = ch;
  }
  const items: string[] = [];
  for (let i = 0; i < m;) {
    const ch = choice[i];
    if (ch.kind === 'run') { items.push(runText(units[i], ch.len, stitch)); i += ch.len; }
    else {
      const block = runsOf(units, i, i + ch.p).map(([u, n]) => runText(u, n, stitch)).join(', ');
      items.push(`*${block}* x${ch.n}`);
      i += ch.p * ch.n;
    }
  }
  return items.join(', ');
}

/* ------------------------------------------------------------------ pattern assembly */

export interface EmitRound {
  count: number;
  /** Round instructions without label and count, e.g. "*2 sc, inc* x6". */
  text: string;
  /** Comment line(s) printed before the round. */
  before?: string[];
  /** Appended after the instructions ("fasten off"). Prevents merging into a range. */
  trailing?: string;
}

export interface EmitOptions {
  header: [string, string][];
  preamble?: string[];
  foundation?: string;
  rounds: EmitRound[];
  after?: string[];
  /** 'Rnd' (default) or 'Row'. */
  label?: 'Rnd' | 'Row';
}

/** `.cro` text with `Rnds a-b:` ranges for consecutive identical rounds. Returns line numbers too. */
export function emitPattern(o: EmitOptions): { text: string; roundLine: number[] } {
  const lines: string[] = [];
  for (const c of o.preamble ?? []) lines.push(`# ${c}`);
  for (const [k, v] of o.header) lines.push(`${k}: ${v}`);
  lines.push('');
  if (o.foundation) lines.push(`Foundation: ${o.foundation}.`);
  const lab = o.label ?? 'Rnd';
  const roundLine: number[] = [];
  const rs = o.rounds;
  for (let i = 0; i < rs.length;) {
    let j = i;
    while (j + 1 < rs.length && !rs[j].trailing && !rs[j + 1].trailing && !rs[j + 1].before?.length && rs[j + 1].text === rs[i].text && rs[j + 1].count === rs[i].count) j++;
    for (const c of rs[i].before ?? []) lines.push(`# ${c}`);
    const label = j > i ? `${lab}s ${i + 1}-${j + 1}` : `${lab} ${i + 1}`;
    const body = rs[i].trailing ? `${rs[i].text}, ${rs[i].trailing}` : rs[i].text;
    lines.push(`${label}: ${body}. (${rs[i].count})`);
    for (let k = i; k <= j; k++) roundLine[k] = lines.length;
    i = j + 1;
  }
  for (const c of o.after ?? []) lines.push(`# ${c}`);
  return { text: lines.join('\n') + '\n', roundLine };
}

export function hookLabel(mm: number): string {
  return `${Number.isInteger(mm * 10) ? mm.toFixed(1) : String(+mm.toFixed(2))}mm`;
}
