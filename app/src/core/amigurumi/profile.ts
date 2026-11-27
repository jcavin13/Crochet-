/**
 * Profile curves for surfaces of revolution: the meridian (r, z) in mm, from the start of the
 * work (magic ring / foundation) to its end. Pure; no DOM.
 *
 * A profile is a list of control points. With `smooth` (default) the curve is a centripetal
 * Catmull–Rom spline through the points; points flagged `corner` (and every point when
 * `smooth: false`) are sharp. At an end point that lies on the axis (r = 0) the spline uses the
 * point's mirror image across the axis as its ghost neighbour, so the curve meets the axis at a
 * right angle — as any smooth surface of revolution must (no cone tip at a pole).
 */

export interface ProfilePoint { r: number; z: number; corner?: boolean }
export interface Profile { points: ProfilePoint[]; smooth?: boolean }

export interface SamplePoint { r: number; z: number; s: number }
export interface SampledProfile {
  pts: SamplePoint[];
  length: number;
  /** Arc length of every sharp point (corner flag or polyline vertex) with its turning angle (rad). */
  corners: { s: number; angle: number; index: number }[];
}

type P = { r: number; z: number };
const dist = (a: P, b: P) => Math.hypot(a.r - b.r, a.z - b.z);
const AXIS_EPS = 1e-6;

/** Centripetal Catmull–Rom (Barry–Goldman), alpha = 0.5, between p1 and p2. */
function catmullRom(p0: P, p1: P, p2: P, p3: P, n: number): P[] {
  const tj = (ti: number, a: P, b: P) => ti + Math.max(1e-9, Math.sqrt(dist(a, b)));
  const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
  const lerp = (a: P, b: P, ta: number, tb: number, t: number): P => {
    const u = (t - ta) / (tb - ta);
    return { r: a.r + (b.r - a.r) * u, z: a.z + (b.z - a.z) * u };
  };
  const out: P[] = [];
  for (let i = 1; i <= n; i++) {
    const t = t1 + ((t2 - t1) * i) / n;
    const a1 = lerp(p0, p1, t0, t1, t), a2 = lerp(p1, p2, t1, t2, t), a3 = lerp(p2, p3, t2, t3, t);
    const b1 = lerp(a1, a2, t0, t2, t), b2 = lerp(a2, a3, t1, t3, t);
    out.push(lerp(b1, b2, t1, t2, t));
  }
  return out;
}

/** Dense polyline of the profile with cumulative arc length. */
export function sampleProfile(profile: Profile, perSpan = 40): SampledProfile {
  const raw = profile.points.filter((p, i, a) => i === 0 || dist(p, a[i - 1]) > 1e-9);
  if (raw.length === 0) return { pts: [{ r: 0, z: 0, s: 0 }], length: 0, corners: [] };
  const smooth = profile.smooth !== false;
  const last = raw.length - 1;
  const sharp = (i: number) => i === 0 || i === last || !smooth || !!raw[i].corner;
  const out: P[] = [{ r: raw[0].r, z: raw[0].z }];
  const sharpIdx: number[] = []; // indices into `out` of interior sharp points
  for (let i = 0; i < last; i++) {
    const p1 = raw[i], p2 = raw[i + 1];
    if (!smooth || (sharp(i) && sharp(i + 1) && (i === 0 ? true : true) && false)) {
      out.push({ r: p2.r, z: p2.z });
    } else {
      const ghost = (end: P, nb: P | undefined, profileEnd: boolean): P => {
        if (!nb) return end;
        if (profileEnd && end.r <= AXIS_EPS) return { r: -nb.r, z: nb.z }; // mirror across the axis
        return { r: 2 * end.r - nb.r, z: 2 * end.z - nb.z };                 // linear extrapolation
      };
      const p0 = sharp(i) ? ghost(p1, p2, i === 0) : raw[i - 1];
      const p3 = sharp(i + 1) ? ghost(p2, p1, i + 1 === last) : raw[i + 2];
      out.push(...catmullRom(p0, p1, p2, p3, perSpan));
    }
    if (i + 1 < last && sharp(i + 1)) sharpIdx.push(out.length - 1);
  }
  const pts: SamplePoint[] = [];
  let s = 0;
  for (let i = 0; i < out.length; i++) {
    if (i > 0) s += dist(out[i], out[i - 1]);
    pts.push({ r: Math.max(0, out[i].r), z: out[i].z, s });
  }
  const corners = sharpIdx.map((k) => {
    const a = out[Math.max(0, k - 1)], b = out[k], c = out[Math.min(out.length - 1, k + 1)];
    const a1 = Math.atan2(b.z - a.z, b.r - a.r), a2 = Math.atan2(c.z - b.z, c.r - b.r);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return { s: pts[k].s, angle: d, index: k };
  });
  return { pts, length: s, corners };
}

/** Point (and unit tangent) at arc length s, clamped to [0, length]. */
export function pointAt(sp: SampledProfile, s: number): { r: number; z: number; tr: number; tz: number } {
  const pts = sp.pts;
  if (pts.length === 1) return { r: pts[0].r, z: pts[0].z, tr: 1, tz: 0 };
  const x = Math.min(Math.max(s, 0), sp.length);
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].s <= x) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[hi];
  const L = b.s - a.s || 1;
  const u = (x - a.s) / L;
  return { r: a.r + (b.r - a.r) * u, z: a.z + (b.z - a.z) * u, tr: (b.r - a.r) / L, tz: (b.z - a.z) / L };
}

/** Shortest distance from a point to the sampled polyline. */
export function distanceToProfile(sp: SampledProfile, p: P): number {
  let best = Infinity;
  const pts = sp.pts;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dr = b.r - a.r, dz = b.z - a.z;
    const L2 = dr * dr + dz * dz;
    const u = L2 > 0 ? Math.min(1, Math.max(0, ((p.r - a.r) * dr + (p.z - a.z) * dz) / L2)) : 0;
    best = Math.min(best, Math.hypot(p.r - (a.r + u * dr), p.z - (a.z + u * dz)));
  }
  return pts.length === 1 ? dist(p, pts[0]) : best;
}

export function profileBounds(points: P[]): { rMax: number; zMin: number; zMax: number } {
  let rMax = 0, zMin = Infinity, zMax = -Infinity;
  for (const p of points) { rMax = Math.max(rMax, p.r); zMin = Math.min(zMin, p.z); zMax = Math.max(zMax, p.z); }
  if (!points.length) zMin = zMax = 0;
  return { rMax, zMin, zMax };
}

/** Scale uniformly about the origin so that the overall height (z extent) becomes `height` mm. */
export function scaleProfile(profile: Profile, height: number): Profile {
  const b = profileBounds(profile.points);
  const ext = b.zMax - b.zMin || Math.max(b.rMax, 1);
  const k = height / ext;
  return { ...profile, points: profile.points.map((p) => ({ ...p, r: p.r * k, z: (p.z - b.zMin) * k })) };
}

/* ------------------------------------------------------------------ presets */

export interface ProfilePreset {
  id: string;
  label: string;
  description: string;
  /** Default overall height in mm (the profile is scaled to it). */
  height: number;
  profile: Profile;
}

const semicircle = (R: number, steps = 6): ProfilePoint[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = (Math.PI * i) / steps;
    return { r: +(R * Math.sin(t)).toFixed(4), z: +(R * (1 - Math.cos(t))).toFixed(4) };
  });

/** Presets as data. Coordinates are in mm at a nominal size; `scaleProfile` sets the height. */
export const PRESETS: ProfilePreset[] = [
  {
    id: 'sphere', label: 'Sphere', height: 62,
    description: 'A ball. At 6.2 cm in worsted sc it is the size of the textbook 6-12-18-24-30 ball.',
    profile: { points: semicircle(31) },
  },
  {
    id: 'egg', label: 'Egg', height: 80,
    description: 'Broad end first (bottom), narrower top.',
    profile: { points: [{ r: 0, z: 0 }, { r: 22, z: 6 }, { r: 30, z: 26 }, { r: 26, z: 54 }, { r: 15, z: 73 }, { r: 0, z: 80 }] },
  },
  {
    id: 'cone', label: 'Cone', height: 100,
    description: 'From the tip down to an open base (a gnome hat, a carrot). Like the sc cone fixture.',
    profile: { points: [{ r: 0, z: 100 }, { r: 30, z: 0 }], smooth: false },
  },
  {
    id: 'cylinder', label: 'Cylinder with flat base', height: 80,
    description: 'Flat disc base, a crisp corner (back loops only), straight walls, open top: a pot or a leg.',
    profile: { points: [{ r: 0, z: 0 }, { r: 30, z: 0, corner: true }, { r: 30, z: 80 }], smooth: false },
  },
  {
    id: 'bowl', label: 'Bowl', height: 50,
    description: 'Small flat foot, rounded sides flaring to an open rim.',
    profile: { points: [{ r: 0, z: 0 }, { r: 25, z: 0, corner: true }, { r: 44, z: 12 }, { r: 55, z: 32 }, { r: 60, z: 50 }] },
  },
  {
    id: 'bead', label: 'Bead', height: 24,
    description: 'A flattened ball (oblate), closed at both ends.',
    profile: { points: [{ r: 0, z: 0 }, { r: 14, z: 1.8 }, { r: 20, z: 7 }, { r: 21.5, z: 12 }, { r: 20, z: 17 }, { r: 14, z: 22.2 }, { r: 0, z: 24 }] },
  },
  {
    id: 'pear', label: 'Pear / body', height: 90,
    description: 'Wide round bottom, narrower top: a pear, or an amigurumi body.',
    profile: { points: [{ r: 0, z: 0 }, { r: 26, z: 5 }, { r: 34, z: 25 }, { r: 26, z: 52 }, { r: 17, z: 72 }, { r: 12, z: 85 }, { r: 0, z: 90 }] },
  },
  {
    id: 'mushroom', label: 'Mushroom cap', height: 40,
    description: 'Dome from the top, a rim, then the underside turns back inward (re-entrant) to an open stalk hole.',
    profile: { points: [{ r: 0, z: 40 }, { r: 26, z: 35 }, { r: 42, z: 20 }, { r: 46, z: 8, corner: true }, { r: 30, z: 9 }, { r: 12, z: 10 }] },
  },
  {
    id: 'headbody', label: 'Amigurumi head + body', height: 140,
    description: 'One piece from the bottom of the body, through the neck, to the top of the head.',
    profile: {
      points: [
        { r: 0, z: 0 }, { r: 26, z: 4 }, { r: 32, z: 26 }, { r: 25, z: 50 }, { r: 15, z: 62 },
        { r: 30, z: 78 }, { r: 38, z: 102 }, { r: 30, z: 128 }, { r: 0, z: 140 },
      ],
    },
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);
/** The preset's profile at the given height (mm; default: the preset's own). */
export function presetProfile(id: string, height?: number): Profile {
  const p = presetById(id) ?? PRESETS[0];
  return scaleProfile(p.profile, height ?? p.height);
}
