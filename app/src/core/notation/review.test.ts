/**
 * Regression tests for the independent review (docs/review.md): R3 (fasten off), R6 (unworked
 * spaces / the closing-arc rule), R15 (empty and absurd rounds), N1–N3 (message quality).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compilePattern, parse, print } from './index';
import { compile, stripSrc } from '../graph/index';

const R1 = 'Rnd 1: mr, 6 sc in ring. (6)\n';
const codes = (text: string) => compilePattern(text).diagnostics.filter((d) => d.severity !== 'info').map((d) => d.code);
const msgs = (text: string) => compilePattern(text).diagnostics.filter((d) => d.severity !== 'info').map((d) => d.message);

describe('R3: fasten off wherever a pattern can end', () => {
  const endings: [string, string][] = [
    ['own line', `${R1}Rnd 2: inc x6. (12)\nfasten off\n`],
    ['own line, capitalised with full stop', `${R1}Rnd 2: inc x6. (12)\nFasten off.\n`],
    ['after the count, same line', `${R1}Rnd 2: inc x6. (12) Fasten off.\n`],
    ['after the count, no separator', `${R1}Rnd 2: inc x6 (12) fasten off`],
    ['after the count, with "and weave in ends"', `${R1}Rnd 2: inc x6. (12) Fasten off and weave in ends.`],
    ['own line, with "and weave in the ends"', `${R1}Rnd 2: inc x6. (12)\nFasten off and weave in the ends.`],
    ['finish off', `${R1}Rnd 2: inc x6. (12)\nFinish off.`],
    ['fo', `${R1}Rnd 2: inc x6. (12) FO.`],
    ['before the count (old form)', `${R1}Rnd 2: inc x6, fasten off. (12)`],
    ['inside the round without a count', `${R1}Rnd 2: inc x6, fasten off.`],
    ['after a header line that follows the rounds', `${R1}Rnd 2: inc x6. (12)\nnotes: blocked lightly\nFasten off.`],
    ['after a joined lace round', `${R1}Rnd 2: *sc, ch 3* x6, join. (6 sc, 6 ch-3 sps)\nFasten off.`],
  ];
  for (const [name, text] of endings) {
    it(name, () => {
      const r = compilePattern(text);
      expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
      expect(r.pattern!.graph.rounds.length).toBe(2);
      expect(r.pattern!.graph.rounds[1].stitchCount).toBe(r.pattern!.graph.rounds[1].declaredCount ?? r.pattern!.graph.rounds[1].stitchCount);
      // the count annotation is still checked
      expect(msgs(text.replace('(12)', '(13)')).join(' ')).not.toMatch(/empty group/);
    });
  }

  it('the count before a fasten off is still checked', () => {
    expect(codes(`${R1}Rnd 2: inc x6. (13)\nfasten off`)).toEqual(['E_COUNT_MISMATCH']);
  });

  it('a round after fasten off is an error, and does not cascade a count mismatch (N1)', () => {
    expect(codes(`${R1}Rnd 2: inc x6. (12)\nfasten off\nRnd 3: *sc, inc* x6. (18)`)).toEqual(['E_AFTER_FASTEN_OFF']);
  });

  it('a fasten-off line before any round is still a syntax error', () => {
    expect(codes('Fasten off.\nRnd 1: mr, 6 sc in ring.')).toEqual(['E_SYNTAX']);
  });

  it('the printer round-trips a pattern ending in fasten off', () => {
    const text = `${R1}Rnd 2: inc x6. (12)\nFasten off.`;
    const a = compilePattern(text);
    const b = compile(parse(print(a.ast!)).ast);
    expect(stripSrc(b.pattern!).graph).toEqual(stripSrc(a.pattern!).graph);
  });
});

describe('N3: a count annotation in the wrong place', () => {
  it('says the count must come last instead of "empty group"', () => {
    const m = msgs('Rnd 1: mr, (6) 6 sc in ring.');
    expect(m.join(' ')).toMatch(/count annotation like "\(6\)" must come last/);
    expect(m.join(' ')).not.toMatch(/empty group/);
  });
  it('a real group with a stitch count is still a group', () => {
    expect(codes(`${R1}Rnd 2: (2 sc) in next st x6. (12)`)).toEqual([]);
  });
});

describe('R6: rounds that leave most of the previous round unworked', () => {
  const lace = 'Rnd 1: mr, *sc in ring, ch 3* x8, join. (8 sc, 8 ch-3 sps)\n';
  it('working 2 of 8 spaces and joining is a warning (review adv/b02)', () => {
    const text = `${lace}Rnd 2: sl st in next ch-3 sp, ch 3, 2 dc in same sp, ch 5, 3 dc in next ch-3 sp, ch 5, join.`;
    const m = msgs(text);
    expect(codes(text)).toEqual(['W_UNWORKED']);
    expect(m[0]).toMatch(/6 stitches and 6 chain spaces of Rnd 1 are left unworked/);
    expect(m[0]).toMatch(/more than the closing chain arc can span/);
  });
  it('every space worked, closing arc over the last one: silent', () => {
    expect(codes(`${lace}Rnd 2: sl st in next ch-3 sp, ch 1, sc in same sp, *ch 5, sc in next ch-3 sp* x7, ch 5, join. (8)`)).toEqual([]);
  });
  it('the usual "…ch 4, join" finish over a stitch and a ch-1 sp stays silent', () => {
    expect(codes(`${R1}Rnd 2: ch 3 (counts as dc), ch 1, *dc in next st, ch 1* x5, join. (6 dc, 6 ch-1 sps)
Rnd 3: sl st in next ch-1 sp, ch 1, sc in same sp, *ch 4, sk next st, sc in next ch-1 sp* x5, ch 4, join. (6)`)).toEqual([]);
  });
  it('an arc may span the widest step used inside the round, not more', () => {
    // steps of 4 entries (sc, sp, sc, sp …) inside: an arc over 3 entries is fine, over 7 is not
    const base = 'Rnd 1: mr, *sc in ring, ch 2* x8, join. (8 sc, 8 ch-2 sps)\n';
    expect(codes(`${base}Rnd 2: sl st in next sp, ch 1, sc in same sp, *ch 6, sc in next sp, ch 6, sk next sp, sc in next sp* x2, ch 6, sc in next sp, ch 6, join. (6)`)).toEqual([]);
    expect(codes(`${base}Rnd 2: sl st in next sp, ch 1, sc in same sp, *ch 6, sc in next sp* x3, ch 6, join. (4)`)).toEqual(['W_UNWORKED']);
  });
  it('trailing unworked spaces warn when the round worked into spaces of that length', () => {
    const t = `${lace}Rnd 2: sl st in next ch-3 sp, ch 1, 3 sc in same sp, *3 sc in next ch-3 sp* x6. (21)`;
    expect(msgs(t)[0]).toMatch(/1 stitch and 1 chain space of Rnd 1 are left unworked/);
  });
  it('spaces of a length the round never works into stay silent (hexagon-style sc border)', () => {
    expect(codes(`${R1}Rnd 2: *dc, ch 1* x6, join. (6 dc, 6 ch-1 sps)\nRnd 3: ch 1, *sc in next st* x6, join. (6)`)).toEqual([]);
  });
});

describe('R15: empty and absurd rounds', () => {
  it('Rnd 2: . is an error, without a cascade into Rnd 3', () => {
    const r = compilePattern(`${R1}Rnd 2: .\nRnd 3: inc x6.`);
    expect(r.diagnostics.filter((d) => d.severity !== 'info').map((d) => [d.code, d.line])).toEqual([['E_SYNTAX', 2]]);
    expect(r.diagnostics[0].message).toMatch(/Rnd 2: the round has no instructions/);
  });
  it('a round with only a count is an error', () => {
    expect(codes(`${R1}Rnd 2: (12)`)).toEqual(['E_SYNTAX']);
  });
  it('ch 200000 is an error, not a 200 013-node graph', () => {
    const r = compilePattern(`${R1}Rnd 2: ch 200000, join.`);
    expect(r.pattern).toBeUndefined();
    expect(r.diagnostics.map((d) => d.code)).toEqual(['E_SYNTAX']);
    expect(r.diagnostics[0].message).toMatch(/grows past 50,000 stitches/);
  });
});

describe('N2: "none left" only when there were some', () => {
  it('Rnd 1 never had a ch-3 sp', () => {
    expect(msgs(`${R1}Rnd 2: sc in next ch-3 sp.`)[0]).toMatch(/Rnd 1 made none\.$/);
  });
});

describe('the corpus and fixtures are clean under the stricter validator', () => {
  const dirs = ['../../../../data/corpus/', '../../../../spec/fixtures/'].map((d) => fileURLToPath(new URL(d, import.meta.url)));
  for (const dir of dirs) {
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.cro')).sort() : [];
    for (const f of files) {
      it(f, () => {
        const r = compilePattern(readFileSync(dir + f, 'utf8'));
        expect(r.diagnostics.filter((d) => d.severity !== 'info').map((d) => `${d.line}:${d.col} ${d.code} ${d.message}`)).toEqual([]);
      });
    }
  }
});
