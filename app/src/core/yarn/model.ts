/**
 * The per-stitch yarn model of spec/yarn.md, driven by spec/yarn_defaults.json. Pure; no DOM.
 *
 *   L(node) = post · [ k_w · (a·w + π·e·d) + k_h · (b·h) ]          (mm)
 *
 * w, h: the stitch's rest width / height from the param set; d: yarn diameter; (a, b, e): the
 * stitch type's structural coefficients (strands across the width, strands up the height, 180°
 * turns of the yarn round another strand or the hook); k_w, k_h: calibration (1 = nominal).
 * Mirrored in lab/src/crolab/yarn.py; the two are pinned together by spec/yarn_golden.json.
 */
import defaultsJson from '@spec/yarn_defaults.json';
import type { Node, StitchType } from '../graph';
import { stitchParam, type ParamSet } from '../params';

export interface Coeffs { a: number; b: number; events: number }
interface StitchDef {
  a?: number; b?: number; events?: number;
  b_per?: number; events_per?: number; per?: string; per_default?: number;
  compose?: string; then?: string; why?: string;
}
export interface Category {
  label: string; m_per_100g: number; m_per_100g_range: [number, number]; wpi: [number, number];
  diameter_mm: number; ball_g: number;
}
export interface Band { low: number; high: number; why?: string }
export interface YarnDefaults {
  version: string; status: string; model: string; wrap_per_event: number;
  stitches: Record<string, StitchDef>;
  post_factor: Record<string, number>;
  band: { nominal: Band; calibrated: Band; calibrated_split: Band };
  allowance: number;
  categories: Record<string, Category>;
  default_category: string;
}

export const yarnDefaults = defaultsJson as unknown as YarnDefaults;

/** The parts of a node's yarn length that the two calibration factors scale. */
export interface Parts {
  /** a·w + π·e·d (mm): strands across the stitch and the turns round strands / the hook. */
  loop: number;
  /** b·h (mm): strands up the stitch's post. */
  height: number;
  /** post-stitch factor (1 for everything else). */
  post: number;
}

/** The fields of a graph node the model reads (a synthetic node works too). */
export type NodeLike = Pick<Node, 'type' | 'into'> & Partial<Pick<Node, 'loop' | 'tag' | 'legs' | 'loops' | 'chains' | 'role' | 'countsAs'>>;

const SIMPLE = new Set(['ch', 'slst', 'sc', 'hdc', 'dc', 'tr', 'dtr']);
const TOGGABLE = new Set(['sc', 'hdc', 'dc', 'tr', 'dtr']);

function def(type: string): StitchDef {
  const d = yarnDefaults.stitches[type];
  if (!d) throw new Error(`yarn_defaults.json: no coefficients for stitch ${type}`);
  return d;
}

/** Structural coefficients of a simple stitch, or of an N-leg decrease / cluster of it. */
export function coefficients(type: string, legs = 1): Coeffs {
  const d = def(type);
  const base = { a: d.a ?? 0, b: d.b ?? 0, events: d.events ?? 0 };
  if (legs >= 2 && TOGGABLE.has(type)) return { a: base.a, b: legs * base.b, events: legs * (base.events - 1) + 1 };
  return base;
}

const W = Math.PI; // yarnDefaults.wrap_per_event (π); kept as the literal for exact agreement with the lab

function simpleParts(set: ParamSet, type: string, d: number, legs = 1): { loop: number; height: number } {
  const c = coefficients(type, legs);
  const p = stitchParam(set, type as StitchType);
  return { loop: c.a * p.width + W * c.events * d, height: c.b * p.height };
}

/** Loop / height parts of one node (mm), before calibration. */
export function nodeParts(n: NodeLike, set: ParamSet, d: number): Parts {
  const post = yarnDefaults.post_factor[n.loop ?? ''] ?? 1;
  const t = n.type;
  if (SIMPLE.has(t)) {
    const legs = t === 'ch' || t === 'slst' ? 1 : Math.max(1, n.into.length);
    return { ...simpleParts(set, t, d, legs), post };
  }
  const sd = def(t);
  if (t === 'puff') {
    const k = n.loops ?? sd.per_default ?? 3;
    const p = stitchParam(set, 'puff');
    return { loop: (sd.a ?? 0) * p.width + W * ((sd.events ?? 0) + (sd.events_per ?? 0) * k) * d, height: (sd.b_per ?? 0) * k * p.height, post };
  }
  if (t === 'popcorn') {
    const k = n.legs ?? sd.per_default ?? 5;
    const dc = simpleParts(set, sd.compose ?? 'dc', d);
    const p = stitchParam(set, 'popcorn');
    return { loop: k * dc.loop + (sd.a ?? 0) * p.width + W * (sd.events ?? 0) * d, height: k * dc.height + (sd.b ?? 0) * p.height, post };
  }
  if (t === 'picot') {
    const k = n.chains ?? sd.per_default ?? 3;
    const ch = simpleParts(set, sd.compose ?? 'ch', d);
    const ss = simpleParts(set, sd.then ?? 'slst', d);
    return { loop: k * ch.loop + ss.loop, height: k * ch.height + ss.height, post };
  }
  throw new Error(`no yarn model for stitch type ${t}`);
}

/** Calibrated length of one node (mm). */
export function partsLength(p: Parts, kWidth = 1, kHeight = 1): number {
  return p.post * (kWidth * p.loop + kHeight * p.height);
}

/* ------------------------------------------------------------------ categories */

/** Category key of a param set's `yarn_weight` ('medium-4', 'thread-10', …), with fallbacks. */
export function categoryKey(yarnWeight: string | undefined): string {
  const cats = yarnDefaults.categories;
  if (yarnWeight && cats[yarnWeight]) return yarnWeight;
  const w = (yarnWeight ?? '').toLowerCase();
  if (/thread|cotton/.test(w)) {
    const n = /(\d+)/.exec(w);
    const k = n ? `thread-${n[1]}` : 'thread-10';
    return cats[k] ? k : 'thread-10';
  }
  const m = /(\d)\s*$/.exec(w) ?? /cyc\s*(\d)/.exec(w);
  if (m) {
    const hit = Object.keys(cats).find((k) => k.endsWith(`-${m[1]}`) && !k.startsWith('thread'));
    if (hit) return hit;
  }
  for (const [k, re] of [['lace-0', /lace/], ['superfine-1', /fingering|sock|super\s*fine/], ['fine-2', /sport|baby/], ['light-3', /dk|light/],
    ['medium-4', /worsted|aran|medium/], ['superbulky-6', /super\s*bulky/], ['bulky-5', /bulky|chunky/], ['jumbo-7', /jumbo/]] as const) {
    if (re.test(w)) return k;
  }
  return yarnDefaults.default_category;
}

/** Yarn diameter (mm) for a category, scaled to a yarn of `metersPer100g` (constant effective density). */
export function diameterFor(category: string, metersPer100g?: number): number {
  const c = yarnDefaults.categories[category] ?? yarnDefaults.categories[yarnDefaults.default_category];
  if (!metersPer100g || !(metersPer100g > 0)) return c.diameter_mm;
  return c.diameter_mm * Math.sqrt(c.m_per_100g / metersPer100g);
}

/** Typical CYC tch length (chains) of a stitch, for swatch foundation / turning chains (stitches.json). */
export const TCH: Record<string, number> = { slst: 1, sc: 1, hdc: 2, dc: 3, tr: 4, dtr: 5, puff: 2, popcorn: 3 };
