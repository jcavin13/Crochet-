/**
 * Blanket size presets. These are conventions, not standards: makers, shops and countries use
 * different numbers (a "throw" is anything from about 100 × 130 to 130 × 180 cm). The values here
 * are common middle-of-the-road figures; the user can always type their own.
 */
export interface BlanketSize {
  id: string;
  name: string;
  /** finished size, cm (width × length) */
  widthCm: number;
  heightCm: number;
  /** the same in inches, as usually quoted */
  widthIn: number;
  heightIn: number;
  note: string;
}

export const BLANKET_SIZES: BlanketSize[] = [
  { id: 'lovey', name: 'Lovey', widthCm: 30, heightCm: 30, widthIn: 12, heightIn: 12, note: 'Security blanket / comforter; often 25–40 cm square.' },
  { id: 'stroller', name: 'Stroller', widthCm: 75, heightCm: 90, widthIn: 30, heightIn: 35, note: 'Pram / car-seat size; small enough not to trail.' },
  { id: 'baby', name: 'Baby / receiving', widthCm: 90, heightCm: 90, widthIn: 36, heightIn: 36, note: 'Receiving blanket; 75–100 cm square is common.' },
  { id: 'crib', name: 'Crib', widthCm: 115, heightCm: 150, widthIn: 45, heightIn: 60, note: 'Cot / crib; sizes vary with the mattress (US crib mattress 71 × 132 cm).' },
  { id: 'lapghan', name: 'Lapghan', widthCm: 90, heightCm: 120, widthIn: 36, heightIn: 48, note: 'Lap blanket for sitting; wheelchair lapghans are often smaller.' },
  { id: 'throw', name: 'Throw', widthCm: 127, heightCm: 152, widthIn: 50, heightIn: 60, note: 'Sofa throw; anywhere from 100 × 130 to 130 × 180 cm.' },
  { id: 'twin', name: 'Twin', widthCm: 165, heightCm: 225, widthIn: 66, heightIn: 90, note: 'Bed blanket for a twin / single bed with some drop.' },
  { id: 'queen', name: 'Full / queen', widthCm: 225, heightCm: 230, widthIn: 90, heightIn: 90, note: 'Full or queen bed with drop over the sides.' },
  { id: 'king', name: 'King', widthCm: 275, heightCm: 230, widthIn: 108, heightIn: 90, note: 'King bed with drop; a very large project (often 60 000+ stitches in worsted).' },
];

export const SIZE_BY_ID: Record<string, BlanketSize> = Object.fromEntries(BLANKET_SIZES.map((s) => [s.id, s]));

export const SIZE_NOTE = 'Blanket sizes are conventions, not standards — they vary by maker, shop and country. Measure the bed, sofa or person it is for.';

export const cmToIn = (cm: number) => cm / 2.54;
export const inToCm = (inch: number) => inch * 2.54;
