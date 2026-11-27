/**
 * "One arm" / "one repeat" view of a radial chart (pure).
 *
 * An n-fold piece is worked as n copies of one repeat, so a chart can show one repeat wedge
 * enlarged and say "×n" — the way snowflake and doily leaflets chart them. The wedge is centred
 * on an arm of the outermost pointed round (the longest arms; the one nearest 12 o'clock) or, for
 * an ordinary doily, on a given axis (the symmetry frame's first repeat). It spans ±π/n: the body
 * sector, the whole arm, and the valley bridges either side of it (whole, with any valley anchor);
 * neighbouring arms are left out. The layout is rotated so the wedge's axis points up (symbols are
 * regenerated from the rotated positions, so an sc's × stays upright).
 */
import type { Bounds, ChartLayout, ChartNode, ChartRound, Pt } from './types';

const TAU = Math.PI * 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface WedgeLabel { x: number; y: number; text: string }

export interface WedgeView {
  kind: 'arm' | 'repeat';
  /** Rotational order n: the wedge is worked n times. */
  order: number;
  /** Axis of the wedge in the original layout (radians, counter-clockwise from 3 o'clock). */
  axis: number;
  /** Half-angle of the wedge (π/n). */
  half: number;
  /** Counter-clockwise rotation applied to the layout (radians) so the axis points up. */
  rotate: number;
  /** The layout rotated (same node ids and order); `bounds` = the wedge's bounds. */
  layout: ChartLayout;
  /** Per node id: 1 = part of the wedge (drawn), 0 = outside (ghosted or hidden). */
  inside: Uint8Array;
  /** Tight bounds of the wedge's symbols in the rotated layout (padded). */
  bounds: Bounds;
  /** Round numbers placed along the wedge's edge (rotated coordinates). */
  labels: WedgeLabel[];
}

export interface WedgeOptions {
  /** Axis to centre on when the piece has no arms (radians, counter-clockwise from 3 o'clock). Default: 12 o'clock. */
  axis?: number;
  /** Padding round the wedge's bounds (chart units). Default 0.7. */
  pad?: number;
}

/**
 * The one-repeat wedge of an `order`-fold radial layout, or null when there is nothing to repeat
 * (order < 2, rows, an empty chart).
 */
export function wedgeView(layout: ChartLayout, order: number, o: WedgeOptions = {}): WedgeView | null {
  if (layout.mode !== 'radial' || !(order >= 2) || !layout.nodes.length) return null;
  const n = Math.round(order);
  const half = Math.PI / n;
  const pointed = [...layout.rounds].reverse().find((r) => r.pointed && r.arms && r.arms.length >= n);
  let axis = o.axis ?? Math.PI / 2;
  let kind: WedgeView['kind'] = 'repeat';
  let chosen = -1;
  if (pointed) {
    // the main arms: the longest; of those, the one nearest 12 o'clock
    const arms = pointed.arms!;
    const len = (a: (typeof arms)[number]) => a.r1 - a.r0;
    const longest = Math.max(...arms.map(len));
    let best = Infinity;
    arms.forEach((a, i) => {
      if (len(a) < longest * 0.9) return;
      const d = Math.abs(wrap(a.s - Math.PI / 2));
      if (d < best - 1e-9) { best = d; chosen = i; }
    });
    axis = arms[chosen].s;
    kind = 'arm';
  } else {
    // the copy of the given axis nearest 12 o'clock
    const step = TAU / n;
    const q = Math.round(wrap(Math.PI / 2 - axis) / step);
    axis = wrap(axis + q * step);
  }
  const tol = 0.03;
  const N = layout.nodes.length;
  const inside = new Uint8Array(N);
  const angleOf = (m: ChartNode) => Math.atan2(-m.cy, m.cx);
  const inWedge = (m: ChartNode) => Math.hypot(m.cx, m.cy) < 0.7 || Math.abs(wrap(angleOf(m) - axis)) <= half + tol;
  for (const m of layout.nodes) if (inWedge(m)) inside[m.id] = 1;
  for (const r of layout.rounds) {
    if (!r.pointed || !r.arms || r.first < 0) continue;
    // arms: whole or not at all
    const armOf = new Int32Array(r.last - r.first + 1).fill(-1);
    r.arms.forEach((a, i) => {
      const keep = Math.abs(wrap(a.s - axis)) <= half + tol;
      for (let id = a.first; id <= a.last; id++) { inside[id] = keep ? 1 : 0; armOf[id - r.first] = i; }
    });
    // the bridges either side of a kept arm: whole (with a valley anchor in them)
    let id = r.first;
    while (id <= r.last) {
      if (armOf[id - r.first] >= 0) { id++; continue; }
      let e = id;
      while (e + 1 <= r.last && armOf[e + 1 - r.first] < 0) e++;
      // a stretch between two arms: its chains and anchors, not the arm-base stitches next to
      // a dropped arm
      const any = (() => { for (let x = id; x <= e; x++) if (inside[x] && layout.nodes[x].kind === 'chain') return true; return false; })();
      if (any) {
        for (let x = id; x <= e; x++) {
          const m = layout.nodes[x];
          if (m.kind === 'chain' || m.kind === 'slst' || m.kind === 'tch') inside[x] = 1;
          else if (m.kind === 'stitch') {
            // a stitch beside an arm belongs with that arm
            const prevArm = x - 1 >= r.first ? armOf[x - 1 - r.first] : -1;
            const nextArm = x + 1 <= r.last ? armOf[x + 1 - r.first] : -1;
            const besideArm = prevArm >= 0 ? prevArm : nextArm;
            inside[x] = besideArm >= 0 ? (Math.abs(wrap(r.arms[besideArm].s - axis)) <= half + tol ? 1 : 0) : 1;
          }
        }
      }
      id = e + 1;
    }
  }
  const rotate = Math.PI / 2 - axis;
  const c = Math.cos(rotate), s = Math.sin(rotate);
  // ccw by `rotate` on the page (y down)
  const R = (p: Pt): Pt => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c });
  const nodes = layout.nodes.map((m) => {
    const a = R(m), b = R({ x: m.cx, y: m.cy });
    return { ...m, x: a.x, y: a.y, cx: b.x, cy: b.y, rot: m.rot - rotate, s: m.s + rotate, legs: m.legs.map(R) };
  });
  const rounds: ChartRound[] = layout.rounds.map((r) => {
    const out: ChartRound = { ...r, labelAt: R(r.labelAt), s0: r.s0 + rotate };
    if (r.arms) out.arms = r.arms.map((a) => ({ ...a, s: a.s + rotate }));
    if (r.hull) out.hull = r.hull.map(R);
    if (r.outline) {
      // radius per angle: shift by the rotation
      const M = r.outline.length, sh = Math.round((rotate / TAU) * M);
      out.outline = r.outline.map((_, i) => r.outline![(((i - sh) % M) + M) % M]);
    }
    return out;
  });
  const pad = o.pad ?? 0.7;
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (x: number, y: number, p: number) => {
    b.minX = Math.min(b.minX, x - p); b.minY = Math.min(b.minY, y - p);
    b.maxX = Math.max(b.maxX, x + p); b.maxY = Math.max(b.maxY, y + p);
  };
  for (const m of nodes) {
    if (!inside[m.id]) continue;
    grow(m.x, m.y, 0.4); grow(m.cx, m.cy, 0.4);
    if (m.kind === 'picot') grow(m.x + Math.cos(m.rot) * 0.7 * (m.scale ?? 1), m.y + Math.sin(m.rot) * 0.7 * (m.scale ?? 1), 0.25);
  }
  if (layout.ring) grow(0, 0, layout.ring.r + 0.3);
  else grow(0, 0, 0.3);
  // round numbers along the wedge's left edge, half-way up each round's band
  const labels: WedgeLabel[] = [];
  const edge = Math.PI / 2 + half * 0.8;
  for (const r of layout.rounds) {
    if (r.first < 0) continue;
    const rr = Math.max(0.45, r.pointed ? r.r0 + 0.5 : (r.r0 + r.r) / 2);
    labels.push({ x: rr * Math.cos(edge), y: -rr * Math.sin(edge), text: r.short });
  }
  for (const l of labels) grow(l.x, l.y, 0.35);
  const bounds = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
  const lay: ChartLayout = { ...layout, nodes, rounds, spaces: [], bounds };
  return { kind, order: n, axis, half, rotate, layout: lay, inside, bounds, labels };
}
