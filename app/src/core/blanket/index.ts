/**
 * Blanket design studio core (pure TS, no DOM).
 *
 *   designBlanket(spec, params?)  → text, compiled full pattern (when under the node cap), swatch,
 *                                   sizes, counts per stitch / colour, sections, checks, warnings
 *   BLANKET_SIZES, STITCH_PATTERNS, BORDERS, BORDER_PRESETS, ROUND_STYLES, PALETTES
 *   planMotifs(spec, params, keys), randomBlanket(seed, constraints)
 *   polygonCheck / edgeFit (shape checks for blankets), planStripes (colour plans)
 */
export * from './design';
export { BLANKET_SIZES, SIZE_BY_ID, SIZE_NOTE, cmToIn, inToCm } from './sizes';
export type { BlanketSize } from './sizes';
export { STITCH_PATTERNS, STITCH_BY_ID } from './stitches';
export type { StitchPattern, ThumbKind } from './stitches';
export { BORDERS, BORDER_PRESETS, cornersOf, sideLengths } from './borders';
export type { BorderKind, BorderLayer, BorderDef, CornerStyle } from './borders';
export { ROUND_STYLES, ROUND_STYLE_BY_ID, buildRounds } from './round';
export type { RoundStyle, RoundStyleId } from './round';
export { PALETTES, STRIPE_KINDS, planStripes, colorRuns, paletteFrom, surpriseStripes, KEYS } from './colors';
export type { PaletteColor, StripePlan } from './colors';
export { planMotifs, layoutGrid, makeColourways, MOTIF_LAYOUTS, MOTIF_JOINS } from './motifs';
export type { MotifSpec, MotifPlan, MotifLayout, MotifJoin, Colourway } from './motifs';
export { polygonCheck, polygonGrowth, edgeFit, fitRowEnds, spreadRowEnds, ruleText, ROW_END_RULES } from './checks';
export type { PolygonRound, EdgeFit, RowEndRule } from './checks';
export type { BorderSpec, Line } from './rect';
