/**
 * designBlanket(spec, params) — the whole blanket: written pattern, sizes, counts, colours,
 * checks, and compiled patterns (the full piece when it is under the compiler's node cap, and
 * always a small representative swatch for the chart, the 3D view and validation).
 *
 * Big blankets: a throw is 20–40 k stitches and a king-size one can pass 150 k, beyond the
 * compiler's 50 000-node cap (and far beyond what the chart and 3D view are for). Counts, size
 * and yarn always come from the closed-form simulation (engine.ts), which the tests check
 * against compiled graphs; the full pattern is compiled only when it fits under the cap.
 * Deterministic: the same spec and params give the same result.
 */
import { compilePattern } from '../notation';
import { parse, print } from '../notation';
import { MAX_NODES } from '../graph/compile';
import type { Diagnostic, Pattern } from '../graph/types';
import { paramSetById, paramsFile, stitchParam, type ParamSet } from '../params';
import { nearestCount, paramsFromGauge } from '../amigurumi/gauge';
import { hookLabel } from '../amigurumi/rounds';
import { prng } from '../generate/random';
import { addKeys, stitchTotal } from './engine';
import { BORDER_BY_KIND, BORDER_PRESETS, type BorderKind, type CornerStyle } from './borders';
import { colorName, colorRuns, colorsHeader, paletteFrom, PALETTES, planStripes, surpriseStripes, type PaletteColor, type StripePlan } from './colors';
import { buildRect, keysOf, type BorderSpec, type Line } from './rect';
import { buildRounds, ROUND_STYLE_BY_ID, type RoundStyleId } from './round';
import { planMotifs, type MotifPlan, type MotifSpec } from './motifs';
import { BLANKET_SIZES, SIZE_BY_ID } from './sizes';
import { NOT_EXPRESSIBLE, STITCH_BY_ID, STITCH_PATTERNS } from './stitches';
import { rowRanges, type RowLine } from './write';
import type { EdgeFit, PolygonRound } from './checks';

export type Construction = 'rect' | 'round' | 'motif';

export interface BlanketSpec {
  construction: Construction;
  title?: string;
  terms?: 'US' | 'UK';
  /** finished size, cm; `preset` is the size chip it came from */
  size: { preset?: string; widthCm: number; heightCm: number };
  /** param set id (see blanketParamSets) */
  paramsId: string;
  /** the maker's own gauge: stitches and rows per 10 cm in the body pattern (rect) or main stitch (round) */
  gauge?: { sts: number; rows: number };
  palette: PaletteColor[];
  /** rect: stripes over rows; round: colours over rounds */
  stripes: StripePlan;
  body: { pattern: string };
  border: BorderSpec;
  round: { style: RoundStyleId; textures: BorderKind[]; corner: CornerStyle; lace?: boolean };
  motif: MotifSpec;
  /** stitches per minute for the time estimate */
  spm?: number;
}

export interface BlanketSection {
  kind: 'header' | 'foundation' | 'body' | 'border' | 'rounds' | 'motif' | 'joining';
  title: string;
  text: string;
}

export interface BlanketDesign {
  /** the full written pattern (valid notation, colour comments included) */
  text: string;
  /** compiled full pattern, when it is under the node cap */
  pattern?: Pattern;
  /** the representative swatch: text and compiled pattern */
  swatchText: string;
  swatch?: Pattern;
  swatchNote: string;
  /** graph round index → colour key, for the full pattern and the swatch */
  roundColors: string[];
  swatchRoundColors: string[];
  diagnostics: { full: Diagnostic[]; swatch: Diagnostic[] };
  /** 'full' when the full pattern was compiled; 'swatch' when only the swatch was */
  compiled: 'full' | 'swatch' | 'none';
  size: {
    target: { widthCm: number; heightCm: number };
    achieved: { widthCm: number; heightCm: number };
    body?: { widthCm: number; heightCm: number; columns: number; rows: number };
    borderCm: number;
  };
  counts: {
    /** nodes by yarn key, whole blanket */
    keys: Record<string, number>;
    stitches: number;
    nodes: number;
    rows: number;
    rounds: number;
    /** nodes by yarn key per colour key */
    byColor: Record<string, Record<string, number>>;
    /** stitches per colour (stitch-counting only) */
    stitchesByColor: Record<string, number>;
  };
  /** the lines (one per graph round) */
  lines: Line[];
  sections: BlanketSection[];
  checks: { edges: EdgeFit[]; polygon: PolygonRound[]; notes: string[] };
  warnings: string[];
  /** estimated working time, minutes, at spec.spm */
  timeMin: number;
  motif?: MotifPlan;
  params: ParamSet;
}

/* ------------------------------------------------------------------ param sets */

/** Param sets offered for blankets: the spec sets (not thread) and two derived bulkier ones. */
export function blanketParamSets(): ParamSet[] {
  const base = paramSetById('worsted-4_5.0mm') ?? paramsFile.sets[0];
  const sets = paramsFile.sets.filter((s) => !/thread/.test(s.yarn_weight));
  const derive = (id: string, label: string, weight: string, hook: number, sts: number): ParamSet => {
    const p = paramsFromGauge({ stitches: sts, rows: (sts * base.stitches.sc.width) / base.stitches.sc.height }, 'sc', base, hook);
    return { ...p, id, label, yarn_weight: weight, provenance: `Scaled from ${base.label} to a typical ${sts} sc per 10 cm (estimate; check your gauge).` };
  };
  return [
    ...sets,
    derive('blanket-bulky-5_6.5mm', 'Chunky (CYC 5), 6.5 mm hook — estimated', 'bulky-5', 6.5, 11),
    derive('blanket-superbulky-6_9mm', 'Super bulky (CYC 6), 9 mm hook — estimated', 'superbulky-6', 9, 7.5),
  ];
}

export function blanketParams(id: string): ParamSet {
  return blanketParamSets().find((s) => s.id === id) ?? paramSetById(paramsFile.default_set) ?? paramsFile.sets[0];
}

/* ------------------------------------------------------------------ defaults */

export const DEFAULT_SPEC: BlanketSpec = {
  construction: 'rect',
  size: { preset: 'throw', widthCm: 127, heightCm: 152 },
  paramsId: 'worsted-4_5.0mm',
  palette: paletteFrom(PALETTES[0].colors),
  stripes: { kind: 'even', rows: 12, colors: ['A', 'B', 'A', 'C'] },
  body: { pattern: 'moss' },
  border: { enabled: true, rowEnds: 'auto', edgeCorner: 'sc3', edgeColor: 'E', layers: [{ kind: 'sc', color: 'E' }, { kind: 'shell', color: 'A' }] },
  round: { style: 'granny-square', textures: ['granny'], corner: 'auto' },
  motif: { style: 'granny-square', rounds: 5, cols: 8, rows: 10, join: 'sc', layout: 'random', colorways: 4, seed: 7 },
  spm: 20,
};

/* ------------------------------------------------------------------ writing */

const fmtCm = (mm: number) => +(mm / 10).toFixed(1);

function header(spec: BlanketSpec, P: ParamSet, title: string, notes: string, used: Set<string>): string[] {
  const h = [`title: ${title}`, 'terms: US', `yarn: ${P.yarn_weight}`, `hook: ${hookLabel(P.hook_mm)}`];
  if (paramSetById(P.id)) h.push(`params: ${P.id}`);
  h.push('source: generated (blanket designer)', 'license: CC0-1.0');
  const colors = colorsHeader(spec.palette, used);
  if (colors && used.size > 1) h.push(`colors: ${colors}`);
  h.push(`notes: ${notes}`);
  return h;
}

/** Lines → notation, with section and colour comments; returns text blocks per section. */
function writeLines(lines: Line[], palette: PaletteColor[], fasten = true): { blocks: { section: Line['section'] | 'foundation'; text: string }[] } {
  const blocks: { section: Line['section'] | 'foundation'; text: string }[] = [];
  const multi = new Set(lines.map((l) => l.color)).size > 1;
  let i = 0;
  while (i < lines.length) {
    const sec = lines[i].section;
    let j = i;
    while (j < lines.length && lines[j].section === sec) j++;
    const chunk = lines.slice(i, j);
    const out: string[] = [];
    const found = chunk[0].label === 'Foundation' ? chunk[0] : undefined;
    const rest = found ? chunk.slice(1) : chunk;
    const word = rest[0]?.label === 'Row' ? 'Row' : 'Rnd';
    const plural = word === 'Row' ? 'Rows' : 'Rnds';
    // colour runs → comments at the first line of each run
    const runs = colorRuns(rest.map((l) => l.color));
    const comments = new Map<number, string[]>();
    if (multi) {
      for (const r of runs) {
        const a = rest[r.from].n, b = rest[r.to].n;
        comments.set(r.from, [`${a === b ? `${word} ${a}` : `${plural} ${a}-${b}`}: ${colorName(palette, r.color)}`]);
      }
    }
    rest.forEach((l, k) => {
      if (l.note && l.section !== 'body') comments.set(k, [...(comments.get(k) ?? []), `${word} ${l.n}: ${l.note}`]);
    });
    if (found) {
      if (multi && rest.length) out.push(...(comments.get(0) ?? []).map((c) => `# ${c}`));
      if (multi && rest.length) comments.delete(0);
      out.push(`Foundation: ${found.text}.`);
    }
    const rows: RowLine[] = rest.map((l, k) => ({ n: l.n, text: l.text, count: l.count, comments: comments.get(k) }));
    out.push(...rowRanges(rows, word));
    blocks.push({ section: found && !rest.length ? 'foundation' : sec, text: out.join('\n') });
    i = j;
  }
  if (fasten && blocks.length) {
    const b = blocks[blocks.length - 1];
    b.text = `${b.text} Fasten off.`;
  }
  return { blocks };
}

/** The same pattern in UK terms (comments kept). */
export function toUK(text: string): string {
  const ast = parse(text).ast;
  const printed = print(ast, { terms: 'UK' }).split('\n');
  const headerLines = printed.filter((l) => /^[a-z]+: /i.test(l) && !/^(Rnds?|Rows?|Foundation)\b/.test(l));
  const roundLines = printed.filter((l) => /^(Rnds?|Rows?|Foundation)\b/.test(l));
  const out: string[] = [...headerLines];
  let k = 0;
  let inBody = false;
  for (const line of text.split('\n')) {
    if (/^(Rnds?|Rows?|Foundation)\b/.test(line)) { out.push(roundLines[k++] ?? line); inBody = true; continue; }
    if (!inBody && /^[a-z]+: /i.test(line)) continue;
    if (!inBody && line.trim() === '' && out[out.length - 1] === '') continue;
    out.push(line);
  }
  return out.join('\n');
}

/* ------------------------------------------------------------------ design */

export interface DesignOptions {
  /** compile the full pattern when under the cap (default true) and the swatch (default true) */
  compile?: boolean;
  /** node limit for compiling the full pattern (default MAX_NODES) */
  fullLimit?: number;
}

function effectiveParams(spec: BlanketSpec, base: ParamSet, unit: 'sc' | 'hdc' | 'dc', wRatio = 1, hRatio = 1): ParamSet {
  if (!spec.gauge || !(spec.gauge.sts > 0) || !(spec.gauge.rows > 0)) return base;
  const p = paramsFromGauge({ stitches: spec.gauge.sts * wRatio, rows: spec.gauge.rows * hRatio }, unit, base);
  return { ...p, id: `${base.id}+gauge`, label: `${base.label} at my gauge (${spec.gauge.sts} sts × ${spec.gauge.rows} rows / 10 cm)` };
}

const keysTotal = (k: Record<string, number>) => Object.values(k).reduce((a, b) => a + b, 0);

function byColorOf(lines: Line[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const l of lines) out[l.color] = addKeys(out[l.color] ?? {}, l.keys);
  return out;
}

export function designBlanket(spec: BlanketSpec, params?: ParamSet, opts: DesignOptions = {}): BlanketDesign {
  const base = params ?? blanketParams(spec.paramsId);
  const keys = spec.palette.map((c) => c.key);
  const warnings: string[] = [];
  const notes: string[] = [];
  const target = { widthCm: spec.size.widthCm, heightCm: spec.size.heightCm };
  const sizeName = spec.size.preset && SIZE_BY_ID[spec.size.preset] ? SIZE_BY_ID[spec.size.preset].name : 'Custom';
  let lines: Line[];
  let swatchLines: Line[];
  let P = base;
  let achieved: { widthCm: number; heightCm: number };
  let bodyInfo: BlanketDesign['size']['body'];
  let borderCm = 0;
  let edges: EdgeFit[] = [];
  let polygon: PolygonRound[] = [];
  let title: string;
  let notesLine: string;
  let motif: MotifPlan | undefined;
  let swatchNote: string;

  if (spec.construction === 'rect') {
    const pat = STITCH_BY_ID[spec.body.pattern] ?? STITCH_PATTERNS[0];
    P = effectiveParams(spec, base, pat.unit as 'sc' | 'hdc' | 'dc', pat.wRatio, pat.hRatio);
    const colW = stitchParam(P, pat.unit).width * pat.wRatio;
    const rowH = stitchParam(P, pat.unit).height * pat.hRatio;
    const fitCols = (mm: number) => {
      const W = nearestCount(mm / colW, pat.multiple, pat.plus);
      return Math.max(W, pat.minRepeats * pat.multiple + pat.plus);
    };
    // border width from a small trial piece, then the body to fit inside it
    const trialW = fitCols(30 * colW), trialN = 2 + pat.rowRepeat * 2;
    const trial = buildRect({ pattern: pat, W: trialW, N: trialN, colW, rowH, P, border: spec.border, rowColors: Array(trialN).fill(keys[0] ?? 'A') });
    const bw = trial.borderMm;
    // the border's width depends a little on the body (a set-up round more or less): try the
    // column and row counts around the estimate and keep the closest finished size
    const W0 = fitCols(target.widthCm * 10 - 2 * bw);
    const N0 = Math.max(2, Math.round((target.heightCm * 10 - 2 * bw) / rowH));
    const err = (W: number, N: number, b: number) => Math.abs(W * colW + 2 * b - target.widthCm * 10) / colW + Math.abs(N * rowH + 2 * b - target.heightCm * 10) / rowH;
    let f: { W: number; N: number; built: ReturnType<typeof buildRect> } | undefined;
    for (const dw of [0, -1, 1, -2, 2]) {
      const W = W0 + dw * pat.multiple;
      if (W < pat.minRepeats * pat.multiple + pat.plus) continue;
      for (const dn of [0, -1, 1, -2, 2]) {
        const N = N0 + dn;
        if (N < 2) continue;
        const b = buildRect({ pattern: pat, W, N, colW, rowH, P, border: spec.border, rowColors: Array(N).fill(keys[0] ?? 'A') }).borderMm;
        if (!f || err(W, N, b) < err(f.W, f.N, f.built.borderMm) - 1e-9) f = { W, N, built: { borderMm: b } as ReturnType<typeof buildRect> };
      }
      if (f && err(f.W, f.N, f.built.borderMm) < 0.5) break;
    }
    f = { W: f!.W, N: f!.N, built: buildRect({ pattern: pat, W: f!.W, N: f!.N, colW, rowH, P, border: spec.border, rowColors: planStripes(spec.stripes, f!.N, keys) }) };
    const { W, N, built } = f;
    lines = built.lines;
    edges = built.edges;
    polygon = built.polygon;
    borderCm = fmtCm(built.borderMm);
    achieved = { widthCm: fmtCm(W * colW + 2 * built.borderMm), heightCm: fmtCm(N * rowH + 2 * built.borderMm) };
    bodyInfo = { widthCm: fmtCm(W * colW), heightCm: fmtCm(N * rowH), columns: W, rows: N };
    title = spec.title || `${sizeName} blanket in ${pat.name.toLowerCase()}`;
    notesLine = `${sizeName}, ${achieved.widthCm} x ${achieved.heightCm} cm finished (target ${target.widthCm} x ${target.heightCm} cm). Body: ${pat.name}, ${W} sts (multiple of ${pat.multiple}${pat.plus ? ` + ${pat.plus}` : ''}) x ${N} rows${spec.border.enabled ? `; border ${built.borderMm >= 1 ? `${borderCm} cm` : ''} in ${lines.filter((l) => l.section === 'border').length} rounds` : ''}. Colour changes are written as comments; they are not part of the stitch graph.`;
    notes.push(pat.edge);
    if (pat.id === 'ripple') notes.push('Ripple: the sides are straight, the top and bottom edges are wavy — the border follows the waves.');
    // swatch: a few repeats × a few rows, same border
    const sW = fitCols(Math.max(14, (pat.minRepeats + 1) * pat.multiple + pat.plus) * colW);
    const sN = Math.max(4, 2 + 2 * pat.rowRepeat);
    const sw = buildRect({ pattern: pat, W: sW, N: sN, colW, rowH, P, border: spec.border, rowColors: planStripes(spec.stripes, sN, keys) });
    swatchLines = sw.lines;
    swatchNote = `Swatch: ${sW} sts × ${sN} rows of ${pat.name.toLowerCase()} with the same border — not the whole blanket.`;
  } else if (spec.construction === 'round') {
    const style = ROUND_STYLE_BY_ID[spec.round.style] ?? ROUND_STYLE_BY_ID['granny-square'];
    const unit: 'sc' | 'hdc' | 'dc' = style.id === 'mitred-square' || style.id === 'rect-round' ? 'sc' : 'dc';
    P = effectiveParams(spec, base, unit);
    const size = { widthMm: target.widthCm * 10, heightMm: (style.squareOnly ? target.widthCm : target.heightCm) * 10 };
    const input = { style: style.id, textures: spec.round.textures, corner: spec.round.corner, ...size, P, color: () => 'A', lace: spec.round.lace };
    const built = buildRounds(input);
    const rounds = built.lines.filter((l) => l.label === 'Rnd');
    const roundColors = planStripes(spec.stripes, rounds.length, keys);
    let k = 0;
    lines = built.lines.map((l) => ({ ...l, color: roundColors[l.label === 'Rnd' ? k++ : 0] ?? roundColors[0] }));
    polygon = built.polygon;
    achieved = { widthCm: fmtCm(built.widthMm), heightCm: fmtCm(built.heightMm) };
    if (style.squareOnly && target.heightCm !== target.widthCm) notes.push(`${style.name} blankets are as long as they are wide: worked to ${target.widthCm} cm across.`);
    notes.push(...built.notes);
    title = spec.title || `${sizeName} ${style.name.toLowerCase()} blanket`;
    notesLine = `${sizeName}, ${achieved.widthCm} x ${achieved.heightCm} cm finished (target ${target.widthCm} x ${style.squareOnly ? target.widthCm : target.heightCm} cm). ${style.name}, ${rounds.length} rounds. Colour changes are written as comments; they are not part of the stitch graph.`;
    const sb = buildRounds({ ...input, maxRounds: Math.min(rounds.length, style.id === 'rect-round' ? 5 : 6) });
    let ks = 0;
    swatchLines = sb.lines.map((l) => ({ ...l, color: roundColors[l.label === 'Rnd' ? ks++ : 0] ?? roundColors[0] }));
    swatchNote = `Swatch: the first ${sb.rounds} rounds of the ${style.name.toLowerCase()} — not the whole blanket.`;
  } else {
    P = effectiveParams(spec, base, 'dc');
    motif = planMotifs(spec.motif, P, keys);
    const cw = motif.colorways[0];
    lines = motif.lines.map((l, i) => ({ ...l, color: cw.rounds[i] ?? cw.rounds[0] }));
    swatchLines = lines;
    achieved = { widthCm: fmtCm(motif.widthMm), heightCm: fmtCm(motif.heightMm) };
    notes.push(...motif.notes);
    title = spec.title || `${sizeName} motif blanket (${spec.motif.cols} x ${spec.motif.rows} ${motif.shape === 'hexagon' ? 'hexagons' : 'squares'})`;
    notesLine = `Motif for a ${spec.motif.cols} x ${spec.motif.rows} ${motif.shape} blanket, ${achieved.widthCm} x ${achieved.heightCm} cm with joins. Make ${spec.motif.cols * spec.motif.rows} motifs in ${motif.colorways.length} colourways; join them as described (joins are not in the stitch graph). Colour changes are written as comments.`;
    swatchNote = 'The motif itself (colourway 1).';
  }

  // counts (closed form, from the simulated lines)
  let keysAll = keysOf(lines);
  let byColor = byColorOf(lines);
  if (motif) {
    byColor = motif.keysByColor;
    keysAll = Object.values(byColor).reduce((a, k) => addKeys(a, k), {} as Record<string, number>);
  }
  const used = new Set(lines.map((l) => l.color));
  const text0 = [...header(spec, P, title, notesLine, motif ? new Set(motif.colorways.flatMap((c) => c.rounds)) : used), ''];
  const { blocks } = writeLines(lines, spec.palette);
  const sectionTitle: Record<string, string> = { body: 'Body', border: 'Border', rounds: 'Rounds', edge: 'Edge', foundation: 'Foundation' };
  const sections: BlanketSection[] = [{ kind: 'header', title: 'Header', text: text0.join('\n').trim() }];
  const bodyParts: string[] = [];
  for (const b of blocks) {
    const t = sectionTitle[b.section] ?? 'Pattern';
    bodyParts.push(`# ${t}`, b.text, '');
    sections.push({ kind: b.section === 'edge' ? 'border' : (b.section as BlanketSection['kind']), title: t, text: b.text });
  }
  if (motif) {
    const joinText = `Join the motifs: ${spec.motif.join === 'whip' ? 'whip stitch' : spec.motif.join === 'sc' ? 'single crochet join' : 'join as you go'} (see the planner). Joins are not part of the stitch graph.`;
    sections.push({ kind: 'joining', title: 'Joining', text: joinText });
  }
  let text = [...text0, ...bodyParts].join('\n').replace(/\n+$/, '\n');
  if (spec.terms === 'UK') text = toUK(text);

  const swatchKeys = keysOf(swatchLines);
  const swatchBlocks = writeLines(swatchLines, spec.palette).blocks.map((b) => b.text).join('\n');
  const swatchHeader = header(spec, P, `${title} — swatch`, swatchNote, new Set(swatchLines.map((l) => l.color)));
  let swatchText = [...swatchHeader, '', swatchBlocks].join('\n') + '\n';
  if (spec.terms === 'UK') swatchText = toUK(swatchText);

  const nodes = keysTotal(keysAll);
  const limit = opts.fullLimit ?? MAX_NODES;
  let pattern: Pattern | undefined;
  let swatch: Pattern | undefined;
  const diagnostics = { full: [] as Diagnostic[], swatch: [] as Diagnostic[] };
  let compiled: BlanketDesign['compiled'] = 'none';
  const motifSingle = !!motif;
  if (opts.compile !== false) {
    const singleNodes = motifSingle ? keysTotal(keysOf(lines)) : nodes;
    if (singleNodes <= limit) {
      const r = compilePattern(text);
      diagnostics.full = r.diagnostics;
      pattern = r.pattern;
      if (pattern) compiled = 'full';
    }
    const s = compilePattern(swatchText);
    diagnostics.swatch = s.diagnostics;
    swatch = s.pattern;
    if (compiled === 'none' && swatch) compiled = 'swatch';
    if (!pattern && singleNodes > limit) {
      warnings.push(`This blanket has about ${nodes.toLocaleString('en')} stitches and chains — over the ${limit.toLocaleString('en')}-node limit for compiling a pattern. Counts, size and yarn are computed exactly from the pattern's structure; the chart, 3D view and checks use a ${swatchKeys ? 'small swatch' : 'swatch'}.`);
    }
    for (const d of [...diagnostics.full, ...diagnostics.swatch]) if (d.severity !== 'info') warnings.push(`Pattern check: ${d.message}`);
  }

  // checks
  for (const e of edges) if (e.class !== 'ok') warnings.push(e.message);
  for (const p of polygon) if (p.class !== 'flat' && !p.intended) warnings.push(p.message);
  if (spec.construction === 'rect' && spec.border.layers.some((l) => l.kind === 'ruffle')) notes.push('The ruffle edging is deliberately far over flat: it will ruffle, by design.');
  if (spec.gauge) notes.push(`Sized from your gauge: ${spec.gauge.sts} sts and ${spec.gauge.rows} rows per 10 cm.`);

  const stitches = motif ? stitchTotal(keysAll) : stitchTotal(keysAll);
  const stitchesByColor = Object.fromEntries(Object.entries(byColor).map(([c, k]) => [c, stitchTotal(k)]));
  const chains = (keysAll.ch ?? 0) + (keysAll['turning ch'] ?? 0) + (keysAll['sl st'] ?? 0);
  const spm = spec.spm && spec.spm > 0 ? spec.spm : 20;
  const timeMin = (stitches + chains * 0.4) / spm;
  return {
    text, pattern, swatchText, swatch, swatchNote,
    roundColors: lines.map((l) => l.color),
    swatchRoundColors: swatchLines.map((l) => l.color),
    diagnostics, compiled,
    size: { target, achieved, body: bodyInfo, borderCm },
    counts: {
      keys: keysAll, stitches, nodes,
      rows: lines.filter((l) => l.label === 'Row').length,
      rounds: lines.filter((l) => l.label === 'Rnd').length,
      byColor, stitchesByColor,
    },
    lines, sections, checks: { edges, polygon, notes }, warnings, timeMin, motif, params: P,
  };
}

/* ------------------------------------------------------------------ random */

export interface RandomBlanketConstraints {
  construction?: Construction;
  sizes?: string[];
  paramsId?: string;
}

/** A seeded "surprise me" blanket spec. Deterministic in the seed. */
export function randomBlanket(seed: number, c: RandomBlanketConstraints = {}): BlanketSpec {
  const r = prng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const construction = c.construction ?? pick<Construction>(['rect', 'rect', 'rect', 'round', 'motif']);
  const sizes = (c.sizes?.length ? BLANKET_SIZES.filter((s) => c.sizes!.includes(s.id)) : BLANKET_SIZES.filter((s) => ['baby', 'stroller', 'crib', 'lapghan', 'throw'].includes(s.id)));
  const size = pick(sizes);
  const pal = pick(PALETTES);
  const palette = paletteFrom(pal.colors);
  const keys = palette.map((p) => p.key);
  const preset = pick(BORDER_PRESETS.filter((b) => b.id !== 'ruffle'));
  const borderColor = keys[keys.length - 1];
  const spec: BlanketSpec = {
    ...DEFAULT_SPEC,
    construction,
    size: { preset: size.id, widthCm: size.widthCm, heightCm: size.heightCm },
    paramsId: c.paramsId ?? DEFAULT_SPEC.paramsId,
    palette,
    stripes: surpriseStripes(seed, keys.slice(0, -1)),
    body: { pattern: pick(STITCH_PATTERNS).id },
    border: { enabled: true, rowEnds: 'auto', edgeCorner: r() < 0.7 ? 'sc3' : 'ch2', edgeColor: borderColor, layers: preset.layers.map((k, i) => ({ kind: k, color: i % 2 ? keys[0] : borderColor })) },
    round: { style: pick<RoundStyleId>(['granny-square', 'solid-square', 'hexagon', 'circle-to-square', 'mandala']), textures: [], corner: 'auto' },
    motif: { ...DEFAULT_SPEC.motif, style: pick(['granny-square', 'solid-square', 'hexagon'] as const), seed: Math.floor(r() * 1e6), layout: pick(['random', 'checkerboard', 'diagonal', 'gradient'] as const) },
  };
  spec.round.textures = ROUND_STYLE_BY_ID[spec.round.style].defaultTextures;
  return spec;
}

/** Borders that suit a body: the presets ranked for the stitch pattern's character. */
export function bordersFor(patternId: string): { id: string; name: string; why: string }[] {
  const pat = STITCH_BY_ID[patternId];
  if (!pat) return [];
  const lacy = pat.yarnFactor < 0.85;
  const textured = ['moss', 'griddle', 'bobble'].includes(pat.id);
  const out: { id: string; name: string; why: string }[] = [];
  const add = (id: string, why: string) => { const p = BORDER_PRESETS.find((b) => b.id === id); if (p) out.push({ id, name: p.name, why }); };
  if (lacy) { add('lace', 'Echoes an open body; the mesh round frames the lace.'); add('shell', 'Shells scallop an airy fabric.'); }
  if (textured) { add('simple', 'A quiet sc frame lets the texture lead.'); add('ridge', 'Back-loop ridges frame a textured body.'); }
  if (pat.id === 'granny') add('granny', 'A granny frame continues the clusters round the edge.');
  add('classic', 'An hdc frame squares up any body.');
  add('picot', 'A light picot edge for baby blankets.');
  if (!lacy) add('shell', 'A classic shell edge.');
  return out.filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i).slice(0, 4);
}

/** Stitch patterns that cannot be expressed yet (C2C, crab stitch). */
export { NOT_EXPRESSIBLE, BORDER_BY_KIND };
