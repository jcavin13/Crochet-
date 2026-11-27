import { describe, expect, it } from 'vitest';
import { compilePattern } from '../notation';
import { analyzeFlatness } from '../flatness';
import { paramSetById } from '../params';
import {
  generateDoily, planDoily, explainRound, fixesFor, flatBudget, suggestNext, compatibleOrders, halveEntries, PRESETS,
  type DoilySpec,
} from './index';
import { doilyTemplateSvg } from './snowflake';

const THREAD = paramSetById('thread-10_1.5mm')!;
const classic = PRESETS[0].spec;

describe('suggestions', () => {
  it('are deterministic for a given state', () => {
    const a = suggestNext(classic, THREAD, { targetCm: 20 });
    const b = suggestNext(classic, THREAD, { targetCm: 20 });
    expect(a.motifs.map((s) => [s.id, s.score])).toEqual(b.motifs.map((s) => [s.id, s.score]));
    expect(a.continuations.map((s) => s.id)).toEqual(b.continuations.map((s) => s.id));
    expect(a.finish.map((s) => s.id)).toEqual(b.finish.map((s) => s.id));
  });

  it('rank flat motifs first, explain why, and the top suggestion really is flat when added', () => {
    for (const p of PRESETS.slice(0, 4)) {
      const spec = { ...p.spec, rounds: p.spec.rounds.slice(0, 4) };
      const s = suggestNext(spec, THREAD);
      expect(s.motifs.length).toBeGreaterThan(5);
      const firstBad = s.motifs.findIndex((m) => !m.flat);
      if (firstBad >= 0) expect(s.motifs.slice(firstBad).every((m) => !m.flat || m.overTarget || m.score >= 0)).toBe(true);
      expect(s.motifs[0].reason).toMatch(/keeps \d+-fold/);
      const top = s.motifs[0];
      const r = generateDoily({ ...spec, rounds: [...spec.rounds, ...top.add] }, THREAD);
      expect(r.diagnostics).toEqual([]);
      expect(r.rounds.every((x) => x.class === 'flat')).toBe(true);
      // each suggestion's preview ends with the added rounds
      expect(top.preview[top.preview.length - 1].added).toBe(true);
      expect(s.continuations.map((c) => c.style)).toEqual(['lacy', 'solid', 'dramatic']);
      for (const c of s.continuations) expect(c.add.length).toBe(3);
      expect(s.finish.length).toBe(3);
    }
  }, 60_000);

  it('motifs that need a transition say so and add it', () => {
    const spec: DoilySpec = { symmetry: 8, rounds: [{ motif: 'centre', params: { st: 'dc' } }, { motif: 'solid' }] };
    const s = suggestNext(spec, THREAD);
    const petals = s.motifs.find((m) => m.id === 'motif-petals')!;
    expect(petals.transition).toBe('mesh');
    expect(petals.add.map((r) => r.motif)).toEqual(['mesh', 'petals']);
    expect(petals.reason).toMatch(/chain-loop mesh round goes first/);
  });

  it('a target diameter pushes oversize suggestions down', () => {
    const big = suggestNext(classic, THREAD, { targetCm: 9 });
    expect(big.motifs.some((m) => m.overTarget)).toBe(true);
    const firstOver = big.motifs.findIndex((m) => m.overTarget);
    expect(big.motifs.slice(0, firstOver).every((m) => !m.overTarget)).toBe(true);
  });

  it('an empty design suggests centres', () => {
    const s = suggestNext({ symmetry: 6, rounds: [] }, THREAD);
    expect(s.motifs.every((m) => m.add[0].motif === 'centre')).toBe(true);
  });
});

describe('automatic sizing, explained', () => {
  it('the chosen value is among the alternatives and its number matches the real check', () => {
    const plan = planDoily(classic, THREAD);
    const r = generateDoily(classic, THREAD);
    const real = analyzeFlatness(r.pattern!.graph, THREAD);
    for (let i = 0; i < plan.planned.length; i++) {
      const ex = explainRound(classic, THREAD, i, plan)!;
      expect(ex.sentence.length).toBeGreaterThan(5);
      for (const p of ex.params) {
        const chosen = p.alts.find((a) => a.chosen);
        expect(chosen, `${i} ${p.key}`).toBeDefined();
        expect(chosen!.e).toBeCloseTo(real.rounds[i].e, 6);
        expect(p.alts.length).toBeLessThanOrEqual(5);
      }
    }
  });

  it('a user override that breaks flatness gets a one-change fix that works', () => {
    const spec: DoilySpec = { ...classic, rounds: classic.rounds.map((x, i) => (i === 3 ? { motif: 'mesh', params: { ch: 8 } } : x)) };
    const plan = planDoily(spec, THREAD);
    const idx = plan.planned.findIndex((p) => p.source === 3 && !p.auto);
    expect(Math.abs(plan.planned[idx].pred.e)).toBeGreaterThan(0.1);
    const fixes = fixesFor(spec, THREAD, idx, plan);
    expect(fixes.length).toBeGreaterThan(0);
    const f = fixes.find((x) => x.key === 'ch')!;
    expect(f.text).toMatch(/^Fix: set chain length to ch \d$/);
    const fixed: DoilySpec = { ...spec, rounds: spec.rounds.map((x, i) => (i === 3 ? { motif: 'mesh', params: { ch: f.value as number } } : x)) };
    const r = generateDoily(fixed, THREAD);
    const round = r.rounds.find((x) => x.source === 3 && !x.auto)!;
    expect(round.class).toBe('flat');
    expect(Math.abs(round.e)).toBeLessThanOrEqual(0.1);
    // a flat round needs no fix
    expect(fixesFor(classic, THREAD, 3)).toEqual([]);
  });

  it('the flat stitch budget is the textbook count for a dc circle', () => {
    const W = paramSetById('worsted-4_5.0mm')!;
    // round 1 of a dc circle hands on r = h_dc; a flat second round of dc needs ≈ 24 widths (12 more)
    const b = flatBudget(W.stitches.dc.height, 12, W);
    expect(Math.round(b.widths)).toBe(24);
    expect(b.perRepeat).toBeCloseTo(2, 0);
    expect(b.text).toMatch(/A flat round here needs ≈ 24 stitch-widths of dc \(2 per repeat\)/);
  });
});

describe('symmetry tools', () => {
  it('compatible orders', () => {
    expect(compatibleOrders(12)).toEqual({ divisors: [3, 4, 6], multiples: [24] });
    expect(compatibleOrders(6)).toEqual({ divisors: [3], multiples: [12, 18, 24] });
  });

  it('doubling the repeats from a layer outward keeps every count consistent', () => {
    for (const n of [5, 6, 8]) {
      const spec: DoilySpec = {
        symmetry: n,
        rounds: [{ motif: 'centre' }, { motif: 'mesh', params: { per: 2 } }, { motif: 'mesh', double: true }, { motif: 'shells' }, { motif: 'picot' }],
      };
      const r = generateDoily(spec, THREAD);
      expect(r.diagnostics, r.text).toEqual([]);
      expect(r.warnings.filter((w) => /cannot be doubled/.test(w))).toEqual([]);
      expect(r.rounds.map((x) => x.repeats)).toEqual([n, n, 2 * n, 2 * n, 2 * n]);
      expect(r.rounds[2].doubled).toBe(true);
      const g = compilePattern(r.text).pattern!.graph;
      g.rounds.forEach((round, i) => expect(round.stitchCount % r.rounds[i].repeats).toBe(0));
      expect(r.rounds.every((x) => x.class === 'flat')).toBe(true);
    }
  });

  it('doubling is refused (with a reason) where the round below has one group per repeat', () => {
    const r = generateDoily({ symmetry: 6, rounds: [{ motif: 'centre' }, { motif: 'mesh', params: { per: 1 } }, { motif: 'mesh', double: true }] }, THREAD);
    expect(r.warnings.join(' ')).toMatch(/cannot be doubled here/);
    expect(r.rounds.every((x) => x.repeats === 6)).toBe(true);
    expect(halveEntries([{ kind: 'st', type: 'sc' }, { kind: 'sp', len: 3 }])).toBeNull();
    expect(halveEntries([{ kind: 'st', type: 'sc' }, { kind: 'sp', len: 3 }, { kind: 'st', type: 'sc' }, { kind: 'sp', len: 3 }])).toHaveLength(2);
  });
});

describe('doily blocking template', () => {
  it('has a ring per round, n sector lines and 2n pins', () => {
    const r = generateDoily(classic, THREAD);
    const svg = doilyTemplateSvg(r);
    expect(svg.match(/class="guide"/g)?.length).toBe(12);
    expect(svg.match(/class="ring"/g)?.length).toBe(r.rounds.length);
    expect(svg.match(/class="pin"/g)?.length).toBe(24);
    expect(svg).toMatch(/width="[\d.]+mm"/);
    expect(svg).toContain('Print at 100 %');
    expect(svg).toContain('5 cm');
  });
});
