/**
 * Text-level helpers for notation edits: span ⇄ offset, applying replacements, printing single
 * items in the pattern's own dialect, and the AST-round ⇄ graph-round map.
 */
import type { Graph } from '../graph';
import type { Item, PatternAst, RoundAst, Span } from '../notation';
import { print } from '../notation';

/** Replace text[from, to) with `insert` (offsets into the ORIGINAL text). */
export interface TextEdit { from: number; to: number; insert: string }

export const DUMMY: Span = { line: 1, col: 1, endLine: 1, endCol: 1 };

export class LineIndex {
  private starts: number[] = [0];
  constructor(public text: string) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
  }
  offset(line: number, col: number): number {
    const s = this.starts[Math.max(0, Math.min(this.starts.length - 1, line - 1))] ?? 0;
    return s + col - 1;
  }
  start(sp: Span): number { return this.offset(sp.line, sp.col); }
  end(sp: Span): number { return this.offset(sp.endLine, sp.endCol); }
  /** 1-based line of an offset. */
  lineOf(off: number): number {
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.starts[m] <= off) lo = m; else hi = m - 1; }
    return lo + 1;
  }
  lineEnd(line: number): number {
    const next = this.starts[line];
    return next === undefined ? this.text.length : next - 1;
  }
}

export function applyEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.from - a.from || b.to - a.to);
  let out = text;
  let guard = Infinity;
  for (const e of sorted) {
    if (e.to > guard) throw new Error('overlapping edits');
    out = out.slice(0, e.from) + e.insert + out.slice(e.to);
    guard = e.from;
  }
  return out;
}

/** Print items in the pattern's dialect, e.g. "ch 3" or "*sc in next 5 sts, 2 sc in next st* x6". */
export function printItems(items: Item[], ast: PatternAst): string {
  const round: RoundAst = { label: { kind: 'round', word: 'Rnd', from: 1, to: 1, range: false, span: DUMMY }, items, span: DUMMY };
  const s = print({ headers: [], terms: ast.terms, rounds: [round] }, { terms: ast.terms }).trim();
  return s.replace(/^Rnd 1: /, '').replace(/\.$/, '');
}

/** For every graph round: the AST round it came from and its offset inside a range label. */
export function roundMap(ast: PatternAst, graph: Graph): { ast: number; k: number }[] | null {
  const out: { ast: number; k: number }[] = [];
  ast.rounds.forEach((r, a) => {
    const n = r.label.range ? r.label.to - r.label.from + 1 : 1;
    for (let k = 0; k < n; k++) out.push({ ast: a, k });
  });
  return out.length === graph.rounds.length ? out : null;
}

/** Visit every item (depth first) with its parent chain. */
export function walkItems(items: Item[], cb: (it: Item, parents: Item[]) => void, parents: Item[] = []): void {
  for (const it of items) {
    cb(it, parents);
    if (it.kind === 'repeat' || it.kind === 'group') walkItems(it.items, cb, [...parents, it]);
  }
}
