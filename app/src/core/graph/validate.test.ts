import { describe, expect, it } from 'vitest';
import { compilePattern } from '../notation/index';
import { validateGraph, validatePattern, isValidGraph } from './validate';
import type { Graph, Pattern } from './types';

function tiny(): Pattern {
  const r = compilePattern('Rnd 1: mr, 4 sc in ring, join. (4)\nRnd 2: ch 4 (counts as dc, ch 1), *dc in next st, ch 1* x3, join. (4)');
  return JSON.parse(JSON.stringify(r.pattern));
}
const codes = (g: Graph) => validateGraph(g).map((i) => i.code);

describe('validateGraph', () => {
  it('accepts compiler output', () => {
    const p = tiny();
    expect(validatePattern(p)).toEqual([]);
    expect(isValidGraph(p.graph)).toBe(true);
  });

  it('accepts an empty graph and a hand-built one', () => {
    expect(validateGraph({ nodes: [], spaces: [], rounds: [] })).toEqual([]);
    const g: Graph = {
      nodes: [
        { id: 0, type: 'ch', round: 0, into: [] },
        { id: 1, type: 'ch', round: 0, into: [] },
        { id: 2, type: 'sc', round: 0, into: [{ node: 0 }] },
      ],
      spaces: [],
      rounds: [{ index: 0, label: 'Row 1', kind: 'row', first: 0, last: 2, stitchCount: 1 }],
    };
    expect(validateGraph(g)).toEqual([]);
  });

  const cases: [string, (p: Pattern) => void, string][] = [
    ['id != index', (p) => { p.graph.nodes[3].id = 7; }, 'G_ID'],
    ['space id != index', (p) => { p.graph.spaces[1].id = 9; }, 'G_ID'],
    ['round index', (p) => { p.graph.rounds[1].index = 5; }, 'G_ROUND_INDEX'],
    ['forward anchor', (p) => { p.graph.nodes[2].into = [{ node: 9 }]; }, 'G_ANCHOR_FORWARD'],
    ['anchor out of range', (p) => { p.graph.nodes[2].into = [{ node: 999 }]; }, 'G_ANCHOR_RANGE'],
    ['space anchor out of range', (p) => { p.graph.nodes[2].into = [{ space: 99 }]; }, 'G_ANCHOR_RANGE'],
    ['stitchCount wrong', (p) => { p.graph.rounds[0].stitchCount = 5; }, 'G_STITCH_COUNT'],
    ['non-contiguous rounds', (p) => { p.graph.rounds[1].first = 6; }, 'G_ROUND_RANGE'],
    ['node in the wrong round', (p) => { p.graph.nodes[6].round = 0; }, 'G_NODE_ROUND'],
    ['sc with no anchor', (p) => { p.graph.nodes[0].into = []; }, 'G_ANCHOR_COUNT'],
    ['chain with an anchor', (p) => { p.graph.nodes[5].into = [{ node: 0 }]; }, 'G_ANCHOR_COUNT'],
    ['countsAs on a plain stitch', (p) => { p.graph.nodes[0].countsAs = 'dc'; }, 'G_COUNTS_AS'],
    ['space with a non-chain', (p) => { p.graph.spaces[1].chains = [9]; }, 'G_SPACE'],
    ['space with a turning chain', (p) => { p.graph.spaces[1].chains = [5]; }, 'G_SPACE'],
    ['unknown type', (p) => { (p.graph.nodes[0] as { type: string }).type = 'xx'; }, 'G_TYPE'],
    ['cluster with one leg', (p) => { p.graph.nodes[9].tag = 'cluster'; }, 'G_CLUSTER'],
  ];
  it.each(cases)('%s → %s', (_n, mutate, code) => {
    const p = tiny();
    mutate(p);
    expect(codes(p.graph)).toContain(code);
  });

  it('warns (not errors) for anchors further back than the previous round', () => {
    const p = compilePattern('Rnd 1: mr, 4 sc in ring. (4)\nRnd 2: 4 sc. (4)\nRnd 3: 4 sc. (4)').pattern!;
    p.graph.nodes[8].into = [{ node: 0 }];
    const issues = validateGraph(p.graph);
    expect(issues.map((i) => [i.code, i.severity])).toEqual([['G_ANCHOR_ROUND', 'warning']]);
  });

  it('validatePattern checks format and version', () => {
    const p = tiny() as unknown as Record<string, unknown>;
    p.format = 'x';
    p.version = '9';
    expect(validatePattern(p as unknown as Pattern).map((i) => i.code)).toEqual(['G_FORMAT', 'G_FORMAT']);
  });
});
