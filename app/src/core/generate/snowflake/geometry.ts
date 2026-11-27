/**
 * The snowflake check: a blocked-shape prediction and an honest judgement of it.
 *
 * Snowflakes are stiffened and pinned out, so the circle rule of spec/flatness.md is the wrong test
 * for the pointed arm round. Instead the template is built from the same reference geometry the 3D
 * view pins (docs/flatness_radius_note.md):
 *
 *  1. Body: the centre and body rounds must lie flat by the normal rule (solved like doily rounds).
 *     Where they block to is the body pulled out by its arms at the blocking tension (bodypull.ts —
 *     the spring network's own equilibrium, every arm pulling with the force that stretches a chain
 *     by block_stretch). An arm starts at its first sc there: the arm-base radius R0.
 *  2. Arms: each arm's reference layout (spine.ts, SPEC_NOTES N5/N6 — the layout the spring network
 *     takes its rest lengths from), stretched by what the blocking tension does to its doubled cord
 *     (build.ts `armStretch`, ~1 %), laid radially from its base. Pins: the
 *     tip-loop chain that reaches furthest (pins.ts `armPinNodes`), trefoil side picots and branch
 *     picots where the layout puts them (±60° / ±50°, reach n·w_ch/2).
 *  3. Web (valley bridges): a bridge of k chains runs from the last sc of one anchor to the first sc
 *     of the next (thread k·w_ch + w_sc); pinned at its middle chain it pins out to the apex of the V
 *     over the straight gap. Ratio thread × block_stretch / gap < 0.97: it cannot reach without
 *     stretching more than blocking does (too short; pulls the body in); > 2.2: it sags into a loop.
 *  4. Clearance: the smallest distance between the arms (spines, branches, trefoil side picots) of
 *     neighbouring points, and between branches and valley bridges, minus the thread; below 1 mm they
 *     tangle when pinned.
 *  5. Shape: tips at R_tip, valleys at R_valley; a crisp star needs R_tip ≥ 1.35·R_valley.
 *
 * Every pin is where the thread reaches under that tension (bridges with BRIDGE_PIN_SLACK to spare),
 * so the template asks for block_stretch at most — except a bridge that is too short, which the
 * check reports (`pinStretch`). The 3D view pins the piece to these marks as a second opinion; the
 * designer folds its verdict into the check.
 */
import { compilePattern } from '../../notation';
import { heightOf, simConfig, stitchParam, type ParamSet } from '../../params';
import { findPointedLoops, findSpines, pointedLoop, type PointedLoop, type Spine } from '../../sim/spine';
import { writeRound } from '../emit';
import type { Item } from '../types';
import type { SnowPlan } from './build';
import { armStretch, branchPairs, bridgeChains, bridgeLength, minorOps, spineOps } from './build';
import { armPinNodes } from './pins';
import { courseWidths, type V2 } from './taut';
import type { BlockedShape, Bridge, Pt, Seg, SnowCheck, SnowCheckItem, SnowRound, SnowflakeSpec, ArmSpec, MinorSpec } from './types';

/** Bridges whose thread at block stretch is shorter than this × the gap are too short (they need over 3 % more). */
export const BRIDGE_TIGHT = 0.97;
export const BRIDGE_SAGS = 2.2;
/**
 * Valley pins hold a bridge where it reaches with this fraction of its thread to spare. Measured on
 * the presets and 80 random designs: pinned exactly taut (at block stretch) the bridges pulled the
 * two sc of each arm apart whenever the arm feet sat a millimetre off the predicted body, and the
 * loops under the arms stretched 15–25 %; with 15 % to spare the valleys still pin to a crisp V.
 */
export const BRIDGE_PIN_SLACK = 0.15;

/* ------------------------------------------------------------------ arm reference layouts */

/** An arm's pins and drawing in its own frame (s outward from its first sc, t sideways towards the round's working direction), at rest. */
interface ArmFrame {
  kind: 'spine' | 'loop';
  tip: V2;
  sides: V2[];
  branches: V2[];
  segs: [V2, V2][];
  branchSegs: [V2, V2][];
}

const armCache = new Map<string, ArmFrame | null>();

/** Compile one arm worked off an sc (`(sc, <arm>, sc) in ring`) and read its reference layout. */
function armFrame(items: Item[], params: ParamSet): ArmFrame | null {
  const key = JSON.stringify([params.id, items]);
  if (armCache.has(key)) return armCache.get(key)!;
  const sc: Item = { k: 'st', s: { t: 'sc' }, n: 1 };
  const text = `params: ${params.id}\nRnd 1: ${writeRound({ sector: [{ k: 'into', place: { to: 'ring' }, items: [sc, ...items, sc] }], repeats: 1, terms: 'US', prevLead: 0, ring: { chains: 8 }, fastenOff: true })}.\n`;
  let out: ArmFrame | null = null;
  const g = compilePattern(text).pattern?.graph;
  if (g) {
    const w = courseWidths(g, params);
    const h = g.nodes.map((nd) => heightOf(params, nd));
    const wch = stitchParam(params, 'ch').width;
    const sp: Spine | undefined = findSpines(g, w, h, wch)[0];
    let pl: PointedLoop | undefined = findPointedLoops(g, w)[0];
    if (!sp && !pl) {
      // a pointed loop shorter than N6's minimum (ch 3, picot, ch 3): drawn and pinned the same way
      const first = g.nodes.findIndex((nd) => nd.type === 'picot');
      if (first > 0) {
        let a0 = first - 1; while (a0 > 0 && g.nodes[a0 - 1].type === 'ch' && g.nodes[a0 - 1].role !== 'tch') a0--;
        let p = first; const pics: number[] = []; while (g.nodes[p]?.type === 'picot') pics.push(p++);
        let b1 = p; while (g.nodes[b1 + 1]?.type === 'ch') b1++;
        const a: number[] = [], b: number[] = [];
        for (let c = a0; c < first; c++) a.push(c);
        for (let c = p; c <= b1; c++) b.push(c);
        if (a.length && b.length && a0 >= 1) pl = pointedLoop(a0 - 1, a, pics, b, b1 + 1, w);
      }
    }
    if (sp) {
      const P = (v: number): V2 => sp.pos.get(v) ?? [0, 0];
      const { tip, sides, branches } = armPinNodes(g, sp);
      const stemEnd = sp.stem[sp.stem.length - 1];
      const segs: [V2, V2][] = [[[0, 0], P(stemEnd)]];
      const r1 = sp.tip.length ? sp.tip[sp.tip.length - 1] + 1 : -1;
      const loop = [stemEnd, ...sp.tip, ...(r1 >= 0 && sp.pos.has(r1) ? [r1] : [])];
      for (let k = 0; k + 1 < loop.length; k++) segs.push([P(loop[k]), P(loop[k + 1])]);
      const baseOf = (p: number) => { let b = p - 1; while (b > sp.base && (g.nodes[b].type === 'picot' || !sp.pos.has(b))) b--; return b; };
      const branchSegs: [V2, V2][] = [...sides, ...branches].map((p) => [P(baseOf(p)), P(p)]);
      out = { kind: 'spine', tip: P(tip), sides: sides.map(P), branches: branches.map(P), segs, branchSegs };
    } else if (pl) {
      const P = (v: number): V2 => pl!.pos.get(v)!;
      const path = [pl.base, ...pl.nodes, pl.close];
      const segs: [V2, V2][] = [];
      for (let k = 0; k + 1 < path.length; k++) segs.push([P(path[k]), P(path[k + 1])]);
      out = { kind: 'loop', tip: P(pl.picots[0]), sides: [], branches: [], segs, branchSegs: [] };
    }
  }
  if (armCache.size > 500) armCache.clear();
  armCache.set(key, out);
  return out;
}

/* ------------------------------------------------------------------ geometry helpers */

const rot = (p: V2, a: number): V2 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
const len = (p: V2) => Math.hypot(p[0], p[1]);

/** Apex of a V with sides l1 (from A) and l2 (to B) over the chord AB, on the side away from the centre; on the chord if they cannot reach. */
function vApex(A: V2, B: V2, l1: number, l2: number): { p: V2; reach: boolean } {
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const c = Math.hypot(dx, dy);
  if (c < 1e-9) return { p: [A[0] + (A[0] / (len(A) || 1)) * l1, A[1] + (A[1] / (len(A) || 1)) * l1], reach: true };
  const ex: V2 = [dx / c, dy / c];
  let ey: V2 = [-ex[1], ex[0]];
  const mid: V2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  if (ey[0] * mid[0] + ey[1] * mid[1] < 0) ey = [-ey[0], -ey[1]];
  if (l1 + l2 <= c) { const t = l1 / (l1 + l2); return { p: [A[0] + t * dx, A[1] + t * dy], reach: false }; }
  const x = (c * c + l1 * l1 - l2 * l2) / (2 * c);
  const y = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  return { p: [A[0] + x * ex[0] + y * ey[0], A[1] + x * ex[1] + y * ey[1]], reach: true };
}

function segDist(s: Seg, t: Seg): number {
  // distance between two segments (2D): min of point-segment distances (segments that cross → 0)
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const d1 = cross(s.a, s.b, t.a), d2 = cross(s.a, s.b, t.b), d3 = cross(t.a, t.b, s.a), d4 = cross(t.a, t.b, s.b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  const ps = (p: Pt, q: Seg) => {
    const dx = q.b.x - q.a.x, dy = q.b.y - q.a.y;
    const l2 = dx * dx + dy * dy;
    const t0 = l2 ? Math.max(0, Math.min(1, ((p.x - q.a.x) * dx + (p.y - q.a.y) * dy) / l2)) : 0;
    return Math.hypot(p.x - q.a.x - t0 * dx, p.y - q.a.y - t0 * dy);
  };
  return Math.min(ps(s.a, t), ps(s.b, t), ps(t.a, s), ps(t.b, s));
}
const minDist = (A: Seg[], B: Seg[]) => { let m = Infinity; for (const a of A) for (const b of B) m = Math.min(m, segDist(a, b)); return m; };

/** Move a spine's base a little outward so neighbouring spines that share the body don't count as touching. */
function lift(p: Pt, by: number): Pt {
  const r = Math.hypot(p.x, p.y) || 1;
  return { x: p.x * (1 + by / r), y: p.y * (1 + by / r) };
}

const armItems = (arm: ArmSpec): Item[] => spineOps(arm);
const minorItems = (minor: MinorSpec, back: ArmSpec['back']): Item[] => minorOps(minor, back);

/* ------------------------------------------------------------------ the blocked shape */

/** Predicted pinned-out shape of the snowflake (the blocking template). */
export function blockedShape(spec: SnowflakeSpec, plan: SnowPlan, params: ParamSet): BlockedShape {
  const n = spec.points;
  const theta = (2 * Math.PI) / n;
  const s = simConfig.block_stretch;
  const wch = stitchParam(params, 'ch').width, wsc = stitchParam(params, 'sc').width, hsc = stitchParam(params, 'sc').height;
  const thread = wch * 0.5;
  const planned = plan.planned;
  const { anchors, bridges: br } = plan.layout;
  // one repeat of the arm round's anchor stitches on the taut body (fallback: on the flatness circle)
  const taut = plan.taut ?? {
    anchors: anchors.map((a) => {
      const R = (planned[planned.length - 2] ?? planned[0]).r + hsc;
      const p: V2 = [R * Math.cos(2 * Math.PI * a.frac / n), R * Math.sin(2 * Math.PI * a.frac / n)];
      return { kind: a.kind, first: p, last: p };
    }),
    rings: planned.slice(0, -1).map((p) => p.r),
  };
  const A = taut.anchors.length;
  const p0 = Math.max(0, taut.anchors.findIndex((a) => a.kind === 'point'));
  const ang0 = Math.atan2(taut.anchors[p0].first[1], taut.anchors[p0].first[0]);
  // template frame: first point straight up, y down (the working direction runs clockwise on paper)
  const T = (p: V2): Pt => { const q = rot(p, Math.PI / 2 - ang0); return { x: q[0], y: -q[1] }; };

  const frames = {
    point: armFrame(armItems(spec.arm), params),
    minor: spec.minor.style === 'none' || spec.minor.style === 'picot' ? null : armFrame(minorItems(spec.minor, spec.arm.back), params),
  };
  const lcPicot = 0.5 * (wsc + stitchParam(params, 'picot').width);

  const arms: BlockedShape['arms'] = [];
  const pins: BlockedShape['pins'] = [];
  const anchorPins: BlockedShape['anchorPins'] = [];
  const armSegs: { segs: Seg[]; branchSegs: Seg[] }[] = [];
  const bridges: Bridge[] = [];
  const web: BlockedShape['web'] = [];
  const bridgeSegs: Seg[][] = [];
  let tipR = 0, minorTipR = 0, pinStretch = s - 1;
  const bases: number[] = [];
  const at = (k: number, q: number) => {
    const a = taut.anchors[q];
    return { kind: a.kind, first: rot(a.first, k * theta), last: rot(a.last, k * theta) };
  };
  for (let k = 0; k < n; k++) {
    for (let q = 0; q < A; q++) {
      const el = at(k, q);
      if (el.kind === 'valley') {
        const p = T(el.first);
        pins.push({ p, kind: 'valley' });
        anchorPins.push({ kind: 'valley', tip: p, sides: [], branches: [] });
      } else {
        const fr = el.kind === 'point' ? frames.point : frames.minor;
        const tipKind = el.kind === 'point' ? 'tip' : 'minor';
        if (el.kind === 'point') bases.push(len(el.first));
        let tip: Pt, sides: Pt[] = [], branchPts: Pt[] = [], segs: Seg[] = [], bsegs: Seg[] = [];
        if (fr) {
          const u: V2 = [el.first[0] / (len(el.first) || 1), el.first[1] / (len(el.first) || 1)];
          const v: V2 = [-u[1], u[0]];
          const sg = fr.kind === 'loop' && (el.last[0] - el.first[0]) * v[0] + (el.last[1] - el.first[1]) * v[1] < 0 ? -1 : 1;
          const sa = armStretch(el.kind === 'point' ? spec.arm : { tip: spec.minor.style === 'trefoil' ? 'trefoil' : 'spike', back: spec.arm.back }, params);
          const M = (p: V2): Pt => T([el.first[0] + sa * (p[0] * u[0] + sg * p[1] * v[0]), el.first[1] + sa * (p[0] * u[1] + sg * p[1] * v[1])]);
          tip = M(fr.tip);
          sides = fr.sides.map(M);
          branchPts = fr.branches.map(M);
          segs = fr.segs.map(([a, b]) => ({ a: M(a), b: M(b) }));
          bsegs = fr.branchSegs.map(([a, b]) => ({ a: M(a), b: M(b) }));
        } else {
          // a picot between the two sc (minor picot point): pinned to the apex it reaches
          const ap = vApex(el.first, el.last, lcPicot * s, lcPicot * s).p;
          tip = T(ap);
          segs = [{ a: T(el.first), b: tip }, { a: tip, b: T(el.last) }];
        }
        const r = Math.hypot(tip.x, tip.y);
        if (el.kind === 'point') tipR = Math.max(tipR, r); else minorTipR = Math.max(minorTipR, r);
        pins.push({ p: tip, kind: tipKind });
        for (const p of sides) pins.push({ p, kind: el.kind === 'minor' ? 'minor' : 'branch' });
        for (const p of branchPts) pins.push({ p, kind: 'branch' });
        anchorPins.push({ kind: el.kind, tip, sides, branches: branchPts });
        arms.push({ spine: segs, branches: bsegs, tips: [tip, ...sides, ...branchPts] });
        armSegs.push({ segs, branchSegs: bsegs });
      }
      // the bridge to the next anchor
      const b = br[q];
      if (!b) continue;
      const nxt = q + 1 < A ? at(k, q + 1) : at(k + 1, 0);
      const P0 = el.last, P1 = nxt.first;
      const gap = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
      const kk = b.chains, m = Math.floor(kk / 2);
      // the pin: where the bridge hangs with BRIDGE_PIN_SLACK of its length to spare (it holds the
      // valley without pulling the arms' feet apart if they sit a millimetre off the prediction)
      const sb = 1 - BRIDGE_PIN_SLACK;
      const l1 = sb * (0.5 * (wsc + wch) + m * wch), l2 = sb * (0.5 * (wsc + wch) + (kk - 1 - m) * wch);
      const apex = vApex(P0, P1, l1, l2);
      const ratio = (s * bridgeLength(kk, params)) / Math.max(1e-9, gap);
      if (!apex.reach) pinStretch = Math.max(pinStretch, gap / bridgeLength(kk, params) - 1);
      const pin = T(apex.p);
      if (k === 0) bridges.push({ chains: kk, gapMm: gap, ratio, pin, verdict: ratio < BRIDGE_TIGHT ? 'tight' : ratio > BRIDGE_SAGS ? 'sags' : 'ok' });
      pins.push({ p: pin, kind: 'valley' });
      const a = T(P0), c = T(P1);
      bridgeSegs.push([{ a, b: pin }, { a: pin, b: c }]);
      web.push({ a, pin, b: c });
    }
  }
  // clearance: each arm against the next arm around (and branches against bridges)
  let clearance = Infinity;
  armSegs.forEach((g, i) => {
    const h = armSegs[(i + 1) % armSegs.length];
    if (h === g) return;
    const lifted = (x: Seg[]) => x.map((sg, j) => (j === 0 ? { a: lift(sg.a, wch), b: sg.b } : sg));
    clearance = Math.min(clearance, minDist([...lifted(g.segs), ...g.branchSegs], [...lifted(h.segs), ...h.branchSegs]) - thread);
    if (g.branchSegs.length) for (const bs of bridgeSegs) clearance = Math.min(clearance, minDist(g.branchSegs, bs) - thread);
  });
  if (!Number.isFinite(clearance)) clearance = 99;

  const R0 = bases.length ? bases.reduce((x, y) => x + y, 0) / bases.length : (taut.rings[taut.rings.length - 1] ?? 0) + hsc;
  const bodyR = R0 - hsc;
  const valleyPins = pins.filter((p) => p.kind === 'valley');
  const valleyR = valleyPins.length ? Math.min(...valleyPins.map((p) => Math.hypot(p.p.x, p.p.y))) : R0;
  const angle = (p: Pt) => { let a = Math.atan2(p.x, -p.y); if (a < -1e-9) a += 2 * Math.PI; return a; };
  const outline = pins.map((p) => p.p).sort((a, b) => angle(a) - angle(b) || Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  const acrossMm = n % 2 === 0 ? 2 * tipR : tipR * (1 + Math.cos(Math.PI / n));
  return { points: n, bodyR, tipR, minorTipR, valleyR, clearanceMm: clearance, acrossMm, outline, pins, arms, bridges, web, rings: taut.rings, anchorPins, pinStretch };
}

const cm = (mm: number) => `${(mm / 10).toFixed(1)} cm`;

/** The read-out: body flat, web, clearance, blocked shape. */
export function judge(spec: SnowflakeSpec, plan: SnowPlan, shape: BlockedShape, rounds: SnowRound[], params: ParamSet): SnowCheck {
  const items: SnowCheckItem[] = [];
  const body = rounds.filter((r) => r.kind !== 'arms');
  const bad = body.filter((r) => r.class !== 'flat');
  items.push(bad.length
    ? { id: 'body', ok: false, text: `${bad[0].message} The body has to lie flat before the arms are added.` }
    : { id: 'body', ok: true, text: `Centre and body (${body.length === 1 ? 'Rnd 1' : `Rnds 1–${body.length}`}) lie flat by the normal rule.` });

  const tight = shape.bridges.find((b) => b.verdict === 'tight');
  const sags = shape.bridges.find((b) => b.verdict === 'sags');
  const fixCh = (b: Bridge) => bridgeChains(b.gapMm, 'medium', params);
  const over = Math.round(shape.pinStretch * 100);
  if (tight) items.push({ id: 'web', ok: false, text: `Valley bridges are too short (ch ${tight.chains} over a ${tight.gapMm.toFixed(0)} mm gap): pinned out they would have to stretch ${over} %, so they pull the body in and pucker it — use ch ${fixCh(tight)}.` });
  else if (sags) items.push({ id: 'web', ok: false, text: `Valley bridges are very long (ch ${sags.chains} over a ${sags.gapMm.toFixed(0)} mm gap, ×${sags.ratio.toFixed(1)}): they sag into loose loops — use ch ${fixCh(sags)} or anchor them in the valley.` });
  else {
    const b = shape.bridges[0];
    items.push({ id: 'web', ok: true, text: b ? `Valley bridges: ch ${b.chains} over a ${b.gapMm.toFixed(0)} mm gap (×${b.ratio.toFixed(2)}) — they pin out smoothly without pulling the body in.` : 'No valley bridges.' });
  }

  const hasBranches = branchPairs(spec.arm) > 0 || spec.arm.tip === 'trefoil' || spec.minor.style !== 'none';
  const what = hasBranches ? 'arm branches' : 'the arms';
  const c = shape.clearanceMm;
  if (c < 0) items.push({ id: 'clearance', ok: false, text: `Branches of neighbouring arms overlap by ${Math.abs(c).toFixed(1)} mm — use smaller picots, fewer branches or longer arms.` });
  else if (c < 1) items.push({ id: 'clearance', ok: false, text: `Neighbouring ${what} nearly touch (${c.toFixed(1)} mm) — they will tangle when pinned.` });
  else items.push({ id: 'clearance', ok: true, text: `${what[0].toUpperCase()}${what.slice(1)} clear each other by ${c >= 10 ? Math.round(c) : c.toFixed(1)} mm.` });

  const ratio = shape.tipR / Math.max(1e-9, shape.valleyR);
  const sane = shape.tipR > shape.valleyR && shape.valleyR > shape.bodyR * 0.98;
  if (ratio >= 1.35 && sane) items.push({ id: 'shape', ok: true, text: `Blocks to a crisp ${spec.points}-pointed star: tip radius ${cm(shape.tipR)}, valley radius ${cm(shape.valleyR)}.` });
  else items.push({ id: 'shape', ok: false, text: `The points barely stand out (tips at ${cm(shape.tipR)}, valleys at ${cm(shape.valleyR)}): it will block round, like a flower — lengthen the arms or deepen the valleys.` });

  const ok = items.every((i) => i.ok);
  const summary = ok
    ? `Blocks to a crisp star: tip radius ${cm(shape.tipR)}, valley radius ${cm(shape.valleyR)}, ${what} clear each other by ${c >= 10 ? Math.round(c) : c.toFixed(1)} mm.`
    : `Check: ${items.find((i) => !i.ok)!.text}`;
  void plan; void params;
  return { ok, summary, items };
}
