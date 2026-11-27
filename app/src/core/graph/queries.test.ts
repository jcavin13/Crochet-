import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compilePattern } from '../notation/index';
import {
  anchorsOf, childrenOf, describeNode, roundNodes, roundSummary, spaceNodesInto, stitchCounting, targetsOfRound,
} from './queries';

const specDir = fileURLToPath(new URL('../../../../spec/', import.meta.url));
const tiny = compilePattern(readFileSync(`${specDir}examples/tiny.cro`, 'utf8')).pattern!.graph;
const doily = compilePattern(readFileSync(`${specDir}fixtures/simple_doily.cro`, 'utf8')).pattern!.graph;

describe('queries', () => {
  it('stitchCounting', () => {
    expect(tiny.nodes.map((n) => (stitchCounting(n) ? 1 : 0)).join('')).toBe('11110' + '00101010100' + '0111111110');
  });

  it('roundNodes', () => {
    expect(roundNodes(tiny, 1).map((n) => n.id)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(roundNodes(tiny, 9)).toEqual([]);
  });

  it('targetsOfRound: stitches and spaces in working order', () => {
    expect(targetsOfRound(tiny, 1)).toEqual([
      { kind: 'stitch', node: 7 }, { kind: 'space', space: 1 }, { kind: 'stitch', node: 9 }, { kind: 'space', space: 2 },
      { kind: 'stitch', node: 11 }, { kind: 'space', space: 3 }, { kind: 'stitch', node: 13 }, { kind: 'space', space: 4 },
    ]);
    expect(targetsOfRound(tiny, 0).length).toBe(4); // ring is not a target
  });

  it('spaceNodesInto / anchorsOf / childrenOf', () => {
    expect(spaceNodesInto(tiny, 1).map((n) => n.id)).toEqual([17, 18]);
    expect(spaceNodesInto(tiny, 0).map((n) => n.id)).toEqual([0, 1, 2, 3]);
    expect(anchorsOf(tiny, 7)).toEqual([{ kind: 'node', node: tiny.nodes[0] }]);
    expect(anchorsOf(tiny, 17)).toEqual([{ kind: 'space', space: tiny.spaces[1] }]);
    const ch = childrenOf(tiny);
    expect(ch.nodes[0]).toEqual([4, 7]); // join of Rnd 1 + the counting tch of Rnd 2
    expect(ch.spaces[4]).toEqual([23, 24]);
    expect(ch.nodes[16]).toEqual([]);
  });

  it('childrenOf lists a decrease once per parent', () => {
    const g = compilePattern('Rnd 1: mr, 6 sc in ring.\nRnd 2: dc3tog in next st, 5 sc.').pattern!.graph;
    expect(childrenOf(g).nodes[0]).toEqual([6]);
  });

  it('roundSummary: counts by type and spaces by length', () => {
    expect(roundSummary(tiny, 1)).toEqual({
      index: 1, label: 'Rnd 2', kind: 'round', stitchCount: 4, declaredCount: 4, joined: true, turned: false, nodes: 11,
      byType: { dc: 4, ch: 4, 'sl st': 1 }, spaces: { 1: 4 }, rings: 0,
    });
    expect(roundSummary(doily, 5).byType).toEqual({ 'sl st': 2, sc: 32, picot: 16, ch: 64 });
    expect(roundSummary(doily, 4).spaces).toEqual({ 1: 16, 2: 16 });
    expect(roundSummary(doily, 0).rings).toBe(1);
    expect(roundSummary(tiny, 1, { terms: 'UK' }).byType).toEqual({ tr: 4, ch: 4, ss: 1 });
  });

  it.each([
    [0, 'sc in ring'],
    [4, 'sl st in first st (join)'],
    [5, 'ch (turning ch, 1 of 3)'],
    [7, 'ch 3 (counts as dc)'],
    [8, 'ch (1 of 1, ch-1 sp)'],
    [9, 'dc in sc'],
    [15, 'sl st in top of beg ch (join)'],
    [16, 'ch (turning ch, 1 of 1)'],
    [17, 'dc in ch-1 sp'.replace('dc', 'sc')],
  ])('describeNode(tiny, %i) = %s', (id, text) => {
    expect(describeNode(tiny, id)).toBe(text);
  });

  it('describeNode: UK terms, groups, decreases, clusters, picots, ring chains', () => {
    expect(describeNode(tiny, 17, { terms: 'UK' })).toBe('dc in ch-1 sp');
    expect(describeNode(doily, 6)).toBe('sl st in first ch (join to form ring)');
    expect(describeNode(doily, 0)).toBe('ch (1 of 6, ring)');
    const g = compilePattern('Rnd 1: mr, 7 sc in ring.\nRnd 2: inc, sc2tog, cl, picot, v-st, shell in next st, fpdc around next st.').pattern!.graph;
    const r = roundNodes(g, 1).map((n) => describeNode(g, n.id));
    expect(r).toEqual([
      'sc in sc (inc 1/2)', 'sc in sc (inc 2/2)', 'sc2tog over 2 sts', 'cl in sc', 'picot (ch 3)',
      'dc in sc (V-st 1/3)', 'ch (1 of 1, ch-1 sp) (V-st 2/3)', 'dc in sc (V-st 3/3)',
      'dc in sc (shell 1/5)', 'dc in sc (shell 2/5)', 'dc in sc (shell 3/5)', 'dc in sc (shell 4/5)', 'dc in sc (shell 5/5)',
      'fpdc around sc',
    ]);
  });
});
