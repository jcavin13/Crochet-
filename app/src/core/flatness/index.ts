/**
 * Analytic flatness check — implementation of spec/flatness.md.
 * Pure function of (graph, params); no simulation.
 */
import type { Graph, Node } from '../graph';
import { stitchCounting } from '../graph';
import { simConfig, stitchParam, heightOf, type ParamSet } from '../params';

export type ShapeClass = 'flat' | 'cup' | 'ruffle';
export type RoundClass = ShapeClass | 'n/a';

export interface RoundFlatness {
  round: number;            // index into graph.rounds
  label: string;
  class: RoundClass;
  /** Relative excess of course length over 2πρ: bounds from chain compliance, and nominal. */
  eMin: number; eMax: number; e: number;
  /** Signed: stitches over (+) or under (−) flat; 0 when flat or n/a. */
  stitchesOff: number;
  /** Stitch-top radius and radius handed to the next round (params units, mm). */
  rho: number; r: number;
  /** Incremental ratio: are this round's increases right for flat? (−1 tube … 0 flat … >0 ruffling). NaN for round 1. */
  g: number;
  cMin: number; cMax: number; c: number;
  /**
   * Signed stitches over (+) / under (−) flat at the *nominal* course length, for every
   * classified round — also for flat ones ("flat (+3 sts, within tolerance)"). 0 for n/a.
   */
  stitchesNominal: number;
  /**
   * The round is classified flat only thanks to chain compliance: its nominal excess `e` is
   * outside ±tol, but the chain-slack band [eMin, eMax] reaches back inside it. Such a round lies
   * flat only if its loops sag (e > tol: long, floppy loops) or are pulled taut (e < −tol).
   */
  slackOnly: boolean;
  /**
   * A cupping round that is far beyond a "fix a few stitches" correction: its stitch count is
   * decreasing (the shape is closing, as in a ball) or it is more than `closing_e` under flat
   * (a tube, cone or deep bowl). The message then says it is a 3D form instead of quoting an
   * absurd deficit. Numeric fields are unchanged.
   */
  closing: boolean;
  message: string;
}
export interface FlatnessReport {
  rounds: RoundFlatness[];
  /** Class of the last classifiable round ('n/a' if none). */
  final: RoundClass;
  /** The classifiable round furthest from flat, if any round is not flat. */
  worst: RoundFlatness | null;
  /** False when the piece is worked in rows (no centre): everything is n/a. */
  applicable: boolean;
}
export interface FlatnessOptions { tol?: number; chainSlackMin?: number; chainNominal?: number }

const TAU = 2 * Math.PI;
/**
 * |e| beyond this (as a fraction): on a cupping round, a 3D form rather than a fixable flat piece;
 * on a round flat only by chain slack, "long, floppy loops" rather than loops that sag a little.
 */
export const CLOSING_E = 0.5;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function analyzeFlatness(graph: Graph, params: ParamSet, opts: FlatnessOptions = {}): FlatnessReport {
  const tol = opts.tol ?? simConfig.flatness.tol;
  const slack = opts.chainSlackMin ?? simConfig.flatness.chain_slack_min;
  const nominal = opts.chainNominal ?? simConfig.flatness.chain_nominal;
  const wch = stitchParam(params, 'ch').width;

  // chain id -> its chsp (only chsp chains are course elements); ring start radius
  const chspOf = new Map<number, number>();
  for (const s of graph.spaces) if (s.kind === 'chsp') for (const c of s.chains) chspOf.set(c, s.id);
  const firstRing = graph.spaces.find((s) => s.kind === 'ring');
  const inRound = graph.rounds.some((r) => r.kind === 'round') && !graph.rounds.some((r) => r.kind === 'row');

  const out: RoundFlatness[] = [];
  let rPrev = firstRing ? (firstRing.chains.length * wch) / TAU : 0;
  let rhoPrev = rPrev, cPrev = 0, k = 0, countPrev = -1;

  for (const round of graph.rounds) {
    const nodes: Node[] = round.first < 0 ? [] : graph.nodes.slice(round.first, round.last + 1);
    const st = nodes.filter(stitchCounting);
    // A turning chain that counts as X occupies the course like an X (flatness.md).
    const sumW = st.reduce((a, n) => a + stitchParam(params, n.countsAs ?? n.type).width, 0);
    const spaceIds = new Set<number>();
    let nCh = 0;
    for (const n of nodes) if (n.type === 'ch' && chspOf.has(n.id)) { nCh++; spaceIds.add(chspOf.get(n.id)!); }
    const base: RoundFlatness = {
      round: round.index, label: round.label, class: 'n/a', eMin: 0, eMax: 0, e: 0, stitchesOff: 0,
      rho: rhoPrev, r: rPrev, g: NaN, cMin: 0, cMax: 0, c: 0, stitchesNominal: 0, slackOnly: false, closing: false, message: `${round.label}: not worked in the round — flatness does not apply.`,
    };
    if (!inRound || round.kind !== 'round' || (st.length === 0 && nCh === 0)) { out.push(base); continue; }
    k++;
    const hBar = mean(st.map((n) => heightOf(params, n)));
    const cMax = sumW + nCh * wch, cMin = sumW + nCh * wch * slack, c = sumW + nCh * wch * nominal;
    const magicStart = k === 1 && rPrev === 0;
    const rho = magicStart ? Math.max(hBar, c / TAU) : rPrev + hBar;
    let rise = 0;
    if (spaceIds.size > 0) {
      const d = Math.max(0, TAU * rho - sumW) / spaceIds.size;
      const L = (nCh / spaceIds.size) * wch;
      if (L > d) rise = 0.5 * Math.sqrt(L * L - d * d);
    }
    const need = TAU * rho;
    const eMax = cMax / need - 1, eMin = cMin / need - 1, e = c / need - 1;
    const wBar = st.length ? sumW / st.length : wch;
    let cls: ShapeClass = 'flat', off = 0;
    if (eMax < -tol) { cls = 'cup'; off = (cMax - need) / wBar; }
    else if (eMin > tol) { cls = 'ruffle'; off = (cMin - need) / wBar; }
    const g = k === 1 || rho === rhoPrev ? NaN : (c - cPrev) / (TAU * (rho - rhoPrev)) - 1;
    const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)}%`;
    const nOff = Math.max(1, Math.round(Math.abs(off)));
    const nominalOff = (c - need) / wBar;
    const slackOnly = cls === 'flat' && Math.abs(e) > tol;
    const decreasing = countPrev >= 0 && round.stitchCount < countPrev;
    const closing = cls === 'cup' && (decreasing || eMax < -CLOSING_E);
    const sts = (n: number) => `${n} stitch${n === 1 ? '' : 'es'}`;
    let message: string;
    if (cls === 'flat') {
      const n = Math.round(nominalOff);
      if (slackOnly && e > CLOSING_E) {
        message = `${round.label} lies flat only if its chain loops take up the slack (${pct(e)} at nominal loop length) — expect long, floppy loops.`;
      } else if (slackOnly && e > 0) {
        message = `${round.label} lies flat only if its chain loops sag a little (${pct(e)} at nominal loop length).`;
      } else if (slackOnly) {
        message = `${round.label} lies flat only if its chain loops are pulled taut (${pct(e)} at nominal loop length) — expect tight, strained loops.`;
      } else {
        message = n === 0 ? `${round.label} lies flat.` : `${round.label} lies flat (${n > 0 ? '+' : '−'}${Math.abs(n)} sts, within tolerance).`;
      }
    } else if (closing) {
      message = decreasing
        ? `${round.label} closes the shape (far under flat) — this is a 3D form, not a flat piece.`
        : `${round.label} is far under flat (${pct(eMax)}) — this is a 3D form (tube, cone or deep bowl), not a flat piece.`;
    } else if (cls === 'cup') {
      message = `${round.label} will cup: about ${sts(nOff)} under flat (${pct(eMax)}).`;
    } else {
      message = `${round.label} will ruffle: about ${sts(nOff)} over flat (${pct(eMin)}).`;
    }
    out.push({
      round: round.index, label: round.label, class: cls, eMin, eMax, e, stitchesOff: off, rho, r: rho + rise, g, cMin, cMax, c,
      stitchesNominal: nominalOff, slackOnly, closing, message,
    });
    countPrev = round.stitchCount;
    rPrev = rho + rise; rhoPrev = rho; cPrev = c;
  }
  const real = out.filter((r) => r.class !== 'n/a');
  const dev = (r: RoundFlatness) => (r.class === 'cup' ? -r.eMax : r.class === 'ruffle' ? r.eMin : 0);
  const bad = real.filter((r) => r.class !== 'flat').sort((a, b) => dev(b) - dev(a));
  return { rounds: out, final: real.length ? real[real.length - 1].class : 'n/a', worst: bad[0] ?? null, applicable: real.length > 0 };
}
