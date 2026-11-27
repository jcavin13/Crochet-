// Designer page state (persisted with usePersistentState), migrations, and how it becomes a spec.
import {
  generateDoily, randomSpec, PRESETS, MIN_SYMMETRY, MAX_SYMMETRY,
  type DoilySpec, type GenerateResult, type Height, type RoundSpec, type ShapeTarget,
} from '@/core/generate';
import { SNOWFLAKE_PRESETS, type SnowflakeSpec } from '@/core/generate/snowflake';
import { paramSetById, paramsFile, type ParamSet } from '@/core/params';

export type Mode = 'guided' | 'random' | 'presets';
export type Kind = 'doily' | 'snowflake';

export interface RandomSettings {
  seed: number;
  roundsMin: number;
  roundsMax: number;
  /** Largest finished diameter wanted, cm (0 = any size). Kept for old saves; the target below wins. */
  maxCm: number;
  /** Let the sampler choose the symmetry too. */
  anySymmetry: boolean;
}

/** A layer of the stack: a round spec plus UI flags. */
export interface Layer extends RoundSpec {
  /** Numbers frozen: auto-solving (and "re-solve all") leaves this layer alone. */
  locked?: boolean;
}

export interface DesignerState {
  v: 2;
  kind: Kind;
  mode: Mode;
  symmetry: number;
  rounds: Layer[];
  target: ShapeTarget;
  lacy: number;
  heights: Height[];
  terms: 'US' | 'UK';
  paramsId: string;
  title: string;
  random: RandomSettings;
  presetId?: string;
  /** Wanted finished diameter, cm (0 = no target). Suggestions and "surprise me" respect it. */
  targetCm: number;
}

/** The first version (before layers, locks, kinds and the size target). */
export interface DesignerStateV1 extends Omit<DesignerState, 'v' | 'kind' | 'targetCm' | 'rounds'> { v: 1; rounds: RoundSpec[] }

const classic = PRESETS[0];

export const initialState: DesignerState = {
  v: 2,
  kind: 'doily',
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
  targetCm: 0,
};

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const okRounds = (x: unknown): x is RoundSpec[] => Array.isArray(x) && x.every((r) => isObj(r) && typeof r.motif === 'string');

/**
 * Bring any saved value up to the current version. Unknown shapes fall back to the initial state;
 * every field is checked, so a damaged save can never crash the page.
 */
export function migrateState(saved: unknown): DesignerState {
  if (!isObj(saved)) return initialState;
  if (saved.v !== 1 && saved.v !== 2) return initialState;
  const s = saved as Partial<DesignerState> & Record<string, unknown>;
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const random = isObj(s.random) ? { ...initialState.random, ...(s.random as Partial<RandomSettings>) } : initialState.random;
  const out: DesignerState = {
    v: 2,
    kind: s.v === 2 && (s.kind === 'snowflake' || s.kind === 'doily') ? s.kind : 'doily',
    mode: s.mode === 'random' || s.mode === 'presets' || s.mode === 'guided' ? s.mode : 'guided',
    symmetry: clampSym(num(s.symmetry, initialState.symmetry)),
    rounds: okRounds(s.rounds) ? (s.rounds as Layer[]) : initialState.rounds,
    target: isObj(s.target) && typeof s.target.shape === 'string' ? (s.target as ShapeTarget) : initialState.target,
    lacy: num(s.lacy, initialState.lacy),
    heights: Array.isArray(s.heights) && s.heights.length ? (s.heights as Height[]) : initialState.heights,
    terms: s.terms === 'UK' ? 'UK' : 'US',
    paramsId: typeof s.paramsId === 'string' && paramSetById(s.paramsId) ? s.paramsId : initialState.paramsId,
    title: typeof s.title === 'string' ? s.title : '',
    random,
    presetId: typeof s.presetId === 'string' ? s.presetId : undefined,
    // v1 had only "largest diameter" in the random settings: carry it over as the size target
    targetCm: s.v === 2 ? num(s.targetCm, 0) : num(random.maxCm, 0),
  };
  return out;
}

export const clampSym = (n: number) => Math.min(MAX_SYMMETRY, Math.max(MIN_SYMMETRY, Math.round(n)));

export function paramsOf(state: Pick<DesignerState, 'paramsId'>): ParamSet {
  return paramSetById(state.paramsId) ?? paramSetById(paramsFile.default_set) ?? paramsFile.sets[0];
}

/** Strip UI flags: the spec the generator sees. */
export const layerSpecs = (rounds: Layer[]): RoundSpec[] => rounds.map(({ locked: _l, ...r }) => r);

/** The spec the page is showing (random mode samples it from the seed). */
export function specOf(state: DesignerState): DoilySpec {
  const style = { lacy: state.lacy, heights: state.heights };
  if (state.mode === 'random') {
    const r = state.random;
    const lo = Math.min(r.roundsMin, r.roundsMax), hi = Math.max(r.roundsMin, r.roundsMax);
    const maxCm = state.targetCm || r.maxCm;
    const spec = randomSpec(r.seed, {
      symmetry: r.anySymmetry ? [5, 16] : clampSym(state.symmetry),
      rounds: [lo, hi],
      diameterCm: maxCm > 0 ? [maxCm * 0.8, maxCm * 1.05] : undefined,
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
    rounds: layerSpecs(state.rounds),
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

/** "Surprise me" result → editable layers (preferences become fixed choices). */
export function toLayers(spec: DoilySpec): Layer[] {
  return spec.rounds.map((r) => ({ motif: r.motif, params: { ...(r.prefer ?? {}), ...(r.params ?? {}) } }));
}

/* ------------------------------------------------------------------ layer operations (pure) */

export function lockLayer(rounds: Layer[], i: number, chosen: RoundSpec['params']): Layer[] {
  return rounds.map((r, j) => (j === i ? { ...r, locked: true, params: { ...(chosen ?? {}), ...(r.params ?? {}) } } : r));
}
export function unlockLayer(rounds: Layer[], i: number): Layer[] {
  return rounds.map((r, j) => (j === i ? { ...r, locked: false } : r));
}
/** "Re-solve all unlocked layers": every number of an unlocked layer goes back on auto. */
export function resolveUnlocked(rounds: Layer[]): Layer[] {
  return rounds.map((r) => (r.locked ? r : { motif: r.motif, ...(r.double ? { double: true } : {}) }));
}
export function moveLayer(rounds: Layer[], i: number, d: number): Layer[] {
  const j = i + d;
  if (i < 1 || j < 1 || j >= rounds.length) return rounds; // the centre stays first
  const next = rounds.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
export function duplicateLayer(rounds: Layer[], i: number): Layer[] {
  if (i < 1) return rounds;
  const copy: Layer = JSON.parse(JSON.stringify(rounds[i]));
  delete copy.double;
  return [...rounds.slice(0, i + 1), copy, ...rounds.slice(i + 1)];
}
export function insertLayer(rounds: Layer[], at: number, layers: Layer[]): Layer[] {
  const k = Math.max(rounds.length ? 1 : 0, Math.min(rounds.length, at));
  return [...rounds.slice(0, k), ...layers, ...rounds.slice(k)];
}
export function removeLayer(rounds: Layer[], i: number): Layer[] {
  if (i === 0 && rounds.length > 1) return rounds;
  return rounds.filter((_, j) => j !== i);
}

/* ------------------------------------------------------------------ snowflake state */

export interface SnowState {
  v: 1;
  spec: SnowflakeSpec;
  paramsId: string;
  /** Style sliders and size for "surprise me" and the gallery. */
  bold: number;
  spiky: number;
  ornate: number;
  sizeCm: number;
  seed: number;
  /** Seed of the variations gallery. */
  gallerySeed: number;
  /** "More like this": variations are mutations of this spec. */
  base?: SnowflakeSpec;
}

export const initialSnow: SnowState = {
  v: 1,
  spec: SNOWFLAKE_PRESETS[1].spec,
  paramsId: 'thread-10_1.5mm',
  bold: 0.4, spiky: 0.6, ornate: 0.5, sizeCm: 8,
  seed: 1,
  gallerySeed: 1,
};

export function migrateSnow(saved: unknown): SnowState {
  if (!isObj(saved) || saved.v !== 1 || !isObj(saved.spec) || typeof (saved.spec as Record<string, unknown>).points !== 'number') return initialSnow;
  const s = saved as unknown as SnowState;
  const spec = s.spec;
  if (!isObj(spec.arm) || !isObj(spec.centre) || !Array.isArray(spec.body) || !isObj(spec.minor) || !isObj(spec.valley)) return initialSnow;
  return { ...initialSnow, ...s, paramsId: paramSetById(s.paramsId) ? s.paramsId : initialSnow.paramsId };
}
