/**
 * Count annotations: recompute every round's "(N …)" from the compiled graph and rewrite the
 * numbers that changed (notation.md 3.8 — same units the compiler checks).
 */
import type { Graph, Pattern } from '../graph';
import { compile, stitchCounting } from '../graph';
import type { CountPart, PatternAst } from '../notation';
import { parse } from '../notation';
import { LineIndex, applyEdits, roundMap, type TextEdit } from './text';

/** The number a count part should say for graph round r, or undefined if it is not checkable. */
export function actualCount(p: CountPart, graph: Graph, r: number): number | undefined {
  const R = graph.rounds[r];
  if (!R) return undefined;
  const nodes = R.first >= 0 ? graph.nodes.slice(R.first, R.last + 1) : [];
  const u = p.unit;
  switch (u.kind) {
    case 'st': return R.stitchCount;
    case 'type':
      if (u.type === 'ch' || u.type === 'slst') return undefined;
      if (u.type === 'picot' || u.type === 'puff' || u.type === 'popcorn') return nodes.filter((x) => x.type === u.type).length;
      return nodes.filter((x) => stitchCounting(x) && (x.countsAs === u.type || (x.type === u.type && x.tag !== 'cluster'))).length;
    case 'cl': return nodes.filter((x) => x.tag === 'cluster').length;
    case 'spaces': return graph.spaces.filter((s) => s.round === r && s.kind === 'chsp' && (u.chains === undefined || s.chains.length === u.chains)).length;
    case 'group': return new Set(nodes.filter((x) => x.group?.kind === u.group).map((x) => x.group!.id)).size;
    case 'unknown': return undefined;
  }
}

/** Compile ignoring count annotations (so a stale count is not an error). */
export function compileIgnoringCounts(ast: PatternAst, text?: string): { pattern?: Pattern; errors: number; diagnostics: ReturnType<typeof compile>['diagnostics'] } {
  const bare: PatternAst = { ...ast, rounds: ast.rounds.map((r) => ({ ...r, count: undefined })) };
  const c = compile(bare, text !== undefined ? { notation: text } : {});
  const errors = c.diagnostics.filter((d) => d.severity === 'error').length;
  return { pattern: errors ? undefined : c.pattern, errors, diagnostics: c.diagnostics };
}

export interface CountUpdate {
  text: string;
  /** Count edits made (offsets into the input text). */
  edits: TextEdit[];
  /** False when the pattern does not compile even without its counts, or a range label's rounds would need different counts. */
  ok: boolean;
}

/**
 * Rewrite the count annotations of `text` so they match what the rounds make. With `limitAst`,
 * only the rounds before that AST round are compiled and updated (the rest may not compile).
 */
export function updateCountAnnotations(text: string, limitAst?: number): CountUpdate {
  const p0 = parse(text);
  if (p0.diagnostics.some((d) => d.severity === 'error')) return { text, edits: [], ok: false };
  const p = limitAst === undefined ? p0 : { ...p0, ast: { ...p0.ast, rounds: p0.ast.rounds.slice(0, limitAst) } };
  const c = compileIgnoringCounts(p.ast, text);
  if (!c.pattern) return { text, edits: [], ok: false };
  const map = roundMap(p.ast, c.pattern.graph);
  if (!map) return { text, edits: [], ok: false };
  const li = new LineIndex(text);
  const edits: TextEdit[] = [];
  let ok = true;
  p.ast.rounds.forEach((ra, a) => {
    if (!ra.count) return;
    const gs = map.map((m, g) => (m.ast === a ? g : -1)).filter((g) => g >= 0);
    for (const part of ra.count.parts) {
      const vals = gs.map((g) => actualCount(part, c.pattern!.graph, g));
      if (vals.some((v) => v === undefined)) continue;
      if (new Set(vals).size > 1) { ok = false; continue; }
      const v = vals[0]!;
      if (v === part.n) continue;
      const from = li.start(part.span);
      const m = /^\d+/.exec(text.slice(from, li.end(part.span)));
      if (!m) { ok = false; continue; }
      edits.push({ from, to: from + m[0].length, insert: String(v) });
    }
  });
  return { text: edits.length ? applyEdits(text, edits) : text, edits, ok };
}
