/**
 * Shape per region of a piece with an outline (rows, borders, polygons from the centre) — the
 * cup/ruffle metric of physics.md §5 assumes rounds round an axis, which a blanket does not have.
 * A line-by-line port of `crolab.regions.region_shape` (SPEC_NOTES "Per-region shape").
 *
 * The relaxed piece is compared with its own flat reference layout (outline.ts): the body's nodes
 * (the rows; for a polygon, the rounds inside the outline rounds) are fitted rigidly to their
 * reference positions (least-squares rotation + translation, the P9 frame), which gives the body's
 * plane and where every node "should" be. Then, with w̄ the mean stitch width and B the border's
 * width (sum of the outline rounds' heights):
 *
 *   body     curl  = RMS distance of the body nodes from the plane / their reference radius of gyration
 *                    → 'curling' when curl > REGION_TAU.body
 *   side q   (the outermost round's nodes between two corners)
 *            wave  = RMS of their out-of-plane offsets about the straight line fitted along the side, / w̄
 *            pull  = 1 − (in-plane length of the side) / (its reference length)
 *                    → 'puckers' when pull > REGION_TAU.pull (too few stitches pull the side in),
 *                      else 'waves' when wave > REGION_TAU.wave (too many buckle it), else 'flat'
 *   corner q (the outermost round's corner group)
 *            lift  = |mean out-of-plane offset of the corner group − that of the sides next to it| / B
 *            wave  = RMS of the corner group's out-of-plane offsets about their mean / w̄
 *                    → 'ruffle' when wave > REGION_TAU.wave, else 'cup' when lift > REGION_TAU.lift,
 *                      else 'flat'
 */
import { simConfig } from '../params';
import { npMean } from './detmath';
import type { Network } from './network';

export type SideClass = 'flat' | 'waves' | 'puckers';
export type CornerClass = 'flat' | 'cup' | 'ruffle';

export interface RegionSide { index: number; label: string; class: SideClass; wave: number; pull: number; excess: number; nodes: number }
export interface RegionCorner { index: number; label: string; class: CornerClass; lift: number; wave: number; perCorner: number; nodes: number }
export interface RegionReport {
  /** 'rows': rows (+ border); 'polygon': a polygon from the centre */
  kind: 'rows' | 'polygon';
  body: { class: 'flat' | 'curling'; curl: number };
  sides: RegionSide[];
  corners: RegionCorner[];
  /** worst of everything: 'flat' when every region is flat */
  overall: 'flat' | 'not flat';
}

export const REGION_TAU = { body: 0.1, wave: 0.3, pull: 0.04, lift: 0.3, excess: 0.02 } as const;
const TOL = simConfig.flatness.tol;

/** Labels of a blanket's sides in perimeter order (core/blanket/rect.ts edge checks). */
export const RECT_SIDE_LABELS = ['Top edge', 'Left side', 'Bottom edge', 'Right side'];
export const RECT_CORNER_LABELS = ['Top right', 'Top left', 'Bottom left', 'Bottom right'];

type V3 = [number, number, number];

/** Rigid fit X ≈ c + e1·qx + e2·qy over the nodes `ps` (affine fit, then Gram–Schmidt). */
function fitFrame(ps: number[], qx: ArrayLike<number>, qy: ArrayLike<number>, X: ArrayLike<number>): { c: V3; q0: [number, number]; e1: V3; e2: V3; nrm: V3 } | null {
  if (ps.length < 3) return null;
  const mx = npMean(ps.map((p) => qx[p])), my = npMean(ps.map((p) => qy[p]));
  const c: V3 = [npMean(ps.map((p) => X[3 * p])), npMean(ps.map((p) => X[3 * p + 1])), npMean(ps.map((p) => X[3 * p + 2]))];
  let sxx = 0, sxy = 0, syy = 0;
  const cx: V3 = [0, 0, 0], cy: V3 = [0, 0, 0];
  for (const p of ps) {
    const ux = qx[p] - mx, uy = qy[p] - my;
    sxx += ux * ux; sxy += ux * uy; syy += uy * uy;
    for (let d = 0; d < 3; d++) { const v = X[3 * p + d] - c[d]; cx[d] += v * ux; cy[d] += v * uy; }
  }
  const det = sxx * syy - sxy * sxy;
  if (!(det > 1e-9 * (sxx + syy) * (sxx + syy))) return null;
  const m1: V3 = [0, 0, 0], m2: V3 = [0, 0, 0];
  for (let d = 0; d < 3; d++) { m1[d] = (cx[d] * syy - cy[d] * sxy) / det; m2[d] = (cy[d] * sxx - cx[d] * sxy) / det; }
  const n1 = Math.sqrt(m1[0] ** 2 + m1[1] ** 2 + m1[2] ** 2);
  if (!(n1 > 0)) return null;
  const e1: V3 = [m1[0] / n1, m1[1] / n1, m1[2] / n1];
  const k = m2[0] * e1[0] + m2[1] * e1[1] + m2[2] * e1[2];
  const u: V3 = [m2[0] - k * e1[0], m2[1] - k * e1[1], m2[2] - k * e1[2]];
  const n2 = Math.sqrt(u[0] ** 2 + u[1] ** 2 + u[2] ** 2);
  if (!(n2 > 0)) return null;
  const e2: V3 = [u[0] / n2, u[1] / n2, u[2] / n2];
  const nrm: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return { c, q0: [mx, my], e1, e2, nrm };
}

const rms = (xs: number[]) => (xs.length ? Math.sqrt(xs.reduce((s, v) => s + v * v, 0) / xs.length) : 0);

/** Residuals of xs about the least-squares line in t. */
function detrend(t: number[], xs: number[]): number[] {
  const mt = npMean(t), mz = npMean(xs);
  let stt = 0, stz = 0;
  t.forEach((v, q) => { stt += (v - mt) * (v - mt); stz += (v - mt) * (xs[q] - mz); });
  const b = stt > 0 ? stz / stt : 0;
  return xs.map((v, q) => v - mz - b * (t[q] - mt));
}

export function regionShape(net: Network, X: ArrayLike<number>): RegionReport | null {
  const o = net.outline;
  if (!o) return null;
  const n = net.nNodes;
  const ok = (i: number) => o.has[i] === 1 && o.c[i] > 0 && Number.isFinite(X[3 * i]);
  /** stitch-counting (chain-space chains are slack yarn: no length of their own in the measures) */
  const counting = (i: number) => { const nd = net.graph.nodes[i]; return !!nd.countsAs || (nd.role !== 'tch' && nd.type !== 'ch' && nd.type !== 'slst' && nd.type !== 'picot'); };
  const rounds = [...o.courses.keys()].sort((a, b) => a - b);
  const lastR = rounds.length ? rounds[rounds.length - 1] : Infinity;
  // body: the rows (row pieces); the rounds inside the outermost one (polygons)
  const body: number[] = [];
  for (let i = 0; i < n; i++) if (ok(i) && (o.body ? o.region[i] === 1 : net.particleRound[i] < lastR)) body.push(i);
  const F = fitFrame(body, o.qx, o.qy, X);
  if (!F) return null;
  const z = (i: number) => (X[3 * i] - F.c[0]) * F.nrm[0] + (X[3 * i + 1] - F.c[1]) * F.nrm[1] + (X[3 * i + 2] - F.c[2]) * F.nrm[2];
  /** in-plane coordinates of node i in the reference frame */
  const inPlane = (i: number): [number, number] => {
    const d: V3 = [X[3 * i] - F.c[0], X[3 * i + 1] - F.c[1], X[3 * i + 2] - F.c[2]];
    return [d[0] * F.e1[0] + d[1] * F.e1[1] + d[2] * F.e1[2], d[0] * F.e2[0] + d[1] * F.e2[1] + d[2] * F.e2[2]];
  };
  const rg = Math.sqrt(npMean(body.map((i) => (o.qx[i] - F.q0[0]) ** 2 + (o.qy[i] - F.q0[1]) ** 2)));
  const curl = rg > 0 ? rms(body.map(z)) / rg : 0;
  const bodyCls: 'flat' | 'curling' = curl > REGION_TAU.body ? 'curling' : 'flat';
  const sides: RegionSide[] = [], corners: RegionCorner[] = [];
  const kind: RegionReport['kind'] = o.body ? 'rows' : 'polygon';
  const K = o.K;
  if (rounds.length && K >= 3) {
    const last = o.courses.get(rounds[rounds.length - 1])!;
    const outerQ = last.order.filter((i) => ok(i));
    const wbar = npMean(outerQ.map((i) => o.c[i]).filter((c) => c > 0));
    const B = rounds.reduce((s, r) => s + o.courses.get(r)!.h, 0);
    const d3 = (a: number, b: number) => Math.sqrt((X[3 * b] - X[3 * a]) ** 2 + (X[3 * b + 1] - X[3 * a + 1]) ** 2 + (X[3 * b + 2] - X[3 * a + 2]) ** 2);
    const d2 = (a: number, b: number) => Math.sqrt((o.qx[b] - o.qx[a]) ** 2 + (o.qy[b] - o.qy[a]) ** 2);
    /** stitch-to-stitch steps only (yarn neighbours): a slack chain space between two stitches has no length of its own */
    const along = (ns: number[]) => {
      let path = 0, ref = 0;
      for (let k = 1; k < ns.length; k++) if (ns[k] === ns[k - 1] + 1) { path += d3(ns[k - 1], ns[k]); ref += d2(ns[k - 1], ns[k]); }
      return { path, ref };
    };
    const sideZ = new Map<number, number>();
    for (let q = 0; q < K; q++) {
      // measured edge length against the reference, round by round: the worst round counts
      let excess = 0;
      for (const r of rounds) {
        const ns = o.courses.get(r)!.order.filter((i) => ok(i) && counting(i) && o.region[i] === 2 && o.regionIndex[i] === q);
        const { path, ref } = along(ns);
        const x = ref > 0 ? path / ref - 1 : 0;
        if (Math.abs(x) > Math.abs(excess)) excess = x;
      }
      const sn = outerQ.filter((i) => o.region[i] === 2 && o.regionIndex[i] === q);
      if (sn.length < 2) continue;
      const t: number[] = [0];
      for (let k = 1; k < sn.length; k++) t.push(t[k - 1] + d2(sn[k - 1], sn[k]));
      const zs = sn.map(z);
      sideZ.set(q, npMean(zs));
      const wave = rms(detrend(t, zs)) / wbar;
      const a = sn[0], b = sn[sn.length - 1];
      const pa = inPlane(a), pb = inPlane(b);
      const ref = d2(a, b);
      const pull = ref > 0 ? 1 - Math.sqrt((pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2) / ref : 0;
      const cls: SideClass = excess > REGION_TAU.excess && wave > REGION_TAU.wave ? 'waves'
        : excess < -REGION_TAU.excess && (pull > REGION_TAU.pull || wave > REGION_TAU.wave) ? 'puckers' : 'flat';
      sides.push({ index: q, label: kind === 'rows' && K === 4 ? RECT_SIDE_LABELS[q] : `Side ${q + 1}`, class: cls, wave, pull, excess, nodes: sn.length });
    }
    for (let q = 0; q < K; q++) {
      // cumulative corner growth against the reference (polygon rule), in stitches
      let E = 0, grown = 0, cnLast: number[] = [];
      for (const r of rounds) {
        const C = o.courses.get(r)!;
        const ord = C.order.filter((i) => ok(i) && counting(i));
        const idx = ord.map((i, k) => (o.region[i] === 3 && o.regionIndex[i] === q ? k : -1)).filter((k) => k >= 0);
        if (!idx.length) continue;
        const m = ord.length;
        const run = [ord[(idx[0] + m - 1) % m], ...idx.map((k) => ord[k]), ord[(idx[idx.length - 1] + 1) % m]];
        const { path, ref } = along(run);
        E += path - ref;
        const tp = C.poly.t[(q + K - 1) % K], tn = C.poly.t[q];
        const cr = Math.abs(tp[0] * tn[1] - tp[1] * tn[0]), dt = tp[0] * tn[0] + tp[1] * tn[1];
        grown += 1 + dt > 1e-12 ? (2 * C.h * cr) / (1 + dt) : 0;
        if (r === rounds[rounds.length - 1]) cnLast = idx.map((k) => ord[k]);
      }
      if (!cnLast.length) continue;
      const perCorner = E / wbar;
      const tolSt = Math.max(1, (TOL * grown) / wbar);
      const zs = cnLast.map(z);
      const mz = npMean(zs);
      const nb = [sideZ.get(q), sideZ.get((q + K - 1) % K)].filter((v): v is number => v !== undefined);
      const lift = B > 0 ? Math.abs(mz - (nb.length ? npMean(nb) : 0)) / B : 0;
      const wave = rms(zs.map((v) => v - mz)) / wbar;
      const cls: CornerClass = perCorner < -tolSt && lift > REGION_TAU.lift ? 'cup'
        : perCorner > tolSt && (wave > REGION_TAU.wave || lift > REGION_TAU.lift) ? 'ruffle' : 'flat';
      corners.push({ index: q, label: kind === 'rows' && K === 4 ? RECT_CORNER_LABELS[q] : `Corner ${q + 1}`, class: cls, lift, wave, perCorner, nodes: cnLast.length });
    }
  }
  const overall = bodyCls === 'flat' && sides.every((s) => s.class === 'flat') && corners.every((c) => c.class === 'flat') ? 'flat' : 'not flat';
  return { kind, body: { class: bodyCls, curl }, sides, corners, overall };
}
