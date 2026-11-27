// Rows, borders and polygons in the sim (lab/SPEC_NOTES.md N8–N10, P9, "Per-region shape"):
// row pieces come out as flat rectangles of the right size; a border's per-side verdict agrees with
// the blanket studio's edge-fit check on a sweep of stitches per row end; missing / extra corner
// increases cup / ruffle the corners; polygons from the centre get the polygon reference while no
// fixture, snowflake or doily does; the app agrees with the lab on spec/fixtures/extra/blanket_border.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pattern } from '../graph';
import { compilePattern } from '../notation';
import { paramsFor, simConfig, stitchParam } from '../params';
import { DEFAULT_SPEC, designBlanket, edgeFit, ROUND_STYLES, STITCH_PATTERNS } from '../blanket';
import { buildNetwork, networkEnergy, networkMetric, simulate } from '.';
import { regionShape } from './regions';
import { detectPolygon } from '../flatness/corners';
import { outlinePins } from './outline';

const spec = fileURLToPath(new URL('../../../../spec/', import.meta.url));
const corpus = fileURLToPath(new URL('../../../../data/corpus/', import.meta.url));
const FAST = { gtolRound: 1e-4, gtolFinal: 1e-5 };

const compile = (text: string): Pattern => {
  const r = compilePattern(text);
  if (!r.pattern) throw new Error(r.diagnostics.map((d) => d.message).join('; '));
  return r.pattern;
};

/** k_i sc in the i-th row end, Bresenham over n row ends (core/blanket spreadRowEnds) */
const spread = (n: number, num: number, den: number) => Array.from({ length: n }, (_, i) => Math.floor(((i + 1) * num) / den) - Math.floor((i * num) / den));
const rowEnd = (k: number) => (k === 0 ? 'sk next row end' : k === 1 ? 'sc in next row end' : `${k} sc in next row end`);

/** W × N rectangle of dc or sc rows with an sc edge round (and more sc rounds), num/den sc per row end, `corner` sc per corner. */
function bordered(o: { st: 'dc' | 'sc'; W: number; N: number; num: number; den: number; corner?: number; rounds?: number }): string {
  const { st, W, N } = o;
  const c = (o.corner ?? 3) === 1 ? 'sc in corner' : `${o.corner ?? 3} sc in corner`;
  const L = ['title: border sweep', 'params: worsted-4_5.0mm'];
  if (st === 'dc') L.push(`Foundation: ch ${W + 3}.`, `Row 1: dc in 4th ch from hook, dc in each ch across. (${W})`, `Rows 2-${N}: ch 3 (counts as dc), dc in each st across. (${W})`);
  else L.push(`Foundation: ch ${W + 1}.`, `Row 1: sc in 2nd ch from hook, sc in each ch across. (${W})`, `Rows 2-${N}: ch 1, sc in each st across. (${W})`);
  const side = spread(N, o.num, o.den);
  L.push(`Rnd 1: ch 1, ${c}, sc in each st across to corner, ${c}, ${side.map(rowEnd).join(', ')}, ${c}, sc in each ch across to corner, ${c}, ${side.slice().reverse().map(rowEnd).join(', ')}, join.`);
  for (let r = 2; r <= (o.rounds ?? 1); r++) L.push(`Rnd ${r}: ch 1, *sc in each st across to corner, ${c}* x4, sc in each st across, join.`);
  return L.join('\n') + '\n';
}

describe('rows (N8): flat rectangles of the right size', () => {
  const P = paramsFor(compile('title: t\nRnd 1: mr, 6 sc in ring. (6)\n'));
  const body = (id: string) => {
    const pat = STITCH_PATTERNS.find((p) => p.id === id)!;
    const d = designBlanket({ ...DEFAULT_SPEC, body: { pattern: id }, border: { ...DEFAULT_SPEC.border, enabled: false, layers: [] }, stripes: { kind: 'even', rows: 2, colors: ['A'] } });
    return { pat, d };
  };
  for (const id of ['sc', 'dc', 'moss', 'granny', 'ripple']) {
    it(`${id}: flat, width × height within a few % of the reference, turning chains at the edges`, () => {
      const { d } = body(id);
      // (core/blanket writes "Fasten off." on a row-range line when there is no border, which the
      // compiler rejects — reported; compile the swatch rows without it)
      const p = d.swatch ?? compile(d.swatchText.replace(/ Fasten off\./, ''));
      expect(p.graph.rounds.some((r) => r.kind === 'row')).toBe(true);
      const net = buildNetwork(p, P);
      const o = net.outline!;
      expect(o, id).not.toBeNull();
      // the reference layout is exactly realisable flat
      const Xr = new Float64Array(3 * net.nParticles).fill(NaN);
      for (let i = 0; i < net.nNodes; i++) if (o.has[i]) { Xr[3 * i] = o.qx[i]; Xr[3 * i + 1] = o.qy[i]; Xr[3 * i + 2] = 0; }
      expect(networkEnergy(net, Xr)).toBeLessThan(1e-6);
      const r = simulate(p, P, { network: net, ...FAST });
      const m = networkMetric(net, r.positions);
      expect(m.class, id).toBe('flat');
      expect(m.axisKind).toBe('pca');
      // extent in the plane vs the reference rectangle (stitch centres)
      let xl = Infinity, xr = -Infinity, yl = Infinity, yr = -Infinity;
      for (let i = 0; i < net.nNodes; i++) if (o.has[i] && o.c[i] > 0) { xl = Math.min(xl, o.qx[i]); xr = Math.max(xr, o.qx[i]); yl = Math.min(yl, o.qy[i]); yr = Math.max(yr, o.qy[i]); }
      const rep = regionShape(net, r.positions)!;
      expect(rep.body.class).toBe('flat');
      // relaxed: distances between the four extreme reference nodes are kept within 5 %
      const ids = [...Array(net.nNodes).keys()].filter((i) => o.has[i] && o.c[i] > 0);
      const pick = (f: (i: number) => number) => ids.reduce((a, b) => (f(b) < f(a) ? b : a));
      const corners = [pick((i) => o.qx[i] + o.qy[i]), pick((i) => -o.qx[i] + o.qy[i]), pick((i) => o.qx[i] - o.qy[i]), pick((i) => -o.qx[i] - o.qy[i])];
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
        const [i, j] = [corners[a], corners[b]];
        const ref = Math.hypot(o.qx[i] - o.qx[j], o.qy[i] - o.qy[j]);
        const got = Math.hypot(r.positions[3 * i] - r.positions[3 * j], r.positions[3 * i + 1] - r.positions[3 * j + 1], r.positions[3 * i + 2] - r.positions[3 * j + 2]);
        expect(Math.abs(got / ref - 1), `${id} ${a}-${b}`).toBeLessThan(0.05);
      }
      expect(xr - xl).toBeGreaterThan(0);
      expect(yr - yl).toBeGreaterThan(0);
    });
  }
  it('a dc rectangle is n·w wide and rows·h tall, its foundation stretched to the first row', () => {
    const p = compile('title: r\nparams: worsted-4_5.0mm\nFoundation: ch 12.\nRow 1: dc in 4th ch from hook, dc in each ch across. (9)\nRows 2-6: ch 3 (counts as dc), dc in each st across. (9)\n');
    const Pw = paramsFor(p);
    const net = buildNetwork(p, Pw);
    const o = net.outline!;
    const w = stitchParam(Pw, 'dc').width, h = stitchParam(Pw, 'dc').height;
    expect(o.span.length).toBe(9);
    expect(o.c[o.span[0]]).toBeCloseTo(w, 9);
    let xl = Infinity, xr = -Infinity, yr = -Infinity;
    for (let i = 0; i < net.nNodes; i++) if (o.has[i] && o.c[i] > 0) { xl = Math.min(xl, o.qx[i] - o.c[i] / 2); xr = Math.max(xr, o.qx[i] + o.c[i] / 2); yr = Math.max(yr, o.qy[i]); }
    expect(xr - xl).toBeCloseTo(9 * w, 6);
    expect(yr).toBeCloseTo(6 * h, 6);
    // before N8 the foundation chains had no course length: Row 1's wales fanned out to 28.8 mm
    for (let s = 0; s < net.m; s++) if (net.kind[s] === 1 && net.J[s] < 21) expect(net.L[s]).toBeCloseTo(h, 6);
  });
});

describe('borders (N9): per-region verdict agrees with the edge-fit check', () => {
  // dc rows: 12.35 mm per row end; sc rows: 6.175 mm; sc 6.5 mm wide (worsted)
  const cases: { st: 'dc' | 'sc'; num: number; den: number }[] = [
    { st: 'dc', num: 1, den: 1 }, { st: 'dc', num: 3, den: 2 }, { st: 'dc', num: 2, den: 1 }, { st: 'dc', num: 5, den: 2 }, { st: 'dc', num: 3, den: 1 },
    { st: 'sc', num: 3, den: 4 }, { st: 'sc', num: 9, den: 10 }, { st: 'sc', num: 1, den: 1 }, { st: 'sc', num: 3, den: 2 },
  ];
  for (const c of cases) {
    it(`${c.st} rows, ${c.num}/${c.den} sc per row end: sim waves ⇔ edge-fit too many, puckers ⇔ too few`, () => {
      const N = 8, W = 10;
      const p = compile(bordered({ st: c.st, W, N, num: c.num, den: c.den }));
      const P = paramsFor(p);
      const rowH = stitchParam(P, c.st).height, w = stitchParam(P, 'sc').width;
      const placed = spread(N, c.num, c.den).reduce((a, b) => a + b, 0);
      const fit = edgeFit('Left side', placed, N * rowH, w, `${c.num}/${c.den}`);
      const r = simulate(p, P, FAST);
      const rep = regionShape(r.network, r.positions)!;
      for (const side of [rep.sides[1], rep.sides[3]]) {
        expect(side.class === 'waves', `${side.label} ${JSON.stringify(side)} vs ${fit.class}`).toBe(fit.class === 'wavy');
        expect(side.class === 'puckers', `${side.label} ${JSON.stringify(side)} vs ${fit.class}`).toBe(fit.class === 'puckered');
      }
      // top and bottom: 1 sc per stitch / chain — fit
      expect(rep.sides[0].class).toBe('flat');
      expect(rep.sides[2].class).toBe('flat');
    }, 30000);
  }
  it('a fitted 3-round border lies flat with flat corners; missing corner increases cup them, extra ones ruffle them', () => {
    const run = (corner: number, rounds = 1) => {
      const p = compile(bordered({ st: 'dc', W: 10, N: 6, num: 2, den: 1, corner, rounds }));
      const r = simulate(p, paramsFor(p), FAST);
      return regionShape(r.network, r.positions)!;
    };
    const ok = run(3, 3);
    expect(ok.overall).toBe('flat');
    const cup = run(1);
    expect(cup.corners.filter((c) => c.class === 'cup').length).toBeGreaterThanOrEqual(3);
    expect(cup.corners.filter((c) => c.perCorner < -1).length).toBeGreaterThanOrEqual(3);
    const ruf = run(7);
    expect(ruf.corners.every((c) => c.class === 'ruffle')).toBe(true);
  }, 30000);
});

describe('the new extra reference (spec/fixtures/extra/blanket_border) agrees with the lab', () => {
  it('class, A, W, Rg within the fixture tolerances; every region flat in both', () => {
    const pat = JSON.parse(readFileSync(spec + 'fixtures/extra/blanket_border.graph.json', 'utf8')) as Pattern;
    const lab = JSON.parse(readFileSync(spec + 'fixtures/extra/blanket_border.lab.json', 'utf8'));
    const r = simulate(pat, paramsFor(pat));
    expect(r.converged).toBe(true);
    const m = networkMetric(r.network, r.positions);
    expect(m.class).toBe('flat');
    expect(m.class).toBe(lab.class);
    expect(Math.abs(m.Rg - lab.Rg)).toBeLessThanOrEqual(simConfig.agree_rg_rel * lab.Rg);
    expect(Math.abs(m.A - lab.A)).toBeLessThanOrEqual(simConfig.agree_abs);
    expect(Math.abs(m.W - lab.W)).toBeLessThanOrEqual(simConfig.agree_abs);
    const rep = regionShape(r.network, r.positions)!;
    expect(rep.overall).toBe(lab.regions.overall);
    expect(rep.body.class).toBe(lab.regions.body.class);
    expect(rep.sides.map((s) => s.class)).toEqual(lab.regions.sides.map((s: { class: string }) => s.class));
    expect(rep.corners.map((s) => s.class)).toEqual(lab.regions.corners.map((s: { class: string }) => s.class));
    rep.sides.forEach((s, q) => expect(Math.abs(s.excess - lab.regions.sides[q].excess)).toBeLessThan(0.02));
    // blocked: the outer round pinned to its reference rectangle
    const pins = outlinePins(r.network)!;
    expect(pins.length).toBe(72);
  }, 60000);
});

describe('polygons from the centre (N10)', () => {
  const P = paramsFor(compile('title: t\nRnd 1: mr, 6 sc in ring. (6)\n'));
  it('no canonical fixture or snowflake has an outline; in the corpus only what the shared corner detector calls a polygon', () => {
    const dirs = [spec + 'fixtures/', spec + 'fixtures/extra/', corpus];
    const polys: string[] = [];
    for (const d of dirs) {
      for (const f of readdirSync(d).filter((x) => x.endsWith('.cro'))) {
        const p = compile(readFileSync(d + f, 'utf8'));
        const o = buildNetwork(p, paramsFor(p)).outline;
        if (f === 'blanket_border.cro') { expect(o?.K, f).toBe(4); continue; }
        if (d === corpus && detectPolygon(p.graph)) { expect(o?.K, f).toBe(detectPolygon(p.graph)!.n); polys.push(f); continue; }
        expect(o, f).toBeNull();
      }
    }
    expect(polys).toEqual(['granny-square-motif.cro', 'hexagon-motif-6.cro']);
  });
  // (the generated mitred square ends in a 2-sc-corner round, which core/flatness's detector does not call a polygon)
  const shapes: Record<string, number> = { 'granny-square': 4, 'solid-square': 4, hexagon: 6, octagon: 8 };
  for (const st of ROUND_STYLES.filter((s) => s.id in shapes)) {
    it(`${st.id}: detected as a ${shapes[st.id]}-gon; its reference is (nearly) frustration-free`, () => {
      const d = designBlanket({ ...DEFAULT_SPEC, construction: 'round', size: { widthCm: 22, heightCm: 22 }, round: { style: st.id, textures: st.defaultTextures, corner: 'auto' } });
      const p = d.pattern ?? d.swatch!;
      const net = buildNetwork(p, P);
      const o = net.outline!;
      expect(o.K).toBe(shapes[st.id]);
      expect(o.courses.size).toBeGreaterThanOrEqual(3);
      // every outline round's sides and corners fit their sections within the compliance band
      for (const c of o.courses.values()) for (const sg of c.segments) if (sg.region === 2 && sg.own > 0) expect(Math.abs(sg.own / sg.len - 1), `${st.id} rnd ${c.round + 1}`).toBeLessThan(0.15);
    });
  }
  it('a granny square and a solid square lie flat (they cupped / ruffled on the circle reference)', () => {
    for (const style of ['granny-square', 'solid-square'] as const) {
      const st = ROUND_STYLES.find((s) => s.id === style)!;
      const d = designBlanket({ ...DEFAULT_SPEC, construction: 'round', size: { widthCm: 22, heightCm: 22 }, round: { style, textures: st.defaultTextures, corner: 'auto' } });
      const p = d.pattern!;
      const r = simulate(p, P, FAST);
      expect(networkMetric(r.network, r.positions).class, style).toBe('flat');
    }
  }, 60000);
  it('regionShape is null for pieces without an outline (radial pieces keep physics.md §5)', () => {
    const pat = JSON.parse(readFileSync(spec + 'fixtures/flat_sc_circle.graph.json', 'utf8')) as Pattern;
    const r = simulate(pat, paramsFor(pat), FAST);
    expect(regionShape(r.network, r.positions)).toBeNull();
  });
});
