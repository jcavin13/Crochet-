// Blanket studio page state (persisted with usePersistentState), migration, history.
import {
  BORDER_PRESETS, DEFAULT_SPEC, PALETTES, ROUND_STYLE_BY_ID, STITCH_BY_ID, paletteFrom, blanketParamSets,
  type BlanketSpec, type BorderKind, type BorderLayer, type StripePlan,
} from '@/core/blanket';

export type Units = 'cm' | 'in';
export type Pane = 'design' | 'result';

export interface BlanketState {
  v: 1;
  spec: BlanketSpec;
  units: Units;
  /** last opened step card */
  step: number;
  /** results toggles */
  showChart: boolean;
  showSim: boolean;
  /** "my gauge" entry is open */
  myGauge: boolean;
  seed: number;
}

export const initialState: BlanketState = {
  v: 1, spec: DEFAULT_SPEC, units: 'cm', step: 0, showChart: false, showSim: false, myGauge: false, seed: 2026,
};

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/** Any saved value → a valid state (never throws; damaged fields fall back to defaults). */
export function migrateState(saved: unknown): BlanketState {
  if (!isObj(saved) || saved.v !== 1 || !isObj(saved.spec)) return initialState;
  const s = saved.spec as Partial<BlanketSpec>;
  const d = DEFAULT_SPEC;
  const sets = blanketParamSets().map((p) => p.id);
  const palette = Array.isArray(s.palette) && s.palette.length && s.palette.every((c) => isObj(c) && typeof c.key === 'string' && typeof c.hex === 'string') ? s.palette : d.palette;
  const layers = Array.isArray(s.border?.layers) ? s.border!.layers.filter((l): l is BorderLayer => isObj(l) && typeof l.kind === 'string') : d.border.layers;
  const spec: BlanketSpec = {
    ...d,
    construction: s.construction === 'round' || s.construction === 'motif' ? s.construction : 'rect',
    title: typeof s.title === 'string' ? s.title : undefined,
    terms: s.terms === 'UK' ? 'UK' : 'US',
    size: isObj(s.size) ? { preset: typeof s.size.preset === 'string' ? s.size.preset : undefined, widthCm: Math.max(10, num(s.size.widthCm, d.size.widthCm)), heightCm: Math.max(10, num(s.size.heightCm, d.size.heightCm)) } : d.size,
    paramsId: typeof s.paramsId === 'string' && sets.includes(s.paramsId) ? s.paramsId : d.paramsId,
    gauge: isObj(s.gauge) && num(s.gauge.sts, 0) > 0 && num(s.gauge.rows, 0) > 0 ? { sts: num(s.gauge.sts, 0), rows: num(s.gauge.rows, 0) } : undefined,
    palette,
    stripes: isObj(s.stripes) && typeof s.stripes.kind === 'string' ? (s.stripes as StripePlan) : d.stripes,
    body: { pattern: s.body && STITCH_BY_ID[s.body.pattern] ? s.body.pattern : d.body.pattern },
    border: isObj(s.border) ? { ...d.border, ...s.border, layers } : d.border,
    round: isObj(s.round) && ROUND_STYLE_BY_ID[(s.round as { style: string }).style as keyof typeof ROUND_STYLE_BY_ID] ? { ...d.round, ...s.round } : d.round,
    motif: isObj(s.motif) ? { ...d.motif, ...s.motif } : d.motif,
    spm: num(s.spm, d.spm ?? 20),
  };
  return {
    v: 1, spec, units: saved.units === 'in' ? 'in' : 'cm', step: num(saved.step, 0),
    showChart: !!saved.showChart, showSim: !!saved.showSim, myGauge: !!saved.myGauge, seed: num(saved.seed, 2026),
  };
}

/* ------------------------------------------------------------------ history (undo / redo of the spec) */

export interface History<T> { past: T[]; present: T; future: T[] }
export const HISTORY_LIMIT = 60;
export const historyOf = <T>(present: T): History<T> => ({ past: [], present, future: [] });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function record<T>(h: History<T>, next: T): History<T> {
  if (same(h.present, next)) return h;
  const past = [...h.past, h.present];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, present: next, future: [] };
}
export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}
export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
export function sync<T>(h: History<T>, present: T): History<T> {
  return same(h.present, present) ? h : record(h, present);
}

/* ------------------------------------------------------------------ spec edits (pure) */

export function applyBorderPreset(spec: BlanketSpec, id: string): BlanketSpec {
  const p = BORDER_PRESETS.find((b) => b.id === id);
  if (!p) return spec;
  const keys = spec.palette.map((c) => c.key);
  const edge = spec.border.edgeColor ?? keys[keys.length - 1];
  return { ...spec, border: { ...spec.border, enabled: true, layers: p.layers.map((k, i) => ({ kind: k, color: i === p.layers.length - 1 && keys.length > 1 ? keys[0] : edge })) } };
}

export function moveLayer(layers: BorderLayer[], i: number, d: number): BorderLayer[] {
  const j = i + d;
  if (j < 0 || j >= layers.length) return layers;
  const next = layers.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
export const addLayer = (layers: BorderLayer[], kind: BorderKind, color?: string): BorderLayer[] => [...layers, { kind, color }];
export const removeLayer = (layers: BorderLayer[], i: number): BorderLayer[] => layers.filter((_, j) => j !== i);

export function setPalette(spec: BlanketSpec, paletteId: string): BlanketSpec {
  const p = PALETTES.find((x) => x.id === paletteId);
  return p ? { ...spec, palette: paletteFrom(p.colors) } : spec;
}

/** Display a length in the chosen units. */
export function fmtLen(cm: number, units: Units, digits = 0): string {
  return units === 'cm' ? `${cm.toFixed(digits)} cm` : `${(cm / 2.54).toFixed(digits)} in`;
}
