// Analytic "3D-ish" preview: the realised profile revolved about the axis and drawn in an oblique
// view as an SVG lathe — one parallel per round (coloured inc/dec/even), a few meridians, and a
// shaded silhouette. No physics: this is the shape the stitch counts ask for.
import { useId } from 'react';
import type { RevolveResult } from '@/core/amigurumi';
import { KIND_COLOR } from './ProfileEditor';

const TILT = (22 * Math.PI) / 180;
const S = Math.sin(TILT), C = Math.cos(TILT);

export function LathePreview({ result, height = 260 }: { result: RevolveResult; height?: number }) {
  const gid = useId().replace(/:/g, '');
  const pts = result.realised;
  const rounds = result.rounds;
  let rMax = 1, zMin = Infinity, zMax = -Infinity;
  for (const p of pts) { rMax = Math.max(rMax, p.r); zMin = Math.min(zMin, p.z); zMax = Math.max(zMax, p.z); }
  const Y = (z: number, r: number, th: number) => -z * C + r * Math.sin(th) * S;
  const pad = rMax * 0.12 + 4;
  const x0 = -rMax - pad, w = 2 * (rMax + pad);
  const y0 = -zMax * C - rMax * S - pad, h = (zMax - zMin) * C + 2 * rMax * S + 2 * pad;
  const sw = Math.max(w, h) / 260;

  const ellipse = (r: number, z: number, front: boolean) => {
    // half ellipse: front = θ ∈ [0, π] (towards the viewer, lower on screen)
    const n = 28, out: string[] = [];
    for (let i = 0; i <= n; i++) {
      const th = (front ? 0 : Math.PI) + (Math.PI * i) / n;
      out.push(`${i ? 'L' : 'M'}${(r * Math.cos(th)).toFixed(2)},${Y(z, r, th).toFixed(2)}`);
    }
    return out.join('');
  };
  // silhouette: the outline of the parallels' extreme points (±r at each height, plus the ellipse bulge at the ends)
  const right = pts.map((p) => `${p.r.toFixed(2)},${(-p.z * C).toFixed(2)}`);
  const left = [...pts].reverse().map((p) => `${(-p.r).toFixed(2)},${(-p.z * C).toFixed(2)}`);
  const meridians = [Math.PI * 0.15, Math.PI * 0.32, Math.PI * 0.5, Math.PI * 0.68, Math.PI * 0.85];
  const first = pts[0], last = pts[pts.length - 1];

  return (
    <svg className="ami-lathe" viewBox={`${x0} ${y0} ${w} ${h}`} style={{ height }} role="img"
      aria-label={`Preview of the revolved shape: ${(result.dims.heightMm / 10).toFixed(1)} cm tall, ${(result.dims.diameterMm / 10).toFixed(1)} cm wide.`}>
      <defs>
        <linearGradient id={`g${gid}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--accent-soft)" stopOpacity="0.35" />
          <stop offset="0.38" stopColor="var(--surface)" stopOpacity="0.95" />
          <stop offset="1" stopColor="var(--accent-soft)" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <polygon points={[...right, ...left].join(' ')} fill={`url(#g${gid})`} />
      {/* open ends show as ellipses */}
      {first.r > 0.5 && <path d={ellipse(first.r, first.z, false) + ellipse(first.r, first.z, true).replace('M', 'L')} fill={`url(#g${gid})`} stroke="var(--ink-3)" strokeWidth={sw} />}
      {last.r > 0.5 && <path d={ellipse(last.r, last.z, false) + ellipse(last.r, last.z, true).replace('M', 'L')} fill="var(--surface-2)" stroke="var(--ink-2)" strokeWidth={sw} />}
      {/* back halves of the parallels */}
      <g opacity="0.28">
        {rounds.map((r) => <path key={`b${r.n}`} d={ellipse(r.realised.r, r.realised.z, false)} fill="none" stroke={KIND_COLOR[r.kind]} strokeWidth={sw * 0.8} />)}
      </g>
      {/* meridians on the front */}
      <g stroke="var(--ink-3)" strokeWidth={sw * 0.6} fill="none" opacity="0.6">
        {meridians.map((th) => (
          <path key={th} d={pts.map((p, i) => `${i ? 'L' : 'M'}${(p.r * Math.cos(th)).toFixed(2)},${Y(p.z, p.r, th).toFixed(2)}`).join('')} />
        ))}
      </g>
      {/* front halves of the parallels */}
      <g>
        {rounds.map((r) => <path key={`f${r.n}`} d={ellipse(r.realised.r, r.realised.z, true)} fill="none" stroke={KIND_COLOR[r.kind]} strokeWidth={sw * 1.3} />)}
      </g>
      <polyline points={right.join(' ')} fill="none" stroke="var(--ink-2)" strokeWidth={sw * 1.2} />
      <polyline points={left.join(' ')} fill="none" stroke="var(--ink-2)" strokeWidth={sw * 1.2} />
    </svg>
  );
}
