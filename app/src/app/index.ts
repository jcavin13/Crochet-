// Shell API for feature pages. See src/features/README.md.
export {
  useCurrentPattern, useStitchParams, usePatternRecord, useAllPatterns, useCompiled, useDebounced,
  useFeatureBase, patternHref,
} from './hooks';
export type { CurrentPattern, StitchParam, StitchParamSet, StitchParamsFile } from './hooks';
export { PatternPicker } from './PatternPicker';
export { PatternGlyph } from './PatternGlyph';
export { FeaturePlaceholder } from './FeaturePlaceholder';
export { builtins, builtinById, fixtures, corpus, defaultPatternId } from './builtins';
export type { BuiltinRecord } from './builtins';
export { templates } from './templates';
export { NAV, navByKey } from './nav';
export { compilePattern, compilerAvailable } from './coreApi';
export type { Diagnostic, Pattern, GraphNode, GraphSpace, GraphRound, CompileResult, StitchType, Anchor } from './coreApi';
