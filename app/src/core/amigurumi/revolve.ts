/**
 * Surface of revolution → crochet pattern (amigurumi). Pure; no DOM.
 *
 * Rounds lie along the surface: the profile is walked by ARC LENGTH in steps of one round height
 * h, so round k sits at s_k = k·h and wants N_k = round(2π·r(s_k) / w) stitches. That is the
 * AmiGo / Igarashi idea (rounds = level sets of distance from the start, constant stitch width
 * along each) reduced to a surface of revolution. Arc-length stepping makes flat parts (a base),
 * steep parts and even overhangs (a mushroom's underside) all work: |dr/ds| ≤ 1, so a round never
 * needs more than the flat-disc rate 2πh/w extra stitches.
 *
 * Crochetability limits per round: at most doubling (every stitch an inc), at most halving (every
 * stitch a dec), and at most ≈1.2 × the flat rate (more than that ruffles). Where a limit binds the
 * round is clamped and a warning names it. Increases/decreases are spread evenly and staggered
 * (see rounds.ts → spreadEvenly).
 */
import type { ParamSet } from '../params';
import { paramSetById, stitchParam } from '../params';
import { distanceToProfile, pointAt, sampleProfile, type Profile, type SampledProfile } from './profile';
import { emitPattern, hookLabel, spreadEvenly, compressUnits, type AmiStitch, type EmitRound, type Unit } from './rounds';

const TAU = 2 * Math.PI;

export interface RevolveOptions {
  profile: Profile;
  params: ParamSet;
  stitch?: AmiStitch;
  title?: string;
  /** Stagger increases between rounds (default true). False stacks them (textbook, hexagonal). */
  stagger?: boolean;
  /** Work the first even round after a sharp corner (≥ 45°) in back loops only (default true). */
  crispCorners?: boolean;
  /** Magic-ring stitch count (closed start). Default: from the profile, snapped to the flat-disc start. */
  startCount?: number;
  /** 'arc' (default, correct) or 'height': rounds at equal heights — shown for comparison; fails on flat/overhanging parts. */
  stepping?: 'arc' | 'height';
  /** Keep every round a multiple of this (e.g. 6 for symmetric textbook repeats). Default 1: free. */
  repeat?: number;
  /** Closed end: keep decreasing until at most this many stitches remain (default 8). */
  endMax?: number;
}

export type RoundKind = 'start' | 'inc' | 'dec' | 'even';

export interface RevolveRound {
  /** 1-based round number. */
  n: number;
  count: number;
  prev: number;
  change: number;
  kind: RoundKind;
  /** Arc length of the round's stitch tops along the target profile (mm). */
  s: number;
  target: { r: number; z: number };
  /** 2π r / w before rounding. */
  exact: number;
  /** What the stitch count actually makes. */
  realised: { r: number; z: number };
  /** realised.r − target.r (mm). */
  error: number;
  /** Distance of the realised point from the target curve (mm). */
  distance: number;
  units: Unit[];
  text: string;
  blo?: boolean;
  clamped?: 'double' | 'halve' | 'rate' | 'min';
  /** Rotation used to stagger this round's increases/decreases (0 = textbook start). */
  offset: number;
  /** Line of this round in the generated text (1-based). */
  line?: number;
}

export interface RevolveWarning {
  severity: 'warning' | 'info';
  code: 'steep' | 'double' | 'halve' | 'min' | 'end' | 'overhang' | 'short' | 'deviation' | 'corner' | 'start';
  message: string;
  rounds?: number[];
}

export interface RevolveResult {
  text: string;
  stitch: AmiStitch;
  /** Stitch width and round height used (mm), and the flat-disc rate 2πh/w (stitches per round). */
  w: number; h: number; flatRate: number;
  start: { kind: 'ring'; count: number } | { kind: 'chain'; count: number };
  closedEnd: boolean;
  rounds: RevolveRound[];
  /** Dense target curve. */
  target: { r: number; z: number }[];
  /** Realised profile: start point + one point per round. */
  realised: { r: number; z: number }[];
  totalStitches: number;
  /** Rough yarn estimate (mm), ±30%. */
  yarnMm: number;
  dims: { heightMm: number; diameterMm: number };
  targetDims: { heightMm: number; diameterMm: number };
  maxDistance: number;
  warnings: RevolveWarning[];
}

/** Rough yarn per stitch as a multiple of (w + h): a loop count heuristic, not measured. */
const YARN_FACTOR: Record<AmiStitch, number> = { sc: 2.6, hdc: 3.0, dc: 3.2 };

export function flatRate(params: ParamSet, stitch: AmiStitch = 'sc'): number {
  const { width, height } = stitchParam(params, stitch);
  return (TAU * height) / width;
}
/** Magic-ring count of a flat circle: 6 sc / 8 hdc / 12 dc for the nominal sets. */
export function startCountFor(params: ParamSet, stitch: AmiStitch = 'sc'): number {
  return Math.max(3, Math.round(flatRate(params, stitch)));
}

function ranges(ns: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < ns.length;) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(j > i ? `${ns[i]}–${ns[j]}` : `${ns[i]}`);
    i = j + 1;
  }
  return (ns.length > 1 ? 'Rnds ' : 'Rnd ') + out.join(', ');
}

export function revolve(opts: RevolveOptions): RevolveResult {
  const stitch = opts.stitch ?? 'sc';
  const params = opts.params;
  const { width: w, height: h } = stitchParam(params, stitch);
  const rate = (TAU * h) / w;
  const D = startCountFor(params, stitch);
  const rateCap = Math.max(1, Math.round(rate * 1.2));
  const stagger = opts.stagger ?? true;
  const crisp = opts.crispCorners ?? true;
  const endMax = opts.endMax ?? 8;
  const sp: SampledProfile = sampleProfile(opts.profile);
  const L = sp.length;
  const warnings: RevolveWarning[] = [];
  const nOf = (r: number) => (TAU * r) / w;
  // optional symmetric repeats: every count a multiple of R (textbook style "*n sc, inc* x6")
  const R = Math.max(1, Math.round(opts.repeat ?? 1));
  const snap = (x: number) => (R > 1 ? Math.max(R, Math.round(x / R) * R) : Math.round(x));
  const cap = R > 1 ? Math.max(R, Math.floor(rateCap / R) * R) : rateCap;

  const p0 = pointAt(sp, 0), pL = pointAt(sp, L);
  const closedStart = nOf(p0.r) < 2.5;
  const closedEnd = nOf(pL.r) < 2.5;

  // --- arc-length positions of the rounds.
  // G = round(L / h) round heights fit the profile. For a closed end the spacing is stretched to
  // h' = L / G (by at most half a round over the whole piece) so the last round lands one h' before
  // the pole: like the magic ring at the start, the gather closes the last h' (and a sphere comes
  // out symmetric). An open end keeps the true h (a flat disc then gets exactly the flat rate) and
  // ends within h/2 of the drawn length.
  const G = Math.max(1, Math.round(L / h));
  const hs = closedEnd ? L / G : h; // an open end needs no exact landing: keep the true round height
  const K = closedEnd ? Math.max(1, G - 1) : G;
  let positions: number[] = Array.from({ length: K }, (_, i) => Math.min((i + 1) * hs, L));
  if (opts.stepping === 'height') {
    const z0 = p0.z, zL = pL.z, dir = Math.sign(zL - z0) || 1;
    const KH = Math.max(1, Math.round(Math.abs(zL - z0) / h) - (closedEnd ? 1 : 0));
    const dzs = Math.abs(zL - z0) / (KH + (closedEnd ? 1 : 0));
    positions = [];
    let overhang = false, j = 0;
    for (let k = 1; k <= KH; k++) {
      const zk = z0 + dir * k * dzs;
      while (j < sp.pts.length - 1 && (sp.pts[j].z - zk) * dir < 0) {
        if ((sp.pts[j + 1].z - sp.pts[j].z) * dir < -1e-6) overhang = true;
        j++;
      }
      positions.push(sp.pts[j].s);
    }
    for (let q = 1; q < sp.pts.length && !overhang; q++) if ((sp.pts[q].z - sp.pts[q - 1].z) * dir < -1e-3) overhang = true;
    if (overhang) warnings.push({ severity: 'warning', code: 'overhang', message: 'The profile turns back on itself in height; equal-height rounds cannot follow it. Step by arc length instead.' });
  }
  if (L < 2 * h) warnings.push({ severity: 'warning', code: 'short', message: `The profile is shorter than two rounds (${(L / 10).toFixed(1)} cm vs. a round height of ${(h / 10).toFixed(2)} cm).` });

  // --- corners for back-loop rounds
  const corners = sp.corners.filter((c) => c.angle >= Math.PI / 4);

  // --- stitch counts
  const rounds: RevolveRound[] = [];
  const history: number[][] = [];
  let prev = 0;
  let startInfo: RevolveResult['start'];
  const counts: { count: number; s: number; target: { r: number; z: number }; exact: number; clamped?: RevolveRound['clamped'] }[] = [];
  if (closedStart) {
    const t = pointAt(sp, positions[0]);
    const exact = nOf(t.r);
    const raw = Math.round(exact);
    let n1 = opts.startCount ?? (R > 1 ? R : Math.abs(raw - D) <= 1 ? D : Math.min(2 * D, Math.max(4, raw)));
    n1 = Math.max(3, Math.round(n1));
    counts.push({ count: n1, s: positions[0], target: { r: t.r, z: t.z }, exact });
    startInfo = { kind: 'ring', count: n1 };
    if (n1 !== D) warnings.push({ severity: 'info', code: 'start', message: `Starts with ${n1} ${stitch} in the magic ring (a flat start would be ${D}) because the profile begins ${n1 < D ? 'pointed' : 'blunt'}.` });
  } else {
    const n0 = Math.max(3, R, snap(nOf(p0.r)));
    const t = pointAt(sp, positions[0]);
    counts.push({ count: n0, s: positions[0], target: { r: t.r, z: t.z }, exact: nOf(t.r) });
    startInfo = { kind: 'chain', count: n0 };
  }
  prev = counts[0].count;
  let wasWide = prev > 4;
  const clampBy: Record<string, number[]> = { rate: [], double: [], halve: [], min: [] };
  for (let k = 1; k < positions.length; k++) {
    const t = pointAt(sp, positions[k]);
    const exact = nOf(t.r);
    let n = snap(exact);
    let clamped: RevolveRound['clamped'];
    const last = k === positions.length - 1;
    const floor = last && closedEnd ? Math.min(prev, D) : Math.min(prev, Math.max(4, R));
    let quietMin = false;
    if (n < floor) { n = floor; clamped = 'min'; quietMin = (last && closedEnd) || !wasWide; }
    if (n - prev > cap) { n = prev + cap; clamped = 'rate'; }
    if (prev - n > cap) { n = prev - cap; clamped = 'rate'; }
    if (n > 2 * prev) { n = R > 1 ? Math.floor((2 * prev) / R) * R : 2 * prev; clamped = 'double'; }
    if (2 * n < prev) { n = Math.ceil(prev / 2 / R) * R; if (!(last && closedEnd && Math.round(exact) < n)) clamped = 'halve'; }
    if (clamped && !(clamped === 'min' && quietMin)) clampBy[clamped].push(k + 1);
    if (n > 4) wasWide = true;
    counts.push({ count: n, s: positions[k], target: { r: t.r, z: t.z }, exact, clamped });
    prev = n;
  }
  // closed end: keep decreasing (beyond the profile) until it can be drawn closed
  if (closedEnd) {
    let extra = 0;
    while (prev > endMax) {
      const n = Math.max(Math.ceil(prev / 2 / R) * R, prev - cap);
      counts.push({ count: n, s: L, target: { r: pL.r, z: pL.z }, exact: 0 });
      prev = n; extra++;
    }
    const rs = counts.slice(-extra).map((_, i) => counts.length - extra + i + 1);
    if (extra === 1) warnings.push({ severity: 'info', code: 'end', rounds: rs, message: `Rnd ${rs[0]}: one more round of decreases closes the end down to ${prev} stitches.` });
    else if (extra > 1) warnings.push({ severity: 'warning', code: 'end', rounds: rs, message: `The profile closes faster than crochet can decrease; ${extra} extra decrease rounds were added, so the end is a little longer than drawn.` });
  }
  if (clampBy.rate.length) warnings.push({ severity: 'warning', code: 'steep', rounds: clampBy.rate, message: `${ranges(clampBy.rate)}: the profile changes width faster than a flat disc (more than ±${cap} stitches a round would ruffle or pucker). Counts are capped, so the realised shape lags behind the drawing there.` });
  if (clampBy.double.length) warnings.push({ severity: 'warning', code: 'double', rounds: clampBy.double, message: `${ranges(clampBy.double)}: would need more than an increase in every stitch; capped at doubling.` });
  if (clampBy.halve.length) warnings.push({ severity: 'warning', code: 'halve', rounds: clampBy.halve, message: `${ranges(clampBy.halve)}: would need more than a decrease in every pair; capped at halving.` });
  if (clampBy.min.length) warnings.push({ severity: 'info', code: 'min', rounds: clampBy.min, message: `${ranges(clampBy.min)}: the profile is narrower than 4 stitches around; kept at 4 (a closed tube).` });

  // --- units, stagger, realised profile
  const realised: { r: number; z: number }[] = [];
  let rz = { r: closedStart ? 0 : (startInfo.count * w) / TAU, z: p0.z };
  realised.push(rz);
  let prevTargetZ = p0.z;
  const usedCorners = new Set<number>();
  prev = startInfo.kind === 'chain' ? startInfo.count : 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    let units: Unit[];
    let offset = 0;
    let kind: RoundKind;
    if (i === 0) { units = Array(c.count).fill('st'); kind = 'start'; }
    else {
      const res = spreadEvenly(prev, c.count, { stagger, history });
      units = res.units; offset = res.offset;
      if (res.angles.length) history.unshift(res.angles);
      kind = c.count > prev ? 'inc' : c.count < prev ? 'dec' : 'even';
    }
    // realised point: radius from the count (ρ = N·w/2π), rise from what is left of h:
    // Δz = √(h² − Δρ²). Where the profile is nearly flat (Δρ ≈ h) rounding the count up makes that
    // round flat (Δz = 0): the realised shape is honest about it (poles come out a little flatter).
    const rr = (c.count * w) / TAU;
    const dr = rr - rz.r;
    const dzTarget = c.target.z - prevTargetZ;
    const sign = Math.abs(dzTarget) > 1e-9 ? Math.sign(dzTarget) : Math.sign(c.target.z - rz.z) || 1;
    const dz = sign * Math.sqrt(Math.max(0, h * h - dr * dr));
    rz = { r: rr, z: rz.z + dz };
    realised.push(rz);
    prevTargetZ = c.target.z;
    let blo = false;
    if (crisp && kind === 'even') {
      const cr = corners.find((co) => !usedCorners.has(co.index) && c.s > co.s && c.s - co.s <= 2.5 * h);
      if (cr) { blo = true; usedCorners.add(cr.index); }
    }
    const text = i === 0
      ? startInfo.kind === 'ring' ? `mr, ${c.count} ${stitch} in ring` : `${stitch} in each ch around`
      : blo ? `${stitch} blo in each st around` : compressUnits(units, stitch);
    rounds.push({
      n: i + 1, count: c.count, prev, change: i === 0 ? c.count : c.count - prev, kind, s: c.s, target: c.target, exact: c.exact,
      realised: rz, error: rz.r - c.target.r, distance: distanceToProfile(sp, rz), units, text, blo: blo || undefined,
      clamped: c.clamped, offset,
    });
    prev = c.count;
  }
  if (closedEnd) realised.push({ r: 0, z: rz.z + (Math.sign(pL.z - prevTargetZ) || 1) * Math.sqrt(Math.max(0, h * h - rz.r * rz.r)) });
  if (crisp) {
    const missed = corners.filter((co) => !usedCorners.has(co.index));
    if (missed.length) warnings.push({ severity: 'info', code: 'corner', message: `${missed.length === 1 ? 'A sharp corner falls' : `${missed.length} sharp corners fall`} on rounds that change count, so no back-loop round was added there; the corner will be rounded.` });
    const bl = rounds.filter((r) => r.blo).map((r) => r.n);
    if (bl.length) warnings.push({ severity: 'info', code: 'corner', rounds: bl, message: `${ranges(bl)}: worked in back loops only, which folds the fabric for a crisp corner.` });
  }

  // --- deviation
  const maxDistance = Math.max(0, ...rounds.map((r) => r.distance));
  const tb = boundsOf(sp.pts);
  const size = Math.max(tb.height, tb.diameter);
  if (maxDistance > Math.max(1.5 * h, 0.08 * size)) {
    const worst = rounds.reduce((a, b) => (b.distance > a.distance ? b : a));
    warnings.push({ severity: 'warning', code: 'deviation', rounds: [worst.n], message: `The realised shape departs from the drawing by up to ${(maxDistance / 10).toFixed(1)} cm (Rnd ${worst.n}). Features smaller than a few rounds cannot be resolved at this gauge.` });
  }

  // --- text
  const emitRounds: EmitRound[] = rounds.map((r) => ({ count: r.count, text: r.text }));
  if (closedEnd && rounds.length > 2) {
    let t = rounds.length - 1;
    while (t > 0 && rounds[t - 1].count > rounds[t].count) t--; // start of the final decreasing tail
    let at = t;
    while (at < rounds.length - 1 && rounds[at].count > 3 * D) at++;
    at = Math.min(at, rounds.length - 1);
    emitRounds[at].before = ['Stuff firmly now, while the opening is still wide enough; top up as you go.'];
  }
  emitRounds[emitRounds.length - 1].trailing = 'fasten off';
  const header: [string, string][] = [
    ['title', opts.title ?? 'Amigurumi shape'],
    ['terms', 'US'],
    ['yarn', params.yarn_weight],
    ['hook', hookLabel(params.hook_mm)],
  ];
  if (paramSetById(params.id)) header.push(['params', params.id]);
  header.push(['source', 'generated (surface of revolution)'], ['license', 'CC0-1.0']);
  header.push(['notes', `Continuous spiral rounds; mark the first stitch of each round. Gauge: ${stitch} ${w.toFixed(1)} mm wide x ${h.toFixed(1)} mm tall.`]);
  const preamble = [
    `Rounds follow the profile by arc length (one ${stitch} height apart); ${stagger ? 'increases and decreases are staggered between rounds so they do not stack into corners' : 'increases are stacked (textbook, gives a slightly polygonal shape)'}.`,
  ];
  const after = closedEnd
    ? ['Leave a 20 cm tail, weave it through the front loops of the last round and pull tight to close.']
    : ['Weave in the ends.'];
  const { text, roundLine } = emitPattern({
    header, preamble, rounds: emitRounds, after,
    foundation: startInfo.kind === 'chain' ? `ch ${startInfo.count}, join with sl st in first ch` : undefined,
  });
  rounds.forEach((r, i) => { r.line = roundLine[i]; });

  // --- totals
  const chains = startInfo.kind === 'chain' ? startInfo.count : 0;
  const totalStitches = rounds.reduce((a, r) => a + r.count, 0);
  const ch = stitchParam(params, 'ch');
  const yarnMm = totalStitches * YARN_FACTOR[stitch] * (w + h) + chains * 2.2 * (ch.width + ch.height) + 2 * 200;
  const rb = boundsOf(realised);
  return {
    text, stitch, w, h, flatRate: rate, start: startInfo, closedEnd, rounds,
    target: sp.pts.map((p) => ({ r: p.r, z: p.z })), realised, totalStitches, yarnMm,
    dims: { heightMm: rb.height, diameterMm: rb.diameter }, targetDims: { heightMm: tb.height, diameterMm: tb.diameter },
    maxDistance, warnings,
  };
}

function boundsOf(pts: { r: number; z: number }[]) {
  let rMax = 0, zMin = Infinity, zMax = -Infinity;
  for (const p of pts) { rMax = Math.max(rMax, p.r); zMin = Math.min(zMin, p.z); zMax = Math.max(zMax, p.z); }
  return { height: pts.length ? zMax - zMin : 0, diameter: 2 * rMax };
}
