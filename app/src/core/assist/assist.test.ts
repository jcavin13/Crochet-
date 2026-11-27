import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeFlatness } from '../flatness';
import { compilePattern } from '../notation';
import { paramSetById, paramsFor } from '../params';
import { analyzeSymmetry } from '../symmetry';
import {
  applyFix, fixAll, needsFix, suggestCounts, suggestCountsForRound, suggestFixes, suggestRoundFixes, updateCountAnnotations,
} from './index';

const FIX = fileURLToPath(new URL('../../../../spec/fixtures/', import.meta.url));
const CORPUS = fileURLToPath(new URL('../../../../data/corpus/', import.meta.url));
const corpus = (n: string) => readFileSync(`${CORPUS}${n}.cro`, 'utf8');
const fixture = (n: string) => readFileSync(`${FIX}${n}.cro`, 'utf8');

function check(text: string) {
  const r = compilePattern(text);
  return { r, errors: r.diagnostics.filter((d) => d.severity === 'error'), params: paramsFor(r.pattern) };
}
function flatness(text: string) {
  const { r, params } = check(text);
  return analyzeFlatness(r.pattern!.graph, params);
}

describe('teaching patterns', () => {
  it('ruffled shell edge: Rnd 5 → shells in every 4th stitch (and Rnd 6 re-balanced), all flat after fix-all', () => {
    const text = corpus('teaching-ruffle-shell-doily');
    const params = check(text).params;
    const rs = suggestRoundFixes(text, 4, params);
    expect(rs.length).toBeGreaterThan(0);
    const best = rs[0];
    expect(best.label).toBe('Rnd 5: skip 3 instead of 1 (and Rnd 6: ×24 → ×12) → lies flat (+0%)');
    expect(best.diff.after[0]).toBe('Rnd 5: ch 3 (does not count as st), shell in same st, sk 3 sts, *shell in next st, sk 3 sts* x11, join. (60 dc, 12 shells)');
    expect(best.diff.after[1]).toMatch(/x12, join, fasten off\. \(108 sts, 24 sc, 84 dc, 12 shells\)$/);
    expect(best.countsUpdated).toBeGreaterThan(0);
    expect(best.order).toBe(12);
    expect(check(best.text).errors).toEqual([]);
    expect(flatness(best.text).rounds[4].class).toBe('flat');

    const all = fixAll(text, params);
    expect(all.steps.map((s) => s.round)).toEqual([4, 5]);
    expect(all.remaining).toEqual([]);
    expect(check(all.text).errors).toEqual([]);
    expect(flatness(all.text).rounds.every((r) => r.class === 'flat' && !r.slackOnly)).toBe(true);
    expect(analyzeSymmetry(check(all.text).r.pattern!.graph).order).toBe(12);
  });

  it('sc basket: every cupping round gets an even-increase rewrite; fix-all flattens it and keeps 6-fold', () => {
    const text = corpus('teaching-cup-basket');
    const params = check(text).params;
    const per = suggestFixes(text, params);
    expect(per.map((r) => r.label)).toEqual(['Rnd 7', 'Rnd 8', 'Rnd 9', 'Rnd 10', 'Rnd 11', 'Rnd 12', 'Rnd 13']);
    for (const r of per.slice(0, 6)) {
      expect(r.suggestions.length, r.label).toBeGreaterThan(0);
      expect(r.suggestions[0].result.class, r.label).toBe('flat');
      expect(r.suggestions[0].compiles, r.label).toBe(true);
    }
    // Rnd 7 on its own: the textbook six increases, written in the round's own back-loop stitches
    const r7 = per[0].suggestions[0];
    expect(r7.diff.after).toEqual(['Rnd 7: ch 1, *sc blo in next 5 sts, 2 sc blo in next st* x6, join. (42)', 'Rnds 8-12: ch 1, sc in each st around, join. (42)']);
    // a round inside "Rnds 8-12" is split out of the range label
    const r9 = per[2].suggestions[0];
    expect(r9.diff.after.join('\n')).toMatch(/^Rnd 8: ch 1, sc in each st around, join\. \(36\)\nRnd 9: .*\nRnds 10-12: ch 1, sc in each st around, join\. \(54\)/);

    const all = fixAll(text, params);
    expect(check(all.text).errors).toEqual([]);
    expect(all.remaining).toEqual([]);
    expect(compilePattern(all.text).diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
    expect(all.warnings).toEqual([]);
    const f = flatness(all.text);
    expect(f.rounds.every((r) => r.class === 'flat')).toBe(true);
    expect(analyzeSymmetry(check(all.text).r.pattern!.graph).order).toBe(6);
  });
});

describe('textbook fixes', () => {
  it('a flat sc circle with one over-increased round → the textbook *6 sc, inc* x6', () => {
    const text = fixture('flat_sc_circle').replace('Rnd 8: *6 sc, inc* x6. (48)', 'Rnd 8: *5 sc, inc, inc* x6. (54)');
    const params = check(text).params;
    const f = flatness(text);
    expect(f.rounds[7].class).toBe('ruffle');
    const s = suggestRoundFixes(text, 7, params);
    expect(s[0].diff.after).toEqual(['Rnd 8: *sc in next 6 sts, 2 sc in next st* x6. (48)']);
    expect(s[0].result.class).toBe('flat');
    expect(applyFix(text, s[0])).toBe(s[0].text);
    expect(() => applyFix(text + ' ', s[0])).toThrow();
  });

  it('a flat dc circle with a round of no increases (counted turning chain)', () => {
    const text = fixture('flat_dc_circle').replace(/Rnd 5:.*$/m, 'Rnd 5: ch 3 (counts as dc), dc in each st around, join. (48)');
    const s = suggestRoundFixes(text, 4, check(text).params);
    expect(s[0].diff.after).toEqual(['Rnd 5: ch 3 (counts as dc), dc in next 2 sts, 2 dc in next st, *dc in next 3 sts, 2 dc in next st* x11, join. (60)']);
  });

  it('a lace round with over-long loops → a shorter chain in each repeat', () => {
    const text = fixture('chain_space_motif').replace(/Rnd 4:.*$/m, 'Rnd 4: sl st in next ch-5 sp, ch 1, (sc, ch 3, sc) in same sp, ch 11, *(sc, ch 3, sc) in next ch-5 sp, ch 11* x7, join, fasten off. (16 sc, 8 ch-3 sps, 8 ch-11 sps)');
    const f = flatness(text);
    expect(needsFix(f.rounds[3])).toBe(true);
    const s = suggestRoundFixes(text, 3, check(text).params);
    expect(s.length).toBeGreaterThan(0);
    const chain = s.find((x) => /change ch 11 → ch \d+ in each repeat/.test(x.change));
    expect(chain).toBeDefined();
    expect(chain!.result.class).toBe('flat');
    expect(chain!.result.slackOnly).toBe(false);
    expect(chain!.diff.after[0]).toMatch(/\(16 sc, 8 ch-3 sps, 8 ch-\d+ sps\)$/);
  });
});

describe('safety', () => {
  const files = [
    ...readdirSync(FIX).filter((f) => f.endsWith('.cro')).map((f) => FIX + f),
    ...readdirSync(CORPUS).filter((f) => f.endsWith('.cro')).map((f) => CORPUS + f),
  ];
  it('never proposes an edit that does not compile (every fixture and corpus pattern)', () => {
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      const params = check(text).params;
      for (const r of suggestFixes(text, params, { max: 3 })) {
        for (const s of r.suggestions) {
          const errs = check(s.text).errors;
          if (s.compiles) expect(errs, `${f} ${s.label}`).toEqual([]);
          else expect(s.attention.length, `${f} ${s.label}`).toBeGreaterThan(0);
          // count annotations of the edited round are up to date
          expect(errs.filter((d) => d.code === 'E_COUNT_MISMATCH' && d.round === s.round), `${f} ${s.label}`).toEqual([]);
          expect(s.order, `${f} ${s.label}`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  }, 60_000);

  it('is idempotent on flat patterns: no suggestions, fix-all changes nothing', () => {
    for (const n of ['flat_sc_circle', 'flat_dc_circle']) {
      const text = fixture(n);
      const params = check(text).params;
      expect(suggestFixes(text, params)).toEqual([]);
      const all = fixAll(text, params);
      expect(all.text).toBe(text);
      expect(all.steps).toEqual([]);
    }
    for (const n of ['teaching-ruffle-shell-doily', 'teaching-cup-basket']) {
      const text = corpus(n);
      const params = check(text).params;
      const once = fixAll(text, params).text;
      expect(fixAll(once, params).text).toBe(once);
    }
  });
});

describe('count annotations', () => {
  it('rewrites only the numbers that changed', () => {
    const text = fixture('chain_space_motif').replace('(8 sc, 8 ch-5 sps)', '(9 sc, 7 ch-5 sps)');
    const u = updateCountAnnotations(text);
    expect(u.ok).toBe(true);
    expect(u.edits).toHaveLength(2);
    expect(u.text).toBe(fixture('chain_space_motif'));
    expect(updateCountAnnotations(fixture('simple_doily')).edits).toEqual([]);
  });
});

describe('what should this round be', () => {
  const params = paramSetById('worsted-4_5.0mm')!;
  it('scales with radius and order and offers a solid and a lace option', () => {
    const s = suggestCounts({ stitch: 'dc', order: 12, params, rPrev: 40 });
    expect(s.rho).toBeCloseTo(40 + params.stitches.dc.height, 6);
    expect(s.widths).toBeCloseTo((2 * Math.PI * s.rho) / params.stitches.dc.width, 6);
    expect(s.options[0].chains).toBe(0);
    expect(s.options[0].total % 12).toBe(0);
    expect(Math.abs(s.options[0].e)).toBeLessThan(0.1);
    expect(s.options.some((o) => o.chains > 0)).toBe(true);
    expect(s.message).toMatch(/^At this radius a flat round needs ≈ \d+ dc-widths: e\.g\. \d+ dc per repeat ×12, or \d+ dc \+ ch \d+ per repeat ×12\.$/);
  });
  it('for a round of the flat dc circle it agrees with what the round does', () => {
    const text = fixture('flat_dc_circle');
    const g = check(text).r.pattern!.graph;
    const s = suggestCountsForRound(g, 4, check(text).params)!;
    expect(s.stitch).toBe('dc');
    expect(s.order).toBe(12);
    expect(Math.abs(s.options[0].total - 60)).toBeLessThanOrEqual(12);
  });
});
