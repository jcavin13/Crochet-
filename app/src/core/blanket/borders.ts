/**
 * Borders and cornered rounds.
 *
 * A border is worked in rounds around the body (notation.md 3.9). Round 1, the edge round, goes
 * across the top, down a side into the row ends, along the foundation chain and up the other
 * side; the number of sc per row end is fitted to the side's length (edge fit, checks.ts).
 * Every later round is one layer of the border stack, worked on the round before with its
 * corners. The same machinery works the rounds of squares, hexagons and octagons from the centre
 * (in-the-round blankets), with explicit corner targets instead of "in corner".
 *
 * Corner rules are not hard-coded: each round picks the corner group whose growth keeps the
 * piece closest to the flat polygon (each round must add 2·n·h·tan(π/n) of perimeter, checks.ts).
 */
import { stitchParam, type ParamSet } from '../params';
import { RoundSim, type Make, type RoundResult, type StType, type Tok, type Unit } from './engine';
import type { PolygonInput } from './checks';
import { polygonCornerGrowth } from '../flatness/polygon';

export type BorderKind = 'sc' | 'hdc' | 'dc' | 'sc-blo' | 'shell' | 'picot' | 'mesh' | 'ruffle' | 'granny';
export type CornerStyle = 'auto' | 'solid' | 'chain';

export interface BorderLayer {
  kind: BorderKind;
  /** colour key */
  color?: string;
  corner?: CornerStyle;
}

export interface BorderDef {
  kind: BorderKind;
  name: string;
  blurb: string;
  /** main stitch (height of the round) */
  st: StType;
  /** an edging round: nothing is meant to be worked after it */
  final?: boolean;
  /** what each side's stitch count must be (a set-up round is added when it is not) */
  sideRule?: { mod: number; rem: number; why: string };
  /** deliberately not flat */
  ruffle?: boolean;
}

export const BORDERS: BorderDef[] = [
  { kind: 'sc', name: 'Single crochet round', blurb: 'A plain, firm round; 3 sc (or the computed group) at each corner.', st: 'sc' },
  { kind: 'hdc', name: 'Half double round', blurb: 'A slightly taller plain round; the corners alternate as the polygon rule needs.', st: 'hdc' },
  { kind: 'dc', name: 'Double crochet round', blurb: 'A quick tall round with chain-space corners.', st: 'dc' },
  { kind: 'sc-blo', name: 'Ridge round (sc in back loops)', blurb: 'Sc through the back loops: a raised line framing the blanket.', st: 'sc' },
  { kind: 'granny', name: 'Granny round', blurb: '3-dc groups with ch 1 between, granny-square corners.', st: 'dc', sideRule: { mod: 4, rem: 0, why: 'the groups need a multiple of 4 stitches along each side' } },
  { kind: 'mesh', name: 'Mesh round', blurb: '(ch 1, sk 1, dc) lace mesh — the first round of a wide lace border.', st: 'dc', sideRule: { mod: 2, rem: 1, why: 'the mesh needs an odd number of stitches along each side' } },
  { kind: 'shell', name: 'Shell edging', blurb: '5-dc shells with sc between, a fan at each corner. Fitted exactly to every side.', st: 'dc', final: true, sideRule: { mod: 6, rem: 1, why: 'each side needs 6 × shells + 1 stitches so the shells meet the corners' } },
  { kind: 'picot', name: 'Picot edging', blurb: 'Sc with a ch-3 picot every third stitch.', st: 'sc', final: true },
  { kind: 'ruffle', name: 'Ruffle edging (over-increased)', blurb: '2 dc in every stitch: deliberately far over flat, so it ruffles. Not a flat border.', st: 'dc', final: true, ruffle: true },
];
export const BORDER_BY_KIND: Record<BorderKind, BorderDef> = Object.fromEntries(BORDERS.map((b) => [b.kind, b])) as Record<BorderKind, BorderDef>;

/** Ready-made stacks (layers after the edge round). */
export const BORDER_PRESETS: { id: string; name: string; layers: BorderKind[] }[] = [
  { id: 'none', name: 'Edge round only', layers: [] },
  { id: 'simple', name: 'Simple sc', layers: ['sc', 'sc'] },
  { id: 'classic', name: 'Classic hdc frame', layers: ['sc', 'hdc', 'sc'] },
  { id: 'shell', name: 'Shell edge', layers: ['sc', 'shell'] },
  { id: 'picot', name: 'Picot edge', layers: ['sc', 'picot'] },
  { id: 'ridge', name: 'Ridged frame', layers: ['sc-blo', 'sc-blo', 'sc'] },
  { id: 'granny', name: 'Granny frame', layers: ['granny', 'granny', 'sc'] },
  { id: 'lace', name: 'Wide lace', layers: ['mesh', 'sc', 'shell'] },
  { id: 'ruffle', name: 'Ruffle', layers: ['dc', 'ruffle'] },
];

/* ------------------------------------------------------------------ list helpers */

/** Indices of the corners of a list. */
export const cornersOf = (list: Tok[]) => list.map((t, i) => (t.corner ? i : -1)).filter((i) => i >= 0);

/**
 * Lengths (entries, corners excluded) of the physical sides of a list: side i runs from corner
 * i to corner i+1; the last side wraps round to the entries before the first corner.
 */
export function sideLengths(list: Tok[]): number[] {
  const c = cornersOf(list);
  if (!c.length) return [list.length];
  const out: number[] = [];
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = i + 1 < c.length ? c[i + 1] : list.length + c[0];
    out.push(b - a - 1);
  }
  return out;
}

/* ------------------------------------------------------------------ corner groups */

/** Corner-group candidates for a round of stitch `st`. */
export function cornerCandidates(st: StType, style: CornerStyle): Make[][] {
  const out: Make[][] = [];
  if (style !== 'chain') for (let k = 2; k <= 7; k++) out.push([{ st, n: k }]);
  if (style !== 'solid') {
    for (let a = 1; a <= 3; a++) for (let c = 1; c <= 3; c++) out.push([{ st, n: a }, { ch: c }, { st, n: a }]);
  }
  return out;
}

/** Course width a corner group adds over the corner entry it is worked into (mm). */
export function cornerGrowth(ms: Make[], corner: Tok, P: ParamSet): number {
  let w = 0;
  const wch = stitchParam(P, 'ch').width;
  for (const m of ms) {
    if ('st' in m) w += (m.n ?? 1) * stitchParam(P, m.st).width;
    else if ('ch' in m) w += m.ch * wch;
    else if ('cl' in m) w += stitchParam(P, 'dc').width;
    else if ('fp' in m) w += stitchParam(P, m.fp).width;
  }
  return w - corner.w;
}

/* ------------------------------------------------------------------ one round */

interface SideOp {
  /** entries consumed (0 or 1; 2 for a decrease; more when stitches are passed over) */
  eats: number;
  run: (s: RoundSim) => void;
  /** a skip ("sk next st") of this unit — can become a slip-stitch travel at the start */
  skip?: Unit;
}

const op = (eats: number, run: (s: RoundSim) => void): SideOp => ({ eats, run });
const skipOp = (u: Unit): SideOp => ({ eats: 1, run: (r) => r.skip(u), skip: u });
const chainOp = (n: number): SideOp => ({ eats: 0, run: (r) => r.chain(n) });

/** The unit that addresses entry t ("st", or "ch-n sp"). */
const unitOf = (t: Tok) => (t.k === 'sp' ? { sp: t.n! } : 'st' as const);

/** Plain stitches into every entry of a side: 1 per stitch, n per ch-n space. */
function plainSide(entries: Tok[], st: StType, loop?: 'blo'): SideOp[] {
  return entries.map((t) => (t.k === 'sp'
    ? op(1, (s) => s.into({ sp: t.n! }, [{ st, n: t.n }]))
    : op(1, (s) => s.into('st', [{ st, loop }]))));
}

/** The ops of one physical side for a layer (entries between two corners, in order). */
function sideOps(kind: BorderKind, entries: Tok[]): SideOp[] {
  const s = entries.length;
  switch (kind) {
    case 'sc': return plainSide(entries, 'sc');
    case 'hdc': return plainSide(entries, 'hdc');
    case 'dc': return plainSide(entries, 'dc');
    case 'sc-blo': return plainSide(entries, 'sc', 'blo');
    case 'ruffle': return entries.map((t) => op(1, (r) => r.into(unitOf(t), [{ st: 'dc', n: 2 * (t.k === 'sp' ? t.n! : 1) }])));
    case 'picot': {
      const out = plainSide(entries, 'sc');
      // a picot after every third sc, kept away from the corners
      const res: SideOp[] = [];
      out.forEach((o, i) => {
        res.push(o);
        if ((i + 1) % 3 === 0 && i + 2 < s) res.push(op(0, (r) => r.picot()));
      });
      return res;
    }
    case 'mesh': {
      // after the corner: [ch 1, sk 1, dc in next] × m, ch 1, sk 1   (s = 2m + 1)
      const res: SideOp[] = [];
      entries.forEach((t, i) => {
        if (i % 2 === 0) { res.push(chainOp(1)); res.push(skipOp(unitOf(t))); }
        else res.push(op(1, (r) => r.into(unitOf(t), [{ st: 'dc' }])));
      });
      return res;
    }
    case 'shell': {
      // after the corner: sc, [sk 2, 5 dc, sk 2, sc] × m   (s = 6m + 1)
      const res: SideOp[] = [];
      entries.forEach((t, i) => {
        const p = i % 6;
        if (p === 0) res.push(op(1, (r) => r.into(unitOf(t), [{ st: 'sc', n: t.k === 'sp' ? t.n : 1 }])));
        else if (p === 3) res.push(op(1, (r) => r.into(unitOf(t), [{ st: 'dc', n: 5 }])));
        else res.push(skipOp(unitOf(t)));
      });
      return res;
    }
    case 'granny': {
      const res: SideOp[] = [chainOp(1)];
      if (entries.some((t) => t.k === 'sp')) {
        // on a granny round: 3 dc in each ch-1 sp, ch 1 (the groups between are passed over)
        let passed = 0;
        for (const t of entries) {
          if (t.k !== 'sp') { passed++; continue; }
          const eats = passed + 1;
          passed = 0;
          res.push(op(eats, (r) => r.into({ sp: t.n! }, [{ st: 'dc', n: 3 }])));
          res.push(chainOp(1));
        }
        return res;
      }
      // on plain stitches: [sk 1, 3 dc in next, sk 2, ch 1] × m   (s = 4m): a group fans over 3, the ch over 1
      entries.forEach((t, i) => {
        if (i % 4 === 1) res.push(op(1, (r) => r.into(unitOf(t), [{ st: 'dc', n: 3 }])));
        else res.push(skipOp(unitOf(t)));
        if (i % 4 === 3) res.push(chainOp(1));
      });
      return res;
    }
  }
}

/** Default corner group of a layer (before the polygon rule refines plain rounds). */
function fixedCorner(kind: BorderKind): Make[] | undefined {
  switch (kind) {
    case 'shell': return [{ st: 'dc', n: 5 }];
    case 'picot': return [{ st: 'sc', n: 2 }, { picot: true }, { st: 'sc' }];
    case 'ruffle': return [{ st: 'dc', n: 7 }];
    default: return undefined;
  }
}

export interface LayerRound {
  kind: BorderKind | 'setup';
  /** the instruction (no label), with count annotation */
  text: string;
  result: RoundResult;
  corner: Make[];
  /** a set-up round added so the next layer fits its sides */
  setup?: string;
  color?: string;
}

/**
 * Work one cornered round of `kind` on `list`.
 * `cornerSyntax`: "in corner" (border after rows) or explicit targets (centre-out polygons).
 */
export function workRound(list: Tok[], kind: BorderKind, corner: Make[], P: ParamSet, cornerSyntax: boolean): RoundResult {
  const st = kind === 'sc-blo' || kind === 'picot' ? 'sc' : kind === 'hdc' ? 'hdc' : kind === 'sc' ? 'sc' : 'dc';
  const c = cornersOf(list);
  const sim = new RoundSim(list, P, cornerSyntax);
  const lead = c[0];
  // physical sides: 0..n-2 between corners; the last wraps to the lead entries
  const sides: Tok[][] = c.map((ci, i) => (i + 1 < c.length ? list.slice(ci + 1, c[i + 1]) : [...list.slice(ci + 1), ...list.slice(0, lead)]));
  const ops = sides.map((e) => sideOps(kind, e));
  // the lead entries belong to the end of the last side: split its ops
  const last = ops[ops.length - 1];
  let eaten = 0, cut = last.length;
  const tailNeed = sides[sides.length - 1].length - lead;
  for (let i = 0; i < last.length; i++) {
    if (eaten === tailNeed && last[i].eats > 0) { cut = i; break; }
    eaten += last[i].eats;
  }
  if (lead === 0) cut = last.length;
  const tail = last.slice(0, cut);
  let leadOps = last.slice(cut);
  // A chain before the round's first stitch would join the turning chain: when the lead has
  // chains before its first stitch, travel over its skipped entries with slip stitches instead
  // and work those chains at the end of the round (they bridge the same gap).
  const firstMake = leadOps.findIndex((o) => o.eats > 0 && !o.skip);
  const pre = firstMake < 0 ? leadOps : leadOps.slice(0, firstMake);
  const travel: Unit[] = [];
  const endChains: SideOp[] = [];
  if (pre.some((o) => o.eats === 0)) {
    for (const o of pre) {
      if (o.skip) travel.push(o.skip);
      else endChains.push(o);
    }
    leadOps = firstMake < 0 ? [] : leadOps.slice(firstMake);
  }
  const uniform = kind === 'sc' || kind === 'hdc' || kind === 'dc' || kind === 'sc-blo';
  const loop = kind === 'sc-blo' ? 'blo' as const : undefined;
  const allSt = list.every((t) => t.corner || t.k === 'st');
  for (const u of travel) sim.slst(u);
  if (!(cornerSyntax && uniform && allSt)) sim.turning(st);
  if (cornerSyntax && uniform && allSt) {
    sim.turning(st);
    // "*sc in each st across to corner, 3 sc in corner* x4, sc in each st across"
    const parts: string[] = [];
    const n = c.length;
    const cornerText = `${headOf(corner)} in corner`;
    const each = `${st}${loop ? ' blo' : ''} in each st across`;
    if (lead > 0) sim.across('st', [{ st, loop }]);
    for (let i = 0; i < n; i++) {
      sim.corner(corner);
      sim.across('st', [{ st, loop }]);
    }
    sim.join();
    parts.push(st === 'sc' ? 'ch 1' : `ch ${{ hdc: 2, dc: 3 }[st as 'hdc' | 'dc']} (does not count as st)`);
    if (lead > 0) parts.push(`*${each} to corner, ${cornerText}* x${n}`);
    else parts.push(`${cornerText}, *${each} to corner, ${cornerText}* x${n - 1}`);
    parts.push(each, 'join');
    sim.setText(parts.join(', '));
    return sim.finish();
  }
  for (const o of leadOps) o.run(sim);
  for (let i = 0; i < c.length; i++) {
    sim.corner(corner);
    const side = i + 1 < c.length ? ops[i] : tail;
    for (const o of side) o.run(sim);
  }
  for (const o of endChains) o.run(sim);
  sim.join();
  return sim.finish();
}

function headOf(ms: Make[]): string {
  if (ms.length === 1 && 'st' in ms[0]) return `${ms[0].n && ms[0].n > 1 ? `${ms[0].n} ` : ''}${ms[0].st}${ms[0].loop ? ` ${ms[0].loop}` : ''}`;
  return `(${ms.map((m) => ('st' in m ? `${m.n && m.n > 1 ? `${m.n} ` : ''}${m.st}${m.loop ? ` ${m.loop}` : ''}` : 'ch' in m ? `ch ${m.ch}` : 'picot')).join(', ')})`;
}

/**
 * A set-up sc round: like a plain sc round, but each side's count is moved to the next value the
 * following layer needs, with increases ("2 sc in next st") or decreases ("sc2tog") spread evenly.
 */
export function setupRound(list: Tok[], rule: { mod: number; rem: number }, corner: Make[], P: ParamSet, cornerSyntax: boolean): RoundResult {
  const c = cornersOf(list);
  const lead = c[0];
  const sides = c.map((ci, i) => (i + 1 < c.length ? list.slice(ci + 1, c[i + 1]) : [...list.slice(ci + 1), ...list.slice(0, lead)]));
  const cornerSides = corner.filter((m) => 'st' in m).reduce((a, m) => a + (('st' in m && m.n) || 1), 0);
  // each corner group puts (stitches-1)/2 stitches on each side of the corner middle
  const fromCorners = cornerSides - 1;
  let adjust = 0;
  const ops: SideOp[][] = sides.map((e) => {
    const plain = e.length + fromCorners;
    let adj = ((rule.rem - plain) % rule.mod + rule.mod) % rule.mod;
    if (adj > rule.mod / 2) adj -= rule.mod;
    adjust += adj * stitchParam(P, 'sc').width;
    // keep at least a few plain stitches between adjustments
    const res: SideOp[] = [];
    const n = e.length;
    const k = Math.abs(adj);
    const at = new Set<number>();
    for (let j = 0; j < k; j++) at.add(Math.min(n - 2, Math.max(1, Math.round(((j + 0.5) * n) / k))));
    for (let i = 0; i < n; i++) {
      const t = e[i];
      if (at.has(i) && adj > 0) { res.push(op(1, (r) => r.into(t.k === 'sp' ? { sp: t.n! } : 'st', [{ st: 'sc', n: (t.k === 'sp' ? t.n! : 1) + 1 }]))); continue; }
      if (at.has(i) && adj < 0 && t.k === 'st' && i + 1 < n && e[i + 1].k === 'st') { res.push(op(2, (r) => r.tog('sc', 2))); i++; continue; }
      res.push(t.k === 'sp' ? op(1, (r) => r.into({ sp: t.n! }, [{ st: 'sc', n: t.n }])) : op(1, (r) => r.into('st', [{ st: 'sc' }])));
    }
    return res;
  });
  const sim = new RoundSim(list, P, cornerSyntax);
  sim.turning('sc');
  const last = ops[ops.length - 1];
  const tailNeed = sides[sides.length - 1].length - lead;
  let eaten = 0, cut = last.length;
  for (let i = 0; i < last.length && lead > 0; i++) {
    if (eaten >= tailNeed && last[i].eats > 0) { cut = i; break; }
    eaten += last[i].eats;
  }
  if (lead > 0 && eaten !== tailNeed) {
    // a decrease straddles the boundary: fall back to plain stitches on the last side
    ops[ops.length - 1] = plainSide(sides[sides.length - 1], 'sc');
    return { ...setupFallback(sim, ops, c.length, corner, tailNeed), adjust };
  }
  for (const o of last.slice(cut)) o.run(sim);
  for (let i = 0; i < c.length; i++) {
    sim.corner(corner);
    for (const o of i + 1 < c.length ? ops[i] : last.slice(0, cut)) o.run(sim);
  }
  sim.join();
  return { ...sim.finish(), adjust };
}

function setupFallback(sim: RoundSim, ops: SideOp[][], n: number, corner: Make[], tailNeed: number): RoundResult {
  const last = ops[ops.length - 1];
  for (const o of last.slice(tailNeed)) o.run(sim);
  for (let i = 0; i < n; i++) {
    sim.corner(corner);
    for (const o of i + 1 < n ? ops[i] : last.slice(0, tailNeed)) o.run(sim);
  }
  sim.join();
  return sim.finish();
}

/**
 * The corner group for a round of `kind`: the candidate whose growth is closest to the flat
 * polygon's per-corner growth ("natural"), unless the corners have drifted from flat by more
 * than half a stitch each (`drift`, mm summed over the corners, before this round) — then the
 * candidate that brings them back. So an sc border gets "3 sc in corner" round after round, with
 * an occasional "2 sc" when the small excess has added up.
 */
export function chooseCorner(list: Tok[], kind: BorderKind, style: CornerStyle, P: ParamSet, drift: number, n = 4, prefer?: Make[]): Make[] {
  const fixed = fixedCorner(kind);
  if (kind === 'ruffle') return fixed!;
  const st: StType = kind === 'shell' || kind === 'picot' ? 'sc' : BORDER_BY_KIND[kind].st;
  const loop = kind === 'sc-blo' ? 'blo' as const : undefined;
  const w = stitchParam(P, st).width;
  let cands: Make[][];
  if (kind === 'mesh') cands = [1, 2, 3, 4, 5].map((c) => [{ st, n: 1 }, { ch: c }, { st, n: 1 }] as Make[]);
  else if (kind === 'shell') cands = [3, 5, 7].map((k) => [{ st: 'dc', n: k }] as Make[]);
  else if (kind === 'picot') cands = [[1, 1], [2, 1], [2, 2]].map(([a, b]) => [{ st: 'sc', n: a }, { picot: true }, { st: 'sc', n: b }] as Make[]);
  else if (kind === 'granny') cands = [2, 3].flatMap((a) => [1, 2, 3].map((c) => [{ st, n: a }, { ch: c }, { st, n: a }] as Make[]));
  else cands = cornerCandidates(st, style);
  if (loop) cands = cands.map((ms) => ms.map((m) => ('st' in m ? { ...m, loop } : m)));
  const corners = cornersOf(list);
  const k = Math.max(1, corners.length);
  const need = polygonCornerGrowth(n, roundHeight(kind, P));
  const grow = (ms: Make[]) => corners.reduce((a, ci) => a + cornerGrowth(ms, list[ci], P), 0) / k;
  const score = (ms: Make[]) => Math.abs(grow(ms) - need) / w + complexity(ms) + (prefer && sameMakes(prefer, ms) ? -0.2 : 0) + (fixed && sameMakes(fixed, ms) ? -0.3 : 0);
  const natural = cands.reduce((b, ms) => (score(ms) < score(b) - 1e-9 ? ms : b));
  const after = (ms: Make[]) => (drift + k * (grow(ms) - need)) / k / w;
  if (Math.abs(after(natural)) <= 0.5) return natural;
  return cands.reduce((b, ms) => (Math.abs(after(ms)) + complexity(ms) < Math.abs(after(b)) + complexity(b) - 1e-9 ? ms : b));
}

/** Expected mean stitch height of a round of `kind` (shells: 5 dc and an sc per repeat), mm. */
export function roundHeight(kind: BorderKind, P: ParamSet): number {
  const h = (t: StType) => stitchParam(P, t).height;
  if (kind === 'shell') return (5 * h('dc') + h('sc')) / 6;
  return h(BORDER_BY_KIND[kind].st);
}

const sameMakes = (a: Make[], b: Make[]) => JSON.stringify(a) === JSON.stringify(b);
const complexity = (ms: Make[]) => (ms.some((m) => 'ch' in m) ? 0.35 : 0);

/** Change of course length along the sides (corners excluded) for a plain layer, mm. */
function sideDelta(list: Tok[], kind: BorderKind, P: ParamSet): number {
  if (kind === 'mesh' || kind === 'granny' || kind === 'shell') return 0;
  const st: StType = kind === 'hdc' ? 'hdc' : kind === 'dc' || kind === 'ruffle' ? 'dc' : 'sc';
  const w = stitchParam(P, st).width;
  let d = 0;
  for (const t of list) {
    if (t.corner) continue;
    if (t.k === 'sp') d += t.n! * w - t.w;
    else if (t.k === 'st') d += w - t.w;
  }
  return kind === 'ruffle' ? 2 * d : d;
}

/* ------------------------------------------------------------------ a stack of layers */

export interface LayerOut {
  kind: BorderKind | 'setup';
  result: RoundResult;
  corner: Make[];
  /** what the round is ("Shell edging", "set-up round: …") */
  note: string;
  /** index of the layer this round belongs to (a set-up round belongs to the layer after it) */
  layer: number;
  intended?: boolean;
}

/** Perimeter (course length) of a list, mm. */
export const listPerimeter = (list: Tok[]) => list.reduce((a, t) => a + (t.k === 're' ? 0 : t.w), 0);

/** Does every side of `list` satisfy the layer's side rule? (A granny round on a granny round needs none.) */
function sidesFit(list: Tok[], def: BorderDef): boolean {
  if (!def.sideRule) return true;
  if (def.kind === 'granny' && list.some((t) => !t.corner && t.k === 'sp')) return true;
  const { mod, rem } = def.sideRule;
  return sideLengths(list).every((x) => ((x - rem) % mod + mod) % mod === 0);
}

/**
 * Work the layers on a cornered list, adding set-up rounds where a layer needs particular side
 * counts. Corner groups follow the polygon rule for an n-gon; `drift` carries the corners'
 * accumulated excess (mm, summed over the corners) from earlier rounds.
 */
export function workLayers(list: Tok[], layers: BorderLayer[], P: ParamSet, cornerSyntax: boolean, n = 4, drift = 0, prevCorner?: { kind: string; corner: Make[] }): { rounds: LayerOut[]; next: Tok[]; drift: number; checks: PolygonInput[] } {
  let cur = list;
  const rounds: LayerOut[] = [];
  const checks: PolygonInput[] = [];
  const need = (h: number) => polygonCornerGrowth(n, h);
  const record = (r: RoundResult, before: Tok[], intended?: boolean) => {
    const growth = r.perimeter - listPerimeter(before) - (r.adjust ?? 0);
    drift += growth - r.corners * need(r.height);
    checks.push({ label: '', cornerGrowth: growth, corners: r.corners, height: r.height, intended });
  };
  layers.forEach((layer, li) => {
    const def = BORDER_BY_KIND[layer.kind];
    if (!sidesFit(cur, def)) {
      const c = chooseCorner(cur, 'sc', 'solid', P, drift, n);
      const su = setupRound(cur, def.sideRule!, c, P, cornerSyntax);
      record(su, cur);
      rounds.push({ kind: 'setup', result: su, corner: c, note: `set-up round: ${def.sideRule!.why}`, layer: li });
      cur = su.next;
    }
    const prev = rounds[rounds.length - 1] ?? prevCorner;
    const c = chooseCorner(cur, layer.kind, layer.corner ?? 'auto', P, drift, n, prev?.kind === layer.kind ? prev.corner : undefined);
    const res = workRound(cur, layer.kind, c, P, cornerSyntax);
    record(res, cur, def.ruffle);
    rounds.push({ kind: layer.kind, result: res, corner: c, note: def.name, layer: li, intended: def.ruffle });
    cur = res.next;
  });
  return { rounds, next: cur, drift, checks };
}
