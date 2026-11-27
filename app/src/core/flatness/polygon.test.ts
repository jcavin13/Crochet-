// Polygon and border rules of the analytic flatness check (spec/flatness.md, "Polygons" and
// "Borders"): flat squares, hexagons and octagons are not "ruffles"; wrong corners are caught in
// corner terms; borders round rows are judged per side and per corner; the 7 fixtures unchanged.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyzeFlatness, detectPolygon, detectStadiumRectangle, type FlatnessReport } from './index';
import { paramsFor } from '../params';
import { compilePattern } from '../notation';
import { stableJson } from '../graph';
import { DEFAULT_SPEC, ROUND_STYLES, designBlanket, type BlanketSpec } from '../blanket';

const fixtures = fileURLToPath(new URL('../../../../spec/fixtures/', import.meta.url));
const corpus = fileURLToPath(new URL('../../../../data/corpus/', import.meta.url));
const cro = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.cro')).map((f) => f.slice(0, -4));

const compile = (text: string) => {
  const r = compilePattern(text);
  if (!r.pattern) throw new Error(r.diagnostics.map((d) => d.message).join('\n'));
  return r.pattern;
};
const analyze = (text: string): FlatnessReport => { const p = compile(text); return analyzeFlatness(p.graph, paramsFor(p)); };
const judged = (f: FlatnessReport) => f.rounds.filter((r) => r.class !== 'n/a');

/**
 * A dc square from a magic ring with chain-space corners "(L dc, ch 2, R dc)" (corner(k) gives
 * [L, R] for round k), every other stitch one dc in each dc. (2, 2) is the classic flat corner.
 */
function dcSquare(rounds: number, corner: (k: number) => [number, number]): string {
  const lines = ['Rnd 1: mr, ch 3 (does not count as st), (3 dc in ring, ch 2) x4, join. (12 sts, 4 ch-2 sps)'];
  let X = 3, T = 0, Lp = 0, Rp = 0;
  for (let k = 2; k <= rounds; k++) {
    const [L, R] = corner(k);
    const a = X + Lp, b = Rp + T;
    const grp = `(${L > 1 ? `${L} dc` : 'dc'}, ch 2, ${R > 1 ? `${R} dc` : 'dc'}) in next ch-2 sp`;
    const body = [a ? `dc in next ${a} sts` : '', grp, b ? `dc in next ${b} sts` : ''].filter(Boolean).join(', ');
    X = a; T = b; Lp = L; Rp = R;
    lines.push(`Rnd ${k}: ch 3 (does not count as st), *${body}* x4, join. (${4 * (a + b + L + R)} sts, 4 ch-2 sps)`);
  }
  return lines.join('\n');
}

/** A mitred sc square: "k sc in next st" at the corners, one sc in every other stitch. */
function scSquare(rounds: number, k: number): string {
  // Rnd 1: 8 sc (corner stitches 2, 4, 6, 8); later rounds: *sc in next a sts, k sc in next st, sc in next b sts* x4
  const lines = ['Rnd 1: mr, 8 sc in ring, join. (8)'];
  let lead = 1, trail = 0, half = 0; // stitches before / after each corner stitch of the round below
  for (let r = 2; r <= rounds; r++) {
    const a = lead + (r === 2 ? 0 : half), b = trail + (r === 2 ? 0 : half);
    lines.push(`Rnd ${r}: ch 1, *${[a ? `sc in next ${a} sts` : '', `${k} sc in next st`, b ? `sc in next ${b} sts` : ''].filter(Boolean).join(', ')}* x4, join. (${4 * (a + b + k)})`);
    lead = a; trail = b; half = (k - 1) / 2;
    if (!Number.isInteger(half)) throw new Error('odd corner groups only');
  }
  return lines.join('\n');
}

const spec = (p: Partial<BlanketSpec>): BlanketSpec => ({ ...DEFAULT_SPEC, ...p });

describe('one corner detector (core/flatness/corners.ts), conservative', () => {
  it('no fixture is a polygon (and their results do not change: see the golden-file test below)', () => {
    for (const name of cro(fixtures)) {
      const g = compile(readFileSync(fixtures + name + '.cro', 'utf8')).graph;
      expect(detectPolygon(g), name).toBeNull();
      expect(detectStadiumRectangle(g), name).toBeNull();
      expect(analyzeFlatness(g, paramsFor(compile(readFileSync(fixtures + name + '.cro', 'utf8')))).rounds.every((r) => r.shape === 'circle' || r.shape === 'rows'), name).toBe(true);
    }
  });
  it('no corpus pattern is a polygon except the granny square and the hexagon motif', () => {
    const want: Record<string, number> = { 'granny-square-motif': 4, 'hexagon-motif-6': 6 };
    for (const name of cro(corpus)) {
      const g = compile(readFileSync(corpus + name + '.cro', 'utf8')).graph;
      const p = detectPolygon(g);
      if (want[name]) expect(p?.n, name).toBe(want[name]);
      else { expect(p, name).toBeNull(); expect(detectStadiumRectangle(g), name).toBeNull(); }
    }
  });
});

describe('golden files: the 7 fixtures are byte-identical', () => {
  // same record as scripts/fixtures.ts (npm run fixtures -- --check also compares them)
  const r6 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 + 0 : x);
  for (const name of cro(fixtures)) {
    it(name, () => {
      const p = compile(readFileSync(fixtures + name + '.cro', 'utf8'));
      const rep = analyzeFlatness(p.graph, paramsFor(p));
      const rec = { name, rounds: rep.rounds.map((r) => ({ round: r.round, class: r.class, e_min: r6(r.eMin), e_max: r6(r.eMax), e: r6(r.e), rho: r6(r.rho), r: r6(r.r) })) };
      expect(stableJson(rec as never)).toBe(readFileSync(fixtures + name + '.flatness.json', 'utf8'));
    });
  }
});

describe('polygons worked from the centre lie flat (no false "ruffles")', () => {
  const styles = ['granny-square', 'solid-square', 'mitred-square', 'circle-to-square', 'hexagon', 'octagon', 'rect-round'] as const;
  for (const id of styles) {
    const st = ROUND_STYLES.find((s) => s.id === id)!;
    const textures = id === 'mitred-square' ? [['sc'], ['dc']] : [st.defaultTextures];
    for (const tex of textures) {
      it(`${id} (${tex.join('+')}): every round flat, judged as a polygon from its first cornered round`, () => {
        const d = designBlanket(spec({ construction: 'round', size: { widthCm: 40, heightCm: 40 }, round: { style: id, textures: tex as never, corner: 'auto' } }));
        const p = d.pattern ?? d.swatch!;
        const f = analyzeFlatness(p.graph, d.params);
        expect(f.polygon?.n, id).toBe(st.sides);
        for (const r of judged(f)) expect(r.class, r.message).toBe('flat');
        const poly = f.rounds.filter((r) => r.shape === 'polygon');
        expect(poly.length).toBeGreaterThan(3);
        // (a granny square's round 1 into a chain ring is the polygon's base round: judged as one too)
        expect([f.polygon!.from - 1, f.polygon!.from]).toContain(poly[0].round);
        if (id === 'circle-to-square') {
          // circle rule up to the squaring round, which is judged against the square it makes
          expect(f.rounds.slice(1, f.polygon!.from).every((r) => r.shape === 'circle')).toBe(true);
          expect(poly[0].polygon!.transition).toBe(true);
        }
        // the circle rule would have called most of these ruffles (squares: +27 %)
        if (st.sides === 4 && id !== 'granny-square') expect(poly.some((r) => r.e > -0.05)).toBe(true);
      });
    }
  }
  it('the two cornered corpus motifs are flat', () => {
    for (const name of ['granny-square-motif', 'hexagon-motif-6']) {
      const f = analyze(readFileSync(corpus + name + '.cro', 'utf8'));
      for (const r of judged(f)) expect(r.class, r.message).toBe('flat');
      expect(f.rounds.slice(1).every((r) => r.shape === 'polygon')).toBe(true);
    }
  });
  it('hand-written mitred dc square (2 dc, ch 2, 2 dc) and sc square (3 sc in corner) are flat; polygon detail', () => {
    const f = analyze(dcSquare(9, () => [2, 2]));
    for (const r of judged(f)) expect(r.class, r.message).toBe('flat');
    const r5 = f.rounds[4];
    expect(r5.shape).toBe('polygon');
    expect(r5.polygon!.n).toBe(4);
    expect(r5.polygon!.need).toBeCloseTo(r5.c / (1 + r5.e), 6);
    expect(r5.polygon!.corner).toEqual({ now: '(2 dc, ch 2, 2 dc)', delta: 0 });
    const s = analyze(scSquare(10, 3));
    expect(s.polygon?.n).toBe(4);
    for (const r of judged(s)) expect(r.class, r.message).toBe('flat');
  });
});

describe('wrong corners are caught, in corner terms', () => {
  it('one dc fewer per corner: the corners cup, "use (2 dc, ch 2, 2 dc)"', () => {
    const f = analyze(dcSquare(8, () => [2, 1]));
    const bad = judged(f).filter((r) => r.class !== 'flat');
    expect(bad.length).toBeGreaterThan(3);
    for (const r of bad) {
      expect(r.class).toBe('cup');
      expect(r.message).toMatch(new RegExp(`^${r.label}: corners are about \\d+ stitch(es)? short — the corners will cup \\(−\\d+%\\); use \\(2 dc, ch 2, 2 dc\\) in each corner \\(now \\(2 dc, ch 2, dc\\)\\)\\.$`));
      expect(r.polygon!.corner).toMatchObject({ now: '(2 dc, ch 2, dc)', suggest: '(2 dc, ch 2, 2 dc)', delta: 1 });
    }
    expect(f.final).toBe('cup');
  });
  it('one dc more per corner: the corners ruffle, "use (2 dc, ch 2, 2 dc)"', () => {
    const f = analyze(dcSquare(8, () => [3, 2]));
    const last = f.rounds[f.rounds.length - 1];
    expect(last.class).toBe('ruffle');
    expect(last.message).toMatch(/^Rnd 8: corners are about \d+ stitches over — the corners will ruffle \(\+\d+%\); use \(2 dc, ch 2, 2 dc\) in each corner \(now \(3 dc, ch 2, 2 dc\)\)\.$/);
  });
  it('mitred sc square with 5 sc corners ruffles; with spread increases on the sides the sides wave', () => {
    const f = analyze(scSquare(8, 5));
    expect(f.final).toBe('ruffle');
    expect(f.rounds[7].message).toMatch(/corners .* ruffle.*use 3 sc in each corner \(now 5 sc\)/);
    // an sc square whose round 8 puts its extra stitches on the sides, not in the corners
    const base = scSquare(7, 3);
    expect(base.split('\n')[6]).toBe('Rnd 7: ch 1, *sc in next 6 sts, 3 sc in next st, sc in next 5 sts* x4, join. (56)');
    const w = analyze(`${base}\nRnd 8: ch 1, *2 sc in next st, sc in next 2 sts, 2 sc in next st, sc in next 3 sts, 3 sc in next st, sc in next 2 sts, 2 sc in next st, sc in next 2 sts, 2 sc in next st* x4, join. (80)`);
    const r8 = w.rounds[7];
    expect(r8.class).toBe('ruffle');
    expect(r8.polygon!.sideIncrease).toBe(4);
    expect(r8.message).toBe('Rnd 8: the sides will wave — about 4 stitches per side over flat (+31%); work one stitch in each stitch along the sides and keep the increases in the corners.');
  });
});

describe('borders round rows: edge fit per side, corner rule per corner', () => {
  const rect = (W: number, N: number) => `Foundation: ch ${W + 3}.\nRow 1: dc in 4th ch from hook, dc in each ch across. (${W})\nRows 2-${N}: ch 3 (counts as dc), dc in each st across. (${W})`;
  const edge = (perRowEnd: number) => `Rnd 1: ch 1, 3 sc in corner, sc in each st across to corner, 3 sc in corner, ${perRowEnd} sc in each row end across to corner, 3 sc in corner, sc in each ch across to corner, 3 sc in corner, ${perRowEnd} sc in each row end across, join.`;
  it('a correct border is flat on every side and corner; rows n/a', () => {
    const f = analyze(`${rect(12, 8)}\n${edge(2)}\nRnd 2: ch 1, *sc in each st across to corner, 3 sc in corner* x4, sc in each st across, join.\nRnd 3: ch 3 (does not count as st), *dc in each st across to corner, (2 dc, ch 2, 2 dc) in corner* x4, dc in each st across, join, fasten off.`);
    expect(f.applicable).toBe(true);
    const border = f.rounds.filter((r) => r.shape === 'border');
    expect(border.map((r) => r.label)).toEqual(['Rnd 1', 'Rnd 2', 'Rnd 3']);
    for (const r of border) expect(r.class, r.message).toBe('flat');
    expect(f.rounds.filter((r) => r.shape === 'rows').every((r) => r.class === 'n/a')).toBe(true);
    const r1 = border[0].border!;
    expect(r1.edge).toBe(true);
    expect(r1.sides.map((s) => [s.side, s.class])).toEqual([['Top edge', 'ok'], ['First side (row ends)', 'ok'], ['Bottom (foundation chain)', 'ok'], ['Second side (row ends)', 'ok']]);
    expect(r1.sides[1].rule).toBe('2 sc per row end');
    expect(r1.corners).toHaveLength(4);
    expect(border[2].border!.corner?.now).toBe('(2 dc, ch 2, 2 dc)');
    expect(border[0].rho).toBe(0); // no circle radius for a border round
  });
  it('3 sc per dc row end: the sides wave, and the message says what fits', () => {
    const f = analyze(`${rect(12, 8)}\n${edge(3)}`);
    const r1 = f.rounds[f.rounds.length - 1];
    expect(r1.class).toBe('ruffle');
    const sides = r1.border!.sides;
    expect(sides.filter((s) => s.class === 'wavy').map((s) => s.side)).toEqual(['First side (row ends)', 'Second side (row ends)']);
    expect(sides[0].class).toBe('ok');
    expect(r1.message).toMatch(/First side \(row ends\): 3 sc per row end gives 24 sts over [\d.]+ cm — about \d+ too many, the edge will wave; use 2 sc per row end\./);
  });
  it('missing corner increases: the corners cup, "use 3 sc in each corner"', () => {
    const f = analyze(`${rect(12, 8)}\n${edge(2)}\nRnd 2: ch 1, sc in each st around, join.\nRnd 3: ch 1, sc in each st around, join.`);
    const [r2, r3] = f.rounds.slice(-2);
    for (const r of [r2, r3]) {
      expect(r.class).toBe('cup');
      expect(r.message).toMatch(new RegExp(`^${r.label}: corners will cup — about [\\d.]+ stitches per corner short of flat; use 3 sc in each corner \\(now sc\\)\\.$`));
    }
    expect(r3.border!.perCorner).toBeLessThan(r2.border!.perCorner); // accumulated
  });
  it('turned border rounds are judged the same', () => {
    const t = `Foundation: ch 5.\nRow 1: sc in 2nd ch from hook, sc in each ch across. (4)\nRow 2: ch 1, sc in each st across. (4)\n${edge(1).replace(/1 sc in each/g, 'sc in each')}\nRnd 2: ch 1, turn, *sc in each st across to corner, 3 sc in corner* x4, sc in each st across, join.\nRnd 3: ch 1, turn, *sc in each st across to corner, 3 sc in corner* x4, sc in each st across, join.`;
    const f = analyze(t);
    for (const r of f.rounds.filter((x) => x.shape === 'border')) expect(r.class, r.message).toBe('flat');
  });
  it('blanket studio rectangles with a border: every border round flat (ruffle edging excepted)', () => {
    for (const pattern of ['sc', 'dc', 'moss', 'granny', 'shell', 'bobble', 'mesh']) {
      for (const layers of [['sc', 'sc'], ['sc', 'hdc', 'sc'], ['granny', 'granny', 'sc'], ['mesh', 'sc', 'shell']]) {
        const d = designBlanket(spec({ construction: 'rect', size: { widthCm: 30, heightCm: 30 }, body: { pattern }, border: { enabled: true, rowEnds: 'auto', edgeCorner: 'sc3', edgeColor: 'E', layers: layers.map((k) => ({ kind: k as never, color: 'A' })) } }));
        const p = d.pattern ?? d.swatch!;
        const f = analyzeFlatness(p.graph, d.params);
        const border = f.rounds.filter((r) => r.shape === 'border');
        expect(border.length, `${pattern} ${layers}`).toBeGreaterThan(1);
        for (const r of border) expect(r.class, `${pattern} ${layers}: ${r.message}`).toBe('flat');
      }
    }
  });
});
