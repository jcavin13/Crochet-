/**
 * Public API of the graph package (types mirror spec/pattern.schema.json).
 *
 *   compile(ast, { notation? })   → { pattern?, diagnostics }        (AST from notation.parse)
 *   validateGraph(graph) / validatePattern(pattern) → GraphIssue[]     (structural invariants)
 *   queries: stitchCounting, roundNodes, targetsOfRound, spaceNodesInto, anchorsOf, childrenOf,
 *            roundSummary, describeNode, stitchKey
 *   stableJson / stripSrc          (graph JSON file helpers)
 *
 * For text → pattern in one call use `compilePattern` from `core/notation`.
 */
export type * from './types';
export { STITCH_TYPES } from './types';
export { compile, canonicalNode } from './compile';
export type { CompileOptions, CompileResult } from './compile';
export { validateGraph, validatePattern, isValidGraph } from './validate';
export type { GraphIssue, GraphIssueCode, ValidateOptions } from './validate';
export {
  stitchCounting, roundNodes, targetsOfRound, spaceNodesInto, anchorsOf, childrenOf, roundSummary,
  describeNode, stitchKey,
} from './queries';
export type { Children, Entry, QueryOptions, ResolvedAnchor, RoundSummary } from './queries';
export { stableJson, stripSrc } from './json';
