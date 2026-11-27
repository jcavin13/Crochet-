/**
 * Where the arms start when the snowflake is blocked: the body pulled out by its arms, solved with
 * the spring model itself (docs/flatness_radius_note.md).
 *
 * The flatness rule hands each round on at r_k = ρ_k + ½·√(L² − d²) (a loop pulled into a V by one
 * stitch at its middle, on the arc 2πρ). For the snowflake template that was 6–17 % too large where
 * several stitches share a loop (double-pointed: `(2 dc, ch 2, 2 dc, ch 2, sc) in each ch-7`) and too
 * small where a loop under an arm is pulled to a point; closed-form corrections of it either
 * over-stretched some designs or left others slack (the table in the note). The honest answer is
 * the equilibrium of the same network the 3D view blocks:
 *
 *  * the pattern with a picot standing in for each arm (`(sc, picot, sc) in next sp`: the same
 *    stitches in the same places) is grown flat on the table (core/sim, table mode, loose tolerance);
 *  * the valley bridges are left out (they are sized from the result);
 *  * every stitch of the arm round worked into the body is pulled outwards (along its direction from
 *    the centre in the grown piece) with the force
 *    a pinned arm pulls with: a chain at block stretch (k_course · s_ch · (block_stretch − 1));
 *  * the in-plane equilibrium (L-BFGS) gives the arm-base and valley-stitch positions; where several
 *    arms pull through one loop and a thread would stretch beyond block stretch, the pull is eased
 *    in proportion (the weakest thread sets how hard the piece can be pinned) and solved again.
 *
 * It takes 5–50 ms per body (cached per body and arm layout), and the body is the only part that
 * needs it: arms, picots and bridges are placed from their reference layouts (geometry.ts).
 */
import type { Graph } from '../../graph';
import { simConfig, stitchParam, type ParamSet } from '../../params';
import { buildNetwork } from '../../sim/network';
import { Grower } from '../../sim/solve';
import { Lbfgs, springEnergy, type SpringSet } from '../../sim/lbfgs';
import type { V2 } from './taut';

/**
 * Positions (mm, centre of round 1 at the origin, round 1 counter-clockwise) of every node of rounds
 * 0..last after pulling each `pull` node outwards with its force; the chains of round `last`
 * (bridges) carry no force.
 */
export function pulledBody(g: Graph, params: ParamSet, pull: { node: number; force: number; group: number; reach: number }[]): (V2 | null)[] {
  const last = g.rounds.length - 1;
  const net = buildNetwork(g, params, simConfig);
  const n = net.nNodes;
  // bridges (chains of the arm round) carry nothing
  const bridge = new Uint8Array(net.nParticles);
  for (const s of g.spaces) if (s.kind === 'chsp' && s.round === last) for (const c of s.chains) bridge[c] = 1;
  for (let q = 0; q < net.m; q++) if (bridge[net.I[q]] || bridge[net.J[q]]) net.k[q] = 0;
  const gr = new Grower(net, simConfig, { table: true, gtolRound: 1e-3, gtolFinal: 1e-3, maxIter: 3000, maxIterFinal: 3000 });
  gr.planarOnly = true;
  gr.advance();
  const X0 = gr.planar ?? gr.X;
  const N = net.nParticles;
  const placed: number[] = [];
  for (let p = 0; p < N; p++) if (!Number.isNaN(X0[3 * p]) && !bridge[p]) placed.push(p);
  const idx = new Int32Array(N).fill(-1);
  placed.forEach((p, k) => { idx[p] = k; });
  const sel: number[] = [];
  for (let q = 0; q < net.m; q++) if (idx[net.I[q]] >= 0 && idx[net.J[q]] >= 0 && net.k[q] > 0) sel.push(q);
  const springs: SpringSet = {
    n: placed.length, m: sel.length,
    I: Int32Array.from(sel, (q) => idx[net.I[q]]), J: Int32Array.from(sel, (q) => idx[net.J[q]]),
    L: Float64Array.from(sel, (q) => net.L[q]), kL: Float64Array.from(sel, (q) => net.k[q] / net.L[q]),
    slack: Uint8Array.from(sel, (q) => net.slack[q]),
  };
  // centre: round 1
  const r0 = g.rounds[0];
  let cx = 0, cy = 0, k0 = 0;
  for (let i = r0.first; i <= r0.last; i++) if (idx[i] >= 0) { cx += X0[3 * i]; cy += X0[3 * i + 1]; k0++; }
  cx /= Math.max(1, k0); cy /= Math.max(1, k0);
  const pulledAll = pull.filter((p) => idx[p.node] >= 0);
  const pulled = pulledAll.map((p) => idx[p.node]);
  const force = pulledAll.map((p) => p.force);
  const x0 = new Float64Array(3 * placed.length);
  placed.forEach((p, k) => { x0[3 * k] = X0[3 * p] - cx; x0[3 * k + 1] = X0[3 * p + 1] - cy; x0[3 * k + 2] = 0; });
  // constant forces along each stitch's initial outward direction (they sum to zero for the n-fold
  // symmetric piece, so the piece does not drift)
  // each arm pulls its stitches towards its tip: a point `reach` out along the radial line through
  // the middle of its stitches (they converge on the arm, as in the pinned piece)
  const mid = new Map<number, [number, number, number]>();
  pulledAll.forEach((p, j) => { const k = pulled[j]; const m = mid.get(p.group) ?? [0, 0, 0]; m[0] += x0[3 * k]; m[1] += x0[3 * k + 1]; m[2]++; mid.set(p.group, m); });
  const dir = pulledAll.map((p, j) => {
    const k = pulled[j];
    const m = mid.get(p.group)!;
    const mx0 = m[0] / m[2], my0 = m[1] / m[2], rm = Math.hypot(mx0, my0) || 1;
    const tx = (mx0 / rm) * (rm + p.reach), ty = (my0 / rm) * (rm + p.reach);
    const X = tx - x0[3 * k], Y = ty - x0[3 * k + 1]; const r = Math.hypot(X, Y) || 1;
    return [X / r, Y / r];
  });
  // no net force (the round's seam makes the grown piece slightly lopsided): it would drift away
  dir.forEach((d, j) => { d[0] *= force[j]; d[1] *= force[j]; });
  const mx = dir.reduce((a, d) => a + d[0], 0) / Math.max(1, dir.length), my = dir.reduce((a, d) => a + d[1], 0) / Math.max(1, dir.length);
  for (const d of dir) { d[0] -= mx; d[1] -= my; }
  const fg = (x: Float64Array, gr_: Float64Array) => {
    let E = springEnergy(springs, x, gr_);
    for (let q = 2; q < gr_.length; q += 3) gr_[q] = 0;
    pulled.forEach((k, j) => {
      E -= x[3 * k] * dir[j][0] + x[3 * k + 1] * dir[j][1];
      gr_[3 * k] -= dir[j][0]; gr_[3 * k + 1] -= dir[j][1];
    });
    return E;
  };
  // pull as hard as the weakest thread allows: if a chain loop ends up stretched more than block
  // stretch (several arms pulling through one loop), ease the pull in proportion and solve again
  const strainMax = (x: Float64Array) => {
    let m = 0;
    for (let q = 0; q < springs.m; q++) {
      if (net.kind[sel[q]] > 1) continue;
      const a = 3 * springs.I[q], b = 3 * springs.J[q];
      const e = Math.hypot(x[a] - x[b], x[a + 1] - x[b + 1]) / springs.L[q] - 1;
      if (e > m && springs.L[q] >= stitchParam(params, 'ch').width * 0.99) m = e;
    }
    return m;
  };
  let scaleF = 1;
  let opt = new Lbfgs(fg, x0, { gtol: 1e-5, maxIter: 20000 });
  opt.run();
  const limit = simConfig.block_stretch - 1;
  for (let it = 0; it < 3; it++) {
    const m = strainMax(opt.x);
    if (m <= limit * 1.1) break;
    const f = limit / m;
    scaleF *= f;
    for (const d of dir) { d[0] *= f; d[1] *= f; }
    opt = new Lbfgs(fg, opt.x, { gtol: 1e-5, maxIter: 20000 });
    opt.run();
  }
  void scaleF;
  const out: (V2 | null)[] = new Array(n).fill(null);
  placed.forEach((p, k) => { if (p < n) out[p] = [opt.x[3 * k], opt.x[3 * k + 1]]; });
  return out;
}
