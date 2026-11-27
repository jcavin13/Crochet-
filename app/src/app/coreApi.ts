// The ONLY place the shell (src/app, src/store, src/features/{editor,gallery,library}) imports
// src/core from. Integration with the compiler is a change to this file alone.
//
// The types below mirror spec/pattern.schema.json and the core contract. Assigning the core
// compiler's result to `CompileResult` (below) makes tsc flag any drift between the two.
import { compilePattern as coreCompile } from '@/core/notation';

export type Severity = 'error' | 'warning' | 'info';

export type Diagnostic = {
  severity: Severity;
  code: string;
  message: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  round?: number;
};

export type StitchType = 'ch' | 'slst' | 'sc' | 'hdc' | 'dc' | 'tr' | 'dtr' | 'puff' | 'popcorn' | 'picot';
export type Anchor = { node: number } | { space: number };
export type GraphNode = {
  id: number; type: StitchType; round: number; into: Anchor[];
  loop?: 'flo' | 'blo' | 'fp' | 'bp'; role?: 'tch'; countsAs?: StitchType; tag?: 'cluster';
  legs?: number; loops?: number; chains?: number;
  group?: { kind: 'inc' | 'shell' | 'v'; id: number };
  src?: { line: number; col: number; endLine?: number; endCol?: number };
};
export type GraphSpace = { id: number; kind: 'chsp' | 'ring'; round: number; chains: number[] };
export type GraphRound = {
  index: number; label: string; kind: 'round' | 'row' | 'foundation';
  joined?: boolean; turned?: boolean; first: number; last: number;
  stitchCount: number; declaredCount?: number;
  src?: { line: number; endLine?: number };
};
export type Pattern = {
  format: 'crochet-pattern';
  version: '0.1';
  meta: {
    title: string; terms?: 'US' | 'UK'; yarn?: string; hook?: string; params?: string; source?: string;
    license?: string; author?: string; year?: string; notes?: string; extra?: Record<string, string>;
  };
  notation?: string;
  graph: { nodes: GraphNode[]; spaces: GraphSpace[]; rounds: GraphRound[] };
};

export type CompileResult = { pattern?: Pattern; diagnostics: Diagnostic[] };

const realCompile: ((text: string) => CompileResult) | undefined = coreCompile;

/**
 * True when the real compiler is wired in. (If core ever has to be unplugged, set realCompile to
 * undefined: the UI then shows "checker pending" and the stub below answers.)
 */
export const compilerAvailable = typeof realCompile === 'function';

function stubCompile(_text: string): CompileResult {
  return {
    diagnostics: [{
      severity: 'info', code: 'I_NO_COMPILER', message: 'Compiler not available yet — notation is saved but not checked.',
      line: 1, col: 1, endLine: 1, endCol: 1,
    }],
  };
}

// Small LRU so several views of the same text share one compile.
const cache = new Map<string, CompileResult>();
const CACHE_MAX = 24;

/** Compile notation text. Never throws: compiler crashes become an error diagnostic. */
export function compilePattern(text: string): CompileResult {
  const hit = cache.get(text);
  if (hit) {
    cache.delete(text);
    cache.set(text, hit);
    return hit;
  }
  let res: CompileResult;
  try {
    res = compilerAvailable ? realCompile!(text) : stubCompile(text);
    if (!res || !Array.isArray(res.diagnostics)) res = { ...res, diagnostics: [] };
  } catch (e) {
    res = {
      diagnostics: [{
        severity: 'error', code: 'E_INTERNAL', message: `The compiler crashed: ${(e as Error)?.message ?? e}`,
        line: 1, col: 1, endLine: 1, endCol: 1,
      }],
    };
  }
  cache.set(text, res);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return res;
}

/** Minimal structural check for imported `.crochet.json` graphs. */
export function isPatternJson(x: unknown): x is Pattern {
  const p = x as Pattern;
  return !!p && typeof p === 'object' && p.format === 'crochet-pattern' && !!p.graph
    && Array.isArray(p.graph.nodes) && Array.isArray(p.graph.spaces) && Array.isArray(p.graph.rounds);
}
