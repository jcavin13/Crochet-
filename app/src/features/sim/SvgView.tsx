// 2D fallback when WebGL is unavailable: an orthographic projection of the simulated positions
// (same orientation as the 3D view: axis up, seen from 38° above), drawn back to front.
import { useMemo } from 'react';
import { boundsOf, nodeColor, segmentColor, toCss, type ColorInputs, type Topology } from './topology';

export interface SvgViewProps {
  topology: Topology;
  positions: Float32Array | null;
  rotation: number[];
  colors: ColorInputs;
  highlightNode?: number;
  /** extra rotation about the vertical axis (radians), e.g. from a drag */
  yaw?: number;
  /** elevation of the view above the piece's plane, degrees */
  elevation?: number;
}

export function SvgView({ topology: t, positions, rotation: R, colors, highlightNode, yaw = 0.35, elevation = 35 }: SvgViewProps) {
  const drawing = useMemo(() => {
    if (!positions) return null;
    const b = boundsOf(positions, t.nParticles, R);
    if (!b) return null;
    const elev = (elevation * Math.PI) / 180;
    const ce = Math.cos(elev), se = Math.sin(elev), cy = Math.cos(yaw), sy = Math.sin(yaw);
    // screen coords: x right, y down; depth: larger = nearer
    const proj = (p: number): [number, number, number] | null => {
      const x0 = positions[3 * p], y0 = positions[3 * p + 1], z0 = positions[3 * p + 2];
      if (!Number.isFinite(x0)) return null;
      let X = R[0] * x0 + R[1] * y0 + R[2] * z0 - b.c[0];
      const Y = R[3] * x0 + R[4] * y0 + R[5] * z0 - b.c[1];
      let Z = R[6] * x0 + R[7] * y0 + R[8] * z0 - b.c[2];
      [X, Z] = [cy * X + sy * Z, -sy * X + cy * Z];
      return [X, -(Y * ce - Z * se), Y * se + Z * ce];
    };
    const P: ([number, number, number] | null)[] = [];
    for (let p = 0; p < t.nParticles; p++) P.push(proj(p));
    type L = { d: number; x1: number; y1: number; x2: number; y2: number; w: number; c: string };
    const lines: L[] = [];
    const add = (s: typeof t.stitches, yarn: boolean, wscale: number) => {
      for (let k = 0; k < s.count; k++) {
        const A = P[s.a[k]], B = P[s.b[k]];
        if (!A || !B) continue;
        lines.push({ d: (A[2] + B[2]) / 2, x1: A[0], y1: A[1], x2: B[0], y2: B[1], w: s.radius[k] * wscale, c: toCss(segmentColor(s, k, t.nRounds, colors, yarn)) });
      }
    };
    add(t.stitches, false, 2);
    add(t.yarn, true, 2);
    lines.sort((a, c) => a.d - c.d);
    const dots: { d: number; x: number; y: number; r: number; c: string }[] = [];
    for (let i = 0; i < t.nNodes; i++) {
      const A = P[i];
      if (A) dots.push({ d: A[2], x: A[0], y: A[1], r: t.nodeRadius[i], c: toCss(nodeColor(t, i, colors)) });
    }
    const hl = highlightNode !== undefined ? P[highlightNode] ?? null : null;
    return { lines, dots, r: b.r, hl };
  }, [positions, t, R, colors, highlightNode, yaw, elevation]);

  if (!drawing) return <div className="sim-svg sim-svg--empty" />;
  const pad = drawing.r * 1.08;
  return (
    <svg className="sim-svg" viewBox={`${-pad} ${-pad} ${2 * pad} ${2 * pad}`} role="img" aria-label="Flat projection of the simulated piece" preserveAspectRatio="xMidYMid meet">
      {drawing.lines.map((l, k) => (
        <line key={k} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.c} strokeWidth={l.w} strokeLinecap="round" />
      ))}
      {drawing.dots.map((d, k) => <circle key={`n${k}`} cx={d.x} cy={d.y} r={d.r} fill={d.c} />)}
      {drawing.hl && <circle cx={drawing.hl[0]} cy={drawing.hl[1]} r={t.wbar * 0.6} fill="none" stroke={toCss(colors.palette.highlight)} strokeWidth={t.wbar * 0.2} />}
    </svg>
  );
}
