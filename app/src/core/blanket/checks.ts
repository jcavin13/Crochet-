/**
 * Shape checks for blankets (spec/flatness.md does not apply: rows have no centre, and the circle
 * rule is wrong at corners).
 *
 * Edge fit — the first border round must put as many stitches along each side as fit its length:
 *   placed × stitch width vs side length. Too many → the edge waves; too few → it puckers.
 *   Tolerance: sim_config.flatness.tol (10 %).
 *
 * Polygon rule — an n-gon worked round by round (a square from the centre, or a border round a
 * rectangle) stays flat when every round adds perimeter 2·n·h·tan(π/n), h = the round's height,
 * all of it at the corners (the sides only move outward). A square needs +8h per round, i.e.
 * 2h per corner (+2 stitch widths per corner for sc, +3.8 for dc); a hexagon +6.93h, an octagon
 * +6.63h. The check is cumulative: the perimeter after round k is compared with the body's (or
 * the first round's) plus the sum of the required growth, per corner, in stitches. A corner that
 * falls short cups (the corner curls up), one that is over ruffles. Tolerance: ±1 stitch per
 * corner, or ±tol of the growth accumulated so far, whichever is larger.
 */
import { simConfig, stitchParam, type ParamSet } from '../params';

const TOL = simConfig.flatness.tol;

/** Perimeter a flat n-gon gains per round of height h. */
export const polygonGrowth = (n: number, h: number) => 2 * n * h * Math.tan(Math.PI / n);

export type CornerClass = 'flat' | 'cup' | 'ruffle';

export interface PolygonRound {
  label: string;
  /** signed stitches over (+) / under (−) per corner, accumulated over the rounds so far */
  perCorner: number;
  /** signed stitches over / under along an average side in this round (0 for corner-only checks) */
  perSide: number;
  class: CornerClass;
  message: string;
  /** a deliberately non-flat round (ruffle edging) */
  intended?: boolean;
}

export interface PolygonInput {
  label: string;
  /**
   * Growth of the round's course length that the polygon rule judges, mm: the whole growth
   * (new length − old length) less deliberate side adjustments (a set-up round's increases and
   * decreases); for a border's edge round, its corner groups' growth only.
   */
  cornerGrowth: number;
  /** corners worked */
  corners: number;
  /** round height, mm */
  height: number;
  /** course length before and after the round, mm (for the side check) */
  before?: number;
  after?: number;
  intended?: boolean;
  /** not judged (e.g. the squaring round of a circle-to-square) */
  skip?: string;
}

/**
 * Cumulative polygon check: each round's growth, accumulated, against 2·h·tan(π/n) per corner per
 * round (Gauss–Bonnet: a flat n-gon's corners carry all its turning). `w` = stitch width (mm).
 * With `before`/`after`, a round whose sides change by more than `tol` of their length (without
 * being a deliberate adjustment) is also reported.
 */
export function polygonCheck(n: number, rounds: PolygonInput[], w: number): PolygonRound[] {
  let cum = 0;
  let grown = 0;
  const out: PolygonRound[] = [];
  for (const r of rounds) {
    if (r.skip) {
      cum = 0;
      grown = 0;
      out.push({ label: r.label, perCorner: 0, perSide: 0, class: 'flat', message: r.skip });
      continue;
    }
    const k = Math.max(1, r.corners || n);
    const need = (polygonGrowth(n, r.height) / n) * k;
    cum += r.cornerGrowth - need;
    grown += need;
    const perCorner = cum / k / w;
    const tol = Math.max(1, (TOL * grown) / k / w);
    let perSide = 0;
    let sideCls: CornerClass = 'flat';
    if (r.before !== undefined && r.after !== undefined && r.before > 0) {
      const side = (r.after - r.before - r.cornerGrowth) / k;
      perSide = side / w;
      const rel = side / (r.before / k);
      if (Math.abs(perSide) >= 1 && Math.abs(rel) > TOL) sideCls = rel > 0 ? 'ruffle' : 'cup';
    }
    const cls: CornerClass = perCorner > tol ? 'ruffle' : perCorner < -tol ? 'cup' : sideCls;
    const q = Math.round(Math.abs(perCorner) * 10) / 10;
    const sts = (x: number) => `${x} stitch${x === 1 ? '' : 'es'}`;
    let message: string;
    if (perCorner > tol) message = `${r.label}: corners will ruffle — about ${sts(q)} per corner over flat${r.intended ? ' (intended: ruffle edging)' : '; use a smaller corner group'}.`;
    else if (perCorner < -tol) message = `${r.label}: corners will cup — about ${sts(q)} per corner short of flat; use a bigger corner group.`;
    else if (sideCls !== 'flat') {
      const s = Math.round(Math.abs(perSide) * 10) / 10;
      message = sideCls === 'ruffle'
        ? `${r.label}: the sides will wave — about ${sts(s)} per side more than they need${r.intended ? ' (intended: ruffle edging)' : ''}.`
        : `${r.label}: the sides will pull in — about ${sts(s)} per side fewer than they need.`;
    } else message = `${r.label}: corners lie flat${Math.abs(perCorner) >= 0.5 ? ` (${perCorner > 0 ? '+' : '−'}${q} st per corner, within tolerance)` : ''}.`;
    out.push({ label: r.label, perCorner, perSide, class: cls, message, intended: r.intended });
  }
  return out;
}

/* ------------------------------------------------------------------ edge fit */

export type EdgeClass = 'ok' | 'wavy' | 'puckered';

export interface EdgeFit {
  side: string;
  /** stitches placed along the side (corner columns included once) */
  placed: number;
  /** length of the side, mm, and what the stitches cover */
  lengthMm: number;
  coverMm: number;
  /** signed stitches too many (+) / too few (−) */
  off: number;
  class: EdgeClass;
  /** "2 sc per row end" */
  rule: string;
  /** the rule that fits, when this one does not */
  fix?: string;
  message: string;
}

const cmText = (mm: number) => `${(mm / 10).toFixed(mm < 1000 ? 1 : 0)} cm`;

export function edgeFit(side: string, placed: number, lengthMm: number, w: number, rule: string, fix?: string): EdgeFit {
  const cover = placed * w;
  const off = (cover - lengthMm) / w;
  const rel = cover / lengthMm - 1;
  const cls: EdgeClass = rel > TOL ? 'wavy' : rel < -TOL ? 'puckered' : 'ok';
  const n = Math.round(Math.abs(off));
  const head = `${side}: ${rule} gives ${placed} sts over ${cmText(lengthMm)}`;
  const message = cls === 'ok'
    ? `${head} — fits${n ? ` (${off > 0 ? '+' : '−'}${n}, within tolerance)` : ''}.`
    : cls === 'wavy'
      ? `${head} — about ${n} too many, the edge will wave${fix ? `; use ${fix}` : ''}.`
      : `${head} — about ${n} too few, the edge will pucker and pull in${fix ? `; use ${fix}` : ''}.`;
  return { side, placed, lengthMm, coverMm: cover, off, class: cls, rule, fix, message };
}

/* ------------------------------------------------------------------ row-end rules */

/** "num sc per den row ends" */
export interface RowEndRule { num: number; den: number }

export const ROW_END_RULES: RowEndRule[] = [
  { num: 3, den: 4 }, { num: 4, den: 5 }, { num: 5, den: 6 }, { num: 9, den: 10 }, { num: 1, den: 1 }, { num: 4, den: 3 }, { num: 3, den: 2 }, { num: 5, den: 3 }, { num: 2, den: 1 }, { num: 5, den: 2 }, { num: 3, den: 1 },
];

export const ruleText = (r: RowEndRule) => (r.den === 1 ? `${r.num} sc per row end` : `${r.num} sc per ${r.den} row ends`);

/** sc per row end that fit a row of height rowH with sc of width w: the closest simple ratio. */
export function fitRowEnds(rowH: number, w: number): RowEndRule {
  const want = rowH / w;
  let best = ROW_END_RULES[0];
  for (const r of ROW_END_RULES) if (Math.abs(r.num / r.den - want) < Math.abs(best.num / best.den - want)) best = r;
  return best;
}

/** Spread `rule` over n row ends: stitches per row end (Bresenham, so the pattern is periodic). */
export function spreadRowEnds(n: number, rule: RowEndRule): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.floor(((i + 1) * rule.num) / rule.den) - Math.floor((i * rule.num) / rule.den));
  return out;
}

/** sc width of a param set, mm */
export const scWidth = (P: ParamSet) => stitchParam(P, 'sc').width;
