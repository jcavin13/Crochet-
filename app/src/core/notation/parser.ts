/**
 * Recursive-descent parser: `.cro` text → AST + diagnostics (notation.md sections 1, 2, 4).
 *
 * Error recovery: each round is parsed independently; inside a round an error skips to the next
 * item separator (`,` `;` `.`) at the same bracket depth, so several errors are reported in one
 * pass. Rounds containing a parse error are marked `broken` for the compiler.
 */
import type { Diagnostic, DiagnosticCode, Severity, Terms } from '../graph/types';
import type {
  BaseType, ChainItem, CountAnn, CountPart, CountUnit, CountsAs, Extent, GroupItem, HeaderAst, Item,
  LoopModAst, PatternAst, Place, RepeatItem, RoundAst, RoundLabel, Span, StitchItem, StitchSpec,
  Target, Times, Unit,
} from './ast';
import { matchHeader, matchLabel, stripComment, tokenize, type Token } from './lexer';
import { baseFromWord, unknownStitchHint } from './vocab';

export interface ParseResult {
  ast: PatternAst;
  diagnostics: Diagnostic[];
}

export const KNOWN_HEADERS = new Set([
  'title', 'terms', 'yarn', 'hook', 'source', 'license', 'author', 'year', 'notes', 'params', 'colors',
]);

interface Chunk {
  label: RoundLabel;
  tokens: Token[];
  firstLine: number;
  lastLine: number;
}

/** Parse a whole `.cro` file. Never throws. */
export function parse(text: string): ParseResult {
  const diags: Diagnostic[] = [];
  const add = (severity: Severity, code: DiagnosticCode, message: string, s: Span) =>
    diags.push({ severity, code, message, ...s });

  const lines = text.split(/\r\n|\r|\n/);
  const headers: HeaderAst[] = [];
  const chunks: Chunk[] = [];
  let cur: Chunk | undefined;

  lines.forEach((rawLine, li) => {
    const lineNo = li + 1;
    const line = stripComment(rawLine);
    if (line.trim() === '') return;
    const label = matchLabel(line);
    if (label) {
      const labelAst: RoundLabel = {
        kind: label.kind, word: label.word, from: label.from, to: label.to, range: label.range,
        span: { line: lineNo, col: label.start + 1, endLine: lineNo, endCol: label.labelEnd + 1 },
      };
      if (label.parity) labelAst.parity = label.parity;
      cur = { label: labelAst, tokens: tokenize(line.slice(label.end), lineNo, label.end + 1), firstLine: lineNo, lastLine: lineNo };
      chunks.push(cur);
      return;
    }
    const header = matchHeader(line);
    if (header) {
      headers.push({
        key: header.key, value: header.value,
        span: { line: lineNo, col: header.keyStart + 1, endLine: lineNo, endCol: line.trimEnd().length + 1 },
      });
      cur = undefined;
      return;
    }
    if (cur) {
      cur.tokens.push(...tokenize(line, lineNo, 1));
      cur.lastLine = lineNo;
      return;
    }
    // "Fasten off." on its own line after a header line that followed the rounds (notes: …):
    // it still ends the last round.
    if (chunks.length > 0 && isFastenOffLine(line)) {
      const last = chunks[chunks.length - 1];
      last.tokens.push(...tokenize(line, lineNo, 1));
      last.lastLine = lineNo;
      return;
    }
    const lead = line.length - line.trimStart().length;
    add('error', 'E_SYNTAX',
      `expected a header line like "title: My pattern" or a round label like "Rnd 1:" but found "${line.trim()}".`,
      { line: lineNo, col: lead + 1, endLine: lineNo, endCol: line.trimEnd().length + 1 });
  });

  // Headers: terms first, since it decides how stitch names are read.
  let terms: Terms = 'US';
  for (const h of headers) {
    if (h.key === 'terms') {
      const v = h.value.trim().toUpperCase();
      if (v === 'US' || v === 'UK') terms = v;
      else add('error', 'E_SYNTAX', `terms must be "US" or "UK" but found "${h.value}".`, h.span);
    } else if (!KNOWN_HEADERS.has(h.key)) {
      add('warning', 'W_UNKNOWN_HEADER',
        `unknown header "${h.key}" — kept in meta.extra. Known headers: ${[...KNOWN_HEADERS].join(', ')}.`, h.span);
    }
  }

  const rounds: RoundAst[] = [];
  for (const c of chunks) {
    const before = diags.length;
    const p = new RoundParser(c.tokens, terms, diags);
    const { items, count } = p.parseRound();
    const lastTok = c.tokens[c.tokens.length - 1];
    const r: RoundAst = {
      label: c.label,
      items,
      count,
      span: {
        line: c.firstLine, col: c.label.span.col,
        endLine: lastTok ? lastTok.endLine : c.firstLine,
        endCol: lastTok ? lastTok.endCol : c.label.span.endCol + 1,
      },
    };
    if (diags.slice(before).some((d) => d.severity === 'error')) r.broken = true;
    rounds.push(r);
  }
  if (chunks.length === 0 && !diags.some((d) => d.severity === 'error')) {
    const last = Math.max(1, lines.length);
    add('error', 'E_SYNTAX', 'the pattern has no rounds — expected at least one line like "Rnd 1: mr, 6 sc in ring. (6)".',
      { line: last, col: 1, endLine: last, endCol: 1 });
  }

  return { ast: { headers, terms, rounds }, diagnostics: diags };
}

// ---------------------------------------------------------------------------------------------

interface Ctx {
  /** inside *...*: a `*` or `rep from *` ends the sequence */
  inRepeat: boolean;
  /** inside ( ) or [ ]: a closing bracket ends the sequence */
  inGroup: boolean;
}

const SEPS = new Set([',', ';', '.']);
const PREPS = new Set(['in', 'into', 'around', 'on', 'over']);
const SPACE_WORDS = new Set(['sp', 'sps', 'space', 'spaces', 'lp', 'lps', 'loop', 'loops']);
const ST_WORDS = new Set(['st', 'sts', 'stitch', 'stitches']);
const CH_WORDS = new Set(['ch', 'chs', 'chain', 'chains']);
/** words that cannot appear in a count annotation unit (they mean it is really a group) */
const NOT_COUNT_WORDS = new Set(['in', 'into', 'next', 'each', 'same', 'around', 'over', 'on', 'from', 'first', 'top']);

class ParseError extends Error {}

const FASTEN_LINE_RE = /^\s*(fasten\s+off|finish\s+off|fo)\b(\s+and\s+weave\s+in(\s+the)?\s+(yarn\s+)?ends)?[\s.;,!]*$/i;

/** A line that says nothing but "Fasten off." (optionally "…and weave in ends"). */
export function isFastenOffLine(line: string): boolean {
  return FASTEN_LINE_RE.test(line);
}

class RoundParser {
  private i = 0;
  constructor(private toks: Token[], private terms: Terms, private diags: Diagnostic[]) {}

  // ----- token helpers -------------------------------------------------------------------------

  private peek(k = 0): Token | undefined { return this.toks[this.i + k]; }
  private isWord(t: Token | undefined, ...words: string[]): boolean {
    return !!t && t.kind === 'word' && (words.length === 0 || words.includes(t.low));
  }
  private isPunct(t: Token | undefined, ...ps: string[]): boolean {
    return !!t && t.kind === 'punct' && ps.includes(t.low);
  }
  private isSep(t: Token | undefined): boolean { return !!t && t.kind === 'punct' && SEPS.has(t.low); }
  private isInt(t: Token | undefined): boolean { return !!t && t.kind === 'int'; }

  private spanOf(a: Token, b: Token): Span {
    return { line: a.line, col: a.col, endLine: b.endLine, endCol: b.endCol };
  }
  private spanFrom(start: number): Span {
    const a = this.toks[start];
    const b = this.toks[Math.max(start, this.i - 1)];
    return this.spanOf(a, b);
  }
  private endSpan(): Span {
    const last = this.toks[this.toks.length - 1];
    if (!last) return { line: 1, col: 1, endLine: 1, endCol: 1 };
    return { line: last.endLine, col: last.endCol, endLine: last.endLine, endCol: last.endCol };
  }
  private found(t: Token | undefined): string {
    return t ? `"${t.text}"` : 'the end of the round';
  }
  private err(code: DiagnosticCode, message: string, span: Span): void {
    this.diags.push({ severity: 'error', code, message, ...span });
  }
  private tokSpan(t: Token | undefined): Span {
    return t ? this.spanOf(t, t) : this.endSpan();
  }
  /** E_SYNTAX at the current token and throw to the item-level recovery. */
  private fail(expected: string): never {
    const t = this.peek();
    this.err('E_SYNTAX', `expected ${expected} but found ${this.found(t)}.`, this.tokSpan(t));
    throw new ParseError();
  }
  private expectWord(expected: string, ...words: string[]): Token {
    const t = this.peek();
    if (!this.isWord(t, ...words)) this.fail(expected);
    this.i++;
    return t!;
  }

  private isRepFrom(k = 0): boolean {
    return this.isWord(this.peek(k), 'rep', 'repeat') && this.isWord(this.peek(k + 1), 'from');
  }
  private isStopper(t: Token | undefined, ctx: Ctx): boolean {
    if (!t) return true;
    if (ctx.inGroup && this.isPunct(t, ')', ']')) return true;
    if (ctx.inRepeat && (this.isPunct(t, '*') || this.isRepFrom())) return true;
    return false;
  }

  /** Skip to the next separator / stopper at bracket depth 0 (item-level recovery). */
  private recover(ctx: Ctx): void {
    let depth = 0;
    while (this.i < this.toks.length) {
      const t = this.toks[this.i];
      if (depth === 0 && (this.isSep(t) || this.isStopper(t, ctx))) return;
      if (this.isPunct(t, '(', '[')) depth++;
      if (this.isPunct(t, ')', ']')) {
        if (depth === 0) {
          if (ctx.inGroup) return;
          // a stray closer belongs to the broken item (e.g. "(counts as zz)"): skip it
        } else depth--;
      }
      this.i++;
    }
  }

  // ----- round ---------------------------------------------------------------------------------

  parseRound(): { items: Item[]; count?: CountAnn } {
    const count = this.extractCount();
    const items: Item[] = [];
    const ctx: Ctx = { inRepeat: false, inGroup: false };
    while (this.i < this.toks.length) {
      items.push(...this.parseSequence(ctx));
      const t = this.peek();
      if (!t) break;
      // stray closer at top level
      if (this.isPunct(t, ')', ']')) {
        this.err('E_SYNTAX', `found "${t.text}" without a matching "${t.low === ')' ? '(' : '['}".`, this.tokSpan(t));
      } else if (this.isPunct(t, '*')) {
        this.err('E_SYNTAX', 'found "*" here but no repeat is open.', this.tokSpan(t));
      } else {
        this.err('E_SYNTAX', `expected "," between items but found ${this.found(t)}.`, this.tokSpan(t));
      }
      this.i++;
    }
    return { items, count };
  }

  /**
   * A parenthesised item at the very end of the round that matches the count grammar is a count
   * annotation (notation.md section 2). Detect it first and cut it off the token list.
   */
  private extractCount(): CountAnn | undefined {
    // "… (12) fasten off": a trailing fasten off may follow the count (notation.md section 2).
    const tail = this.cutFastenTail();
    const count = this.extractCountBody();
    if (tail.length) {
      // keep it as the last item; a separator token makes "inc x6 (12) fasten off" parse like
      // "inc x6, fasten off"
      const f = tail[0];
      this.toks.push({ ...f, kind: 'punct', text: ',', low: ',', value: undefined, endLine: f.line, endCol: f.col }, ...tail);
    }
    return count;
  }

  /**
   * Remove a trailing `fasten off` / `finish off` / `fo` (optionally followed by "and weave in
   * ends") from the token list and return its tokens.
   */
  private cutFastenTail(): Token[] {
    let end = this.toks.length;
    while (end > 0 && this.isSep(this.toks[end - 1])) end--;
    let k = end;
    // optional "and weave in (the) (yarn) ends" (articles are already dropped by the lexer)
    const w = (i: number, ...words: string[]) => i >= 0 && this.isWord(this.toks[i], ...words);
    if (w(k - 1, 'ends')) {
      let j = k - 2;
      if (w(j, 'yarn')) j--;
      if (w(j, 'in') && w(j - 1, 'weave') && w(j - 2, 'and')) k = j - 2;
    }
    let start = -1;
    if (w(k - 1, 'off') && w(k - 2, 'fasten', 'finish')) start = k - 2;
    else if (w(k - 1, 'fo')) start = k - 1;
    if (start < 0) return [];
    // not when it sits inside an unclosed group (that is a different error)
    const tail = this.toks.slice(start, k);
    let depth = 0;
    for (let i = 0; i < start; i++) {
      if (this.isPunct(this.toks[i], '(', '[')) depth++;
      else if (this.isPunct(this.toks[i], ')', ']')) depth--;
    }
    if (depth !== 0) return [];
    this.toks = this.toks.slice(0, start);
    return tail;
  }

  private extractCountBody(): CountAnn | undefined {
    let end = this.toks.length;
    while (end > 0 && this.isSep(this.toks[end - 1])) end--;
    if (end === 0 || !this.isPunct(this.toks[end - 1], ')')) return undefined;
    let depth = 0;
    let open = -1;
    for (let k = end - 1; k >= 0; k--) {
      if (this.isPunct(this.toks[k], ')')) depth++;
      else if (this.isPunct(this.toks[k], '(')) {
        depth--;
        if (depth === 0) { open = k; break; }
      }
    }
    if (open < 0) return undefined;
    const inner = this.toks.slice(open + 1, end - 1);
    const parts = this.parseCountParts(inner);
    if (!parts) return undefined;
    const span = this.spanOf(this.toks[open], this.toks[end - 1]);
    this.toks = this.toks.slice(0, open);
    return { parts, span };
  }

  private parseCountParts(inner: Token[]): CountPart[] | undefined {
    if (inner.length === 0) return undefined;
    const groups: Token[][] = [[]];
    for (const t of inner) {
      if (this.isPunct(t, ',', ';')) groups.push([]);
      else groups[groups.length - 1].push(t);
    }
    const parts: CountPart[] = [];
    for (const g of groups) {
      if (g.length === 0 || g[0].kind !== 'int') return undefined;
      const rest = g.slice(1);
      for (const t of rest) {
        if (t.kind === 'word' && NOT_COUNT_WORDS.has(t.low)) return undefined;
        if (t.kind === 'punct' && t.low !== '-') return undefined;
        if (t.kind === 'bad' || t.kind === 'ordinal') return undefined;
      }
      const text = rest.map((t) => t.text).join(' ').replace(/ - /g, '-').replace(/ -|- /g, '-');
      parts.push({
        n: g[0].value!,
        unit: this.countUnit(rest),
        text,
        span: this.spanOf(g[0], g[g.length - 1]),
      });
    }
    return parts;
  }

  private countUnit(ts: Token[]): CountUnit {
    const words = ts.map((t) => t.low);
    const s = words.join(' ').replace(/ - /g, '-').replace(/ -|- /g, '-');
    if (s === '') return { kind: 'st' };
    if (ST_WORDS.has(s)) return { kind: 'st' };
    let m: RegExpExecArray | null;
    if ((m = /^ch-?\s?(\d+)[- ](sp|sps|space|spaces|lp|lps|loop|loops)$/.exec(s))) return { kind: 'spaces', chains: parseInt(m[1], 10) };
    if (/^(ch-?\s?)?(sp|sps|space|spaces|lp|lps|loop|loops)$/.test(s)) return { kind: 'spaces' };
    if (/^(cl|cls|cluster|clusters|bobble|bobbles)$/.test(s)) return { kind: 'cl' };
    if (/^(puff|puffs|puff sts|puff st|puff stitches)$/.test(s)) return { kind: 'type', type: 'puff' };
    if (/^(pc|pcs|popcorn|popcorns|pop|pops)$/.test(s)) return { kind: 'type', type: 'popcorn' };
    if (/^(picot|picots|p|ps)$/.test(s)) return { kind: 'type', type: 'picot' };
    if (/^(shell|shells)$/.test(s)) return { kind: 'group', group: 'shell' };
    if (/^(v-?\s?sts?|vsts?|v-stitch(es)?|vs)$/.test(s)) return { kind: 'group', group: 'v' };
    if (/^(sl st|sl sts|slip sts?)$/.test(s)) return { kind: 'type', type: 'slst' };
    if (CH_WORDS.has(s)) return { kind: 'type', type: 'ch' };
    if (ts.length === 1) {
      const w = ts[0].low;
      const b = baseFromWord(w, this.terms) ?? (w.endsWith('s') ? baseFromWord(w.slice(0, -1), this.terms) : undefined);
      if (b) return { kind: 'type', type: b };
    }
    return { kind: 'unknown' };
  }

  // ----- sequences -----------------------------------------------------------------------------

  private parseSequence(ctx: Ctx): Item[] {
    const items: Item[] = [];
    for (;;) {
      while (this.isSep(this.peek())) this.i++;
      const t = this.peek();
      if (!t || this.isStopper(t, ctx)) break;
      if (this.isPunct(t, ')', ']')) break;
      const start = this.i;
      try {
        if (this.isRepFrom()) {
          this.err('E_SYNTAX', '"rep from *" but no "*" was opened earlier in this round.', this.tokSpan(t));
          throw new ParseError();
        }
        const item = this.parseItem(ctx);
        if (item) items.push(item);
        const n = this.peek();
        if (n && !this.isSep(n) && !this.isStopper(n, ctx)) {
          if (this.isPunct(n, ')', ']') && !ctx.inGroup) break; // reported by the caller
          this.err('E_SYNTAX', `expected "," before the next item but found ${this.found(n)}.`, this.tokSpan(n));
          throw new ParseError();
        }
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        if (this.i === start) this.i++;
        this.recover(ctx);
      }
    }
    return items;
  }

  private parseItem(ctx: Ctx): Item | null {
    const t = this.peek()!;
    const n1 = this.peek(1);
    if (this.isPunct(t, '*')) return this.parseRepeat(ctx);
    if (this.isPunct(t, '(', '[')) return this.parseGroup(ctx);
    if (t.kind === 'int' && this.isWord(n1, 'ch', 'chain') && !this.isPunct(this.peek(2), '-') && !this.isSpaceWord(this.peek(2))) {
      // "3 ch" (vintage word order) == "ch 3"
      const start = this.i;
      this.i += 2;
      return this.finishChain(start, t.value!);
    }
    if (t.kind === 'word') {
      switch (t.low) {
        case 'ch':
        case 'chain':
          if (this.isPunct(n1, '-') && this.isInt(this.peek(2)) && this.isWord(this.peek(3), 'picot', 'p')) break;
          return this.parseChain();
        case 'sk':
        case 'skip':
        case 'miss':
          return this.parseSkip();
        case 'join':
          return this.parseJoin();
        case 'form':
          if (this.isWord(n1, 'ring')) {
            const start = this.i;
            this.i += 2;
            return { kind: 'ringJoin', span: this.spanFrom(start) };
          }
          break;
        case 'mr':
          this.i++;
          return { kind: 'ring', span: this.tokSpan(t) };
        case 'magic':
          if (this.isWord(n1, 'ring', 'circle', 'loop')) {
            const start = this.i;
            this.i += 2;
            return { kind: 'ring', span: this.spanFrom(start) };
          }
          break;
        case 'turn':
          this.i++;
          return { kind: 'turn', span: this.tokSpan(t) };
        case 'fo':
          this.i++;
          return { kind: 'fasten', span: this.tokSpan(t) };
        case 'fasten':
        case 'finish':
          if (this.isWord(n1, 'off')) {
            const start = this.i;
            this.i += 2;
            return { kind: 'fasten', span: this.spanFrom(start) };
          }
          break;
        case 'working':
          return this.parseOtherSide();
        case 'counts':
        case 'does':
          break;
      }
    }
    return this.parseStitch(ctx);
  }

  /**
   * "working along the other side of the chain" / "working along opposite side of foundation ch" /
   * "working in unused loops of foundation ch" (articles are already dropped by the lexer).
   */
  private parseOtherSide(): Item {
    const start = this.i;
    this.i++; // working
    const expected = '"along the other side of the chain" (or "in the unused loops of the foundation chain") after "working"';
    if (!this.isWord(this.peek(), 'along', 'across', 'in', 'into', 'on')) this.fail(expected);
    this.i++;
    if (this.isWord(this.peek(), 'unused', 'free') && this.isWord(this.peek(1), 'loops', 'loop', 'lps')) {
      this.i += 2;
    } else {
      if (this.isWord(this.peek(), 'opposite', 'other', 'back', 'underside', 'bottom')) this.i++;
      if (!this.isWord(this.peek(), 'side')) this.fail(expected);
      this.i++;
    }
    if (!this.isWord(this.peek(), 'of')) this.fail('"of the chain" to say which side');
    this.i++;
    if (this.isWord(this.peek(), 'foundation', 'beginning', 'starting')) this.i++;
    if (!this.isWord(this.peek(), 'ch', 'chain', 'chs', 'chains')) this.fail('"chain" (the side of which chain)');
    this.i++;
    return { kind: 'otherSide', span: this.spanFrom(start) };
  }

  private isSpaceWord(t: Token | undefined): boolean {
    return !!t && t.kind === 'word' && SPACE_WORDS.has(t.low);
  }

  // ----- chains, skips, joins ------------------------------------------------------------------

  private parseChain(): ChainItem {
    const start = this.i;
    this.i++; // ch
    let n = 1;
    if (this.isInt(this.peek())) {
      n = this.peek()!.value!;
      this.i++;
    } else if (this.isPunct(this.peek(), '-') && this.isInt(this.peek(1))) {
      n = this.peek(1)!.value!;
      this.i += 2;
    }
    if (n < 1) {
      this.err('E_SYNTAX', `"ch ${n}" makes no chains — expected a number of chains of at least 1.`, this.spanFrom(start));
      throw new ParseError();
    }
    return this.finishChain(start, n);
  }

  private finishChain(start: number, n: number): ChainItem {
    const item: ChainItem = { kind: 'chain', n, span: this.spanFrom(start) };
    if (this.isPunct(this.peek(), '(') && this.isWord(this.peek(1), 'counts', 'does', 'count')) {
      item.countsAs = this.parseCountsAs();
      if (item.countsAs.kind === 'counts') {
        const extra = item.countsAs.extraCh ?? 0;
        if (n - extra < 1) {
          this.err('E_SYNTAX',
            `"ch ${n}" is too short for "counts as ${item.countsAs.type}${extra ? `, ch ${extra}` : ''}" — needs at least ${extra + 1} chains.`,
            this.spanFrom(start));
        }
      }
      item.span = this.spanFrom(start);
    }
    return item;
  }

  private parseCountsAs(): CountsAs {
    const open = this.peek()!;
    this.i++; // (
    let res: CountsAs;
    if (this.isWord(this.peek(), 'does')) {
      this.i++;
      this.expectWord('"not" in "(does not count as st)"', 'not');
      this.expectWord('"count" in "(does not count as st)"', 'count');
      this.expectWord('"as" in "(does not count as st)"', 'as');
      this.expectWord('"st" in "(does not count as st)"', 'st', 'stitch', 'sts', 'stitches');
      res = { kind: 'notCount' };
    } else {
      this.expectWord('"counts as"', 'counts', 'count');
      this.expectWord('"as" after "counts"', 'as');
      let first = false;
      if (this.isWord(this.peek(), 'first')) { first = true; this.i++; }
      const st = this.peek();
      const b = st && st.kind === 'word' ? baseFromWord(st.low, this.terms) : undefined;
      if (!b || b === 'slst') {
        if (st && st.kind === 'word') {
          this.err('E_UNKNOWN_STITCH',
            `"counts as ${st.text}" — expected a basic stitch (${this.terms === 'US' ? 'sc, hdc, dc, tr, dtr' : 'dc, htr, tr, dtr, trtr'}).${unknownStitchHint(st.text, this.terms)}`,
            this.tokSpan(st));
          throw new ParseError();
        }
        this.fail('a stitch name after "counts as"');
      }
      this.i++;
      res = { kind: 'counts', type: b as BaseType };
      if (first) res.first = true;
      if ((this.isPunct(this.peek(), ',', '+') || this.isWord(this.peek(), 'and', 'plus')) && this.isWord(this.peek(1), 'ch', 'chain')) {
        this.i += 2;
        if (this.isPunct(this.peek(), '-')) this.i++;
        const nt = this.peek();
        if (!this.isInt(nt)) this.fail('the number of chains, as in "(counts as dc, ch 2)"');
        res.extraCh = nt!.value!;
        this.i++;
      }
      // tolerated filler: "here and throughout", "throughout"
      if (this.isWord(this.peek(), 'here')) {
        this.i++;
        if (this.isWord(this.peek(), 'and') && this.isWord(this.peek(1), 'throughout')) this.i += 2;
      } else if (this.isWord(this.peek(), 'throughout')) this.i++;
    }
    if (!this.isPunct(this.peek(), ')')) {
      if (!this.peek()) {
        this.err('E_UNCLOSED_GROUP', '"(" opened here is never closed — expected ")" after the counts-as note.', this.tokSpan(open));
        throw new ParseError();
      }
      this.fail('")" to close the counts-as note');
    }
    this.i++;
    return res;
  }

  private parseSkip(): Item {
    const start = this.i;
    this.i++;
    let n = 1;
    let unit: Unit = { kind: 'st' };
    let sawSomething = false;
    if (this.isWord(this.peek(), 'next')) { this.i++; sawSomething = true; }
    if (this.isInt(this.peek())) { n = this.peek()!.value!; this.i++; sawSomething = true; }
    const u = this.tryUnit();
    if (u) { unit = u; sawSomething = true; }
    if (!sawSomething) this.fail('what to skip, as in "sk 2" or "sk next ch-3 sp"');
    if (unit.kind === 'any') this.fail('a stitch, space or chain to skip');
    return { kind: 'skip', n, unit, span: this.spanFrom(start) };
  }

  /** ring-forming tail: "to form ring", "into ring", "to make ring". Returns tokens consumed or 0. */
  private ringFormLength(): number {
    if (this.isWord(this.peek(), 'to') && this.isWord(this.peek(1), 'form', 'make') && this.isWord(this.peek(2), 'ring')) return 3;
    if (this.isWord(this.peek(), 'into') && this.isWord(this.peek(1), 'ring')) return 2;
    if (this.isWord(this.peek(), 'form') && this.isWord(this.peek(1), 'ring')) return 2;
    return 0;
  }

  private parseJoin(): Item {
    const start = this.i;
    this.i++; // join
    if (this.isWord(this.peek(), 'with')) {
      this.i++;
      const nm = this.matchName();
      if (!nm || nm.spec.kind !== 'basic' || nm.spec.type !== 'slst') this.fail('"sl st" after "join with"');
      this.i = nm!.end;
    }
    let k = this.ringFormLength();
    if (k) {
      this.i += k;
      return { kind: 'ringJoin', span: this.spanFrom(start) };
    }
    let target: Target | undefined;
    if (this.isWord(this.peek(), 'in', 'into', 'to', 'on')) {
      target = this.parseTarget(true);
      k = this.ringFormLength();
      if (k && target.place.kind === 'first' && target.place.unit.kind === 'ch') {
        this.i += k;
        return { kind: 'ringJoin', span: this.spanFrom(start) };
      }
    }
    return { kind: 'join', target, span: this.spanFrom(start) };
  }

  // ----- stitches ------------------------------------------------------------------------------

  /**
   * Try to read a stitch name at the cursor without consuming. Returns the spec and the index
   * just after the name.
   */
  private matchName(at = this.i): { spec: StitchSpec; end: number; name: string } | null {
    const t = this.toks[at];
    if (!t) return null;
    const t1 = this.toks[at + 1];
    const t2 = this.toks[at + 2];
    const t3 = this.toks[at + 3];
    const text = (end: number) => this.toks.slice(at, end).map((x) => x.text).join(' ').replace(/ - /g, '-');
    const terms = this.terms;

    // N-dc cl, N-dc pc, N-dc shell, N-loop puff
    if (t.kind === 'int' && this.isPunct(t1, '-') && t2 && t2.kind === 'word') {
      const n = t.value!;
      if (t2.low === 'loop' && this.isWord(t3, 'puff')) {
        let end = at + 4;
        if (this.isWord(this.toks[end], 'st', 'stitch')) end++;
        return { spec: { kind: 'puff', loops: n, explicit: true }, end, name: text(end) };
      }
      const b = baseFromWord(t2.low, terms);
      if (b && b !== 'slst' && t3 && t3.kind === 'word') {
        const w = t3.low;
        if (['cl', 'cluster', 'bobble'].includes(w)) return { spec: { kind: 'cluster', base: b, n }, end: at + 4, name: text(at + 4) };
        if (['pc', 'popcorn', 'pop'].includes(w)) return { spec: { kind: 'popcorn', legs: n, base: b, explicit: true }, end: at + 4, name: text(at + 4) };
        if (w === 'shell') return { spec: { kind: 'shell', base: b, n, explicit: true }, end: at + 4, name: text(at + 4) };
      }
      return null;
    }
    if (t.kind !== 'word') return null;
    const w = t.low;
    // ch-N picot
    if (w === 'ch' && this.isPunct(t1, '-') && t2?.kind === 'int' && this.isWord(t3, 'picot', 'p')) {
      return { spec: { kind: 'picot', chains: t2.value! }, end: at + 4, name: text(at + 4) };
    }
    // sl st
    if (w === 'sl' && this.isWord(t1, 'st')) return { spec: { kind: 'basic', type: 'slst' }, end: at + 2, name: text(at + 2) };
    if (w === 'slip' && this.isWord(t1, 'st', 'stitch')) return { spec: { kind: 'basic', type: 'slst' }, end: at + 2, name: text(at + 2) };
    const base = baseFromWord(w, terms);
    if (base) {
      if (base !== 'slst' && this.isWord(t1, 'inc')) return { spec: { kind: 'inc', base }, end: at + 2, name: text(at + 2) };
      return { spec: { kind: 'basic', type: base }, end: at + 1, name: t.text };
    }
    if (w === 'inc') return { spec: { kind: 'inc', base: 'sc' }, end: at + 1, name: t.text };
    if (w === 'dec') return { spec: { kind: 'tog', base: 'sc', n: 2, alias: 'dec' }, end: at + 1, name: t.text };
    if (w === 'invdec') return { spec: { kind: 'tog', base: 'sc', n: 2, alias: 'invdec' }, end: at + 1, name: t.text };
    let m = /^(fp|bp)?([a-z]+?)(\d+)tog$/.exec(w);
    if (m) {
      const b = baseFromWord(m[2], terms);
      if (b && b !== 'slst') {
        const spec: StitchSpec = { kind: 'tog', base: b, n: parseInt(m[3], 10) };
        if (m[1]) spec.post = m[1] as 'fp' | 'bp';
        return { spec, end: at + 1, name: t.text };
      }
      return null;
    }
    m = /^(fp|bp)([a-z]+)$/.exec(w);
    if (m) {
      const b = baseFromWord(m[2], terms);
      if (b && b !== 'slst') return { spec: { kind: 'basic', type: b, post: m[1] as 'fp' | 'bp' }, end: at + 1, name: t.text };
    }
    if (w === 'cl' || w === 'cluster') return { spec: { kind: 'cluster', base: 'dc', n: 3, alias: 'cl' }, end: at + 1, name: t.text };
    if (w === 'bobble') return { spec: { kind: 'cluster', base: 'dc', n: 5, alias: 'bobble' }, end: at + 1, name: t.text };
    if (w === 'puff') {
      const end = this.isWord(t1, 'st', 'stitch') ? at + 2 : at + 1;
      return { spec: { kind: 'puff', loops: 3, explicit: false }, end, name: text(end) };
    }
    if (w === 'pc' || w === 'popcorn' || w === 'pop') return { spec: { kind: 'popcorn', legs: 5, base: 'dc', explicit: false }, end: at + 1, name: t.text };
    if (w === 'picot' || w === 'p') return { spec: { kind: 'picot', chains: 3 }, end: at + 1, name: t.text };
    if (w === 'shell') return { spec: { kind: 'shell', base: 'dc', n: 5, explicit: false }, end: at + 1, name: t.text };
    if (w === 'vst') return { spec: { kind: 'v' }, end: at + 1, name: t.text };
    if (w === 'v') {
      if (this.isPunct(t1, '-') && this.isWord(t2, 'st', 'stitch')) return { spec: { kind: 'v' }, end: at + 3, name: text(at + 3) };
      if (this.isWord(t1, 'st', 'stitch')) return { spec: { kind: 'v' }, end: at + 2, name: text(at + 2) };
      return { spec: { kind: 'v' }, end: at + 1, name: t.text };
    }
    return null;
  }

  private tryLoopMod(): LoopModAst | undefined {
    const t = this.peek();
    if (this.isWord(t, 'flo', 'blo')) {
      this.i++;
      return t!.low as LoopModAst;
    }
    return undefined;
  }

  private parseStitch(ctx: Ctx): Item {
    const start = this.i;
    let count: number | undefined;
    let nm = this.matchName();
    let loop: LoopModAst | undefined;
    if (!nm) {
      if (this.isInt(this.peek())) {
        count = this.peek()!.value!;
        this.i++;
      }
      loop = this.tryLoopMod();
      nm = this.matchName();
    }
    if (!nm) {
      const t = this.peek();
      if (t && t.kind === 'word' && !this.isStopper(t, ctx)) {
        // Unknown word in stitch position.
        let end = this.i + 1;
        // swallow "-st" style suffixes into the reported name (e.g. "x-st")
        while (this.isPunct(this.toks[end], '-') && this.toks[end + 1]?.kind === 'word') end += 2;
        const name = this.toks.slice(this.i, end).map((x) => x.text).join('').replace(/\s/g, '');
        const span = this.spanOf(this.toks[this.i], this.toks[end - 1]);
        if (t.low === 'counts' || t.low === 'does') {
          this.err('E_SYNTAX', '"(counts as …)" must come right after a chain, as in "ch 3 (counts as dc)".', span);
        } else if (t.low === 'rep' || t.low === 'repeat') {
          this.err('E_SYNTAX', 'expected "rep from *" but found "' + t.text + '" without "from *".', span);
        } else {
          this.err('E_UNKNOWN_STITCH', `unknown stitch "${name}".${unknownStitchHint(name, this.terms)}`, span);
        }
        this.i = end;
        throw new ParseError();
      }
      if (count !== undefined && (!t || this.isSep(t) || this.isStopper(t, ctx))) {
        this.err('E_SYNTAX', `expected a stitch name after "${count}" but found ${this.found(t)}.`, this.tokSpan(t ?? this.toks[start]));
        throw new ParseError();
      }
      this.fail('a stitch, chain, skip, join or repeat');
    }
    this.i = nm!.end;
    let spec = nm!.spec;
    if (!loop) loop = this.tryLoopMod();

    // suffix counts: "sc 5", "inc x6", "picot 4" (picot N = chains)
    if (count === undefined) {
      const t = this.peek();
      if (this.isInt(t) && !this.isPunct(this.peek(1), '-') && !this.isWord(this.peek(1), 'times', 'time', 'more')) {
        if (spec.kind === 'picot') spec = { kind: 'picot', chains: t!.value! };
        else count = t!.value!;
        this.i++;
      } else if (this.isWord(t, 'x') && this.isInt(this.peek(1))) {
        count = this.peek(1)!.value!;
        this.i += 2;
      }
    }
    if (!loop) loop = this.tryLoopMod();
    if (count === 0) {
      this.err('E_SYNTAX', `"${nm!.name}" with a count of 0 makes nothing — expected a count of at least 1.`, this.spanFrom(start));
      throw new ParseError();
    }

    let target: Target | undefined;
    const t = this.peek();
    if (this.isWord(t, ...PREPS)) {
      if (t!.low === 'around') {
        // "fpdc around next st" (prep) vs. "*...* around" (repeat extent): only a prep if a place follows
        const save = this.i;
        this.i++;
        const ok = this.startsPlace();
        this.i = save;
        if (ok) target = this.parseTarget(false);
      } else {
        target = this.parseTarget(false);
      }
    }
    // "sl st in first ch to form ring" / "sl st to form ring" are ring joins (notation.md section 2)
    if (spec.kind === 'basic' && spec.type === 'slst' && count === undefined &&
        (!target || (target.place.kind === 'first' && target.place.unit.kind === 'ch'))) {
      const k = this.ringFormLength();
      if (k) {
        this.i += k;
        return { kind: 'ringJoin', span: this.spanFrom(start) };
      }
    }
    if (spec.kind === 'picot' && target) {
      this.err('E_SYNTAX', 'a picot is not worked into anything — it sits on the previous stitch; remove the target.', target.span);
      throw new ParseError();
    }
    const item: StitchItem = { kind: 'stitch', spec, name: nm!.name, span: this.spanFrom(start) };
    if (count !== undefined) item.count = count;
    if (loop) item.loop = loop;
    if (target) item.target = target;
    // "dc in next st x3": repeat of the item
    if (this.isWord(this.peek(), 'x') && this.isInt(this.peek(1))) {
      item.times = this.peek(1)!.value!;
      this.i += 2;
    }
    item.span = this.spanFrom(start);
    return item;
  }

  // ----- targets -------------------------------------------------------------------------------

  /** Does the token at the cursor start a place? (used to disambiguate "around") */
  private startsPlace(): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.kind === 'ordinal' || t.kind === 'int') return true;
    if (this.isWord(t, 'flo', 'blo', 'ring', 'same', 'first', 'top', 'each', 'next', 'post')) return true;
    const save = this.i;
    const u = this.tryUnit();
    this.i = save;
    return !!u;
  }

  private parseTarget(forJoin: boolean): Target {
    const start = this.i;
    const prep = this.peek()!.low as Target['prep'];
    this.i++;
    let loop = this.tryLoopMod();
    if (loop && this.isWord(this.peek(), 'of')) this.i++;
    if (this.isWord(this.peek(), 'post')) {
      this.i++;
      if (this.isWord(this.peek(), 'of')) this.i++;
    }
    let place: Place;
    if (loop && (!this.peek() || this.isSep(this.peek()))) {
      place = { kind: 'next', unit: { kind: 'st' } }; // "sc in blo" == "sc in blo of next st"
    } else {
      place = this.parsePlace(forJoin);
    }
    const target: Target = { prep, place, span: this.spanFrom(start) };
    if (loop) target.loop = loop;
    return target;
  }

  private parsePlace(forJoin: boolean): Place {
    const t = this.peek();
    if (!t) this.fail('where to work, as in "in next st" or "in ring"');
    if (this.isWord(t, 'ring')) { this.i++; return { kind: 'ring' }; }
    if (this.isWord(t, 'same')) {
      this.i++;
      const u = this.tryUnit();
      if (!u) this.fail('"st", "sp" or "place" after "same"');
      // filler: "same st as join", "same st as sl st"
      if (this.isWord(this.peek(), 'as')) {
        if (this.isWord(this.peek(1), 'join', 'joining')) this.i += 2;
        else if (this.isWord(this.peek(1), 'sl') && this.isWord(this.peek(2), 'st')) this.i += 3;
        else if (this.isWord(this.peek(1), 'slst', 'ss')) this.i += 2;
      }
      return { kind: 'same', unit: u! };
    }
    if (this.isWord(t, 'first')) {
      this.i++;
      if (this.isWord(this.peek(), 'ch') && this.isWord(this.peek(1), 'from') && this.isWord(this.peek(2), 'hook')) {
        this.i += 3;
        return { kind: 'fromHook', ordinal: 1 };
      }
      const u = this.tryUnit();
      if (!u) this.fail('"st" (or a stitch name) after "first"');
      return { kind: 'first', unit: u! };
    }
    if (this.isWord(t, 'top')) {
      this.i++;
      if (this.isWord(this.peek(), 'of')) this.i++;
      return this.parseTopOf();
    }
    if (this.isWord(t, 'each', 'every')) {
      this.i++;
      if (this.isWord(this.peek(), 'of')) this.i++;
      let n: number | undefined;
      if (this.isWord(this.peek(), 'next')) {
        this.i++;
        if (!this.isInt(this.peek())) this.fail('how many, as in "each of next 3 sts"');
      }
      if (this.isInt(this.peek())) { n = this.peek()!.value!; this.i++; }
      const u = this.tryUnit();
      if (!u || u.kind === 'any') this.fail('"st", "sp" or "ch" after "each"');
      const place: Place = { kind: 'each', unit: u! };
      if (n !== undefined) place.n = n;
      const ext = this.tryExtent();
      if (ext) place.extent = ext;
      return place;
    }
    if (t!.kind === 'ordinal') {
      const ord = t!.value!;
      this.i++;
      if (this.isWord(this.peek(), 'ch', 'chain') && this.isWord(this.peek(1), 'from') && this.isWord(this.peek(2), 'hook')) {
        this.i += 3;
        return { kind: 'fromHook', ordinal: ord };
      }
      this.fail(`"ch from hook" after "${t!.text}"`);
    }
    let explicitNext = false;
    if (this.isWord(t, 'next')) { this.i++; explicitNext = true; }
    let n: number | undefined;
    if (this.isInt(this.peek())) { n = this.peek()!.value!; this.i++; }
    const u = this.tryUnit();
    if (!u) {
      if (forJoin && !explicitNext && n === undefined) this.fail('where to join, as in "join with sl st in first st"');
      this.fail(explicitNext || n !== undefined ? '"st", "sp" or a stitch name' : 'where to work, as in "in next st" or "in ring"');
    }
    if (u!.kind === 'any') this.fail('"st" or "sp" ("place" only works with "same")');
    if (n === 0) this.fail('a number of at least 1');
    const place: Place = { kind: 'next', unit: u! };
    if (n !== undefined) place.n = n;
    return place;
  }

  private parseTopOf(): Place {
    const t = this.peek();
    if (this.isWord(t, 'tch')) { this.i++; return { kind: 'topOf', what: 'tch' }; }
    if (this.isWord(t, 'turning', 'turn') && this.isWord(this.peek(1), 'ch', 'chain')) { this.i += 2; return { kind: 'topOf', what: 'tch' }; }
    if (this.isWord(t, 'beg', 'beginning', 'starting')) {
      this.i++;
      if (!this.isWord(this.peek(), 'ch', 'chain')) this.fail('"ch" after "top of beg"');
      this.i++;
      const place: Place = { kind: 'topOf', what: 'beg ch' };
      const c = this.tryDashInt();
      if (c !== undefined) place.chains = c;
      return place;
    }
    if (this.isWord(t, 'ch', 'chain')) {
      this.i++;
      const c = this.tryDashInt();
      const place: Place = { kind: 'topOf', what: 'beg ch' };
      if (c !== undefined) place.chains = c;
      return place;
    }
    this.fail('"tch", "beg ch" or "ch-3" after "top of"');
  }

  private tryDashInt(): number | undefined {
    if (this.isPunct(this.peek(), '-') && this.isInt(this.peek(1))) {
      const v = this.peek(1)!.value!;
      this.i += 2;
      return v;
    }
    if (this.isInt(this.peek()) && !this.isWord(this.peek(1), 'times', 'time', 'more')) {
      const v = this.peek()!.value!;
      this.i++;
      return v;
    }
    return undefined;
  }

  /** around | across | to end | [across] to [next] corner (notation.md 3.9) */
  private tryExtent(): Extent | undefined {
    if (this.isWord(this.peek(), 'around')) { this.i++; return 'around'; }
    if (this.isWord(this.peek(), 'across')) {
      this.i++;
      const k = this.toCornerLength();
      if (k) { this.i += k; return 'corner'; }
      return 'across';
    }
    const k = this.toCornerLength();
    if (k) { this.i += k; return 'corner'; }
    if (this.isWord(this.peek(), 'to') && this.isWord(this.peek(1), 'end')) { this.i += 2; return 'end'; }
    return undefined;
  }

  /** "to corner" / "to next corner": number of tokens, or 0. */
  private toCornerLength(): number {
    if (!this.isWord(this.peek(), 'to')) return 0;
    if (this.isWord(this.peek(1), 'corner')) return 2;
    if (this.isWord(this.peek(1), 'next') && this.isWord(this.peek(2), 'corner')) return 3;
    return 0;
  }

  /** Read a unit if one is at the cursor (consumes it), else undefined (consumes nothing). */
  private tryUnit(): Unit | undefined {
    const t = this.peek();
    if (!t || t.kind !== 'word') return undefined;
    const w = t.low;
    if (ST_WORDS.has(w)) { this.i++; return { kind: 'st' }; }
    if (w === 'place' || w === 'places') { this.i++; return { kind: 'any' }; }
    // row end / row ends / row-end / end of row / ends of rows (notation.md 3.9)
    if (w === 'row' || w === 'rows') {
      if (this.isWord(this.peek(1), 'end', 'ends')) { this.i += 2; return { kind: 'rowEnd' }; }
      if (this.isPunct(this.peek(1), '-') && this.isWord(this.peek(2), 'end', 'ends')) { this.i += 3; return { kind: 'rowEnd' }; }
      return undefined;
    }
    if ((w === 'end' || w === 'ends') && this.isWord(this.peek(1), 'of') && this.isWord(this.peek(2), 'row', 'rows')) {
      this.i += 3;
      return { kind: 'rowEnd' };
    }
    if (w === 'corner' || w === 'corners') { this.i++; return { kind: 'corner' }; }
    if (SPACE_WORDS.has(w)) { this.i++; return { kind: 'space', word: w.startsWith('l') ? 'loop' : 'sp' }; }
    if (CH_WORDS.has(w)) {
      const t1 = this.peek(1);
      const t2 = this.peek(2);
      const t3 = this.peek(3);
      if (this.isPunct(t1, '-') && this.isInt(t2) && this.isSpaceWord(t3)) {
        this.i += 4;
        return { kind: 'space', chains: t2!.value!, word: t3!.low.startsWith('l') ? 'loop' : 'sp' };
      }
      if (this.isPunct(t1, '-') && this.isSpaceWord(t2)) {
        this.i += 3;
        return { kind: 'space', word: t2!.low.startsWith('l') ? 'loop' : 'sp' };
      }
      if (this.isInt(t1) && this.isSpaceWord(t2)) {
        this.i += 3;
        return { kind: 'space', chains: t1!.value!, word: t2!.low.startsWith('l') ? 'loop' : 'sp' };
      }
      if (this.isSpaceWord(t1)) {
        this.i += 2;
        return { kind: 'space', word: t1!.low.startsWith('l') ? 'loop' : 'sp' };
      }
      this.i++;
      return { kind: 'ch' };
    }
    if (w === 'puff' || w === 'puffs') { this.i++; return { kind: 'stname', type: 'puff' }; }
    if (['pc', 'pcs', 'popcorn', 'popcorns'].includes(w)) { this.i++; return { kind: 'stname', type: 'popcorn' }; }
    if (['cl', 'cls', 'cluster', 'clusters'].includes(w)) { this.i++; return { kind: 'stname', type: 'cl' }; }
    if (w === 'sl' && this.isWord(this.peek(1), 'st', 'sts')) { this.i += 2; return { kind: 'stname', type: 'slst' }; }
    const b = baseFromWord(w, this.terms) ?? (w.length > 2 && w.endsWith('s') ? baseFromWord(w.slice(0, -1), this.terms) : undefined);
    if (b) { this.i++; return { kind: 'stname', type: b }; }
    return undefined;
  }

  private tryTimes(): Times | undefined {
    const t = this.peek();
    if (this.isWord(t, 'x') && this.isInt(this.peek(1))) {
      const n = this.peek(1)!.value!;
      this.i += 2;
      return { kind: 'n', n };
    }
    if (this.isInt(t) && this.isWord(this.peek(1), 'times', 'time')) {
      this.i += 2;
      return { kind: 'n', n: t!.value! };
    }
    const ext = this.tryExtent();
    if (ext) return { kind: ext };
    return undefined;
  }

  // ----- groups and repeats --------------------------------------------------------------------

  private parseGroup(ctx: Ctx): GroupItem {
    const start = this.i;
    const open = this.peek()!;
    const closer = open.low === '(' ? ')' : ']';
    if (open.low === '(') {
      // "(6)" / "(12 sts)" can never be a group: it is a count annotation in the wrong place
      let close = -1;
      for (let k = this.i + 1; k < this.toks.length; k++) {
        if (this.isPunct(this.toks[k], '(', '[')) break;
        if (this.isPunct(this.toks[k], ')')) { close = k; break; }
      }
      if (close > 0) {
        const parts = this.parseCountParts(this.toks.slice(this.i + 1, close));
        if (parts && parts.every((p) => p.unit.kind === 'st')) {
          this.err('E_SYNTAX', `a count annotation like "${this.toks.slice(this.i, close + 1).map((t) => t.text).join('').replace(/(\d)([a-z])/gi, '$1 $2')}" must come last in the round (only "fasten off" may follow it).`,
            this.spanOf(open, this.toks[close]));
          this.i = close + 1;
          throw new ParseError();
        }
      }
    }
    this.i++;
    const items = this.parseSequence({ inRepeat: ctx.inRepeat, inGroup: true });
    const t = this.peek();
    if (this.isPunct(t, ')', ']')) {
      if (t!.low !== closer) {
        this.err('E_SYNTAX', `"${open.text}" opened at col ${open.col} must be closed with "${closer}" but found "${t!.text}".`, this.tokSpan(t));
      }
      this.i++;
    } else {
      this.err('E_UNCLOSED_GROUP',
        `group "${open.text}" opened here is never closed — expected "${closer}" before ${this.found(t)}.`, this.tokSpan(open));
      throw new ParseError();
    }
    if (items.length === 0) {
      this.err('E_SYNTAX', `empty group "${open.text}${closer}" — expected stitches inside.`, this.spanFrom(start));
      throw new ParseError();
    }
    const g: GroupItem = { kind: 'group', bracket: open.low as '(' | '[', items, span: this.spanFrom(start) };
    if (this.isWord(this.peek(), ...PREPS)) {
      const tt = this.peek()!;
      let isPrep = true;
      if (tt.low === 'around') {
        const save = this.i;
        this.i++;
        isPrep = this.startsPlace();
        this.i = save;
      }
      if (isPrep) g.target = this.parseTarget(false);
    }
    const times = this.tryTimes();
    if (times) g.times = times;
    g.span = this.spanFrom(start);
    return g;
  }

  private parseRepeat(ctx: Ctx): RepeatItem {
    const start = this.i;
    const open = this.peek()!;
    const openSpan = this.tokSpan(open);
    if (ctx.inRepeat) {
      // unreachable: a '*' inside a repeat is a stopper
      this.fail('no nested "*" repeat (use a group "( … ) xN" inside "* … *")');
    }
    this.i++;
    const items = this.parseSequence({ inRepeat: true, inGroup: ctx.inGroup });
    const t = this.peek();
    let times: Times | undefined;
    let form: 'star' | 'rep' = 'star';
    if (this.isPunct(t, '*')) {
      this.i++;
      times = this.tryTimes();
      if (!times) {
        const n = this.peek();
        this.err('E_SYNTAX',
          `expected how many times to work the repeat (e.g. "x6" or "around") after the closing "*" but found ${this.found(n)}.`,
          this.tokSpan(n ?? this.toks[this.i - 1]));
        throw new ParseError();
      }
    } else if (this.isRepFrom()) {
      form = 'rep';
      this.i += 2;
      if (!this.isPunct(this.peek(), '*')) this.fail('"*" after "rep from"');
      this.i++;
      const a = this.peek();
      if (this.isInt(a) && this.isWord(this.peek(1), 'more') && this.isWord(this.peek(2), 'times', 'time')) {
        times = { kind: 'n', n: a!.value! + 1 };
        this.i += 3;
      } else if (this.isInt(a) && this.isWord(this.peek(1), 'times', 'time') && this.isWord(this.peek(2), 'more')) {
        times = { kind: 'n', n: a!.value! + 1 }; // "rep from * 4 times more"
        this.i += 3;
      } else if (this.isInt(a) && this.isWord(this.peek(1), 'times', 'time')) {
        times = { kind: 'n', n: a!.value! };
        this.i += 2;
      } else {
        const ext = this.tryExtent();
        if (!ext) this.fail('"N more times", "N times", "around", "across", "to end" or "to corner" after "rep from *"');
        times = { kind: ext! };
      }
    } else {
      this.err('E_UNCLOSED_REPEAT',
        `repeat "*" opened here is never closed — expected a closing "*" (as in "*sc, inc* x6") or "rep from *" before ${this.found(t)}.`,
        openSpan);
      throw new ParseError();
    }
    if (items.length === 0) {
      this.err('E_SYNTAX', 'empty repeat "* *" — expected stitches between the stars.', this.spanFrom(start));
      throw new ParseError();
    }
    if (times.kind === 'n' && times.n < 1) {
      this.err('E_SYNTAX', 'a repeat must be worked at least once.', this.spanFrom(start));
      throw new ParseError();
    }
    return { kind: 'repeat', items, times, form, span: this.spanFrom(start), openSpan };
  }
}
