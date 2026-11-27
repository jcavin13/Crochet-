/**
 * Real-time spring sim (spec/physics.md as amended by lab/SPEC_NOTES.md). Pure TS: runs in node,
 * the browser and Web Workers.
 *
 *   buildNetwork(graph, params, config?)         → Network   (identical to crolab.network, metric)
 *   simulate(graph, params, opts?)               → SimResult (growth P0–P6 + L-BFGS, synchronous)
 *   createSim(graph, params, opts?)              → SimHandle (incremental: step(budgetMs), snapshots)
 *   shapeMetric(X, nodeRounds, config?)          → {class, A, W, Rg, outer_radius, axis, centroid}
 *   block(network, X, config?)                   → BlockResult (physics.md §6, with a verdict)
 *   regionShape(network, X)                      → per-region shape of rows / borders / polygons (or null)
 *   networkMetric(network, X)                    → shapeMetric with the row-piece axis rule
 */
export {
  buildNetwork, springsOf, countsAsStitch, COURSE, WALE, SHEAR, BEND_COURSE, BEND_WALE, KIND_NAMES,
} from './network';
export type { Network, Spring, SpringKind } from './network';
export { simulate, networkEnergy, springStrain, Grower, Placer, GOLDEN } from './solve';
export type { SimResult, SolveOptions } from './solve';
export { Lbfgs, springEnergy } from './lbfgs';
export type { SpringSet, LbfgsOptions, LbfgsStatus } from './lbfgs';
export { shapeMetric, networkMetric, usesPcaAxis } from './metrics';
export type { ShapeMetric } from './metrics';
export { block, setupBlock, blockVerdict, alignPins, pinOverstretch, PIN_OVERSTRETCH } from './blocking';
export type { BlockResult, BlockVerdict, BlockPin, PinStretch } from './blocking';
export { findSpines } from './spine';
export { buildOutline, outlinePins, polygonRuns } from './outline';
export type { Outline, OutlineCourse, OutlineKind, Poly } from './outline';
export { regionShape, REGION_TAU, RECT_SIDE_LABELS, RECT_CORNER_LABELS } from './regions';
export type { RegionReport, RegionSide, RegionCorner, SideClass, CornerClass } from './regions';
export type { Spine } from './spine';
export { addTableEnergy, TABLE_GRAVITY, TABLE_STIFFNESS } from './table';
export type { TableOptions } from './table';
export { createSim, FAST_TOLERANCES, AUTO_REFERENCE_MAX_NODES } from './sim';
export { surveyPattern } from './survey';
export type { SurveyRow, SurveyOptions } from './survey';
export type { SimHandle, StepResult, SimPhase, BlockSummary, CreateSimOptions } from './sim';
