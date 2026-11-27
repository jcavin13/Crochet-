/**
 * Yarn requirement estimates (spec/yarn.md). Pure; no DOM.
 *
 *   estimateYarn(pattern, params, { yarn, colorOfRound, uptoRound }) → totals, per round, by
 *     stitch, by colour, notes
 *   estimateYarnFromCounts(counts, params, { yarn })  — for pieces too large to compile
 *   remainingYarn(pattern, params, nodeIndex, opts)   — what is still to be worked (counter)
 *   resolveYarn / yarnDefaultsFor / calibrationFromSwatch(es) / units helpers
 *
 * Every figure is a model estimate: nominal (±20 %) until the user calibrates with a weighed
 * swatch. See ./README.md for the model and its limits.
 */
import type { Graph, Pattern } from '../graph';
import type { ParamSet } from '../params';
import {
  categoryKey, diameterFor, nodeParts, partsLength, yarnDefaults, type Band, type Category, type NodeLike,
} from './model';
import { ballsNeeded, metersToGrams } from './units';

export * from './units';
export * from './calibrate';
export { yarnDefaults, coefficients, nodeParts, partsLength, categoryKey, diameterFor, TCH } from './model';
export type { Coeffs, Parts, NodeLike, Category, Band, YarnDefaults } from './model';

/** The yarn being used. Everything optional: sensible defaults come from the param set's weight. */
export interface YarnSpec {
  /** Metres per 100 g (on the ball band). */
  metersPer100g?: number;
  /** Grams per ball / skein. */
  ballGrams?: number;
  /** Extra allowance for tails, gauge swatch and tension drift, fraction (default 0.10). */
  allowance?: number;
  /** Personal calibration factor from a weighed swatch (1 = model default). */
  calibration?: number;
  label?: string;
  /** Separate factors on the loop (a·w + π·e·d) and height (b·h) terms, from two swatches of different stitches. Wins over `calibration`. */
  calibrationSplit?: { width: number; height: number };
  /** Yarn weight category key of spec/yarn_defaults.json ('medium-4', 'thread-10', …). Default: the param set's. */
  category?: string;
  /** Yarn diameter (mm). Default: the category's, scaled by m/100 g. */
  diameterMm?: number;
  /** id in the user's "my yarns" list, if picked from there. */
  id?: string;
}

export interface YarnAmount {
  meters: number;
  /** Low / high bounds reflecting model uncertainty. */
  metersLow: number;
  metersHigh: number;
  grams?: number;
  balls?: number;
  gramsLow?: number;
  gramsHigh?: number;
}

/** A YarnSpec with every default filled in. */
export interface ResolvedYarn {
  label: string;
  category: string;
  categoryLabel: string;
  metersPer100g: number;
  ballGrams: number;
  allowance: number;
  diameterMm: number;
  kWidth: number;
  kHeight: number;
  status: 'nominal' | 'calibrated';
  band: Band;
  /** True where the value is the category's typical one, not the user's. */
  defaulted: { metersPer100g: boolean; ballGrams: boolean };
  id?: string;
}

export interface BallBreak {
  /** Ball number that starts here (2 = the second ball). */
  ball: number;
  nodeIndex: number;
  round: number;
  label: string;
}

export interface YarnEstimate {
  /** Total including allowance. */
  total: YarnAmount;
  /** Without allowance. */
  net: YarnAmount;
  /** Per round / row, net, in working order (index = graph.rounds index). */
  perRound: { round: number; label: string; meters: number; cumulative: number }[];
  /** Net metres by stitch type. */
  byStitch: Record<string, number>;
  /** When the caller supplied colour assignments: net amounts per colour key. */
  byColor?: Record<string, YarnAmount>;
  /** Plain-language notes: what the estimate assumes and how uncertain it is. */
  notes: string[];
  status: 'nominal' | 'calibrated';
  /** The yarn the estimate was made for (all defaults resolved). */
  yarn?: ResolvedYarn;
  /** Where a new ball of `yarn.ballGrams` is needed (net yarn, from a full first ball). */
  ballBreaks?: BallBreak[];
  /** Number of stitches (graph nodes) counted. */
  stitches?: number;
}

export interface YarnOptions {
  yarn?: YarnSpec;
  /** Colour key per round index (for stripes); rounds not listed use 'main'. */
  colorOfRound?: (round: number) => string;
  /** Estimate only rounds 0..uptoRound. */
  uptoRound?: number;
}

/* ------------------------------------------------------------------ yarn */

/** Typical yarn of a param set's weight category (spec/yarn_defaults.json). */
export function yarnDefaultsFor(params: Pick<ParamSet, 'yarn_weight'> | undefined): Category & { key: string } {
  const key = categoryKey(params?.yarn_weight);
  return { key, ...yarnDefaults.categories[key] };
}

const pos = (x: number | undefined): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

/** Fill in every default of a YarnSpec for a param set. */
export function resolveYarn(params: ParamSet, yarn: YarnSpec = {}): ResolvedYarn {
  const cat = yarn.category && yarnDefaults.categories[yarn.category] ? { key: yarn.category, ...yarnDefaults.categories[yarn.category] } : yarnDefaultsFor(params);
  const metersPer100g = pos(yarn.metersPer100g) ? yarn.metersPer100g : cat.m_per_100g;
  const ballGrams = pos(yarn.ballGrams) ? yarn.ballGrams : cat.ball_g;
  const split = yarn.calibrationSplit && pos(yarn.calibrationSplit.width) && pos(yarn.calibrationSplit.height) ? yarn.calibrationSplit : undefined;
  const single = pos(yarn.calibration) ? yarn.calibration : undefined;
  const kWidth = split ? split.width : single ?? 1;
  const kHeight = split ? split.height : single ?? 1;
  const status = split || single !== undefined ? 'calibrated' : 'nominal';
  const band = split ? yarnDefaults.band.calibrated_split : status === 'calibrated' ? yarnDefaults.band.calibrated : yarnDefaults.band.nominal;
  return {
    label: yarn.label || `Typical ${cat.label.replace(/\s*\(.*\)$/, '').toLowerCase()}`,
    category: cat.key, categoryLabel: cat.label,
    metersPer100g, ballGrams,
    allowance: typeof yarn.allowance === 'number' && yarn.allowance >= 0 ? yarn.allowance : yarnDefaults.allowance,
    diameterMm: pos(yarn.diameterMm) ? yarn.diameterMm : diameterFor(cat.key, pos(yarn.metersPer100g) ? yarn.metersPer100g : undefined),
    kWidth, kHeight, status, band,
    defaulted: { metersPer100g: !pos(yarn.metersPer100g), ballGrams: !pos(yarn.ballGrams) },
    id: yarn.id,
  };
}

/** Length of one node (mm) for a resolved yarn. */
export function nodeLengthMm(n: NodeLike, params: ParamSet, yarn: ResolvedYarn): number {
  return partsLength(nodeParts(n, params, yarn.diameterMm), yarn.kWidth, yarn.kHeight);
}

/** Amount with band, grams and (fractional) balls. */
export function yarnAmount(meters: number, yarn: ResolvedYarn): YarnAmount {
  const g = (m: number) => metersToGrams(m, yarn.metersPer100g);
  return {
    meters, metersLow: meters * yarn.band.low, metersHigh: meters * yarn.band.high,
    grams: g(meters), gramsLow: g(meters * yarn.band.low), gramsHigh: g(meters * yarn.band.high),
    balls: g(meters) / yarn.ballGrams,
  };
}

/* ------------------------------------------------------------------ keys */

/**
 * Key of a node in `byStitch` (US terms): 'ch', 'turning ch', 'sl st', 'sc', 'dc2tog', 'fpdc',
 * '3-dc cl', 'puff', 'pc', 'picot'; non-default loop / leg / chain counts are spelled out
 * ('puff 4-loop', 'pc 6-dc', 'picot ch-5'). The same keys are accepted by estimateYarnFromCounts.
 */
export function yarnKey(n: NodeLike): string {
  if (n.type === 'ch') return n.role === 'tch' || n.countsAs ? 'turning ch' : 'ch';
  if (n.type === 'slst') return 'sl st';
  if (n.type === 'puff') return n.loops && n.loops !== 3 ? `puff ${n.loops}-loop` : 'puff';
  if (n.type === 'popcorn') return n.legs && n.legs !== 5 ? `pc ${n.legs}-dc` : 'pc';
  if (n.type === 'picot') return n.chains && n.chains !== 3 ? `picot ch-${n.chains}` : 'picot';
  const post = n.loop === 'fp' || n.loop === 'bp' ? n.loop : '';
  if (n.tag === 'cluster') return `${post}${n.into.length}-${n.type} cl`;
  if (n.into.length >= 2) return `${post}${n.type}${n.into.length}tog`;
  return `${post}${n.type}`;
}

/** Inverse of yarnKey (also accepts plain stitch ids such as 'slst' and graph stitchKey()s such as 'cl'). */
export function nodeFromKey(key: string): NodeLike | undefined {
  const k = key.trim().toLowerCase();
  const legs = (n: number) => Array.from({ length: n }, () => ({ node: 0 }));
  if (k === 'ch' || k === 'chain') return { type: 'ch', into: [] };
  if (k === 'turning ch' || k === 'tch') return { type: 'ch', into: [], role: 'tch' };
  if (k === 'sl st' || k === 'slst' || k === 'ss') return { type: 'slst', into: legs(1) };
  let m = /^puff(?: (\d+)-loop)?$/.exec(k);
  if (m) return { type: 'puff', into: legs(1), loops: m[1] ? +m[1] : undefined };
  m = /^(?:pc|popcorn)(?: (\d+)-dc)?$/.exec(k);
  if (m) return { type: 'popcorn', into: legs(1), legs: m[1] ? +m[1] : undefined };
  m = /^picot(?: ch-(\d+))?$/.exec(k);
  if (m) return { type: 'picot', into: [], chains: m[1] ? +m[1] : undefined };
  if (k === 'cl' || k === 'bobble') return { type: 'dc', into: legs(k === 'cl' ? 3 : 5), tag: 'cluster' };
  m = /^(fp|bp)?(\d+)-(sc|hdc|dc|tr|dtr) cl$/.exec(k);
  if (m) return { type: m[3] as NodeLike['type'], into: legs(+m[2]), tag: 'cluster', loop: (m[1] || undefined) as NodeLike['loop'] };
  m = /^(fp|bp)?(sc|hdc|dc|tr|dtr)(?:(\d+)tog)?$/.exec(k);
  if (m) return { type: m[2] as NodeLike['type'], into: legs(m[3] ? +m[3] : 1), loop: (m[1] || undefined) as NodeLike['loop'] };
  return undefined;
}

/* ------------------------------------------------------------------ estimates */

/** Per-node net lengths (m) of a graph, in working order. */
export function nodeLengths(graph: Graph, params: ParamSet, yarn: ResolvedYarn): Float64Array {
  const out = new Float64Array(graph.nodes.length);
  for (let i = 0; i < graph.nodes.length; i++) out[i] = nodeLengthMm(graph.nodes[i], params, yarn) / 1000;
  return out;
}

/** Where each new ball starts, from per-node lengths (m) and a ball of `ballMeters`. */
export function ballBreaksOf(graph: Graph, lengths: ArrayLike<number>, ballMeters: number, max = 60): BallBreak[] {
  const out: BallBreak[] = [];
  if (!(ballMeters > 0)) return out;
  let cum = 0;
  let next = ballMeters;
  for (let i = 0; i < lengths.length && out.length < max; i++) {
    cum += lengths[i];
    while (cum > next + 1e-12 && out.length < max) {
      const n = graph.nodes[i];
      out.push({ ball: out.length + 2, nodeIndex: i, round: n.round, label: graph.rounds[n.round]?.label ?? `#${n.round}` });
      next += ballMeters;
    }
  }
  return out;
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)} %`;

function baseNotes(yarn: ResolvedYarn): string[] {
  const notes: string[] = [];
  if (yarn.status === 'nominal') {
    notes.push(`Nominal estimate from stitch sizes and a model of how each stitch is built — not yet checked against real yarn. Your tension can easily move it by ${pct(yarn.band.high - 1)}; weigh a swatch to calibrate.`);
  } else {
    notes.push(`Calibrated with your swatch${yarn.kWidth !== yarn.kHeight ? 'es' : ''} (×${yarn.kWidth.toFixed(2)}${yarn.kWidth !== yarn.kHeight ? ` loops, ×${yarn.kHeight.toFixed(2)} height` : ''}); expect about ±${pct(yarn.band.high - 1)}.`);
  }
  if (yarn.defaulted.metersPer100g) notes.push(`Grams assume ${yarn.metersPer100g} m per 100 g, typical for ${yarn.categoryLabel.toLowerCase()} — check your ball band.`);
  notes.push(`Allowance of ${pct(yarn.allowance)} on top for tails, the gauge swatch and tension drift.`);
  return notes;
}

/** Yarn for a compiled pattern (rounds 0..uptoRound). */
export function estimateYarn(pattern: Pattern, params: ParamSet, opts: YarnOptions = {}): YarnEstimate {
  const yarn = resolveYarn(params, opts.yarn);
  const g = pattern.graph;
  const upto = Math.min(opts.uptoRound ?? g.rounds.length - 1, g.rounds.length - 1);
  const perRoundM = new Float64Array(Math.max(0, upto + 1));
  const byStitch: Record<string, number> = {};
  const byColorM: Record<string, number> = {};
  const lengths: number[] = [];
  let net = 0;
  let count = 0;
  let posts = 0;
  for (const n of g.nodes) {
    if (n.round > upto) continue;
    const L = nodeLengthMm(n, params, yarn) / 1000;
    lengths.push(L);
    net += L;
    count++;
    if (n.loop === 'fp' || n.loop === 'bp') posts++;
    perRoundM[n.round] += L;
    const k = yarnKey(n);
    byStitch[k] = (byStitch[k] ?? 0) + L;
    if (opts.colorOfRound) {
      const c = opts.colorOfRound(n.round) || 'main';
      byColorM[c] = (byColorM[c] ?? 0) + L;
    }
  }
  let cum = 0;
  const perRound = Array.from(perRoundM, (m, r) => {
    cum += m;
    return { round: r, label: g.rounds[r]?.label ?? `#${r}`, meters: m, cumulative: cum };
  });
  const notes = baseNotes(yarn);
  if (g.spaces.some((s) => s.kind === 'ring' && s.chains.length === 0)) notes.push('The magic ring itself and the yarn tails are not counted (the allowance covers them).');
  if (posts) notes.push(`${posts} post stitch${posts === 1 ? '' : 'es'} counted at +20 % (a guess).`);
  const subset = { ...g, nodes: g.nodes.filter((n) => n.round <= upto) };
  const est: YarnEstimate = {
    total: yarnAmount(net * (1 + yarn.allowance), yarn),
    net: yarnAmount(net, yarn),
    perRound, byStitch, notes, status: yarn.status, yarn, stitches: count,
    ballBreaks: ballBreaksOf(subset, lengths, (yarn.ballGrams * yarn.metersPer100g) / 100),
  };
  if (opts.colorOfRound) est.byColor = Object.fromEntries(Object.entries(byColorM).map(([c, m]) => [c, yarnAmount(m, yarn)]));
  return est;
}

/**
 * Estimate from stitch counts alone (no graph) — for pieces too large to compile, e.g. a blanket
 * described as "180 rows of 150 dc". `counts` maps stitch key → number of stitches; keys are
 * stitch type ids ('sc', 'ch', 'slst', …) or yarnKey()s ('turning ch', 'sc2tog', 'fpdc', '3-dc cl',
 * 'puff 4-loop', …). Unknown keys are skipped and listed in the notes.
 */
export function estimateYarnFromCounts(counts: Record<string, number>, params: ParamSet, opts: Pick<YarnOptions, 'yarn'> = {}): YarnEstimate {
  const yarn = resolveYarn(params, opts.yarn);
  const byStitch: Record<string, number> = {};
  const unknown: string[] = [];
  let net = 0, count = 0;
  for (const [key, num] of Object.entries(counts)) {
    if (!(num > 0)) continue;
    const n = nodeFromKey(key);
    if (!n) { unknown.push(key); continue; }
    const L = (num * nodeLengthMm(n, params, yarn)) / 1000;
    const k = yarnKey(n);
    byStitch[k] = (byStitch[k] ?? 0) + L;
    net += L;
    count += num;
  }
  const notes = baseNotes(yarn);
  notes.push('Estimated from stitch counts (no per-round breakdown).');
  if (unknown.length) notes.push(`Not counted (unknown stitch): ${unknown.join(', ')}.`);
  return {
    total: yarnAmount(net * (1 + yarn.allowance), yarn), net: yarnAmount(net, yarn),
    perRound: [], byStitch, notes, status: yarn.status, yarn, stitches: count,
  };
}

/** Stitch counts of a graph by yarnKey (feeds estimateYarnFromCounts; equal totals by construction). */
export function countsOf(graph: Graph): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of graph.nodes) { const k = yarnKey(n); out[k] = (out[k] ?? 0) + 1; }
  return out;
}

export interface RemainingYarn {
  /** Still to work from nodeIndex (inclusive) to the end, net and with allowance. */
  net: YarnAmount;
  total: YarnAmount;
  /** Net metres already worked (nodes before nodeIndex). */
  doneMeters: number;
  /** Fraction of the piece's yarn already used. */
  fraction: number;
  /** Next point where a full ball of the chosen size runs out (counted from a full first ball). */
  nextBreak?: BallBreak & { metersUntil: number };
  yarn: ResolvedYarn;
}

/** How much yarn is still needed from node `nodeIndex` on (the counter's position). */
export function remainingYarn(pattern: Pattern, params: ParamSet, nodeIndex: number, opts: YarnOptions = {}): RemainingYarn {
  const yarn = resolveYarn(params, opts.yarn);
  const L = nodeLengths(pattern.graph, params, yarn);
  return remainingFromLengths(pattern.graph, L, nodeIndex, yarn);
}

/** remainingYarn with precomputed nodeLengths (the counter recomputes on every tap). */
export function remainingFromLengths(graph: Graph, L: ArrayLike<number>, nodeIndex: number, yarn: ResolvedYarn): RemainingYarn {
  const i0 = Math.max(0, Math.min(nodeIndex, L.length));
  let done = 0, all = 0;
  for (let i = 0; i < L.length; i++) { all += L[i]; if (i < i0) done += L[i]; }
  const rest = all - done;
  const ballM = (yarn.ballGrams * yarn.metersPer100g) / 100;
  const nb = ballBreaksOf(graph, L, ballM).find((b) => b.nodeIndex >= i0);
  let nextBreak: RemainingYarn['nextBreak'];
  if (nb) nextBreak = { ...nb, metersUntil: Math.max(0, (nb.ball - 1) * ballM - done) };
  return {
    net: yarnAmount(rest, yarn), total: yarnAmount(rest * (1 + yarn.allowance), yarn),
    doneMeters: done, fraction: all > 0 ? done / all : 0, nextBreak, yarn,
  };
}

/**
 * Re-express an estimate for another yarn without the graph (e.g. a counts-based estimate the
 * caller made): metres scale with the calibration factors (approximately, by the single factor),
 * grams and balls follow the new m/100 g and ball size.
 */
export function rescaleEstimate(est: YarnEstimate, params: ParamSet, yarn: YarnSpec): YarnEstimate {
  const from = est.yarn ?? resolveYarn(params);
  const to = resolveYarn(params, yarn);
  const f = ((to.kWidth + to.kHeight) / 2) / ((from.kWidth + from.kHeight) / 2);
  const net = est.net.meters * f;
  const scaleMap = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v * f]));
  return {
    ...est,
    net: yarnAmount(net, to), total: yarnAmount(net * (1 + to.allowance), to),
    perRound: est.perRound.map((r) => ({ ...r, meters: r.meters * f, cumulative: r.cumulative * f })),
    byStitch: scaleMap(est.byStitch),
    byColor: est.byColor && Object.fromEntries(Object.entries(est.byColor).map(([k, v]) => [k, yarnAmount(v.meters * f, to)])),
    notes: [...baseNotes(to), ...est.notes.filter((n) => /counts|Not counted|post stitch|magic ring/.test(n))],
    status: to.status, yarn: to, ballBreaks: undefined,
  };
}

/** Balls to buy for an amount: { balls (whole, rounded up), exact }. */
export function ballsFor(amount: YarnAmount, yarn: ResolvedYarn) {
  return ballsNeeded(amount.grams ?? metersToGrams(amount.meters, yarn.metersPer100g), yarn.ballGrams);
}
