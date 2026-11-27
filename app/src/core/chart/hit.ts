/** Pointer hit testing on a chart layout (uniform grid over glyph centres). Pure. */
import { outlineRadius } from './layout';
import type { ChartLayout } from './types';

export interface HitIndex {
  layout: ChartLayout;
  cell: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  buckets: Map<number, number[]>;
}

export function buildHitIndex(layout: ChartLayout, cell = 1): HitIndex {
  const { minX, minY, maxX, maxY } = layout.bounds;
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const rows = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  const buckets = new Map<number, number[]>();
  for (const n of layout.nodes) {
    const cx = Math.floor((n.cx - minX) / cell), cy = Math.floor((n.cy - minY) / cell);
    const key = cy * cols + cx;
    const b = buckets.get(key);
    if (b) b.push(n.id); else buckets.set(key, [n.id]);
  }
  return { layout, cell, minX, minY, cols, rows, buckets };
}

/** Nearest node within `maxDist` chart units of (x, y), considering rounds ≤ upto; −1 if none. */
export function hitTest(ix: HitIndex, x: number, y: number, maxDist = 0.55, upto?: number): number {
  const { cell, minX, minY, cols, rows, buckets, layout } = ix;
  const gx = Math.floor((x - minX) / cell), gy = Math.floor((y - minY) / cell);
  const reach = Math.ceil(maxDist / cell);
  let best = -1, bestD = maxDist * maxDist;
  for (let j = gy - reach; j <= gy + reach; j++) {
    if (j < 0 || j >= rows) continue;
    for (let i = gx - reach; i <= gx + reach; i++) {
      if (i < 0 || i >= cols) continue;
      const b = buckets.get(j * cols + i);
      if (!b) continue;
      for (const id of b) {
        const n = layout.nodes[id];
        if (upto !== undefined && n.round > upto) continue;
        const d = (n.cx - x) ** 2 + (n.cy - y) ** 2;
        if (d < bestD) { bestD = d; best = id; }
      }
    }
  }
  return best;
}

/** Round whose band contains the point (radial: by radius; rows: by height); −1 if outside. */
export function roundAt(layout: ChartLayout, x: number, y: number, upto?: number): number {
  const h = layout.mode === 'radial' ? Math.hypot(x, y) : -y;
  let found = -1;
  for (const r of layout.rounds) {
    if (r.first < 0 || (upto !== undefined && r.index > upto)) continue;
    // a pointed round reaches out to its arms' outline
    const top = r.pointed ? Math.max(r.r, outlineRadius(r, Math.atan2(-y, x))) : r.r;
    if (h >= r.r0 - 1e-9 && h <= top + 1e-9) { found = r.index; break; }
  }
  return found;
}
