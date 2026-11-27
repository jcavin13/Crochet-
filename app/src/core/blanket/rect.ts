/**
 * Rectangle blankets: a body worked in rows plus a border worked in rounds around it.
 *
 * Sizing: the border's width is taken off the target first, so the FINISHED size hits it; the
 * body's column count is the nearest value of the stitch pattern's multiple.
 */
import { type ParamSet } from '../params';
import { addKeys, RoundSim, type Make, type RoundResult, type Tok } from './engine';
import { chooseCorner, cornersOf, workLayers, type BorderLayer } from './borders';
import { edgeFit, fitRowEnds, polygonCheck, ruleText, scWidth, spreadRowEnds, type EdgeFit, type PolygonInput, type PolygonRound, type RowEndRule } from './checks';
import type { BodyRows, RowDef, StitchPattern } from './stitches';

export interface BorderSpec {
  /** work a border at all (the edge round plus the layers) */
  enabled: boolean;
  /** sc per row end on the sides of the edge round */
  rowEnds: 'auto' | RowEndRule;
  /** corner of the edge round */
  edgeCorner: 'sc3' | 'ch2';
  edgeColor?: string;
  layers: BorderLayer[];
}

/** One line of the pattern (foundation, a row or a round), with its yarn and colour. */
export interface Line {
  label: 'Foundation' | 'Row' | 'Rnd';
  n: number;
  text: string;
  count: string;
  keys: Record<string, number>;
  color: string;
  section: 'body' | 'border' | 'rounds' | 'edge';
  /** e.g. "set-up round: evens the side counts for the shells" */
  note?: string;
  /** height of the row/round, mm */
  height: number;
}

export interface RectBuild {
  W: number;
  N: number;
  colW: number;
  rowH: number;
  lines: Line[];
  /** border rounds (also in lines), with their engine results */
  borderRounds: { kind: string; result: RoundResult; corner: Make[]; setup?: boolean; color: string }[];
  edges: EdgeFit[];
  polygon: PolygonRound[];
  /** border width on each side, mm */
  borderMm: number;
  /** the row-end rule used on the sides */
  rowEnds: RowEndRule;
}

/** Corner groups of the edge round. */
const EDGE_CORNERS: Record<BorderSpec['edgeCorner'], Make[]> = {
  sc3: [{ st: 'sc', n: 3 }],
  ch2: [{ st: 'sc' }, { ch: 2 }, { st: 'sc' }],
};

/** The perimeter list a border's first round works into (notation.md 3.9). */
export function perimeterToks(lastRow: RowDef, W: number, N: number, colW: number, rowH: number): Tok[] {
  const top = lastRow.toks.slice().reverse().map((t) => ({ ...t }));
  top[0].corner = true;
  top[top.length - 1].corner = true;
  const side = (): Tok[] => Array.from({ length: N }, () => ({ k: 're' as const, w: rowH }));
  const bottom: Tok[] = Array.from({ length: W }, () => ({ k: 'base' as const, w: colW }));
  bottom[0].corner = true;
  bottom[W - 1].corner = true;
  return [...top, ...side(), ...bottom, ...side()];
}

/** The body's rows: Row 1 and the period, as lines. */
export function bodyLines(body: BodyRows, N: number, rowColors: string[], rowH: number): Line[] {
  const lines: Line[] = [{ label: 'Foundation', n: 0, text: `ch ${body.chains}`, count: '', keys: { ch: body.chains - body.skip, 'turning ch': body.skip }, color: rowColors[0], section: 'body', height: 0 }];
  for (let r = 1; r <= N; r++) {
    const def = r === 1 ? body.row1 : body.period[(r - 2) % body.period.length];
    lines.push({ label: 'Row', n: r, text: def.text, count: def.count, keys: def.keys, color: rowColors[r - 1], section: 'body', height: rowH });
  }
  return lines;
}

/** The edge round: around the body, sc per row end fitted to the sides. */
export function edgeRound(list: Tok[], N: number, rule: RowEndRule, corner: Make[], P: ParamSet): RoundResult {
  const sim = new RoundSim(list, P, true);
  sim.turning('sc');
  const counts = spreadRowEnds(N, rule);
  const sideOps = (cs: number[]) => {
    if (cs.every((c) => c === cs[0]) && cs[0] > 0) sim.across('re', [{ st: 'sc', n: cs[0] }]);
    else for (const c of cs) {
      if (c === 0) sim.skip('re');
      else sim.into('re', [{ st: 'sc', n: c }]);
    }
  };
  const topMid = list.slice(1, cornersOf(list)[1]);
  sim.corner(corner);
  if (topMid.every((t) => t.k === 'st')) sim.across('st', [{ st: 'sc' }]);
  else for (const t of topMid) sim.into(t.k === 'sp' ? { sp: t.n! } : 'st', [{ st: 'sc', n: t.k === 'sp' ? t.n : 1 }]);
  sim.corner(corner);
  sideOps(counts);
  sim.corner(corner);
  sim.across('base', [{ st: 'sc' }]);
  sim.corner(corner);
  sideOps(counts.slice().reverse());
  sim.join();
  return sim.finish();
}

export interface RectInput {
  pattern: StitchPattern;
  W: number;
  N: number;
  colW: number;
  rowH: number;
  P: ParamSet;
  border: BorderSpec;
  rowColors: string[];
  /** colour of the edge round and of each layer (defaults: the last row's colour) */
}

/** Build body + border for given column and row counts. */
export function buildRect(i: RectInput): RectBuild {
  const { pattern, W, N, colW, rowH, P, border } = i;
  const body = pattern.rows(W, colW);
  const lines = bodyLines(body, N, i.rowColors, rowH);
  const out: RectBuild = { W, N, colW, rowH, lines, borderRounds: [], edges: [], polygon: [], borderMm: 0, rowEnds: { num: 1, den: 1 } };
  if (!border.enabled) return out;
  const w = scWidth(P);
  const last = N === 1 ? body.row1 : body.period[(N - 2) % body.period.length];
  const list = perimeterToks(last, W, N, colW, rowH);
  const fit = fitRowEnds(rowH, w);
  const rule = border.rowEnds === 'auto' ? fit : border.rowEnds;
  out.rowEnds = rule;
  // the edge round's corner group: by the polygon rule, in the chosen style (solid "3 sc" / chain "(sc, ch 1, sc)")
  const corner = chooseCorner(list, 'sc', border.edgeCorner === 'ch2' ? 'chain' : 'solid', P, 0, 4, EDGE_CORNERS[border.edgeCorner]);
  const r1 = edgeRound(list, N, rule, corner, P);
  const lastColor = i.rowColors[N - 1] ?? 'A';
  let rnd = 1;
  const edgeColor = border.edgeColor ?? lastColor;
  lines.push({ label: 'Rnd', n: rnd, text: r1.text, count: r1.count, keys: r1.keys, color: edgeColor, section: 'border', height: P.stitches.sc.height, note: 'edge round: evens the edge' });
  out.borderRounds.push({ kind: 'edge', result: r1, corner, color: edgeColor });
  // edge fit, per side (corner columns counted once)
  const topPlaced = W;
  const sidePlaced = spreadRowEnds(N, rule).reduce((a, b) => a + b, 0);
  const fix = (r: RowEndRule) => (r.num === fit.num && r.den === fit.den ? undefined : ruleText(fit));
  out.edges.push(edgeFit('Top edge', topPlaced, W * colW, w, '1 sc per stitch'));
  out.edges.push(edgeFit('Left side', sidePlaced, N * rowH, w, ruleText(rule), fix(rule)));
  out.edges.push(edgeFit('Bottom edge', W, W * colW, w, '1 sc per foundation chain'));
  out.edges.push(edgeFit('Right side', sidePlaced, N * rowH, w, ruleText(rule), fix(rule)));
  // border layers: the polygon rule from the edge round on (the edge round's own sides are judged by the edge fit)
  const { rounds, checks } = workLayers(r1.next, border.layers, P, true, 4, r1.cornerGrowth - r1.corners * 2 * r1.height);
  let mm = r1.height;
  const poly: PolygonInput[] = [{ label: `Rnd ${rnd}`, cornerGrowth: r1.cornerGrowth, corners: r1.corners, height: r1.height }];
  rounds.forEach((lr, k) => {
    rnd++;
    const layer = border.layers[lr.layer];
    const color = layer.color ?? edgeColor;
    lines.push({ label: 'Rnd', n: rnd, text: lr.result.text, count: lr.result.count, keys: lr.result.keys, color, section: 'border', height: lr.result.height, note: lr.note });
    out.borderRounds.push({ kind: lr.kind, result: lr.result, corner: lr.corner, setup: lr.kind === 'setup', color });
    poly.push({ ...checks[k], label: `Rnd ${rnd}` });
    mm += lr.result.height;
  });
  out.borderMm = mm;
  out.polygon = polygonCheck(4, poly, w);
  return out;
}

/** Total node counts by key of some lines. */
export const keysOf = (lines: Line[]) => lines.reduce((a, l) => addKeys(a, l.keys), {} as Record<string, number>);
