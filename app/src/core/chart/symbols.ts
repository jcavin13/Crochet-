/**
 * Chart symbols, generated structurally (see SYMBOLS.md):
 *   stem(s) from the anchor point(s) to the top, a bar on top for hdc and taller, one hatch per
 *   yarn-over (dc 1, tr 2, dtr 3 — from the stitch height in stitches.json), legs joined at the top
 *   for decreases and clusters, a fan closed by a cap for popcorns, a lens for puffs, ovals for
 *   chains, a dot for slip stitches, a loop for picots, arcs / hooks under the stem for FLO / BLO /
 *   FP / BP. Output is SVG path data in chart units (one stroke path + one fill path per symbol).
 */
import type { Node, StitchType, Terms } from '../graph';
import { nameOf, tchHeight } from '../notation/vocab';
import type { ChartLayout, ChartNode, Pt, SymbolSpec } from './types';

export type SymbolSet = 'cyc' | 'jis';
export type ScGlyph = 'x' | 'plus';
export interface SymbolOptions {
  /** 'cyc' (Craft Yarn Council, default) or 'jis' (Japanese chart conventions; see SYMBOLS.md). */
  set?: SymbolSet;
  /** Single crochet as '×' (default) or '+'. */
  sc?: ScGlyph;
}
export interface Glyph { stroke: string; fill: string }

const BASES = new Set<StitchType>(['sc', 'hdc', 'dc', 'tr', 'dtr']);

/** Yarn-overs drawn as hatches: one per yarn-over for dc and taller (hdc is the plain T). */
export function hatchesOf(type: StitchType): number {
  if (!BASES.has(type) || type === 'sc' || type === 'hdc') return 0;
  return Math.max(0, tchHeight(type) - 2);
}

export function symbolOf(n: Node): SymbolSpec {
  if (n.type === 'ch') return { key: 'ch', base: 'ch', legs: 1, cluster: false, hatches: 0 };
  if (n.type === 'slst') return { key: 'slst', base: 'slst', legs: 1, cluster: false, hatches: 0 };
  if (n.type === 'picot') {
    const c = n.chains ?? 3;
    return { key: c === 3 ? 'picot' : `picot${c}`, base: 'picot', legs: 1, cluster: false, hatches: 0, size: c };
  }
  if (n.type === 'puff') {
    const l = n.loops ?? 3;
    return { key: `puff${l}`, base: 'puff', legs: 1, cluster: false, hatches: 0, size: l };
  }
  if (n.type === 'popcorn') {
    const l = n.legs ?? 5;
    return { key: `pc${l}`, base: 'popcorn', legs: l, cluster: false, hatches: 0 };
  }
  const legs = Math.max(1, n.into.length);
  const cluster = n.tag === 'cluster';
  let key = cluster ? `${n.type}${legs}cl` : legs >= 2 ? `${n.type}${legs}tog` : n.type;
  const loop = n.loop;
  if (loop === 'fp' || loop === 'bp') key = `${loop}${key}`;
  else if (loop) key = `${key}:${loop}`;
  const spec: SymbolSpec = { key, base: n.type, legs, cluster, hatches: hatchesOf(n.type) };
  if (loop) spec.loop = loop;
  return spec;
}

/* ------------------------------------------------------------------ path helpers */

const f = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const P = (p: Pt) => `${f(p.x)} ${f(p.y)}`;
const add = (a: Pt, b: Pt, s = 1): Pt => ({ x: a.x + b.x * s, y: a.y + b.y * s });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: Pt) => Math.hypot(a.x, a.y);
const norm = (a: Pt): Pt => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const perpOf = (d: Pt): Pt => ({ x: -d.y, y: d.x });
const line = (a: Pt, b: Pt) => `M${P(a)}L${P(b)}`;
const circle = (c: Pt, r: number) => `M${f(c.x - r)} ${f(c.y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
function ellipse(c: Pt, rx: number, ry: number, rot: number): string {
  const u = { x: Math.cos(rot), y: Math.sin(rot) };
  const p1 = add(c, u, -rx), p2 = add(c, u, rx);
  const deg = f((rot * 180) / Math.PI);
  return `M${P(p1)}A${f(rx)} ${f(ry)} ${deg} 1 0 ${P(p2)}A${f(rx)} ${f(ry)} ${deg} 1 0 ${P(p1)}Z`;
}
const quadAt = (a: Pt, c: Pt, b: Pt, t: number): Pt => ({
  x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
  y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
});
const quadTan = (a: Pt, c: Pt, b: Pt, t: number): Pt => norm({
  x: 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x),
  y: 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y),
});

export const SYM = {
  stroke: 0.065,
  gap: 0.1,
  bar: 0.28,
  hatch: 0.17,
  hatchPitch: 0.17,
  chRx: 0.25,
  chRy: 0.12,
  dot: 0.085,
} as const;

/** Hatches across a leg: `k` slashes centred at fraction ~0.5 of the leg. */
function hatches(k: number, at: (t: number) => { p: Pt; d: Pt }, legLen: number): string {
  if (k <= 0) return '';
  let s = '';
  const pitch = Math.min(SYM.hatchPitch, (legLen * 0.6) / Math.max(1, k));
  const mid = 0.5;
  for (let i = 0; i < k; i++) {
    const off = (i - (k - 1) / 2) * pitch;
    const t = Math.min(0.85, Math.max(0.15, mid + off / Math.max(legLen, 1e-6)));
    const { p, d } = at(t);
    const q = perpOf(d);
    // slanted slash: from lower-left to upper-right of the stem
    const a = add(add(p, q, -SYM.hatch * 0.85), d, -SYM.hatch * 0.45);
    const b = add(add(p, q, SYM.hatch * 0.85), d, SYM.hatch * 0.45);
    s += line(a, b);
  }
  return s;
}

/** Glyph of one laid-out node. */
export function glyph(n: ChartNode, o: SymbolOptions = {}): Glyph {
  const set = o.set ?? 'cyc';
  const T: Pt = { x: n.x, y: n.y };
  switch (n.kind) {
    case 'chain':
    case 'tch':
    case 'ringch':
      return { stroke: ellipse(T, SYM.chRx, SYM.chRy, n.rot), fill: '' };
    case 'slst':
      return set === 'jis'
        ? { stroke: '', fill: ellipse(T, 0.13, 0.072, n.rot) }
        : { stroke: '', fill: circle(T, SYM.dot) };
    case 'picot': {
      const out = { x: Math.cos(n.rot), y: Math.sin(n.rot) };
      const chains = n.symbol.size ?? 3;
      const rl = 0.15 * Math.sqrt(chains / 3);
      const c = add(T, out, rl + 0.02);
      if (set === 'jis') {
        // a ring of small chain ovals closed by a dot (unverified; SYMBOLS.md)
        let s = '';
        const base = Math.atan2(-out.y, -out.x);
        for (let i = 0; i < chains; i++) {
          const a = base + ((i + 0.5) / chains) * Math.PI * 2;
          const p = { x: c.x + Math.cos(a) * rl * 1.15, y: c.y + Math.sin(a) * rl * 1.15 };
          s += ellipse(p, Math.min(0.11, (rl * 2.6) / chains), 0.055, a + Math.PI / 2);
        }
        return { stroke: s, fill: circle(T, 0.05) };
      }
      return { stroke: circle(c, rl), fill: circle(T, 0.055) };
    }
    default:
      return stitchGlyph(n, o);
  }
}

function stitchGlyph(n: ChartNode, o: SymbolOptions): Glyph {
  const set = o.set ?? 'cyc';
  const sp = n.symbol;
  const T: Pt = { x: n.x, y: n.y };
  const legsRaw = n.legs.length ? n.legs : [add(T, { x: Math.cos(n.rot), y: Math.sin(n.rot) }, -1)];
  const mean = legsRaw.reduce((a, p) => ({ x: a.x + p.x / legsRaw.length, y: a.y + p.y / legsRaw.length }), { x: 0, y: 0 });
  const dir = norm(sub(T, mean));
  const perp = perpOf(dir);
  const gapped = legsRaw.map((p) => add(p, norm(sub(T, p)), SYM.gap));
  const A = add(mean, dir, SYM.gap);
  const L = Math.max(0.2, len(sub(T, A)));
  let stroke = '';
  let fill = '';
  const base = sp.base;
  const collapsed = gapped.every((p) => len(sub(p, gapped[0])) < 0.08);

  if (base === 'sc' && sp.legs === 1) {
    const C = add(T, dir, -Math.min(L / 2, 0.42));
    const a = Math.min(0.21, Math.max(0.12, L * 0.3));
    // worked into the same place as its neighbour (inc): join the fan to the anchor
    if (n.fan && L - Math.min(L / 2, 0.42) - a > 0.4) stroke += line(A, add(C, dir, -a * 0.75));
    if ((o.sc ?? 'x') === 'plus') {
      stroke += line(add(C, dir, -a), add(C, dir, a)) + line(add(C, perp, -a), add(C, perp, a));
    } else {
      const d1 = { x: (dir.x + perp.x) * a * 0.7071, y: (dir.y + perp.y) * a * 0.7071 };
      const d2 = { x: (dir.x - perp.x) * a * 0.7071, y: (dir.y - perp.y) * a * 0.7071 };
      stroke += line(add(C, d1, -1), add(C, d1)) + line(add(C, d2, -1), add(C, d2));
    }
  } else if (base === 'puff') {
    const m = Math.max(2, sp.size ?? 3);
    const w = 0.16 + 0.03 * m;
    const curves: string[] = [];
    let lensL = '', lensR = '';
    for (let j = 0; j < m; j++) {
      const off = ((j - (m - 1) / 2) / ((m - 1) / 2)) * w;
      const c = add(add(A, sub(T, A), 0.5), perp, off * 2);
      curves.push(`M${P(A)}Q${P(c)} ${P(T)}`);
      if (j === 0) lensL = P(c);
      if (j === m - 1) lensR = P(c);
    }
    stroke += curves.join('');
    stroke += line(add(T, perp, -0.2), add(T, perp, 0.2));
    if (set === 'jis') fill += `M${P(A)}Q${lensL} ${P(T)}Q${lensR} ${P(A)}Z`;
  } else if (base === 'popcorn') {
    const m = Math.max(2, sp.legs);
    const w = 0.3;
    const tops: Pt[] = [];
    for (let j = 0; j < m; j++) tops.push(add(T, perp, ((j - (m - 1) / 2) / ((m - 1) / 2)) * w));
    for (const t of tops) stroke += line(A, t);
    stroke += `M${P(tops[0])}Q${P(add(T, dir, 0.42))} ${P(tops[m - 1])}`;
    if (set === 'jis') fill += `M${P(tops[0])}Q${P(add(T, dir, 0.42))} ${P(tops[m - 1])}Z`;
  } else {
    // sc decreases and hdc / dc / tr / dtr (single, tog, cluster)
    const k = sp.hatches;
    const m = sp.legs;
    const cross = base === 'sc';
    if (m === 1) {
      stroke += line(A, T);
      stroke += hatches(k, (t) => ({ p: add(A, sub(T, A), t), d: dir }), L);
    } else if (collapsed || sp.cluster) {
      // legs from one place fan out and rejoin at the top
      const spread = 0.17 + 0.02 * m;
      for (let j = 0; j < m; j++) {
        const off = ((j - (m - 1) / 2) / ((m - 1) / 2)) * spread;
        const a = collapsed ? A : gapped[j];
        const c = add(add(a, sub(T, a), 0.45), perp, off * 2);
        stroke += `M${P(a)}Q${P(c)} ${P(T)}`;
        const legLen = len(sub(T, a));
        stroke += hatches(k, (t) => ({ p: quadAt(a, c, T, t), d: quadTan(a, c, T, t) }), legLen);
        if (cross) stroke += smallX(quadAt(a, c, T, 0.5), quadTan(a, c, T, 0.5));
      }
    } else {
      for (const a of gapped) {
        stroke += line(a, T);
        const d = norm(sub(T, a));
        const legLen = len(sub(T, a));
        stroke += hatches(k, (t) => ({ p: add(a, sub(T, a), t), d }), legLen);
        if (cross) stroke += smallX(add(a, sub(T, a), 0.5), d);
      }
    }
    if (!cross) stroke += line(add(T, perp, -SYM.bar), add(T, perp, SYM.bar));
  }

  // loop modifiers under the stem
  const loop = sp.loop;
  if (loop === 'flo' || loop === 'blo') {
    const c = add(A, dir, -0.06);
    if (set === 'jis' && loop === 'blo') {
      stroke += line(add(c, perp, -0.19), add(c, perp, 0.19));
    } else {
      // CYC: FLO ⌣ (arc opening outward), BLO ⌢ (arc opening inward)
      const ctrl = add(c, dir, loop === 'flo' ? -0.22 : 0.22);
      const st = add(add(c, perp, -0.19), dir, loop === 'flo' ? 0.05 : -0.05);
      const en = add(add(c, perp, 0.19), dir, loop === 'flo' ? 0.05 : -0.05);
      stroke += `M${P(st)}Q${P(ctrl)} ${P(en)}`;
    }
  } else if (loop === 'fp' || loop === 'bp') {
    const side = loop === 'fp' ? 1 : -1;
    const c1 = add(A, dir, -0.16);
    const end = add(add(A, dir, -0.02), perp, side * 0.18);
    stroke += `M${P(A)}Q${P(add(c1, perp, side * 0.02))} ${P(add(add(A, dir, -0.12), perp, side * 0.1))}Q${P(add(add(A, dir, -0.16), perp, side * 0.2))} ${P(end)}`;
  }
  return { stroke, fill };
}

function smallX(c: Pt, d: Pt): string {
  const q = perpOf(d);
  const a = 0.11;
  const d1 = { x: (d.x + q.x) * a * 0.7071, y: (d.y + q.y) * a * 0.7071 };
  const d2 = { x: (d.x - q.x) * a * 0.7071, y: (d.y - q.y) * a * 0.7071 };
  return line(add(c, d1, -1), add(c, d1)) + line(add(c, d2, -1), add(c, d2));
}

/** Magic-ring symbol (a circle with a tail) — CYC "adjustable ring". */
export function magicRingGlyph(r: number): Glyph {
  const a0 = -Math.PI / 4;
  const p = { x: Math.cos(a0) * r, y: Math.sin(a0) * r };
  const tail = { x: Math.cos(a0) * (r + 0.32), y: Math.sin(a0) * (r + 0.32) + 0.12 };
  return { stroke: circle({ x: 0, y: 0 }, r) + `M${P(p)}Q${f(p.x + 0.22)} ${f(p.y - 0.02)} ${P(tail)}`, fill: '' };
}

/* ------------------------------------------------------------------ legend */

const FULL_US: Record<string, string> = {
  sc: 'single crochet', hdc: 'half double crochet', dc: 'double crochet', tr: 'treble crochet', dtr: 'double treble crochet',
};
const FULL_UK: Record<string, string> = {
  sc: 'double crochet', hdc: 'half treble crochet', dc: 'treble crochet', tr: 'double treble crochet', dtr: 'triple treble crochet',
};

export interface LegendEntry {
  key: string;
  spec: SymbolSpec;
  /** e.g. 'dc', 'dc3tog', '3-dc cl', 'sl st' / UK 'tr', 'tr3tog', '3-tr cl', 'ss' */
  abbr: string;
  name: string;
  count: number;
}

export function legendName(spec: SymbolSpec, terms: Terms): { abbr: string; name: string } {
  const full = terms === 'UK' ? FULL_UK : FULL_US;
  const nm = (t: StitchType) => nameOf(t, terms);
  switch (spec.base) {
    case 'ch': return { abbr: 'ch', name: 'chain' };
    case 'slst': return { abbr: nm('slst'), name: 'slip stitch' };
    case 'picot': return { abbr: spec.size && spec.size !== 3 ? `ch-${spec.size} picot` : 'picot', name: `picot (${spec.size ?? 3} chains closed with a sl st)` };
    case 'puff': return { abbr: spec.size && spec.size !== 3 ? `${spec.size}-loop puff` : 'puff', name: `puff stitch (${spec.size ?? 3} loops)` };
    case 'popcorn': return { abbr: spec.legs === 5 ? 'pc' : `${spec.legs}-${nm('dc')} pc`, name: `popcorn (${spec.legs} ${nm('dc')} closed together)` };
    default: break;
  }
  const b = spec.base;
  let abbr: string, name: string;
  if (spec.cluster) { abbr = `${spec.legs}-${nm(b)} cl`; name = `${spec.legs}-${full[b] ?? b} cluster`; }
  else if (spec.legs >= 2) { abbr = `${nm(b)}${spec.legs}tog`; name = `${full[b] ?? b} ${spec.legs} together (decrease)`; }
  else { abbr = nm(b); name = full[b] ?? b; }
  if (spec.loop === 'fp' || spec.loop === 'bp') {
    abbr = `${spec.loop}${abbr}`;
    name = `${spec.loop === 'fp' ? 'front' : 'back'} post ${name}`;
  } else if (spec.loop) {
    abbr = `${abbr} ${spec.loop}`;
    name = `${name}, ${spec.loop === 'flo' ? 'front' : 'back'} loop only`;
  }
  return { abbr, name };
}

const ORDER = ['mr', 'ch', 'slst', 'sc', 'hdc', 'dc', 'tr', 'dtr', 'puff', 'popcorn', 'picot'];

/** Symbols used in a layout (rounds 0..upto), in a stable order, with US/UK names. */
export function legendEntries(layout: ChartLayout, terms: Terms = 'US', upto?: number): LegendEntry[] {
  const m = new Map<string, LegendEntry>();
  for (const n of layout.nodes) {
    if (upto !== undefined && n.round > upto) continue;
    const e = m.get(n.symbol.key);
    if (e) e.count++;
    else m.set(n.symbol.key, { key: n.symbol.key, spec: n.symbol, ...legendName(n.symbol, terms), count: 1 });
  }
  const out = [...m.values()];
  if (layout.ring?.kind === 'magic') {
    out.push({ key: 'mr', spec: { key: 'mr', base: 'ch', legs: 1, cluster: false, hatches: 0 }, abbr: 'mr', name: 'magic ring (adjustable ring)', count: 1 });
  }
  const rank = (e: LegendEntry) => {
    const i = ORDER.indexOf(e.key === 'mr' ? 'mr' : e.spec.base);
    return (i < 0 ? 99 : i) * 100 + (e.spec.legs > 1 ? 10 : 0) + (e.spec.cluster ? 5 : 0) + (e.spec.loop ? 2 : 0);
  };
  return out.sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
}

/**
 * Glyph of a symbol drawn on its own (for the legend), in a box of about 1.6 × 2.6 units centred
 * on the origin, stem pointing up.
 */
export function sampleGlyph(spec: SymbolSpec, o: SymbolOptions = {}, heightUnits = 1.9): Glyph {
  if (spec.key === 'mr') return magicRingGlyph(0.45);
  const h = spec.base === 'sc' ? 0.95 : spec.base === 'hdc' ? 1.3 : spec.base === 'tr' ? 2.2 : spec.base === 'dtr' ? 2.5 : heightUnits;
  const top = { x: 0, y: -h / 2 - 0.1 };
  const bottom = h / 2 + 0.1;
  const n: ChartNode = {
    id: 0, round: 0, kind: 'stitch', type: spec.base, symbol: spec, x: top.x, y: top.y, rot: -Math.PI / 2,
    legs: [], cx: 0, cy: 0, s: 0, course: true, r: 0,
  };
  if (spec.base === 'ch') return glyph({ ...n, kind: 'chain', x: 0, y: 0, rot: 0 }, o);
  if (spec.base === 'slst') return glyph({ ...n, kind: 'slst', x: 0, y: 0, rot: 0 }, o);
  if (spec.base === 'picot') return glyph({ ...n, kind: 'picot', x: 0, y: 0.3, rot: -Math.PI / 2 }, o);
  if (spec.legs >= 2 && !spec.cluster && spec.base !== 'popcorn') {
    const w = 0.32;
    n.legs = Array.from({ length: spec.legs }, (_, j) => ({ x: ((j - (spec.legs - 1) / 2) / ((spec.legs - 1) / 2)) * w, y: bottom }));
  } else {
    n.legs = [{ x: 0, y: bottom }];
  }
  return glyph(n, o);
}

