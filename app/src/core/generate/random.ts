/**
 * "Surprise me": a seeded sampler over a small Markov grammar of round motifs
 *
 *   centre → (spokes | mesh | solid | clusters | …) → body motifs → edging (picot | fans [+ picot])
 *
 * Transition weights are tilted by the lacy↔solid slider. Some motifs get a "character" parameter
 * pinned (shell form, cluster height, picot size…) so designs differ in look, not only in counts;
 * everything else is left to the flatness solver. With a diameter constraint the sampler draws up
 * to 24 designs from the same seeded stream and keeps the first that fits (or the closest).
 * Deterministic: the same seed and constraints always give the same spec.
 */
import { paramSetById, paramsFile, type ParamSet } from '../params';
import { generateDoily, planDoily } from './generate';
import type { DoilySpec, Height, MotifId, RoundParams, RoundSpec, ShapeTarget } from './types';
import { MOTIFS } from './motifs';

/** mulberry32: small, fast, good enough for design sampling. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RandomConstraints {
  /** Fixed symmetry, or a [min, max] range to sample from (default [5, 16]). */
  symmetry?: number | [number, number];
  /** Total rounds [min, max] (default [6, 10]). */
  rounds?: [number, number];
  /** Wanted finished diameter in cm [min, max] (needs `params`). */
  diameterCm?: [number, number];
  /** 0 solid … 1 lacy (default 0.6). */
  lacy?: number;
  heights?: Height[];
  target?: ShapeTarget;
  terms?: 'US' | 'UK';
  /** Parameter set used to check flatness and the diameter constraint (default: the default set). */
  params?: ParamSet;
}

type W = Partial<Record<MotifId, number>>;
const NEXT: Record<MotifId, W> = {
  centre: { solid: 2, spokes: 3, mesh: 2, clusters: 1.5, puffs: 1, vstitch: 1, accent: 0.7 },
  solid: { solid: 1.5, accent: 1.2, spokes: 2, mesh: 2, clusters: 1, puffs: 1, shells: 1, vstitch: 1 },
  accent: { solid: 2, spokes: 1.5, mesh: 1.5, clusters: 0.5 },
  spokes: { shells: 3, vstitch: 2, mesh: 2, clusters: 1, puffs: 1, solid: 1 },
  mesh: { arches: 2, shells: 3, petals: 1.5, vstitch: 1.5, clusters: 1, puffs: 1, mesh: 1, fans: 0.5 },
  arches: { arches: 1, shells: 2.5, petals: 1.5, mesh: 1, vstitch: 1, fans: 0.5 },
  clusters: { mesh: 2.5, shells: 1.5, petals: 1, vstitch: 1, spokes: 1 },
  puffs: { mesh: 2, shells: 1.5, vstitch: 1, filler: 1 },
  vstitch: { shells: 2.5, vstitch: 1, mesh: 2, puffs: 1, clusters: 1 },
  shells: { mesh: 3, vstitch: 1.5, shells: 1, arches: 0.5, petals: 1, fans: 0.5, filler: 0.7 },
  petals: { mesh: 3, arches: 1.5, shells: 1, vstitch: 1 },
  fans: { mesh: 2, solid: 1, filler: 0.5, spokes: 1 },
  filler: { mesh: 2, spokes: 1.5, shells: 1, solid: 1, accent: 1 },
  picot: { mesh: 1 },
};

function pick<T extends string>(rnd: () => number, w: Partial<Record<T, number>>): T {
  const entries = Object.entries(w).filter(([, v]) => (v as number) > 0) as [T, number][];
  const total = entries.reduce((a, [, v]) => a + v, 0);
  let x = rnd() * total;
  for (const [k, v] of entries) { x -= v; if (x <= 0) return k; }
  return entries[entries.length - 1][0];
}
const int = (rnd: () => number, lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

/** Pinned "character" params that change the look of a motif. */
function character(rnd: () => number, m: MotifId, heights: Height[]): RoundParams | undefined {
  const tall = heights.includes('tr');
  switch (m) {
    case 'centre': return rnd() < 0.3 ? { style: 'spoked' } : undefined;
    case 'shells': return rnd() < 0.4 ? { alt: 1 } : rnd() < 0.5 ? { alt: 0 } : undefined;
    case 'clusters': return tall && rnd() < 0.4 ? { base: 'tr' } : undefined;
    case 'petals': return tall && rnd() < 0.6 ? { base: 'tr' } : { base: 'dc' };
    case 'fans': return { form: rnd() < 0.5 ? 'scallop' : 'shell' };
    case 'picot': return rnd() < 0.3 ? { picot: 4 } : undefined;
    case 'puffs': return rnd() < 0.4 ? { pair: 2 } : undefined;
    case 'accent': return { kind: (['pc', 'puff', 'bobble'] as const)[int(rnd, 0, 2)] };
    default: return undefined;
  }
}

function sampleOnce(rnd: () => number, c: RandomConstraints): DoilySpec {
  const lacy = c.lacy ?? 0.6;
  const heights = c.heights?.length ? c.heights : (['sc', 'hdc', 'dc', 'tr'] as Height[]);
  let n: number;
  if (typeof c.symmetry === 'number') n = c.symmetry;
  else {
    const [lo, hi] = c.symmetry ?? [5, 16];
    const common = [6, 8, 10, 12, 16].filter((x) => x >= lo && x <= hi);
    n = common.length && rnd() < 0.6 ? common[int(rnd, 0, common.length - 1)] : int(rnd, lo, hi);
  }
  const [rLo, rHi] = c.rounds ?? [6, 10];
  const R = Math.max(2, int(rnd, Math.max(2, rLo), Math.max(rLo, rHi)));
  const tilt = (w: W): W => {
    const out: W = {};
    for (const [k, v] of Object.entries(w) as [MotifId, number][]) {
      const t = MOTIFS[k].texture;
      out[k] = v * (t === 'lacy' ? 0.25 + 1.5 * lacy : t === 'solid' ? 0.25 + 1.5 * (1 - lacy) : 1);
    }
    return out;
  };
  const seq: MotifId[] = ['centre'];
  // edging: picot, fans, or fans then picot
  const edge: MotifId[] = R >= 5 && rnd() < 0.35 ? ['fans', 'picot'] : rnd() < 0.65 ? ['picot'] : ['fans'];
  while (seq.length < R - edge.length) {
    const prev = seq[seq.length - 1];
    const w = tilt({ ...NEXT[prev] });
    if (seq.length >= 2 && seq[seq.length - 2] === prev) delete w[prev]; // no motif three times running
    seq.push(pick(rnd, w));
  }
  seq.push(...edge.slice(0, Math.max(0, R - seq.length)));
  const rounds: RoundSpec[] = seq.map((m) => {
    const params = character(rnd, m, heights);
    return params ? { motif: m, prefer: params } : { motif: m };
  });
  return {
    symmetry: n, rounds, seed: undefined, terms: c.terms ?? 'US', target: c.target ?? { shape: 'flat' },
    style: { lacy, heights },
  };
}

/** Default parameter set for the sampler's own checks when none is given. */
const DEFAULT_PARAMS = paramSetById(paramsFile.default_set) ?? paramsFile.sets[0];

/**
 * A plausible random design for `seed` under the constraints. The sampler draws from the grammar
 * and keeps the first design whose planned rounds all hit their aim (flat, or the ruffle/bowl
 * target) and whose diameter fits; after 24 draws it keeps the best one seen. `raw: true` returns
 * the first draw unfiltered (used by the tests to measure the solver on its own).
 */
export function randomSpec(seed: number, constraints: RandomConstraints = {}, opts: { raw?: boolean } = {}): DoilySpec {
  const rnd = prng(seed);
  const params = constraints.params ?? DEFAULT_PARAMS;
  const want = constraints.diameterCm;
  let best: { spec: DoilySpec; bad: number; miss: number } | null = null;
  for (let attempt = 0; attempt < (opts.raw ? 1 : 24); attempt++) {
    const spec = sampleOnce(rnd, constraints);
    spec.seed = seed;
    if (opts.raw) return spec;
    const plan = planDoily(spec, params);
    const bad = plan.planned.filter((p) => p.pred.cls !== (p.aim === 'cup' ? 'cup' : p.aim)).length;
    const last = plan.planned[plan.planned.length - 1];
    const cm = last ? (2 * last.pred.r) / 10 : 0;
    const miss = !want ? 0 : cm < want[0] ? want[0] - cm : cm > want[1] ? cm - want[1] : 0;
    if (!best || bad < best.bad || (bad === best.bad && miss < best.miss)) best = { spec, bad, miss };
    if (bad === 0 && miss === 0) break;
  }
  return best!.spec;
}

/** Convenience: sample and generate in one go. */
export function surprise(seed: number, constraints: RandomConstraints, params: ParamSet) {
  const spec = randomSpec(seed, { ...constraints, params });
  return { spec, result: generateDoily(spec, params) };
}
