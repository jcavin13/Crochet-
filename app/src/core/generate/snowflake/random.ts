/**
 * Seeded snowflakes: randomSnowflake(seed, constraints), mutateSnowflake(spec, seed) ("more like
 * this"), snowflakeVariations(…) for the gallery, and SNOWFLAKE_PRESETS. Deterministic per seed.
 *
 * Style sliders (0…1): bold (delicate ↔ bold: sl st vs sc spines, picot size, centre),
 * spiky (rounded ↔ spiky: tip style, arm length, valley depth), ornate (plain ↔ ornate: branches,
 * trefoils, minor points, body rounds). A draw is kept when the snowflake check passes (body flat,
 * bridges fine, arms clear, crisp star) and the size is within the target; otherwise the sampler
 * redraws (up to 16 times) and keeps the best draw.
 */
import { paramSetById, paramsFile, type ParamSet } from '../../params';
import { prng } from '../random';
import { planSnowflake, normaliseSpec } from './build';
import { blockedShape } from './geometry';
import type { MinorStyle, SnowBodyMotif, SnowCentreStyle, SnowflakeSpec, TipStyle, ValleyDepth } from './types';

export interface SnowConstraints {
  /** Fixed number of points (default: 6 most of the time, sometimes 5, 8 or 12). */
  points?: number;
  /** Total rounds [min, max], 2–7 (default [3, 5]). */
  rounds?: [number, number];
  /** Finished size across the points, cm [min, max] (default [6, 10]). */
  sizeCm?: [number, number];
  /** 0 delicate … 1 bold (default 0.4). */
  bold?: number;
  /** 0 rounded … 1 spiky (default 0.6). */
  spiky?: number;
  /** 0 plain … 1 ornate (default 0.5). */
  ornate?: number;
  /** Major/minor arms: 'auto' (default), 'major' (no minor points), 'both'. */
  arms?: 'auto' | 'major' | 'both';
  params?: ParamSet;
}

const THREAD = paramSetById('thread-10_1.5mm') ?? paramSetById(paramsFile.default_set) ?? paramsFile.sets[0];

function weighted<T extends string>(rnd: () => number, w: Partial<Record<T, number>>): T {
  const e = Object.entries(w).filter(([, v]) => (v as number) > 0) as [T, number][];
  let x = rnd() * e.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of e) { x -= v; if (x <= 0) return k; }
  return e[e.length - 1][0];
}
const int = (rnd: () => number, lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

function draw(rnd: () => number, c: SnowConstraints): SnowflakeSpec {
  const bold = c.bold ?? 0.4, spiky = c.spiky ?? 0.6, ornate = c.ornate ?? 0.5;
  const points = c.points ?? weighted(rnd, { 6: 0.82, 8: 0.07, 12: 0.06, 5: 0.05 } as Record<string, number>) as unknown as number;
  const n = Number(points);
  const [lo, hi] = c.rounds ?? [3, 5];
  const R = int(rnd, Math.max(2, lo), Math.max(Math.max(2, lo), Math.min(7, hi)));
  const centre = weighted<SnowCentreStyle>(rnd, {
    spoked: 2 * (1 - bold) + 0.5, 'double-spoked': n <= 8 ? 0.6 + ornate : 0.2, ring: 0.4 + 1.5 * bold, cluster: 0.3 + bold * ornate * 2, petal: n <= 8 ? 0.2 + ornate : 0.1,
  });
  const body: SnowflakeSpec['body'] = [];
  let mm = false;
  for (let i = 0; i < R - 2; i++) {
    const m = weighted<SnowBodyMotif>(rnd, { hexagon: 1.2 + (1 - bold), corners: 1 + bold, 'major-minor': mm || n > 8 ? 0 : 0.3 + ornate });
    if (m === 'major-minor') mm = true;
    const params = m === 'corners' ? (rnd() < bold * 0.6 ? { side: 'solid' } : rnd() < 0.4 ? { side: 'shell' } : { side: 'chain' }) : undefined;
    body.push(params ? { motif: m, params } : { motif: m });
  }
  const tip = weighted<TipStyle>(rnd, {
    picot: 1, spike: 0.3 + 2 * spiky, trefoil: 0.3 + 1.5 * ornate, bobble: 0.2 + (1 - spiky) * bold * 2, loop: 0.2 + 1.5 * (1 - spiky),
  });
  const branches = tip === 'loop' ? 0 : Math.min(3, Math.floor(rnd() * (0.6 + 3.2 * ornate)));
  const wantMinor = c.arms === 'both' || (c.arms !== 'major' && n <= 8 && rnd() < 0.15 + 0.55 * ornate);
  const minorStyle: MinorStyle = wantMinor ? weighted<MinorStyle>(rnd, { picot: 1.2, spike: 0.4 + spiky, trefoil: 0.2 + ornate }) : 'none';
  const depth = weighted<ValleyDepth>(rnd, { deep: 0.3 + spiky, medium: 1, shallow: 0.2 + (1 - spiky) });
  return {
    points: n,
    centre: { style: centre },
    body,
    arm: {
      length: Math.round(5 + spiky * 7 + rnd() * 3), branches, picot: Math.min(6, 3 + Math.floor(rnd() * (1 + 2.5 * bold))), tip,
      back: rnd() < bold * 0.8 ? 'sc' : 'slst', graded: branches > 1 && rnd() < ornate,
    },
    minor: { style: minorStyle, length: int(rnd, 2, 4), picot: int(rnd, 3, 4) },
    valley: { depth, anchor: rnd() < 0.25 + 0.3 * bold },
  };
}

export interface SnowEval { ok: boolean; acrossCm: number; miss: number; spec: SnowflakeSpec }

/** Plan + blocked shape without compiling (fast). */
export function quickCheck(spec: SnowflakeSpec, params: ParamSet, sizeCm?: [number, number]): SnowEval {
  const plan = planSnowflake(spec, params);
  const shape = blockedShape(normaliseSpec(spec), plan, params);
  const bodyFlat = plan.planned.slice(0, -1).every((p) => p.cls === 'flat' && Math.abs(p.e) <= 0.1);
  const web = shape.bridges.every((b) => b.verdict === 'ok');
  const crisp = shape.tipR >= 1.35 * shape.valleyR && shape.valleyR > shape.bodyR * 0.98;
  const ok = bodyFlat && web && crisp && shape.clearanceMm >= 1 && !plan.warnings.length;
  const acrossCm = shape.acrossMm / 10;
  const miss = !sizeCm ? 0 : acrossCm < sizeCm[0] ? sizeCm[0] - acrossCm : acrossCm > sizeCm[1] ? acrossCm - sizeCm[1] : 0;
  return { ok, acrossCm, miss, spec };
}

/** Fit the arm length (and if needed the branches) to the size target; keep it valid. */
export function fitSize(spec: SnowflakeSpec, params: ParamSet, sizeCm?: [number, number]): SnowEval {
  const target = sizeCm ? (sizeCm[0] + sizeCm[1]) / 2 : undefined;
  let best: SnowEval | null = null;
  const lengths = target === undefined ? [spec.arm.length] : Array.from({ length: 22 }, (_, i) => i + 3);
  for (const L of lengths) {
    for (const br of [spec.arm.branches, Math.max(0, spec.arm.branches - 1), 0]) {
      const s: SnowflakeSpec = { ...spec, arm: { ...spec.arm, length: L, branches: br } };
      const ev = quickCheck(s, params, sizeCm);
      const cost = (ev.ok ? 0 : 100) + ev.miss * 10 + (target !== undefined ? Math.abs(ev.acrossCm - target) : 0) + (spec.arm.branches - br) * 0.5;
      const bc = best ? (best.ok ? 0 : 100) + best.miss * 10 + (target !== undefined ? Math.abs(best.acrossCm - target) : 0) + (spec.arm.branches - best.spec.arm.branches) * 0.5 : Infinity;
      if (cost < bc) best = ev;
      if (ev.ok) break;
    }
  }
  return best!;
}

/** A plausible, checked snowflake for `seed` under the constraints. */
export function randomSnowflake(seed: number, c: SnowConstraints = {}): SnowflakeSpec {
  const rnd = prng(seed);
  const params = c.params ?? THREAD;
  const size = c.sizeCm ?? [6, 10];
  let best: SnowEval | null = null;
  for (let attempt = 0; attempt < 16; attempt++) {
    const ev = fitSize(draw(rnd, c), params, size);
    if (!best || (ev.ok && !best.ok) || (ev.ok === best.ok && ev.miss < best.miss)) best = ev;
    if (ev.ok && ev.miss === 0) break;
  }
  return { ...best!.spec, seed };
}

/** "More like this": change one or two things, keep the rest; deterministic per seed. */
export function mutateSnowflake(spec: SnowflakeSpec, seed: number, c: SnowConstraints = {}): SnowflakeSpec {
  const rnd = prng(seed * 7919 + 17);
  const params = c.params ?? THREAD;
  for (let attempt = 0; attempt < 12; attempt++) {
    const s: SnowflakeSpec = JSON.parse(JSON.stringify(spec));
    const changes = 1 + (rnd() < 0.4 ? 1 : 0);
    for (let k = 0; k < changes; k++) {
      switch (int(rnd, 0, 7)) {
        case 0: s.arm.length = Math.max(3, s.arm.length + (rnd() < 0.5 ? -1 : 1) * int(rnd, 1, 3)); break;
        case 1: s.arm.branches = Math.max(0, Math.min(3, s.arm.branches + (rnd() < 0.5 ? -1 : 1))); break;
        case 2: s.arm.tip = (['picot', 'trefoil', 'spike', 'bobble', 'loop'] as TipStyle[])[int(rnd, 0, 4)]; break;
        case 3: s.arm.picot = Math.max(3, Math.min(6, s.arm.picot + (rnd() < 0.5 ? -1 : 1))); break;
        case 4: s.valley.depth = (['deep', 'medium', 'shallow'] as ValleyDepth[])[int(rnd, 0, 2)]; break;
        case 5: s.minor.style = s.minor.style === 'none' ? (['picot', 'spike', 'trefoil'] as MinorStyle[])[int(rnd, 0, 2)] : 'none'; break;
        case 6: s.arm.back = s.arm.back === 'sc' ? 'slst' : 'sc'; break;
        case 7: {
          if (s.body.length && rnd() < 0.5) s.body[int(rnd, 0, s.body.length - 1)] = { motif: (['hexagon', 'corners', 'major-minor'] as SnowBodyMotif[])[int(rnd, 0, 2)] };
          else s.centre = { style: (['ring', 'spoked', 'double-spoked', 'cluster', 'petal'] as SnowCentreStyle[])[int(rnd, 0, 4)] };
        }
      }
    }
    s.seed = seed;
    const ev = quickCheck(s, params);
    if (ev.ok && JSON.stringify(s) !== JSON.stringify({ ...spec, seed })) return s;
  }
  return { ...spec, seed, arm: { ...spec.arm, length: spec.arm.length + 1 } };
}

/** The gallery: `count` deterministic variations (fresh seeds, or mutations of `base`). */
export function snowflakeVariations(seed: number, count: number, c: SnowConstraints = {}, base?: SnowflakeSpec): SnowflakeSpec[] {
  const out: SnowflakeSpec[] = [];
  for (let i = 0; i < count; i++) {
    const s = seed * 100 + i + 1;
    out.push(base ? mutateSnowflake(base, s, c) : randomSnowflake(s, c));
  }
  return out;
}

export interface SnowPreset { id: string; label: string; blurb: string; spec: SnowflakeSpec }

const valley = (depth: ValleyDepth, anchor = false) => ({ depth, anchor });
const noMinor = { style: 'none' as const, length: 3, picot: 3 };

export const SNOWFLAKE_PRESETS: SnowPreset[] = [
  {
    id: 'simple-star', label: 'Simple star', blurb: 'Spoked ring, one loop round, six picot-tipped spines — the classic first snowflake.',
    spec: { points: 6, title: 'Simple star snowflake', centre: { style: 'spoked' }, body: [{ motif: 'hexagon' }], arm: { length: 8, branches: 0, picot: 4, tip: 'picot', back: 'slst' }, minor: noMinor, valley: valley('medium') },
  },
  {
    id: 'fern', label: 'Fern', blurb: 'Long spines with three pairs of graded side branches.',
    spec: { points: 6, title: 'Fern snowflake', centre: { style: 'spoked' }, body: [{ motif: 'hexagon' }, { motif: 'corners', params: { side: 'chain' } }], arm: { length: 13, branches: 3, picot: 3, tip: 'picot', back: 'slst', graded: true }, minor: noMinor, valley: valley('deep') },
  },
  {
    id: 'trefoil', label: 'Trefoil points', blurb: 'A crisp hexagon body and trefoil tips on short spines.',
    spec: { points: 6, title: 'Trefoil snowflake', centre: { style: 'ring' }, body: [{ motif: 'corners' }], arm: { length: 7, branches: 1, picot: 4, tip: 'trefoil', back: 'slst' }, minor: noMinor, valley: valley('medium', true) },
  },
  {
    id: 'lacy-hexagon', label: 'Lacy hexagon', blurb: 'Two loop rounds and pointed chain loops — soft and open.',
    spec: { points: 6, title: 'Lacy hexagon snowflake', centre: { style: 'double-spoked' }, body: [{ motif: 'hexagon' }, { motif: 'hexagon' }], arm: { length: 10, branches: 0, picot: 4, tip: 'loop', back: 'slst' }, minor: noMinor, valley: valley('medium') },
  },
  {
    id: 'double-pointed', label: 'Double-pointed', blurb: 'Major/minor corners: six big spikes and six small picot points between.',
    spec: { points: 6, title: 'Double-pointed snowflake', centre: { style: 'ring' }, body: [{ motif: 'major-minor' }], arm: { length: 10, branches: 1, picot: 3, tip: 'spike', back: 'slst' }, minor: { style: 'spike', length: 3, picot: 3 }, valley: valley('deep') },
  },
  {
    id: 'tiny', label: 'Tiny ornament', blurb: 'Two rounds, about 4 cm: a tree ornament or gift tag.',
    spec: { points: 6, title: 'Tiny snowflake ornament', centre: { style: 'spoked' }, body: [], arm: { length: 5, branches: 0, picot: 3, tip: 'trefoil', back: 'slst' }, minor: noMinor, valley: valley('medium') },
  },
  {
    id: 'bold-star', label: 'Bold eight-point star', blurb: 'Solid hub, corners and bobble tips on sc spines.',
    spec: { points: 8, title: 'Bold eight-point star', centre: { style: 'ring' }, body: [{ motif: 'corners', params: { side: 'solid' } }, { motif: 'hexagon' }], arm: { length: 9, branches: 0, picot: 4, tip: 'bobble', back: 'sc' }, minor: noMinor, valley: valley('deep', true) },
  },
];
