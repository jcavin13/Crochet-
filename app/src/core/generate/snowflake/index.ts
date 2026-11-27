/**
 * Snowflake designer (pure TS; no React/DOM).
 *
 *   generateSnowflake(spec, params) → { text, pattern, flatness, rounds, shape, check, stats, … }
 *   randomSnowflake(seed, constraints) / mutateSnowflake(spec, seed) / snowflakeVariations(seed, count, …)
 *   SNOWFLAKE_PRESETS
 *   snowflakeTemplateSvg(result) / doilyTemplateSvg(doilyResult)   (printable pin-out guides, mm)
 */
export type * from './types';
export {
  generateSnowflake, planSnowflake, normaliseSpec, snowflakeTitle, armSentence, spineOps, minorOps, rolesOf, bridgeChains, branchPairs, branchPicot,
  SNOW_POINTS, MIN_POINTS, MAX_POINTS, CENTRE_LABEL, BODY_LABEL, TIP_LABEL, MINOR_LABEL, CENTRE_BLURB, BODY_BLURB,
} from './build';
export type { SnowPlan, ArmLayout, ArmAnchor } from './build';
export { blockedShape, judge } from './geometry';
export { randomSnowflake, mutateSnowflake, snowflakeVariations, fitSize, quickCheck, SNOWFLAKE_PRESETS } from './random';
export type { SnowConstraints, SnowPreset, SnowEval } from './random';
export { snowflakeTemplateSvg, doilyTemplateSvg } from './template';
