import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateDoily, PRESETS, randomSpec } from '../generate';
import { compilePattern } from '../notation';
import { paramSetById, paramsFile } from '../params';
import { analyzeSymmetry, type SymmetryReport } from './index';

const FIX = fileURLToPath(new URL('../../../../spec/fixtures/', import.meta.url));
const CORPUS = fileURLToPath(new URL('../../../../data/corpus/', import.meta.url));

function analyze(text: string): { report: SymmetryReport; graph: NonNullable<ReturnType<typeof compilePattern>['pattern']>['graph'] } {
  const r = compilePattern(text);
  if (!r.pattern) throw new Error(r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line}:${d.col} ${d.message}`).join('\n'));
  return { report: analyzeSymmetry(r.pattern.graph), graph: r.pattern.graph };
}
const fixture = (n: string) => readFileSync(`${FIX}${n}.cro`, 'utf8');

/** Whole-piece group of every fixture and corpus pattern (intended symmetry from names / notes). */
const EXPECTED: Record<string, string> = {
  // fixtures
  chain_space_motif: 'D8',
  flat_dc_circle: 'C12', // stacked increases twist: rotation without mirror
  flat_sc_circle: 'C6',
  hyperbolic_plane: 'C3', // x6, x12, x12, x18, x27 → gcd 3
  sc_cone: 'C3',
  sc_sphere: 'C6',
  simple_doily: 'D16',
  // corpus
  'bobble-flower-coaster-6': 'D6',
  'granny-square-motif': 'D4',
  'hexagon-motif-6': 'D6',
  'petal-doily-12': 'C12',
  // "24-fold" names the picot edge; the dc centre below it is 12-fold (pairs of dc in each st)
  'picot-coaster-24': 'C12',
  'popcorn-ridge-mat-8': 'C8',
  'puff-star-coaster-5': 'D5',
  'rep-from-star-rosette-8': 'D8',
  // the 24-repeat border sits on a 12-fold solid centre ("24-fold border")
  'solid-centre-lace-border-24': 'C12',
  'spiderweb-doily-10': 'C10',
  'spiral-sc-mat-fan-edge': 'C6',
  // Rnd 8 puts its first fan in the V's ch-3 sp but the other 19 in the sp after the sc (a
  // transcription slip in the corpus file, reported): 20-fold up to Rnd 7, a defect in Rnd 8
  'sunburst-dtr-doily-20': 'D20',
  'teaching-cup-basket': 'C6',
  'teaching-ruffle-shell-doily': 'C12',
  'uk-terms-wheel-16': 'D16',
  'wheel-mesh-centrepiece-8': 'C8',
};

describe('analyzeSymmetry on fixtures and corpus', () => {
  const files = [
    ...readdirSync(FIX).filter((f) => f.endsWith('.cro')).map((f) => FIX + f),
    ...readdirSync(CORPUS).filter((f) => f.endsWith('.cro')).map((f) => CORPUS + f),
  ];
  it('covers every file', () => {
    const names = files.map((f) => f.replace(/^.*\//, '').replace(/\.cro$/, '')).sort();
    expect(names).toEqual(Object.keys(EXPECTED).sort());
  });
  for (const f of files) {
    const name = f.replace(/^.*\//, '').replace(/\.cro$/, '');
    it(`${name} → ${EXPECTED[name]}`, () => {
      const { report } = analyze(readFileSync(f, 'utf8'));
      expect(report.applicable).toBe(true);
      expect(report.group).toBe(EXPECTED[name]);
      expect(report.summary[0]).toMatch(/^Whole piece/);
      // the name's "-N" is the order of the piece, except where documented above
      const m = /-(\d+)$/.exec(name);
      if (m && !['picot-coaster-24', 'solid-centre-lace-border-24'].includes(name)) {
        expect(report.order).toBe(Number(m[1]));
      }
      expect(report.defects).toEqual([]);
    });
  }

  it('documents the deviations: last-round order of the picot coaster; finds the slip the sunburst doily originally had', () => {
    const picot = analyze(readFileSync(`${CORPUS}picot-coaster-24.cro`, 'utf8')).report;
    expect(picot.rounds.at(-1)!.order).toBe(24);
    expect(picot.rounds.at(-1)!.cumulative).toBe(12);
    const border = analyze(readFileSync(`${CORPUS}solid-centre-lace-border-24.cro`, 'utf8')).report;
    expect(border.rounds.slice(6).map((r) => r.order)).toEqual([24, 24, 24, 24]);
    // The corpus file once lacked this skip in Rnd 8's repeat (found by this analysis, since fixed).
    const sunText = readFileSync(`${CORPUS}sunburst-dtr-doily-20.cro`, 'utf8');
    expect(sunText).toContain('*sk next ch-3 sp, (3 dc, picot, 3 dc)');
    const sun = analyze(sunText.replace('*sk next ch-3 sp, (3 dc, picot, 3 dc)', '*(3 dc, picot, 3 dc)')).report;
    expect(sun.rounds.slice(0, 7).every((r) => r.cumulative === 20)).toBe(true);
    expect(sun.defects).toHaveLength(1);
    expect(sun.defects[0].round).toBe(7);
    expect(sun.defects[0].order).toBe(20);
    expect(sun.rounds[7].nearOrder).toBe(20);
  });

  it('reports per-round own and cumulative orders (bobble coaster: 12 → 6)', () => {
    const { report } = analyze(readFileSync(`${CORPUS}bobble-flower-coaster-6.cro`, 'utf8'));
    expect(report.rounds.map((r) => r.order)).toEqual([12, 12, 12, 6, 6]);
    expect(report.rounds.map((r) => r.cumulative)).toEqual([12, 12, 12, 6, 6]);
    expect(report.summary).toContain('Rnds 1–3 are 12-fold; Rnd 4 reduces it to 6.');
    expect(report.rounds[0].period).toBe(1);
    expect(report.rounds[3].period).toBe(7);
  });

  it('a round that repeats more often than the round below (petal Rnd 11: 36 on 12)', () => {
    const { report } = analyze(readFileSync(`${CORPUS}petal-doily-12.cro`, 'utf8'));
    expect(report.rounds[10].order).toBe(36);
    expect(report.rounds[10].cumulative).toBe(12);
  });

  it('is cheap: the 15-round centrepiece in well under 100 ms', () => {
    const text = readFileSync(`${CORPUS}wheel-mesh-centrepiece-8.cro`, 'utf8');
    const g = compilePattern(text).pattern!.graph;
    const t0 = performance.now();
    analyzeSymmetry(g);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('gives a drawing frame: order sector boundaries and 2·order mirror half-axes', () => {
    const { report, graph } = analyze(fixture('simple_doily'));
    const f = report.frame!;
    expect(f.round).toBe(graph.rounds.length - 1);
    expect(f.sectors).toHaveLength(16);
    expect(f.axes).toHaveLength(32);
    expect(f.elementNodes.length % 16).toBe(0);
    const c6 = analyze(fixture('flat_sc_circle')).report.frame!;
    expect(c6.sectors).toHaveLength(6);
    expect(c6.axes).toEqual([]);
  });
});

describe('designer output', () => {
  const params = paramSetById('thread-10_1.5mm') ?? paramsFile.sets[0];
  for (const p of PRESETS) {
    it(`preset ${p.id} is ${p.spec.symmetry}-fold`, () => {
      const g = generateDoily(p.spec, params);
      expect(analyzeSymmetry(g.pattern!.graph).order).toBe(p.spec.symmetry);
    });
  }
  it('seeded random designs are n-fold for their n', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const spec = randomSpec(seed, {});
      const g = generateDoily(spec, params);
      if (!g.pattern) continue;
      expect(analyzeSymmetry(g.pattern.graph).order, `seed ${seed}`).toBe(spec.symmetry);
    }
  });
});

describe('defects: almost-symmetric rounds', () => {
  it('one chain length changed in one repeat of the last round → localised to that repeat', () => {
    const text = fixture('simple_doily').replace(/Rnd 6:.*$/m,
      'Rnd 6: sl st in next ch-2 sp, ch 1, (sc, picot, sc) in same sp, ch 4, *(sc, picot, sc) in next ch-2 sp, ch 4* x6, (sc, picot, sc) in next ch-2 sp, ch 3, *(sc, picot, sc) in next ch-2 sp, ch 4* x8, join, fasten off.');
    const { report, graph } = analyze(text);
    expect(report.order).toBe(1);
    expect(report.defects).toHaveLength(1);
    const d = report.defects[0];
    expect(d.round).toBe(5);
    expect(d.order).toBe(16);
    expect(d.message).toBe('Rnd 6 is 16-fold except near stitches 16–17: one repeat has ch 3 where the others have ch 4.');
    // exactly the three chains of the short loop
    expect(d.nodes).toHaveLength(3);
    expect(d.nodes.every((n) => graph.nodes[n].type === 'ch')).toBe(true);
    expect(report.rounds[5].nearOrder).toBe(16);
  });

  it('a typo in a middle round is reported once (the next round is not blamed for it)', () => {
    const text = fixture('chain_space_motif')
      .replace(/Rnd 3:.*$/m, 'Rnd 3: sl st in next ch-3 sp, ch 1, sc in same sp, ch 5, *sc in next ch-3 sp, ch 5* x3, sc in next ch-3 sp, ch 4, *sc in next ch-3 sp, ch 5* x3, join.')
      .replace(/Rnd 4:.*$/m, 'Rnd 4: sl st in next sp, ch 1, (sc, ch 3, sc) in same sp, ch 5, *(sc, ch 3, sc) in next sp, ch 5* x7, join, fasten off.');
    const { report, graph } = analyze(text);
    expect(report.defects.map((d) => d.round)).toEqual([2]);
    const d = report.defects[0];
    expect(d.message).toMatch(/^Rnd 3 is 8-fold except near stitches 5–6: one repeat has ch 4 where the others have ch 5\.$/);
    expect(d.nodes).toHaveLength(4);
    expect(d.nodes.every((n) => graph.nodes[n].type === 'ch' && graph.nodes[n].round === 2)).toBe(true);
  });

  it('a stitch type typo, an extra stitch, a displaced increase', () => {
    const hdc = analyze(fixture('flat_sc_circle').replace(/Rnd 8:.*$/m, 'Rnd 8: *6 sc, inc* x2, 6 sc, 2 hdc in next st, *6 sc, inc* x3.')).report;
    expect(hdc.defects[0].message).toBe('Rnd 8 is 6-fold except near stitches 23–24: one repeat has hdc where the others have sc.');
    const extra = analyze(fixture('flat_sc_circle').replace(/Rnd 8:.*$/m, 'Rnd 8: *6 sc, inc* x2, 5 sc, inc, inc, *6 sc, inc* x3.')).report;
    expect(extra.defects[0].order).toBe(6);
    expect(extra.defects[0].message).toMatch(/^Rnd 8 is 6-fold except near stitches 18–26: one repeat has 1 extra item/);
    const moved = analyze(fixture('flat_sc_circle').replace(/Rnd 4:.*$/m, 'Rnd 4: *2 sc, inc* x2, sc, inc, 3 sc, inc, *2 sc, inc* x2.')).report;
    expect(moved.defects).toHaveLength(1);
    expect(moved.defects[0].round).toBe(3);
    expect(moved.defects[0].order).toBe(6);
  });

  it('no defects on a clean pattern, and no defect for a round that is just more finely repeated', () => {
    expect(analyze(fixture('simple_doily')).report.defects).toEqual([]);
    expect(analyze(readFileSync(`${CORPUS}teaching-ruffle-shell-doily.cro`, 'utf8')).report.defects).toEqual([]);
  });
});

describe('spirals and rows', () => {
  it('a spiral sc circle with staggered increases is 6-fold (rounds read as closed rings)', () => {
    const text = 'title: s\nRnd 1: mr, 6 sc in ring. (6)\nRnd 2: inc x6.\nRnd 3: *sc, inc* x6.\nRnd 4: sc, inc, *2 sc, inc* x5, sc.\nRnd 5: 2 sc, inc, *3 sc, inc* x5, sc.\n';
    const { report } = analyze(text);
    expect(report.order).toBe(6);
    expect(report.rounds.map((r) => r.order)).toEqual([6, 6, 6, 6, 6]);
  });
  it('rows are not applicable', () => {
    const { report } = analyze('title: r\nFoundation: ch 11.\nRow 1: sc in 2nd ch from hook, sc in each ch across. (10)\nRow 2: ch 1, sc in each st across. (10)\n');
    expect(report.applicable).toBe(false);
    expect(report.group).toBe('C1');
  });
});
