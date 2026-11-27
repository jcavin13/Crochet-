/**
 * Negative tests: every diagnostic code of notation.md section 4, with exact positions
 * (1-based, end exclusive) and the key part of the message.
 */
import { describe, expect, it } from 'vitest';
import { compilePattern, formatDiagnostic } from './index';
import type { DiagnosticCode } from '../graph/types';

const R1 = 'Rnd 1: mr, 6 sc in ring.\n';

type Row = [string, string, DiagnosticCode, number, number, number, number, string | RegExp];

const rows: Row[] = [
  // name, text, code, line, col, endLine, endCol, message
  ['bad character', 'Rnd 1: mr, 6 sc in ring, @.', 'E_SYNTAX', 1, 26, 1, 27, 'expected a stitch, chain, skip, join or repeat but found "@"'],
  ['missing comma', 'Rnd 1: mr, 6 sc in ring dc.', 'E_SYNTAX', 1, 25, 1, 27, 'expected "," before the next item but found "dc"'],
  ['junk line before rounds', 'title: x\nhello world\nRnd 1: mr, 6 sc in ring.', 'E_SYNTAX', 2, 1, 2, 12, 'expected a header line'],
  ['repeat without times', `${R1}Rnd 2: *sc, inc*. (9)`, 'E_SYNTAX', 2, 17, 2, 18, 'expected how many times to work the repeat'],
  ['rep from * with nothing open', `${R1}Rnd 2: sc, rep from * around.`, 'E_SYNTAX', 2, 12, 2, 15, '"rep from *" but no "*" was opened'],
  ['bad terms', 'terms: AU\nRnd 1: mr, 6 sc in ring.', 'E_SYNTAX', 1, 1, 1, 10, 'terms must be "US" or "UK" but found "AU"'],
  ['counts-as on a non-chain', `${R1}Rnd 2: sc (counts as dc), 5 sc.`, 'E_SYNTAX', 2, 11, 2, 12, 'expected "," before the next item but found "("'],
  ['tog with the wrong number of sts', `${R1}Rnd 2: sc3tog in next 2 sts.`, 'E_SYNTAX', 2, 15, 2, 28, '"sc3tog" works 3 stitches together but the target names 2'],
  ['unknown stitch, near miss', 'Rnd 1: mr, 6 xc in ring.', 'E_UNKNOWN_STITCH', 1, 14, 1, 16, /unknown stitch "xc"\. Did you mean .*"sc"/],
  ['US term under terms: UK', 'terms: UK\nRnd 1: mr, 6 sc in ring.', 'E_UNKNOWN_STITCH', 2, 14, 2, 16, '"sc" is a US term; this pattern says "terms: UK", where US sc is written dc'],
  ['hdc under terms: UK', 'terms: UK\nRnd 1: mr, 6 hdc in ring.', 'E_UNKNOWN_STITCH', 2, 14, 2, 17, 'where US hdc is written htr'],
  ['UK term in a US pattern', 'Rnd 1: mr, 6 htr in ring.', 'E_UNKNOWN_STITCH', 1, 14, 1, 17, '"htr" is a UK term (US hdc); this pattern uses US terms — add "terms: UK"'],
  ['UK compound in a US pattern', `${R1}Rnd 2: htr2tog x3.`, 'E_UNKNOWN_STITCH', 2, 8, 2, 15, '"htr" is a UK term'],
  ['unknown counts-as stitch', `${R1}Rnd 2: ch 3 (counts as xx), 6 dc.`, 'E_UNKNOWN_STITCH', 2, 24, 2, 26, '"counts as xx"'],
  ['unclosed repeat points at the opener', `${R1}Rnd 2: sc, *sc, inc. (9)`, 'E_UNCLOSED_REPEAT', 2, 12, 2, 13, 'repeat "*" opened here is never closed'],
  ['unclosed group points at the opener', `${R1}Rnd 2: 2 sc, (sc, ch 3, sc. (9)`, 'E_UNCLOSED_GROUP', 2, 14, 2, 15, 'group "(" opened here is never closed — expected ")"'],
  ['round number gap', `${R1}Rnd 3: inc x6.`, 'E_ROUND_NUMBER', 2, 1, 2, 6, 'expected Rnd 2 here but found Rnd 3 (a gap)'],
  ['round number duplicate', `${R1}Rnd 1: inc x6.`, 'E_ROUND_NUMBER', 2, 1, 2, 6, 'expected Rnd 2 here but found Rnd 1 (a duplicate)'],
  ['foundation not first', `${R1}Foundation: ch 4.`, 'E_ROUND_NUMBER', 2, 1, 2, 11, '"Foundation" (round 0) may only be the first round'],
  ['backwards range', `${R1}Rnds 2-1: 6 sc.`, 'E_ROUND_NUMBER', 2, 1, 2, 9, 'runs backwards'],
  ['running out of stitches', `${R1}Rnd 2: 7 sc.`, 'E_NO_TARGET', 2, 8, 2, 12, 'Rnd 2: needs a stitch to work into but Rnd 1 has none left.'],
  ['nothing to work into in Rnd 1', 'Rnd 1: 6 sc.', 'E_NO_TARGET', 1, 8, 1, 12, 'there is no previous round'],
  ['next dc but none left', `${R1}Rnd 2: sc in next dc.`, 'E_NO_TARGET', 2, 11, 2, 21, 'needs a dc to work into'],
  ['no chain space', `${R1}Rnd 2: sc in next ch-sp.`, 'E_NO_SPACE', 2, 11, 2, 24, 'needs a space to work into but Rnd 1 made none'],
  ['no space left', `${R1}Rnd 2: *sc, ch 3* x6, join.\nRnd 3: *sc in next sp* x7.`, 'E_NO_SPACE', 3, 12, 3, 22, 'needs a space to work into but Rnd 2 has none left'],
  ['wrong space length', `${R1}Rnd 2: *sc, ch 3* x6, join.\nRnd 3: sl st in next ch-5 sp.`, 'E_SPACE_LENGTH', 3, 14, 3, 29, '"next ch-5 sp" — the next space is a ch-3 sp'],
  ['in ring without a ring', 'Rnd 1: 6 sc in ring.', 'E_NO_RING', 1, 13, 1, 20, '"in ring" but no ring has been made'],
  ['ch from hook without a chain', 'Rnd 1: sc in 2nd ch from hook.', 'E_NO_CHAIN', 1, 11, 1, 30, '"2nd ch from hook" but no chain has just been made'],
  ['ch from hook beyond the chain', 'Rnd 1: ch 2, sc in 3rd ch from hook.', 'E_NO_CHAIN', 1, 17, 1, 36, 'has only 2 ch'],
  ['ring join without chains', 'Rnd 1: join to form ring.', 'E_NO_CHAIN', 1, 8, 1, 25, '"join to form ring" needs a chain right before it'],
  ['uneven repeat around', `${R1}Rnd 2: *3 sc, inc* around.`, 'E_REPEAT_UNEVEN', 2, 8, 2, 26, 'does not fit evenly: after 1 full repeat 2 stitches are left in Rnd 1'],
  ['repeat around that never ends', `${R1}Rnd 2: *ch 3* around.`, 'E_REPEAT_UNEVEN', 2, 8, 2, 21, 'would never end'],
  ['count mismatch (N)', `${R1}Rnd 2: inc x6. (13)`, 'E_COUNT_MISMATCH', 2, 16, 2, 20, 'Rnd 2: count mismatch — pattern says (13) but the round makes 12 stitches.'],
  ['count mismatch typed', `${R1}Rnd 2: inc x6. (11 sc)`, 'E_COUNT_MISMATCH', 2, 16, 2, 23, 'pattern says 11 sc but the round makes 12 sc'],
  ['count mismatch, one of several parts', `${R1}Rnd 2: *sc, ch 3* x6. (6, 5 ch-3 sps)`, 'E_COUNT_MISMATCH', 2, 27, 2, 37, 'pattern says 5 ch-3 sps but the round makes 6 ch-3 sps'],
  ['stitches after fasten off', 'Rnd 1: mr, 6 sc in ring, fasten off, sc.', 'E_AFTER_FASTEN_OFF', 1, 38, 1, 40, 'nothing may follow "fasten off"'],
  ['round after fasten off', 'Rnd 1: mr, 6 sc in ring, fasten off.\nRnd 2: inc x6.', 'E_AFTER_FASTEN_OFF', 2, 1, 2, 6, 'fastened off earlier'],
  ['unworked stitches', `${R1}Rnd 2: 5 sc.`, 'W_UNWORKED', 2, 1, 2, 6, '1 stitch of Rnd 1 is left unworked'],
  ['unknown header', 'colour: red\nRnd 1: mr, 6 sc in ring.', 'W_UNKNOWN_HEADER', 1, 1, 1, 12, 'unknown header "colour"'],
  ['count unit not checked', `${R1}Rnd 2: inc x6. (12, 6 incs)`, 'I_COUNT_UNVERIFIED', 2, 21, 2, 27, 'cannot check "6 incs"'],
  ['turn in a row', 'Row 1: ch 3, sc in 2nd ch from hook, sc, turn.', 'I_REDUNDANT_TURN', 1, 42, 1, 46, '"turn" is not needed'],
  ['unworked counting tch in a row', 'Row 1: ch 8, dc in 4th ch from hook, dc in each ch across. (5)\nRow 2: ch 3 (counts as dc), dc in next 4 sts. (5)\nRow 3: ch 3 (counts as dc), dc in next 3 sts. (4)', 'I_UNWORKED_TCH', 3, 1, 3, 6, 'turning chain at the end of Row 2'],
];

describe('diagnostics: code, position, message', () => {
  it.each(rows)('%s', (_name, text, code, line, col, endLine, endCol, msg) => {
    const r = compilePattern(text);
    const d = r.diagnostics.find((x) => x.code === code);
    expect(d, `no ${code} in:\n${r.diagnostics.map((x) => formatDiagnostic(x)).join('\n')}`).toBeDefined();
    expect({ line: d!.line, col: d!.col, endLine: d!.endLine, endCol: d!.endCol }).toEqual({ line, col, endLine, endCol });
    if (typeof msg === 'string') expect(d!.message).toContain(msg);
    else expect(d!.message).toMatch(msg);
    const sev = code.startsWith('E_') ? 'error' : code.startsWith('W_') ? 'warning' : 'info';
    expect(d!.severity).toBe(sev);
    if (sev === 'error') expect(r.pattern).toBeUndefined();
    else expect(r.pattern).toBeDefined();
  });

  it('every code of notation.md section 4 is covered', () => {
    const codes: DiagnosticCode[] = [
      'E_SYNTAX', 'E_UNKNOWN_STITCH', 'E_UNCLOSED_REPEAT', 'E_UNCLOSED_GROUP', 'E_ROUND_NUMBER', 'E_NO_TARGET', 'E_NO_SPACE',
      'E_SPACE_LENGTH', 'E_NO_RING', 'E_NO_CHAIN', 'E_REPEAT_UNEVEN', 'E_COUNT_MISMATCH', 'E_AFTER_FASTEN_OFF', 'W_UNWORKED',
      'W_UNKNOWN_HEADER', 'I_COUNT_UNVERIFIED', 'I_REDUNDANT_TURN',
    ];
    for (const c of codes) expect(rows.some((r) => r[2] === c)).toBe(true);
  });

  it('diagnostics carry the graph round index', () => {
    const d = compilePattern(`${R1}Rnd 2: inc x6. (13)`).diagnostics[0];
    expect(d.round).toBe(1);
  });
});

describe('error recovery', () => {
  it('reports several errors in one pass, in source order', () => {
    const text = [
      'Rnd 1: mr, 6 sc in rng, xyz. (6)',
      'Rnd 2: inc x6. (12)',
      'Rnd 3: *sc, inc x6. (18)',
      'Rnd 4: *2 sc, inc* x6. (25)',
    ].join('\n');
    const r = compilePattern(text);
    const codes = r.diagnostics.map((d) => `${d.line}:${d.code}`);
    expect(codes).toContain('1:E_SYNTAX'); // "in rng"
    expect(codes).toContain('1:E_UNKNOWN_STITCH'); // xyz
    expect(codes).toContain('3:E_UNCLOSED_REPEAT');
    // Rnd 4 follows a broken round: its target/count diagnostics would be cascades and are dropped
    expect(codes.filter((c) => c.startsWith('4:'))).toEqual([]);
    expect(r.pattern).toBeUndefined();
  });

  it('a clean round after a broken one is checked normally again', () => {
    const text = `${R1}Rnd 2: 7 sc.\nRnd 3: 6 sc.\nRnd 4: sc in each st around. (5)`;
    const codes = compilePattern(text).diagnostics.map((d) => `${d.line}:${d.code}`);
    expect(codes).toEqual(['2:E_NO_TARGET', '4:E_COUNT_MISMATCH']);
  });

  it('several syntax errors inside one round', () => {
    const r = compilePattern('Rnd 1: mr, 6 qq in ring, ch 3 (counts as zz), 3 sc in ring, @, 2 sc in ring.');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['E_UNKNOWN_STITCH', 'E_UNKNOWN_STITCH', 'E_SYNTAX']);
  });

  it('nested unclosed brackets: group inside repeat', () => {
    const r = compilePattern(`${R1}Rnd 2: *sc, (sc, ch 1* x3.`);
    expect(r.diagnostics.map((d) => [d.code, d.col])).toEqual([['E_UNCLOSED_GROUP', 13]]);
  });

  it('empty file and header-only file', () => {
    expect(compilePattern('').diagnostics.map((d) => d.code)).toEqual(['E_SYNTAX']);
    expect(compilePattern('title: x\n').diagnostics.map((d) => d.code)).toEqual(['E_SYNTAX']);
  });

  it('messages read like crochet, with expected vs found', () => {
    const d = compilePattern(`${R1}Rnd 2: 2 sc in next st x7. (14)`).diagnostics;
    expect(d.map((x) => formatDiagnostic(x, 'p.cro'))).toEqual([
      'p.cro:2:13 error E_NO_TARGET Rnd 2: needs a stitch to work into but Rnd 1 has none left.',
    ]);
  });
});
