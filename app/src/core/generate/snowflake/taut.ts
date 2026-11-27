/**
 * The body of a snowflake pulled taut, as blocking pulls it (docs/flatness_radius_note.md).
 *
 * spec/flatness.md hands each round on at r_k = ρ_k + rise_k, where rise_k = ½·√(L² − d²) is the
 * apex of a chain loop pulled into a V by ONE stitch at its middle, standing on the arc 2πρ_k. That
 * is right for `sc in next sp, ch k` webs, but it overstates the radius where several stitches share
 * a loop (`(2 dc, ch 2, 2 dc) in next ch-7 sp`) — they spread along it, most of them low down — and
 * it ignores that a loop spans the straight chord between its feet, not the arc. Measured against
 * the pinned sim, the double-pointed preset's arms start 6–17 % inside the template.
 *
 * This construction replaces it for the snowflake geometry (not for core/flatness, which the doily
 * designer, the lab and the golden files depend on). It places every node of the compiled graph in
 * the plane, round by round, with the thread taut:
 *  * round 1: stitch tops on a circle of radius r_ring + h (chain ring of n chains at block stretch;
 *    magic ring: max(h, C/2π)), at angles by course position (N1's u);
 *  * a stitch worked into stitches: on the mean of its anchors, h further out (radially); stitches
 *    sharing one anchor spread sideways by w/2 (P5);
 *  * a stitch worked into a chain space: on the loop's taut polygon — the loop runs from the node
 *    before its chains to the node after (straight chord between them), its path (course rest
 *    lengths, chains × block_stretch) bent at the chains the members attach to (the network's anchor
 *    rule, physics.md §3 + SPEC_NOTES N7) with equal turning angles, i.e. the funicular shape of a
 *    loop pulled outwards equally at each attachment (a V for one stitch, an arc for many); h
 *    further out radially. Between the two sc either side of an arm the loop spans at most the
 *    width of the arm's foot (`together`);
 *  * nothing stretches but the chains (block_stretch): stitches keep their height.
 * Rounds are not forced onto circles: the construction is exact for the n-fold symmetric graph.
 */
import type { Graph } from '../../graph';
import { heightOf, simConfig, stitchParam, type ParamSet } from '../../params';
import { nodesInSpace, resolveAnchorParticles, seamSlipStitches } from '../../sim/network';
import { armBases, findPointedLoops } from '../../sim/spine';

export type V2 = [number, number];

const counting = (g: Graph, i: number) => {
  const nd = g.nodes[i];
  return !!nd.countsAs || (nd.role !== 'tch' && nd.type !== 'ch' && nd.type !== 'slst' && nd.type !== 'picot');
};

/** Course widths of the network (N2: a counts-as top occupies the course like X). */
export function courseWidths(g: Graph, params: ParamSet): number[] {
  return g.nodes.map((nd) => stitchParam(params, nd.countsAs ?? nd.type).width);
}

/**
 * Funicular polygon of a taut loop: path pieces `ell` (≥ 2) from A to B, bent with equal turning
 * angles, bulging to the side `out` (unit normal of the chord). Returns the inner vertices. If the
 * path is shorter than the chord, the vertices lie on the chord (the loop is over-stretched).
 */
export function funicular(A: V2, B: V2, ell: number[], away: V2): V2[] {
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const c = Math.hypot(dx, dy);
  const ex: V2 = c > 1e-9 ? [dx / c, dy / c] : [1, 0];
  let ey: V2 = [-ex[1], ex[0]];
  if (ey[0] * away[0] + ey[1] * away[1] < 0) ey = [-ey[0], -ey[1]];
  const S = ell.reduce((p, q) => p + q, 0);
  const pts: V2[] = [];
  if (S <= c * (1 + 1e-12)) {
    let acc = 0;
    for (let k = 0; k + 1 < ell.length; k++) { acc += ell[k]; const t = acc / S; pts.push([A[0] + t * dx, A[1] + t * dy]); }
    return pts;
  }
  const shape = (beta: number) => {
    let ss = 0, cc = 0;
    ell.forEach((l, i) => { ss += l * Math.sin(i * beta); cc += l * Math.cos(i * beta); });
    const th0 = Math.atan2(ss, cc);
    let x = 0, y = 0;
    const P: V2[] = [];
    ell.forEach((l, i) => { const th = th0 - i * beta; x += l * Math.cos(th); y += l * Math.sin(th); P.push([x, y]); });
    return { span: x, P };
  };
  let lo = 0, hi = Math.PI * 0.999;
  for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (shape(m).span > c) lo = m; else hi = m; }
  const { P } = shape((lo + hi) / 2);
  for (let k = 0; k + 1 < P.length; k++) pts.push([A[0] + P[k][0] * ex[0] + P[k][1] * ey[0], A[1] + P[k][0] * ex[1] + P[k][1] * ey[1]]);
  return pts;
}

/**
 * Positions (mm, centre at the origin, round 1 counter-clockwise) of the nodes of rounds 0..upto, taut.
 * `together`: sets of nodes worked into one space that the next round holds close together — the
 * two sc either side of an arm (`(sc, <arm>, sc) in next sp`) are at most `gap` apart (the arm's
 * foot: sc → first chain, the return row's height, last return stitch → sc): between their chains
 * the loop spans at most that (the rest hangs slack), so a long loop under an arm blocks to a
 * V-like point, a short one to the usual polygon.
 */
export function tautPositions(g: Graph, params: ParamSet, upto: number, stretch = simConfig.block_stretch, together: { nodes: number[]; gap: number }[] = []): (V2 | null)[] {
  const n = g.nodes.length;
  const pos: (V2 | null)[] = new Array(n).fill(null);
  const w0 = courseWidths(g, params);
  const w = g.nodes.map((nd, i) => (nd.type === 'ch' && !nd.countsAs ? w0[i] * stretch : w0[i]));
  const h = g.nodes.map((nd) => heightOf(params, nd));
  const chspOf = new Map<number, number>();
  for (const sp of g.spaces) if (sp.kind === 'chsp') for (const c of sp.chains) chspOf.set(c, sp.id);
  const anchors = resolveAnchorParticles(g, new Map(), seamSlipStitches(g, armBases(g, findPointedLoops(g, w0))));
  const loops = new Map<number, Map<number, V2> | null>();
  const groupOf = new Map<number, number>();
  together.forEach((set, k) => { for (const v of set.nodes) groupOf.set(v, k); });
  const radial = (p: V2, d: number): V2 => { const R = Math.hypot(p[0], p[1]) || 1; return [p[0] + (d * p[0]) / R, p[1] + (d * p[1]) / R]; };

  // round 0: on a circle, by course position
  const r0 = g.rounds[0];
  if (!r0 || r0.first < 0) return pos;
  const ring = g.spaces.find((sp) => sp.kind === 'ring');
  const rRing = ring && ring.chains.length ? (ring.chains.length * stitchParam(params, 'ch').width * stretch) / (2 * Math.PI) : 0;
  {
    const ids: number[] = [];
    for (let i = r0.first; i <= r0.last; i++) ids.push(i);
    const c = ids.map((i) => (counting(g, i) ? w[i] : chspOf.has(i) && g.spaces[chspOf.get(i)!].round === 0 ? w[i] : 0));
    const C = c.reduce((a, b) => a + b, 0) || 1;
    let cum = 0;
    ids.forEach((i, k) => {
      const u = (cum + c[k] / 2) / C;
      cum += c[k];
      if (!g.nodes[i].into.length) return;
      const R = rRing > 0 ? rRing + h[i] : Math.max(h[i], C / (2 * Math.PI));
      pos[i] = [R * Math.cos(2 * Math.PI * u), R * Math.sin(2 * Math.PI * u)];
    });
  }

  const loop = (sid: number): Map<number, V2> | null => {
    if (loops.has(sid)) return loops.get(sid)!;
    const ch = g.spaces[sid].chains;
    let a = ch[0] - 1, b = ch[ch.length - 1] + 1;
    while (a >= 0 && !pos[a]) a--;
    while (b < n && !pos[b]) b++;
    if (a < 0 || b >= n || !pos[a] || !pos[b]) { loops.set(sid, null); return null; }
    const path = [a, ...ch, b];
    const cum = [0];
    for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + 0.5 * (w[path[k - 1]] + w[path[k]]));
    // vertices: one per attachment chain; the members of one `together` set attach at their own
    // chains, but the loop between them is at most the width of those stitches side by side
    // (the arm between them holds them together; the rest of that stretch of loop hangs slack)
    type Vx = { at: number; members: number[]; set: number };
    const vs = new Map<string, Vx>();
    for (const m of nodesInSpace(g, sid)) {
      for (const p of anchors[m]) {
        if (!ch.includes(p)) continue;
        const key = `c${p}`;
        const v = vs.get(key) ?? { at: cum[path.indexOf(p)], members: [], set: groupOf.get(m) ?? -1 };
        v.members.push(m);
        vs.set(key, v);
      }
    }
    const V = [...vs.values()].sort((x, y) => x.at - y.at);
    const ell: number[] = [];
    let prev = 0, prevSet = -2;
    for (const v of V) {
      let piece = Math.max(0, v.at - prev);
      if (v.set >= 0 && v.set === prevSet) piece = Math.min(piece, together[v.set].gap);
      ell.push(piece);
      prev = v.at; prevSet = v.set;
    }
    ell.push(Math.max(0, cum[cum.length - 1] - prev));
    const A = pos[a]!, B = pos[b]!;
    const mid: V2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const pts = funicular(A, B, ell, mid);
    const out = new Map<number, V2>();
    V.forEach((v, k) => { for (const m of v.members) out.set(m, pts[k]); });
    loops.set(sid, out);
    return out;
  };

  for (let r = 1; r <= upto && r < g.rounds.length; r++) {
    const rd = g.rounds[r];
    if (rd.first < 0) continue;
    const runs = new Map<string, number[]>();
    for (let i = rd.first; i <= rd.last; i++) {
      const nd = g.nodes[i];
      if (!nd.into.length) continue;
      const pts: V2[] = [];
      for (const an of nd.into) {
        if ('node' in an) { const p = pos[an.node]; if (p) pts.push(p); continue; }
        if (g.spaces[an.space].kind !== 'chsp') continue;
        const L = loop(an.space);
        const v = L?.get(i);
        if (v) pts.push(v);
      }
      if (!pts.length) continue;
      const base: V2 = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
      pos[i] = radial(base, h[i]);
      if (nd.into.every((an) => 'node' in an)) {
        const key = JSON.stringify(nd.into);
        if (!runs.has(key)) runs.set(key, []);
        runs.get(key)!.push(i);
      }
    }
    for (const run of runs.values()) {
      if (run.length < 2) continue;
      const wb = run.reduce((s, i) => s + w[i], 0) / run.length;
      run.forEach((i, k) => {
        const p = pos[i]!;
        const R = Math.hypot(p[0], p[1]) || 1;
        const d = (k + 1 - (run.length + 1) / 2) * (wb / 2);
        pos[i] = [p[0] - (d * p[1]) / R, p[1] + (d * p[0]) / R];
      });
    }
  }
  return pos;
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
