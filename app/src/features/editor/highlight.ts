// Line-level highlighting for the notation editor mirror. Pure, so it is unit-testable.
import type { Diagnostic, Severity } from '@/app/coreApi';

export type Tok = 'plain' | 'comment' | 'key' | 'label' | 'count' | 'repeat' | 'num' | 'stitch';
export type Segment = { text: string; tok: Tok; sev?: Severity };

const SEV_RANK: Record<Severity, number> = { info: 1, warning: 2, error: 3 };
const STITCH_RE = /\b(?:ch|sl\s?st|slst|ss|sc|hdc|dc|tr|dtr|htr|trtr|inc|dec|invdec|picot|puff|pc|popcorn|cl|bobble|shell|v-st|vst|mr|join|sk|skip|miss|turn|fasten off|fo|[fb]p(?:sc|hdc|dc|tr)|(?:sc|hdc|dc|tr|dtr)\d+tog)\b/gi;
const LABEL_RE = /^(\s*)((?:rnds?|rounds?|rows?|r)\s*\d+(?:\s*-\s*\d+)?|foundation|start|setup)(\s*:)/i;
const HEADER_RE = /^(\s*)([A-Za-z][\w-]*)(\s*:)/;

/** Token class for each UTF-16 unit of `line`. `inHeader`: we are still above the first round. */
export function tokenizeLine(line: string, inHeader: boolean): Tok[] {
  const t: Tok[] = new Array(line.length).fill('plain');
  const fill = (from: number, to: number, tok: Tok) => { for (let i = from; i < to && i < t.length; i++) t[i] = tok; };
  const hash = line.indexOf('#');
  const codeEnd = hash >= 0 ? hash : line.length;
  if (hash >= 0) fill(hash, line.length, 'comment');
  const code = line.slice(0, codeEnd);

  const lab = LABEL_RE.exec(code);
  if (lab) {
    fill(lab[1].length, lab[1].length + lab[2].length + lab[3].length, 'label');
  } else if (inHeader) {
    const h = HEADER_RE.exec(code);
    if (h) { fill(h[1].length, h[1].length + h[2].length + h[3].length, 'key'); return t; }
  }
  const start = lab ? lab[0].length : 0;
  for (const m of code.slice(start).matchAll(STITCH_RE)) fill(start + m.index!, start + m.index! + m[0].length, 'stitch');
  for (const m of code.slice(start).matchAll(/\d+/g)) {
    const i = start + m.index!;
    if (t[i] === 'plain') fill(i, i + m[0].length, 'num');
  }
  for (let i = start; i < codeEnd; i++) if (code[i] === '*') t[i] = 'repeat';
  // trailing count annotation "(…)" at the end of the round text
  const ann = /\([^()]*\)\s*\.?\s*$/.exec(code);
  if (ann && ann.index >= start && /^\(\s*\d/.test(ann[0])) fill(ann.index, ann.index + ann[0].trimEnd().length, 'count');
  return t;
}

/** Severity per UTF-16 unit of each line (0-based line index), from 1-based end-exclusive spans. */
export function diagnosticMarks(lines: string[], diags: Diagnostic[]): { marks: (Severity | undefined)[][]; eol: (Severity | undefined)[] } {
  const marks = lines.map((l) => new Array<Severity | undefined>(l.length).fill(undefined));
  const eol = new Array<Severity | undefined>(lines.length).fill(undefined);
  const put = (li: number, i: number, sev: Severity) => {
    const row = marks[li];
    if (!row) return;
    if (i >= row.length) { if (!eol[li] || SEV_RANK[sev] > SEV_RANK[eol[li]!]) eol[li] = sev; return; }
    if (!row[i] || SEV_RANK[sev] > SEV_RANK[row[i]!]) row[i] = sev;
  };
  for (const d of diags) {
    if (d.code === 'I_NO_COMPILER') continue;
    const l0 = Math.max(1, d.line) - 1;
    const l1 = Math.max(l0, (d.endLine || d.line) - 1);
    if (l0 >= lines.length) continue;
    for (let li = l0; li <= Math.min(l1, lines.length - 1); li++) {
      const from = li === l0 ? Math.max(0, d.col - 1) : 0;
      let to = li === l1 ? Math.max(0, d.endCol - 1) : lines[li].length;
      if (li === l1 && to <= from && li === l0) to = from + 1; // zero-width span: mark one unit
      for (let i = from; i < to; i++) put(li, i, d.severity);
      if (from >= lines[li].length) put(li, from, d.severity);
    }
  }
  return { marks, eol };
}

/** Merge token + diagnostic classes into runs. */
export function segments(line: string, toks: Tok[], marks: (Severity | undefined)[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < line.length; i++) {
    const last = out[out.length - 1];
    if (last && last.tok === toks[i] && last.sev === marks[i]) last.text += line[i];
    else out.push({ text: line[i], tok: toks[i], sev: marks[i] });
  }
  return out;
}

/** Does this line start the round section (ends the header block)? */
export const isRoundLine = (line: string) => LABEL_RE.test(line.replace(/#.*$/, ''));

/** Offset of (line, col) — both 1-based — in `text`. */
export function offsetOf(text: string, line: number, col: number): number {
  let off = 0;
  let l = 1;
  while (l < line) {
    const nl = text.indexOf('\n', off);
    if (nl < 0) return text.length;
    off = nl + 1;
    l++;
  }
  const eol = text.indexOf('\n', off);
  const lineEnd = eol < 0 ? text.length : eol;
  return Math.min(off + Math.max(0, col - 1), lineEnd);
}
