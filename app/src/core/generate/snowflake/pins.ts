/**
 * The blocking template's pins mapped onto stitches: `snowflakePins(result)` → `{node, x, y}` for
 * the 3D view's blocked solve (core/sim blocking with explicit pins). Coordinates are the template's
 * (mm, centre at the origin, first point straight up, y down); the solver aligns them to the piece.
 *
 * Arm-round stitches are matched to `shape.anchorPins` in working order:
 *  * an arm is `sc, <arm>, sc` worked into one place; its tip is the middle chain of the spine's tip
 *    loop (or the last stem chain when it has none; the picot of a pointed loop or a minor picot);
 *    trefoil side picots are the two picots straight after the tip; branch picots follow in pairs;
 *    within a pair the first picot worked lies on the side the round is worked towards, which is
 *    the template's "+" side (spine.ts places it there too);
 *  * a valley anchor is a lone sc;
 *  * each valley bridge (`ch k` space of the arm round) is pinned at its middle chain.
 * An element whose stitches do not match the template's (count mismatch) is left unpinned.
 */
import { paramsFor } from '../../params';
import { findSpines } from '../../sim/spine';
import type { SnowflakeResult } from './types';

export interface SnowPin { node: number; x: number; y: number; kind: 'tip' | 'branch' | 'valley' | 'minor' }

export function snowflakePins(res: Pick<SnowflakeResult, 'pattern' | 'shape'>): SnowPin[] {
  const pat = res.pattern;
  if (!pat) return [];
  const g = pat.graph;
  const r = g.rounds.length - 1;
  const rd = g.rounds[r];
  if (!rd || rd.first < 0) return [];
  const params = paramsFor(pat);
  const w = g.nodes.map((nd) => params.stitches[nd.countsAs ?? nd.type]?.width ?? 0);
  const h = g.nodes.map((nd) => params.stitches[nd.countsAs ?? nd.type]?.height ?? 0);
  const spines = findSpines(g, w, h, params.stitches.ch.width);
  const spineAt = new Map(spines.map((s) => [s.base, s]));
  const ids: number[] = [];
  for (let i = rd.first; i <= rd.last; i++) ids.push(i);
  const lower = (i: number) => {
    const nd = g.nodes[i];
    if (!nd.into.length || nd.type === 'slst' || nd.type === 'ch' || nd.type === 'picot') return false;
    return nd.into.every((a) => ('space' in a ? g.spaces[a.space].round < r : g.nodes[a.node].round < r));
  };
  const key = (i: number) => JSON.stringify(g.nodes[i].into);
  const anchors = ids.filter(lower);
  type Group = { open: number; interior: number[] };
  const groups: Group[] = [];
  for (let k = 0; k < anchors.length; k++) {
    const a = anchors[k], b = anchors[k + 1];
    if (b !== undefined && key(a) === key(b) && b - a > 1) {
      const interior: number[] = [];
      for (let i = a + 1; i < b; i++) interior.push(i);
      groups.push({ open: a, interior });
      k++;
    } else groups.push({ open: a, interior: [] });
  }
  const out: SnowPin[] = [];
  const els = res.shape.anchorPins;
  if (els.length !== groups.length) return [];
  els.forEach((el, q) => {
    const gr = groups[q];
    const push = (node: number, p: { x: number; y: number }, kind: SnowPin['kind']) => out.push({ node, x: p.x, y: p.y, kind });
    if (el.kind === 'valley') { if (!gr.interior.length) push(gr.open, el.tip, 'valley'); return; }
    const tipKind = el.kind === 'minor' ? 'minor' : 'tip';
    const sp = spineAt.get(gr.open);
    if (!sp) {
      const pic = gr.interior.find((i) => g.nodes[i].type === 'picot');
      if (pic !== undefined) push(pic, el.tip, tipKind);
      return;
    }
    const tipNode = sp.tip.length ? sp.tip[Math.floor(sp.tip.length / 2)] : sp.stem[sp.stem.length - 1];
    push(tipNode, el.tip, tipKind);
    const r1 = sp.tip.length ? sp.tip[sp.tip.length - 1] + 1 : -1;
    const sides = sp.picots.filter((p) => p === r1 + 1 || p === r1 + 2);
    const branches = sp.picots.filter((p) => !sides.includes(p));
    const pair = (nodes: number[], pts: { x: number; y: number }[], kind: SnowPin['kind']) => {
      if (nodes.length !== pts.length) return;
      // template pairs are [−, +]; the first picot worked of a pair is on the + side
      for (let i = 0; i + 1 < nodes.length; i += 2) { push(nodes[i], pts[i + 1], kind); push(nodes[i + 1], pts[i], kind); }
    };
    if (el.sides.length) pair(sides, el.sides, el.kind === 'minor' ? 'minor' : 'branch');
    pair(branches, el.branches, 'branch');
  });
  const inArm = new Set<number>();
  for (const gr of groups) for (const i of gr.interior) inArm.add(i);
  const bridges = g.spaces.filter((s) => s.kind === 'chsp' && s.round === r && !s.chains.some((c) => inArm.has(c)));
  if (bridges.length === res.shape.web.length) {
    bridges.forEach((s, q) => out.push({ node: s.chains[Math.floor(s.chains.length / 2)], x: res.shape.web[q].pin.x, y: res.shape.web[q].pin.y, kind: 'valley' }));
  }
  return out;
}

