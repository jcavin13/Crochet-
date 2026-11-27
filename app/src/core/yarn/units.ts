/** Unit helpers for yarn amounts: m ↔ yd, g ↔ oz, balls (always rounded up). Pure. */

export type YarnUnits = 'metric' | 'imperial';

export const M_PER_YD = 0.9144;
export const G_PER_OZ = 28.349523125;

export const metersToYards = (m: number) => m / M_PER_YD;
export const yardsToMeters = (yd: number) => yd * M_PER_YD;
export const gramsToOunces = (g: number) => g / G_PER_OZ;
export const ouncesToGrams = (oz: number) => oz * G_PER_OZ;

/** Grams of a yarn with `metersPer100g` that hold `meters`. */
export function metersToGrams(meters: number, metersPer100g: number): number {
  return metersPer100g > 0 ? (meters * 100) / metersPer100g : NaN;
}
export function gramsToMeters(grams: number, metersPer100g: number): number {
  return (grams * metersPer100g) / 100;
}

/** Balls to buy: always rounded up (a hair over a whole number is not rounded up: 1e-9 slack). */
export function ballsNeeded(grams: number, ballGrams: number): { balls: number; exact: number } {
  if (!(ballGrams > 0) || !Number.isFinite(grams)) return { balls: NaN, exact: NaN };
  const exact = Math.max(0, grams) / ballGrams;
  return { balls: Math.max(exact > 0 ? 1 : 0, Math.ceil(exact - 1e-9)), exact };
}

/** "3 balls (2.4)", "1 ball (0.3)". */
export function formatBalls(grams: number, ballGrams: number): string {
  const { balls, exact } = ballsNeeded(grams, ballGrams);
  if (!Number.isFinite(balls)) return '—';
  return `${balls} ball${balls === 1 ? '' : 's'} (${exact < 0.1 && exact > 0 ? '<0.1' : exact.toFixed(1)})`;
}

/** Round to something sensible for a yarn amount: 2 significant figures under 10, else to 5 / 10. */
export function niceRound(x: number): number {
  if (!Number.isFinite(x)) return x;
  const a = Math.abs(x);
  if (a < 10) return Math.round(x * 10) / 10;
  if (a < 100) return Math.round(x);
  if (a < 1000) return Math.round(x / 5) * 5;
  return Math.round(x / 10) * 10;
}

/** "180 m" / "197 yd". */
export function formatLength(meters: number, units: YarnUnits = 'metric'): string {
  if (!Number.isFinite(meters)) return '—';
  return units === 'imperial' ? `${fmtNum(niceRound(metersToYards(meters)))} yd` : `${fmtNum(niceRound(meters))} m`;
}
/** "62 g" / "2.2 oz". */
export function formatMass(grams: number, units: YarnUnits = 'metric'): string {
  if (!Number.isFinite(grams)) return '—';
  if (units === 'imperial') {
    const oz = gramsToOunces(grams);
    return `${oz < 10 ? oz.toFixed(1) : fmtNum(Math.round(oz))} oz`;
  }
  return `${fmtNum(grams < 10 ? Math.round(grams * 10) / 10 : Math.round(grams))} g`;
}
/** "155–210 m". */
export function formatRange(lo: number, hi: number, units: YarnUnits = 'metric'): string {
  const f = (m: number) => fmtNum(niceRound(units === 'imperial' ? metersToYards(m) : m));
  return `${f(lo)}–${f(hi)} ${units === 'imperial' ? 'yd' : 'm'}`;
}

function fmtNum(x: number): string {
  return x >= 10000 ? x.toLocaleString('en-US') : String(x);
}
