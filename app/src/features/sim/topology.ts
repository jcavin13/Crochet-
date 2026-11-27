// Render topology of a spring network: what to draw between which particles, and colours.
// Pure (no three.js) so the SVG fallback and the WebGL scene share it.
import type { Network } from '@/core/sim';
import type { RoundClass } from '@/core/flatness';

export type ColorBy = 'round' | 'strain' | 'flatness';

export interface Segments {
  /** particle indices of the two ends (a → b; for stitches a = anchor, b = the stitch top) */
  a: Int32Array;
  b: Int32Array;
  radius: Float32Array;
  /** round used for colouring */
  round: Int32Array;
  /** spring index between a and b, or -1 */
  spring: Int32Array;
  /** 1 = slack chain yarn (chain-space loop) or turning chain / slip stitch (drawn thinner, muted) */
  light: Uint8Array;
  count: number;
}

export interface Topology {
  nNodes: number;
  nParticles: number;
  nRounds: number;
  /** stitch posts: anchor → top, one per (node, anchor particle) */
  stitches: Segments;
  /** the yarn along the course: node i−1 → i */
  yarn: Segments;
  /** stitch tops */
  nodeRadius: Float32Array;
  nodeRound: Int32Array;
  /** mean course width (scale for markers) */
  wbar: number;
}

function segs(list: { a: number; b: number; r: number; round: number; spring: number; light: number }[]): Segments {
  return {
    a: Int32Array.from(list, (s) => s.a), b: Int32Array.from(list, (s) => s.b),
    radius: Float32Array.from(list, (s) => s.r), round: Int32Array.from(list, (s) => s.round),
    spring: Int32Array.from(list, (s) => s.spring), light: Uint8Array.from(list, (s) => s.light),
    count: list.length,
  };
}

export function buildTopology(net: Network): Topology {
  const g = net.graph;
  const n = net.nNodes;
  const P = net.nParticles;
  const pair = new Map<number, number>();
  for (let s = 0; s < net.m; s++) pair.set(net.I[s] * P + net.J[s], s);
  const springOf = (a: number, b: number) => pair.get(Math.min(a, b) * P + Math.max(a, b)) ?? -1;
  const chsp = new Uint8Array(n);
  for (const sp of g.spaces) if (sp.kind === 'chsp') for (const c of sp.chains) chsp[c] = 1;
  let wsum = 0;
  for (let i = 0; i < n; i++) wsum += net.width[i];
  const wbar = n ? wsum / n : 1;

  const stitches: Parameters<typeof segs>[0] = [];
  for (let i = 0; i < n; i++) {
    const nd = g.nodes[i];
    const thin = nd.type === 'slst' || nd.type === 'ch';
    for (const p of net.anchors[i]) {
      stitches.push({ a: p, b: i, r: (thin ? 0.09 : 0.16) * Math.min(net.width[i], wbar * 1.5), round: nd.round, spring: springOf(i, p), light: thin ? 1 : 0 });
    }
  }
  const yarn: Parameters<typeof segs>[0] = [];
  for (let i = 1; i < n; i++) {
    const nd = g.nodes[i];
    const light = chsp[i] || chsp[i - 1] || nd.role === 'tch' || g.nodes[i - 1].role === 'tch' ? 1 : 0;
    yarn.push({ a: i - 1, b: i, r: (light ? 0.075 : 0.1) * wbar, round: nd.round, spring: springOf(i - 1, i), light });
  }
  const nodeRadius = new Float32Array(n);
  const nodeRound = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const t = g.nodes[i].type;
    nodeRadius[i] = (t === 'ch' || t === 'slst' ? 0.12 : 0.2) * Math.min(net.width[i], wbar * 1.5);
    nodeRound[i] = g.nodes[i].round;
  }
  return { nNodes: n, nParticles: P, nRounds: g.rounds.length, stitches: segs(stitches), yarn: segs(yarn), nodeRadius, nodeRound, wbar };
}

// ---------------------------------------------------------------------------------------------
// colours
// ---------------------------------------------------------------------------------------------
export type RGB = [number, number, number];

export interface Palette {
  roundA: RGB; roundB: RGB; chain: RGB; ink: RGB; muted: RGB;
  flat: RGB; cup: RGB; ruffle: RGB; tension: RGB; compression: RGB; neutral: RGB;
  highlight: RGB; bg: RGB; dark: boolean;
}

export function parseColor(css: string, fallback: RGB = [0.5, 0.5, 0.5]): RGB {
  const s = css.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(s);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return fallback;
}

export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const luminance = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const toCss = (c: RGB) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;

export function readPalette(el: Element = document.documentElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fb: RGB) => parseColor(cs.getPropertyValue(name) || '', fb);
  const bg = v('--surface-2', [0.97, 0.95, 0.9]);
  const dark = luminance(bg) < 0.35;
  const accent = v('--accent', [0.64, 0.25, 0.16]);
  const indigo = v('--indigo', [0.18, 0.31, 0.47]);
  const ink = v('--ink', [0.16, 0.14, 0.11]);
  return {
    roundA: accent,
    roundB: dark ? mix(indigo, [1, 1, 1], 0.25) : indigo,
    chain: mix(ink, bg, 0.35),
    ink,
    muted: v('--ink-3', [0.48, 0.43, 0.37]),
    flat: v('--shape-flat', [0, 0.48, 0.35]),
    cup: v('--shape-cup', [0, 0.4, 0.64]),
    ruffle: v('--shape-ruffle', [0.76, 0.33, 0]),
    tension: v('--shape-ruffle', [0.76, 0.33, 0]),
    compression: v('--shape-cup', [0, 0.4, 0.64]),
    neutral: mix(ink, bg, 0.55),
    highlight: v('--warning', [0.54, 0.35, 0]),
    bg,
    dark,
  };
}

/** Strain mapped to full colour (±): the 95th percentile of |strain| of the shown state, within [1 %, 15 %]. */
export function strainScale(strain?: Float32Array, slack?: Uint8Array): number {
  if (!strain) return 0.1;
  const v: number[] = [];
  for (let s = 0; s < strain.length; s++) {
    const e = strain[s];
    if (!Number.isFinite(e) || (slack?.[s] && e < 0)) continue;
    v.push(Math.abs(e));
  }
  if (!v.length) return 0.1;
  v.sort((a, b) => a - b);
  return Math.min(0.15, Math.max(0.01, v[Math.floor(0.95 * (v.length - 1))]));
}

export interface ColorInputs {
  by: ColorBy;
  palette: Palette;
  /** per spring strain (NaN unknown) */
  strain?: Float32Array;
  /** analytic class per round (for 'flatness') */
  roundClass?: RoundClass[];
  /** full-colour strain (default 0.1) */
  strainScale?: number;
}

export function roundColor(r: number, nRounds: number, p: Palette): RGB {
  const base = r % 2 === 0 ? p.roundA : p.roundB;
  // gentle ramp so neighbouring rounds of the same colour are still distinguishable
  const t = nRounds > 1 ? r / (nRounds - 1) : 0;
  return mix(base, p.dark ? [1, 1, 1] : [1, 0.98, 0.94], 0.28 * t);
}

export function segmentColor(s: Segments, k: number, nRounds: number, c: ColorInputs, yarn: boolean): RGB {
  const p = c.palette;
  if (c.by === 'strain') {
    const q = s.spring[k];
    const e = q >= 0 && c.strain ? c.strain[q] : NaN;
    if (!Number.isFinite(e)) return p.neutral;
    const t = Math.max(-1, Math.min(1, e / (c.strainScale ?? 0.1)));
    return t >= 0 ? mix(p.neutral, p.tension, t) : mix(p.neutral, p.compression, -t);
  }
  let col: RGB;
  if (c.by === 'flatness') {
    const cls = c.roundClass?.[s.round[k]];
    col = cls === 'flat' ? p.flat : cls === 'cup' ? p.cup : cls === 'ruffle' ? p.ruffle : p.muted;
  } else col = roundColor(s.round[k], nRounds, p);
  if (s.light[k]) col = mix(col, p.chain, 0.55);
  else if (yarn) col = mix(col, p.ink, 0.25);
  return col;
}

export function nodeColor(t: Topology, i: number, c: ColorInputs): RGB {
  const p = c.palette;
  if (c.by === 'strain') return p.neutral;
  if (c.by === 'flatness') {
    const cls = c.roundClass?.[t.nodeRound[i]];
    return cls === 'flat' ? p.flat : cls === 'cup' ? p.cup : cls === 'ruffle' ? p.ruffle : p.muted;
  }
  return mix(roundColor(t.nodeRound[i], t.nRounds, p), p.ink, 0.12);
}

// ---------------------------------------------------------------------------------------------
// orientation: rotate the piece so that its axis points up (+Y), centred
// ---------------------------------------------------------------------------------------------
/** Row-major 3×3 rotation taking unit vector `axis` to +Y (shortest arc). */
export function rotationToY(axis: [number, number, number]): number[] {
  const [x, y, z] = axis;
  const n = Math.hypot(x, y, z) || 1;
  const a = [x / n, y / n, z / n];
  const b = [0, 1, 0];
  const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const c = a[1];
  if (c < -0.999999) return [1, 0, 0, 0, -1, 0, 0, 0, -1];
  const k = 1 / (1 + c);
  return [
    v[0] * v[0] * k + c, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1],
    v[1] * v[0] * k + v[2], v[1] * v[1] * k + c, v[1] * v[2] * k - v[0],
    v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], v[2] * v[2] * k + c,
  ];
}

/** Bounding sphere (centre, radius) of the finite points of a flat [3n] array after rotation R. */
export function boundsOf(pos: ArrayLike<number>, count: number, R: number[]): { c: [number, number, number]; r: number } | null {
  let k = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    if (!Number.isFinite(x)) continue;
    const X = R[0] * x + R[1] * y + R[2] * z, Y = R[3] * x + R[4] * y + R[5] * z, Z = R[6] * x + R[7] * y + R[8] * z;
    k++;
    if (X < lo[0]) lo[0] = X; if (Y < lo[1]) lo[1] = Y; if (Z < lo[2]) lo[2] = Z;
    if (X > hi[0]) hi[0] = X; if (Y > hi[1]) hi[1] = Y; if (Z > hi[2]) hi[2] = Z;
  }
  if (!k) return null;
  const c: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  let r = 0;
  for (let i = 0; i < count; i++) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    if (!Number.isFinite(x)) continue;
    const X = R[0] * x + R[1] * y + R[2] * z, Y = R[3] * x + R[4] * y + R[5] * z, Z = R[6] * x + R[7] * y + R[8] * z;
    r = Math.max(r, Math.hypot(X - c[0], Y - c[1], Z - c[2]));
  }
  return { c, r: Math.max(r, 1e-3) };
}
