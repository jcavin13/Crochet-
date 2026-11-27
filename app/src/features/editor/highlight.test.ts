import { describe, expect, it } from 'vitest';
import { diagnosticMarks, offsetOf, segments, tokenizeLine } from './highlight';
import type { Diagnostic } from '@/app/coreApi';

const d = (p: Partial<Diagnostic>): Diagnostic => ({ severity: 'error', code: 'E_X', message: 'm', line: 1, col: 1, endLine: 1, endCol: 1, ...p });

describe('editor highlighting', () => {
  it('tokenizes labels, stitches, repeats, counts and comments', () => {
    const line = 'Rnd 3: *sc, inc* x6. (18) # note';
    const t = tokenizeLine(line, false);
    expect(t.slice(0, 6).every((x) => x === 'label')).toBe(true);
    expect(t[line.indexOf('*')]).toBe('repeat');
    expect(t[line.indexOf('sc')]).toBe('stitch');
    expect(t[line.indexOf('(18)')]).toBe('count');
    expect(t[line.indexOf('#')]).toBe('comment');
  });

  it('tokenizes header keys only in the header block', () => {
    expect(tokenizeLine('title: x', true)[0]).toBe('key');
    expect(tokenizeLine('title: x', false)[0]).not.toBe('key');
  });

  it('marks 1-based end-exclusive spans, multi-line spans and zero-width spans at end of line', () => {
    const lines = ['abcdef', 'ghij', 'kl'];
    const { marks, eol } = diagnosticMarks(lines, [
      d({ line: 1, col: 2, endLine: 1, endCol: 4 }),
      d({ severity: 'warning', line: 2, col: 3, endLine: 3, endCol: 2 }),
      d({ line: 3, col: 3, endLine: 3, endCol: 3 }),
    ]);
    expect(marks[0]).toEqual([undefined, 'error', 'error', undefined, undefined, undefined]);
    expect(marks[1]).toEqual([undefined, undefined, 'warning', 'warning']);
    expect(marks[2]).toEqual(['warning', undefined]);
    expect(eol[2]).toBe('error');
  });

  it('merges runs', () => {
    const s = segments('abcd', ['plain', 'plain', 'num', 'num'], [undefined, 'error', 'error', 'error']);
    expect(s).toEqual([
      { text: 'a', tok: 'plain', sev: undefined },
      { text: 'b', tok: 'plain', sev: 'error' },
      { text: 'cd', tok: 'num', sev: 'error' },
    ]);
  });

  it('computes offsets from line/col', () => {
    const t = 'ab\ncdef\ng';
    expect(offsetOf(t, 1, 1)).toBe(0);
    expect(offsetOf(t, 2, 3)).toBe(5);
    expect(offsetOf(t, 2, 99)).toBe(7);
    expect(offsetOf(t, 9, 1)).toBe(t.length);
  });
});
