/**
 * Unit tests for every construct of the grammar (notation.md sections 2–3).
 */
import { describe, expect, it } from 'vitest';
import { compilePattern } from '../notation/index';
import { validateGraph } from './validate';
import type { Diagnostic, Graph, Node } from './types';

const RING6 = 'Rnd 1: mr, 6 sc in ring. (6)\n';

function ok(text: string): Graph {
  const r = compilePattern(text);
  const bad = r.diagnostics.filter((d) => d.severity !== 'info');
  if (bad.length || !r.pattern) throw new Error(`unexpected diagnostics:\n${r.diagnostics.map((d) => `${d.line}:${d.col} ${d.code} ${d.message}`).join('\n')}`);
  const issues = validateGraph(r.pattern.graph).filter((i) => i.severity === 'error');
  if (issues.length) throw new Error(`invalid graph: ${issues.map((i) => i.message).join('; ')}`);
  return r.pattern.graph;
}
function diags(text: string): Diagnostic[] {
  return compilePattern(text).diagnostics;
}
/** nodes of round r */
function R(g: Graph, r: number): Node[] {
  const x = g.rounds[r];
  return x.first < 0 ? [] : g.nodes.slice(x.first, x.last + 1);
}
const types = (ns: Node[]) => ns.map((n) => n.type).join(' ');
const counts = (g: Graph) => g.rounds.map((r) => r.stitchCount);

describe('basic stitches (3.1)', () => {
  it.each([
    ['sc', 'sc'], ['hdc', 'hdc'], ['dc', 'dc'], ['tr', 'tr'], ['trc', 'tr'], ['dtr', 'dtr'],
  ])('%s → %s, one anchor each into the next st', (name, type) => {
    const g = ok(`${RING6}Rnd 2: 6 ${name}. (6)`);
    const ns = R(g, 1);
    expect(ns.map((n) => n.type)).toEqual(Array(6).fill(type));
    expect(ns.map((n) => n.into)).toEqual([0, 1, 2, 3, 4, 5].map((i) => [{ node: i }]));
  });

  it.each(['sl st', 'slst', 'ss', 'sl'])('%s → slst, not counted', (name) => {
    const g = ok(`${RING6}Rnd 2: ${name} in next st, 5 sc. (5)`);
    expect(R(g, 1)[0]).toMatchObject({ type: 'slst', into: [{ node: 0 }] });
    expect(g.rounds[1].stitchCount).toBe(5);
  });

  it('count forms: "5 sc" == "sc 5" == "sc in next 5 sts" == "sc in each of next 5 sts"', () => {
    const forms = ['5 sc', 'sc 5', 'sc in next 5 sts', 'sc in each of next 5 sts', 'sc x5', '5 sc in each of next 5 sts'];
    const results = forms.map((f) => ok(`${RING6}Rnd 2: ${f}, sc. (${f.startsWith('5 sc in each') ? 26 : 6})`));
    for (const g of results.slice(0, 5)) expect(R(g, 1).map((n) => n.into)).toEqual(R(results[0], 1).map((n) => n.into));
    expect(R(results[5], 1).length).toBe(26);
  });

  it('"2 sc in next st" puts both into one place; "3 dc in same st" too', () => {
    const g = ok(`${RING6}Rnd 2: 2 sc in next st, 3 dc in same st, 5 sc. (10)`);
    const ns = R(g, 1);
    expect(ns.slice(0, 5).every((n) => JSON.stringify(n.into) === '[{"node":0}]')).toBe(true);
  });

  it('"N st in each st around"', () => {
    const g = ok(`${RING6}Rnd 2: 2 sc in each st around. (12)`);
    expect(R(g, 1).map((n) => (n.into[0] as { node: number }).node)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe('compound stitches (3.1)', () => {
  it.each([
    ['inc x6', 'sc', 12], ['6 inc', 'sc', 12], ['sc inc x6', 'sc', 12], ['hdc inc x6', 'hdc', 12], ['dc inc x6', 'dc', 12], ['tr inc x6', 'tr', 12],
  ])('%s: pairs into the same st sharing an inc group', (src, type, n) => {
    const g = ok(`${RING6}Rnd 2: ${src}. (${n})`);
    const ns = R(g, 1);
    expect(ns.length).toBe(n);
    expect(ns.every((x) => x.type === type)).toBe(true);
    for (let i = 0; i < n; i += 2) {
      expect(ns[i].into).toEqual(ns[i + 1].into);
      expect(ns[i].group).toEqual({ kind: 'inc', id: ns[i + 1].group!.id });
    }
    expect(new Set(ns.map((x) => x.group!.id)).size).toBe(n / 2);
  });

  it.each(['dec', 'invdec', 'sc2tog'])('%s → one sc node with 2 anchors', (name) => {
    const g = ok(`${RING6}Rnd 2: ${name} x3. (3)`);
    const ns = R(g, 1);
    expect(types(ns)).toBe('sc sc sc');
    expect(ns[0].into).toEqual([{ node: 0 }, { node: 1 }]);
    expect(ns[2].into).toEqual([{ node: 4 }, { node: 5 }]);
  });

  it('dc3tog default legs = next 3 sts; tr2tog; "dc3tog in next st" = 3 legs in one place', () => {
    let g = ok(`${RING6}Rnd 2: dc3tog x2. (2)`);
    expect(R(g, 1).map((n) => [n.type, n.into.length])).toEqual([['dc', 3], ['dc', 3]]);
    g = ok(`${RING6}Rnd 2: tr2tog x3. (3)`);
    expect(R(g, 1)[0]).toMatchObject({ type: 'tr', into: [{ node: 0 }, { node: 1 }] });
    g = ok(`${RING6}Rnd 2: dc3tog in next st, 5 sc. (6)`);
    expect(R(g, 1)[0].into).toEqual([{ node: 0 }, { node: 0 }, { node: 0 }]);
    g = ok(`${RING6}Rnd 2: sc3tog over next 3 sts, sc3tog in next 3 sts. (2)`);
    expect(R(g, 1)[1].into).toEqual([{ node: 3 }, { node: 4 }, { node: 5 }]);
  });

  it.each([
    ['cl', 'dc', 3], ['3-dc cl', 'dc', 3], ['4-dc cl', 'dc', 4], ['3-tr cl', 'tr', 3], ['bobble', 'dc', 5], ['5-dc bobble', 'dc', 5],
  ])('%s → %s with %i legs into one place, tag cluster', (name, type, legs) => {
    const g = ok(`${RING6}Rnd 2: ${name} in each st around. (6 cl)`);
    const n = R(g, 1)[1];
    expect(n.type).toBe(type);
    expect(n.tag).toBe('cluster');
    expect(n.into).toEqual(Array(legs).fill({ node: 1 }));
  });

  it('puff, N-loop puff', () => {
    let g = ok(`${RING6}Rnd 2: puff in each st around. (6 puff)`);
    expect(R(g, 1)[0]).toMatchObject({ type: 'puff', loops: 3, into: [{ node: 0 }] });
    g = ok(`${RING6}Rnd 2: 4-loop puff x6. (6)`);
    expect(R(g, 1)[5]).toMatchObject({ type: 'puff', loops: 4, into: [{ node: 5 }] });
    g = ok(`${RING6}Rnd 2: puff st x6. (6)`);
    expect(R(g, 1).length).toBe(6);
  });

  it.each([['pc', 5], ['popcorn', 5], ['pop', 5], ['4-dc pc', 4], ['6-dc popcorn', 6]])('%s → popcorn legs %i', (name, legs) => {
    const g = ok(`${RING6}Rnd 2: ${name} x6. (6 pc)`);
    expect(R(g, 1)[0]).toMatchObject({ type: 'popcorn', legs, into: [{ node: 0 }] });
  });

  it.each([['picot', 3], ['p', 3], ['ch-4 picot', 4], ['picot 5', 5]])('%s → picot with %i chains, no anchor, not counted', (name, chains) => {
    const g = ok(`${RING6}Rnd 2: *sc, ${name}* x6. (6 sc, 6 picot)`);
    const ns = R(g, 1);
    expect(ns[1]).toMatchObject({ type: 'picot', chains, into: [] });
    expect(g.rounds[1].stitchCount).toBe(6);
  });

  it('shell, N-dc shell', () => {
    let g = ok(`${RING6}Rnd 2: *shell in next st, sk next st* x3. (15)`);
    const ns = R(g, 1);
    expect(ns.slice(0, 5).every((n) => n.type === 'dc' && n.group?.kind === 'shell' && (n.into[0] as { node: number }).node === 0)).toBe(true);
    expect(ns[5].into).toEqual([{ node: 2 }]);
    g = ok(`${RING6}Rnd 2: 3-dc shell in each st around. (18, 6 shells)`);
    expect(R(g, 1).length).toBe(18);
  });

  it.each(['v-st', 'vst', 'v', 'v st'])('%s → (dc, ch 1, dc) in one place, group v, makes a ch-1 sp', (name) => {
    const g = ok(`${RING6}Rnd 2: ${name} in each st around. (12, 6 v-sts, 6 ch-1 sps)`);
    const ns = R(g, 1);
    expect(types(ns.slice(0, 3))).toBe('dc ch dc');
    expect(ns.slice(0, 3).every((n) => n.group?.kind === 'v' && n.group.id === ns[0].group!.id)).toBe(true);
    expect(ns[0].into).toEqual(ns[2].into);
    expect(g.spaces.filter((s) => s.round === 1).map((s) => s.chains.length)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it.each([
    ['fpdc', 'dc', 'fp'], ['bpdc', 'dc', 'bp'], ['fpsc', 'sc', 'fp'], ['fphdc', 'hdc', 'fp'], ['fptr', 'tr', 'fp'], ['bptr', 'tr', 'bp'], ['bpdtr', 'dtr', 'bp'],
  ])('%s → %s with loop %s', (name, type, loop) => {
    const g = ok(`${RING6}Rnd 2: ${name} around next st, 5 sc. (6)`);
    expect(R(g, 1)[0]).toMatchObject({ type, loop, into: [{ node: 0 }] });
  });

  it.each([
    ['sc flo', 'flo'], ['flo sc', 'flo'], ['sc blo', 'blo'], ['sc in blo of next st', 'blo'], ['sc in flo of next st', 'flo'], ['sc in blo', 'blo'],
  ])('"%s" → loop %s', (form, loop) => {
    const g = ok(`${RING6}Rnd 2: ${form}, 5 sc. (6)`);
    expect(R(g, 1)[0]).toMatchObject({ type: 'sc', loop, into: [{ node: 0 }] });
    expect(R(g, 1)[1].loop).toBeUndefined();
  });

  it('"sc blo in each st around" applies to every node', () => {
    const g = ok(`${RING6}Rnd 2: sc blo in each st around. (6)`);
    expect(R(g, 1).every((n) => n.loop === 'blo')).toBe(true);
  });

  it('case-insensitive keywords, × as x', () => {
    const g = ok('RND 1: MR, 6 SC IN RING. (6)\nrnd 2: Inc ×6. (12)');
    expect(counts(g)).toEqual([6, 12]);
  });
});

describe('UK terms (3.1)', () => {
  const UK = 'terms: UK\n';
  it.each([
    ['dc', 'sc'], ['htr', 'hdc'], ['tr', 'dc'], ['dtr', 'tr'], ['trtr', 'dtr'], ['ttr', 'dtr'],
  ])('UK %s → US %s', (uk, us) => {
    const g = ok(`${UK}Rnd 1: mr, 6 ${uk} in ring. (6 ${uk})`);
    expect(R(g, 0).every((n) => n.type === us)).toBe(true);
  });

  it('ss, miss, compounds, counts-as and units are translated', () => {
    const g = ok(`${UK}Rnd 1: mr, ch 3 (counts as tr), 11 tr in ring, ss in first st. (12 tr)
Rnd 2: ch 1, dc in same st, miss next tr, tr3tog, fptr around next st, 3-tr cl in next tr, dc in each st around, join. (9)`);
    expect(R(g, 0)[2]).toMatchObject({ type: 'ch', countsAs: 'dc' });
    expect(R(g, 0)[14].type).toBe('slst');
    const r2 = R(g, 1).filter((n) => n.type !== 'ch');
    expect(r2[0]).toMatchObject({ type: 'sc', into: [{ node: 2 }] });
    expect(r2[1]).toMatchObject({ type: 'dc', into: [{ node: 4 }, { node: 5 }, { node: 6 }] }); // tr3tog after miss
    expect(r2[2]).toMatchObject({ type: 'dc', loop: 'fp', into: [{ node: 7 }] });
    expect(r2[3]).toMatchObject({ type: 'dc', tag: 'cluster', into: Array(3).fill({ node: 8 }) });
    expect(g.rounds[1].stitchCount).toBe(9);
  });

  it('graph always stores US types; meta.terms is UK', () => {
    const r = compilePattern(`title: x\n${UK}Rnd 1: mr, 6 dc in ring. (6)`);
    expect(r.pattern!.meta.terms).toBe('UK');
    expect(r.pattern!.graph.nodes[0].type).toBe('sc');
  });
});

describe('chains, spaces, turning chains (3.4)', () => {
  it('a mid-round chain run forms a space; ch-1 sp too', () => {
    const g = ok(`${RING6}Rnd 2: sc, ch 2, sc, ch 1, 4 sc. (6, 1 ch-2 sp, 1 ch-1 sps, 2 sps)`);
    expect(g.spaces.slice(1)).toEqual([
      { id: 1, kind: 'chsp', round: 1, chains: [7, 8] },
      { id: 2, kind: 'chsp', round: 1, chains: [10] },
    ]);
  });

  it('consecutive chain items merge into one maximal run', () => {
    const g = ok(`${RING6}Rnd 2: sc, ch 2, ch 3, 5 sc. (6, 1 ch-5 sp)`);
    expect(g.spaces[1].chains.length).toBe(5);
  });

  it('a starting chain run is a turning chain; without counts-as it does not count or consume', () => {
    const g = ok(`${RING6}Rnd 2: ch 1, 6 sc. (6)`);
    const ns = R(g, 1);
    expect(ns[0]).toEqual({ id: 6, type: 'ch', round: 1, into: [], role: 'tch', src: ns[0].src });
    expect(ns[1].into).toEqual([{ node: 0 }]);
    expect(g.spaces.length).toBe(1);
  });

  it('a chain after a sl st at the start is still a turning chain', () => {
    const g = ok(`${RING6}Rnd 2: sl st in next st, ch 1, sc in same st, 5 sc. (6)`);
    expect(R(g, 1)[1].role).toBe('tch');
    expect(R(g, 1)[2].into).toEqual([{ node: 0 }]);
  });

  it('ch 3 (counts as dc): last chain counts, stands on the first stitch target which is consumed', () => {
    const g = ok(`${RING6}Rnd 2: ch 3 (counts as dc), dc in same st, 2 dc in each st around, join. (12)`);
    const ns = R(g, 1);
    expect(ns.slice(0, 3).map((n) => [n.role, n.countsAs, n.into])).toEqual([
      ['tch', undefined, []], ['tch', undefined, []], ['tch', 'dc', [{ node: 0 }]],
    ]);
    expect(ns[3].into).toEqual([{ node: 0 }]); // same st = the base
    expect(ns[4].into).toEqual([{ node: 1 }]);
    expect(ns[ns.length - 1]).toMatchObject({ type: 'slst', into: [{ node: ns[2].id }] });
    expect(g.rounds[1].joined).toBe(true);
  });

  it.each([
    ['(counts as first dc)', 3, 'dc'], ['(counts as hdc)', 2, 'hdc'], ['(counts as tr)', 4, 'tr'], ['(counts as sc)', 1, 'sc'],
  ])('ch N %s', (note, n, type) => {
    const g = ok(`${RING6}Rnd 2: ch ${n} ${note}, 5 sc. (6)`);
    expect(R(g, 1)[n - 1]).toMatchObject({ role: 'tch', countsAs: type, into: [{ node: 0 }] });
  });

  it('ch 5 (counts as dc, ch 2): 3 turning chains + a ch-2 space; also "+" and "and"', () => {
    for (const sep of [',', ' +', ' and']) {
      const g = ok(`${RING6}Rnd 2: ch 5 (counts as dc${sep} ch 2), *dc in next st, ch 2* x5, join. (6 dc, 6 ch-2 sps)`);
      const ns = R(g, 1);
      expect(ns.slice(0, 5).map((n) => n.role ?? '-')).toEqual(['tch', 'tch', 'tch', '-', '-']);
      expect(g.spaces[1].chains).toEqual([ns[3].id, ns[4].id]);
    }
  });

  it('ch 3 (does not count as st): plain turning chain', () => {
    const g = ok(`${RING6}Rnd 2: ch 3 (does not count as a st), 6 dc. (6)`);
    expect(R(g, 1).slice(0, 3).every((n) => n.role === 'tch' && !n.countsAs)).toBe(true);
    expect(R(g, 1)[3].into).toEqual([{ node: 0 }]);
  });

  it('counts-as base is the ring when a ring was made in this round', () => {
    const g = ok('Rnd 1: mr, ch 3 (counts as dc), 11 dc in ring, join. (12)');
    expect(g.nodes[2]).toMatchObject({ countsAs: 'dc', into: [{ space: 0 }] });
    expect(g.nodes[14]).toMatchObject({ type: 'slst', into: [{ node: 2 }] });
  });

  it('counts-as base is the target most recently used', () => {
    const g = ok(`${RING6}Rnd 2: sc, ch 3, sc, ch 3, sc, ch 3, sc, ch 3, sc, ch 3, sc, ch 3, join. (6, 6 ch-3 sps)
Rnd 3: sl st in next ch-3 sp, ch 3 (counts as dc), 2 dc in same sp, *3 dc in next ch-3 sp* x5, join. (18)`);
    const sp = g.spaces[1].id;
    expect(R(g, 2)[3]).toMatchObject({ countsAs: 'dc', into: [{ space: sp }] });
    expect(R(g, 2)[4].into).toEqual([{ space: sp }]);
  });

  it('individual chains: sc in next ch / each ch of a chain space', () => {
    const g = ok(`${RING6}Rnd 2: sc, ch 3, 5 sc. (6)\nRnd 3: sc, sc in each ch across, 5 sc. (9)`);
    const ns = R(g, 2);
    expect(ns.slice(1, 4).map((n) => n.into)).toEqual([[{ node: 7 }], [{ node: 8 }], [{ node: 9 }]]);
  });
});

describe('rings (3.4)', () => {
  it.each(['mr', 'magic ring', 'magic circle'])('%s → ring space without chains', (r) => {
    const g = ok(`Rnd 1: ${r}, 6 sc in ring. (6)`);
    expect(g.spaces[0]).toEqual({ id: 0, kind: 'ring', round: 0, chains: [] });
    expect(g.nodes[0].into).toEqual([{ space: 0 }]);
  });

  it.each([
    'ch 6, join to form ring', 'ch 6, join into ring', 'ch 6, join to make ring', 'ch 6, form ring', 'ch 6, sl st in first ch to form ring',
    'ch 6, join with sl st to form a ring', 'ch 6, sl st to form ring',
  ])('"%s" → ring whose chains are the 6 chains, closed by a sl st into the first', (form) => {
    const g = ok(`Rnd 1: ${form}, 12 sc in ring, join. (12)`);
    expect(g.spaces[0]).toEqual({ id: 0, kind: 'ring', round: 0, chains: [0, 1, 2, 3, 4, 5] });
    expect(g.nodes[6]).toMatchObject({ type: 'slst', into: [{ node: 0 }] });
    expect(g.nodes.slice(0, 6).every((n) => n.role === undefined)).toBe(true);
    expect(g.nodes[19]).toMatchObject({ type: 'slst', into: [{ node: 7 }] });
  });

  it('ch 2, 6 sc in 2nd ch from hook (amigurumi start)', () => {
    const g = ok('Rnd 1: ch 2, 6 sc in 2nd ch from hook. (6)\nRnd 2: inc x6. (12)');
    expect(g.nodes[0].role).toBeUndefined();
    expect(g.nodes[1].role).toBe('tch');
    expect(g.nodes.slice(2, 8).every((n) => JSON.stringify(n.into) === '[{"node":0}]')).toBe(true);
    expect(g.spaces).toEqual([]);
  });
});

describe('joins and round structure (3.5)', () => {
  it.each([
    'join', 'join with sl st', 'join with sl st in first st', 'join with sl st to first sc', 'join with sl st in top of beg ch',
    'join with sl st in top of beg ch-1', 'sl st in first st', 'sl st in first sc',
  ])('"%s" closes the round into its first stitch', (j) => {
    const g = ok(`Rnd 1: mr, ch 1, 6 sc in ring, ${j}. (6)`);
    const last = g.nodes[g.nodes.length - 1];
    expect(last).toMatchObject({ type: 'slst', into: [{ node: 1 }] });
    expect(g.rounds[0].joined).toBe(true);
    expect(g.rounds[0].stitchCount).toBe(6);
  });

  it('spiral rounds are not joined; joined rounds start at the join stitch', () => {
    const g = ok(`${RING6}Rnd 2: inc x6. (12)`);
    expect(g.rounds[0].joined).toBe(false);
    const j = ok('Rnd 1: mr, 6 sc in ring, join. (6)\nRnd 2: ch 1, inc x6, join. (12)');
    expect(R(j, 1)[1].into).toEqual([{ node: 0 }]);
  });

  it('turn in a Rnd reverses the next round', () => {
    const g = ok('Rnd 1: mr, 6 sc in ring, join, turn. (6)\nRnd 2: ch 1, 6 sc. (6)');
    expect(g.rounds[1].turned).toBe(true);
    expect(R(g, 1).slice(1).map((n) => n.into)).toEqual([5, 4, 3, 2, 1, 0].map((i) => [{ node: i }]));
  });

  it('turn at the start of a Rnd turns that round', () => {
    const g = ok('Rnd 1: mr, 6 sc in ring, join. (6)\nRnd 2: turn, ch 1, 6 sc. (6)');
    expect(g.rounds[1].turned).toBe(true);
    expect(R(g, 1)[1].into).toEqual([{ node: 5 }]);
  });

  it('fasten off / fo / finish off end the pattern', () => {
    for (const f of ['fasten off', 'fo', 'finish off']) ok(`Rnd 1: mr, 6 sc in ring, join, ${f}. (6)`);
  });
});

describe('rows (1, 3.3)', () => {
  it('foundation chain + 2nd ch from hook + each ch across; rows turn automatically', () => {
    const g = ok('Foundation: ch 11.\nRow 1: sc in 2nd ch from hook, sc in each ch across. (10)\nRow 2: ch 1, sc in each st across. (10)\nRow 3: ch 1, sc in each st across. (10)');
    expect(g.rounds.map((r) => [r.label, r.kind, r.turned])).toEqual([
      ['Foundation', 'foundation', false], ['Row 1', 'row', false], ['Row 2', 'row', true], ['Row 3', 'row', true],
    ]);
    // hook-end chain becomes a turning chain; other foundation chains are plain
    expect(g.nodes[10].role).toBe('tch');
    expect(g.nodes.slice(0, 10).every((n) => n.role === undefined)).toBe(true);
    const r1 = R(g, 1);
    expect(r1.map((n) => (n.into[0] as { node: number }).node)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    // Row 2 starts at the last sc of row 1
    const r2 = R(g, 2);
    expect(r2[1].into).toEqual([{ node: r1[9].id }]);
    expect(r2[10].into).toEqual([{ node: r1[0].id }]);
    expect(R(g, 3)[1].into).toEqual([{ node: r2[10].id }]);
    expect(g.spaces).toEqual([]);
  });

  it('Row 1 with its own foundation chain', () => {
    const g = ok('Row 1: ch 11, sc in 2nd ch from hook, sc in each ch across. (10)\nRow 2: ch 1, sc in each st across. (10)');
    expect(g.nodes[10].role).toBe('tch');
    expect(g.nodes[0].role).toBeUndefined();
    expect(counts(g)).toEqual([10, 10]);
  });

  it('dc rows with counting turning chains and "top of tch"', () => {
    const g = ok(
      'Row 1: ch 12, dc in 4th ch from hook, dc in each ch across. (9)\n' +
      'Row 2: ch 3 (counts as dc), dc in next st, dc in each st across. (9)\n' +
      'Row 3: ch 3 (counts as dc), dc in each of next 7 sts, dc in top of tch. (9)');
    expect(counts(g)).toEqual([9, 9, 9]);
    const r2 = R(g, 1);
    expect(r2[2]).toMatchObject({ countsAs: 'dc', into: [{ node: R(g, 0)[R(g, 0).length - 1].id }] });
    const r3 = R(g, 2);
    expect(r3[r3.length - 1].into).toEqual([{ node: r2[2].id }]);
  });

  it('explicit turn in a row is accepted and redundant (info)', () => {
    const r = compilePattern('Row 1: ch 6, sc in 2nd ch from hook, sc in each ch across, turn. (5)\nRow 2: ch 1, sc in each st across. (5)');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['I_REDUNDANT_TURN']);
    expect(r.pattern!.graph.rounds[1].turned).toBe(true);
  });

  it('a trailing unworked counting turning chain in a row is an info, not a warning', () => {
    const r = compilePattern('Row 1: ch 8, dc in 4th ch from hook, dc in each ch across. (5)\nRow 2: ch 3 (counts as dc), dc in next 4 sts. (5)\nRow 3: ch 3 (counts as dc), dc in next 3 sts. (4)');
    expect(r.diagnostics.map((d) => [d.code, d.severity])).toEqual([['I_UNWORKED_TCH', 'info']]);
  });
});

describe('targets and the cursor (3.3)', () => {
  it('next st passes over spaces; next sp passes over stitches', () => {
    const g = ok(`${RING6}Rnd 2: sc, ch 3, sc, ch 3, sc, ch 3, sc, ch 3, sc, ch 3, sc, ch 3. (6, 6 ch-3 sps)
Rnd 3: sc in next st, 3 sc in next sp, sc in next ch-3 sp, sc in next st, sc in next st, 2 sc, sk next sp. (9)`);
    const r = R(g, 2);
    const sp = (i: number) => ({ space: g.spaces[i].id });
    expect(r[0].into).toEqual([{ node: 6 }]);
    expect(r[1].into).toEqual([sp(1)]);
    expect(r[4].into).toEqual([sp(2)]);
    expect(r[5].into).toEqual([{ node: R(g, 1)[8].id }]);
  });

  it('next dc passes over other stitches; each sc around', () => {
    const g = ok(`${RING6}Rnd 2: sc, dc, sc, dc, sc, dc. (3 sc, 3 dc)\nRnd 3: sl st in next dc, 2 sc in next dc, sc in each sc around, sk 1. (3)`);
    const r1 = R(g, 1);
    const r = R(g, 2);
    expect(r[0].into).toEqual([{ node: r1[1].id }]);
    expect(r[1].into).toEqual([{ node: r1[3].id }]);
    expect(r[3].into).toEqual([{ node: r1[4].id }]);
  });

  it('next ch-N sp passes over spaces of other lengths', () => {
    const g = ok(`${RING6}Rnd 2: sc, ch 2, sc, ch 1, sc, ch 2, sc, ch 1, sc, ch 2, sc, ch 1, join. (6, 3 ch-2 sps, 3 ch-1 sps)
Rnd 3: sl st in next ch-2 sp, ch 1, 3 sc in same sp, *3 sc in next ch-2 sp* x2, sk next st, join. (9)`);
    const r = R(g, 2).filter((n) => n.type === 'sc');
    expect(r.map((n) => (n.into[0] as { space: number }).space)).toEqual([1, 1, 1, 3, 3, 3, 5, 5, 5]);
  });

  it('sk N, sk next st, sk next ch-sp', () => {
    const g = ok(`${RING6}Rnd 2: sc, sk 1, sc, sk next st, sc, skip 1 st. (3)`);
    expect(R(g, 1).map((n) => n.into)).toEqual([[{ node: 0 }], [{ node: 2 }], [{ node: 4 }]]);
  });

  it('same st at the start of a joined round is the join stitch, and consumes it', () => {
    const g = ok('Rnd 1: mr, ch 1, 6 sc in ring, join. (6)\nRnd 2: ch 1, 2 sc in same st, 2 sc in each st around, join. (12)');
    expect(R(g, 1).filter((n) => n.type === 'sc').map((n) => (n.into[0] as { node: number }).node)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });

  it('"same st as join" filler', () => {
    const g = ok('Rnd 1: mr, 6 sc in ring, join. (6)\nRnd 2: ch 1, 2 sc in same st as join, 2 sc in each st around, join. (12)');
    expect(R(g, 1)[1].into).toEqual([{ node: 0 }]);
  });

  it('first st = first stitch of the current round; top of ch-3 in a Rnd too', () => {
    const g = ok('Rnd 1: mr, ch 3 (counts as dc), 11 dc in ring, sl st in top of ch-3. (12)');
    expect(g.rounds[0].joined).toBe(true);
    expect(g.nodes[14].into).toEqual([{ node: 2 }]);
  });

  it('ranges: Rnds a-b repeat the instruction once per round', () => {
    const g = ok(`${RING6}Rnds 2-4: sc in each st around. (6)\nRnd 5: inc x6. (12)`);
    expect(g.rounds.map((r) => r.label)).toEqual(['Rnd 1', 'Rnd 2', 'Rnd 3', 'Rnd 4', 'Rnd 5']);
    expect(R(g, 3)[0].into).toEqual([{ node: R(g, 2)[0].id }]);
    for (const L of ['Rnd 2-4', 'Rounds 2-4', 'Rnds 2 – 4', 'Rnds 2 to 4']) expect(ok(`${RING6}${L}: 6 sc. (6)`).rounds.length).toBe(4);
    expect(ok('Row 1: ch 6, sc in 2nd ch from hook, sc in each ch across. (5)\nRows 2-5: ch 1, sc in each st across. (5)').rounds.map((r) => r.turned)).toEqual([false, true, true, true, true]);
  });

  it('round labels: Round, R, Row; continuation lines; comments', () => {
    const g = ok('Round 1: mr,\n  6 sc in ring.   # six\nR 2: inc x6.\n# note\nrnd 3: *sc, inc* x6. (18)');
    expect(counts(g)).toEqual([6, 12, 18]);
    expect(g.rounds[1].src).toEqual({ line: 3, endLine: 3 });
    expect(g.rounds[0].src).toEqual({ line: 1, endLine: 2 });
  });

  it('separators , ; . are equivalent, trailing separator allowed', () => {
    const g = ok('Rnd 1: mr; 6 sc in ring.\nRnd 2: sc. sc; inc. inc, inc, sc;. (9)');
    expect(counts(g)).toEqual([6, 9]);
  });
});

describe('groups (3.6)', () => {
  it('(…) in <place>: untargeted stitches go into that place, chains form spaces', () => {
    const g = ok(`${RING6}Rnd 2: (sc, ch 3, sc) in next st, [2 dc, ch 2, 2 dc] in next st, 4 sc. (10, 1 ch-3 sp, 1 ch-2 sp)`);
    const r = R(g, 1);
    expect(r.slice(0, 5).map((n) => n.into)).toEqual([[{ node: 0 }], [], [], [], [{ node: 0 }]]);
    expect(g.spaces[1].chains).toEqual([r[1].id, r[2].id, r[3].id]);
    expect(r.slice(5, 11).map((n) => (n.into[0] as { node: number } | undefined)?.node ?? -1)).toEqual([1, 1, -1, -1, 1, 1]);
  });

  it('group without target, repeated: (sc, ch 1) x3', () => {
    const g = ok(`${RING6}Rnd 2: (sc, ch 1) x3, 3 sc. (6, 3 ch-1 sps)`);
    expect(types(R(g, 1))).toBe('sc ch sc ch sc ch sc sc sc');
  });

  it('group in each sp around; stitches with their own target inside a group', () => {
    const g = ok(`${RING6}Rnd 2: *sc, ch 5* x6, join. (6, 6 ch-5 sps)\nRnd 3: sl st in next ch-5 sp, ch 1, (sc, ch 3, sc) in same sp, (sc, ch 3, sc) in each ch-5 sp around, join. (12, 6 ch-3 sps)`);
    expect(g.rounds[2].stitchCount).toBe(12);
    const g2 = ok(`${RING6}Rnd 2: (sc in next st, ch 1, sc in next st) x3. (6, 3 ch-1 sps)`);
    expect(R(g2, 1).filter((n) => n.type === 'sc').map((n) => n.into)).toEqual([0, 1, 2, 3, 4, 5].map((i) => [{ node: i }]));
  });

  it('groups nest inside repeats; repeats of groups', () => {
    const g = ok(`${RING6}Rnd 2: *sc, (dc, ch 1, dc, ch 1) in next st* x3. (9, 6 ch-1 sps)`);
    expect(types(R(g, 1))).toBe('sc dc ch dc ch sc dc ch dc ch sc dc ch dc ch');
    expect(R(g, 1)[3].into).toEqual([{ node: 1 }]);
    const g2 = ok(`${RING6}Rnd 2: *sc, (dc, ch 1) x2* x2. (6, 4 ch-1 sps)`);
    expect(types(R(g2, 1))).toBe('sc dc ch dc ch sc dc ch dc ch');
    expect(R(g2, 1)[3].into).toEqual([{ node: 2 }]);
  });
});

describe('repeats (3.7)', () => {
  it.each([
    ['*sc, inc* x3', 9], ['*sc, inc* 3 times', 9], ['*sc, inc; rep from * 2 more times', 9], ['*sc, inc, rep from * 3 times', 9],
    ['*sc, inc; rep from * around', 9], ['*sc, inc* around', 9], ['*sc, inc; rep from * to end', 9], ['*sc, inc* across', 9],
    ['*sc, inc* ×3', 9], ['*sc, inc; rep from * 2 times more', 9], ['*sc, inc; repeat from * 2 more times', 9],
  ])('%s', (src, n) => {
    const g = ok(`${RING6}Rnd 2: ${src}. (${n})`);
    expect(g.rounds[1].stitchCount).toBe(n);
  });

  it('items after a rep-from repeat continue the round', () => {
    const g = ok('Rnd 1: mr, 6 sc in ring, join. (6)\nRnd 2: ch 1, *sc, inc; rep from * 2 more times, join. (9)');
    expect(g.rounds[1].joined).toBe(true);
  });

  it('around after a lead-in uses the remaining targets', () => {
    const g = ok(`${RING6}Rnd 2: sc, inc, *sc, inc* around. (9)`);
    expect(g.rounds[1].stitchCount).toBe(9);
  });

  it('*sc in next ch-5 sp, ch 5* around stops when the spaces run out', () => {
    const g = ok(`${RING6}Rnd 2: *sc, ch 5* x6, join. (6, 6 ch-5 sps)\nRnd 3: sl st in next ch-5 sp, ch 1, sc in same sp, ch 5, *sc in next ch-5 sp, ch 5* around, join. (6, 6 ch-5 sps)`);
    expect(g.rounds[2].stitchCount).toBe(6);
  });
});

describe('count annotations (3.8)', () => {
  it('declaredCount from (N), (N sts), or a complete typed list', () => {
    expect(ok(`${RING6}Rnd 2: inc x6. (12 sts)`).rounds[1].declaredCount).toBe(12);
    expect(ok(`${RING6}Rnd 2: inc x6. (12 sc)`).rounds[1].declaredCount).toBe(12);
    expect(ok(`${RING6}Rnd 2: inc x6.`).rounds[1].declaredCount).toBeUndefined();
    expect(ok(`${RING6}Rnd 2: *sc, ch 2* x6. (6 ch-2 sps)`).rounds[1].declaredCount).toBeUndefined();
  });

  it('typed units: stitch names incl. counting tch, spaces by length, cl, puff, pc, picot, shells, v-sts', () => {
    ok('Rnd 1: mr, ch 3 (counts as dc), 11 dc in ring, join. (12 dc)');
    ok(`Rnd 1: mr, 10 sc in ring. (10)\nRnd 2: *cl, ch 2, puff, pc, picot, shell in next st, v-st in next st* x2. (2 cl, 2 puff, 2 pc, 2 picot, 2 shells, 2 v-sts, 2 ch-2 sps, 2 ch-1 sps, 4 sps, 20)`);
  });

  it('a parenthesised item that is not a count is a group: (2 sc, ch 3, 2 sc) at the end', () => {
    const g = ok(`${RING6}Rnd 2: 4 sc, (2 sc, ch 3)`);
    expect(g.rounds[1].stitchCount).toBe(6);
    expect(g.spaces.length).toBe(2);
  });

  it('unknown units are I_COUNT_UNVERIFIED, not errors', () => {
    const r = compilePattern(`${RING6}Rnd 2: inc x6. (12, 6 incs)`);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['I_COUNT_UNVERIFIED']);
    expect(r.pattern).toBeDefined();
  });
});

describe('meta and headers', () => {
  it('known headers go to meta, unknown to meta.extra with a warning', () => {
    const r = compilePattern('title: T\nauthor: A\nyear: 1910\nhook: 5mm\ncolour: red\n\nRnd 1: mr, 6 sc in ring. (6)');
    // warnings do not block the pattern
    const p = r.pattern!;
    expect(p.meta).toEqual({ title: 'T', terms: 'US', hook: '5mm', author: 'A', year: '1910', extra: { colour: 'red' } });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['W_UNKNOWN_HEADER']);
    expect(diags('Rnd 1: mr, 6 sc in ring.')).toEqual([]);
  });
});
