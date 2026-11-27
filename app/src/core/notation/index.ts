/**
 * Public API of the notation package: text ⇄ AST, and the one-call text → pattern convenience.
 *
 *   parse(text)                 → { ast, diagnostics }
 *   print(ast, { terms })       → canonical notation text (US or UK)
 *   compilePattern(text)        → { pattern?, ast, diagnostics }   (pattern only if no errors)
 *   formatDiagnostic(d, file?)  → "file:line:col severity CODE message"
 */
import { compile } from '../graph/compile';
import type { Diagnostic, Pattern } from '../graph/types';
import type { PatternAst } from './ast';
import { parse } from './parser';

export type * from './ast';
export { parse, KNOWN_HEADERS } from './parser';
export type { ParseResult } from './parser';
export { print } from './printer';
export type { PrintOptions } from './printer';
export { tokenize } from './lexer';
export type { Token } from './lexer';
export { baseFromWord, nameOf, suggestions, tchHeight, typeCounts, unknownStitchHint } from './vocab';

export interface CompilePatternResult {
  /** Present only when there are no errors. `pattern.notation` is the source text. */
  pattern?: Pattern;
  ast?: PatternAst;
  /** Parse and compile diagnostics, sorted by position. */
  diagnostics: Diagnostic[];
}

/** Parse + compile in one go. */
export function compilePattern(text: string): CompilePatternResult {
  const p = parse(text);
  const c = compile(p.ast, { notation: text });
  const diagnostics = sortDiagnostics([...p.diagnostics, ...c.diagnostics]);
  const hasError = diagnostics.some((d) => d.severity === 'error');
  return { pattern: hasError ? undefined : c.pattern, ast: p.ast, diagnostics };
}

export function sortDiagnostics(ds: Diagnostic[]): Diagnostic[] {
  return ds
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d.line - b.d.line || a.d.col - b.d.col || a.i - b.i)
    .map((x) => x.d);
}

/** "file:line:col severity CODE message" (file omitted when not given). */
export function formatDiagnostic(d: Diagnostic, file?: string): string {
  return `${file ? `${file}:` : ''}${d.line}:${d.col} ${d.severity} ${d.code} ${d.message}`;
}
