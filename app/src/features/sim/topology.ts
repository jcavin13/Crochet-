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
  /** per round: 1 = a border round worked round rows (tinted distinctly) */
  border: Uint8Array;
  /** stitch posts: anchor → top, one per (node, anchor particle) */
  stitches: Segments;
  /** the yarn along the course: node i−1 → i */
  yarn: Segments;
  /** stitch tops */
  nodeRadius: Float32Array;
  nodeRound: Int32Array;
  /** mean course width (scale for markers) */
  wbar: number;
  /**
   * Picots, drawn as small closed loops of their chains standing off their base stitch (a picot is
   * one graph node, at the picot's tip; drawing the yarn through it made a picot pair look like a
   * bowtie). `base`: the stitch the picot is made on (the last non-picot node before it).
   */
  picots: { node: Int32Array; base: Int32Array; chains: Uint8Array; round: Int32Array; count: number };
  /** Chain width (picot loop size). */
  wch: number;
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
  const isPicot = (i: number) => g.nodes[i].type === 'picot';
  for (let i = 1; i < n; i++) {
    const nd = g.nodes[i];
    if (isPicot(i)) continue;
    // the yarn runs past picots: from the last node before a run of picots to the node after it
    let a = i - 1;
    while (a > 0 && isPicot(a)) a--;
    if (isPicot(a) || g.nodes[a].round !== nd.round && a !== i - 1) continue;
    const light = chsp[i] || chsp[a] || nd.role === 'tch' || g.nodes[a].role === 'tch' ? 1 : 0;
    yarn.push({ a, b: i, r: (light ? 0.075 : 0.1) * wbar, round: nd.round, spring: springOf(a, i), light });
  }
  const pn: number[] = [], pb: number[] = [], pc: number[] = [], pr: number[] = [];
  for (let i = 1; i < n; i++) {
    if (!isPicot(i)) continue;
    let b = i - 1;
    while (b > 0 && isPicot(b)) b--;
    if (isPicot(b)) continue;
    pn.push(i); pb.push(b); pc.push(Math.max(2, Math.min(12, g.nodes[i].chains ?? 3))); pr.push(g.nodes[i].round);
  }
  const picots = { node: Int32Array.from(pn), base: Int32Array.from(pb), chains: Uint8Array.from(pc), round: Int32Array.from(pr), count: pn.length };
  const wch = net.params.stitches.ch?.width ?? wbar;
  const nodeRadius = new Float32Array(n);
  const nodeRound = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const t = g.nodes[i].type;
    nodeRadius[i] = t === 'picot' ? 0 : (t === 'ch' || t === 'slst' ? 0.12 : 0.2) * Math.min(net.width[i], wbar * 1.5);
    nodeRound[i] = g.nodes[i].round;
  }
  const border = Uint8Array.from(g.rounds.map((_, r) => (net.outline?.roundKind[r] === 'border' ? 1 : 0)));
  return { nNodes: n, nParticles: P, nRounds: g.rounds.length, border, stitches: segs(stitches), yarn: segs(yarn), nodeRadius, nodeRound, wbar, picots, wch };
}

/** Segments per drawn picot loop. */
export const PICOT_SEGS = 12;

/**
 * Picot loops in view space (after rotation R, axis up = +Y): for each picot, PICOT_SEGS + 1 points
 * of a closed teardrop from its base stitch out to the picot's tip, perimeter ≈ chains × w_ch. The
 * loop points from the base to the picot node (a spine picot at its ±50°/±60° layout direction, a
 * blocked picot at its pin); when the picot node sits on its base (an ordinary round), outwards from
 * the piece's centre. It lies in the piece's plane (horizontal in view space). Writes
 * 3·(PICOT_SEGS + 1) numbers per picot into `out` (NaN when not placed).
 */
export function picotLoops(t: Topology, pos: ArrayLike<number>, R: number[], centre: [number, number, number], out: Float32Array): Float32Array {
  const K = PICOT_SEGS + 1;
  const tr = (p: number): [number, number, number] => {
    const x = pos[3 * p], y = pos[3 * p + 1], z = pos[3 * p + 2];
    return [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z];
  };
  for (let k = 0; k < t.picots.count; k++) {
    const o = 3 * K * k;
    const B = tr(t.picots.base[k]), T = tr(t.picots.node[k]);
    if (!Number.isFinite(B[0]) || !Number.isFinite(T[0])) { out.fill(NaN, o, o + 3 * K); continue; }
    const C = t.picots.chains[k] * t.wch;
    let ux = T[0] - B[0], uy = T[1] - B[1], uz = T[2] - B[2];
    let d = Math.hypot(ux, uy, uz);
    if (d < 0.25 * C) { ux = B[0] - centre[0]; uy = 0; uz = B[2] - centre[2]; const m = Math.hypot(ux, uz); if (m > 1e-9) { ux /= m; uz /= m; } else { ux = 1; uz = 0; } d = 0; }
    else { ux /= d; uy /= d; uz /= d; }
    // length: the picot reaches its node when pinned/laid out, else about a third of its perimeter
    const L = d > 0 ? Math.min(d, 0.48 * C) : 0.36 * C;
    const W = Math.max(0.25 * L, (2 * C) / Math.PI - L);
    // side vector: in the horizontal plane, perpendicular to u
    let vx = -uz, vy = 0, vz = ux;
    const vm = Math.hypot(vx, vy, vz);
    if (vm < 1e-6) { vx = 1; vy = 0; vz = 0; } else { vx /= vm; vz /= vm; }
    for (let j = 0; j < K; j++) {
      const th = (2 * Math.PI * j) / PICOT_SEGS;
      const s = (L * (1 - Math.cos(th))) / 2;
      const w = (W / 2) * Math.sin(th) * Math.sqrt((1 - Math.cos(th)) / 2);
      out[o + 3 * j] = B[0] + s * ux + w * vx;
      out[o + 3 * j + 1] = B[1] + s * uy + w * vy;
      out[o + 3 * j + 2] = B[2] + s * uz + w * vz;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// colours
// ---------------------------------------------------------------------------------------------
export type RGB = [number, number, number];

export interface Palette {
  roundA: RGB; roundB: RGB; chain: RGB; ink: RGB; muted: RGB;
  /** border rounds (rounds worked round rows) */
  borderA: RGB; borderB: RGB;
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
    borderA: v('--shape-flat', [0, 0.48, 0.35]),
    borderB: mix(v('--shape-flat', [0, 0.48, 0.35]), dark ? [1, 1, 1] : ink, 0.4),
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
  /** per round: 1 = border round (Topology.border) */
  border?: Uint8Array;
}

export function roundColor(r: number, nRounds: number, p: Palette, border = false): RGB {
  const base = border ? (r % 2 === 0 ? p.borderA : p.borderB) : r % 2 === 0 ? p.roundA : p.roundB;
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
  } else col = roundColor(s.round[k], nRounds, p, c.border?.[s.round[k]] === 1);
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
  return mix(roundColor(t.nodeRound[i], t.nRounds, p, t.border[t.nodeRound[i]] === 1), p.ink, 0.12);
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
