/**
 * The snowflake check: a blocked-shape prediction and an honest judgement of it.
 *
 * Snowflakes are stiffened and pinned out, so the circle rule of spec/flatness.md is the wrong test
 * for the pointed arm round. Instead:
 *
 *  1. Body: the centre and body rounds (before the arms) must lie flat by the normal rule — they are
 *     solved for it like doily rounds.
 *  2. Web (valley bridges): each bridge of k chains spans the straight gap d between its two anchors
 *     on top of the body (radius R0). Pinned out, its midpoint is pulled outward to
 *     R0·cos(Δφ/2) + ½·√(L² − d²) (the arc-rise of flatness.md). L/d < 0.95: the bridge is shorter
 *     than the gap and pulls the body in (puckers); L/d > 2.2: it sags into a loose loop.
 *  3. Arms: a spine of L chains stands radially from R0, stretched by `block_stretch`; a picot of P
 *     chains pins out to a point P·w_ch/2 beyond its base; branch pairs leave the spine at ±50° from
 *     where they are worked. The smallest distance between the arms (spines, branches, trefoil side
 *     picots) of neighbouring points, and between branches and valley bridges, minus the thread, is the
 *     clearance: below 1 mm they tangle when pinned.
 *  4. Shape: tips at R_tip, valleys at R_valley; a crisp star needs R_tip ≥ 1.35·R_valley.
 *
 * Limits: chains are taken at rest length × block_stretch (no thread stiffness, no stretch from
 * starch), the body is a circle, picots pin out to straight points, and branch angles are a
 * convention (50°). The 3D view with "blocked" is a second, physics-based opinion.
 */
import { simConfig, stitchParam, type ParamSet } from '../../params';
import type { SnowPlan } from './build';
import { branchPairs, branchPicot, bridgeChains } from './build';
import { spread } from '../motifs';
import type { BlockedShape, Bridge, Pt, Seg, SnowCheck, SnowCheckItem, SnowRound, SnowflakeSpec, ArmSpec, MinorSpec } from './types';

const BRANCH_ANGLE = (50 * Math.PI) / 180;
const SIDE_PICOT_ANGLE = (60 * Math.PI) / 180;

interface ArmGeo { segs: Seg[]; branchSegs: Seg[]; tips: { p: Pt; kind: 'tip' | 'branch' | 'minor' }[]; tipR: number; sides: Pt[]; branches: Pt[] }

/** Local frame (u radial, v sideways) at angle φ (0 = straight up) → page coordinates (y down). */
const at = (phi: number, u: number, v = 0): Pt => ({ x: u * Math.sin(phi) + v * Math.cos(phi), y: -u * Math.cos(phi) + v * Math.sin(phi) });

function armGeometry(arm: Pick<ArmSpec, 'length' | 'branches' | 'picot' | 'tip' | 'graded'>, phi: number, R0: number, params: ParamSet, minor: boolean): ArmGeo {
  const s = simConfig.block_stretch;
  const wch = stitchParam(params, 'ch').width * s;
  const L = Math.round(arm.length), P = Math.round(arm.picot);
  const S = L * wch;
  const tipExtra = arm.tip === 'spike' ? 1.5 * wch : arm.tip === 'bobble' ? stitchParam(params, 'dc').height : (P * wch) / 2;
  const tipU = R0 + S + tipExtra;
  const segs: Seg[] = [{ a: at(phi, R0), b: at(phi, tipU) }];
  const branchSegs: Seg[] = [];
  const tips: ArmGeo['tips'] = [{ p: at(phi, tipU), kind: minor ? 'minor' : 'tip' }];
  const sides: Pt[] = [], branches: Pt[] = [];
  if (arm.tip === 'trefoil') {
    const r = (Math.max(3, P - 1) * wch) / 2;
    for (const sg of [-1, 1]) {
      const b = at(phi, R0 + S + r * Math.cos(SIDE_PICOT_ANGLE), sg * r * Math.sin(SIDE_PICOT_ANGLE));
      branchSegs.push({ a: at(phi, R0 + S), b });
      tips.push({ p: b, kind: minor ? 'minor' : 'branch' });
      sides.push(b);
    }
  }
  const B = branchPairs({ ...arm, tip: arm.tip });
  if (B) {
    const segsCh = spread(L - 1, B + 1);
    let cum = 0;
    for (let i = 0; i < B; i++) {
      cum += segsCh[i];
      const u0 = R0 + (L - cum) * wch;
      const reach = (branchPicot(arm, i) * wch) / 2;
      for (const sg of [-1, 1]) {
        const b = at(phi, u0 + reach * Math.cos(BRANCH_ANGLE), sg * reach * Math.sin(BRANCH_ANGLE));
        branchSegs.push({ a: at(phi, u0), b });
        tips.push({ p: b, kind: 'branch' });
        branches.push(b);
      }
    }
  }
  return { segs, branchSegs, tips, tipR: tipU, sides, branches };
}

function minorGeometry(minor: MinorSpec, phi: number, R0: number, params: ParamSet): ArmGeo {
  if (minor.style === 'picot') {
    const wch = stitchParam(params, 'ch').width * simConfig.block_stretch;
    const tipU = R0 + (minor.picot * wch) / 2;
    return { segs: [{ a: at(phi, R0), b: at(phi, tipU) }], branchSegs: [], tips: [{ p: at(phi, tipU), kind: 'minor' }], tipR: tipU, sides: [], branches: [] };
  }
  return armGeometry({ length: minor.length, branches: 0, picot: minor.picot, tip: minor.style === 'trefoil' ? 'trefoil' : 'picot' }, phi, R0, params, true);
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

/** Predicted pinned-out shape of the snowflake. */
export function blockedShape(spec: SnowflakeSpec, plan: SnowPlan, params: ParamSet): BlockedShape {
  const n = spec.points;
  const theta = (2 * Math.PI) / n;
  const wch = stitchParam(params, 'ch').width * simConfig.block_stretch;
  const thread = stitchParam(params, 'ch').width * 0.5;
  const planned = plan.planned;
  const body = planned[planned.length - 2] ?? planned[0];
  const bodyR = body.r;
  const R0 = bodyR + stitchParam(params, 'sc').height;
  const { anchors, bridges: br } = plan.layout;

  const arms: BlockedShape['arms'] = [];
  const pins: BlockedShape['pins'] = [];
  const armGeos: { geo: ArmGeo; phi: number; sector: number; idx: number }[] = [];
  const anchorPins: BlockedShape['anchorPins'] = [];
  let tipR = 0, minorTipR = 0;
  for (let k = 0; k < n; k++) {
    anchors.forEach((a, idx) => {
      const phi = (k + a.frac) * theta;
      if (a.kind === 'valley') { pins.push({ p: at(phi, R0), kind: 'valley' }); anchorPins.push({ kind: 'valley', tip: at(phi, R0), sides: [], branches: [] }); return; }
      const geo = a.kind === 'point' ? armGeometry(spec.arm, phi, R0, params, false) : minorGeometry(spec.minor, phi, R0, params);
      if (a.kind === 'point') tipR = Math.max(tipR, geo.tipR); else minorTipR = Math.max(minorTipR, geo.tipR);
      armGeos.push({ geo, phi, sector: k, idx });
      anchorPins.push({ kind: a.kind, tip: geo.tips[0].p, sides: geo.sides, branches: geo.branches });
      arms.push({ spine: geo.segs, branches: geo.branchSegs, tips: geo.tips.map((t) => t.p) });
      for (const t of geo.tips) pins.push(t);
    });
  }
  const bridges: Bridge[] = [];
  const bridgeSegs: Seg[][] = [];
  const web: BlockedShape['web'] = [];
  for (let k = 0; k < n; k++) {
    for (const b of br) {
      const pa = (k + b.from) * theta, pb = (k + b.to) * theta;
      const dphi = pb - pa;
      const gap = 2 * R0 * Math.sin(dphi / 2);
      const L = b.chains * wch;
      const rise = L > gap ? 0.5 * Math.sqrt(L * L - gap * gap) : 0;
      const pm = (pa + pb) / 2;
      const pin = at(pm, R0 * Math.cos(dphi / 2) + rise);
      const ratio = L / Math.max(1e-9, gap);
      if (k === 0) bridges.push({ chains: b.chains, gapMm: gap, ratio, pin, verdict: ratio < 0.95 ? 'tight' : ratio > 2.2 ? 'sags' : 'ok' });
      pins.push({ p: pin, kind: 'valley' });
      bridgeSegs.push([{ a: at(pa, R0), b: pin }, { a: pin, b: at(pb, R0) }]);
      web.push({ a: at(pa, R0), pin, b: at(pb, R0) });
    }
  }
  // clearance: each arm against the next arm around (and branches against bridges)
  let clearance = Infinity;
  armGeos.forEach((g, i) => {
    const h = armGeos[(i + 1) % armGeos.length];
    if (h === g) return;
    const A = [...g.geo.segs.map((s) => ({ a: lift(s.a, wch), b: s.b })), ...g.geo.branchSegs];
    const B = [...h.geo.segs.map((s) => ({ a: lift(s.a, wch), b: s.b })), ...h.geo.branchSegs];
    clearance = Math.min(clearance, minDist(A, B) - thread);
    if (g.geo.branchSegs.length) for (const bs of bridgeSegs) clearance = Math.min(clearance, minDist(g.geo.branchSegs, bs) - thread);
  });
  if (!Number.isFinite(clearance)) clearance = 99;

  const valleyPins = pins.filter((p) => p.kind === 'valley');
  const valleyR = valleyPins.length ? Math.min(...valleyPins.map((p) => Math.hypot(p.p.x, p.p.y))) : R0;
  const angle = (p: Pt) => { let a = Math.atan2(p.x, -p.y); if (a < -1e-9) a += 2 * Math.PI; return a; };
  const outline = pins.map((p) => p.p).sort((a, b) => angle(a) - angle(b) || Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  const acrossMm = n % 2 === 0 ? 2 * tipR : tipR * (1 + Math.cos(Math.PI / n));
  const rings = planned.slice(0, -1).map((p) => p.r);
  return { points: n, bodyR, tipR, minorTipR, valleyR, clearanceMm: clearance, acrossMm, outline, pins, arms, bridges, web, rings, anchorPins };
}

/** Move a spine's base a little outward so neighbouring spines that share the body don't count as touching. */
function lift(p: Pt, by: number): Pt {
  const r = Math.hypot(p.x, p.y) || 1;
  return { x: p.x * (1 + by / r), y: p.y * (1 + by / r) };
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

  const R0 = shape.bodyR + stitchParam(params, 'sc').height;
  const tight = shape.bridges.find((b) => b.verdict === 'tight');
  const sags = shape.bridges.find((b) => b.verdict === 'sags');
  const fixCh = (b: Bridge) => bridgeChains(R0, (2 * Math.asin(Math.min(1, b.gapMm / (2 * R0)))) / ((2 * Math.PI) / spec.points), spec.points, 'medium', params);
  if (tight) items.push({ id: 'web', ok: false, text: `Valley bridges are too short (ch ${tight.chains} over a ${tight.gapMm.toFixed(0)} mm gap): they pull tight and pucker the body — use ch ${fixCh(tight)}.` });
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
  void plan;
  return { ok, summary, items };
}
