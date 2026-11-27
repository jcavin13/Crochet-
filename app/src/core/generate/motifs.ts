/**
 * The motif library. Each motif is a rule: given the previous round's interface (one sector's
 * ordered stitches and chain spaces) and a parameter assignment, it emits the ops of one sector.
 * `candidates()` enumerates the motif's small discrete parameter space (fixed params pin a value),
 * and the solver in generate.ts scores every candidate with the flatness predictor.
 *
 * Two engines do the work:
 *   anchors  — groups worked into chosen targets, chains between: mesh, spokes, clusters, puffs,
 *              V-stitches, shells, petals, fans, picot edge on spaces. On lace the targets are the
 *              chain spaces (one, two or zero groups per space); on solid fabric they are stitches
 *              spaced out with `sk`.
 *   bands    — one action per previous target: solid bands with spread increases, popcorn/puff
 *              accents, filler rounds that pack stitches into every space.
 */
import { stitchParam, type ParamSet } from '../params';
import type {
  Entry, Height, Iface, Item, MotifId, MotifInfo, Op, ParamDef, ParamValue, RoundParams, Stitch,
} from './types';

export interface MotifCtx {
  prev: Iface;
  repeats: number;
  /** 0-based index of the round being made. */
  index: number;
  heights: Height[];
  lacy: number;
  /** Previous round's motif and parameters (for continuity preferences). */
  prevMotif?: MotifId;
  prevParams?: RoundParams;
  /** Stitch sizes (only the centre uses them, to narrow its ring sizes). */
  params?: ParamSet;
}

export interface Candidate {
  params: RoundParams;
  ops: Op[];
  /** Centre only: chains of the starting ring (0 = magic ring). */
  ringChains?: number;
  /** Style cost ≥ 0 (preferences, not correctness). */
  cost: number;
}

export interface Motif extends MotifInfo {
  candidates(ctx: MotifCtx, fixed: RoundParams): Candidate[];
}

/* ------------------------------------------------------------------ helpers */

const st = (s: Stitch, n = 1): Item => ({ k: 'st', s, n });
const P = (t: Height | 'dtr'): Stitch => ({ t });
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

/** Split `total` into `parts` near-equal integers, the larger ones first-spread (ceil form). */
export function spread(total: number, parts: number): number[] {
  return range(0, parts - 1).map((i) => Math.ceil(((i + 1) * total) / parts) - Math.ceil((i * total) / parts));
}

/** All assignments of the param defs, with fixed keys pinned (a fixed value outside the list is kept). */
function grid(defs: ParamDef[], fixed: RoundParams, only?: string[]): RoundParams[] {
  let out: RoundParams[] = [{}];
  for (const d of defs) {
    if (only && !only.includes(d.key)) continue;
    const vals = d.key in fixed ? [fixed[d.key]] : d.values;
    const next: RoundParams[] = [];
    for (const o of out) for (const v of vals) next.push({ ...o, [d.key]: v });
    out = next;
  }
  return out;
}

const num = (v: ParamValue | undefined, dflt = 0) => (typeof v === 'number' ? v : v === undefined ? dflt : Number(v));

interface Slot { len: number; lead: number }
/** The chain spaces of a lace sector, with the number of stitches before each. */
export function spaceSlots(entries: Entry[]): { slots: Slot[]; trailing: number; leading: number } {
  const slots: Slot[] = [];
  let lead = 0;
  for (const e of entries) {
    if (e.kind === 'st') lead++;
    else { slots.push({ len: e.len, lead }); lead = 0; }
  }
  return { slots, trailing: lead, leading: slots[0]?.lead ?? lead };
}
const stitchCount = (entries: Entry[]) => entries.filter((e) => e.kind === 'st').length;

/** Chain fraction of a sector's course (for the lacy↔solid preference). */
function chainFrac(ops: Op[]): number {
  let ch = 0, sts = 0;
  const items = (its: Item[]) => { for (const i of its) if (i.k === 'ch') ch += i.n; else if (i.k === 'st') sts += i.n; };
  for (const o of ops) {
    if (o.k === 'ch') ch += o.n;
    else if (o.k === 'into') items(o.items);
    else if (o.k === 'each') sts += o.count;
  }
  return (ch * 0.7) / Math.max(1e-9, ch * 0.7 + sts);
}
/** Cost of a chain fraction against the density slider: lacy wants more chain, solid less. */
function lacyCost(ops: Op[], lacy: number, texture: 'lacy' | 'solid' | 'edge'): number {
  if (texture !== 'lacy') return 0;
  const want = 0.25 + 0.4 * lacy;
  return Math.abs(chainFrac(ops) - want);
}

/* ------------------------------------------------------------------ anchors engine */

interface AnchorOpts {
  /** The group worked at anchor j (0-based within the sector) into a slot of length `len` (0 = stitch). */
  group: (j: number, len: number) => Item[];
  /** Chains after each group. */
  chain: number | ((j: number) => number);
  /** Number of anchors per sector. */
  m: number;
  /** Allow two groups in one space. */
  double?: boolean;
  /** Max stitches skipped between anchors on solid fabric. */
  maxSkip?: number;
}

/** Ops of one sector for an anchor motif, or null if `m` does not fit the interface. */
export function anchorOps(prev: Iface, o: AnchorOpts): { ops: Op[]; cost: number } | null {
  const chainOf = (j: number) => (typeof o.chain === 'number' ? o.chain : o.chain(j));
  const ops: Op[] = [];
  let cost = 0;
  if (prev.kind === 'lace') {
    const { slots, trailing } = spaceSlots(prev.entries);
    const p = slots.length;
    if (o.m < Math.ceil(p / 2) || o.m > (o.double ? 2 * p : p)) return null;
    const mult = spread(o.m, p);
    if (mult.some((x) => x > 1) && !o.double) return null;
    let j = 0;
    slots.forEach((s, i) => {
      if (mult[i] === 0) { ops.push({ k: 'skipSp', len: s.len }); return; }
      for (let t = 0; t < mult[i]; t++) {
        ops.push({ k: 'into', place: t === 0 ? { to: 'sp', len: s.len } : { to: 'same' }, items: o.group(j, s.len) });
        const c = chainOf(j);
        if (c > 0) ops.push({ k: 'ch', n: c });
        j++;
      }
    });
    if (mult.some((x) => x !== 1)) cost += 0.15;
    const last = ops[ops.length - 1];
    if (trailing > 0 && last.k !== 'ch') ops.push({ k: 'skipSt', n: trailing });
    return { ops, cost };
  }
  if (prev.kind === 'solid') {
    const a = stitchCount(prev.entries);
    if (o.m > a || o.m < 1) return null;
    const seg = spread(a, o.m);
    const maxSkip = o.maxSkip ?? 3;
    if (seg.some((s) => s - 1 > maxSkip)) return null;
    seg.forEach((len, j) => {
      ops.push({ k: 'into', place: { to: 'st' }, items: o.group(j, 0) });
      const c = chainOf(j);
      if (c > 0) ops.push({ k: 'ch', n: c });
      if (len > 1) ops.push({ k: 'skipSt', n: len - 1 });
    });
    if (new Set(seg).size > 1) cost += 0.1;
    return { ops, cost };
  }
  return null;
}

/** Candidate anchor counts for an interface. */
function anchorCounts(prev: Iface, double: boolean, maxSkip = 3, step = 1): number[] {
  if (prev.kind === 'lace') {
    const p = spaceSlots(prev.entries).slots.length;
    return range(Math.ceil(p / 2), double ? 2 * p : p).filter((m) => m % step === 0);
  }
  const a = stitchCount(prev.entries);
  return range(Math.ceil(a / (maxSkip + 1)), a).filter((m) => m % step === 0);
}

/** Preference for one group per space / even spacing on solid fabric. */
function densityCost(prev: Iface, m: number, idealSkip = 1): number {
  if (prev.kind === 'lace') {
    const p = spaceSlots(prev.entries).slots.length;
    return m === p ? 0 : 0.1 + 0.05 * Math.abs(m - p);
  }
  const a = stitchCount(prev.entries);
  return 0.08 * Math.abs(a / m - 1 - idealSkip);
}

/* ------------------------------------------------------------------ bands engine */

type Action = Item[] | 'skip';

/** Ops from one action per previous stitch (and per space: the items worked into it). */
export function bandOps(prev: Iface, stAction: (i: number, e: Entry) => Action, spN: (len: number, i: number) => Item[]): Op[] {
  const ops: Op[] = [];
  let si = 0, pi = 0;
  for (const e of prev.entries) {
    if (e.kind === 'sp') {
      ops.push({ k: 'into', place: { to: 'sp', len: e.len }, items: spN(e.len, pi++) });
      continue;
    }
    const a = stAction(si++, e);
    const last = ops[ops.length - 1];
    if (a === 'skip') {
      if (last?.k === 'skipSt') last.n++;
      else ops.push({ k: 'skipSt', n: 1 });
      continue;
    }
    const one = a.length === 1 && a[0].k === 'st' && a[0].n === 1 ? a[0].s : undefined;
    if (one && (one.t === 'sc' || one.t === 'hdc' || one.t === 'dc' || one.t === 'tr' || one.t === 'dtr')) {
      if (last?.k === 'each' && JSON.stringify(last.s) === JSON.stringify(one)) last.count++;
      else ops.push({ k: 'each', s: one, count: 1 });
    } else {
      ops.push({ k: 'into', place: { to: 'st' }, items: a });
    }
  }
  return ops;
}

/** Which of `a` stitches get an increase: `inc` of them, spread, at the end (or middle) of each chunk. */
function incPositions(a: number, inc: number, stagger: boolean): Set<number> {
  const out = new Set<number>();
  if (inc <= 0) return out;
  let pos = 0;
  for (const len of spread(a, inc)) {
    out.add(pos + (stagger ? Math.floor((len - 1) / 2) : len - 1));
    pos += len;
  }
  return out;
}

/* ------------------------------------------------------------------ param defs */

const fmtSt = (v: ParamValue) => String(v);
const HEIGHTS: Height[] = ['sc', 'hdc', 'dc', 'tr'];
const heightDef = (values: Height[] = HEIGHTS, label = 'Stitch'): ParamDef => ({ key: 'st', label, values, format: fmtSt });
const chDef = (lo: number, hi: number, label = 'Chain length'): ParamDef => ({
  key: 'ch', label, values: range(lo, hi),
  format: label === 'Chains between' ? (v) => (v ? `ch ${v} between` : 'no chains between') : (v) => `ch ${v}`,
});
const perDef = (label = 'Groups per repeat', hi = 12): ParamDef => ({ key: 'per', label, values: range(1, hi) });

const allowedHeights = (ctx: MotifCtx, among: Height[]) => {
  const ok = among.filter((h) => ctx.heights.includes(h));
  return ok.length ? ok : [among.includes('dc') ? 'dc' : among[0]];
};

/* ------------------------------------------------------------------ motifs */

const FILLS = [0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const TEXTBOOK: Record<Height, number> = { sc: 6, hdc: 8, dc: 12, tr: 18 };

const centre: Motif = {
  id: 'centre', label: 'Centre', texture: 'solid', accepts: ['ring'],
  blurb: 'Stitches into a magic ring or chain ring — solid, or spoked with chains between.',
  params: [
    { key: 'style', label: 'Style', values: ['solid', 'spoked'] },
    heightDef(),
    { key: 'per', label: 'Stitches per repeat', values: range(1, 6) },
    { key: 'ch', label: 'Spoke chains', values: [1, 2, 3], format: (v) => `ch ${v}` },
    { key: 'ring', label: 'Ring', values: ['mr', 'chain'], format: (v) => (v === 'mr' ? 'magic ring' : 'chain ring') },
  ],
  candidates(ctx, fixed) {
    const out: Candidate[] = [];
    const n = ctx.repeats;
    for (const g of grid(this.params, fixed)) {
      const style = g.style as string, h = g.st as Height, per = num(g.per), ring = g.ring as string;
      if (!(('st' in fixed) || allowedHeights(ctx, HEIGHTS).includes(h))) continue;
      if (style === 'spoked' && (h === 'sc' || h === 'hdc') && !('st' in fixed)) continue;
      if (style === 'solid' && 'ch' in g && g.ch !== 1 && !('ch' in fixed)) continue; // ch irrelevant: one copy
      const S = n * per;
      if (S < 4 || S > 36) continue;
      const k = num(g.ch, 1);
      const ops: Op[] = style === 'spoked'
        ? [{ k: 'into', place: { to: 'ring' }, items: [st(P(h))] }, { k: 'ch', n: k }]
        : [{ k: 'into', place: { to: 'ring' }, items: [st(P(h), per)] }];
      const T = TEXTBOOK[h] * (style === 'spoked' ? 1 : 1);
      const base = 0.35 * Math.abs(Math.log(S / T)) + (style === 'spoked' ? 0.1 : 0);
      const params: RoundParams = { style, st: h, per, ring, ...(style === 'spoked' ? { ch: k } : {}) };
      if (ring === 'mr') {
        out.push({ params, ops, ringChains: 0, cost: base + (S > 1.6 * T ? 0.4 : 0) });
      } else {
        // ring sizes near the one that makes round 1 exactly flat: N·w_ch/2π + h = C/2π
        let lo = 4, hi = 30;
        if (ctx.params) {
          const w = (t: string) => stitchParam(ctx.params!, t as Height).width;
          const C = S * w(h) + (style === 'spoked' ? S * k * w('ch') * 0.85 : 0);
          const ideal = Math.round((C / (2 * Math.PI) - stitchParam(ctx.params, h).height) * 2 * Math.PI / w('ch'));
          lo = Math.max(4, ideal - 3); hi = Math.min(30, Math.max(lo, ideal + 3));
        }
        const ringFixed = 'ringCh' in fixed ? [num(fixed.ringCh)] : range(lo, hi);
        for (const c of ringFixed) out.push({ params: { ...params, ringCh: c }, ops, ringChains: c, cost: base + (S <= 1.2 * T ? 0.25 : 0) + 0.01 * c });
      }
    }
    return out;
  },
};

/** Solid band: from solid with spread increases; from lace by filling every space. */
function bandCandidates(motif: Motif, ctx: MotifCtx, fixed: RoundParams, among: Height[], accent?: Stitch): Candidate[] {
  const out: Candidate[] = [];
  const prevH = ctx.prevParams?.st as Height | undefined;
  for (const g of grid(motif.params, fixed, ['st'])) {
    const h = g.st as Height;
    if (!('st' in fixed) && !allowedHeights(ctx, among).includes(h)) continue;
    const s = P(h);
    const hCost = prevH && prevH !== h ? 0.15 : 0;
    if (ctx.prev.kind === 'solid') {
      const a = stitchCount(ctx.prev.entries);
      const incs = 'inc' in fixed ? [num(fixed.inc)] : range(0, a);
      const pers = accent ? ('per' in fixed ? [num(fixed.per)] : [1, 2]) : [0];
      for (const inc of incs) {
        if (inc < 0 || inc > a) continue;
        for (const per of pers) {
          const incAt = incPositions(a, inc, ctx.index % 2 === 1);
          // accents spread evenly; an accent on an increase stitch is worked as (dc, pc) in it
          const accAt = new Set<number>();
          if (accent) {
            if (per > a) continue;
            for (let q = 0; q < per; q++) accAt.add(Math.floor(((q + 0.5) * a) / per));
          }
          const ops = bandOps(ctx.prev, (i) => {
            const inc = incAt.has(i);
            if (accAt.has(i)) return inc ? [st(s), st(accent!)] : [st(accent!)];
            return [st(s, inc ? 2 : 1)];
          }, () => []);
          out.push({ params: { ...g, inc, ...(accent ? { per } : {}) }, ops, cost: hCost });
        }
      }
    } else if (ctx.prev.kind === 'lace') {
      const fills = 'fill' in fixed ? [num(fixed.fill)] : FILLS;
      const lens = spaceSlots(ctx.prev.entries).slots.map((x) => x.len);
      const cum = lens.reduce<number[]>((acc, l) => [...acc, acc[acc.length - 1] + l], [0]);
      for (const f of fills) {
        // stitches per space, spread so the sector total is round(f × chains) (Bresenham)
        const q = lens.map((_, i) => Math.round(f * cum[i + 1]) - Math.round(f * cum[i]));
        if (q.some((x) => x < 1)) continue;
        const ops = bandOps(ctx.prev, () => [st(s)], (_len, i) => [st(s, q[i])]);
        out.push({ params: { ...g, fill: f }, ops, cost: hCost + 0.05 * Math.abs(f - 1) });
      }
    }
  }
  return out;
}

const solid: Motif = {
  id: 'solid', label: 'Solid band', texture: 'solid', accepts: ['solid', 'lace'],
  blurb: 'A closed round of sc/hdc/dc/tr with the increases spread evenly (or packed into the spaces).',
  params: [
    heightDef(),
    { key: 'inc', label: 'Increases per repeat', values: range(0, 12), hint: 'on solid fabric' },
    { key: 'fill', label: 'Stitches per chain', values: FILLS, hint: 'over chain spaces', format: (v) => `${v}×` },
  ],
  candidates(ctx, fixed) { return bandCandidates(this, ctx, fixed, HEIGHTS); },
};

const filler: Motif = {
  id: 'filler', label: 'Straightening round', texture: 'solid', accepts: ['lace', 'solid'],
  blurb: 'sc (or hdc) in every stitch and a few in every space — evens out an edge before the next motif.',
  params: [
    heightDef(['sc', 'hdc']),
    { key: 'fill', label: 'Stitches per chain', values: FILLS, format: (v) => `${v}×` },
    { key: 'inc', label: 'Increases per repeat', values: range(0, 12), hint: 'on solid fabric' },
  ],
  candidates(ctx, fixed) { return bandCandidates(this, ctx, fixed, ['sc', 'hdc']); },
};

const ACCENTS: Record<string, Stitch> = {
  pc: { t: 'pc', legs: 5 },
  puff: { t: 'puff' },
  bobble: { t: 'cl', base: 'dc', legs: 5 },
};
const accent: Motif = {
  id: 'accent', label: 'Popcorn / puff accent', texture: 'solid', accepts: ['solid'],
  blurb: 'A solid band with popcorns, puffs or bobbles set evenly into it.',
  params: [
    { key: 'kind', label: 'Accent', values: ['pc', 'puff', 'bobble'], format: (v) => ({ pc: 'popcorn', puff: 'puff', bobble: 'bobble' }[String(v)] ?? String(v)) },
    heightDef(['hdc', 'dc']),
    { key: 'per', label: 'Accents per repeat', values: [1, 2] },
    { key: 'inc', label: 'Increases per repeat', values: range(0, 12) },
  ],
  candidates(ctx, fixed) {
    const kinds = 'kind' in fixed ? [String(fixed.kind)] : ['pc', 'puff', 'bobble'];
    return kinds.flatMap((k) => bandCandidates(this, ctx, fixed, ['hdc', 'dc'], ACCENTS[k] ?? ACCENTS.pc)
      .map((c) => ({ ...c, params: { kind: k, ...c.params }, cost: c.cost + (k === 'pc' ? 0 : 0.05) })));
  },
};

/** Generic anchor motif: group(params) at every anchor, chain between. */
function anchorMotif(def: Omit<Motif, 'candidates'> & {
  group: (g: RoundParams, j: number, len: number) => Item[];
  chain: (g: RoundParams) => number | ((j: number) => number);
  double?: (g: RoundParams) => boolean;
  /** anchors per "per" unit (alternating motifs use two anchors per group). */
  stride?: (g: RoundParams) => number;
  maxSkip?: number;
  idealSkip?: number;
  valid?: (g: RoundParams, ctx: MotifCtx) => boolean;
  extraCost?: (g: RoundParams, ctx: MotifCtx) => number;
  /** keys enumerated in the grid (default: all except per) */
}): Motif {
  return {
    ...def,
    candidates(ctx, fixed) {
      const out: Candidate[] = [];
      for (const g of grid(def.params, fixed, def.params.map((d) => d.key).filter((k) => k !== 'per'))) {
        if (def.valid && !def.valid(g, ctx)) continue;
        const dbl = def.double ? def.double(g) : false;
        const stride = def.stride ? def.stride(g) : 1;
        const ms = 'per' in fixed ? [num(fixed.per) * stride] : anchorCounts(ctx.prev, dbl, def.maxSkip ?? 3, stride);
        for (const m of ms) {
          const r = anchorOps(ctx.prev, { m, group: (j, len) => def.group(g, j, len), chain: def.chain(g), double: dbl, maxSkip: def.maxSkip });
          if (!r) continue;
          const cost = r.cost + densityCost(ctx.prev, m, def.idealSkip ?? 1) + lacyCost(r.ops, ctx.lacy, def.texture) + (def.extraCost?.(g, ctx) ?? 0);
          out.push({ params: { ...g, per: m / stride }, ops: r.ops, cost });
        }
      }
      return out;
    },
  };
}

const prevChain = (ctx: MotifCtx) => {
  const lens = spaceSlots(ctx.prev.entries).slots.map((s) => s.len);
  return lens.length ? Math.max(...lens) : 0;
};

const mesh = anchorMotif({
  id: 'mesh', label: 'Chain-loop mesh', texture: 'lacy', accepts: ['solid', 'lace'],
  blurb: '`sc in next sp, ch k` — the open net that carries most lace doilies.',
  params: [chDef(1, 8), perDef('Loops per repeat')],
  group: () => [st(P('sc'))],
  chain: (g) => num(g.ch),
  double: () => true,
  idealSkip: 2,
  extraCost: (g) => 0.03 * Math.abs(num(g.ch) - 5) + (num(g.ch) < 3 ? 0.1 : 0),
});

const arches = anchorMotif({
  id: 'arches', label: 'Growing arches', texture: 'lacy', accepts: ['lace'],
  blurb: 'Loops on loops: one sc in each loop, each new loop a chain or two longer.',
  params: [chDef(3, 10)],
  group: () => [st(P('sc'))],
  chain: (g) => num(g.ch),
  valid: (g, ctx) => ctx.prev.kind === 'lace' && num(g.ch) >= Math.max(3, Math.min(prevChain(ctx), 8)),
  extraCost: (g, ctx) => 0.04 * Math.abs(num(g.ch) - prevChain(ctx) - 1),
});
arches.candidates = ((orig) => (ctx: MotifCtx, fixed: RoundParams) => orig(ctx, { ...fixed, per: spaceSlots(ctx.prev.entries).slots.length || 1 })
  .map((c) => { const { per: _p, ...rest } = c.params; return { ...c, params: rest }; }))(arches.candidates.bind(arches));

const spokes = anchorMotif({
  id: 'spokes', label: 'Spokes', texture: 'lacy', accepts: ['solid', 'lace'],
  blurb: '`dc, ch k` all round — the wheel round that opens a solid centre.',
  params: [heightDef(['dc', 'tr']), chDef(1, 5), perDef('Spokes per repeat')],
  group: (g) => [st(P(g.st as Height))],
  chain: (g) => num(g.ch),
  double: () => true,
  idealSkip: 0,
  valid: (g, ctx) => allowedHeights(ctx, ['dc', 'tr']).includes(g.st as Height),
});

const clusters = anchorMotif({
  id: 'clusters', label: 'Clusters', texture: 'lacy', accepts: ['solid', 'lace'],
  blurb: '`3-dc cl, ch k` — a ring of gathered clusters (bobbles with 5 legs).',
  params: [
    { key: 'base', label: 'Cluster of', values: ['dc', 'tr'], format: (v) => `${v} clusters` },
    { key: 'legs', label: 'Legs', values: [3, 4, 5], format: (v) => `${v} legs` },
    chDef(1, 5), perDef('Clusters per repeat'),
  ],
  group: (g) => [st({ t: 'cl', base: g.base as 'dc' | 'tr', legs: num(g.legs) })],
  chain: (g) => num(g.ch),
  double: () => true,
  valid: (g, ctx) => allowedHeights(ctx, ['dc', 'tr']).includes(g.base as Height),
  extraCost: (g) => (num(g.legs) === 3 ? 0 : 0.05),
});

const puffs = anchorMotif({
  id: 'puffs', label: 'Puffs', texture: 'lacy', accepts: ['solid', 'lace'],
  blurb: '`puff, ch k` — soft puffs, singly or in pairs `(puff, ch 1, puff)`.',
  params: [
    { key: 'pair', label: 'Puffs per group', values: [1, 2], format: (v) => (v === 2 ? 'puff pairs' : 'single puffs') },
    chDef(1, 4), perDef('Groups per repeat'),
  ],
  group: (g) => (num(g.pair) === 2 ? [st({ t: 'puff' }), { k: 'ch', n: 1 }, st({ t: 'puff' })] : [st({ t: 'puff' })]),
  chain: (g) => num(g.ch),
  double: (g) => num(g.pair) === 1,
});

const vstitch = anchorMotif({
  id: 'vstitch', label: 'V-stitches', texture: 'lacy', accepts: ['solid', 'lace'],
  blurb: '`(dc, ch v, dc)` in each space with chains between — light and even.',
  params: [
    { key: 'gap', label: 'Chains inside the V', values: [1, 2, 3], format: (v) => `ch ${v} inside` },
    chDef(0, 4, 'Chains between'), perDef('V-sts per repeat'),
  ],
  group: (g) => [st(P('dc')), { k: 'ch', n: num(g.gap) }, st(P('dc'))],
  chain: (g) => num(g.ch),
  double: (g) => num(g.ch) > 0,
  idealSkip: 1,
});

/** Shell items: `size` dc, opened by `gap` chains in the middle when gap > 0. */
function shellItems(size: number, gap: number, h: Height = 'dc'): Item[] {
  if (gap <= 0) return [st(P(h), size)];
  const a = Math.floor(size / 2);
  return [st(P(h), a), { k: 'ch', n: gap }, st(P(h), size - a)];
}

const shells = anchorMotif({
  id: 'shells', label: 'Shells', texture: 'lacy', accepts: ['solid', 'lace'],
  blurb: '`(a dc, ch b, a dc)` or `5 dc` in a space, optionally with `sc` between shells.',
  params: [
    { key: 'size', label: 'dc per shell', values: [2, 3, 4, 5, 6, 7], format: (v) => `${v} dc` },
    { key: 'gap', label: 'Chains in the shell', values: [0, 1, 2, 3], format: (v) => (v ? `ch ${v} inside` : 'closed') },
    chDef(0, 3, 'Chains between'),
    { key: 'alt', label: 'sc between shells', values: [0, 1], format: (v) => (v ? 'yes' : 'no') },
    perDef('Shells per repeat'),
  ],
  group: (g, j) => (num(g.alt) && j % 2 === 1 ? [st(P('sc'))] : shellItems(num(g.size), num(g.gap))),
  chain: (g) => num(g.ch),
  stride: (g) => (num(g.alt) ? 2 : 1),
  maxSkip: 2,
  valid: (g) => !(num(g.gap) > 0 && num(g.size) % 2 === 1) && !(num(g.gap) === 0 && num(g.size) < 3),
  extraCost: (g) => 0.03 * Math.abs(num(g.size) - 5) + (num(g.gap) > 2 ? 0.05 : 0),
});

const petals = anchorMotif({
  id: 'petals', label: 'Cluster petals', texture: 'lacy', accepts: ['lace'],
  blurb: '`(3-tr cl, ch b, 3-tr cl)` in a space — pairs of clusters that read as petals.',
  params: [
    { key: 'base', label: 'Cluster of', values: ['dc', 'tr'], format: fmtSt },
    { key: 'gap', label: 'Chains in the petal', values: [2, 3, 4, 5], format: (v) => `ch ${v} inside` },
    chDef(1, 5, 'Chains between'), perDef('Petals per repeat'),
  ],
  group: (g) => { const c = st({ t: 'cl', base: g.base as 'dc' | 'tr', legs: 3 }); return [c, { k: 'ch', n: num(g.gap) }, c]; },
  chain: (g) => num(g.ch),
  valid: (g, ctx) => allowedHeights(ctx, ['dc', 'tr']).includes(g.base as Height),
});

/** Scallop items: graduated (sc, hdc, k dc, hdc, sc), or a plain dc shell. */
function scallop(form: string, size: number): Item[] {
  if (form === 'shell') return [st(P('dc'), size)];
  const mid = size - 4;
  if (mid <= 0) return [st(P('sc')), st(P('hdc'), 1), st(P('sc'))];
  return [st(P('sc')), st(P('hdc')), st(P('dc'), mid), st(P('hdc')), st(P('sc'))];
}
const fans = anchorMotif({
  id: 'fans', label: 'Fans & scallops', texture: 'edge', accepts: ['solid', 'lace'],
  blurb: '`(sc, hdc, 3 dc, hdc, sc)` in each space, or `sc, 5 dc` shells — a scalloped edge.',
  params: [
    { key: 'form', label: 'Form', values: ['scallop', 'shell'], format: (v) => (v === 'shell' ? 'sc + dc shell' : 'graduated scallop') },
    { key: 'size', label: 'Stitches per fan', values: [3, 4, 5, 6, 7, 8, 9, 10, 11], format: (v) => `${v} sts` },
    chDef(0, 2, 'Chains between'),
    perDef('Fans per repeat'),
  ],
  group: (g, j) => (g.form === 'shell' ? (j % 2 === 1 ? [st(P('sc'))] : scallop('shell', num(g.size))) : scallop('scallop', num(g.size))),
  chain: (g) => num(g.ch),
  stride: (g) => (g.form === 'shell' ? 2 : 1),
  maxSkip: 3,
  valid: (g, ctx) => (g.form === 'shell' ? num(g.size) >= 3 : ctx.prev.kind === 'lace' && num(g.size) >= 5),
  extraCost: (g) => 0.03 * Math.abs(num(g.size) - 7) + 0.15 * num(g.ch),
});

const picot = anchorMotif({
  id: 'picot', label: 'Picot edging', texture: 'edge', accepts: ['solid', 'lace'],
  blurb: '`(sc, picot, sc)` in each space with chains between — the classic finishing round.',
  params: [
    { key: 'picot', label: 'Picot', values: [3, 4, 5], format: (v) => `ch-${v}` },
    { key: 'fill', label: 'sc each side', values: [1, 2, 3], format: (v) => `${v} sc each side` },
    chDef(0, 5, 'Chains between'),
    perDef('Picots per repeat'),
  ],
  group: (g, _j, len) => {
    const x = num(g.fill);
    if (len === 0) return [st(P('sc'), x), { k: 'picot', n: num(g.picot) }];
    return [st(P('sc'), x), { k: 'picot', n: num(g.picot) }, st(P('sc'), x)];
  },
  chain: (g) => num(g.ch),
  maxSkip: 3,
  idealSkip: 1,
  extraCost: (g) => (num(g.picot) === 3 ? 0 : 0.04) + 0.05 * (num(g.fill) - 1),
});

/** Picot edge on solid fabric: sc in every stitch, a picot (and chains) every few stitches. */
const picotOnSolid = (ctx: MotifCtx, fixed: RoundParams): Candidate[] => {
  const a = stitchCount(ctx.prev.entries);
  const out: Candidate[] = [];
  for (const g of grid(picot.params, fixed, ['picot', 'ch'])) {
    const pers = 'per' in fixed ? [num(fixed.per)] : range(1, a);
    for (const per of pers) {
      if (per < 1 || per > a) continue;
      const seg = spread(a, per);
      const ops: Op[] = [];
      for (const len of seg) {
        ops.push({ k: 'each', s: P('sc'), count: len });
        ops.push({ k: 'picot', n: num(g.picot) });
        if (num(g.ch) > 0) ops.push({ k: 'ch', n: num(g.ch) });
      }
      const avg = a / per;
      out.push({ params: { ...g, fill: 1, per }, ops, cost: 0.05 * Math.abs(avg - 3) + (new Set(seg).size > 1 ? 0.1 : 0) + 0.03 * num(g.ch) });
    }
    // (sc, picot, sc) in one stitch, then skip a stitch or two (fewer stitches than the round below)
    for (const per of range(Math.ceil(a / 4), a)) {
      if ('per' in fixed && num(fixed.per) !== per) continue;
      const r = anchorOps(ctx.prev, { m: per, group: () => [st(P('sc')), { k: 'picot', n: num(g.picot) }, st(P('sc'))], chain: num(g.ch), maxSkip: 3 });
      if (r) out.push({ params: { ...g, fill: 1, per, form: 'group' }, ops: r.ops, cost: 0.15 + r.cost + 0.05 * Math.abs(a / per - 2) });
    }
  }
  return out;
};
picot.candidates = ((orig) => (ctx: MotifCtx, fixed: RoundParams) => (ctx.prev.kind === 'solid' ? picotOnSolid(ctx, fixed) : orig(ctx, fixed)))(picot.candidates.bind(picot));

export const MOTIFS: Record<MotifId, Motif> = {
  centre, solid, accent, filler, spokes, mesh, arches, clusters, puffs, vstitch, shells, petals, fans, picot,
};
export const MOTIF_ORDER: MotifId[] = [
  'centre', 'solid', 'accent', 'spokes', 'mesh', 'arches', 'clusters', 'puffs', 'vstitch', 'shells', 'petals', 'fans', 'filler', 'picot',
];

/** Plain info (no functions besides formatters) for the UI. */
export function motifInfo(id: MotifId): MotifInfo {
  const { candidates: _c, ...info } = MOTIFS[id];
  return info;
}
