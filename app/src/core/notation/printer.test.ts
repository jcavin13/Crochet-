import { describe, expect, it } from 'vitest';
import { compile, stripSrc } from '../graph/index';
import { compilePattern, parse, print } from './index';

/** Patterns covering every construct; each must round-trip through the printer in US and UK. */
const SAMPLES: string[] = [
  'title: A\nRnd 1: mr, 6 sc in ring. (6)\nRnd 2: inc x6. (12)\nRnds 3-4: sc in each st around. (12)\nRnd 5: *sc, dec* x4. (8)',
  'Rnd 1: ch 6, join to form ring, ch 3 (counts as dc), 15 dc in ring, join. (16)\nRnd 2: ch 5 (counts as dc, ch 2), *dc in next st, ch 2* x15, join. (16 dc, 16 ch-2 sps)\nRnd 3: sl st in next ch-2 sp, ch 1, (sc, ch-4 picot, sc) in same sp, *(sc, picot, sc) in next ch-2 sp* around, join, fasten off. (32 sc, 16 picot)',
  'Foundation: ch 11.\nRow 1: sc in 2nd ch from hook, sc in each ch across. (10)\nRows 2-3: ch 1, sc blo in each st across. (10)\nRow 4: ch 3 (counts as dc), dc in each of next 8 sts, dc in top of tch. (10)',
  'Rnd 1: mr, 11 sc in ring, join. (11)\nRnd 2: ch 1, cl in same st, bobble, 4-dc cl, puff, 4-loop puff, pc, 4-dc pc, v-st, 3-dc shell in next st, fpdc around next st, bpsc around next st. (14)',
  'Rnd 1: mr, 8 hdc in ring. (8)\nRnd 2: hdc inc x2, dc inc, tr inc, sc3tog, dtr in next st. (10)',
  'Rnd 1: mr, 6 sc in ring, join, turn. (6)\nRnd 2: ch 1, *sc flo, sc in blo of next st; rep from * 2 more times, join. (6)\nRnd 3: ch 1, [sc, ch 2] in next st x3, (sc in next st, ch 1) x3, join. (6, 3 ch-2 sps, 3 ch-1 sps)',
  'Rnd 1: ch 2, 6 sc in 2nd ch from hook. (6)\nRnd 2: 2 sc in each st around. (12)\nRnd 3: *sc in next 2 sts, inc; rep from * 3 times. (12)'.replace('3 times. (12)', '3 times, sc in each st around. (15)'),
  'terms: UK\nRnd 1: mr, ch 3 (counts as tr), 11 tr in ring, ss in first st. (12 tr)\nRnd 2: ch 1, dc in same st, miss next tr, tr3tog, fptr around next st, 3-tr cl in next tr, htr in each st around, join. (9)',
];

const graphOf = (text: string) => {
  const r = compilePattern(text);
  expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  return stripSrc(r.pattern!).graph;
};

describe('printer', () => {
  it.each(SAMPLES.map((s, i) => [i, s] as const))('sample %i round-trips in US and UK', (_i, text) => {
    const g = graphOf(text);
    const ast = parse(text).ast;
    for (const terms of ['US', 'UK'] as const) {
      const out = print(ast, { terms });
      const again = parse(out);
      expect(again.diagnostics, out).toEqual([]);
      const c = compile(again.ast);
      expect(c.pattern, out).toBeDefined();
      expect(stripSrc(c.pattern!).graph).toEqual(g);
      expect(print(again.ast, { terms })).toBe(out);
      // and across dialects
      const other = terms === 'US' ? 'UK' : 'US';
      expect(stripSrc(compile(parse(print(again.ast, { terms: other })).ast).pattern!).graph).toEqual(g);
    }
  });

  it('canonical US text', () => {
    const ast = parse('Rnd 1: MR; sc 6 in ring.\nRnd 2: inc ×6 (12)\nRnd 3: *sc, inc; rep from * 5 more times. (18)').ast;
    expect(print(ast)).toBe('Rnd 1: mr, 6 sc in ring.\nRnd 2: 6 inc. (12)\nRnd 3: *sc, inc* x6. (18)\n');
  });

  it.each([
    ['sc', 'dc'], ['hdc', 'htr'], ['dc', 'tr'], ['tr', 'dtr'], ['dtr', 'trtr'], ['sl st', 'ss'], ['sc2tog', 'dc2tog'], ['dc3tog', 'tr3tog'],
    ['fpdc', 'fptr'], ['3-tr cl', '3-dtr cl'], ['hdc inc', 'htr inc'], ['4-dc pc', '4-tr pc'], ['3-dc shell', '3-tr shell'],
    ['inc', 'inc'], ['dec', 'dec'], ['cl', 'cl'], ['puff', 'puff'], ['v-st', 'v-st'], ['picot', 'picot'],
  ])('US %s prints as UK %s', (us, uk) => {
    const ast = parse(`Rnd 1: mr, 9 sc in ring.\nRnd 2: ${us}.`).ast;
    expect(print(ast, { terms: 'UK' }).split('\n')).toContain(`Rnd 2: ${uk}.`);
  });

  it('translates targets, skips, counts-as and count units', () => {
    const src = 'Rnd 1: mr, ch 3 (counts as dc), 11 dc in ring, join. (12 dc)\nRnd 2: sl st in next dc, sk next dc, ch 1, sc in same st, sc in each dc around. (10 sc)';
    expect(print(parse(src).ast, { terms: 'UK' })).toBe(
      'terms: UK\n\nRnd 1: mr, ch 3 (counts as tr), 11 tr in ring, join. (12 tr)\nRnd 2: ss in next tr, miss 1 tr, ch 1, dc in same st, dc in each tr around. (10 dc)\n',
    );
  });

  it('replaces an existing terms header and keeps the other headers', () => {
    const out = print(parse('title: X\nterms: US\nhook: 4mm\nRnd 1: mr, 6 sc in ring.').ast, { terms: 'UK' });
    expect(out).toBe('title: X\nterms: UK\nhook: 4mm\n\nRnd 1: mr, 6 dc in ring.\n');
  });
});

describe('parser AST', () => {
  it('spans, labels and count annotations', () => {
    const { ast, diagnostics } = parse('title: T\nRnds 2-3: 2 sc in next st,\n  sc. (3 sc, 1 ch-2 sp)');
    expect(diagnostics.map((d) => d.code)).toEqual([]);
    const r = ast.rounds[0];
    expect(r.label).toEqual({ kind: 'round', word: 'Rnds', from: 2, to: 3, range: true, span: { line: 2, col: 1, endLine: 2, endCol: 9 } });
    expect(r.span).toEqual({ line: 2, col: 1, endLine: 3, endCol: 24 });
    expect(r.items[0]).toEqual({
      kind: 'stitch', spec: { kind: 'basic', type: 'sc' }, name: 'sc', count: 2,
      target: { prep: 'in', place: { kind: 'next', unit: { kind: 'st' } }, span: { line: 2, col: 16, endLine: 2, endCol: 26 } },
      span: { line: 2, col: 11, endLine: 2, endCol: 26 },
    });
    expect(r.items[1].span).toEqual({ line: 3, col: 3, endLine: 3, endCol: 5 });
    expect(r.count!.parts.map((p) => [p.n, p.unit])).toEqual([[3, { kind: 'type', type: 'sc' }], [1, { kind: 'spaces', chains: 2 }]]);
    expect(ast.headers).toEqual([{ key: 'title', value: 'T', span: { line: 1, col: 1, endLine: 1, endCol: 9 } }]);
  });

  it('counts-as forms', () => {
    const items = parse('Rnd 1: ch 3 (counts as first dc), ch 5 (counts as dc + ch 2), ch 2 (does not count as stitch), ch 3 (counts as dc here and throughout)').ast.rounds[0].items;
    expect(items.map((i) => (i.kind === 'chain' ? i.countsAs : null))).toEqual([
      { kind: 'counts', type: 'dc', first: true }, { kind: 'counts', type: 'dc', extraCh: 2 }, { kind: 'notCount' }, { kind: 'counts', type: 'dc' },
    ]);
  });

  it('places', () => {
    const t = (s: string) => {
      const it = parse(`Rnd 1: sc ${s}`).ast.rounds[0].items[0];
      return it.kind === 'stitch' ? it.target?.place : undefined;
    };
    expect(t('in ring')).toEqual({ kind: 'ring' });
    expect(t('in same sp')).toEqual({ kind: 'same', unit: { kind: 'space', word: 'sp' } });
    expect(t('into the same place')).toEqual({ kind: 'same', unit: { kind: 'any' } });
    expect(t('in first sc')).toEqual({ kind: 'first', unit: { kind: 'stname', type: 'sc' } });
    expect(t('in top of beg ch-3')).toEqual({ kind: 'topOf', what: 'beg ch', chains: 3 });
    expect(t('in top of turning ch')).toEqual({ kind: 'topOf', what: 'tch' });
    expect(t('in next 3 ch-2 loops')).toEqual({ kind: 'next', n: 3, unit: { kind: 'space', chains: 2, word: 'loop' } });
    expect(t('in next ch sp')).toEqual({ kind: 'next', unit: { kind: 'space', word: 'sp' } });
    expect(t('in each of next 4 dc')).toEqual({ kind: 'each', n: 4, unit: { kind: 'stname', type: 'dc' } });
    expect(t('in each ch-sp around')).toEqual({ kind: 'each', unit: { kind: 'space', word: 'sp' }, extent: 'around' });
    expect(t('in each st to end')).toEqual({ kind: 'each', unit: { kind: 'st' }, extent: 'end' });
    expect(t('in third ch from hook')).toEqual({ kind: 'fromHook', ordinal: 3 });
    expect(t('in first ch from hook')).toEqual({ kind: 'fromHook', ordinal: 1 });
    expect(t('around post of next dc')).toEqual({ kind: 'next', unit: { kind: 'stname', type: 'dc' } });
  });

  it('never throws on garbage', () => {
    const alphabet = ['sc', 'dc', 'ch', '3', '*', '(', ')', '[', ']', ',', '.', 'in', 'next', 'sp', 'x', 'rep', 'from', 'around', '-', 'join', 'ring', 'mr', 'counts', 'as', ':', 'Rnd 2:', '\n', '#', '@', 'tog', 'sk', 'each', 'turn', 'fo'];
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let k = 0; k < 400; k++) {
      const words = Array.from({ length: 1 + Math.floor(rnd() * 25) }, () => alphabet[Math.floor(rnd() * alphabet.length)]);
      const text = `Rnd 1: mr, 6 sc in ring.\nRnd 2: ${words.join(' ')}`;
      expect(() => compilePattern(text)).not.toThrow();
      const r = compilePattern(text);
      for (const d of r.diagnostics) {
        expect(d.line).toBeGreaterThanOrEqual(1);
        expect(d.col).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
