/**
 * The snowflake motif vocabulary and generator.
 *
 *   centre  ring of dc · spoked ring (dc, ch k) ×n or ×2n · cluster ring · petal ring (cl, ch g, cl)
 *   body    chain-loop hexagon (sc, ch k) · corners: V/shell at the points, plain sides (chain, shell
 *           or solid dc) · major/minor: 2 positions per point, a big corner and a small one
 *   arms    a spine of chain worked back in sl st or sc, with a tip: picot, trefoil (tip loop + two
 *           side picots), spike (long spine, small tip), bobble, or a pointed loop (ch, picot, ch);
 *           side-branch pairs (two picots on the way down: "fern"); minor points between the arms
 *           (picot, short spike or trefoil); valley bridges `ch k`, optionally anchored with an sc
 *
 * The centre and body rounds are solved for flatness exactly as the doily designer solves its
 * rounds (same predictor, a small beam search). The arm round is a pointed round: its bridge
 * chains are sized from the blocked geometry (geometry.ts), not from the circle rule.
 */
import { compilePattern } from '../../notation';
import { analyzeFlatness } from '../../flatness';
import { simConfig, stitchParam, type ParamSet } from '../../params';
import { countAnnotation, picotCount, sectorEntries, writeRound } from '../emit';
import { yarnOf } from '../generate';
import { anchorOps, bandOps, spaceSlots, spread } from '../motifs';
import { predictRound, startState, type FlatState } from '../predict';
import type { Entry, Iface, Item, Op, ParamValue, RoundParams, Stitch } from '../types';
import { blockedShape, judge } from './geometry';
import { tautPositions, tautRoundRadii, type V2 } from './taut';
import type { Graph } from '../../graph';
import type {
  ArmSpec, MinorSpec, SlotRole, SnowBodyMotif, SnowCentreStyle, SnowPlannedRound, SnowRound, SnowflakeResult, SnowflakeSpec,
} from './types';

export const SNOW_POINTS = [5, 6, 8, 12];
export const MIN_POINTS = 3;
export const MAX_POINTS = 12;

const st = (t: 'sc' | 'hdc' | 'dc' | 'tr', n = 1): Item => ({ k: 'st', s: { t }, n });
const CL: Stitch = { t: 'cl', base: 'dc', legs: 3 };
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
const num = (v: ParamValue | undefined, d: number) => (typeof v === 'number' ? v : v === undefined ? d : Number(v));
const pick = <T extends ParamValue>(fixed: RoundParams, key: string, values: T[]): T[] => (key in fixed ? [fixed[key] as T] : values);

export const CENTRE_LABEL: Record<SnowCentreStyle, string> = {
  ring: 'Ring of dc', spoked: 'Spoked ring', 'double-spoked': 'Double-spoked ring', cluster: 'Cluster ring', petal: 'Petal ring',
};
export const BODY_LABEL: Record<SnowBodyMotif, string> = {
  hexagon: 'Chain-loop hexagon', corners: 'Corners (V/shell points)', 'major-minor': 'Major/minor corners',
};
export const TIP_LABEL: Record<string, string> = {
  picot: 'Picot point', trefoil: 'Trefoil tip', spike: 'Long spike', bobble: 'Bobble tip', loop: 'Pointed loop',
};
export const MINOR_LABEL: Record<string, string> = { none: 'None', picot: 'Picot', spike: 'Short spike', trefoil: 'Small trefoil' };

export const CENTRE_BLURB: Record<SnowCentreStyle, string> = {
  ring: 'dc worked into a chain ring — a small solid hub.',
  spoked: '`dc, ch k` once per point: one loop for each arm.',
  'double-spoked': '`dc, ch k` twice per point: a loop for each arm and one between.',
  cluster: '`3-dc cl, ch k` per point — a knobbly hub.',
  petal: '`(cl, ch g, cl), ch k` per point — a little flower.',
};
export const BODY_BLURB: Record<SnowBodyMotif, string> = {
  hexagon: '`sc in loop, ch k` — the open web most snowflakes grow from.',
  corners: '`(2 dc, ch 3, 2 dc)` at each point, plain sides between — a crisp hexagon.',
  'major-minor': 'Two corners per point, big and small: twelve positions, major and minor.',
};

/* ------------------------------------------------------------------ roles */

/** Roles of a repeat's chain loops (spaceSlots order) from the ops that made them. */
export function rolesOf(ops: Op[], entries: Entry[]): SlotRole[] {
  const tags: SlotRole[] = [];
  let g = -1, chainRun = false;
  for (const o of ops) {
    if (o.k === 'into') {
      g++;
      for (const it of o.items) {
        if (it.k === 'ch') { if (!chainRun) tags.push(g === 0 ? 'point' : 'minor'); chainRun = true; }
        else if (it.k === 'hook') { if (chainRun) tags.pop(); chainRun = false; }
        else chainRun = false;
      }
    } else if (o.k === 'ch') { if (!chainRun) tags.push('valley'); chainRun = true; }
    else if (o.k === 'each' || o.k === 'picot') chainRun = false;
    else if (o.k === 'hook') { if (chainRun) tags.pop(); chainRun = false; }
    else if (o.k === 'along') chainRun = false;
  }
  const { slots } = spaceSlots(entries);
  const roles = slots.map((_, i) => tags[i] ?? 'valley');
  if (!roles.length) return roles;
  if (!roles.includes('point')) roles[0] = 'point';
  const pi = roles.indexOf('point');
  if (pi !== 0) { roles[pi] = roles[0] === 'minor' ? 'minor' : 'valley'; roles[0] = 'point'; }
  if (!roles.includes('minor') && roles.length >= 2) {
    const fr = slotFractions(entries);
    let best = -1, bd = 9;
    fr.forEach((f, i) => { if (i > 0 && Math.abs(f - 0.5) < bd) { bd = Math.abs(f - 0.5); best = i; } });
    if (best > 0) roles[best] = 'minor';
  }
  return roles;
}

/** Angular position of each chain loop within a repeat, as a fraction from the first loop (0) to the next repeat's (1). */
export function slotFractions(entries: Entry[]): number[] {
  const idx: number[] = [];
  entries.forEach((e, i) => { if (e.kind === 'sp') idx.push(i); });
  if (!idx.length) return [];
  return idx.map((i) => (i - idx[0]) / entries.length);
}

/* ------------------------------------------------------------------ candidates */

interface Cand { name: string; params: RoundParams; ops: Op[]; ringChains?: number; cost: number }

function chainFrac(ops: Op[]): number {
  let ch = 0, sts = 0;
  const its = (items: Item[]) => { for (const i of items) if (i.k === 'ch') ch += i.n; else if (i.k === 'st') sts += i.n; };
  for (const o of ops) { if (o.k === 'ch') ch += o.n; else if (o.k === 'into') its(o.items); else if (o.k === 'each') sts += o.count; }
  return (ch * 0.7) / Math.max(1e-9, ch * 0.7 + sts);
}

function centreCandidates(style: SnowCentreStyle, n: number, fixed: RoundParams, bold: number): Cand[] {
  const out: Cand[] = [];
  const rings = 'ringCh' in fixed ? [num(fixed.ringCh, 6)] : range(4, 24);
  const push = (params: RoundParams, ops: Op[], cost: number) => {
    for (const c of rings) out.push({ name: CENTRE_LABEL[style], params: { ...params, ringCh: c }, ops, ringChains: c, cost: cost + 0.01 * Math.abs(c - 6) });
  };
  if (style === 'ring') {
    for (const per of pick(fixed, 'per', [1, 2, 3, 4])) {
      const S = n * num(per, 2);
      if (S < 8 || S > 30) continue;
      push({ per }, [{ k: 'into', place: { to: 'ring' }, items: [st('dc', num(per, 2))] }], 0.2 * Math.abs(Math.log(S / 14)));
    }
  } else if (style === 'spoked' || style === 'double-spoked') {
    const per = style === 'spoked' ? 1 : 2;
    for (const h of pick(fixed, 'st', ['dc', 'tr'] as ParamValue[])) for (const k of pick(fixed, 'ch', [1, 2, 3, 4, 5])) {
      const ops: Op[] = [];
      for (let i = 0; i < per; i++) ops.push({ k: 'into', place: { to: 'ring' }, items: [st(h as 'dc' | 'tr')] }, { k: 'ch', n: num(k, 2) });
      push({ st: h, ch: k }, ops, (h === 'tr' ? 0.1 + 0.1 * bold : 0) + 0.05 * Math.abs(num(k, 2) - (bold > 0.5 ? 2 : 3)));
    }
  } else if (style === 'cluster') {
    for (const k of pick(fixed, 'ch', [2, 3, 4, 5])) {
      push({ ch: k }, [{ k: 'into', place: { to: 'ring' }, items: [{ k: 'st', s: CL, n: 1 }] }, { k: 'ch', n: num(k, 3) }], 0.05 * Math.abs(num(k, 3) - 3));
    }
  } else {
    for (const g of pick(fixed, 'gap', [2, 3, 4])) for (const k of pick(fixed, 'ch', [1, 2, 3, 4])) {
      push({ gap: g, ch: k }, [
        { k: 'into', place: { to: 'ring' }, items: [{ k: 'st', s: CL, n: 1 }, { k: 'ch', n: num(g, 3) }, { k: 'st', s: CL, n: 1 }] },
        { k: 'ch', n: num(k, 2) },
      ], 0.05 * Math.abs(num(g, 3) - 3));
    }
  }
  return out;
}

const ifaceOf = (entries: Entry[]): Iface => ({ kind: entries.some((e) => e.kind === 'sp') ? 'lace' : 'solid', entries });

function anchorCountsFor(prev: Iface, max = 3): number[] {
  if (prev.kind === 'lace') {
    const p = spaceSlots(prev.entries).slots.length;
    return range(Math.ceil(p / 2), Math.min(2 * p, Math.max(max, Math.ceil(p / 2))));
  }
  const a = prev.entries.filter((e) => e.kind === 'st').length;
  return range(Math.max(1, Math.ceil(a / 4)), Math.min(a, max + 1));
}

function bodyCandidates(motif: SnowBodyMotif, prev: Iface, fixed: RoundParams, bold: number): Cand[] {
  const out: Cand[] = [];
  const wantFrac = 0.6 - 0.35 * bold;
  const add = (params: RoundParams, ops: Op[] | null, cost: number) => {
    if (!ops) return;
    out.push({ name: BODY_LABEL[motif], params, ops, cost: cost + 0.8 * Math.abs(chainFrac(ops) - wantFrac) });
  };
  if (motif === 'hexagon') {
    for (const k of pick(fixed, 'ch', range(2, 9))) for (const m of pick(fixed, 'per', anchorCountsFor(prev, 3))) {
      const r = anchorOps(prev, { m: num(m, 1), group: () => [st('sc')], chain: num(k, 4), double: true, maxSkip: 3 });
      add({ ch: k, per: m }, r?.ops ?? null, (r?.cost ?? 0) + 0.02 * Math.abs(num(k, 4) - 5));
    }
  } else if (motif === 'corners') {
    for (const a of pick(fixed, 'size', [1, 2, 3])) for (const c of pick(fixed, 'corner', [2, 3, 4, 5])) {
      const corner: Item[] = [st('dc', num(a, 2)), { k: 'ch', n: num(c, 3) }, st('dc', num(a, 2))];
      for (const side of pick(fixed, 'side', ['chain', 'shell', 'solid'] as ParamValue[])) {
        if (side === 'solid') {
          if (prev.kind !== 'lace') {
            // on solid fabric: the corner in the first stitch, dc in the others, increases spread between
            const a0 = prev.entries.length;
            const vCorner: Item[] = [st('dc'), { k: 'ch', n: num(c, 3) }, st('dc')];
            for (const inc of pick(fixed, 'inc', [0, 1, 2, 3])) {
              if (num(inc, 0) > a0 - 1) continue;
              const at = new Set(spread(a0 - 1, Math.max(1, num(inc, 0))).reduce<number[]>((acc, len) => [...acc, (acc.length ? acc[acc.length - 1] : 0) + len], []));
              const ops = bandOps(prev, (i) => (i === 0 ? vCorner : num(inc, 0) && at.has(i) ? [st('dc', 2)] : [st('dc')]), () => []);
              add({ corner: c, side, inc }, ops, 0.2);
            }
            continue;
          }
          for (const f of pick(fixed, 'fill', [1, 2, 3, 4, 5])) {
            const ops = bandOps(prev, () => [st('dc')], (_len, i) => (i === 0 ? corner : [st('dc', num(f, 2))]));
            add({ size: a, corner: c, side, fill: f }, ops, 0.15 + 0.05 * Math.abs(num(a, 2) - 2));
          }
          continue;
        }
        for (const k of pick(fixed, 'ch', range(1, 7))) for (const m of pick(fixed, 'per', anchorCountsFor(prev, 3))) {
          const r = anchorOps(prev, {
            m: num(m, 1), group: (j) => (j === 0 ? corner : side === 'shell' ? [st('dc', 3)] : [st('sc')]), chain: num(k, 3), double: true, maxSkip: 3,
          });
          add({ size: a, corner: c, side, ch: k, per: m }, r?.ops ?? null, (r?.cost ?? 0) + 0.05 * Math.abs(num(a, 2) - 2) + (side === 'shell' ? 0.05 : 0));
        }
      }
    }
  } else {
    for (const c of pick(fixed, 'corner', [2, 3, 4, 5])) for (const form of pick(fixed, 'minorForm', ['v', 'sc'] as ParamValue[])) {
      for (const k of pick(fixed, 'ch', range(1, 7))) {
        const r = anchorOps(prev, {
          m: 2, double: true, maxSkip: 3, chain: num(k, 3),
          group: (j) => (j === 0 ? [st('dc', 2), { k: 'ch', n: num(c, 3) }, st('dc', 2)] : form === 'v' ? [st('dc'), { k: 'ch', n: 1 }, st('dc')] : [st('sc')]),
        });
        add({ corner: c, minorForm: form, ch: k }, r?.ops ?? null, (r?.cost ?? 0) + (form === 'sc' ? 0.05 : 0));
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ arms */

/**
 * Items of one arm, worked inside the anchor group `(sc, <arm>, sc) in next ch-3 sp` so that the
 * closing sc goes back into the loop (after hook addressing, "same sp" would mean the last chain).
 */
export function spineOps(arm: Pick<ArmSpec, 'length' | 'branches' | 'picot' | 'tip' | 'back' | 'graded'>): Item[] {
  const L = Math.max(2, Math.round(arm.length));
  const P = Math.max(3, Math.round(arm.picot));
  if (arm.tip === 'loop') return [{ k: 'ch', n: L }, { k: 'picot', n: P }, { k: 'ch', n: L }];
  const back = { t: arm.back === 'sc' ? 'sc' : 'slst' } as Stitch | { t: 'slst' };
  const ops: Item[] = [];
  switch (arm.tip) {
    case 'picot': ops.push({ k: 'ch', n: L + P }, { k: 'hook', s: { t: 'slst' }, nth: P + 1 }); break;
    case 'trefoil': {
      const p2 = Math.max(3, P - 1);
      ops.push({ k: 'ch', n: L + P }, { k: 'hook', s: { t: 'slst' }, nth: P + 1 }, { k: 'picot', n: p2 }, { k: 'picot', n: p2 });
      break;
    }
    case 'spike': ops.push({ k: 'ch', n: L + 3 }, { k: 'hook', s: { t: 'slst' }, nth: 4 }); break;
    case 'bobble': ops.push({ k: 'ch', n: L + 3 }, { k: 'hook', s: { t: 'cl', base: 'dc', legs: 4 }, nth: 4 }); break;
  }
  const B = branchPairs(arm);
  const segs = spread(L - 1, B + 1);
  segs.forEach((s, i) => {
    if (s > 0) ops.push({ k: 'along', s: back, count: s });
    if (i < B) { const pb = branchPicot(arm, i); ops.push({ k: 'picot', n: pb }, { k: 'picot', n: pb }); }
  });
  return ops;
}

export const branchPairs = (arm: Pick<ArmSpec, 'length' | 'branches' | 'tip'>) =>
  arm.tip === 'loop' ? 0 : Math.max(0, Math.min(Math.round(arm.branches), Math.round(arm.length) - 2, 3));
export const branchPicot = (arm: Pick<ArmSpec, 'picot' | 'graded'>, i: number) => Math.min(8, Math.max(3, Math.round(arm.picot)) + (arm.graded ? i : 0));

export function minorOps(minor: MinorSpec, back: 'slst' | 'sc'): Item[] {
  if (minor.style === 'picot') return [{ k: 'picot', n: Math.max(3, minor.picot) }];
  if (minor.style === 'spike') return spineOps({ length: minor.length, branches: 0, picot: minor.picot, tip: 'picot', back });
  if (minor.style === 'trefoil') return spineOps({ length: minor.length, branches: 0, picot: minor.picot, tip: 'trefoil', back });
  return [];
}

/** One anchor of the arm round: where it sits in the repeat (fraction 0…1 of the repeat) and what it carries. */
export interface ArmAnchor { frac: number; kind: 'point' | 'minor' | 'valley' }
export interface ArmLayout { anchors: ArmAnchor[]; bridges: { from: number; to: number; chains: number }[] }

const TARGET_RATIO = { deep: 1.08, medium: 1.3, shallow: 1.6 } as const;

/**
 * Bridge chains for a straight gap of `gapMm` between the two stitches it joins (taut body): the
 * bridge runs stitch → k chains → stitch, a thread of k·w_ch + w_sc, and is sized so that this
 * length at block stretch is `TARGET_RATIO[depth]` × the gap.
 */
export function bridgeChains(gapMm: number, depth: keyof typeof TARGET_RATIO, params: ParamSet): number {
  const wch = stitchParam(params, 'ch').width, wsc = stitchParam(params, 'sc').width;
  return Math.max(1, Math.round((TARGET_RATIO[depth] * gapMm / simConfig.block_stretch - wsc) / wch));
}

/** Thread length (rest) of a bridge of k chains between two sc: sc → ch … ch → sc. */
export const bridgeLength = (k: number, params: ParamSet) => k * stitchParam(params, 'ch').width + stitchParam(params, 'sc').width;

/** Where the arm round's groups go: the loops (or stitches) of the round below and what each carries. */
interface ArmPlace { frac: number; role: SlotRole; len: number }
interface ArmStructure { lace: boolean; pos: ArmPlace[]; kinds: (ArmAnchor['kind'] | null)[] }

function armStructure(spec: SnowflakeSpec, prev: SnowPlannedRound): ArmStructure {
  const minorOn = spec.minor.style !== 'none';
  const lace = prev.entries.some((e) => e.kind === 'sp');
  // positions: chain loops of the round below (lace), else its stitches
  let pos: ArmPlace[];
  if (lace) {
    const { slots } = spaceSlots(prev.entries);
    const fr = slotFractions(prev.entries);
    pos = slots.map((s, i) => ({ frac: fr[i], role: prev.roles[i] ?? 'valley', len: s.len }));
  } else {
    const a = prev.entries.length;
    pos = range(0, a - 1).map((i) => ({ frac: i / a, role: i === 0 ? 'point' : i === Math.floor(a / 2) ? 'minor' : 'valley', len: 0 }));
  }
  const kindOf = (p: ArmPlace): ArmAnchor['kind'] | null => {
    if (p.role === 'point') return 'point';
    if (p.role === 'minor' && minorOn) return 'minor';
    if (spec.valley.anchor && (p.role === 'valley' || p.role === 'minor')) return 'valley';
    return null;
  };
  let kinds = pos.map(kindOf);
  if (spec.valley.anchor) {
    // keep only the valley anchors nearest the middle of each gap between arms
    const armIdx = kinds.map((k, i) => (k === 'point' || k === 'minor' ? i : -1)).filter((i) => i >= 0);
    const keep = new Set<number>();
    armIdx.forEach((ai, j) => {
      const a = pos[ai].frac, b = j + 1 < armIdx.length ? pos[armIdx[j + 1]].frac : 1;
      const mid = (a + b) / 2;
      let best = -1, bd = 9;
      for (let i = 0; i < pos.length; i++) {
        if (kinds[i] !== 'valley' || pos[i].frac <= a || pos[i].frac >= b) continue;
        if (Math.abs(pos[i].frac - mid) < bd) { bd = Math.abs(pos[i].frac - mid); best = i; }
      }
      if (best >= 0) keep.add(best);
    });
    kinds = kinds.map((k, i) => (k === 'valley' && !keep.has(i) ? null : k));
  }
  return { lace, pos, kinds };
}

/** The arm round's ops: `(sc, <arm>, sc)` per point / minor point, a lone sc per valley anchor, bridges between. */
function armOps(st: ArmStructure, chainsFor: (j: number) => number, point: Item[], minor: Item[]): { ops: Op[]; anchors: ArmAnchor[] } {
  const ops: Op[] = [];
  const anchors: ArmAnchor[] = [];
  let skipSt = 0;
  const flushSkip = () => { if (skipSt) { ops.push({ k: 'skipSt', n: skipSt }); skipSt = 0; } };
  let aj = 0;
  st.pos.forEach((p, i) => {
    const k = st.kinds[i];
    const place = st.lace ? { to: 'sp' as const, len: p.len } : { to: 'st' as const };
    if (!k) {
      if (st.lace) ops.push({ k: 'skipSp', len: p.len }); else skipSt++;
      return;
    }
    flushSkip();
    anchors.push({ frac: p.frac, kind: k });
    if (k === 'point') ops.push({ k: 'into', place, items: [st_('sc'), ...point, st_('sc')] });
    else if (k === 'minor') ops.push({ k: 'into', place, items: [st_('sc'), ...minor, st_('sc')] });
    else ops.push({ k: 'into', place, items: [st_('sc')] });
    ops.push({ k: 'ch', n: chainsFor(aj++) });
  });
  flushSkip();
  return { ops, anchors };
}
const st_ = (t: 'sc') => st(t);

/** Body + arm-round anchors pulled taut (taut.ts), one repeat; cached per body and arm structure. */
export interface TautArmRound {
  /** Per anchor of one repeat, in working order: its first and last stitch (`sc` of `(sc, <arm>, sc)`; a valley sc is both). Mathematical frame (y up), centre at the origin. */
  anchors: { kind: ArmAnchor['kind']; first: V2; last: V2 }[];
  /** Mean radius of the stitch tops of each centre/body round. */
  rings: number[];
}
const tautCache = new Map<string, TautArmRound | null>();

function tautArmRound(spec: SnowflakeSpec, planned: SnowPlannedRound[], st: ArmStructure, params: ParamSet): TautArmRound | null {
  const n = spec.points;
  const key = JSON.stringify([n, params.id, planned.map((p) => [p.ops, p.ringChains, p.prevLead]), st.kinds]);
  if (tautCache.has(key)) return tautCache.get(key)!;
  // the arm round with a picot standing in for each arm: same stitches into the same places
  const probe = armOps(st, () => 1, [{ k: 'picot', n: 3 }], [{ k: 'picot', n: 3 }]);
  const lead = planned[planned.length - 1].entries.some((e) => e.kind === 'sp') ? spaceSlots(planned[planned.length - 1].entries).leading : 0;
  const rounds = [...planned.map((p, i) => ({ ops: p.ops, prevLead: p.prevLead, ring: i === 0 ? { chains: p.ringChains ?? 0 } : undefined })), { ops: probe.ops, prevLead: lead, ring: undefined }];
  const text = [`params: ${params.id}`, ...rounds.map((r, i) => `Rnd ${i + 1}: ${writeRound({ sector: r.ops, repeats: n, terms: 'US', prevLead: r.prevLead, ring: r.ring, fastenOff: i === rounds.length - 1 })}.`)].join('\n') + '\n';
  let out: TautArmRound | null = null;
  const g = compilePattern(text).pattern?.graph;
  if (g) {
    const last = g.rounds.length - 1;
    const groups = armGroups(g, last);
    const pos = tautPositions(g, params, last, simConfig.block_stretch, groups.filter((x) => x.last !== x.first).map((x) => [x.first, x.last]));
    const A = probe.anchors.length;
    if (groups.length === n * A) {
      const rep = n > 1 ? 1 : 0;
      const anchors = probe.anchors.map((a, q) => {
        const gr = groups[rep * A + q];
        const f = pos[gr.first], l = pos[gr.last];
        return f && l ? { kind: a.kind, first: f, last: l } : null;
      });
      if (anchors.every(Boolean)) out = { anchors: anchors as TautArmRound['anchors'], rings: tautRoundRadii(g, pos, last - 1) };
    }
  }
  if (tautCache.size > 300) tautCache.clear();
  tautCache.set(key, out);
  return out;
}

/** Groups of the arm round (round r): an arm's `sc … sc` worked into one place, or a lone sc; first/last stitch ids. */
export function armGroups(g: Graph, r: number): { first: number; last: number }[] {
  const rd = g.rounds[r];
  const ids: number[] = [];
  for (let i = rd.first; i <= rd.last; i++) {
    const nd = g.nodes[i];
    if (!nd.into.length || nd.type === 'slst' || nd.type === 'ch' || nd.type === 'picot') continue;
    if (nd.into.every((a) => ('space' in a ? g.spaces[a.space].round < r : g.nodes[a.node].round < r))) ids.push(i);
  }
  const key = (i: number) => JSON.stringify(g.nodes[i].into);
  const out: { first: number; last: number }[] = [];
  for (let k = 0; k < ids.length; k++) {
    const a = ids[k], b = ids[k + 1];
    if (b !== undefined && key(a) === key(b) && b - a > 1) { out.push({ first: a, last: b }); k++; } else out.push({ first: a, last: a });
  }
  return out;
}

/* ------------------------------------------------------------------ planning */

export interface SnowPlan {
  planned: SnowPlannedRound[];
  layout: ArmLayout;
  warnings: string[];
  ringChains: number;
  /** The body pulled taut with the arm round's anchor stitches on it (null if the probe did not compile). */
  taut: TautArmRound | null;
}

const BEAM = 8;
/** Body plans by (points, centre, body, params): arm changes (size fitting, "more like this") reuse them. */
type BodyBeam = { planned: SnowPlannedRound[]; warnings: string[]; score: number }[];
const bodyCache = new Map<string, BodyBeam>();

function flatScore(p: { e: number; eMin: number; eMax: number; cls: 'flat' | 'cup' | 'ruffle' }): number {
  const tol = simConfig.flatness.tol;
  if (p.cls === 'flat') return Math.abs(p.e) + (Math.abs(p.e) > tol ? 5 : 0);
  return 10 + (p.cls === 'cup' ? -tol - p.eMax : p.eMin - tol);
}

/** Normalise a spec (clamp numbers; fill defaults). */
export function normaliseSpec(spec: SnowflakeSpec): SnowflakeSpec {
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(x)));
  return {
    ...spec,
    points: clamp(spec.points, MIN_POINTS, MAX_POINTS),
    body: spec.body.slice(0, 5),
    arm: { ...spec.arm, length: clamp(spec.arm.length, 3, 24), branches: clamp(spec.arm.branches, 0, 3), picot: clamp(spec.arm.picot, 3, 6) },
    minor: { ...spec.minor, length: clamp(spec.minor.length, 2, 12), picot: clamp(spec.minor.picot, 3, 6) },
  };
}

/** Plan the rounds (no compile): beam search over centre + body for flatness, then the arm round. */
export function planSnowflake(specIn: SnowflakeSpec, params: ParamSet, opts: { bold?: number } = {}): SnowPlan {
  const spec = normaliseSpec(specIn);
  const n = spec.points;
  const bold = opts.bold ?? (spec.arm.back === 'sc' ? 0.7 : 0.3);
  const warnings: string[] = [];
  type Node = { rounds: SnowPlannedRound[]; state: FlatState; score: number };
  let beam: Node[] = [];
  const needMinor = spec.minor.style !== 'none';

  const make = (c: Cand, kind: SnowPlannedRound['kind'], prevEntries: Entry[], state: FlatState): SnowPlannedRound | null => {
    const entries = sectorEntries(c.ops);
    if (!entries.some((e) => e.kind === 'st')) return null;
    const p = predictRound(entries, n, kind === 'centre' ? startState(params, c.ringChains ?? 0) : state, params);
    const lead = prevEntries.some((e) => e.kind === 'sp') ? spaceSlots(prevEntries).leading : 0;
    return {
      kind, name: c.name, params: c.params, ops: c.ops, entries, roles: rolesOf(c.ops, entries), ringChains: c.ringChains,
      e: p.e, eMin: p.eMin, eMax: p.eMax, cls: p.cls, rho: p.rho, r: p.r, prevLead: lead,
    };
  };

  const cacheKey = JSON.stringify([n, spec.centre, spec.body, params.id, bold]);
  let cached = bodyCache.get(cacheKey);
  if (!cached) {
  for (const c of centreCandidates(spec.centre.style, n, spec.centre.params ?? {}, bold)) {
    const r = make(c, 'centre', [], startState(params, 0));
    if (!r) continue;
    beam.push({ rounds: [r], state: { k: 1, r: r.r }, score: flatScore(r) + 0.1 * c.cost });
  }
  const dedupe = (nodes: Node[]) => {
    nodes.sort((a, b) => a.score - b.score);
    const seen = new Set<string>(), out: Node[] = [];
    for (const x of nodes) {
      const last = x.rounds[x.rounds.length - 1];
      const key = JSON.stringify(last.entries) + last.r.toFixed(2);
      if (seen.has(key)) continue;
      seen.add(key); out.push(x);
      if (out.length >= BEAM) break;
    }
    return out;
  };
  beam = dedupe(beam);
  spec.body.forEach((b, bi) => {
    const next: Node[] = [];
    for (const node of beam) {
      const prev = node.rounds[node.rounds.length - 1];
      for (const c of bodyCandidates(b.motif, ifaceOf(prev.entries), b.params ?? {}, bold)) {
        const r = make(c, 'body', prev.entries, node.state);
        if (!r) continue;
        next.push({ rounds: [...node.rounds, r], state: { k: node.state.k + 1, r: r.r }, score: node.score + flatScore(r) + 0.1 * c.cost });
      }
    }
    if (!next.length) { warnings.push(`Body round ${bi + 1} (${BODY_LABEL[b.motif]}) cannot be worked on the round below with these settings — skipped.`); return; }
    beam = dedupe(next);
  });
  cached = beam.map((x) => ({ planned: x.rounds, warnings: [...warnings], score: x.score }));
  if (bodyCache.size > 200) bodyCache.clear();
  bodyCache.set(cacheKey, cached);
  }
  warnings.length = 0;
  if (cached[0]) warnings.push(...cached[0].warnings);
  beam = cached.map((x) => ({ rounds: x.planned, state: { k: x.planned.length, r: x.planned[x.planned.length - 1].r }, score: x.score }));
  // the arm round wants at least one loop (or stitch) per point, and a second position for minor points
  const ranked = beam.map((x) => {
    const last = x.rounds[x.rounds.length - 1];
    const slots = spaceSlots(last.entries).slots.length;
    const positions = slots || last.entries.length;
    const minorPenalty = needMinor && positions < 2 ? 3 : 0;
    return { x, s: x.score + minorPenalty };
  }).sort((a, b) => a.s - b.s);
  const best = ranked[0].x;
  const planned = best.rounds.slice();
  const body = planned[planned.length - 1];
  if (needMinor && (spaceSlots(body.entries).slots.length || body.entries.length) < 2) {
    warnings.push('The round below the arms has only one position per point, so the minor points were left out (add a body round with two loops per point).');
  }
  const struct = armStructure(spec, body);
  const taut = tautArmRound(spec, planned, struct, params);
  // bridges: from the last stitch of one anchor to the first of the next, across the taut body
  const bridges: ArmLayout['bridges'] = [];
  const nA = struct.kinds.filter(Boolean).length;
  const fracs = struct.pos.filter((_, i) => struct.kinds[i]).map((p) => p.frac);
  const gapOf = (j: number) => {
    if (taut) {
      const a = taut.anchors[j].last, b0 = taut.anchors[(j + 1) % nA].first;
      const t = j + 1 < nA ? 0 : (2 * Math.PI) / n;
      const b: V2 = [b0[0] * Math.cos(t) - b0[1] * Math.sin(t), b0[0] * Math.sin(t) + b0[1] * Math.cos(t)];
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const from = fracs[j], to = j + 1 < fracs.length ? fracs[j + 1] : 1;
    return 2 * (body.r + stitchParam(params, 'sc').height) * Math.sin((Math.PI * (to - from)) / n);
  };
  const chainsFor = (j: number) => {
    const ch = spec.valley.chains ?? bridgeChains(gapOf(j), spec.valley.depth, params);
    bridges.push({ from: fracs[j], to: j + 1 < fracs.length ? fracs[j + 1] : 1, chains: ch });
    return ch;
  };
  const armsOps = armOps(struct, chainsFor, spineOps(spec.arm), minorOps(spec.minor, spec.arm.back));
  const arms = { ops: armsOps.ops, layout: { anchors: armsOps.anchors, bridges } as ArmLayout };
  const entries = sectorEntries(arms.ops);
  const p = predictRound(entries, n, { k: planned.length, r: body.r }, params);
  planned.push({
    kind: 'arms', name: TIP_LABEL[spec.arm.tip] ?? 'Arms', params: armParams(spec), ops: arms.ops, entries, roles: rolesOf(arms.ops, entries),
    e: p.e, eMin: p.eMin, eMax: p.eMax, cls: p.cls, rho: p.rho, r: p.r,
    prevLead: body.entries.some((e) => e.kind === 'sp') ? spaceSlots(body.entries).leading : 0,
  });
  return { planned, layout: arms.layout, warnings, ringChains: planned[0].ringChains ?? 0, taut };
}

function armParams(spec: SnowflakeSpec): RoundParams {
  const a = spec.arm;
  const out: RoundParams = { length: a.length, tip: a.tip, picot: a.picot, branches: branchPairs(a), back: a.back };
  if (spec.minor.style !== 'none') { out.minor = spec.minor.style; out.minorLength = spec.minor.length; }
  out.valley = spec.valley.depth;
  if (spec.valley.anchor) out.anchor = 1;
  return out;
}

/* ------------------------------------------------------------------ titles and text */

const WORDS: Record<number, string> = { 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Eleven', 12: 'Twelve' };

export function snowflakeTitle(spec: SnowflakeSpec): string {
  const w = WORDS[spec.points] ?? String(spec.points);
  const kind = spec.arm.branches > 0 && spec.arm.tip !== 'loop' ? 'fern' : spec.arm.tip === 'trefoil' ? 'trefoil' : spec.arm.tip === 'bobble' ? 'bobble'
    : spec.arm.tip === 'loop' ? 'petal' : spec.arm.tip === 'spike' ? 'spiky' : 'star';
  const minor = spec.minor.style !== 'none' ? ' double-pointed' : '';
  return `${w}-point${minor} ${kind} snowflake`;
}

/** Plain words for the arm round's numbers. */
export function armSentence(spec: SnowflakeSpec, layout: ArmLayout): string {
  const a = spec.arm;
  const parts = [`ch ${a.length} spine`, TIP_LABEL[a.tip].toLowerCase() + (a.tip !== 'spike' && a.tip !== 'bobble' ? ` (ch-${a.picot})` : '')];
  const B = branchPairs(a);
  if (B) parts.push(`${B} branch pair${B > 1 ? 's' : ''}`);
  if (spec.minor.style !== 'none') parts.push(`minor ${MINOR_LABEL[spec.minor.style].toLowerCase()}`);
  const ch = [...new Set(layout.bridges.map((b) => b.chains))];
  parts.push(`ch ${ch.join('/')} valley bridge${spec.valley.anchor ? 's anchored in the valleys' : 's'}`);
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ generate */

export function generateSnowflake(specIn: SnowflakeSpec, params: ParamSet): SnowflakeResult {
  const spec = normaliseSpec(specIn);
  const plan = planSnowflake(spec, params);
  const { planned, layout } = plan;
  const warnings = [...plan.warnings];
  const terms = spec.terms ?? 'US';
  const title = spec.title?.trim() || snowflakeTitle(spec);
  const shape = blockedShape(spec, plan, params);

  const lines: string[] = [];
  lines.push('# Generated by the snowflake designer. Edit freely: it is ordinary notation.');
  lines.push(`title: ${title}`);
  lines.push(`terms: ${terms}`);
  lines.push(`yarn: ${params.yarn_weight}`);
  lines.push(`hook: ${params.hook_mm}mm`);
  lines.push(`params: ${params.id}`);
  lines.push(`source: generated by the snowflake designer (${spec.seed !== undefined ? `seed ${spec.seed}` : 'guided'}, ${spec.points} points)`);
  lines.push('license: CC0-1.0');
  const cm = (mm: number) => (mm / 10).toFixed(1);
  lines.push(`notes: ${spec.notes ? spec.notes + ' ' : ''}Stiffen and pin out over the blocking template: tips at ${cm(shape.tipR)} cm from the centre, valleys at ${cm(shape.valleyR)} cm (about ${cm(shape.acrossMm)} cm across the points). The last round is a pointed round, judged by blocking, not by the flatness rule.`);
  lines.push('');
  const roundLines = planned.map((p, i) => {
    const body = writeRound({
      sector: p.ops, repeats: spec.points, terms, prevLead: p.prevLead,
      ring: i === 0 ? { chains: p.ringChains ?? 0 } : undefined, fastenOff: i === planned.length - 1,
    });
    return `Rnd ${i + 1}: ${body}. ${countAnnotation(p.entries, spec.points, terms, picotCount(p.ops))}`;
  });
  const text = [...lines, ...roundLines].join('\n') + '\n';

  const compiled = compilePattern(text);
  const diagnostics = compiled.diagnostics.filter((d) => d.severity !== 'info').map((d) => ({ severity: d.severity, code: d.code, message: d.message }));
  for (const d of diagnostics) warnings.push(`Compiler ${d.severity}: ${d.message}`);
  const pattern = compiled.pattern;
  const flatness = pattern ? analyzeFlatness(pattern.graph, params) : undefined;

  const rounds: SnowRound[] = planned.map((p, i) => {
    const f = flatness?.rounds[i];
    const gr = pattern?.graph.rounds[i];
    const arms = p.kind === 'arms';
    return {
      number: i + 1, kind: p.kind, name: p.name, params: p.params,
      class: arms ? 'pointed' : f?.class ?? p.cls, e: f?.e ?? p.e,
      message: arms
        ? `Rnd ${i + 1} is a pointed round — judged by blocking, not by the flatness rule (tips at ${cm(shape.tipR)} cm).`
        : f?.message ?? '',
      stitches: gr?.stitchCount ?? p.entries.filter((e) => e.kind === 'st').length * spec.points,
      text: roundLines[i],
      radiusMm: arms ? shape.tipR : f?.r ?? p.r,
    };
  });
  const check = judge(spec, plan, shape, rounds, params);
  const stats = {
    rounds: rounds.length,
    stitches: rounds.reduce((a, r) => a + r.stitches, 0),
    diameterMm: shape.acrossMm,
    threadM: pattern ? yarnOf(pattern, params) : 0,
  };
  return { spec, text, pattern, flatness, rounds, planned, shape, check, stats, warnings, diagnostics };
}
