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
  /** 'corner': a blanket border's corner detail (cornerView), not a rotational repeat. */
  kind: 'arm' | 'repeat' | 'corner';
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
  /** Per node id: 2 = the repeat (drawn in full), 1 = its neighbours inside the wedge (half-tone), 0 = outside (ghosted or hidden). */
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
  // rounds' starts (turning chains, joins): the wedge shown avoids them when it can — they are not
  // what the other repeats look like
  const seams = layout.rounds.filter((r) => r.first >= 0).map((r) => r.s0);
  const seamsNear = (a: number) => seams.filter((s0) => Math.abs(wrap(s0 - a)) < half + 0.05).length;
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
      // (not the arm at the rounds' start, when there is another: its turning chains and joins are
      // not what the other repeats look like)
      const d = Math.abs(wrap(a.s - Math.PI / 2)) + 10 * seamsNear(a.s);
      if (d < best - 1e-9) { best = d; chosen = i; }
    });
    axis = arms[chosen].s;
    kind = 'arm';
  } else {
    // the copy of the given axis nearest 12 o'clock
    // (the copy nearest 12 o'clock that is not the rounds' start, as for arms)
    const step = TAU / n;
    let best = Infinity, pick = axis;
    for (let q = 0; q < n; q++) {
      const a = wrap(axis + q * step);
      const d = Math.abs(wrap(a - Math.PI / 2)) + 10 * seamsNear(a);
      if (d < best - 1e-9) { best = d; pick = a; }
    }
    axis = pick;
  }
  const tol = 0.03;
  // 2 = the repeat itself (full ink), 1 = its neighbours inside the wedge (half-tone: stitches on
  // the wedge's edges belong to the next repeat), 0 = the rest
  const N = layout.nodes.length;
  const inside = new Uint8Array(N);
  const angleOf = (m: ChartNode) => Math.atan2(-m.cy, m.cx);
  for (const r of layout.rounds) {
    if (r.first < 0) continue;
    for (let id = r.first; id <= r.last; id++) {
      const m = layout.nodes[id];
      if (Math.hypot(m.cx, m.cy) < 0.7) { inside[id] = 2; continue; }
      const rel = r.dir * wrap(angleOf(m) - axis);
      inside[id] = rel >= -half - tol && rel < half - tol ? 2 : Math.abs(rel) <= half + tol ? 1 : 0;
    }
  }
  for (const r of layout.rounds) {
    if (!r.pointed || !r.arms || r.first < 0 || !r.arms.length) continue;
    const arms = r.arms;
    const ci = arms.findIndex((a) => Math.abs(wrap(a.s - axis)) <= tol + 1e-9) >= 0
      ? arms.findIndex((a) => Math.abs(wrap(a.s - axis)) <= tol + 1e-9)
      : arms.reduce((bi, a, i) => (Math.abs(wrap(a.s - axis)) < Math.abs(wrap(arms[bi].s - axis)) ? i : bi), 0);
    const len = r.last - r.first + 1;
    const ids = (from: number, count: number) => Array.from({ length: Math.max(0, count) }, (_, q) => r.first + (((from - r.first + q) % len) + len) % len);
    const alen = (a: (typeof arms)[number]) => a.r1 - a.r0;
    const longest = Math.max(...arms.map(alen));
    const major = (i: number) => alen(arms[i]) >= longest * 0.9;
    const A = arms.length;
    // the repeat's arms: the chosen arm and the minor arms after it, up to the next main arm
    const group: number[] = [ci];
    for (let i = (ci + 1) % A; i !== ci && !major(i); i = (i + 1) % A) group.push(i);
    let prevI = (ci - 1 + A) % A;
    arms.forEach((a, i) => { for (let id = a.first; id <= a.last; id++) inside[id] = group.includes(i) ? 2 : 0; });
    const stretch = (i: number) => {
      const a = arms[i], b = arms[(i + 1) % A];
      const from = a.last + 1;
      const count = ((b.first - from) % len + len) % len;
      return ids(from, count);
    };
    const isSeam = (x: number) => { const m = layout.nodes[x]; return m.role === 'travel' || m.role === 'join' || m.kind === 'tch'; };
    const stitches = (xs: number[]) => xs.filter((x) => layout.nodes[x].kind === 'stitch');
    // after each arm of the repeat (working order): closing stitch, bridge, valley anchor; the
    // last one stops before the next main arm's opening stitch
    group.forEach((gi, q) => {
      const after = stretch(gi);
      const nextOpen = q === group.length - 1 ? stitches(after).pop() : undefined;
      // (the round's seam — travelling sl sts, the join, a loose turning chain — is not part of the repeat)
      for (const x of after) inside[x] = x === nextOpen || isSeam(x) ? 0 : 2;
    });
    // before the arm: the previous repeat's bridge (and a minor arm there), shown as context
    if (!group.includes(prevI)) {
      const before = stretch(prevI);
      const st = stitches(before);
      const prevClose = st[0], open = st[st.length - 1];
      for (const x of before) inside[x] = x === open ? 2 : (x === prevClose && major(prevI)) || isSeam(x) ? 0 : 1;
      if (!major(prevI)) for (let id = arms[prevI].first; id <= arms[prevI].last; id++) inside[id] = 1;
    } else prevI = -1;
    // other stretches (far from the wedge) are out
    for (let i = 0; i < A; i++) {
      if (group.includes(i) || i === prevI) continue;
      for (const x of stretch(i)) inside[x] = 0;
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

/**
 * "Corner detail" of a body worked in rows with a border worked round it (the way a blanket
 * pattern charts its border): one bottom corner — a few stitches of each side, the foundation chain
 * and the first rows, and every border round round the corner — enlarged; the rest ghosted. Null
 * when the layout has no border. The corner is the bottom one on the side where Row 1 starts (the
 * rounds' joins and turning chains are at a top corner); all four are worked alike.
 */
export function cornerView(layout: ChartLayout, o: { pad?: number } = {}): WedgeView | null {
  const shape = layout.shape;
  if (shape?.kind !== 'border' || !layout.nodes.length) return null;
  const xs = shape.rect.map((p) => p.x), ys = shape.rect.map((p) => p.y);
  const xL = Math.min(...xs), xR = Math.max(...xs), yT = Math.min(...ys), yB = Math.max(...ys);
  let out = 0;
  for (const r of layout.rounds) if (r.border && r.first >= 0) out = Math.max(out, r.rOuter);
  // the side where the first row starts (its number is on that side)
  const row1 = layout.rounds.find((r) => r.kind === 'row' && r.first >= 0);
  const right = row1 ? row1.labelAt.x > (xL + xR) / 2 : true;
  const wIn = Math.min(7.5, Math.max(3, (xR - xL) * 0.45));
  const hIn = Math.min(7, Math.max(3, (yB - yT) * 0.6));
  const box: Bounds = right
    ? { minX: xR - wIn, maxX: xR + out + 0.3, minY: yB - hIn, maxY: yB + out + 0.3 }
    : { minX: xL - out - 0.3, maxX: xL + wIn, minY: yB - hIn, maxY: yB + out + 0.3 };
  const N = layout.nodes.length;
  const inside = new Uint8Array(N);
  const tol = 0.6;
  for (const m of layout.nodes) {
    const inBox = (p: number) => m.cx >= box.minX - p && m.cx <= box.maxX + p && m.cy >= box.minY - p && m.cy <= box.maxY + p;
    inside[m.id] = inBox(0) ? 2 : inBox(tol) ? 1 : 0;
  }
  const labels: WedgeLabel[] = [];
  // row numbers beside their rows (outside the box on the inner side when the row starts there)
  for (const r of layout.rounds) {
    if (r.first < 0 || r.border) continue;
    const y = r.labelAt.y;
    if (y < box.minY + 0.2 || y > box.maxY) continue;
    const onOuter = right ? r.labelAt.x > (xL + xR) / 2 : r.labelAt.x < (xL + xR) / 2;
    labels.push({ x: onOuter ? r.labelAt.x : right ? box.minX - 0.5 : box.maxX + 0.5, y, text: r.short });
  }
  // border rounds: numbered along the bottom side at the box's inner edge, half-way up each round
  for (const r of layout.rounds) {
    if (r.first < 0 || !r.border) continue;
    labels.push({ x: right ? box.minX - 0.5 : box.maxX + 0.5, y: yB + (r.r0 + r.r) / 2, text: r.short });
  }
  const pad = o.pad ?? 0.5;
  const b: Bounds = { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad };
  for (const l of labels) {
    b.minX = Math.min(b.minX, l.x - 0.6); b.maxX = Math.max(b.maxX, l.x + 0.6);
    b.minY = Math.min(b.minY, l.y - 0.5); b.maxY = Math.max(b.maxY, l.y + 0.5);
  }
  const lay: ChartLayout = { ...layout, bounds: b };
  return { kind: 'corner', order: 4, axis: 0, half: 0, rotate: 0, layout: lay, inside, bounds: b, labels };
}
