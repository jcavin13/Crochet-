/**
 * Lexer for `.cro` text.
 *
 * Two levels:
 *  1. `splitLines` classifies physical lines (blank / header / round label / continuation) after
 *     stripping `#` comments. Round text runs from after the label's colon to the next label,
 *     header or end of file (notation.md section 1).
 *  2. `tokenize` turns a stretch of round text into tokens with exact 1-based positions
 *     (columns in UTF-16 code units, end exclusive).
 *
 * Word normalisation done here, so the parser never has to care:
 *  - `x6` / `×6` → `x` `6`; `5sc` → `5` `sc`; `2nd`, `third` → ORDINAL;
 *  - en/em dashes → `-`;
 *  - articles (`the`, `a`, `an`) are dropped (notation.md section 2).
 */

export type TokKind = 'word' | 'int' | 'ordinal' | 'punct' | 'bad';

export interface Token {
  kind: TokKind;
  /** text as written */
  text: string;
  /** lower-cased text (punctuation: the normalised character) */
  low: string;
  /** numeric value for int / ordinal */
  value?: number;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};
/** "first" stays a word (it is also the place `first st`); the parser handles `first ch from hook`. */
const ARTICLES = new Set(['the', 'a', 'an']);
const PUNCT = new Set([',', ';', '.', '(', ')', '[', ']', '*', '-', '+', ':']);

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_']/u.test(ch);
}

/**
 * Tokenize `text`, which starts at (line, col) of the source (col is 1-based).
 * Tokens never span lines; callers tokenize line by line and concatenate.
 */
export function tokenize(text: string, line: number, col: number): Token[] {
  const out: Token[] = [];
  let i = 0;
  const mk = (kind: TokKind, t: string, low: string, start: number, end: number, value?: number): Token => ({
    kind, text: t, low, value, line, col: col + start, endLine: line, endCol: col + end,
  });
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '×') { out.push(mk('word', ch, 'x', i, i + 1)); i++; continue; }
    if (ch === '–' || ch === '—') { out.push(mk('punct', ch, '-', i, i + 1)); i++; continue; }
    if (PUNCT.has(ch)) { out.push(mk('punct', ch, ch, i, i + 1)); i++; continue; }
    if (isWordChar(ch)) {
      let j = i;
      while (j < text.length && isWordChar(text[j])) j++;
      const w = text.slice(i, j);
      pushWord(out, w, i, mk);
      i = j;
      continue;
    }
    out.push(mk('bad', ch, ch, i, i + 1));
    i++;
  }
  return out;
}

function pushWord(
  out: Token[],
  w: string,
  start: number,
  mk: (kind: TokKind, t: string, low: string, s: number, e: number, v?: number) => Token,
): void {
  const low = w.toLowerCase();
  let m: RegExpExecArray | null;
  if (/^\d+$/.test(low)) { out.push(mk('int', w, low, start, start + w.length, parseInt(low, 10))); return; }
  if ((m = /^(\d+)(st|nd|rd|th)$/.exec(low))) {
    out.push(mk('ordinal', w, low, start, start + w.length, parseInt(m[1], 10)));
    return;
  }
  if ((m = /^x(\d+)$/.exec(low))) {
    out.push(mk('word', w[0], 'x', start, start + 1));
    out.push(mk('int', m[1], m[1], start + 1, start + w.length, parseInt(m[1], 10)));
    return;
  }
  if ((m = /^(\d+)([a-z].*)$/.exec(low))) {
    const n = m[1].length;
    out.push(mk('int', w.slice(0, n), m[1], start, start + n, parseInt(m[1], 10)));
    pushWord(out, w.slice(n), start + n, mk);
    return;
  }
  if (low in ORDINAL_WORDS && low !== 'first') {
    out.push(mk('ordinal', w, low, start, start + w.length, ORDINAL_WORDS[low]));
    return;
  }
  if (ARTICLES.has(low)) return;
  out.push(mk('word', w, low, start, start + w.length));
}

// ---------------------------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------------------------

export interface LabelMatch {
  kind: 'round' | 'row' | 'foundation';
  word: string;
  from: number;
  to: number;
  range: boolean;
  /** 0-based index in the line where the label starts / where the text after ':' starts */
  start: number;
  end: number;
  /** 0-based index just after the label (before the colon) */
  labelEnd: number;
}

const LABEL_RE = /^(\s*)(rnds?|rounds?|r|rows?)\s*(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?\s*:/i;
const FOUNDATION_RE = /^(\s*)(foundation|start|setup)\s*:/i;
const HEADER_RE = /^(\s*)([A-Za-z][\w-]*)\s*:(.*)$/;

export function matchLabel(line: string): LabelMatch | undefined {
  let m = LABEL_RE.exec(line);
  if (m) {
    const word = m[2];
    const lw = word.toLowerCase();
    const kind = lw.startsWith('row') ? 'row' : 'round';
    const from = parseInt(m[3], 10);
    const to = m[4] !== undefined ? parseInt(m[4], 10) : from;
    return {
      kind, word, from, to, range: m[4] !== undefined,
      start: m[1].length, end: m[0].length, labelEnd: m[0].replace(/\s*:$/, '').length,
    };
  }
  m = FOUNDATION_RE.exec(line);
  if (m) {
    return {
      kind: 'foundation', word: m[2], from: 0, to: 0, range: false,
      start: m[1].length, end: m[0].length, labelEnd: m[0].replace(/\s*:$/, '').length,
    };
  }
  return undefined;
}

export interface HeaderMatch {
  key: string;
  value: string;
  keyStart: number;
  valueStart: number;
}

export function matchHeader(line: string): HeaderMatch | undefined {
  const m = HEADER_RE.exec(line);
  if (!m) return undefined;
  const rest = m[3];
  const lead = rest.length - rest.trimStart().length;
  const valueStart = m[0].length - rest.length + lead;
  return { key: m[2].toLowerCase(), value: rest.trim(), keyStart: m[1].length, valueStart };
}

/** Remove a `#` comment (to end of line). */
export function stripComment(line: string): string {
  const k = line.indexOf('#');
  return k < 0 ? line : line.slice(0, k);
}
