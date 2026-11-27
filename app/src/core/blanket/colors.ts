/**
 * Colour planning: palettes and stripe / round planners. Notation v0.1 has no colour changes
 * (notation.md 5), so a colour plan is designer data kept beside the pattern: a colour key per
 * row or round, written into the pattern as a `colors:` header and `# Rows 13-18: colour B`
 * comments, and handed to the yarn estimator per colour.
 */
import { prng } from '../generate/random';

export interface PaletteColor {
  /** key used in the plan: 'A', 'B', … */
  key: string;
  name: string;
  /** CSS colour, #rrggbb */
  hex: string;
}

export const PALETTES: { id: string; name: string; colors: Omit<PaletteColor, 'key'>[] }[] = [
  { id: 'oat', name: 'Oatmeal & sage', colors: [{ name: 'Oatmeal', hex: '#e9dfcc' }, { name: 'Sage', hex: '#a3b18a' }, { name: 'Moss', hex: '#588157' }, { name: 'Clay', hex: '#c97b5a' }, { name: 'Walnut', hex: '#6b4f3a' }] },
  { id: 'sea', name: 'Sea glass', colors: [{ name: 'Foam', hex: '#e6f2ef' }, { name: 'Sea glass', hex: '#9fd3c7' }, { name: 'Teal', hex: '#3d8f8a' }, { name: 'Petrol', hex: '#1f5f6b' }, { name: 'Navy', hex: '#1d2e4a' }] },
  { id: 'sunset', name: 'Sunset', colors: [{ name: 'Butter', hex: '#f6d98b' }, { name: 'Apricot', hex: '#f3a96b' }, { name: 'Coral', hex: '#e76f51' }, { name: 'Berry', hex: '#a23e6b' }, { name: 'Plum', hex: '#5b2a4f' }] },
  { id: 'rainbow', name: 'Rainbow', colors: [{ name: 'Red', hex: '#d64545' }, { name: 'Orange', hex: '#ef8f3a' }, { name: 'Yellow', hex: '#f2cf4a' }, { name: 'Green', hex: '#5aa65a' }, { name: 'Blue', hex: '#4a7fc1' }, { name: 'Violet', hex: '#7b5ea7' }] },
  { id: 'mono', name: 'Greys', colors: [{ name: 'Cream', hex: '#f4f1ea' }, { name: 'Silver', hex: '#c9c9c4' }, { name: 'Pebble', hex: '#8e8e89' }, { name: 'Charcoal', hex: '#45464a' }] },
  { id: 'nursery', name: 'Nursery', colors: [{ name: 'Milk', hex: '#fbf7f0' }, { name: 'Blush', hex: '#f2c6c2' }, { name: 'Mint', hex: '#bfe3d0' }, { name: 'Sky', hex: '#bcd7ee' }, { name: 'Lemon', hex: '#f7e7a6' }] },
];

export const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function paletteFrom(colors: Omit<PaletteColor, 'key'>[]): PaletteColor[] {
  return colors.slice(0, KEYS.length).map((c, i) => ({ key: KEYS[i], ...c }));
}

export type StripePlan =
  | { kind: 'solid'; color?: string }
  | { kind: 'even'; rows: number; colors?: string[] }
  | { kind: 'fibonacci'; unit: number; colors?: string[] }
  | { kind: 'random'; seed: number; min: number; max: number; colors?: string[] }
  | { kind: 'gradient'; colors?: string[] }
  | { kind: 'custom'; seq: { color: string; rows: number }[] };

export const STRIPE_KINDS: { kind: StripePlan['kind']; name: string; blurb: string }[] = [
  { kind: 'solid', name: 'Solid', blurb: 'One colour throughout.' },
  { kind: 'even', name: 'Even stripes', blurb: 'Stripes of the same height, cycling through the colours.' },
  { kind: 'fibonacci', name: 'Fibonacci', blurb: 'Stripe heights 1, 1, 2, 3, 5, 8 (× a unit), cycling colours.' },
  { kind: 'random', name: 'Random', blurb: 'Seeded random heights and colours, never the same colour twice in a row.' },
  { kind: 'gradient', name: 'Gradient', blurb: 'Fades through the colours in order, with dithered stripes at each change.' },
  { kind: 'custom', name: 'Custom', blurb: 'Your own sequence of colour and rows, repeated.' },
];

const FIB = [1, 1, 2, 3, 5, 8];

/** Colour key per row (or round) 0..n-1. `keys` = palette keys in use, in order. */
export function planStripes(plan: StripePlan, n: number, keys: string[]): string[] {
  const out: string[] = [];
  if (!keys.length) keys = ['A'];
  const use = (cs?: string[]) => {
    const f = (cs ?? []).filter((c) => keys.includes(c));
    return f.length ? f : keys;
  };
  switch (plan.kind) {
    case 'solid':
      for (let i = 0; i < n; i++) out.push(plan.color && keys.includes(plan.color) ? plan.color : keys[0]);
      return out;
    case 'even': {
      const cs = use(plan.colors);
      const h = Math.max(1, Math.round(plan.rows));
      for (let i = 0; i < n; i++) out.push(cs[Math.floor(i / h) % cs.length]);
      return out;
    }
    case 'fibonacci': {
      const cs = use(plan.colors);
      let s = 0;
      while (out.length < n) {
        const h = FIB[s % FIB.length] * Math.max(1, Math.round(plan.unit));
        for (let k = 0; k < h && out.length < n; k++) out.push(cs[s % cs.length]);
        s++;
      }
      return out;
    }
    case 'random': {
      const cs = use(plan.colors);
      const rnd = prng(plan.seed);
      let prev = -1;
      const lo = Math.max(1, Math.min(plan.min, plan.max)), hi = Math.max(lo, plan.max);
      while (out.length < n) {
        let c = Math.floor(rnd() * cs.length);
        if (cs.length > 1 && c === prev) c = (c + 1 + Math.floor(rnd() * (cs.length - 1))) % cs.length;
        prev = c;
        const h = lo + Math.floor(rnd() * (hi - lo + 1));
        for (let k = 0; k < h && out.length < n; k++) out.push(cs[c]);
      }
      return out;
    }
    case 'gradient': {
      const cs = use(plan.colors);
      if (cs.length === 1 || n === 1) return Array.from({ length: n }, () => cs[0]);
      // position along the blanket → between colour i and i+1; dither in 2-row stripes
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * (cs.length - 1);
        const base = Math.min(cs.length - 2, Math.floor(x));
        const frac = x - base;
        const stripe = Math.floor(i / 2);
        const threshold = ((stripe * 0.6180339887) % 1) * 0.8 + 0.1;
        out.push(cs[frac > threshold ? base + 1 : base]);
      }
      return out;
    }
    case 'custom': {
      const seq = plan.seq.filter((x) => x.rows > 0 && keys.includes(x.color));
      if (!seq.length) return Array.from({ length: n }, () => keys[0]);
      let s = 0;
      while (out.length < n) {
        const e = seq[s % seq.length];
        for (let k = 0; k < e.rows && out.length < n; k++) out.push(e.color);
        s++;
      }
      return out;
    }
  }
}

/** Runs of equal colour: [{color, from, to}] (indices into the array, inclusive). */
export function colorRuns(colors: string[]): { color: string; from: number; to: number }[] {
  const out: { color: string; from: number; to: number }[] = [];
  colors.forEach((c, i) => {
    const last = out[out.length - 1];
    if (last && last.color === c) last.to = i;
    else out.push({ color: c, from: i, to: i });
  });
  return out;
}

/** "A Oatmeal #e9dfcc; B Sage #a3b18a" (the colors: header) */
export function colorsHeader(palette: PaletteColor[], used: Set<string>): string {
  return palette.filter((c) => used.has(c.key)).map((c) => `${c.key} ${c.name} ${c.hex}`).join('; ');
}

export const colorName = (palette: PaletteColor[], key: string) => {
  const c = palette.find((p) => p.key === key);
  return c ? `colour ${c.key} (${c.name})` : `colour ${key}`;
};

/** A seeded stripe plan for "surprise me". */
export function surpriseStripes(seed: number, keys: string[]): StripePlan {
  const r = prng(seed * 7919 + 13);
  const kinds: StripePlan['kind'][] = ['even', 'fibonacci', 'random', 'gradient', 'random'];
  const k = kinds[Math.floor(r() * kinds.length)];
  const pick = () => {
    const n = Math.min(keys.length, 2 + Math.floor(r() * Math.max(1, keys.length - 1)));
    const ks = keys.slice();
    for (let i = ks.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ks[i], ks[j]] = [ks[j], ks[i]]; }
    return ks.slice(0, n);
  };
  switch (k) {
    case 'even': return { kind: 'even', rows: 2 + Math.floor(r() * 10), colors: pick() };
    case 'fibonacci': return { kind: 'fibonacci', unit: 1 + Math.floor(r() * 3), colors: pick() };
    case 'gradient': return { kind: 'gradient', colors: pick() };
    default: return { kind: 'random', seed: Math.floor(r() * 1e6), min: 1 + Math.floor(r() * 3), max: 4 + Math.floor(r() * 10), colors: pick() };
  }
}
