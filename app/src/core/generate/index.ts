/**
 * Public API of the generative doily designer (pure TS; no React/DOM).
 *
 *   generateDoily(spec, params) → { text, pattern, flatness, rounds, warnings, stats, diagnostics }
 *   randomSpec(seed, constraints) → DoilySpec          (seeded Markov grammar; deterministic)
 *   PRESETS                                            (named DoilySpecs)
 *   MOTIFS / MOTIF_ORDER / motifInfo(id)               (the motif library, for UIs)
 */
export type * from './types';
export { generateDoily, planDoily, defaultTitle, MIN_SYMMETRY, MAX_SYMMETRY } from './generate';
export { randomSpec, surprise, prng } from './random';
export type { RandomConstraints } from './random';
export { PRESETS } from './presets';
export type { Preset } from './presets';
export { MOTIFS, MOTIF_ORDER, motifInfo } from './motifs';
export { predictRound } from './predict';
