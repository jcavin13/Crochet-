/**
 * How far a chart's symbol marks can grow before they collide (pure). A view draws the marks
 * larger when the chart is shown small (a diagram choice, not physical scale), but never past
 * this: the tight end (a low percentile) of the distances between neighbouring glyph centres,
 * against the spacing the marks are designed for. Slip-stitch dots (drawn beside their chain) are
 * left out: they are small.
 */
import type { ChartLayout } from './types';

/** Spacing between glyph centres the default marks are drawn for (a chain's length, about). */
const DESIGN_GAP = 0.52;

/** Largest mark scale (≥ 1, ≤ `cap`) for the nodes of `layout` (those with `only[id]` > 0 when given). */
export function symbolRoom(layout: ChartLayout, only?: Uint8Array, cap = 1.7): number {
  const pts: { x: number; y: number }[] = [];
  for (const n of layout.nodes) {
    if (only && !only[n.id]) continue;
    if (n.role === 'travel' || n.role === 'ringjoin' || n.role === 'join' || n.kind === 'slst') continue;
    pts.push({ x: n.cx, y: n.cy });
  }
  if (pts.length < 3) return 1;
  const cell = 1;
  const grid = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    const b = grid.get(k); if (b) b.push(i); else grid.set(k, [i]);
  });
  const nn: number[] = [];
  pts.forEach((p, i) => {
    const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
        if (j === i) continue;
        const d = Math.hypot(pts[j].x - p.x, pts[j].y - p.y);
        if (d > 1e-6 && d < best) best = d;
      }
    }
    if (best < Infinity) nn.push(best);
  });
  if (!nn.length) return cap;
  nn.sort((a, b) => a - b);
  // (the tight quarter: a few marks touching is tolerable, most must not)
  const p = nn[Math.floor(nn.length * 0.25)];
  return Math.max(1, Math.min(cap, p / DESIGN_GAP));
}
