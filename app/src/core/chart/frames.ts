/**
 * Course frames of the chart layout: how a round's course coordinate `s` and its height `h` map to
 * the page (pure; no DOM).
 *
 *  - circle (in layout.ts): `s` = angle, `h` = radius — doilies, circles, snowflakes;
 *  - rows (in layout.ts): `s` = x, `h` = −y;
 *  - offset (here): the course runs round a convex "core" polygon at distance `h − a`: straight
 *    sides parallel to the core's edges, a circular arc round each corner. `s` is the arc length
 *    along the course (at a reference radius for the arcs), scaled to one turn = 2π, so the
 *    machinery written for circles (unwrapping, fitting a closed round into one turn) applies.
 *
 *    One frame serves three kinds of piece:
 *      * the border of a blanket worked in rows: core = the body's rectangle, a = 0 (h = distance
 *        from the body), a rounded rectangle per round;
 *      * a piece worked round both sides of a foundation chain: core = the chain (a segment), a = 0:
 *        a stadium;
 *      * a polygon worked from the centre (granny square, hexagon): core = a regular n-gon of
 *        inradius `a`, so h is the distance from the centre to the side line, exactly as a radius
 *        is for a circle — the round's sides are straight, its corners fanned round arcs.
 *
 *    Moving along `h` at a fixed `s` goes straight out from a side (perpendicular to it) and fans
 *    out from the corner's vertex round a corner: stems on a side stand upright on it, corner
 *    groups fan round the corner.
 */
import type { Pt } from './types';

const TAU = Math.PI * 2;
const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Serialisable description of an offset frame (screen coordinates, y down). */
export interface FrameSpec {
  kind: 'offset';
  /** The core polygon's vertices, counter-clockwise on the page (screen coordinates). One or two vertices for a point / segment. */
  core: Pt[];
  /** Height of the core itself (0 for a border or a stadium; the inradius for a polygon from the centre). */
  a: number;
}

export interface Frame {
  pos(s: number, h: number): [number, number];
  height(x: number, y: number): number;
  course(x: number, y: number): number;
  out(x: number, y: number, s: number): [number, number];
}

export interface OffsetFrame extends Frame {
  spec: FrameSpec;
  /** Length of the course at height h (core perimeter + the corner arcs). */
  circ(h: number): number;
  /** Course coordinate of the bisector of corner j (its vertex, pointing straight out). */
  cornerS(j: number): number;
  /** Index of the nearest core vertex to (x, y) and the distance to it. */
  nearestCorner(x: number, y: number): { j: number; d: number };
  readonly corners: number;
}

/**
 * Offset frame round `spec.core`; corner arcs are measured at radius `rhoArc` (the course length
 * per unit of `s` there equals the real length, so spacing is right at that height).
 */
export function offsetFrame(spec: FrameSpec, rhoArc: number): OffsetFrame {
  // math coordinates (y up) inside
  const V = spec.core.map((p) => ({ x: p.x, y: -p.y }));
  const m = V.length;
  const a = spec.a;
  const rA = Math.max(0.05, rhoArc);
  // edges, unit directions, outward normals (core counter-clockwise: normal = edge direction rotated −90°)
  const E: { x: number; y: number; len: number; ux: number; uy: number; nx: number; ny: number }[] = [];
  for (let j = 0; j < m; j++) {
    const p = V[j], q = V[(j + 1) % m];
    const dx = q.x - p.x, dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    let ux = len > 1e-9 ? dx / len : 1, uy = len > 1e-9 ? dy / len : 0;
    if (m === 1) { ux = 1; uy = 0; }
    E.push({ x: p.x, y: p.y, len: m === 1 ? 0 : len, ux, uy, nx: uy, ny: -ux });
  }
  // corner j sits at V[j], between edge j−1 and edge j; its arc turns from n(j−1) to n(j)
  const nAng = E.map((e) => Math.atan2(e.ny, e.nx));
  const turn: number[] = [];
  for (let j = 0; j < m; j++) {
    if (m === 1) { turn.push(TAU); continue; }
    let d = mod(nAng[j] - nAng[(j - 1 + m) % m], TAU);
    if (d < 1e-9) d = 0;
    turn.push(d);
  }
  // cumulative course: corner j's arc starts at U[j], then edge j
  const U: number[] = [];
  let acc = 0;
  for (let j = 0; j < m; j++) { U.push(acc); acc += rA * turn[j] + E[j].len; }
  const P = acc;
  const perim = E.reduce((x, e) => x + e.len, 0);
  const sOf = (u: number) => (TAU * u) / P;

  /** Nearest feature of the core to math point (px, py): signed distance, course u, normal. */
  const project = (px: number, py: number): { d: number; u: number; nx: number; ny: number } => {
    if (m === 1) {
      const dx = px - V[0].x, dy = py - V[0].y, d = Math.hypot(dx, dy);
      const ang = d > 1e-12 ? Math.atan2(dy, dx) : 0;
      return { d, u: rA * mod(ang - nAng[0], TAU), nx: d > 1e-12 ? dx / d : 1, ny: d > 1e-12 ? dy / d : 0 };
    }
    // inside test (convex): signed distances to every edge line
    let best = -Infinity, bj = 0;
    let inside = true;
    for (let j = 0; j < m; j++) {
      const e = E[j];
      const sd = (px - e.x) * e.nx + (py - e.y) * e.ny;
      if (sd > 1e-12) inside = false;
      if (sd > best) { best = sd; bj = j; }
    }
    if (inside && m > 2) {
      const e = E[bj];
      const t = Math.min(e.len, Math.max(0, (px - e.x) * e.ux + (py - e.y) * e.uy));
      return { d: best, u: U[bj] + rA * turn[bj] + t, nx: e.nx, ny: e.ny };
    }
    // outside (or on a segment core): nearest edge segment
    let bd = Infinity, bu = 0, bnx = 0, bny = 0, bdist = 0;
    for (let j = 0; j < m; j++) {
      const e = E[j];
      const t = (px - e.x) * e.ux + (py - e.y) * e.uy;
      const sd = (px - e.x) * e.nx + (py - e.y) * e.ny;
      if (t >= 0 && t <= e.len) {
        // the side's own half-plane (a segment core has two edges on the same line)
        if (sd < -1e-12 && m === 2) continue;
        const dist = Math.abs(sd);
        if (dist < bd - 1e-12) { bd = dist; bu = U[j] + rA * turn[j] + t; bnx = e.nx; bny = e.ny; bdist = sd; }
      }
    }
    for (let j = 0; j < m; j++) {
      const dx = px - V[j].x, dy = py - V[j].y, dist = Math.hypot(dx, dy);
      if (dist < bd - 1e-12) {
        const n0 = nAng[(j - 1 + m) % m];
        const ang = dist > 1e-12 ? Math.atan2(dy, dx) : n0 + turn[j] / 2;
        const ph = Math.min(turn[j], Math.max(0, mod(ang - n0 + 1e-9, TAU) - 1e-9));
        bd = dist; bu = U[j] + rA * ph; bdist = dist;
        const nn = n0 + ph;
        bnx = Math.cos(nn); bny = Math.sin(nn);
      }
    }
    return { d: bdist, u: bu, nx: bnx, ny: bny };
  };

  const at = (s: number): { x: number; y: number; nx: number; ny: number } => {
    const u = mod((s * P) / TAU, P);
    let j = m - 1;
    for (let q = 0; q < m; q++) if (u < U[q] + rA * turn[q] + E[q].len) { j = q; break; }
    const local = u - U[j];
    const arc = rA * turn[j];
    if (local <= arc && arc > 0) {
      const nn = nAng[(j - 1 + m) % m] + local / rA;
      return { x: V[j].x, y: V[j].y, nx: Math.cos(nn), ny: Math.sin(nn) };
    }
    const e = E[j];
    const t = Math.min(e.len, local - arc);
    return { x: e.x + e.ux * t, y: e.y + e.uy * t, nx: e.nx, ny: e.ny };
  };

  return {
    spec,
    corners: m,
    pos: (s, h) => {
      const c = at(s);
      const o = h - a;
      return [c.x + c.nx * o, -(c.y + c.ny * o)];
    },
    height: (x, y) => a + project(x, -y).d,
    course: (x, y) => sOf(project(x, -y).u),
    out: (x, y) => {
      const p = project(x, -y);
      return [p.nx, -p.ny];
    },
    circ: (h) => perim + TAU * Math.max(0, h - a),
    cornerS: (j) => sOf(U[mod(j, m)] + (rA * turn[mod(j, m)]) / 2),
    nearestCorner: (x, y) => {
      let bj = 0, bd = Infinity;
      for (let j = 0; j < m; j++) { const d = Math.hypot(x - V[j].x, -y - V[j].y); if (d < bd) { bd = d; bj = j; } }
      return { j: bj, d: bd };
    },
  };
}

/** Regular n-gon of inradius `a` (screen coordinates, counter-clockwise on the page), a vertex at angle `phase` (radians, counter-clockwise from 3 o'clock). */
export function regularCore(n: number, a: number, phase: number): Pt[] {
  const R = a / Math.cos(Math.PI / n);
  const out: Pt[] = [];
  for (let j = 0; j < n; j++) {
    const t = phase + (TAU * j) / n;
    out.push({ x: R * Math.cos(t), y: -R * Math.sin(t) });
  }
  return out;
}

/** Closed SVG path of the course of `spec` at height h (the outline of a polygon / rounded rectangle / stadium round). */
export function framePath(spec: FrameSpec, h: number, digits = 3): string {
  const k = 10 ** digits;
  const f = (v: number) => String(Math.round(v * k) / k);
  const o = Math.max(0, h - spec.a);
  const V = spec.core.map((p) => ({ x: p.x, y: -p.y }));
  const m = V.length;
  if (m === 1) {
    const r = Math.max(o, 0.02);
    const c = spec.core[0];
    return `M${f(c.x - r)} ${f(c.y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
  }
  const pts: string[] = [];
  for (let j = 0; j < m; j++) {
    const p = V[j], q = V[(j + 1) % m], pr = V[(j - 1 + m) % m];
    const n0 = norm(pr, p), n1 = norm(p, q);
    // corner arc at p from n0 to n1 (counter-clockwise in math coordinates)
    const a0 = Math.atan2(n0.y, n0.x);
    let da = mod(Math.atan2(n1.y, n1.x) - a0, TAU);
    if (da < 1e-9) da = 0;
    const steps = Math.max(1, Math.ceil(da / (Math.PI / 18)));
    for (let i = 0; i <= steps; i++) {
      const t = a0 + (da * i) / steps;
      pts.push(`${f(p.x + Math.cos(t) * o)} ${f(-(p.y + Math.sin(t) * o))}`);
    }
  }
  return `M${pts.join('L')}Z`;
}

function norm(p: { x: number; y: number }, q: { x: number; y: number }) {
  const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1;
  return { x: dy / l, y: -dx / l };
}

const FRAMES = new WeakMap<FrameSpec, OffsetFrame>();
/** The frame of a spec (cached per spec object; corner arcs measured at radius 1). */
export function frameOf(spec: FrameSpec): OffsetFrame {
  let f = FRAMES.get(spec);
  if (!f) { f = offsetFrame(spec, 1); FRAMES.set(spec, f); }
  return f;
}

/** Height of the point (x, y) in the frame (its distance from the core, plus the core's own height). */
export function frameHeight(spec: FrameSpec, x: number, y: number): number {
  return frameOf(spec).height(x, y);
}
