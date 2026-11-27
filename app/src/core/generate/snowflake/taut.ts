/**
 * Small geometry helpers of the snowflake template: the network's course widths (N2) and the mean
 * radius of each round's stitch tops. (The body's blocked shape itself comes from the spring model:
 * bodypull.ts; docs/flatness_radius_note.md has the closed-form attempts and why they were dropped.)
 */
import type { Graph } from '../../graph';
import { stitchParam, type ParamSet } from '../../params';

export type V2 = [number, number];

const counting = (g: Graph, i: number) => {
  const nd = g.nodes[i];
  return !!nd.countsAs || (nd.role !== 'tch' && nd.type !== 'ch' && nd.type !== 'slst' && nd.type !== 'picot');
};

/** Course widths of the network (N2: a counts-as top occupies the course like X). */
export function courseWidths(g: Graph, params: ParamSet): number[] {
  return g.nodes.map((nd) => stitchParam(params, nd.countsAs ?? nd.type).width);
}

/** Mean radius of the stitch tops of each round 0..upto (taut). */
export function tautRoundRadii(g: Graph, pos: (V2 | null)[], upto: number): number[] {
  const out: number[] = [];
  for (let r = 0; r <= upto && r < g.rounds.length; r++) {
    const rd = g.rounds[r];
    let s = 0, k = 0;
    for (let i = rd.first; i <= rd.last; i++) if (counting(g, i) && pos[i]) { s += Math.hypot(pos[i]![0], pos[i]![1]); k++; }
    out.push(k ? s / k : 0);
  }
  return out;
}
