// Designer page state (persisted with usePersistentState) and how it becomes a DoilySpec.
import {
  generateDoily, randomSpec, PRESETS, MIN_SYMMETRY, MAX_SYMMETRY,
  type DoilySpec, type GenerateResult, type Height, type RoundSpec, type ShapeTarget,
} from '@/core/generate';
import { paramSetById, paramsFile, type ParamSet } from '@/core/params';

export type Mode = 'guided' | 'random' | 'presets';

export interface RandomSettings {
  seed: number;
  roundsMin: number;
  roundsMax: number;
  /** Largest finished diameter wanted, cm (0 = any size). */
  maxCm: number;
  /** Let the sampler choose the symmetry too. */
  anySymmetry: boolean;
}

export interface DesignerState {
  v: 1;
  mode: Mode;
  symmetry: number;
  rounds: RoundSpec[];
  target: ShapeTarget;
  lacy: number;
  heights: Height[];
  terms: 'US' | 'UK';
  paramsId: string;
  title: string;
  random: RandomSettings;
  presetId?: string;
}

const classic = PRESETS[0];

export const initialState: DesignerState = {
  v: 1,
  mode: 'guided',
  symmetry: classic.spec.symmetry,
  rounds: classic.spec.rounds,
  target: { shape: 'flat' },
  lacy: 0.6,
  heights: ['sc', 'hdc', 'dc', 'tr'],
  terms: 'US',
  paramsId: 'thread-10_1.5mm',
  title: '',
  random: { seed: 2026, roundsMin: 7, roundsMax: 10, maxCm: 0, anySymmetry: false },
  presetId: classic.id,
};

export const clampSym = (n: number) => Math.min(MAX_SYMMETRY, Math.max(MIN_SYMMETRY, Math.round(n)));

export function paramsOf(state: DesignerState): ParamSet {
  return paramSetById(state.paramsId) ?? paramSetById(paramsFile.default_set) ?? paramsFile.sets[0];
}

/** The spec the page is showing (random mode samples it from the seed). */
export function specOf(state: DesignerState): DoilySpec {
  const style = { lacy: state.lacy, heights: state.heights };
  if (state.mode === 'random') {
    const r = state.random;
    const lo = Math.min(r.roundsMin, r.roundsMax), hi = Math.max(r.roundsMin, r.roundsMax);
    const spec = randomSpec(r.seed, {
      symmetry: r.anySymmetry ? [5, 16] : clampSym(state.symmetry),
      rounds: [lo, hi],
      diameterCm: r.maxCm > 0 ? [r.maxCm * 0.75, r.maxCm] : undefined,
      lacy: state.lacy,
      heights: state.heights,
      target: state.target,
      terms: state.terms,
      params: paramsOf(state),
    });
    return { ...spec, title: state.title || undefined };
  }
  return {
    symmetry: clampSym(state.symmetry),
    rounds: state.rounds,
    target: state.target,
    style,
    terms: state.terms,
    title: state.title || undefined,
  };
}

export function compute(state: DesignerState): { spec: DoilySpec; result: GenerateResult; params: ParamSet } {
  const params = paramsOf(state);
  const spec = specOf(state);
  return { spec, result: generateDoily(spec, params), params };
}

/** A short shareable code for a random design: seed + settings. */
export function shareCode(state: DesignerState, spec: DoilySpec): string {
  const r = state.random;
  return [
    `seed ${r.seed}`, `${spec.symmetry}-fold`, `${spec.rounds.length} rnds`,
    `lacy ${Math.round(state.lacy * 100)}%`, state.heights.join('/'),
    state.target.shape !== 'flat' ? state.target.shape : '',
  ].filter(Boolean).join(' · ');
}
