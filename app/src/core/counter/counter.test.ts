import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compilePattern } from '../notation/index';
import type { Pattern } from '../graph/types';
import {
  GRANULARITIES, buildSteps, findPeriod, jumpToNode, jumpToRound, newProgress, newTally, next, pace,
  patternAst, positionOf, positionText, prev, reconcile, reset, roundExpectation, setGranularity,
  setNote, stepAt, tallyAdd, tallyAddCounter, tallyRemove, tallyUndo, undo, type StepList,
} from './index';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (p: string) => readFileSync(`${root}${p}`, 'utf8');
const fixtureNames = readdirSync(`${root}spec/fixtures`).filter((f) => f.endsWith('.cro')).sort();
const corpusNames = readdirSync(`${root}data/corpus`).filter((f) => f.endsWith('.cro')).sort();
const sources: [string, string][] = [
  ...fixtureNames.map((f): [string, string] => [`fixture:${f}`, read(`spec/fixtures/${f}`)]),
  ...corpusNames.map((f): [string, string] => [`corpus:${f}`, read(`data/corpus/${f}`)]),
];

function compiled(text: string): Pattern {
  const r = compilePattern(text);
  if (!r.pattern) throw new Error(r.diagnostics.map((d) => d.message).join('\n'));
  return r.pattern;
}

/** Same graph without notation and src: an imported graph JSON. */
function graphOnly(p: Pattern): Pattern {
  return { ...p, notation: undefined, graph: { ...p.graph, nodes: p.graph.nodes.map(({ src: _src, ...n }) => n) } };
}

function checkPartition(p: Pattern, L: StepList) {
  const g = p.graph;
  expect(L.nodeCount).toBe(g.nodes.length);
  let expectFirst = 0;
  for (const s of L.steps) {
    expect(s.first).toBe(expectFirst);
    expect(s.last).toBeGreaterThanOrEqual(s.first);
    for (let i = s.first; i <= s.last; i++) {
      expect(g.nodes[i].round).toBe(s.round);
      expect(L.stepOfNode[i]).toBe(s.index);
    }
    expect(s.text.length).toBeGreaterThan(0);
    expectFirst = s.last + 1;
  }
  expect(expectFirst).toBe(g.nodes.length);
  // per-round totals
  const totals = new Map<number, number>();
  for (const s of L.steps) totals.set(s.round, (totals.get(s.round) ?? 0) + s.counts);
  g.rounds.forEach((R, r) => {
    if (R.first < 0) return;
    expect(totals.get(r) ?? 0).toBe(R.stitchCount);
    const last = L.steps[L.rounds[r].lastStep];
    expect(last.endsRound).toBe(true);
    expect(last.countBefore + last.counts).toBe(R.stitchCount);
  });
}

describe('step lists on every fixture and corpus pattern', () => {
  for (const [name, text] of sources) {
    describe(name, () => {
      const p = compiled(text);
      const ast = patternAst(p);
      for (const granularity of GRANULARITIES) {
        for (const terms of ['US', 'UK'] as const) {
          it(`${granularity} / ${terms}: steps partition the nodes, totals match`, () => {
            const L = buildSteps(p, { granularity, terms, ast });
            checkPartition(p, L);
            if (granularity === 'round') expect(L.steps.length).toBe(p.graph.rounds.filter((r) => r.first >= 0).length);
            if (granularity === 'stitch') expect(L.steps.length).toBe(p.graph.nodes.length);
          });
        }
      }
      it('group steps come from the notation and are deterministic', () => {
        const a = buildSteps(p, { granularity: 'group' });
        const b = buildSteps(p, { granularity: 'group' });
        expect(a.fromNotation).toBe(true);
        expect(a.steps).toEqual(b.steps);
        expect(a.steps.length).toBeLessThan(p.graph.nodes.length);
        for (const s of a.steps) expect(s.src).toBeDefined();
      });
      it('graph-only fallback (no notation, no src) still partitions', () => {
        const q = graphOnly(p);
        const L = buildSteps(q, { granularity: 'group' });
        expect(L.fromNotation).toBe(false);
        checkPartition(q, L);
      });
      it('graph with src but no notation partitions', () => {
        const q = { ...p, notation: undefined };
        checkPartition(q, buildSteps(q, { granularity: 'group' }));
      });
    });
  }
});

describe('simple doily instructions', () => {
  const p = compiled(read('spec/fixtures/simple_doily.cro'));
  const L = buildSteps(p, { granularity: 'group', terms: 'US' });
  const inRound = (r: number) => L.steps.filter((s) => s.round === r);

  it('names items as written', () => {
    const r1 = inRound(0).map((s) => s.text);
    expect(r1).toEqual(['ch 6', 'join to form ring', 'ch 3 (counts as dc)', '15 dc in ring', 'sl st to join']);
    const r5 = inRound(4).map((s) => s.text);
    expect(r5.slice(0, 6)).toEqual([
      'sl st in next ch-4 sp', 'ch 5 (counts as dc, ch 2)', 'dc in same sp', 'ch 1', '(dc, ch 2, dc) in next ch-4 sp', 'ch 1',
    ]);
    expect(r5[r5.length - 1]).toBe('sl st to join');
    expect(inRound(5).at(-1)!.text).toBe('sl st to join, fasten off');
  });

  it('positions and repeats', () => {
    const r5 = inRound(4);
    const groups = r5.filter((s) => s.text.startsWith('(dc, ch 2, dc)'));
    expect(groups).toHaveLength(15);
    // the written-out first repeat counts: body repeats are 2…16 of 16
    expect(groups[0].repeat).toEqual({ index: 2, total: 16 });
    expect(groups[3].repeat).toEqual({ index: 5, total: 16 });
    expect(groups[14].repeat).toEqual({ index: 16, total: 16 });
    expect(r5[1].repeat).toEqual({ index: 1, total: 16 });
    expect(r5[0].repeat).toBeUndefined();
    expect(positionText(groups[0])).toBe('stitches 3–4 of 32');
    expect(positionText(r5[0])).toBe('before stitch 1 of 32');
    expect(groups[0].into).toBe('ch-4 sp of Rnd 4');
    expect(L.rounds[4].repeats).toEqual({ period: 5, total: 16 });
  });

  it('UK terms', () => {
    const U = buildSteps(p, { granularity: 'group', terms: 'UK' });
    const r5 = U.steps.filter((s) => s.round === 4).map((s) => s.text);
    expect(r5.slice(0, 5)).toEqual(['ss in next ch-4 sp', 'ch 5 (counts as tr, ch 2)', 'tr in same sp', 'ch 1', '(tr, ch 2, tr) in next ch-4 sp']);
    expect(r5.at(-1)).toBe('ss to join');
    expect(U.rounds[4].line).toMatch(/^Rnd 5: ss in next ch-4 sp, ch 5 \(counts as tr, ch 2\)/);
  });

  it('stitch granularity', () => {
    const S = buildSteps(p, { granularity: 'stitch' });
    expect(S.steps[9].text).toBe('ch 3 (counts as dc)');
    expect(S.steps[25].text).toBe('sl st to join');
    expect(S.steps[10].text).toBe('dc in ring');
  });

  it('end-of-round expectation', () => {
    expect(roundExpectation(p.graph, 4).text).toBe('You should have 32 dc, 16 ch-2 spaces and 16 ch-1 spaces');
    expect(roundExpectation(p.graph, 0).text).toBe('You should have 16 dc');
    expect(roundExpectation(p.graph, 5).text).toBe('You should have 32 sc, 16 picots and 16 ch-4 spaces');
    expect(roundExpectation(p.graph, 5, 'UK').parts[0]).toBe('32 dc');
  });
});

describe('grouping details', () => {
  it('splits "inc x6" into one step per inc and "each st around" per target', () => {
    const p = compiled('Rnd 1: mr, 6 sc in ring. (6)\nRnd 2: inc x6. (12)\nRnd 3: 2 sc in each st around. (24)\nRnd 4: *sc* x24. (24)\nRnd 5: 5 sc, *(sc, ch 2, sc) in next st* x2, sc in each st around. (26)\n');
    const L = buildSteps(p);
    const r = (k: number) => L.steps.filter((s) => s.round === k).map((s) => s.text);
    expect(r(0)).toEqual(['magic ring, 6 sc in ring']);
    expect(r(1)).toEqual(Array(6).fill('inc (2 sc in next st)'));
    expect(r(2)).toEqual(Array(12).fill('2 sc in next st'));
    expect(r(3)).toEqual(Array(24).fill('sc'));
    expect(r(4).slice(0, 3)).toEqual(['sc in next 5 sts', '(sc, ch 2, sc) in next st', '(sc, ch 2, sc) in next st']);
    expect(r(4).length).toBe(3 + 17);
    checkPartition(p, L);
  });

  it('rows: turning chains and skips', () => {
    const p = compiled('Foundation: ch 11.\nRow 1: sc in 2nd ch from hook, sc in each ch across. (10)\nRow 2: ch 3 (counts as dc), sk 1 st, dc in each st across. (9)\n');
    const L = buildSteps(p);
    checkPartition(p, L);
    const r2 = L.steps.filter((s) => s.round === 2).map((s) => s.text);
    expect(r2[0]).toBe('ch 3 (counts as dc), sk 1 st');
  });

  it('periodicity finder', () => {
    expect(findPeriod('a b c a b c a b c'.split(' '))).toEqual({ start: 0, period: 3, reps: 3 });
    expect(findPeriod('x a b a b a b'.split(' '))).toEqual({ start: 1, period: 2, reps: 3 });
    expect(findPeriod('a b c d'.split(' '))).toBeUndefined();
  });
});

describe('progress reducers', () => {
  const p = compiled(read('spec/fixtures/simple_doily.cro'));
  const g = p.graph;
  const L = buildSteps(p, { granularity: 'group' });
  const S = buildSteps(p, { granularity: 'stitch' });

  it('next / prev / undo', () => {
    let s = newProgress('fixture:simple_doily', p, 1000);
    expect(s.nodeIndex).toBe(0);
    s = next(s, L, g, 2000); // ch 6
    expect(s.nodeIndex).toBe(6);
    s = next(s, L, g, 3000); // join
    s = next(s, L, g, 4000); // ch 3
    expect(s.nodeIndex).toBe(10);
    expect(s.roundTimes[0].start).toBe(2000);
    s = prev(s, L, g, 5000);
    expect(s.nodeIndex).toBe(7);
    s = undo(s, g, 6000);
    expect(s.nodeIndex).toBe(10);
    expect(s.history).toEqual([0, 6, 7]);
  });

  it('crossing a round records times; finishing stops', () => {
    let s = newProgress('x', p, 0);
    let t = 0;
    while (s.nodeIndex < g.rounds[1].first) s = next(s, L, g, (t += 1000));
    expect(s.roundTimes[0].end).toBe(t);
    expect(s.roundTimes[1].start).toBe(t);
    expect(positionOf(L, g, s.nodeIndex)).toMatchObject({ round: 1, done: 0, total: 16 });
    s = jumpToRound(s, g, 5, t);
    while (s.nodeIndex < g.nodes.length) s = next(s, L, g, (t += 1000));
    expect(stepAt(L, s.nodeIndex)).toBe(L.steps.length);
    expect(next(s, L, g, t + 1)).toBe(s);
    expect(positionOf(L, g, s.nodeIndex).finished).toBe(true);
    const pc = pace(s, g);
    expect(pc.roundsTimed).toBeGreaterThan(0);
    expect(pc.remainingMs).toBe(0);
  });

  it('granularity switch keeps the pointer; prev from mid-step goes to the step start', () => {
    let s = newProgress('x', p, 0, 'stitch');
    for (let k = 0; k < 12; k++) s = next(s, S, g, k);
    expect(s.nodeIndex).toBe(12); // inside "15 dc in ring" [10-24]
    s = setGranularity(s, 'group', 20);
    expect(s.nodeIndex).toBe(12);
    expect(L.steps[stepAt(L, 12)].text).toBe('15 dc in ring');
    expect(prev(s, L, g, 21).nodeIndex).toBe(10);
    expect(next(s, L, g, 21).nodeIndex).toBe(25);
  });

  it('jumpToNode, reset, notes', () => {
    let s = newProgress('x', p, 0);
    s = jumpToNode(s, g, 200, 1);
    expect(s.anchor).toEqual({ round: 4, offset: 3, label: 'Rnd 5' });
    s = setNote(s, 4, 'switched to new ball', 2);
    s = reset(s, g, 3);
    expect(s.nodeIndex).toBe(0);
    expect(s.notes[4]).toBe('switched to new ball');
    s = undo(s, g, 4);
    expect(s.nodeIndex).toBe(200);
    expect(setNote(s, 4, '  ', 5).notes[4]).toBeUndefined();
  });

  it('reconcile keeps the place by round/offset when the pattern changed', () => {
    let s = newProgress('x', p, 0);
    s = jumpToNode(s, g, 205, 1);
    expect(reconcile(s, p, 2).changed).toBe(false);
    // edit Rnd 1 (two more dc): node ids shift, Rnd 5 offset still valid
    const edited = compiled(read('spec/fixtures/simple_doily.cro').replace('15 dc in ring, join. (16)', '15 dc in ring, join. (16)\n# edited').replace('title: Simple', 'title: Edited'));
    const r = reconcile(s, edited, 3);
    expect(r.changed).toBe(true);
    expect(r.message).toMatch(/Rnd 5/);
    expect(r.progress.nodeIndex).toBe(edited.graph.rounds[4].first + 8);
    // a pattern with fewer rounds: moves to the last round
    const short = compiled('Rnd 1: mr, 6 sc in ring. (6)\n');
    const r2 = reconcile(s, short, 4);
    expect(r2.progress.nodeIndex).toBe(0);
    expect(r2.message).toMatch(/no longer exists/);
  });
});

describe('tally', () => {
  it('counts, undoes, adds and removes counters', () => {
    let t = newTally();
    t = tallyAdd(t, 'c1', 1);
    t = tallyAdd(t, 'c1', 1);
    t = tallyAdd(t, 'c2', -1); // clamps at 0, no-op
    expect(t.counters[0].value).toBe(2);
    expect(t.history).toHaveLength(2);
    t = tallyUndo(t);
    expect(t.counters[0].value).toBe(1);
    t = tallyAddCounter(t, 'Repeats');
    expect(t.counters.map((c) => c.name)).toEqual(['Rows', 'Stitches', 'Repeats']);
    expect(t.active).toBe('c3');
    t = tallyRemove(t, 'c3');
    expect(t.active).toBe('c1');
  });
});
