/**
 * Calibration from weighed swatches (spec/yarn.md §4; lab mirror: crolab.yarn.fit_calibration).
 *
 * A swatch is worked flat: a foundation chain of n + t, then `rows` rows of n stitches with a
 * turning chain of t (not counting as a stitch) at the start of every row after the first
 * (t = 1 sc, 2 hdc, 3 dc, 4 tr). Tails are trimmed before weighing. The model length of that
 * swatch, split into its loop part (Σ a·w + π·e·d) and height part (Σ b·h), is compared with the
 * measured length (grams × m/100 g, or metres frogged):
 *
 *   one swatch (or several of one stitch):  k = Σ measured / Σ model          (k_w = k_h = k)
 *   two or more stitches:                    measured_i ≈ k_w·loop_i + k_h·height_i
 *                                            (least squares on relative error; falls back to one
 *                                             factor when the swatches cannot tell the two apart)
 */
import type { ParamSet } from '../params';
import { TCH, nodeParts, type NodeLike } from './model';
import { gramsToMeters } from './units';

export interface SwatchInput {
  /** Stitch worked in rows: sc, hdc, dc, tr (or dtr). */
  stitch: string;
  /** Stitches per row. */
  stitches: number;
  rows: number;
  /** Swatch weight with tails trimmed (g). */
  grams?: number;
  /** … or the yarn frogged from it (m). Wins over grams when both are given. */
  meters?: number;
  /** Ball band metres per 100 g (needed with grams). */
  metersPer100g?: number;
}

export interface SwatchModel {
  counts: Record<string, number>;
  /** Σ a·w + π·e·d over the swatch, metres (k = 1). */
  loop: number;
  /** Σ b·h, metres (k = 1). */
  height: number;
  /** loop + height, metres. */
  meters: number;
}

/** Stitch counts of a flat swatch (keys as in byStitch: 'ch', 'turning ch', 'sc' …). */
export function swatchCounts(stitch: string, stitches: number, rows: number): Record<string, number> {
  const t = TCH[stitch] ?? 1;
  const out: Record<string, number> = { ch: stitches + t, [stitch]: stitches * rows };
  if (rows > 1) out['turning ch'] = (rows - 1) * t;
  return out;
}

/** Model length of a flat swatch, split for calibration; `diameterMm` = the yarn's d. */
export function swatchModel(sw: Pick<SwatchInput, 'stitch' | 'stitches' | 'rows'>, params: ParamSet, diameterMm: number): SwatchModel {
  const t = TCH[sw.stitch] ?? 1;
  const items: [NodeLike, number][] = [
    [{ type: 'ch', into: [] }, sw.stitches + t],
    [{ type: sw.stitch as NodeLike['type'], into: [{ node: 0 }] }, sw.stitches * sw.rows],
    [{ type: 'ch', into: [], role: 'tch' }, Math.max(0, sw.rows - 1) * t],
  ];
  let loop = 0, height = 0;
  for (const [n, k] of items) {
    const p = nodeParts(n, params, diameterMm);
    loop += k * p.post * p.loop;
    height += k * p.post * p.height;
  }
  loop /= 1000; height /= 1000;
  return { counts: swatchCounts(sw.stitch, sw.stitches, sw.rows), loop, height, meters: loop + height };
}

/** Measured yarn in a swatch (m), or NaN when neither metres nor grams + m/100 g are given. */
export function measuredMeters(sw: SwatchInput): number {
  if (sw.meters !== undefined && sw.meters > 0) return sw.meters;
  if (sw.grams !== undefined && sw.grams > 0 && sw.metersPer100g && sw.metersPer100g > 0) return gramsToMeters(sw.grams, sw.metersPer100g);
  return NaN;
}

export interface CalibrationResult {
  /** Single factor: measured / model (1 = the nominal model was right; 1.15 = you use 15 % more). */
  factor: number;
  /** Separate loop (width) and height factors, when two different stitches allowed a split. */
  width?: number;
  height?: number;
  /** 'single' | 'split' | 'invalid' and why a split was not used. */
  kind: 'single' | 'split' | 'invalid';
  reason?: string;
  swatches: { stitch: string; modelMeters: number; measuredMeters: number; ratio: number }[];
}

/** Calibration from one swatch. */
export function calibrationFromSwatch(sw: SwatchInput, params: ParamSet, diameterMm: number): CalibrationResult {
  return calibrationFromSwatches([sw], params, diameterMm);
}

/** Calibration from one or more swatches (same yarn, hook and crocheter). */
export function calibrationFromSwatches(sws: SwatchInput[], params: ParamSet, diameterMm: number): CalibrationResult {
  const rows = sws.map((sw) => ({ sw, m: swatchModel(sw, params, diameterMm), y: measuredMeters(sw) }))
    .filter((r) => Number.isFinite(r.y) && r.y > 0 && r.m.meters > 0 && r.sw.stitches > 0 && r.sw.rows > 0);
  const swatches = rows.map((r) => ({ stitch: r.sw.stitch, modelMeters: r.m.meters, measuredMeters: r.y, ratio: r.y / r.m.meters }));
  if (!rows.length) return { factor: NaN, kind: 'invalid', reason: 'Enter the stitch counts and the swatch weight (with the ball band\'s m/100 g) or its length.', swatches };
  const factor = rows.reduce((s, r) => s + r.y, 0) / rows.reduce((s, r) => s + r.m.meters, 0);
  const distinct = new Set(rows.map((r) => r.sw.stitch));
  if (distinct.size < 2) return { factor, kind: 'single', reason: distinct.size === 1 && rows.length > 0 ? 'One stitch type: a single factor for everything.' : undefined, swatches };
  // weighted least squares on relative error: minimise Σ ((y − kw·A − kh·B) / y)²
  let saa = 0, sab = 0, sbb = 0, say = 0, sby = 0;
  for (const r of rows) {
    const A = r.m.loop / r.y, B = r.m.height / r.y;
    saa += A * A; sab += A * B; sbb += B * B; say += A; sby += B;
  }
  const det = saa * sbb - sab * sab;
  if (!(det / (saa * sbb) > 0.01)) return { factor, kind: 'single', reason: 'The swatches are too alike to separate the loop and height terms.', swatches };
  const width = (say * sbb - sby * sab) / det;
  const height = (sby * saa - say * sab) / det;
  if (!(width > 0.3 && width < 3 && height > 0.3 && height < 3)) {
    return { factor, kind: 'single', reason: 'The separate factors came out implausible (a measuring slip?); using one factor.', swatches };
  }
  return { factor, width, height, kind: 'split', swatches };
}
