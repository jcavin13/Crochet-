/**
 * Flatness assistant (pure; no DOM). Method and limits: README.md here.
 *
 *   suggestRoundFixes(text, round, params) → FixSuggestion[]   ranked notation edits for one round
 *   suggestFixes(text, params)             → RoundFixes[]      for every round that is not flat
 *   fixAll(text, params)                   → { text, steps }   best fix round by round, centre out
 *   applyFix(text, suggestion)             → new text (checks the suggestion was made for `text`)
 *   suggestCounts({...}) / suggestCountsForRound(graph, round, params)
 *                                          → "what should this round be" calculator
 *   updateCountAnnotations(text)           → rewrite "(N …)" counts to what the rounds make
 */
import type { Diagnostic, Graph } from '../graph';
import { analyzeFlatness, borderCornerGroups, cornerGroups, detectPolygon, detectStadiumRectangle, type FlatnessReport, type RoundClass, type RoundFlatness } from '../flatness';
import { nodeCounts } from '../graph/targets';
import type { BaseType, PatternAst } from '../notation';
import { compilePattern, parse } from '../notation';
import { simConfig, stitchParam, type ParamSet } from '../params';
import { analyzeSymmetry, type SymmetryReport } from '../symmetry';
import { compileIgnoringCounts, updateCountAnnotations } from './counts';
import { consumption } from './consume';
import { drafts, mainRepeat, materialize, rebalance, renameSpaceRefs, type Draft } from './edits';
import { LineIndex, applyEdits, roundMap, type TextEdit } from './text';

export type { TextEdit } from './text';
export { updateCountAnnotations, actualCount } from './counts';
export type { CountUpdate } from './counts';
export { consumption } from './consume';

export interface FixOutcome {
  class: RoundClass;
  /** Nominal relative excess after the edit (0.02 = +2 %). */
  e: number;
  eMin: number;
  eMax: number;
  slackOnly: boolean;
  message: string;
}

export interface FixDiff {
  /** Replace oldText[from, to) with `insert` to get the new text. */
  from: number;
  to: number;
  insert: string;
  /** Whole lines affected (1-based, in the old text), for a before/after preview. */
  line: number;
  endLine: number;
  before: string[];
  after: string[];
}

export interface FixSuggestion {
  /** Graph round index the fix is for. */
  round: number;
  roundLabel: string;
  /** "change ch 5 → ch 3 in each repeat" */
  change: string;
  /** "Rnd 5: change ch 5 → ch 3 in each repeat → lies flat (+2%)" */
  label: string;
  /** The whole new notation (count annotations already updated). */
  text: string;
  /** The text the suggestion was made for (applyFix checks it). */
  base: string;
  diff: FixDiff;
  result: FixOutcome;
  /** Later rounds whose repeat count was adjusted so they still fit ("Rnd 6: ×24 → ×12"). */
  adjusted: string[];
  /** Later rounds that still need attention after this edit (the text then has errors or new warnings). */
  attention: string[];
  /** The checker's messages for those rounds. */
  attentionDetails: string[];
  /** Count annotations rewritten. */
  countsUpdated: number;
  /** The new text compiles without errors (warnings such as unworked stitches may remain — see `attention`). */
  compiles: boolean;
  /** Rotational order of the piece after the edit. */
  order: number;
  size: number;
  score: number;
}

export interface RoundFixes {
  round: number;
  label: string;
  flatness: RoundFlatness;
  suggestions: FixSuggestion[];
  /** A cornered round (polygon / border): what to change in its corner groups (`cornerAdvice`). */
  advice?: string;
}

/** Is this round judged by a corner rule (a polygon worked from the centre, or a border round rows)? */
export const isCornered = (r: RoundFlatness) => r.shape === 'polygon' || r.shape === 'border';

/**
 * For a cornered round that is not flat: the fix is in the corner groups, never a circle-style
 * rewrite of the sides. "Cornered round: adjust the corner group — use (4 dc, ch 2, 4 dc) in each
 * corner instead of (3 dc, ch 2, 3 dc)." Null for other rounds.
 */
export function cornerAdvice(r: RoundFlatness): string | null {
  if (!isCornered(r) || r.class === 'n/a' || (r.class === 'flat' && !r.slackOnly)) return null;
  if (r.closing) return null;
  if (r.shape === 'border' && r.border?.sides.some((s) => s.class !== 'ok')) {
    const s = r.border.sides.filter((x) => x.class !== 'ok');
    return `Border round: fit the sides to the edge — ${s.map((x) => `${x.side.toLowerCase()}: ${x.fix ? `use ${x.fix}` : x.class === 'wavy' ? 'fewer stitches' : 'more stitches'}`).join('; ')}.`;
  }
  if (/sides will (wave|pull in)/.test(r.message) && !/corners/.test(r.message)) {
    return 'Cornered round: work one stitch in each stitch along the sides and keep the increases in the corner groups.';
  }
  const ce = r.polygon?.corner ?? r.border?.corner;
  if (ce?.suggest && r.class === 'flat') return `Cornered round: flat only with loose loops — use ${ce.suggest} in each corner instead of ${ce.now}.`;
  if (ce?.suggest) return `Cornered round: adjust the corner group — use ${ce.suggest} in each corner instead of ${ce.now}.`;
  if (r.slackOnly) return 'Cornered round: flat only with loose loops — adjust the chain inside the corner groups, not the sides.';
  return `Cornered round: adjust the corner group — ${r.class === 'cup' ? 'a bigger' : 'a smaller'} group in each corner, not extra stitches along the sides.`;
}

/** Corner groups of round g and the number of stitches outside them (polygon or border round). */
function cornerShape(graph: Graph, g: number, shape: RoundFlatness['shape']): { groups: number; sides: number } | null {
  let groups: number[][] | undefined;
  if (shape === 'border') groups = borderCornerGroups(graph).get(g);
  else {
    const poly = detectPolygon(graph) ?? detectStadiumRectangle(graph);
    if (!poly || g < poly.from) return null;
    groups = cornerGroups(graph, g);
    if (groups.length !== poly.n) return null;
  }
  const R = graph.rounds[g];
  if (!groups || !R || R.first < 0) return null;
  const inG = new Set(groups.flat());
  let sides = 0;
  for (let id = R.first; id <= R.last; id++) { const n = graph.nodes[id]; if (nodeCounts(n) && n.type !== 'slst' && !inG.has(id)) sides++; }
  return { groups: groups.length, sides };
}

/** The edit kept the round's corner structure: as many corner groups, the sides untouched (only the groups changed). */
function keepsCorners(before: Graph, after: Graph, g: number, shape: RoundFlatness['shape']): boolean {
  const a = cornerShape(before, g, shape), b = cornerShape(after, g, shape);
  return !!a && !!b && a.groups === b.groups && a.sides === b.sides;
}

export interface AssistOptions {
  /** Suggestions per round (default 4). */
  max?: number;
  /** Also try to make "flat only with loose loops" rounds truly flat (default true). */
  loose?: boolean;
}

/** Does this round need the assistant: cup / ruffle, or flat only thanks to loose loops? */
export function needsFix(r: RoundFlatness, loose = true): boolean {
  if (r.class === 'n/a') return false;
  return r.class !== 'flat' || (loose && r.slackOnly);
}

// ------------------------------------------------------------------------------------------------

interface Ctx {
  text: string;
  ast: PatternAst;
  li: LineIndex;
  graph: Graph;
  map: { ast: number; k: number }[];
  params: ParamSet;
  flat: FlatnessReport;
  sym: SymmetryReport;
  baseWarn: Set<string>;
}

const diagKey = (d: Diagnostic) => `${d.code}|${d.round ?? ''}`;

function prepare(text: string, params: ParamSet): Ctx | null {
  const r = compilePattern(text);
  if (!r.pattern || !r.ast) return null;
  const graph = r.pattern.graph;
  const map = roundMap(r.ast, graph);
  if (!map) return null;
  return {
    text, ast: r.ast, li: new LineIndex(text), graph, map, params,
    flat: analyzeFlatness(graph, params), sym: analyzeSymmetry(graph),
    baseWarn: new Set(r.diagnostics.filter((d) => d.severity === 'warning').map(diagKey)),
  };
}

function astRoundMap(ast: PatternAst): { ast: number; k: number }[] {
  const out: { ast: number; k: number }[] = [];
  ast.rounds.forEach((r, a) => { const n = r.label.range ? r.label.to - r.label.from + 1 : 1; for (let k = 0; k < n; k++) out.push({ ast: a, k }); });
  return out;
}

/** Edits inside a round written with a range label ("Rnds 8-12") apply to one of its rounds only: split the label. */
function splitRange(c: Ctx, a: number, k: number, edits: TextEdit[]): TextEdit[] {
  const ra = c.ast.rounds[a];
  if (!ra.label.range || ra.label.from === ra.label.to) return edits;
  const from = c.li.start(ra.span), to = c.li.end(ra.span);
  const labelEnd = c.li.end(ra.label.span);
  const rest = c.text.slice(labelEnd, to);
  const restNew = applyEdits(rest, edits.map((e) => ({ ...e, from: e.from - labelEnd, to: e.to - labelEnd })));
  const word = ra.label.kind === 'row' ? 'Row' : 'Rnd';
  const lab = (x: number, y: number) => (x === y ? `${word} ${x}` : `${word}s ${x}-${y}`);
  const F = ra.label.from, T = ra.label.to, n = F + k;
  const parts: string[] = [];
  if (n > F) parts.push(lab(F, n - 1) + rest);
  parts.push(lab(n, n) + restNew);
  if (n < T) parts.push(lab(n + 1, T) + rest);
  return [{ from, to, insert: parts.join('\n') }];
}

/**
 * Later round s no longer fits the round below: re-balance its main repeat count — by the change
 * in the round below (`delta`), or so that it uses every stitch the round below now has
 * (`absolute`, for a round already left with unworked stitches). The new count must keep the
 * piece's symmetry order.
 */
function rebalanceLater(c: Ctx, ast2: PatternAst, t: string, s: number): { text: string; note: string } | null {
  const m = astRoundMap(ast2)[s];
  if (!m || m.k > 0 || s < 1) return null;
  const ra = ast2.rounds[m.ast];
  const rep = mainRepeat(ra.items);
  if (!rep || rep.times.kind !== 'n') return null;
  const body = consumption(rep.items);
  const whole = consumption(ra.items);
  if (!body || !whole || (body.st === 0 && body.sp === 0)) return null;
  const trunc = compileIgnoringCounts({ ...ast2, rounds: ast2.rounds.slice(0, m.ast) });
  const g1 = trunc.pattern?.graph;
  if (!g1) return null;
  const pNew = g1.rounds[s - 1], pOld = c.graph.rounds[s - 1];
  if (!pNew || !pOld) return null;
  const sp = (g: Graph, r: number) => g.spaces.filter((x) => x.round === r && x.kind === 'chsp').length;
  const solve = (dSt: number, dSp: number): number | undefined => {
    let dn: number | undefined;
    for (const [diff, b] of [[dSt, body.st], [dSp, body.sp]] as const) {
      if (b === 0) continue;
      if (diff % b !== 0) return undefined;
      if (dn !== undefined && dn !== diff / b) return undefined;
      dn = diff / b;
    }
    return dn;
  };
  const ord = Math.max(1, c.sym.rounds[s - 1]?.cumulative ?? c.sym.order);
  const N = rep.times.n;
  const ok = (dn: number | undefined) => dn !== undefined && dn !== 0 && N + dn >= 1 && (N + dn) % ord === 0;
  let dn = solve(pNew.stitchCount - pOld.stitchCount, sp(g1, s - 1) - sp(c.graph, s - 1));
  if (!ok(dn)) dn = solve(whole.st && pNew.stitchCount - whole.st, 0);
  if (!ok(dn)) return null;
  const n2 = N + dn!;
  const d: Draft = { kind: 'repeat', change: '', size: 0, mods: new Map(), times: new Map([[rep, n2]]) };
  const li = new LineIndex(t);
  const edits = materialize(t, li, ast2, ra, d);
  if (!edits.length) return null;
  return { text: applyEdits(t, edits), note: `${c.graph.rounds[s]?.label ?? `#${s}`}: ×${N} → ×${n2}` };
}

/** Re-balance every round left with unworked stitches whose repeat can be made to fit (fix-all clean-up). */
function repairUnworked(text: string, params: ParamSet): { text: string; notes: string[] } {
  const notes: string[] = [];
  let t = text;
  for (let iter = 0; iter < 6; iter++) {
    const c = prepare(t, params);
    if (!c) break;
    const r = compilePattern(t);
    const rounds = [...new Set(r.diagnostics.filter((d) => d.code === 'W_UNWORKED' && d.round !== undefined).map((d) => d.round!))];
    let changed = false;
    for (const s of rounds) {
      const fixed = rebalanceLater(c, c.ast, t, s);
      if (!fixed) continue;
      const cu = updateCountAnnotations(fixed.text);
      const after = compilePattern(cu.ok ? cu.text : fixed.text);
      if (!after.pattern || analyzeSymmetry(after.pattern.graph).order < c.sym.order) continue;
      const before = r.diagnostics.filter((d) => d.severity === 'warning').length;
      if (after.diagnostics.filter((d) => d.severity === 'warning').length >= before) continue;
      t = cu.ok ? cu.text : fixed.text; notes.push(fixed.note); changed = true;
      break;
    }
    if (!changed) break;
  }
  return { text: t, notes };
}

interface Evaluated {
  draft: Draft;
  text: string;
  graph: Graph;
  adjusted: string[];
  attention: string[];
  attnRounds: number[];
  details: string[];
  res: RoundFlatness;
  rank: number;
  score: number;
}

function evaluate(c: Ctx, g: number, d: Draft, before: RoundFlatness): Evaluated | null {
  const { ast: a, k } = c.map[g];
  const ra = c.ast.rounds[a];
  if (d.rebalance && !rebalance(ra, d)) return null;
  let edits = materialize(c.text, c.li, c.ast, ra, d);
  if (!edits.length) return null;
  edits = splitRange(c, a, k, edits);
  if (d.renameSpaces) {
    const lastOfRange = !ra.label.range || k === ra.label.to - ra.label.from;
    const nextR = c.ast.rounds[a + 1];
    if (lastOfRange && nextR && !nextR.label.range) edits.push(...renameSpaceRefs(c.li, c.ast, nextR, d.renameSpaces.from, d.renameSpaces.to));
  }
  let t: string;
  try { t = applyEdits(c.text, edits); } catch { return null; }
  if (t === c.text) return null;
  const adjusted: string[] = [];
  let attention: string[] = [];
  let hardBreak = false;
  let attnRounds: number[] = [];
  let details: string[] = [];
  let graph: Graph | undefined;
  for (let iter = 0; iter < 8; iter++) {
    const p = parse(t);
    if (p.diagnostics.some((x) => x.severity === 'error')) return null;
    const cc = compileIgnoringCounts(p.ast, t);
    const early = cc.diagnostics.some((x) => x.severity === 'error' && (x.round === undefined || x.round <= g));
    if (early) return null;
    const bad = cc.diagnostics.filter((x) => x.round !== undefined && x.round > g
      && (x.severity === 'error' || (x.severity === 'warning' && !c.baseWarn.has(diagKey(x)))));
    if (!bad.length) { graph = cc.pattern?.graph; break; }
    const s = Math.min(...bad.map((x) => x.round!));
    const fixed = rebalanceLater(c, p.ast, t, s);
    if (fixed) { t = fixed.text; adjusted.push(fixed.note); continue; }
    attnRounds = [...new Set(bad.map((x) => x.round!))].sort((x, y) => x - y);
    attention = attnRounds.map((x) => c.graph.rounds[x]?.label ?? '').filter(Boolean);
    details = [...new Set(bad.map((x) => x.message))];
    hardBreak = bad.some((x) => x.severity === 'error');
    if (cc.pattern) { graph = cc.pattern.graph; break; }
    // compile what is before the first broken round, to judge the edited round
    const m = astRoundMap(p.ast)[s];
    if (!m || m.ast <= c.map[g].ast) return null;
    graph = compileIgnoringCounts({ ...p.ast, rounds: p.ast.rounds.slice(0, m.ast) }).pattern?.graph;
    break;
  }
  if (!graph || !graph.rounds[g]) return null;
  const res = analyzeFlatness(graph, c.params).rounds[g];
  if (!res || res.class === 'n/a') return null;
  const dev = (r: RoundFlatness) => Math.abs(r.e);
  const rank = res.class === 'flat' && !res.slackOnly ? 0 : res.class === 'flat' ? 1 : 2;
  const beforeRank = before.class === 'flat' && !before.slackOnly ? 0 : before.class === 'flat' ? 1 : 2;
  if (rank > beforeRank || (rank === beforeRank && dev(res) >= dev(before) - 0.02)) return null;
  const score = rank * 10 + Math.abs(res.e) * 10 + d.size * 0.25 + adjusted.length * 0.4 + (attention.length ? (hardBreak ? 40 : 4) : 0);
  return { draft: d, text: t, graph, adjusted, attention, details, attnRounds, res, rank, score };
}

const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)}%`;

function outcomeText(r: RoundFlatness): string {
  if (r.class === 'flat' && !r.slackOnly) return `lies flat (${pct(r.e)})`;
  if (r.class === 'flat') return `flat with loose loops (${pct(r.e)} at nominal loop length)`;
  return r.class === 'cup' ? `still cups, less (${pct(r.eMax)})` : `still ruffles, less (${pct(r.eMin)})`;
}

function makeDiff(oldText: string, newText: string): FixDiff {
  let a = 0;
  while (a < oldText.length && a < newText.length && oldText[a] === newText[a]) a++;
  let b = 0;
  while (b < oldText.length - a && b < newText.length - a && oldText[oldText.length - 1 - b] === newText[newText.length - 1 - b]) b++;
  const to = oldText.length - b, toNew = newText.length - b;
  const lo = new LineIndex(oldText), ln = new LineIndex(newText);
  const line = lo.lineOf(a), endLine = lo.lineOf(Math.max(a, to - 1));
  const before = oldText.split('\n').slice(line - 1, endLine);
  const nl = ln.lineOf(a), nEnd = ln.lineOf(Math.max(a, toNew - 1));
  const after = newText.split('\n').slice(nl - 1, nEnd);
  return { from: a, to, insert: newText.slice(a, toNew), line, endLine, before, after };
}

function makeLabel(round: string, change: string, adjusted: string[], outcome: string, attention: string[]): string {
  const extra = adjusted.length ? ` (and ${adjusted.join(', ')})` : '';
  const att = attention.length ? ` — then ${attention.join(', ')} need${attention.length === 1 ? 's' : ''} attention` : '';
  return `${round}: ${change}${extra} → ${outcome}${att}`;
}

function finalize(c: Ctx, g: number, ev: Evaluated): FixSuggestion | null {
  let text = ev.text, countsUpdated = 0;
  const cu = updateCountAnnotations(text, ev.attnRounds.length ? astRoundMap(parse(text).ast)[ev.attnRounds[0]]?.ast : undefined);
  if (cu.ok) { text = cu.text; countsUpdated = cu.edits.length; }
  const final = compilePattern(text);
  if (!final.pattern && !ev.attention.length) return null;
  // symmetry must not drop: no round's cumulative order may fall (up to the first round that
  // still needs attention)
  const sym = analyzeSymmetry(final.pattern ? final.pattern.graph : ev.graph);
  const upto = Math.min(ev.attnRounds.length ? ev.attnRounds[0] - 1 : Infinity, sym.rounds.length - 1, c.sym.rounds.length - 1);
  for (let x = 0; x <= upto; x++) {
    if ((sym.rounds[x]?.cumulative ?? 1) < (c.sym.rounds[x]?.cumulative ?? 1)) return null;
  }
  const order = ev.attnRounds.length ? (sym.rounds[upto]?.cumulative ?? sym.order) : sym.order;
  const R = c.graph.rounds[g];
  const change = ev.draft.change;
  return {
    round: g, roundLabel: R.label, change, label: makeLabel(R.label, change, ev.adjusted, outcomeText(ev.res), ev.attention),
    text, base: c.text, diff: makeDiff(c.text, text),
    result: { class: ev.res.class, e: ev.res.e, eMin: ev.res.eMin, eMax: ev.res.eMax, slackOnly: ev.res.slackOnly, message: ev.res.message },
    adjusted: ev.adjusted, attention: ev.attention, attentionDetails: ev.details, countsUpdated, compiles: !!final.pattern, order, size: ev.draft.size, score: ev.score,
  };
}

function roundSuggestions(c: Ctx, g: number, opts: AssistOptions): FixSuggestion[] {
  const max = opts.max ?? 4;
  const before = c.flat.rounds[g];
  if (!before || !needsFix(before, opts.loose ?? true)) return [];
  const { ast: a } = c.map[g];
  const ra = c.ast.rounds[a];
  const flatCount = Math.round(c.graph.rounds[g].stitchCount - before.stitchesNominal);
  const order = g > 0 ? (c.sym.rounds[g - 1]?.cumulative ?? c.sym.order) : c.sym.order;
  const all = drafts(c.text, c.li, c.ast, ra, c.graph, g, { order: Math.max(1, Math.min(order, c.sym.order || 1) || order), flatCount, ownOrder: c.sym.rounds[g]?.order ?? 1 });
  // a cornered round is fixed in its corner groups only: stitches-per-place edits that keep the
  // corners and leave the sides alone — never a circle-style rewrite or spread increases
  const cornered = isCornered(before);
  const ds = cornered ? all.filter((d) => d.kind === 'count') : all;
  const evs: Evaluated[] = [];
  for (const d of ds) {
    const ev = evaluate(c, g, d, before);
    if (ev && (!cornered || (isCornered(ev.res) && keepsCorners(c.graph, ev.graph, g, before.shape)))) evs.push(ev);
  }
  const best = evs.some((e) => e.rank < 2) ? evs.filter((e) => e.rank < 2) : evs;
  best.sort((x, y) => x.score - y.score);
  const out: FixSuggestion[] = [];
  const seen = new Set<string>();
  for (const ev of best) {
    if (out.length >= max) break;
    if (seen.has(ev.text)) continue;
    seen.add(ev.text);
    const s = finalize(c, g, ev);
    if (s && !out.some((o) => o.text === s.text)) out.push(s);
  }
  return out;
}

/** Ranked notation edits that make round `round` (graph index) flat. Empty if it already is. */
export function suggestRoundFixes(text: string, round: number, params: ParamSet, opts: AssistOptions = {}): FixSuggestion[] {
  const c = prepare(text, params);
  return c ? roundSuggestions(c, round, opts) : [];
}

/** Suggestions for every round that is not (truly) flat, centre outward. */
export function suggestFixes(text: string, params: ParamSet, opts: AssistOptions = {}): RoundFixes[] {
  const c = prepare(text, params);
  if (!c) return [];
  return c.flat.rounds.filter((r) => needsFix(r, opts.loose ?? true)).map((r) => {
    const advice = cornerAdvice(r);
    return { round: r.round, label: r.label, flatness: r, suggestions: roundSuggestions(c, r.round, opts), ...(advice ? { advice } : {}) };
  });
}

/** Apply a suggestion. Throws if the text changed since the suggestion was made. */
export function applyFix(text: string, s: FixSuggestion): string {
  if (text !== s.base) throw new Error('The pattern changed since this fix was suggested.');
  return s.text;
}

export interface FixAllResult {
  text: string;
  steps: FixSuggestion[];
  /** Rounds still not flat afterwards, with the reason. */
  remaining: RoundFlatness[];
  /** Warnings the result has that the input did not (e.g. a later round left with unworked stitches). */
  warnings: string[];
}

/**
 * Apply the best clean fix (truly flat, or flat with loose loops when nothing better exists; no
 * knock-on breakage) round by round from the centre outward, re-analysing after each — later
 * rounds' radii change with every fix.
 */
export function fixAll(text: string, params: ParamSet, opts: AssistOptions = {}): FixAllResult {
  const steps: FixSuggestion[] = [];
  let t = text;
  let c = prepare(t, params);
  if (!c) return { text, steps, remaining: [], warnings: [] };
  const warnBefore = new Set(compilePattern(text).diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message));
  for (let g = 0; g < c.graph.rounds.length; g++) {
    const r = c.flat.rounds[g];
    if (!r || !needsFix(r, opts.loose ?? true)) continue;
    const s = roundSuggestions(c, g, { ...opts, max: 3 }).find((x) => x.compiles && x.result.class === 'flat');
    if (!s) continue;
    const rep = repairUnworked(s.text, params);
    const next = prepare(rep.text, params);
    if (!next) continue;
    if (rep.notes.length) {
      s.adjusted = [...s.adjusted, ...rep.notes];
      s.attention = [];
      s.attentionDetails = [];
      s.text = rep.text;
      s.diff = makeDiff(s.base, s.text);
      s.label = makeLabel(s.roundLabel, s.change, s.adjusted, outcomeText(next.flat.rounds[g]), []);
    }
    steps.push(s);
    t = s.text;
    c = next;
  }
  const warnings = compilePattern(t).diagnostics.filter((d) => d.severity === 'warning' && !warnBefore.has(d.message)).map((d) => d.message);
  return { text: t, steps, remaining: c.flat.rounds.filter((r) => needsFix(r, opts.loose ?? true)), warnings };
}

// ------------------------------------------------------------------ "what should this round be"

export interface CountOption {
  /** "8 dc per repeat ×12" / "5 dc + ch 3 per repeat ×12" */
  text: string;
  stitches: number;
  chains: number;
  total: number;
  /** Relative excess at nominal loop length (0 = exactly flat). */
  e: number;
}
export interface CountSuggestion {
  stitch: BaseType;
  order: number;
  /** Stitch-top radius of the round (mm). */
  rho: number;
  /** Course length a flat round needs, 2πρ (mm). */
  need: number;
  /** need / width of the stitch: "≈ 96 stitch-widths". */
  widths: number;
  perRepeat: number;
  options: CountOption[];
  message: string;
}

export interface CountInput {
  stitch: BaseType;
  order: number;
  params: ParamSet;
  /** Stitch-top radius; or give `rPrev`, the radius the previous round hands on (mm). */
  rho?: number;
  rPrev?: number;
  chainNominal?: number;
}

export function suggestCounts(input: CountInput): CountSuggestion {
  const { stitch, params } = input;
  const order = Math.max(1, Math.round(input.order));
  const wS = stitchParam(params, stitch).width, hS = stitchParam(params, stitch).height;
  const wch = stitchParam(params, 'ch').width;
  const nom = input.chainNominal ?? simConfig.flatness.chain_nominal;
  const rho = input.rho ?? (input.rPrev ?? 0) + hS;
  const need = 2 * Math.PI * rho;
  const widths = need / wS;
  const perRepeat = widths / order;
  const options: CountOption[] = [];
  const kS = Math.max(1, Math.round(perRepeat));
  options.push({ text: `${kS} ${stitch} per repeat ×${order}`, stitches: kS, chains: 0, total: kS * order, e: (kS * order * wS) / need - 1 });
  const lace: CountOption[] = [];
  for (let k = 1; k < perRepeat; k++) {
    const c = Math.round((need / order - k * wS) / (wch * nom));
    if (c < 1 || c > 15) continue;
    lace.push({ text: `${k} ${stitch} + ch ${c} per repeat ×${order}`, stitches: k, chains: c, total: k * order, e: (order * (k * wS + c * wch * nom)) / need - 1 });
  }
  const pick = (f: number) => {
    const k = Math.max(1, Math.round(perRepeat * f));
    const o = lace.filter((x) => Math.abs(x.stitches - k) <= 1).sort((a, b) => Math.abs(a.e) - Math.abs(b.e))[0];
    if (o && !options.some((x) => x.text === o.text)) options.push(o);
  };
  pick(0.6); pick(0.3);
  const lacy = options.find((o) => o.chains > 0);
  const message = `At this radius a flat round needs ≈ ${Math.round(widths)} ${stitch}-widths: e.g. ${options[0].text}${lacy ? `, or ${lacy.text}` : ''}.`;
  return { stitch, order, rho, need, widths, perRepeat, options, message };
}

/** The calculator for an existing round: its radius, its main stitch and the piece's order below it. */
export function suggestCountsForRound(graph: Graph, round: number, params: ParamSet, opts: { stitch?: BaseType; order?: number; flatness?: FlatnessReport; symmetry?: SymmetryReport } = {}): CountSuggestion | null {
  const R = graph.rounds[round];
  if (!R || R.kind !== 'round') return null;
  const flat = opts.flatness ?? analyzeFlatness(graph, params);
  const fr = flat.rounds[round];
  if (!fr || fr.class === 'n/a' || isCornered(fr)) return null; // the circle calculator does not apply at corners
  let stitch = opts.stitch;
  if (!stitch) {
    const tally = new Map<string, number>();
    for (let id = R.first; id >= 0 && id <= R.last; id++) {
      const n = graph.nodes[id];
      const t = n.countsAs ?? n.type;
      if (['sc', 'hdc', 'dc', 'tr', 'dtr'].includes(t)) tally.set(t, (tally.get(t) ?? 0) + 1);
    }
    stitch = ([...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'sc') as BaseType;
  }
  let order = opts.order;
  if (!order) {
    const sym = opts.symmetry ?? analyzeSymmetry(graph);
    order = round > 0 ? (sym.rounds[round - 1]?.cumulative ?? sym.order) : (sym.rounds[0]?.order ?? sym.order);
  }
  const prev = round > 0 ? flat.rounds[round - 1] : undefined;
  if (!prev || prev.class === 'n/a') return suggestCounts({ stitch, order, params, rho: Math.max(fr.rho, stitchParam(params, stitch).height) });
  return suggestCounts({ stitch, order, params, rPrev: prev.r });
}
