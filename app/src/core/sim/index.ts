/**
 * Real-time spring sim (spec/physics.md as amended by lab/SPEC_NOTES.md). Pure TS: runs in node,
 * the browser and Web Workers.
 *
 *   buildNetwork(graph, params, config?)         → Network   (identical to crolab.network, metric)
 *   simulate(graph, params, opts?)               → SimResult (growth P0–P6 + L-BFGS, synchronous)
 *   createSim(graph, params, opts?)              → SimHandle (incremental: step(budgetMs), snapshots)
 *   shapeMetric(X, nodeRounds, config?)          → {class, A, W, Rg, outer_radius, axis, centroid}
 *   block(network, X, config?)                   → BlockResult (physics.md §6, with a verdict)
 */
export {
  buildNetwork, springsOf, countsAsStitch, COURSE, WALE, SHEAR, BEND_COURSE, BEND_WALE, KIND_NAMES,
} from './network';
export type { Network, Spring, SpringKind } from './network';
export { simulate, networkEnergy, springStrain, Grower, Placer, GOLDEN } from './solve';
export type { SimResult, SolveOptions } from './solve';
export { Lbfgs, springEnergy } from './lbfgs';
export type { SpringSet, LbfgsOptions, LbfgsStatus } from './lbfgs';
export { shapeMetric } from './metrics';
export type { ShapeMetric } from './metrics';
export { block, setupBlock, blockVerdict } from './blocking';
export type { BlockResult, BlockVerdict } from './blocking';
export { createSim } from './sim';
export type { SimHandle, StepResult, SimPhase, BlockSummary, CreateSimOptions } from './sim';
