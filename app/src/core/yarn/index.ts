/**
 * CONTRACT STUB — yarn requirement estimates. Replaced by the real implementation; other
 * features code against these types.
 */
import type { Pattern } from '../graph';
import type { ParamSet } from '../params';

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
}

export interface YarnAmount {
  meters: number;
  /** Low / high bounds reflecting model uncertainty. */
  metersLow: number;
  metersHigh: number;
  grams?: number;
  balls?: number;
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
}

export interface YarnOptions {
  yarn?: YarnSpec;
  /** Colour key per round index (for stripes); rounds not listed use 'main'. */
  colorOfRound?: (round: number) => string;
  /** Estimate only rounds 0..uptoRound. */
  uptoRound?: number;
}

export function estimateYarn(_pattern: Pattern, _params: ParamSet, _opts: YarnOptions = {}): YarnEstimate {
  const zero = { meters: 0, metersLow: 0, metersHigh: 0 };
  return { total: zero, net: zero, perRound: [], byStitch: {}, notes: ['Yarn estimate pending.'], status: 'nominal' };
}

/**
 * Estimate from stitch counts alone (no graph) — for pieces too large to compile, e.g. a blanket
 * described as "180 rows of 150 dc". `counts` maps stitch type id → number of stitches.
 */
export function estimateYarnFromCounts(_counts: Record<string, number>, _params: ParamSet, _opts: Pick<YarnOptions, 'yarn'> = {}): YarnEstimate {
  return estimateYarn(undefined as never, _params);
}
