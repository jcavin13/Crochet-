/**
 * Gauge + measurements → stitch counts: the seed of the sizing tools. Pure; no DOM.
 *
 * Gauge is "stitches and rows per 10 cm" in one stitch type. Everything here is plain arithmetic
 * on that, plus the flat-circle rule from spec/flatness.md (a flat circle adds 2π·h/w stitches a
 * round), and emits `.cro` text for the swatch, circle, tube and hat so it goes through the same
 * validator as everything else.
 */
import type { ParamSet } from '../params';
import { paramSetById, paramsFile, stitchParam } from '../params';
import { emitPattern, hookLabel, spreadEvenly, compressUnits, type AmiStitch, type EmitRound } from './rounds';
import { revolve, startCountFor } from './revolve';

const TAU = 2 * Math.PI;

export interface Gauge {
  /** Stitches per 10 cm. */
  stitches: number;
  /** Rows (or rounds) per 10 cm. */
  rows: number;
}

/** Gauge of a stitch type in a parameter set (w, h in mm). */
export function gaugeFromParams(set: ParamSet, stitch: AmiStitch = 'sc'): Gauge {
  const p = stitchParam(set, stitch);
  return { stitches: 100 / p.width, rows: 100 / p.height };
}

/**
 * A parameter set whose `stitch` has exactly this gauge; the other stitch types keep their size
 * relative to it as in `base` (default: the file's default set).
 */
export function paramsFromGauge(g: Gauge, stitch: AmiStitch = 'sc', base?: ParamSet, hookMm?: number): ParamSet {
  const b = base ?? paramSetById(paramsFile.default_set) ?? paramsFile.sets[0];
  const ref = stitchParam(b, stitch);
  const w = 100 / g.stitches, h = 100 / g.rows;
  const kw = w / ref.width, kh = h / ref.height;
  const stitches: ParamSet['stitches'] = {};
  for (const [t, p] of Object.entries(b.stitches)) stitches[t] = { width: p.width * kw, height: p.height * kh, stiffness: p.stiffness };
  return {
    id: 'custom-gauge', label: `My gauge (${fmt(g.stitches)} sts × ${fmt(g.rows)} rows / 10 cm ${stitch})`,
    yarn_weight: b.yarn_weight, hook_mm: hookMm ?? b.hook_mm, status: 'nominal',
    provenance: 'Derived from a gauge entered by the user.', stitches,
  };
}

const fmt = (x: number) => String(+x.toFixed(1));

/** Count nearest to x of the form k·multiple + plus (k ≥ 1 when plus = 0). Ties go up. */
export function nearestCount(x: number, multiple = 1, plus = 0): number {
  const m = Math.max(1, Math.round(multiple));
  const p = Math.max(0, Math.round(plus));
  const k = Math.max(p === 0 ? 1 : 0, Math.round((x - p) / m + 1e-9));
  return k * m + p;
}

function header(title: string, params?: ParamSet, extra: [string, string][] = []): [string, string][] {
  const h: [string, string][] = [['title', title], ['terms', 'US']];
  if (params) {
    h.push(['yarn', params.yarn_weight], ['hook', hookLabel(params.hook_mm)]);
    if (paramSetById(params.id)) h.push(['params', params.id]);
  }
  h.push(['source', 'generated (gauge calculator)'], ['license', 'CC0-1.0'], ...extra);
  return h;
}

/* ------------------------------------------------------------------ rectangle */

export interface RectangleInput {
  gauge: Gauge;
  widthCm: number;
  heightCm: number;
  /** Positive ease makes it wider, negative narrower (percent); the height is not eased. */
  easePct?: number;
  stitch?: AmiStitch;
  /** Stitch-pattern repeat: the stitch count must be k·multiple + plus. */
  multiple?: number;
  plus?: number;
  params?: ParamSet;
  title?: string;
}
export interface RectangleResult {
  stitches: number;
  rows: number;
  /** Turning chain at the start of each row (does not count as a stitch here). */
  turningChain: number;
  /** Foundation chain = stitches + turning chain (work the first stitch into the (tch+1)th ch from hook). */
  foundationChain: number;
  actualWidthCm: number;
  actualHeightCm: number;
  text: string;
}

const TCH: Record<AmiStitch, number> = { sc: 1, hdc: 2, dc: 3 };
const ORD = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export function rectangle(i: RectangleInput): RectangleResult {
  const stitch = i.stitch ?? 'sc';
  const ease = 1 + (i.easePct ?? 0) / 100;
  const stitches = Math.max(1, nearestCount((i.widthCm * ease * i.gauge.stitches) / 10, i.multiple, i.plus));
  // ease applies across the width only, as for tube() (review N11): the length is worked to measure
  const rows = Math.max(1, Math.round((i.heightCm * i.gauge.rows) / 10));
  const t = TCH[stitch];
  const foundationChain = stitches + t;
  const title = i.title ?? `Rectangle ${fmt(i.widthCm)} × ${fmt(i.heightCm)} cm`;
  const rounds: EmitRound[] = [{ count: stitches, text: `${stitch} in ${ORD(t + 1)} ch from hook, ${stitch} in each ch across` }];
  for (let r = 2; r <= rows; r++) rounds.push({ count: stitches, text: `ch ${t}, ${stitch} in each st across` });
  rounds[rounds.length - 1].trailing = 'fasten off';
  const { text } = emitPattern({
    header: header(title, i.params, [['notes', `Gauge ${fmt(i.gauge.stitches)} sts x ${fmt(i.gauge.rows)} rows = 10 cm in ${stitch}. Turning chain does not count as a stitch.`]]),
    foundation: `ch ${foundationChain}`, rounds, label: 'Row',
  });
  return {
    stitches, rows, turningChain: t, foundationChain,
    actualWidthCm: (stitches * 10) / i.gauge.stitches, actualHeightCm: (rows * 10) / i.gauge.rows, text,
  };
}

/* ------------------------------------------------------------------ flat circle */

export interface CircleInput {
  gauge: Gauge; diameterCm: number; stitch?: AmiStitch; title?: string; stagger?: boolean; params?: ParamSet;
  /** Keep every round a multiple of the start count (6, 12, 18 … — the textbook circle). Default true. */
  regular?: boolean;
}
export interface CircleResult {
  rounds: number;
  counts: number[];
  startCount: number;
  /** Stitches a flat circle adds per round at this gauge (2π·h/w). */
  perRound: number;
  actualDiameterCm: number;
  text: string;
}

/** A flat circle: a disc profile through the surface-of-revolution generator. */
export function circle(i: CircleInput): CircleResult {
  const stitch = i.stitch ?? 'sc';
  const params = paramsFromGauge(i.gauge, stitch, i.params, i.params?.hook_mm);
  const R = (i.diameterCm * 10) / 2;
  const res = revolve({
    profile: { points: [{ r: 0, z: 0 }, { r: R, z: 0 }], smooth: false }, params, stitch, stagger: i.stagger ?? true,
    title: i.title ?? `Flat circle ${fmt(i.diameterCm)} cm`, crispCorners: false,
    repeat: i.regular === false ? 1 : startCountFor(params, stitch),
  });
  const text = res.text.replace('source: generated (surface of revolution)', 'source: generated (gauge calculator)');
  const counts = res.rounds.map((r) => r.count);
  const h = 100 / i.gauge.rows;
  return {
    rounds: counts.length, counts, startCount: counts[0], perRound: res.flatRate,
    actualDiameterCm: (2 * counts.length * h) / 10, text,
  };
}

/* ------------------------------------------------------------------ tube */

export interface TubeInput {
  gauge: Gauge;
  circumferenceCm: number;
  /** Negative ease for a snug fit, e.g. −10 for a hat band. */
  easePct?: number;
  heightCm?: number;
  multiple?: number;
  plus?: number;
  stitch?: AmiStitch;
  params?: ParamSet;
  title?: string;
}
export interface TubeResult { stitches: number; rounds: number; actualCircumferenceCm: number; actualHeightCm: number; text: string }

export function tube(i: TubeInput): TubeResult {
  const stitch = i.stitch ?? 'sc';
  const ease = 1 + (i.easePct ?? 0) / 100;
  const stitches = Math.max(3, nearestCount((i.circumferenceCm * ease * i.gauge.stitches) / 10, i.multiple, i.plus));
  const rounds = Math.max(1, Math.round(((i.heightCm ?? 10) * i.gauge.rows) / 10));
  const rs: EmitRound[] = [{ count: stitches, text: `${stitch} in each ch around` }];
  for (let r = 2; r <= rounds; r++) rs.push({ count: stitches, text: `${stitch} in each st around` });
  rs[rs.length - 1].trailing = 'fasten off';
  const { text } = emitPattern({
    header: header(i.title ?? `Tube ${fmt(i.circumferenceCm)} cm around`, i.params, [['notes', `Spiral rounds. Gauge ${fmt(i.gauge.stitches)} sts x ${fmt(i.gauge.rows)} rows = 10 cm in ${stitch}.`]]),
    foundation: `ch ${stitches}, join with sl st in first ch`, rounds: rs,
  });
  return { stitches, rounds, actualCircumferenceCm: (stitches * 10) / i.gauge.stitches, actualHeightCm: (rounds * 10) / i.gauge.rows, text };
}

/* ------------------------------------------------------------------ top-down hat */

export interface HatInput {
  gauge: Gauge;
  headCm: number;
  /** Negative ease in percent (positive number: 10 = hat 10% smaller than the head). Default 8. */
  negativeEasePct?: number;
  /** Crown to brim, along the hat (cm). */
  heightCm: number;
  stitch?: AmiStitch;
  multiple?: number;
  plus?: number;
  stagger?: boolean;
  /** Crown increases by exactly the start count every round (8 hdc, 16, 24 …). Default true. */
  regular?: boolean;
  params?: ParamSet;
  title?: string;
}
export interface HatResult {
  /** Body stitch count. */
  stitches: number;
  crownRounds: number;
  bodyRounds: number;
  counts: number[];
  perRound: number;
  actualCircumferenceCm: number;
  actualHeightCm: number;
  crownDiameterCm: number;
  warnings: string[];
  text: string;
}

export function hat(i: HatInput): HatResult {
  const stitch = i.stitch ?? 'hdc';
  const w = 100 / i.gauge.stitches, h = 100 / i.gauge.rows;
  const rate = (TAU * h) / w;
  const warnings: string[] = [];
  const target = (i.headCm * 10 * (1 - (i.negativeEasePct ?? 8) / 100)) / w;
  const N = Math.max(6, nearestCount(target, i.multiple, i.plus));
  const start = Math.max(3, Math.round(rate));
  const counts: number[] = [Math.min(start, N)];
  for (let k = 2; counts[counts.length - 1] < N; k++) {
    const prev = counts[counts.length - 1];
    const want = i.regular === false ? Math.round(k * rate) : k * start;
    counts.push(Math.min(N, 2 * prev, Math.max(prev + 1, want)));
  }
  const crownRounds = counts.length;
  const totalRounds = Math.max(crownRounds + 1, Math.round((i.heightCm * 10) / h));
  if (Math.round((i.heightCm * 10) / h) <= crownRounds) warnings.push('The hat height is less than the crown radius — the crown alone is that tall. Increase the height.');
  while (counts.length < totalRounds) counts.push(N);
  const history: number[][] = [];
  const rs: EmitRound[] = counts.map((c, k) => {
    if (k === 0) return { count: c, text: `mr, ${c} ${stitch} in ring` };
    const sp = spreadEvenly(counts[k - 1], c, { stagger: i.stagger ?? true, history });
    if (sp.angles.length) history.unshift(sp.angles);
    return { count: c, text: compressUnits(sp.units, stitch) };
  });
  rs[crownRounds].before = [`Crown done: ${N} sts (${fmt((N * w) / 10)} cm around). Work even to the brim.`];
  rs[rs.length - 1].trailing = 'fasten off';
  const { text } = emitPattern({
    header: header(i.title ?? `Top-down hat for a ${fmt(i.headCm)} cm head`, i.params, [['notes', `Spiral rounds from the crown. Gauge ${fmt(i.gauge.stitches)} sts x ${fmt(i.gauge.rows)} rows = 10 cm in ${stitch}; ${fmt(i.negativeEasePct ?? 8)}% negative ease.`]]),
    rounds: rs,
    after: ['Finish with sc, hdc, then sl st over the last 3 sts to smooth the spiral step; weave in the ends.'],
  });
  return {
    stitches: N, crownRounds, bodyRounds: counts.length - crownRounds, counts, perRound: rate,
    actualCircumferenceCm: (N * w) / 10, actualHeightCm: (counts.length * h) / 10, crownDiameterCm: (2 * crownRounds * h) / 10,
    warnings, text,
  };
}

/* ------------------------------------------------------------------ gauge conversion */

export interface ConvertInput {
  pattern: Gauge;
  mine: Gauge;
  /** Counts written in the pattern. */
  stitches?: number;
  rows?: number;
  /** Your current hook, for the hint. */
  hookMm?: number;
}
export interface ConvertResult {
  /** Counts that give the pattern's measurements at your gauge. */
  stitches?: number;
  rows?: number;
  /** Your piece's size relative to the pattern's if you follow the counts unchanged (1.05 = 5% bigger). */
  widthFactor: number;
  heightFactor: number;
  /** Stitch-gauge difference (mine vs pattern, %), positive = your stitches are smaller. */
  diffPct: number;
  /** Hedged suggestion. */
  hint: string;
  suggestedHookMm?: number;
}

export const HOOK_SIZES_MM = [2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8, 9, 10, 12];

/**
 * Rescale counts from the pattern's gauge to yours, and a hedged hook hint: as a rule of thumb one
 * hook size (≈ 0.25–0.5 mm) changes stitch gauge by roughly 5–8%; it varies with yarn and hand.
 */
export function convertGauge(i: ConvertInput): ConvertResult {
  const widthFactor = i.pattern.stitches / i.mine.stitches;
  const heightFactor = i.pattern.rows / i.mine.rows;
  const diffPct = (i.mine.stitches / i.pattern.stitches - 1) * 100;
  const out: ConvertResult = {
    widthFactor, heightFactor, diffPct,
    stitches: i.stitches !== undefined ? Math.max(1, Math.round((i.stitches * i.mine.stitches) / i.pattern.stitches)) : undefined,
    rows: i.rows !== undefined ? Math.max(1, Math.round((i.rows * i.mine.rows) / i.pattern.rows)) : undefined,
    hint: '',
  };
  const a = Math.abs(diffPct);
  if (a < 2.5) { out.hint = 'Your stitch gauge matches the pattern (within about 2%). Keep your hook.'; return out; }
  const sizes = Math.max(1, Math.round(a / 6));
  const up = diffPct > 0; // more stitches per 10 cm than the pattern = stitches too small → bigger hook
  if (i.hookMm) {
    const idx = HOOK_SIZES_MM.findIndex((x) => x >= i.hookMm! - 1e-6);
    const j = Math.min(HOOK_SIZES_MM.length - 1, Math.max(0, (idx < 0 ? HOOK_SIZES_MM.length - 1 : idx) + (up ? sizes : -sizes)));
    out.suggestedHookMm = HOOK_SIZES_MM[j];
  }
  out.hint = `Your stitches are ${a.toFixed(0)}% ${up ? 'smaller' : 'larger'} than the pattern's. `
    + `Either use the adjusted counts, or try a ${up ? 'larger' : 'smaller'} hook — very roughly ${sizes} size${sizes > 1 ? 's' : ''}`
    + `${out.suggestedHookMm ? ` (${out.suggestedHookMm} mm)` : ''} — and swatch again: the effect of a hook change varies with yarn and hand, and row gauge may not follow.`;
  return out;
}
