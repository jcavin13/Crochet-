// Notation v0.2 extension (notation.md 3.9): border rounds around rows (row ends, the foundation
// chain's unused loops, corners), "working along the other side of the chain", odd/even row ranges.
import { describe, expect, it } from 'vitest';
import { compilePattern, parse, print } from '../notation/index';
import { compile, describeNode, stripSrc, validateGraph, type Graph, type Pattern } from './index';
import { borderLists } from './targets';
import { analyzeFlatness } from '../flatness';
import { analyzeSymmetry } from '../symmetry';
import { paramsFor } from '../params';
import { layoutChart } from '../chart';
import { buildNetwork } from '../sim';
import { buildSteps } from '../counter';

const ok = (text: string): Pattern => {
  const r = compilePattern(text);
  const bad = r.diagnostics.filter((d) => d.severity !== 'info');
  expect(bad, bad.map((d) => d.message).join('\n')).toEqual([]);
  expect(r.pattern).toBeDefined();
  return r.pattern!;
};
const errs = (text: string) => compilePattern(text).diagnostics.filter((d) => d.severity !== 'info');

/** A dc rectangle W × N (counting ch-3 turning chains). */
const rect = (W: number, N: number) => `Foundation: ch ${W + 3}.
Row 1: dc in 4th ch from hook, dc in each ch across. (${W})
Rows 2-${N}: ch 3 (counts as dc), dc in each st across. (${W})`;

const sideOf = (g: Graph, r: number) => {
  const R = g.rounds[r];
  const out = { side: 0, base: 0, top: 0, corner: 0 };
  const list = borderLists(g).get(r)!;
  const cornerIds = new Set(list.filter((e) => e.corner).map((e) => JSON.stringify(e.kind === 'space' ? { space: e.space } : e.kind === 'rowEnd' ? { node: e.node, part: 'side' } : e.kind === 'base' ? { node: e.node, part: 'base' } : { node: e.node })));
  for (let id = R.first; id <= R.last; id++) {
    const n = g.nodes[id];
    if (n.type === 'slst' || !n.into.length) continue;
    const a = n.into[0];
    if (cornerIds.has(JSON.stringify(a))) out.corner++;
    else if ('node' in a && a.part === 'side') out.side++;
    else if ('node' in a && a.part === 'base') out.base++;
    else out.top++;
  }
  return out;
};

describe('border rounds after rows (3.9)', () => {
  it('a dc rectangle + 3 border rounds compiles with exact per-side counts', () => {
    const W = 12, N = 8;
    const p = ok(`${rect(W, N)}
Rnd 1: ch 1, 3 sc in corner, sc in each st across to corner, 3 sc in corner, 2 sc in each row end across to corner, 3 sc in corner, sc in each ch across to corner, 3 sc in corner, 2 sc in each row end across, join. (${2 * (W - 2) + 4 * N + 12})
Rnd 2: ch 1, *sc in each st across to corner, 3 sc in corner* x4, sc in each st across, join. (${2 * (W - 2) + 4 * N + 12 + 8})
Rnd 3: ch 3 (does not count as st), *dc in each st across to corner, (2 dc, ch 2, 2 dc) in corner* x4, dc in each st across, join, fasten off. (${2 * (W - 2) + 4 * N + 20 + 12} sts, 4 ch-2 sps)`);
    const g = p.graph;
    expect(validateGraph(g).filter((i) => i.severity === 'error')).toEqual([]);
    const r1 = g.rounds.findIndex((r) => r.label === 'Rnd 1');
    // Rnd 1: 2 sc into each of 2N row ends, one sc per foundation chain between the corners, W-2 top stitches, 4 corners × 3
    expect(sideOf(g, r1)).toEqual({ side: 4 * N, base: W - 2, top: W - 2, corner: 12 });
    expect(g.rounds[r1].turned).toBe(true);
    // the next rounds find a corner in each corner group
    expect(borderLists(g).get(r1 + 1)!.filter((e) => e.corner)).toHaveLength(4);
    expect(borderLists(g).get(r1 + 2)!.filter((e) => e.corner)).toHaveLength(4);
    // Rnd 3's corners are dc groups round a ch-2 space; Rnd 4 would see the spaces as corners
    expect(sideOf(g, r1 + 2).corner).toBe(16);
    // describeNode speaks crochet
    const R1 = g.rounds[r1];
    const texts = g.nodes.slice(R1.first, R1.last + 1).map((n) => describeNode(g, n.id));
    expect(texts).toContain('sc in corner (2 of 3)');
    expect(texts.some((t) => /^sc in row end of Row \d+$/.test(t))).toBe(true);
    expect(texts).toContain('sc in unused loop of foundation ch');
  });

  it.each([
    // [phrase for the first side, row ends worked, error code or '']
    ['sc in each row end across to corner', 'ok'],
    ['2 sc in each row end across to corner', 'ok'],
    ['*2 sc in next row end, sc in next row end* across to corner', 'ok'],
    ['*2 sc in next row end, sc in next row end* x4', 'ok'],
    ['sc in next 8 row ends', 'ok'],
    ['2 sc in each of next 8 row ends', 'ok'],
    ['sc in each end of row across', 'ok'],
    ['sc in each row-end across', 'ok'],
    ['*2 sc in next row end, sc in next row end* x3, 2 sc in next row end, sc in next row end', 'ok'],
    ['sc in next 7 row ends', 'W_UNWORKED'],
    ['sc in next 9 row ends', 'E_NO_TARGET'],
    ['sc in next st', 'E_NO_TARGET'],
    ['*2 sc in next row end, sc in next row end, sc in next row end* across', 'E_REPEAT_UNEVEN'],
  ])('first side "%s" → %s', (phrase, want) => {
    const t = `${rect(6, 8)}
Rnd 1: ch 1, 3 sc in corner, sc in each st across to corner, 3 sc in corner, ${phrase}, 3 sc in corner, sc in each ch across to corner, 3 sc in corner, sc in each row end across, join.`;
    const ds = errs(t);
    if (want === 'ok') expect(ds.map((d) => d.message)).toEqual([]);
    else expect(ds.map((d) => d.code)).toContain(want);
  });

  it.each([
    ['"no corner left"', 'Rnd 1: ch 1, *3 sc in corner, sc in each st across to corner* x5, join.', 'E_NO_TARGET', /no corner is left/],
    ['a side worked short before the corner', 'Rnd 1: ch 1, 3 sc in corner, sc in next 3 sts, 3 sc in corner, sc in each row end across to corner, 3 sc in corner, sc in each ch across to corner, 3 sc in corner, sc in each row end across, join.', 'W_UNWORKED', /1 stitch of Row 6 is passed over without being worked \(on the top edge\)/],
    ['a row-end side crossed without the corner', 'Rnd 1: ch 1, 3 sc in corner, sc in each st across to corner, sc in each row end across, join.', 'E_NO_TARGET', /work the corner first/],
    ['"to corner" in an ordinary row', 'Row 7: ch 3 (counts as dc), dc in each st across to corner. (6)', 'E_NO_TARGET', /has no corners/],
    ['border count mismatch', 'Rnd 1: ch 1, 3 sc in corner, sc in each st across to corner, 3 sc in corner, sc in each row end across to corner, 3 sc in corner, sc in each ch across to corner, 3 sc in corner, sc in each row end across, join. (40)', 'E_COUNT_MISMATCH', /pattern says \(40\) but the round makes \d+ stitches/],
  ])('diagnostic: %s', (_name, line, code, msg) => {
    const ds = errs(`${rect(6, 6)}\n${line}`);
    const d = ds.find((x) => x.code === code);
    expect(d, ds.map((x) => `${x.code} ${x.message}`).join('\n')).toBeDefined();
    expect(d!.message).toMatch(msg);
    expect(d!.line).toBe(4);
  });

  it('an sc piece of odd rows starts the bottom at the right end', () => {
    const p = ok(`Foundation: ch 6.
Row 1: sc in 2nd ch from hook, sc in each ch across. (5)
Rows 2-3: ch 1, sc in each st across. (5)
Rnd 1: ch 1, 3 sc in corner, sc in each st across to corner, 3 sc in corner, sc in each row end across to corner, 3 sc in corner, sc in each ch across to corner, 3 sc in corner, sc in each row end across, join. (24)`);
    const g = p.graph;
    const R = g.rounds[g.rounds.length - 1];
    // after 3 rows the first side comes down at the hook end of the foundation chain (Row 1's start)
    const firstBase = g.nodes.slice(R.first, R.last + 1).find((n) => n.into.some((a) => 'part' in a && a.part === 'base'))!;
    expect((firstBase.into[0] as { node: number }).node).toBe(4);
  });

  it('a filet top (spaces) is worked into stitch by stitch and space by space', () => {
    ok(`Foundation: ch 8.
Row 1: dc in 4th ch from hook, *ch 1, sk next ch, dc in next ch* x2. (3 dc, 2 ch-1 sps)
Row 2: ch 4 (counts as dc, ch 1), dc in next st, ch 1, dc in next st. (3 dc, 2 ch-1 sps)
Rnd 1: ch 1, 3 sc in corner, sc in next ch-1 sp, sc in next st, sc in next ch-1 sp, 3 sc in corner, 2 sc in each row end across to corner, 3 sc in corner, sc in each ch across to corner, 3 sc in corner, 2 sc in each row end across, join. (26)`);
  });

  it('"turn" at the start of a border round is redundant', () => {
    const r = compilePattern(`${rect(6, 2)}\nRnd 1: ch 1, turn, 3 sc in corner, sc in each st across to corner, 3 sc in corner, 2 sc in each row end across to corner, 3 sc in corner, sc in each ch across to corner, 3 sc in corner, 2 sc in each row end across, join. (28)`);
    expect(r.pattern).toBeDefined();
    expect(r.diagnostics.map((d) => d.code)).toEqual(['I_REDUNDANT_TURN']);
  });

  it('validateGraph rejects a row end of a chain and unused loops of a stitch', () => {
    const g = ok(`${rect(4, 2)}\nRnd 1: ch 1, 3 sc in corner, sc in each st across to corner, 3 sc in corner, 2 sc in each row end across to corner, 3 sc in corner, sc in each ch across to corner, 3 sc in corner, 2 sc in each row end across, join.`).graph;
    const bad: Graph = JSON.parse(JSON.stringify(g));
    const sideNode = bad.nodes.find((n) => n.into.some((a) => 'part' in a && a.part === 'side'))!;
    (sideNode.into[0] as { node: number }).node = 0; // a foundation chain
    const baseNode = bad.nodes.find((n) => n.into.some((a) => 'part' in a && a.part === 'base'))!;
    (baseNode.into[0] as { node: number }).node = bad.rounds[1].first; // a dc
    const codes = validateGraph(bad).map((i) => i.code);
    expect(codes.filter((c) => c === 'G_ANCHOR_PART')).toHaveLength(2);
    // and the real graph gives no G_ANCHOR_ROUND warnings for row ends many rows back
    expect(validateGraph(g)).toEqual([]);
  });
});

describe('working along the other side of the chain (3.9)', () => {
  it('an oval / rectangle started round a foundation chain', () => {
    const p = ok(`Foundation: ch 11.
Rnd 1: sc in 2nd ch from hook, sc in next 8 chs, 5 sc in next ch, working along the other side of the chain, sc in next 8 chs, 4 sc in next ch, join. (26)
Rnd 2: ch 1, sc in each st around, join. (26)`);
    const g = p.graph;
    const R1 = g.rounds[1];
    const base = g.nodes.slice(R1.first, R1.last + 1).filter((n) => n.into.some((a) => 'part' in a && a.part === 'base'));
    expect(base).toHaveLength(12); // 8 + 4 on the other side
    // the other side runs back from the far end towards the hook, never into the turning chain
    expect(base.map((n) => (n.into[0] as { node: number }).node)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 9]);
  });

  it('needs a chain worked from the hook first', () => {
    const ds = errs('Rnd 1: mr, 6 sc in ring, working along the other side of the chain, join.');
    expect(ds[0].code).toBe('E_NO_CHAIN');
  });
});

describe('odd/even row ranges', () => {
  const moss = `Foundation: ch 8.
Row 1: sc in 2nd ch from hook, *ch 1, sk next ch, sc in next ch* x3. (4 sc, 3 ch-1 sps)
Rows 2-6 (even): ch 1, sc in next st, sc in next ch-1 sp, *ch 1, sk next st, sc in next ch-1 sp* x2, sc in next st. (5 sc, 2 ch-1 sps)
Rows 3-7 (odd): ch 1, sc in next st, *ch 1, sk next st, sc in next ch-1 sp* x2, ch 1, sk next st, sc in next st. (4 sc, 3 ch-1 sps)`;
  it('interleave and compile to the same graph as the rows written out', () => {
    const a = ok(moss).graph;
    const lines = moss.split('\n');
    const even = lines[2].replace(/^Rows 2-6 \(even\): /, '');
    const odd = lines[3].replace(/^Rows 3-7 \(odd\): /, '');
    const explicit = [lines[0], lines[1], ...[2, 3, 4, 5, 6, 7].map((n) => `Row ${n}: ${n % 2 ? odd : even}`)].join('\n');
    expect(stripSrc({ graph: a } as unknown as Pattern)).toEqual(stripSrc({ graph: ok(explicit).graph } as unknown as Pattern));
    expect(a.rounds.map((r) => r.label)).toEqual(['Foundation', 'Row 1', 'Row 2', 'Row 3', 'Row 4', 'Row 5', 'Row 6', 'Row 7']);
  });
  it('report gaps and wrong parity', () => {
    expect(errs(moss.replace('Rows 3-7 (odd)', 'Rows 3-3 (odd)')).map((d) => d.code)).toContain('E_ROUND_NUMBER');
    expect(errs(moss.replace('Rows 3-7 (odd)', 'Rows 4-8 (odd)')).some((d) => /odd numbers/.test(d.message))).toBe(true);
  });
});

describe('printer round-trip (US and UK)', () => {
  const SAMPLES = [
    `title: Border\n${rect(6, 5)}\nRnd 1: ch 1, 3 sc in corner, sc in each st across to corner, 3 sc in corner, *2 sc in next row end, sc in next row end* x2, 2 sc in next row end, 3 sc in corner, sc in each ch across to corner, 3 sc in corner, 2 sc in each row end across, join. (38)\nRnd 2: ch 3 (does not count as st), *dc in each st across to corner, (2 dc, ch 2, 2 dc) in corner* x4, dc in each st across, join. (50 sts, 4 ch-2 sps)\nRnd 3: ch 1, *sc in each st across to corner, 3 sc in next corner* x4, sc in each st across, join. (62)`,
    'Foundation: ch 11.\nRnd 1: sc in 2nd ch from hook, sc in next 8 chs, 5 sc in next ch, working along the other side of the chain, sc in next 8 chs, 4 sc in next ch, join. (26)',
  ];
  it.each(SAMPLES.map((s, i) => [i, s] as const))('sample %i', (_i, text) => {
    const g = stripSrc(ok(text)).graph;
    for (const terms of ['US', 'UK'] as const) {
      const out = print(parse(text).ast, { terms });
      const again = parse(out);
      expect(again.diagnostics, out).toEqual([]);
      const c = compile(again.ast);
      expect(stripSrc(c.pattern!).graph, out).toEqual(g);
      expect(print(again.ast, { terms })).toBe(out);
    }
    expect(print(parse(text).ast, { terms: 'UK' })).toMatch(text.includes('row end') ? /dc in each row end across/ : /working along the other side of the chain/);
  });
});

describe('other modules on a rows + border piece (must not crash)', () => {
  const p = ok(`${rect(8, 6)}\nRnd 1: ch 1, 3 sc in corner, sc in each st across to corner, 3 sc in corner, 2 sc in each row end across to corner, 3 sc in corner, sc in each ch across to corner, 3 sc in corner, 2 sc in each row end across, join. (48)\nRnd 2: ch 1, *sc in each st across to corner, 3 sc in corner* x4, sc in each st across, join. (56)`);
  const P = paramsFor(p);
  it('flatness: n/a (rows have no centre)', () => {
    const f = analyzeFlatness(p.graph, P);
    expect(f.applicable).toBe(false);
    expect(f.rounds.every((r) => r.class === 'n/a')).toBe(true);
  });
  it('symmetry: not applicable', () => {
    expect(analyzeSymmetry(p.graph).applicable).toBe(false);
  });
  it('chart layout and sim network build', () => {
    const L = layoutChart(p.graph, P);
    expect(L.nodes.length).toBe(p.graph.nodes.length);
    expect(L.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    const net = buildNetwork(p.graph, P);
    expect(net).toBeDefined();
  });
  it('counter steps speak row ends and corners', () => {
    const steps = buildSteps(p, { granularity: 'group' });
    const texts = steps.steps.map((s) => s.text);
    expect(texts.some((t) => /row end/.test(t))).toBe(true);
    expect(texts.some((t) => /in corner/.test(t))).toBe(true);
  });
});
