/**
 * Public API of the counter package — the counter is a pointer into the stitch graph.
 *
 *   buildSteps(pattern, { granularity, terms, ast? }) → StepList   (steps partition graph.nodes)
 *   stepAt(list, nodeIndex), positionOf(list, graph, nodeIndex), positionText(step)
 *   roundExpectation(graph, r, terms)  → "You should have 32 dc and 16 ch-2 spaces"
 *   roundRepeats(graph, r)             → periodicity of a round ("repeat 5 of 16")
 *   progress reducers: newProgress, next, prev, jumpToRound, jumpToNode, setGranularity, reset,
 *                      undo, setNote, reconcile (pattern edited since saved), pace
 *   tally reducers for the pattern-free "+1" counters
 */
export {
  buildSteps, patternAst, stepAt, positionOf, positionText, roundExpectation, GRANULARITIES,
} from './steps';
export type { Granularity, Step, StepList, RoundInfo, StepOptions, Position, Expectation } from './steps';
export { roundRepeats, findPeriod } from './repeats';
export type { RepeatPos, RoundRepeats } from './repeats';
export {
  newProgress, moveTo, next, prev, jumpToRound, jumpToNode, setGranularity, reset, undo, setNote,
  reconcile, pace, hashText, patternHash, HISTORY_LIMIT,
} from './progress';
export type { CounterProgress, RoundTime, Reconciled, Pace } from './progress';
export { printItem, printRound, nodeText, graphStepText } from './text';
export {
  newTally, tallyAdd, tallySet, tallyUndo, tallyAddCounter, tallyRemove, tallyRename,
} from './tally';
export type { TallyCounter, TallyState } from './tally';
