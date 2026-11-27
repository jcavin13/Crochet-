/**
 * Shape checks for blankets. The rules themselves (edge fit, polygon rule, row-end rules) live in
 * core/flatness/polygon.ts — one implementation shared with the analytic flatness check
 * (spec/flatness.md, "Polygons" and "Borders"); summary:
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
import { stitchParam, type ParamSet } from '../params';

// The polygon rule and the edge fit live in core/flatness (one implementation, shared with the
// analytic flatness check); re-exported here for the blanket studio.
export { polygonGrowth, polygonCornerGrowth, polygonCheck, edgeFit } from '../flatness/polygon';
export { ROW_END_RULES, ruleText, fitRowEnds, spreadRowEnds } from '../flatness/polygon';
export type { CornerClass, PolygonRound, PolygonInput, EdgeClass, EdgeFit, RowEndRule } from '../flatness/polygon';

/** sc width of a param set, mm */
export const scWidth = (P: ParamSet) => stitchParam(P, 'sc').width;
