/**
 * Chart package (pure; no React / DOM):
 *
 *   layoutChart(graph, params, opts?) → ChartLayout      positions, stems, arcs, round radii, bounds
 *   glyph(node, { set, sc })            → { stroke, fill } SVG path data for one symbol
 *   legendEntries(layout, terms)       → symbols used, with US/UK names
 *   chartToSvg(layout, opts)           → standalone SVG document (export)
 *   hitTest(index, x, y)               → nearest node (pointer / tap)
 */
export type * from './types';
export { layoutChart, boundsUpto, outlineRadius, DIM } from './layout';
export { solveOrdered } from './solve';
export {
  glyph, symbolOf, hatchesOf, legendEntries, legendName, sampleGlyph, magicRingGlyph, SYM,
} from './symbols';
export type { SymbolOptions, SymbolSet, ScGlyph, Glyph, LegendEntry } from './symbols';
export { chartToSvg, DEFAULT_COLORS, POINTED_NOTE, POINTED_KEY, wedgeNote, roundBandPath, bandPath, edgePath, outlinePath, hullPath, roundEdge } from './svg';
export { wedgeView } from './wedge';
export type { WedgeView, WedgeLabel, WedgeOptions } from './wedge';
export type { ChartColors, SvgOptions } from './svg';
export { buildHitIndex, hitTest, roundAt } from './hit';
export type { HitIndex } from './hit';
