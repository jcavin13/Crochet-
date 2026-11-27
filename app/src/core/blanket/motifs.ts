/**
 * Motif blankets — planning only. A grid of N × M squares or hexagons, each one compiled from an
 * in-the-round style; colourways assigned to the cells (random, checkerboard, diagonal,
 * gradient); totals per colourway, finished size with the joins, and yarn per colour = per-motif
 * yarn × count. Joining is described in words: notation v0.1 cannot join motifs (notation.md 5),
 * so the joins are not part of any stitch graph.
 */
import { stitchParam, type ParamSet } from '../params';
import { prng } from '../generate/random';
import { addKeys } from './engine';
import { buildRounds, type RoundStyleId } from './round';
import type { Line } from './rect';

export type MotifShape = 'square' | 'hexagon';
export type MotifLayout = 'random' | 'checkerboard' | 'diagonal' | 'gradient';
export type MotifJoin = 'whip' | 'sc' | 'jaygo';

export interface MotifSpec {
  style: Extract<RoundStyleId, 'granny-square' | 'solid-square' | 'mitred-square' | 'hexagon'>;
  /** rounds per motif */
  rounds: number;
  cols: number;
  rows: number;
  join: MotifJoin;
  layout: MotifLayout;
  /** number of colourways */
  colorways: number;
  seed: number;
}

export const MOTIF_LAYOUTS: { id: MotifLayout; name: string }[] = [
  { id: 'random', name: 'Random (seeded)' }, { id: 'checkerboard', name: 'Checkerboard' }, { id: 'diagonal', name: 'Diagonal' }, { id: 'gradient', name: 'Gradient' },
];

export const MOTIF_JOINS: { id: MotifJoin; name: string; text: string }[] = [
  { id: 'whip', name: 'Whip stitch', text: 'Place two motifs right sides together and whip stitch through the back loops of the edge stitches with a tapestry needle, corner to corner. Flat, almost invisible seams.' },
  { id: 'sc', name: 'Single crochet join', text: 'Hold two motifs wrong sides together and work sc through both edges, matching stitch for stitch (1 sc in each corner ch of each). Makes a raised ridge on the right side — a feature in a contrasting colour.' },
  { id: 'jaygo', name: 'Join as you go', text: 'Work the last round of each new motif normally until a joining point, then replace the middle chain of a corner or side space by a sl st into the matching space of the finished neighbour. No sewing afterwards. (Described in words only: the notation cannot express working into another motif yet.)' },
];

export interface Colourway {
  index: number;
  /** colour key of each motif round */
  rounds: string[];
}

export interface MotifPlan {
  /** the motif pattern (lines) and its across size, mm */
  lines: Line[];
  acrossMm: number;
  shape: MotifShape;
  colorways: Colourway[];
  /** colourway index per cell [row][col] */
  grid: number[][];
  /** motifs per colourway */
  totals: number[];
  /** finished size, mm */
  widthMm: number;
  heightMm: number;
  /** total seam length, mm, and the yarn of the joins as stitch counts */
  seamMm: number;
  joinKeys: Record<string, number>;
  joinColor: string;
  /** node counts per colour for the whole blanket (motifs + joins) */
  keysByColor: Record<string, Record<string, number>>;
  /** per motif (by colourway): node counts per colour */
  perMotif: Record<string, number>[];
  notes: string[];
}

/** Colourways from the palette: centre and middle bands from the palette, last round in the joining colour. */
export function makeColourways(k: number, rounds: number, keys: string[]): { colorways: Colourway[]; joinColor: string } {
  const join = keys.length >= 3 ? keys[keys.length - 1] : keys[0];
  const base = keys.length >= 3 ? keys.slice(0, -1) : keys;
  const colorways: Colourway[] = [];
  for (let c = 0; c < Math.max(1, k); c++) {
    const r: string[] = [];
    for (let i = 0; i < rounds; i++) {
      if (i === rounds - 1 && rounds > 1 && keys.length >= 3) r.push(join);
      else r.push(base[(c + Math.floor((i * 2) / Math.max(1, rounds - 1))) % base.length]);
    }
    colorways.push({ index: c, rounds: r });
  }
  return { colorways, joinColor: join };
}

/** Colourway per cell. */
export function layoutGrid(cols: number, rows: number, k: number, layout: MotifLayout, seed: number): number[][] {
  const K = Math.max(1, k);
  const rnd = prng(seed);
  const g: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      let v: number;
      switch (layout) {
        case 'checkerboard': v = (r + c) % Math.min(2, K); break;
        case 'diagonal': v = (r + c) % K; break;
        case 'gradient': v = Math.min(K - 1, Math.floor(((r / Math.max(1, rows - 1) + c / Math.max(1, cols - 1)) / 2) * K)); break;
        default: {
          v = Math.floor(rnd() * K);
          // avoid the same colourway as the left and upper neighbours when there is a choice
          for (let t = 0; t < K && K >= 3 && (v === row[c - 1] || v === g[r - 1]?.[c]); t++) v = (v + 1) % K;
        }
      }
      row.push(v);
    }
    g.push(row);
  }
  return g;
}

export function planMotifs(spec: MotifSpec, P: ParamSet, keys: string[]): MotifPlan {
  const shape: MotifShape = spec.style === 'hexagon' ? 'hexagon' : 'square';
  const R = Math.max(2, Math.round(spec.rounds));
  const built = buildRounds({ style: spec.style, textures: [], corner: 'auto', widthMm: 1e9, heightMm: 1e9, P, color: () => 'A', maxRounds: R });
  const lines = built.lines;
  const across = built.widthMm;
  const { colorways, joinColor } = makeColourways(spec.colorways, lines.length, keys);
  const grid = layoutGrid(spec.cols, spec.rows, colorways.length, spec.layout, spec.seed);
  const totals = colorways.map((cw) => grid.flat().filter((v) => v === cw.index).length);
  const w = stitchParam(P, 'sc').width;
  const joinW = spec.join === 'sc' ? 0.5 * w : 0;
  let widthMm: number, heightMm: number, seamMm: number;
  if (shape === 'square') {
    widthMm = spec.cols * across + (spec.cols - 1) * joinW;
    heightMm = spec.rows * across + (spec.rows - 1) * joinW;
    seamMm = ((spec.cols - 1) * spec.rows + (spec.rows - 1) * spec.cols) * across;
  } else {
    // pointy-top hexagons in offset rows: flat-to-flat across, side = across / √3
    const side = across / Math.sqrt(3);
    widthMm = spec.cols * across + (spec.rows > 1 ? across / 2 : 0) + (spec.cols - 1) * joinW;
    heightMm = 2 * side + (spec.rows - 1) * 1.5 * side + (spec.rows - 1) * joinW;
    seamMm = ((spec.cols - 1) * spec.rows + (spec.rows - 1) * (2 * spec.cols - 1)) * side;
  }
  const seamSts = Math.round(seamMm / w);
  const joinKeys: Record<string, number> = spec.join === 'sc' ? { sc: seamSts } : spec.join === 'whip' ? { 'sl st': seamSts } : { 'sl st': Math.round(seamSts / 4) };
  const perMotif = colorways.map((cw) => {
    const out: Record<string, number> = {};
    lines.forEach((l, i) => {
      const c = cw.rounds[Math.max(0, l.label === 'Foundation' ? 0 : i - (lines[0].label === 'Foundation' ? 1 : 0))] ?? cw.rounds[0];
      for (const [k, v] of Object.entries(l.keys)) out[`${c}|${k}`] = (out[`${c}|${k}`] ?? 0) + v;
    });
    return out;
  });
  const keysByColor: Record<string, Record<string, number>> = {};
  colorways.forEach((cw, i) => {
    for (const [ck, v] of Object.entries(perMotif[i])) {
      const [c, k] = ck.split('|');
      keysByColor[c] = addKeys(keysByColor[c] ?? {}, { [k]: v }, totals[i]);
    }
  });
  keysByColor[joinColor] = addKeys(keysByColor[joinColor] ?? {}, joinKeys);
  const notes = [
    `${spec.cols * spec.rows} motifs of ${lines.length} rounds, ${(across / 10).toFixed(1)} cm across each.`,
    'Joins are described in words only: notation v0.1 cannot express working into another motif, so they are not in any stitch graph; their yarn is an estimate from the seam length.',
  ];
  return {
    lines, acrossMm: across, shape, colorways, grid, totals, widthMm, heightMm, seamMm, joinKeys, joinColor,
    keysByColor, perMotif: perMotif.map((m) => m), notes,
  };
}
