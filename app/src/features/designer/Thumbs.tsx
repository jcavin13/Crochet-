// Small schematic drawings for the layer builder and suggestions (not the symbol chart):
//   RoundGlyph — one round's repeat as a wedge: stitches as radial strokes (taller = taller stitch),
//                clusters/puffs as dots, chain loops as arcs bulging outward
//   DoilyThumb — the whole doily from per-round previews; added rounds in the accent colour
import { memo } from 'react';
import type { Entry } from '@/core/generate';

const H: Record<string, number> = { sc: 0.45, hdc: 0.6, dc: 0.85, tr: 1, dtr: 1.1, puff: 0.6, popcorn: 0.8 };

/** Path data of one repeat's entries placed on an annulus from angle a0 to a1. */
function entriesPath(entries: Entry[], a0: number, a1: number, r0: number, r1: number) {
  const n = Math.max(1, entries.length);
  const da = (a1 - a0) / n;
  const pt = (a: number, r: number) => `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
  let strokes = '', loops = '', dots = '';
  entries.forEach((e, i) => {
    const a = a0 + (i + 0.5) * da;
    if (e.kind === 'st') {
      const h = r0 + (r1 - r0) * (H[e.type] ?? 0.7);
      if (e.cluster || e.type === 'puff' || e.type === 'popcorn') {
        const rr = (r0 + h) / 2;
        dots += `M${pt(a, rr)}m-1.4 0a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0`;
      }
      strokes += `M${pt(a, r0)}L${pt(a, h)}`;
    } else {
      const span = da * Math.min(1, 0.6 + e.len * 0.06);
      const bulge = r0 + (r1 - r0) * Math.min(1.25, 0.5 + e.len * 0.1);
      loops += `M${pt(a - span / 2, r0 + (r1 - r0) * 0.15)}Q${pt(a, bulge)} ${pt(a + span / 2, r0 + (r1 - r0) * 0.15)}`;
    }
  });
  return { strokes, loops, dots };
}

/** One round's repeat unit as a wedge, with "×n". */
export const RoundGlyph = memo(function RoundGlyph({ entries, repeats, tone = 'flat', size = 64 }: { entries: Entry[]; repeats: number; tone?: string; size?: number }) {
  // show one repeat over a 100° wedge (wide enough to read), between radii 18 and 44
  const a0 = (-50 * Math.PI) / 180, a1 = (50 * Math.PI) / 180;
  const { strokes, loops, dots } = entriesPath(entries, a0, a1, 22, 44);
  const arc = (r: number) => `M${(r * Math.sin(a0)).toFixed(2)} ${(-r * Math.cos(a0)).toFixed(2)}A${r} ${r} 0 0 1 ${(r * Math.sin(a1)).toFixed(2)} ${(-r * Math.cos(a1)).toFixed(2)}`;
  return (
    <svg className="dz-glyph" data-tone={tone} viewBox="-50 -52 100 52" width={size} height={size * 0.52} aria-hidden="true">
      <path d={arc(22)} className="dz-glyph__base" />
      <path d={strokes} className="dz-glyph__st" />
      <path d={loops} className="dz-glyph__ch" />
      <path d={dots} className="dz-glyph__dot" />
      <text x="46" y="-3" textAnchor="end" className="dz-glyph__n">×{repeats}</text>
    </svg>
  );
});

export interface ThumbRound { entries: Entry[]; reps: number; rho: number; r: number; cls: string; added?: boolean }

/** A whole doily, schematic, from per-round previews. `upto` draws only the first rounds. */
export const DoilyThumb = memo(function DoilyThumb({ rounds, size = 96, upto, label }: { rounds: ThumbRound[]; size?: number; upto?: number; label?: string }) {
  const shown = upto === undefined ? rounds : rounds.slice(0, upto + 1);
  const R = Math.max(1e-6, ...rounds.map((r) => r.r));
  const k = 46 / R;
  let prev = 0;
  const parts = shown.map((rd, i) => {
    const r0 = prev * k, r1 = Math.max(rd.rho, prev + 1e-6) * k;
    prev = rd.r;
    let s = '', l = '', d = '';
    for (let q = 0; q < rd.reps; q++) {
      const a0 = (q * 2 * Math.PI) / rd.reps, a1 = ((q + 1) * 2 * Math.PI) / rd.reps;
      const p = entriesPath(rd.entries, a0, a1, r0, r1);
      s += p.strokes; l += p.loops; d += p.dots;
    }
    const tone = rd.cls !== 'flat' ? 'off' : rd.added ? 'added' : 'base';
    return <g key={i} className="dz-thumb__round" data-tone={tone}><path d={s} className="dz-glyph__st" /><path d={l} className="dz-glyph__ch" /><path d={d} className="dz-glyph__dot" /></g>;
  });
  return (
    <svg className="dz-thumb" viewBox="-50 -50 100 100" width={size} height={size} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {parts}
    </svg>
  );
});
