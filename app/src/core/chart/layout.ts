/**
 * Round-by-round chart layout: stitch graph → positions of every symbol (pure, deterministic).
 *
 * Radial (doily) layout, per round in working order:
 *  1. Course items: every node that occupies room along the round (stitches, joins, chains of
 *     chain spaces, picots; a turning chain is one item). Ring chains, travelling slip stitches
 *     and the centre "hub" are placed separately.
 *  2. Desired angle of each item from what it is worked into: the anchor's angle for a node, the
 *     physics.md §3 chain (c_q) for a chain space, the circular mean for a decrease; round 1 into a
 *     ring is spread evenly by width. Items without anchors are interpolated between neighbours.
 *  3. Radius: the analytic flatness ρ (mm → sc-width units), pushed out where needed for a minimum
 *     gap to the previous round and so the round's symbols fit its circumference.
 *  4. Angles solved by ordered isotonic least squares (solve.ts): order kept, minimum spacing,
 *     closed rounds fit in one turn — fans (inc, shell, V) spread symmetrically round their anchor.
 *  5. Tops = anchor radius + stitch height (+ the round's push-out), so stems point outward and
 *     mixed-height rounds keep their shape; spiral rounds ramp up by one round over the turn.
 *  6. Chains of a chain space on a circular arc between the neighbouring symbols, bulging outward
 *     when the chain is longer than the chord; turning chains stacked radially; picots on top of the
 *     previous stitch; joins between the last and first stitch.
 *
 * Pointed rounds (snowflake arms, vintage pointed doilies), detected from the graph alone:
 *  - a spine is a chain run followed straight away by a stitch worked back into one of its chains
 *    ("sl st in 4th ch from hook"); everything worked into its chains (and into chain branches made
 *    on the way back) belongs to the arm. Chains beyond the highest chain worked into are the tip
 *    loop. A long chain loop with a picot at its top (ch ≥ 4, picot, ch ≥ 4, nothing worked into it
 *    in the round) is a pointed loop.
 *  - the whole arm takes one place on the course, at its base; after the course is solved it is laid
 *    straight out along the radius at that angle, one chain length (params) per chain, whatever the
 *    round's radius: stitches worked back sit beside their chain (one side), picots made on the way
 *    down are fronds at ±50° (alternating sides), the tip loop closes at the end, a cluster tip stands
 *    on it, a chain branch worked back along recurses at the branch angle. Chains between arms are
 *    ordinary arcs between the arms' base stitches. The round is flagged `pointed`, with its arms and
 *    a star-shaped outline (radius per angle) instead of the flatness ring; a later round attaches to
 *    the arms' real chain positions.
 *
 * Seam and symmetry (radial): a closed round of an n-fold piece (core/symmetry, cumulative order)
 * is laid out exactly n-fold — each solved position is averaged over its n copies; a counting
 * turning chain takes the room of the stitch it counts as; a loose turning chain and the join take
 * no room (tucked into the seam, the join's dot just before the stitch joined into); a stitch
 * worked into a chain space sits at the continuous c_q position (one sc in a ch-2 sp at the arch's
 * middle). Pointed rounds: valley bridges are drawn pinned out (a V to a pin), the round's
 * outline (`hull`) runs through the arm tips and the bridge pins.
 *
 * Rows (any `Row` round): the same machinery with x for the angle and height for the radius. Every
 * column is one stitch wide; an increase at a row's edge keeps the edge straight (the outermost
 * stitch on its anchor, the others leaning in) and the edge stitches hold, so fans spread inwards.
 *
 * Shapes (frames.ts — `opts.shapes`, default on), each still "a course and a height":
 *  - Border rounds of a body in rows (a `Rnd` after `Row`s, notation.md 3.9): the course runs round
 *    the body's rectangle at a distance (a rounded rectangle per round), so stitches on the top
 *    stand over the last row, row-end stitches beside their row (at its mid-height, pointing out),
 *    stitches in the foundation chain's unused loops below it (pointing down); corner groups (the
 *    compiler's corners, core/graph borderLists) are centred on the corner's bisector and fan round
 *    it. Tops are level per stitch height along a side. Row numbers move to the margin outside the
 *    border; border rounds are numbered R1, R2… at their start.
 *  - A piece worked round both sides of a foundation chain: the chain is a straight line and the
 *    rounds are stadiums round it.
 *  - A polygon worked from the centre (corners.ts: n corner groups, evenly spaced, round after
 *    round, sides between them): from its first cornered round each round is a regular n-gon with
 *    rounded corners (straight sides, corner groups fanned), height = distance from the centre to
 *    the side; the piece is turned so it sits on a side. Everything else stays a circle.
 */
import { analyzeFlatness, type RoundFlatness } from '../flatness';
import { childrenOf, type Graph, type Node } from '../graph';
import { heightOf, stitchParam, type ParamSet } from '../params';
import { analyzeSymmetry } from '../symmetry';
import { borderCornerGroups, detectPolygon, detectStadium } from './corners';
import { offsetFrame, regularCore, type FrameSpec, type OffsetFrame } from './frames';
import { solveOrdered } from './solve';
import { symbolOf } from './symbols';
import type { Bounds, ChartArm, ChartLayout, ChartNode, ChartNodeKind, ChartRound, ChartSpace, LayoutOptions, Pt } from './types';

const TAU = Math.PI * 2;

/** Display constants (chart units = sc widths). */
export const DIM = {
  stHalf: 0.32,
  clusterHalf: 0.42,
  tchHalf: 0.32,
  tchLooseHalf: 0.12,
  chHalf: 0.08,
  picotHalf: 0.14,
  joinHalf: 0.07,
  chainPitch: 0.58,
  chainEndPad: 0.26,
  tchPitch: 0.36,
  magicR: 0.32,
  minChainRingR: 0.5,
  hubR: 0.3,
} as const;

type ItemKind = 'st' | 'tch' | 'tchLoose' | 'ch' | 'join' | 'picot' | 'arm';
interface Item { ids: number[]; rep: number; kind: ItemKind; half: number; w: number; t: number }

interface Frame {
  pos(s: number, h: number): [number, number];
  height(x: number, y: number): number;
  course(x: number, y: number): number;
  out(x: number, y: number, s: number): [number, number];
}
/** Corner rounding of a polygon worked from the centre: corner arc radius / inradius at the round's top. */
export const POLY_RC = 0.2;
const radialFrame: Frame = {
  pos: (s, h) => [h * Math.cos(s), -h * Math.sin(s)],
  height: (x, y) => Math.hypot(x, y),
  course: (x, y) => Math.atan2(-y, x),
  out: (x, y, s) => {
    const r = Math.hypot(x, y);
    return r > 1e-9 ? [x / r, y / r] : [Math.cos(s), -Math.sin(s)];
  },
};
const rowFrame: Frame = {
  pos: (s, h) => [s, -h],
  height: (_x, y) => -y,
  course: (x) => x,
  out: () => [0, -1],
};

const mod = (a: number, m: number) => ((a % m) + m) % m;

export function layoutChart(graph: Graph, params: ParamSet, opts: LayoutOptions = {}): ChartLayout {
  const N = graph.nodes.length;
  const mode = opts.mode ?? (graph.rounds.some((r) => r.kind === 'row') ? 'rows' : 'radial');
  const radial = mode === 'radial';
  const baseF = radial ? radialFrame : rowFrame;
  // the frame of the round being laid out (offset / polygon rounds get their own)
  let F: Frame = baseF;
  // Shape of the piece beyond circles and rows (frames.ts):
  //  - border rounds of a piece worked in rows: round the body's rectangle;
  //  - a piece worked round both sides of a foundation chain: a stadium round the chain;
  //  - a polygon worked from the centre (corners unambiguous, corners.ts): concentric polygons.
  const shapes = opts.shapes !== false;
  const borderStart = !radial && shapes ? graph.rounds.findIndex((r, k) => k > 0 && r.kind === 'round' && graph.rounds[k - 1].kind === 'row') : -1;
  const stadium = radial && shapes && detectStadium(graph);
  const poly = radial && shapes && !stadium && opts.symmetric !== false ? detectPolygon(graph) : null;
  const cornerOfNode = new Map<number, number[]>(); // node id -> its corner group (border / polygon rounds)
  if (borderStart > 0) for (const groups of borderCornerGroups(graph).values()) for (const gr of groups) for (const id of gr) cornerOfNode.set(id, gr);
  if (poly) for (const groups of poly.groups.values()) for (const gr of groups) for (const id of gr) cornerOfNode.set(id, gr);
  let rect: FrameSpec | undefined; // the body's rectangle (border) / the chain (stadium)
  let polyPhase = NaN;
  const minGap = opts.minRoundGap ?? 0.8;
  const fill = opts.fill ?? 0.96;
  const start = opts.startAngle ?? Math.PI / 2;
  const unit = stitchParam(params, 'sc').width || 1;
  const hOf = (n: Node) => heightOf(params, n) / unit;
  const wRel = (n: Node) => stitchParam(params, n.type).width / unit;
  const flat = radial ? analyzeFlatness(graph, params) : undefined;
  // Rotational order of the piece up to each round (core/symmetry): a closed round of an n-fold
  // piece is laid out exactly n-fold (its seam — turning chain, join — tucked in without
  // displacing its neighbours).
  const symOrder = new Map<number, number>();
  if (radial && opts.symmetric !== false) {
    try {
      const rep = analyzeSymmetry(graph);
      if (rep.applicable) for (const r of rep.rounds) symOrder.set(r.round, r.cumulative ?? 1);
    } catch { /* no symmetry: lay out as solved */ }
  }

  // per-node state
  const X = new Float64Array(N), Y = new Float64Array(N); // reference point
  const TX = new Float64Array(N), TY = new Float64Array(N); // where the next round attaches
  const S = new Float64Array(N), H = new Float64Array(N), ramp = new Float64Array(N);
  const ROT = new Float64Array(N);
  const placed = new Uint8Array(N);
  const fan = new Uint8Array(N);
  const course = new Uint8Array(N);
  const kind: ChartNodeKind[] = new Array(N).fill('stitch');
  const role: (ChartNode['role'] | undefined)[] = new Array(N);
  const legs: Pt[][] = Array.from({ length: N }, () => []);
  const armRole: ChartNode['arm'][] = new Array(N);
  const gScale = new Float64Array(N).fill(1);
  // chain length along an arm (spines are laid out at their real length, not on the round's circle)
  const pitch = Math.min(0.9, Math.max(0.55, stitchParam(params, 'ch').width / unit || DIM.chainPitch));

  const place = (id: number, x: number, y: number, rot: number, tx = x, ty = y) => {
    X[id] = x; Y[id] = y; TX[id] = tx; TY[id] = ty; ROT[id] = rot; placed[id] = 1;
    H[id] = F.height(tx, ty);
  };

  // spaces
  const chainSpace = new Int32Array(N).fill(-1);
  for (const s of graph.spaces) for (const c of s.chains) if (c >= 0 && c < N) chainSpace[c] = s.id;
  const kids = childrenOf(graph);
  // physics.md §3 attachment, counting the stitches worked into a space; slip stitches that only
  // travel through it are counted separately so they do not shift the stitches.
  const isSl = (id: number) => graph.nodes[id].type === 'slst';
  const spaceSt = kids.spaces.map((ids) => ids.filter((id) => !isSl(id)));
  const spaceSl = kids.spaces.map((ids) => ids.filter(isSl));
  const posInSpace: Map<number, number>[] = kids.spaces.map((_, s) => new Map([
    ...spaceSt[s].map((id, j) => [id, j + 1] as [number, number]),
    ...spaceSl[s].map((id, j) => [id, j + 1] as [number, number]),
  ]));
  const ringR = new Float64Array(graph.spaces.length);
  for (const s of graph.spaces) {
    if (s.kind !== 'ring') continue;
    ringR[s.id] = s.chains.length ? Math.max(DIM.minChainRingR, (s.chains.length * DIM.chainPitch) / TAU) : DIM.magicR;
  }
  // Stitches worked into a space one after another (a shell written out, "3 dc in sp") or as one
  // compound (shell, V, inc) fan from one chain: the mean of their physics.md c_q positions.
  const fanJ = new Map<number, number>(); // node id -> effective j
  spaceSt.forEach((list, sid) => {
    let cluster: number[] = [];
    const flush = () => {
      if (!cluster.length) return;
      const mj = cluster.reduce((a, id) => a + (posInSpace[sid].get(id) ?? 1), 0) / cluster.length;
      for (const id of cluster) fanJ.set(id * 0x10000 + sid, mj);
      cluster = [];
    };
    for (const id of list) {
      const prev = cluster[cluster.length - 1];
      const g = graph.nodes[id].group, pg = prev !== undefined ? graph.nodes[prev].group : undefined;
      const together = prev !== undefined && (id === prev + 1 || (g && pg && g.kind === pg.kind && g.id === pg.id));
      if (!together) flush();
      cluster.push(id);
    }
    flush();
  });
  const firstRing = graph.spaces.find((s) => s.kind === 'ring');
  const ringSpaces = graph.spaces.filter((s) => s.kind === 'ring');
  const placedScan = { upto: 0, any: false };
  const hub = new Uint8Array(N);

  // Anchor point of leg `leg` of node n; `atS` = course coordinate for ring / hub legs.
  type LegPt = { x: number; y: number; ramp: number; resolved: boolean } | null;
  const legPoint = (n: Node, leg: number, atS: number | undefined): LegPt => {
    const a = n.into[leg];
    if (!a) return null;
    if ('node' in a) {
      const t = a.node;
      if (t < 0 || t >= N) return null;
      if (hub[t]) {
        if (atS === undefined) return null;
        const [x, y] = F.pos(atS, DIM.hubR);
        return { x, y, ramp: 0, resolved: false };
      }
      if (!placed[t]) return null;
      if (rect) {
        // a row end: beside the row, at its mid-height, on the body's edge; the unused loop of a
        // foundation chain: just under the chain (so it belongs to the bottom side)
        if (a.part === 'side') { const p = rowEndPoint(t); return { x: p.x, y: p.y, ramp: 0, resolved: true }; }
        if (graph.nodes[t].type === 'ch' && graph.nodes[t].round === 0 && stadium) {
          // the chains at the ends of the core: round the end (the corner's bisector); else the top
          // loops above the chain, the unused loops below it
          const c = rect.core;
          if (Math.abs(TX[t] - c[0].x) < 1e-6) return { x: TX[t] - 0.02, y: TY[t], ramp: 0, resolved: true };
          if (Math.abs(TX[t] - c[1].x) < 1e-6) return { x: TX[t] + 0.02, y: TY[t], ramp: 0, resolved: true };
          return { x: TX[t], y: TY[t] + (a.part === 'base' ? 0.02 : -0.02), ramp: 0, resolved: true };
        }
        if (a.part === 'base') return { x: TX[t], y: TY[t] + 0.02, ramp: 0, resolved: true };
      }
      return { x: TX[t], y: TY[t], ramp: ramp[t], resolved: true };
    }
    const sp = graph.spaces[a.space];
    if (!sp) return null;
    if (sp.kind === 'ring') {
      if (atS === undefined) return null;
      const [x, y] = F.pos(atS, ringR[sp.id]);
      return { x, y, ramp: 0, resolved: false };
    }
    const nCh = sp.chains.length;
    if (!nCh) return null;
    const m = (n.type === 'slst' ? spaceSl : spaceSt)[sp.id].length;
    const j = fanJ.get(n.id * 0x10000 + sp.id) ?? posInSpace[sp.id].get(n.id) ?? 1;
    // physics.md §3 attachment c_q, drawn at its continuous position: one stitch in a ch-2 space sits
    // at the middle of the arch, not on its second chain (which would skew an n-fold round)
    const qf = Math.min(nCh, Math.max(1, (j * (nCh + 1)) / (m + 1)));
    const q0 = Math.floor(qf), q1 = Math.min(nCh, q0 + 1), f = qf - q0;
    const c0 = sp.chains[q0 - 1], c1 = sp.chains[q1 - 1];
    if (!placed[c0] || !placed[c1]) return null;
    return { x: X[c0] + (X[c1] - X[c0]) * f, y: Y[c0] + (Y[c1] - Y[c0]) * f, ramp: ramp[c0] + (ramp[c1] - ramp[c0]) * f, resolved: true };
  };

  /** Row end of the row whose edge stitch is t (border rounds): on the body's edge, at the row's mid-height. */
  const rowEndPoint = (t: number): Pt => {
    const R = roundsOut[graph.nodes[t].round];
    const core = rect!.core;
    const xL = Math.min(...core.map((p) => p.x)), xR = Math.max(...core.map((p) => p.x));
    const x = X[t] < (xL + xR) / 2 ? xL : xR;
    const y = R ? -(R.r0 + R.r) / 2 : Y[t];
    return { x, y };
  };
  const spacesOut: ChartSpace[] = [];
  const roundsOut: ChartRound[] = [];
  let prevTop = firstRing ? ringR[firstRing.id] : 0;
  let prevDir: 1 | -1 = 1;
  const ringPlaced = new Set<number>();

  // Flatness ρ without the loop rise of the previous round: the drawn arcs model that rise.
  const flatTarget = (k: number) => {
    const fl = flat?.rounds[k];
    if (!fl || fl.class === 'n/a') return 0;
    const pr = k > 0 ? flat!.rounds[k - 1] : undefined;
    const rise = pr && pr.class !== 'n/a' ? Math.max(0, pr.r - pr.rho) : 0;
    return fl.rho - rise;
  };

  /** Outer outline of a pointed round: per angle, the furthest symbol, falling off sideways (a star hull). */
  const outlineOf = (ids: number[], rBase: number): number[] => {
    const pts: [number, number][] = [];
    for (const id of ids) {
      if (!placed[id]) continue;
      let x = X[id], y = Y[id];
      if (kind[id] === 'picot') { const e = (gScale[id] > 1 ? 2.5 : 2) * picotRadius(graph.nodes[id]) * gScale[id]; x += Math.cos(ROT[id]) * e; y += Math.sin(ROT[id]) * e; }
      pts.push([Math.atan2(-y, x), Math.hypot(x, y) + 0.35]);
    }
    const out: number[] = [];
    for (let i = 0; i < OUTLINE_N; i++) {
      const th = (TAU * i) / OUTLINE_N;
      let r = rBase + 0.35;
      for (const [a, rr] of pts) {
        const d = Math.abs(mod(th - a + Math.PI, TAU) - Math.PI);
        r = Math.max(r, rr - OUTLINE_SLOPE * rr * d);
      }
      out.push(Math.round(r * 1000) / 1000);
    }
    return out;
  };

  for (const R of graph.rounds) {
    const k = R.index;
    const fl: RoundFlatness | undefined = flat?.rounds[k];
    const first = R.first, last = R.last;
    const emptyBounds: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    if (first < 0) {
      roundsOut.push({
        index: k, label: R.label, short: shortLabel(R.label), kind: R.kind, r: prevTop, r0: prevTop, rOuter: prevTop,
        dir: prevDir, joined: !!R.joined, labelAt: { x: 0, y: 0 }, first, last, bounds: emptyBounds, flat: fl, spiral: 0, s0: start,
      });
      continue;
    }
    const ids: number[] = [];
    for (let i = first; i <= last; i++) ids.push(i);

    // --- the round's frame
    const isBorder = borderStart > 0 && k >= borderStart && R.kind === 'round';
    const isStad = stadium && k >= 1;
    const isPoly = !!poly && k >= poly.from;
    /** closed round on a course (circle, polygon, rounded rectangle, stadium) */
    const closed = radial || isBorder;
    /** centre-based round (rings, hubs, arms, symmetry, spirals, the flatness radius) */
    const circular = radial && !isStad;
    let OF: OffsetFrame | null = null;
    if (stadium && k === 0) {
      // the foundation chain of a piece worked round both its sides: a straight line, one stitch
      // width per chain, the hook end on the right
      const m = ids.length;
      ids.forEach((id, j) => {
        const x = j - (m - 1) / 2;
        place(id, x, 0, 0); kind[id] = 'chain'; S[id] = x; course[id] = 1;
      });
      // the core runs between the end chains round 1 works into (not a skipped chain at the hook end)
      let lo = Infinity, hi = -Infinity;
      const R1 = graph.rounds[1];
      for (let id = R1.first; id >= 0 && id <= R1.last; id++) for (const an of graph.nodes[id].into) if ('node' in an && an.node >= first && an.node <= last) { lo = Math.min(lo, an.node); hi = Math.max(hi, an.node); }
      if (!(hi > lo)) { lo = first; hi = last; }
      const x0 = X[lo], x1 = X[hi];
      rect = { kind: 'offset', core: [{ x: x0, y: 0 }, { x: x1, y: 0 }], a: 0 };
      const b = emptyB();
      for (const id of ids) growPt(b, X[id], Y[id], 0.45);
      roundsOut.push({
        index: k, label: R.label, short: shortLabel(R.label), kind: R.kind, r: 0, r0: 0, rOuter: 0.2,
        dir: 1, joined: !!R.joined, labelAt: { x: x0 - 0.9, y: 0 }, first, last, bounds: b, flat: fl, spiral: 0, s0: start, frame: rect,
      });
      prevTop = 0; prevDir = 1;
      continue;
    }
    if (isBorder && !rect) {
      // the body's rectangle: everything worked so far
      let xL = Infinity, xR = -Infinity, yT = Infinity, yB = -Infinity;
      for (let id = 0; id < first; id++) {
        if (!placed[id]) continue;
        for (const [x, y] of [[X[id], Y[id]], [TX[id], TY[id]]]) { xL = Math.min(xL, x); xR = Math.max(xR, x); yT = Math.min(yT, y); yB = Math.max(yB, y); }
      }
      if (!Number.isFinite(xL)) { xL = 0; xR = 1; yT = -1; yB = 0; }
      rect = { kind: 'offset', core: [{ x: xL, y: yB }, { x: xR, y: yB }, { x: xR, y: yT }, { x: xL, y: yT }], a: 0 };
      prevTop = 0;
    }
    if (isBorder || isStad) {
      OF = offsetFrame(rect!, prevTop + 0.5);
      F = OF;
    } else if (isPoly) {
      if (Number.isNaN(polyPhase)) {
        // the corners stand over the anchors of this round's corner groups
        const n = poly!.n;
        let cx = 0, cy = 0;
        for (const gr of poly!.groups.get(k) ?? []) {
          const nd = graph.nodes[gr[Math.floor(gr.length / 2)]];
          const p = legPoint(nd, 0, undefined);
          if (!p) continue;
          const a = Math.atan2(-p.y, p.x) * n;
          cx += Math.cos(a); cy += Math.sin(a);
        }
        polyPhase = cx || cy ? Math.atan2(cy, cx) / n : start;
      }
      const a0 = Math.max(0.05, prevTop * (1 - POLY_RC));
      OF = offsetFrame({ kind: 'offset', core: regularCore(poly!.n, a0, polyPhase), a: a0 }, Math.max(0.05, prevTop * POLY_RC));
      F = OF;
    } else F = baseF;
    /** Course length (in s units) of a length d along the round at height r. */
    const lenC = (d: number, r: number) => (OF ? (TAU * d) / OF.circ(r) : d / r);

    // --- ring chains of rings made in this round
    for (const sp of ringSpaces) {
      if (sp.kind !== 'ring' || sp.round !== k || ringPlaced.has(sp.id) || !sp.chains.length) continue;
      ringPlaced.add(sp.id);
      const n = sp.chains.length;
      const r0 = ringR[sp.id];
      sp.chains.forEach((c, j) => {
        const s = start + (TAU * (j + 0.5)) / n;
        const [x, y] = F.pos(s, r0);
        place(c, x, y, tangentRot(F, x, y, s, closed));
        S[c] = s; kind[c] = 'ringch';
      });
      const ring = { x: 0, y: 0 };
      spacesOut.push({ id: sp.id, round: k, kind: 'ring', d: circlePath(ring.x, ring.y, r0), apex: r0 });
    }
    for (const sp of ringSpaces) {
      if (sp.kind === 'ring' && sp.round === k && !sp.chains.length && !ringPlaced.has(sp.id)) {
        ringPlaced.add(sp.id);
        spacesOut.push({ id: sp.id, round: k, kind: 'ring', d: circlePath(0, 0, ringR[sp.id]), apex: ringR[sp.id] });
      }
    }

    // --- hub chains (centre of "ch 2, 6 sc in 2nd ch from hook")
    let anyPlacedBefore = false;
    if (first > 0) {
      // (placed nodes before this round, ring chains aside: scanned from where the last scan stopped)
      if (placedScan.any) anyPlacedBefore = true;
      else {
        for (let i = placedScan.upto; i < first; i++) if (placed[i] && kind[i] !== 'ringch') { placedScan.any = true; break; }
        placedScan.upto = first;
        anyPlacedBefore = placedScan.any;
      }
    }
    if (!anyPlacedBefore) {
      for (const id of ids) {
        const n = graph.nodes[id];
        if (n.type !== 'ch' || n.role === 'tch' || chainSpace[id] >= 0) continue;
        if (kids.nodes[id].some((c) => graph.nodes[c].round === k && graph.nodes[c].type !== 'slst')) {
          hub[id] = 1; kind[id] = 'chain';
        }
      }
      const hubs = ids.filter((id) => hub[id]);
      hubs.forEach((id, j) => {
        const s = start + (TAU * j) / Math.max(1, hubs.length);
        const [x, y] = hubs.length > 1 ? F.pos(s, 0.15) : [0, 0];
        place(id, x, y, 0); S[id] = s;
      });
    }

    // --- arms: chain spines worked back along, long chain loops with a picot at the top
    const arms: ArmInfo[] = circular && anyPlacedBefore ? detectArms(graph, k, first, last, kids.nodes, hub) : [];
    const armAt = new Int32Array(last - first + 1).fill(-1);
    const armItem: number[] = arms.map(() => -1);
    arms.forEach((a, i) => { for (let id = a.first; id <= a.last; id++) armAt[id - first] = i; });

    // --- classify + build items
    const items: Item[] = [];
    const itemOf = new Int32Array(last - first + 1).fill(-1);
    const travel: number[] = [];
    const ringJoins: number[] = [];
    let run: number[] | null = null;
    const flushRun = (counting: boolean) => {
      if (!run) return;
      const rep = run[run.length - 1];
      const ca = graph.nodes[rep].countsAs;
      // a counting turning chain stands in for its stitch: it takes that stitch's room
      // (rows: every column is one stitch wide, as charts draw them — a dc row is as wide as the
      // chain it is worked on)
      const cHalf = ca ? DIM.stHalf * (closed ? Math.max(1, stitchParam(params, ca).width / unit) : 1) : DIM.tchHalf;
      items.push({
        ids: run, rep, kind: counting ? 'tch' : 'tchLoose',
        half: counting ? cHalf : DIM.tchLooseHalf, w: counting ? 1 : 0.05, t: NaN,
      });
      for (const id of run) itemOf[id - first] = items.length - 1;
      run = null;
    };
    for (const id of ids) {
      const n = graph.nodes[id];
      if (n.type === 'ch' && n.role === 'tch') {
        kind[id] = 'tch';
        (run ??= []).push(id);
        if (n.countsAs) flushRun(true);
        continue;
      }
      flushRun(false);
      const ai = armAt[id - first];
      if (ai >= 0) {
        // the whole arm takes one place on the course, at its base
        if (armItem[ai] < 0) {
          items.push({ ids: [id], rep: id, kind: 'arm', half: arms[ai].kind === 'loop' ? 0.42 : 0.34, w: 0.03, t: NaN });
          armItem[ai] = items.length - 1;
        }
        itemOf[id - first] = armItem[ai];
        continue;
      }
      if (kind[id] === 'ringch' || hub[id]) continue;
      const push = (it: Omit<Item, 'ids' | 'rep' | 't'>) => {
        items.push({ ids: [id], rep: id, t: NaN, ...it });
        itemOf[id - first] = items.length - 1;
      };
      if (n.type === 'ch') { kind[id] = 'chain'; push({ kind: 'ch', half: DIM.chHalf, w: 0.03 }); continue; }
      if (n.type === 'picot') { kind[id] = 'picot'; push({ kind: 'picot', half: DIM.picotHalf * Math.sqrt((n.chains ?? 3) / 3), w: 0.03 }); continue; }
      if (n.type === 'slst') {
        kind[id] = 'slst';
        const a = n.into[0];
        if (a && 'node' in a && graph.nodes[a.node]) {
          const t = graph.nodes[a.node];
          if (kind[a.node] === 'ringch') { role[id] = 'ringjoin'; ringJoins.push(id); continue; }
          if (t.round === k) { role[id] = 'join'; push({ kind: 'join', half: DIM.joinHalf, w: 0.2 }); continue; }
        }
        role[id] = 'travel'; travel.push(id);
        continue;
      }
      kind[id] = 'stitch';
      const legsN = n.into.length;
      const half = n.tag === 'cluster' || n.type === 'popcorn' || n.type === 'puff'
        ? Math.max(DIM.clusterHalf, DIM.stHalf * wRel(n)) : DIM.stHalf * (closed ? Math.max(1, wRel(n)) : 1) * (legsN > 2 ? 1.1 : 1);
      push({ kind: 'st', half, w: 1 });
    }
    flushRun(false);

    // --- stitches sharing an anchor (fans)
    {
      const cnt = new Map<string, number>();
      const keyOf = (id: number) => { const a = graph.nodes[id].into[0]; return a ? ('node' in a ? `n${a.node}` : `s${a.space}`) : ''; };
      for (const it of items) if (it.kind === 'st') { const kk = keyOf(it.rep); if (kk) cnt.set(kk, (cnt.get(kk) ?? 0) + 1); }
      for (const it of items) if (it.kind === 'st' && (cnt.get(keyOf(it.rep)) ?? 0) >= 2) fan[it.rep] = 1;
    }

    // --- direction
    let dir: 1 | -1 = radial ? (k === 0 || roundsOut.length === 0 ? 1 : (R.turned ? (-prevDir as 1 | -1) : prevDir)) : 1;

    // --- desired positions from anchors
    const rawLegCourse = (n: Node): number[] => {
      const out: number[] = [];
      for (let l = 0; l < n.into.length; l++) {
        const p = legPoint(n, l, undefined);
        if (p && p.resolved) {
          // the first border round's top: stitches of the last row are on the top edge, however low
          // they stand below the row's tallest (a sc beside a bobble)
          const a = n.into[l];
          if (isBorder && k === borderStart && 'node' in a && !a.part && graph.nodes[a.node]?.round === k - 1) {
            const yTop = Math.min(...rect!.core.map((q) => q.y));
            out.push(F.course(p.x, Math.min(p.y, yTop - 1e-3)));
          } else out.push(F.course(p.x, p.y));
        } else {
          const a = n.into[l];
          if ('node' in a && graph.nodes[a.node]?.round === k) {
            const ii = itemOf[a.node - first];
            if (ii >= 0 && Number.isFinite(items[ii].t)) out.push(items[ii].t);
          }
        }
      }
      return out;
    };
    let resolvedLegs = 0;
    for (const it of items) {
      if (it.kind !== 'st' && it.kind !== 'tch') continue;
      const n = graph.nodes[it.rep];
      for (let l = 0; l < n.into.length; l++) { const p = legPoint(n, l, undefined); if (p?.resolved) resolvedLegs++; }
    }
    const central = resolvedLegs === 0;

    // a round of chains only (foundation chain): chains are the base of the next row, space them like stitches
    if (!items.some((it) => it.kind !== 'ch' && it.kind !== 'tchLoose')) for (const it of items) if (it.kind === 'ch') it.half = DIM.stHalf;
    const lin = (it: Item) => 2 * it.half;
    const totalLin = items.reduce((a, it) => a + lin(it), 0);
    // natural radii (before the round's push-out) of the stitches, needed for ρ
    const stItems = items.filter((it) => it.kind === 'st' || it.kind === 'tch');
    const legH = (n: Node): { h: number; inh: number; maxH: number } => {
      let sh = 0, si = 0, cnt = 0, maxH = 0;
      for (let l = 0; l < n.into.length; l++) {
        const p = legPoint(n, l, start);
        if (!p) continue;
        const h = F.height(p.x, p.y);
        sh += h; si += p.ramp; cnt++; maxH = Math.max(maxH, h);
      }
      if (!cnt) return { h: prevTop, inh: 0, maxH: prevTop };
      return { h: sh / cnt, inh: si / cnt, maxH };
    };
    let natSum = 0;
    for (const it of stItems) { const n = graph.nodes[it.rep]; const b = legH(n); natSum += b.h - b.inh + hOf(n); }
    const meanNat = stItems.length ? natSum / stItems.length : prevTop + 0.5;
    let rho: number;
    if (isPoly) {
      // a polygon of inradius h has a course κ·2πh long
      const n = poly!.n;
      const kap = (2 * n * (1 - POLY_RC) * Math.tan(Math.PI / n)) / TAU + POLY_RC;
      rho = Math.max(meanNat, prevTop + minGap, totalLin / (TAU * fill * kap), arms.length ? 0 : flatTarget(k) / unit / kap);
    } else if (OF) {
      // round a rectangle / a chain: the core's perimeter plus the corner arcs
      rho = Math.max(meanNat, prevTop + minGap, (totalLin / fill - OF.circ(0)) / TAU);
    } else if (radial) {
      // a pointed round's arms stand off the circle: its flatness radius (which counts every chain of
      // the arms as circumference) does not apply
      rho = Math.max(meanNat, prevTop + minGap, totalLin / (TAU * fill), arms.length ? 0 : flatTarget(k) / unit);
    } else {
      rho = Math.max(meanNat, prevTop + minGap);
    }
    // the round's final frame: corner arcs measured at its top
    if (isPoly) {
      const a0 = rho * (1 - POLY_RC);
      OF = offsetFrame({ kind: 'offset', core: regularCore(poly!.n, a0, polyPhase), a: a0 }, rho * POLY_RC);
      F = OF;
    } else if (OF) {
      OF = offsetFrame(rect!, rho);
      F = OF;
    }
    // Push-out beyond the natural radius, shared in proportion to stitch height (a sc in a valley
    // stays short while the tall stitches of the round reach the round's radius).
    const hMean = stItems.length ? stItems.reduce((a, it) => a + hOf(graph.nodes[it.rep]), 0) / stItems.length : 1;
    const kappa = 1 + Math.max(0, rho - meanNat) / Math.max(0.3, hMean);

    if (central) {
      // spread evenly by width: round 1 into a ring, foundation chain
      let cum = 0;
      const tot = items.reduce((a, it) => a + (it.kind === 'join' || it.kind === 'tchLoose' ? 0 : lin(it)), 0);
      for (const it of items) {
        const half = it.kind === 'join' || it.kind === 'tchLoose' ? 0 : it.half;
        const c = cum + half;
        it.t = closed ? start + (dir * TAU * c) / Math.max(tot, 1e-9) : c;
        it.w = 1;
        cum += 2 * half;
      }
    } else {
      for (const it of items) {
        if (it.kind === 'st' || it.kind === 'tch') {
          const a = rawLegCourse(graph.nodes[it.rep]);
          if (a.length) it.t = closed ? circMean(a) : a.reduce((x, y) => x + y, 0) / a.length;
        }
      }
      if (!closed) {
        // direction of a row from its anchors
        const fin = items.filter((it) => Number.isFinite(it.t));
        if (fin.length >= 2 && Math.abs(fin[fin.length - 1].t - fin[0].t) > 1e-6) dir = fin[fin.length - 1].t > fin[0].t ? 1 : -1;
        else dir = (-prevDir) as 1 | -1;
        // Stitches worked into the first (last) stitch of a row ("ch 3, dc in same st", "2 dc in
        // last st"): the edge stays straight — the outermost stands on its anchor, the others lean
        // in, as charts draw an edge increase (a fan centred on the anchor would push the edge out
        // half a stitch every row).
        const keyOf = (id: number) => { const a = graph.nodes[id].into[0]; return a ? ('node' in a ? `n${a.node}` : `s${a.space}`) : ''; };
        const stIdx = items.map((it, i) => ((it.kind === 'st' || it.kind === 'tch') && Number.isFinite(it.t) ? i : -1)).filter((i) => i >= 0);
        const straighten = (list: number[], sign: number) => {
          if (list.length < 3) return;
          const k0 = keyOf(items[list[0]].rep);
          if (!k0) return;
          let m = 1;
          while (m < list.length && keyOf(items[list[m]].rep) === k0) m++;
          if (m < 2 || m === list.length) return;
          let off = 0;
          for (let j = 1; j < m; j++) { off += items[list[j - 1]].half + items[list[j]].half; items[list[j]].t = items[list[0]].t + sign * dir * off; }
        };
        straighten(stIdx, 1);
        straighten([...stIdx].reverse(), -1);
        // and the edges hold: what the row adds inside (fans) spreads inwards, not off the edge
        if (stIdx.length >= 3) { items[stIdx[0]].w = 25; items[stIdx[stIdx.length - 1]].w = 25; }
      }
      if (OF && OF.corners >= 3) {
        // corner groups fan round their corner: centred on the corner's bisector
        for (const it of items) {
          if (it.kind !== 'st' || !cornerOfNode.has(it.rep)) continue;
          const p = legPoint(graph.nodes[it.rep], 0, undefined);
          if (!p) continue;
          const c = OF.nearestCorner(p.x, p.y);
          it.t = OF.cornerS(c.j);
        }
      }
      if (OF && !isPoly) {
        // round a rectangle / a chain: the working direction from the anchors
        let sum = 0, prev = NaN;
        for (const it of items) {
          if (!Number.isFinite(it.t)) continue;
          if (Number.isFinite(prev)) sum += mod(it.t - prev + Math.PI, TAU) - Math.PI;
          prev = it.t;
        }
        dir = sum < 0 ? -1 : 1;
      }
      // unwrap (radial) and joins
      const nSt = Math.max(1, stItems.length);
      const eps = Math.min(Math.PI / 3, (0.4 * TAU) / nSt);
      let ref = NaN;
      for (const it of items) {
        if (it.kind === 'join') {
          const n = graph.nodes[it.rep];
          const a = n.into[0];
          const ti = a && 'node' in a ? itemOf[a.node - first] : -1;
          if (ti >= 0 && Number.isFinite(items[ti].t)) it.t = items[ti].t + (closed ? dir * TAU : 0);
          if (Number.isFinite(it.t)) ref = it.t;
          continue;
        }
        if (!Number.isFinite(it.t)) continue;
        if (closed) {
          if (Number.isFinite(ref)) it.t = ref + dir * (mod(dir * (it.t - ref) + eps, TAU) - eps);
        }
        ref = it.t;
      }
      // interpolate the rest by width
      const cum: number[] = [];
      let c = 0;
      for (const it of items) { cum.push(c + it.half); c += lin(it); }
      const fins = items.map((it, i) => (Number.isFinite(it.t) ? i : -1)).filter((i) => i >= 0);
      const toC = (d: number) => (closed ? lenC(d, rho) : d);
      if (fins.length === 0) {
        items.forEach((it, i) => { it.t = (closed ? start : 0) + dir * toC(cum[i]); });
      } else {
        const f0 = fins[0], fL = fins[fins.length - 1];
        for (let i = 0; i < f0; i++) items[i].t = items[f0].t - dir * toC(cum[f0] - cum[i]);
        for (let q = 0; q + 1 < fins.length; q++) {
          const a = fins[q], b = fins[q + 1];
          for (let i = a + 1; i < b; i++) {
            const f = (cum[i] - cum[a]) / Math.max(1e-9, cum[b] - cum[a]);
            items[i].t = items[a].t + (items[b].t - items[a].t) * f;
          }
        }
        if (fL < items.length - 1) {
          if (closed) {
            const tEnd = items[f0].t + dir * TAU;
            const cEnd = c + cum[f0];
            for (let i = fL + 1; i < items.length; i++) {
              const f = (cum[i] - cum[fL]) / Math.max(1e-9, cEnd - cum[fL]);
              items[i].t = items[fL].t + (tEnd - items[fL].t) * f;
            }
          } else {
            for (let i = fL + 1; i < items.length; i++) items[i].t = items[fL].t + dir * (cum[i] - cum[fL]);
          }
        }
      }
    }

    // --- solve the course (joins take no room: they sit between the last and the first stitch)
    // (radial: a loose turning chain takes no room either; it is tucked into the seam afterwards)
    const solveItems = items.filter((it) => it.kind !== 'join' && !(closed && it.kind === 'tchLoose'));
    const n = solveItems.length;
    const target = new Float64Array(n), weight = new Float64Array(n), gap = new Float64Array(Math.max(0, n - 1));
    for (let i = 0; i < n; i++) { target[i] = dir * solveItems[i].t; weight[i] = solveItems[i].w; }
    const toCourse = (d: number) => (closed ? lenC(d, rho) : d);
    for (let i = 0; i + 1 < n; i++) gap[i] = toCourse(solveItems[i].half + solveItems[i + 1].half);
    let wrapGap = n > 1 ? toCourse(solveItems[n - 1].half + solveItems[0].half) : 0;
    // (not round 1 into a ring, already spread evenly by width — sharing there left the slack at the
    // seam; not a pointed round: its stitches sit on their anchors and the chains between the arms
    // are drawn as arcs between them, whatever their place on the circle)
    if (circular && n > 2 && !arms.length && !central) {
      // Spread a closed round round its circle: share most of the free circumference among the
      // gaps (less between stitches worked into the same place, so fans stay fans); the anchors
      // decide the rest.
      const span = dir * (solveItems[n - 1].t - solveItems[0].t);
      let used = wrapGap;
      for (let i = 0; i + 1 < n; i++) used += gap[i];
      const free = TAU - used;
      if (span > 0.75 * TAU && free > 0) {
        const key = (it: Item) => {
          if (it.kind !== 'st' && it.kind !== 'tch') return '';
          const a = graph.nodes[it.rep].into[0];
          return a ? ('node' in a ? `n${a.node}` : `s${a.space}`) : '';
        };
        // key of the stitch at or before / after each gap (gaps inside a group share the group's key)
        const before: string[] = new Array(n), after: string[] = new Array(n);
        let cur = '';
        for (let i = 0; i < n; i++) { const kk = key(solveItems[i]); if (kk || solveItems[i].kind === 'st' || solveItems[i].kind === 'tch') cur = kk; before[i] = cur; }
        cur = '';
        for (let i = n - 1; i >= 0; i--) { const kk = key(solveItems[i]); if (kk || solveItems[i].kind === 'st' || solveItems[i].kind === 'tch') cur = kk; after[i] = cur; }
        const share = new Float64Array(n);
        let tot = 0;
        for (let i = 0; i < n; i++) {
          const a = solveItems[i], b = solveItems[(i + 1) % n];
          const ka = before[i], kb = after[(i + 1) % n];
          share[i] = a.kind === 'tchLoose' || b.kind === 'tchLoose' ? 0 : ka && ka === kb ? 0.3 : 1;
          tot += share[i];
        }
        const give = (0.8 * free) / tot;
        for (let i = 0; i + 1 < n; i++) gap[i] += share[i] * give;
        wrapGap += share[n - 1] * give;
      }
    }
    const sol = solveOrdered({
      target, weight, gap,
      maxSpan: closed && n > 1 ? TAU - wrapGap : undefined,
    });
    // exactly n-fold: average each position over its n copies (constraints are preserved: every
    // gap becomes the mean of n gaps that each met it)
    const nSym = circular && !(R.kind === 'round' && !R.joined) ? symOrder.get(k) ?? 1 : 1;
    if (nSym > 1 && n >= nSym && n % nSym === 0) symmetrize(solveItems, sol, nSym);
    for (let i = 0; i < n; i++) for (const id of solveItems[i].ids) { S[id] = dir * sol[i]; course[id] = 1; }
    // loose turning chains: in the seam, just before the stitch they stand beside
    if (closed) {
      items.forEach((it, i) => {
        if (it.kind !== 'tchLoose') return;
        let a = -1, b = -1;
        for (let j = 1; j <= items.length && (a < 0 || b < 0); j++) {
          const pa = items[(i - j + items.length) % items.length], pb = items[(i + j) % items.length];
          if (a < 0 && pa.kind !== 'join' && pa.kind !== 'tchLoose') a = (i - j + items.length) % items.length;
          if (b < 0 && pb.kind !== 'join' && pb.kind !== 'tchLoose') b = (i + j) % items.length;
        }
        if (a < 0 || b < 0) { for (const id of it.ids) { S[id] = dir * (n ? sol[0] : 0); course[id] = 1; } return; }
        const sb = dir * S[items[b].rep] + (b < i ? TAU : 0);
        const sa = dir * S[items[a].rep] - (a > i ? TAU : 0);
        const gapC = Math.max(0, sb - sa);
        const v = sb - Math.min(0.5 * gapC, lenC(0.34, Math.max(rho, 0.5)));
        for (const id of it.ids) { S[id] = dir * v; course[id] = 1; }
      });
    }
    items.forEach((it, i) => {
      if (it.kind !== 'join') return;
      let a = -1, b = -1;
      for (let j = i - 1; j >= 0; j--) if (items[j].kind !== 'join') { a = j; break; }
      for (let j = i + 1; j < items.length; j++) if (items[j].kind !== 'join') { b = j; break; }
      const sa = a >= 0 ? S[items[a].rep] : NaN;
      const a0 = graph.nodes[it.rep].into[0];
      const tgt = a0 && 'node' in a0 && graph.nodes[a0.node]?.round === k ? S[a0.node] : NaN;
      const sb = b >= 0 ? S[items[b].rep] : Number.isFinite(tgt) ? tgt + (closed ? dir * TAU : 0) : solveItems.length ? S[solveItems[0].rep] + (closed ? dir * TAU : dir * 0.6) : NaN;
      let v = Number.isFinite(sa) && Number.isFinite(sb) ? (sa + sb) / 2 : Number.isFinite(sa) ? sa + dir * 0.3 : Number.isFinite(sb) ? sb - dir * 0.3 : it.t;
      // radial: the join's dot sits just before the top of the stitch it joins into (the seam), not
      // half-way across the gap
      if (closed && b < 0 && Number.isFinite(tgt) && Number.isFinite(sa)) {
        const end = tgt + dir * TAU;
        const gapC = Math.max(0, dir * (end - sa));
        v = end - dir * Math.min(lenC(0.24, Math.max(rho, 0.5)), 0.45 * gapC);
      }
      for (const id of it.ids) { S[id] = v; course[id] = 1; }
    });

    // --- radii and positions of stitches and counting turning chains
    const spiral = circular && R.kind === 'round' && !R.joined;
    const hBar = stItems.length ? stItems.reduce((a, it) => a + hOf(graph.nodes[it.rep]), 0) / stItems.length : 0.5;
    const gK = spiral ? Math.min(Math.max(minGap, rho - prevTop), Math.max(minGap, hBar)) : 0;
    const s0 = n ? S[items[0].rep] : start;
    const rampOf = (s: number) => (spiral ? (Math.min(1, Math.max(0, (dir * (s - s0)) / TAU)) - 0.5) * gK : 0);
    let baseLevel = NaN;
    if (OF) {
      let sb = 0, cb = 0;
      for (const it of items) {
        if (it.kind !== 'st' && it.kind !== 'tch') continue;
        const nd = graph.nodes[it.rep];
        let sh = 0, c = 0;
        for (let l = 0; l < nd.into.length; l++) { const p = legPoint(nd, l, S[it.rep]); if (p) { sh += F.height(p.x, p.y); c++; } }
        if (c) { sb += sh / c; cb++; }
      }
      if (cb) baseLevel = sb / cb;
    }
    for (const it of items) {
      if (it.kind !== 'st' && it.kind !== 'tch') continue;
      const nd = graph.nodes[it.rep];
      const s = S[it.rep];
      const pts: Pt[] = [];
      let sh = 0, si = 0, maxH = 0;
      for (let l = 0; l < nd.into.length; l++) {
        const p = legPoint(nd, l, s);
        if (!p) continue;
        pts.push({ x: p.x, y: p.y });
        const h = F.height(p.x, p.y);
        sh += h; si += p.ramp; maxH = Math.max(maxH, h);
      }
      const base = pts.length ? sh / pts.length : prevTop;
      const inh = pts.length ? si / pts.length : 0;
      const rp = rampOf(s);
      // (a polygon / border / stadium round: tops level — one line per stitch height along a side,
      // as charts draw them; the legs reach down to wherever they are worked)
      let top = (OF && Number.isFinite(baseLevel) ? baseLevel : base - inh) + hOf(nd) * kappa + rp;
      top = Math.max(top, (pts.length ? maxH : prevTop) + 0.45);
      const [tx, ty] = F.pos(s, top);
      if (!pts.length) { const [bx, by] = F.pos(s, prevTop); pts.push({ x: bx, y: by }); }
      const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const rot = Math.atan2(ty - my, tx - mx);
      ramp[it.rep] = rp;
      if (it.kind === 'st') {
        legs[it.rep] = pts;
        place(it.rep, tx, ty, rot);
      } else {
        // counting turning chain: chains stacked from the base to the top
        const m = it.ids.length;
        it.ids.forEach((id, j) => {
          const f = (j + 0.5) / m;
          const cxs = mx + (tx - mx) * f, cys = my + (ty - my) * f;
          if (id === it.rep) place(id, cxs, cys, rot + Math.PI / 2, tx, ty);
          else place(id, cxs, cys, rot + Math.PI / 2);
          ramp[id] = rp;
        });
        // the top chain is where the next round attaches
        legs[it.rep] = pts;
      }
    }
    // --- arms, straight out along the radius at their base angle
    const armsOut: ChartArm[] = [];
    const rotV = (p: Pt, a: number): Pt => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
    const angOf = (p: Pt) => Math.atan2(p.y, p.x);
    const addV = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + b.x * t, y: a.y + b.y * t });
    /** Chains on a small closed loop leaving `base` in direction `w` (side `wv`), from the −wv side round to the +wv side. */
    const loopChains = (ids: number[], base: Pt, w: Pt, wv: Pt, s: number, role: ChartNode['arm']) => {
      // the loop opens at `base` (a gap of ±LOOP_GAP round its bottom), chains spaced round the rest
      const rl = Math.max(0.26, (ids.length * pitch * 0.95) / (TAU - 2 * LOOP_GAP));
      const C = addV(base, w, rl * Math.cos(LOOP_GAP));
      ids.forEach((c, i) => {
        const ph = Math.PI + LOOP_GAP + ((i + 0.5) / ids.length) * (TAU - 2 * LOOP_GAP);
        const p = addV(addV(C, w, rl * Math.cos(ph)), wv, rl * Math.sin(ph));
        const t = { x: -w.x * Math.sin(ph) + wv.x * Math.cos(ph), y: -w.y * Math.sin(ph) + wv.y * Math.cos(ph) };
        place(c, p.x, p.y, angOf(t)); kind[c] = 'chain'; S[c] = s; armRole[c] = role;
      });
      return rl * (1 + Math.cos(LOOP_GAP));
    };
    /**
     * A chain spine from `O` along `u` (returning stitches on the `v` side): chains of the spine
     * base → tip, the tip loop, then the nodes `from..to` worked back down it — sl st / sc beside
     * their chain, picots as side branches at ±50° (alternating sides), a chain branch worked back
     * along as a nested spine.
     */
    const placeSpine = (chains: number[], tip: number[], from: number, to: number, O: Pt, u: Pt, v: Pt, s: number, g0: number) => {
      const sv = -u.y * v.x + u.x * v.y >= 0 ? 1 : -1; // rotating u by +sv·a turns it towards v
      const P = chains.map((_, j) => addV(O, u, g0 + (j + 0.5) * pitch));
      const E = addV(O, u, g0 + chains.length * pitch);
      const jOf = new Map(chains.map((c, j) => [c, j] as [number, number]));
      chains.forEach((c, j) => { place(c, P[j].x, P[j].y, angOf(u)); kind[c] = 'chain'; S[c] = s; armRole[c] = 'spine'; });
      let jCur = chains.length - 1, side = 0, tipLoop = false, id = from;
      const b0 = from <= to ? graph.nodes[from] : undefined;
      if (tip.length && b0) {
        if (b0.type === 'slst' || b0.type === 'sc') {
          loopChains(tip, E, u, v, s, 'tip');
          tipLoop = true;
        } else {
          // a tall stitch (cluster, bobble) at the hook end, charted as a cluster with its turning
          // chain: it stands on the spine's last chain pointing out along the arm, the skipped chains
          // stacked beside it in line with the spine, base to top
          const h = Math.max(1.1, hOf(b0));
          const off = 0.24;
          const B = addV(E, v, off * 0.9), T = addV(B, u, h);
          legs[b0.id] = b0.into.map(() => ({ x: B.x, y: B.y }));
          place(b0.id, T.x, T.y, angOf(u)); kind[b0.id] = 'stitch'; S[b0.id] = s; armRole[b0.id] = 'tip';
          const st = (h - 0.1) / Math.max(1, tip.length);
          tip.forEach((c, i) => {
            const p = addV(addV(E, u, 0.08 + (i + 0.5) * st), v, -off);
            place(c, p.x, p.y, angOf(u) + Math.PI / 2); kind[c] = 'chain'; S[c] = s; armRole[c] = 'tip';
          });
          id = from + 1;
        }
      } else if (tip.length) {
        loopChains(tip, E, u, v, s, 'tip');
      }
      // Pre-pass: where each frond (picot made on the way down) roots and on which side, so the
      // returning sl sts can keep to the other side. Single fronds alternate sides; a pair made
      // together ("picot, picot") is one frond each side, symmetric about the spine.
      const frond = new Map<number, { j: number; sg: number; pair: boolean }>();
      const frondSides: Set<number>[] = chains.map(() => new Set());
      {
        let jj = jCur, sd = side, x = id;
        while (x <= to) {
          const nd = graph.nodes[x];
          if (nd.type === 'ch' && nd.role !== 'tch') {
            let e = x;
            while (e + 1 <= to && graph.nodes[e + 1].type === 'ch' && graph.nodes[e + 1].role !== 'tch') e++;
            sd++;
            const a0 = e + 1 <= to ? graph.nodes[e + 1].into[0] : undefined;
            x = a0 && 'node' in a0 && a0.node >= x && a0.node <= e ? armEnd(graph, kids.nodes, k, x, e, to) + 1 : e + 1;
            continue;
          }
          if (nd.type === 'picot') {
            let e = x;
            while (e + 1 <= to && graph.nodes[e + 1].type === 'picot') e++;
            if (e > x) {
              // pairs (and larger groups): spread symmetrically, −side first
              const m = e - x + 1;
              for (let q = 0; q < m; q++) {
                const sg = m === 2 ? (q === 0 ? -1 : 1) : q - (m - 1) / 2;
                frond.set(x + q, { j: jj, sg, pair: true });
                if (jj >= 0) frondSides[jj].add(Math.sign(sg));
              }
            } else {
              const sg = sd++ % 2 === 0 ? -1 : 1;
              frond.set(x, { j: jj, sg, pair: false });
              if (jj >= 0) frondSides[jj].add(sg);
            }
            x = e + 1;
            continue;
          }
          const a = nd.into[0];
          const j = a && 'node' in a ? jOf.get(a.node) : undefined;
          if (j !== undefined) jj = j;
          x++;
        }
      }
      /** Side of the spine for a returning sl st at chain j: away from a single frond rooted there or just below. */
      const slSide = (j: number): number => {
        const near = new Set<number>([...(frondSides[j] ?? []), ...(frondSides[j - 1] ?? [])]);
        if (near.size === 1) return -[...near][0];
        return 1;
      };
      const nextSide = () => (side++ % 2 === 0 ? -1 : 1);
      while (id <= to) {
        const nd = graph.nodes[id];
        const base = jCur >= 0 ? P[jCur] : O;
        if (nd.type === 'ch' && nd.role !== 'tch') {
          let e = id;
          while (e + 1 <= to && graph.nodes[e + 1].type === 'ch' && graph.nodes[e + 1].role !== 'tch') e++;
          const run: number[] = [];
          for (let c = id; c <= e; c++) run.push(c);
          const sg = nextSide();
          const w = rotV(u, sg * sv * BRANCH), wv = rotV(v, sg * sv * BRANCH);
          const a0 = e + 1 <= to ? graph.nodes[e + 1].into[0] : undefined;
          if (a0 && 'node' in a0 && a0.node >= id && a0.node <= e) {
            // a chain branch worked back along: a spine of its own at the branch angle
            const end = armEnd(graph, kids.nodes, k, id, e, to);
            const jm = workedMax(graph, id, e, e + 1, end);
            placeSpine(run.slice(0, jm + 1), run.slice(jm + 1), e + 1, end, addV(base, v, sg * 0.12), w, wv, s, 0.12);
            for (let c = id; c <= end; c++) if (armRole[c] === 'spine') armRole[c] = 'branch';
            id = end + 1;
          } else {
            loopChains(run, addV(addV(base, v, sg * 0.14), w, 0.1), w, wv, s, 'branch');
            id = e + 1;
          }
          continue;
        }
        if (nd.type === 'picot') {
          const fr = frond.get(id) ?? { j: jCur, sg: nextSide(), pair: false };
          const atTip = tipLoop && fr.j === chains.length - 1;
          const ang = fr.pair && Math.abs(fr.sg) !== 1 ? Math.sign(fr.sg) * Math.min(1, Math.abs(fr.sg)) : Math.sign(fr.sg) || 1;
          const w = rotV(u, ang * sv * (atTip ? TIP_BRANCH : BRANCH));
          const side1 = Math.sign(fr.sg) || 1;
          const Pj = fr.j >= 0 ? P[fr.j] : O;
          // root beside the spine at the returning stitch's place (a pair: both from one point
          // just below it, mirror images); at the tip, beside the tip loop
          const b = atTip
            ? addV(addV(E, u, -0.1), v, side1 * 0.2)
            : addV(addV(Pj, u, -pitch / 2), v, side1 * (fr.pair ? 0.07 : 0.09));
          place(id, b.x, b.y, angOf(w)); kind[id] = 'picot'; S[id] = s; armRole[id] = 'branch'; gScale[id] = ARM_PICOT;
          id++;
          continue;
        }
        const a = nd.into[0];
        const j = a && 'node' in a ? jOf.get(a.node) : undefined;
        if (j !== undefined) jCur = j;
        const Pj = jCur >= 0 ? P[jCur] : O;
        if (nd.type === 'slst') {
          // beside its chain, on the side away from the frond at that place
          const sd = jCur >= 0 ? slSide(jCur) : 1;
          const pairHere = jCur >= 0 && frondSides[jCur].size > 1;
          const q = addV(addV(Pj, v, sd * 0.2), u, pairHere ? 0.06 : 0);
          place(id, q.x, q.y, angOf(u)); kind[id] = 'slst';
        } else {
          const L = Math.min(1.3, Math.max(0.62, 0.62 + 0.4 * (hOf(nd) - 1)));
          const q = addV(Pj, v, L);
          legs[id] = nd.into.map(() => ({ x: Pj.x, y: Pj.y }));
          place(id, q.x, q.y, angOf(v)); kind[id] = 'stitch';
        }
        S[id] = s; armRole[id] = 'back';
        id++;
      }
    };
    arms.forEach((A, ai) => {
      const ii = armItem[ai];
      const s = S[items[ii].rep];
      const u = { x: Math.cos(s), y: -Math.sin(s) };
      const v = { x: -dir * Math.sin(s), y: -dir * Math.cos(s) };
      // base: the tops of the stitches either side of the arm (the group's opening and closing sc)
      let rb = 0, nb = 0;
      for (let j = ii - 1; j >= 0; j--) if (items[j].kind === 'st' || items[j].kind === 'tch') { rb += H[items[j].rep]; nb++; break; }
      for (let j = ii + 1; j < items.length; j++) if (items[j].kind === 'st' || items[j].kind === 'tch') { rb += H[items[j].rep]; nb++; break; }
      const r0 = nb ? rb / nb : rho;
      if (A.kind === 'spine') {
        const O = { x: u.x * r0, y: u.y * r0 };
        placeSpine(A.spine, A.tip, A.first + A.spine.length + A.tip.length, A.last, O, u, v, s, 0.14);
      } else {
        const P0 = endpoint(A.a[0] - 1, first, last, true);
        const Q0 = endpoint(A.b[A.b.length - 1] + 1, first, last, false);
        const rB = (Math.hypot(P0.x, P0.y) + Math.hypot(Q0.x, Q0.y)) / 2;
        const h = Math.min(A.a.length, A.b.length) * pitch * 0.9;
        const apex = addV({ x: 0, y: 0 }, u, rB + h);
        const line = (ids: number[], p: Pt, q: Pt) => {
          const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1e-9;
          const pad = Math.min(DIM.chainEndPad, L * 0.12), st = (L - 2 * pad) / ids.length;
          ids.forEach((c, i) => {
            const f = (pad + (i + 0.5) * st) / L;
            place(c, p.x + dx * f, p.y + dy * f, Math.atan2(dy, dx)); kind[c] = 'chain'; S[c] = s; armRole[c] = 'loop';
          });
          const sp = chainSpace[ids[0]];
          if (sp >= 0) spacesOut.push({ id: sp, round: k, kind: 'chsp', d: `M${r3(p.x)} ${r3(p.y)}L${r3(q.x)} ${r3(q.y)}`, apex: rB + h });
        };
        line(A.a, P0, addV(apex, v, -0.24));
        line(A.b, addV(apex, v, 0.24), Q0);
        A.picots.forEach((pc, i) => {
          const w = rotV(u, (i - (A.picots.length - 1) / 2) * 0.6);
          place(pc, apex.x - u.x * 0.12, apex.y - u.y * 0.12, angOf(w)); kind[pc] = 'picot'; S[pc] = s; armRole[pc] = 'tip'; gScale[pc] = ARM_PICOT;
        });
      }
      let r1 = r0;
      for (let id = A.first; id <= A.last; id++) if (placed[id]) r1 = Math.max(r1, H[id]);
      armsOut.push({
        kind: A.kind, first: A.first, last: A.last, s, r0, r1,
        spine: A.kind === 'spine' ? A.spine : [...A.a, ...A.b], tip: A.kind === 'spine' ? A.tip : A.picots,
      });
    });

    // base height for loose turning chains: the anchor of the next stitch
    const nextStBase = (i: number): number => {
      for (let j = i + 1; j < items.length; j++) {
        const it = items[j];
        if (it.kind === 'st' || it.kind === 'tch') {
          const L = legs[it.rep];
          if (L.length) return L.reduce((a, p) => a + F.height(p.x, p.y), 0) / L.length;
        }
      }
      return prevTop;
    };
    items.forEach((it, i) => {
      if (it.kind === 'tchLoose') {
        const s = S[it.rep];
        const b = nextStBase(i);
        it.ids.forEach((id, j) => {
          const [x, y] = F.pos(s, b + 0.12 + (j + 0.5) * DIM.tchPitch);
          place(id, x, y, tangentRot(F, x, y, s, closed));
          ramp[id] = rampOf(s);
        });
      } else if (it.kind === 'join') {
        const nd = graph.nodes[it.rep];
        const a = nd.into[0];
        const t = a && 'node' in a ? a.node : -1;
        const h = t >= 0 && placed[t] ? H[t] : rho;
        const s = S[it.rep];
        const [x, y] = F.pos(s, h - (closed ? 0.04 : 0.1));
        place(it.rep, x, y, tangentRot(F, x, y, s, closed));
        ramp[it.rep] = rampOf(s);
      }
    });
    // picots: on top of the previous stitch
    items.forEach((it) => {
      if (it.kind !== 'picot') return;
      const id = it.rep;
      const s = S[id];
      let h = rho;
      for (let p = id - 1; p >= first; p--) {
        if (placed[p] && kind[p] !== 'chain') { h = H[p]; break; }
        if (kind[p] === 'stitch' || kind[p] === 'tch') break;
      }
      const [x, y] = F.pos(s, h);
      const [ox, oy] = F.out(x, y, s);
      place(id, x, y, Math.atan2(oy, ox));
      ramp[id] = rampOf(s);
    });
    // travelling / surface slip stitches sit on their anchor
    for (const id of travel) {
      const nd = graph.nodes[id];
      const nextS = (() => { for (const it of items) if (it.rep > id) return S[it.rep]; return s0; })();
      const p = legPoint(nd, 0, nextS);
      let x: number, y: number, s: number;
      if (p) {
        const [ox, oy] = F.out(p.x, p.y, nextS);
        x = p.x + ox * 0.14; y = p.y + oy * 0.14; s = F.course(p.x, p.y);
        legs[id] = [{ x: p.x, y: p.y }];
      } else {
        [x, y] = F.pos(nextS, prevTop + 0.1); s = nextS;
      }
      place(id, x, y, tangentRot(F, x, y, s, closed));
      S[id] = s;
    }
    // ring joins: on the ring circle between its last and first chain
    for (const id of ringJoins) {
      const nd = graph.nodes[id];
      const a = nd.into[0] as { node: number };
      const sp = graph.spaces[chainSpace[a.node]];
      const r0 = sp ? ringR[sp.id] : DIM.minChainRingR;
      const s = start;
      const [x, y] = F.pos(s, r0);
      place(id, x, y, tangentRot(F, x, y, s, closed));
      S[id] = s;
    }

    // --- chains: arcs between their neighbours
    /** Item `i` (searching in direction `step` past seam items) is a stitch next to an arm. */
    const isArmBase = (i: number, step: 1 | -1): boolean => {
      const at = (j: number) => items[((j % items.length) + items.length) % items.length];
      let j = i;
      while (at(j).kind === 'tchLoose' || at(j).kind === 'join') j += step;
      if (at(j).kind !== 'st') return at(j).kind === 'arm';
      return at(j + step).kind === 'arm' || at(j - step).kind === 'arm';
    };
    const bridges: { ids: number[]; anchored: boolean; pin: Pt }[] = [];
    const pureChain = !items.some((it) => it.kind === 'st' || it.kind === 'tch' || it.kind === 'tchLoose');
    let i = 0;
    while (i < items.length) {
      if (items[i].kind !== 'ch') { i++; continue; }
      const sp0 = chainSpace[items[i].rep];
      let j = i;
      while (j + 1 < items.length && items[j + 1].kind === 'ch' && chainSpace[items[j + 1].rep] === sp0 && items[j + 1].rep === items[j].rep + 1) j++;
      const runIds = items.slice(i, j + 1).map((it) => it.rep);
      if (pureChain || (central && sp0 < 0)) {
        for (const id of runIds) {
          const [x, y] = F.pos(S[id], prevTop);
          place(id, x, y, tangentRot(F, x, y, S[id], closed));
        }
      } else {
        const P = endpoint(runIds[0] - 1, first, last, true);
        const Q = endpoint(runIds[runIds.length - 1] + 1, first, last, false);
        // a pointed round's chains between the arms are valley bridges: drawn pinned out (a V to a pin), not a scallop
        let arc: { pts: { x: number; y: number; rot: number }[]; d: string; apex: number; step?: number };
        if (arms.length && circular) {
          // from arm base to arm base: a V to its pin; to / from a valley anchor stitch: a shallow arc
          const anchored = !isArmBase(i - 1, -1) || !isArmBase(j + 1, 1);
          arc = bridgeArc(P, Q, runIds.length, anchored ? 0.34 : 0.4);
          bridges.push({ ids: runIds, anchored, pin: (arc as ReturnType<typeof bridgeArc>).pin });
        } else arc = chainArc(F, closed, P, Q, runIds.length, S[runIds[0]], dir);
        // chains closer than their length: smaller ovals, so they do not overlap
        const shrink = arc.step !== undefined ? Math.max(0.6, Math.min(1, arc.step / (2 * SYM_CH_RX + 0.06))) : 1;
        runIds.forEach((id, q) => { const c = arc.pts[q]; place(id, c.x, c.y, c.rot); ramp[id] = rampOf(S[id]); if (shrink < 1) gScale[id] = shrink; });
        if (sp0 >= 0) spacesOut.push({ id: sp0, round: k, kind: 'chsp', d: arc.d, apex: arc.apex });
      }
      i = j + 1;
    }

    function endpoint(id: number, a: number, b: number, before: boolean): Pt {
      if (id >= a && id <= b && placed[id]) {
        const nd = graph.nodes[id];
        // a join sits between the last and first stitch: the arc runs on to the stitch joined into
        if (role[id] === 'join' && !before) {
          const a0 = nd.into[0];
          if (a0 && 'node' in a0 && placed[a0.node]) return { x: TX[a0.node], y: TY[a0.node] };
        }
        if (nd.type === 'picot') return { x: X[id], y: Y[id] };
        return { x: TX[id], y: TY[id] };
      }
      if (!before) {
        // end of the round: wrap to the round's first course symbol
        for (const it of items) if (placed[it.rep] && it.kind !== 'ch') return { x: TX[it.rep], y: TY[it.rep] };
      }
      const s = before ? S[a] : S[b];
      const [x, y] = F.pos(s, rho);
      return { x, y };
    }

    // --- round summary
    let rs = 0, rc = 0, rOuter = 0;
    for (const it of items) if (it.kind === 'st' || it.kind === 'tch') { rs += H[it.rep]; rc++; }
    for (const id of ids) if (placed[id]) rOuter = Math.max(rOuter, H[id] + (kind[id] === 'picot' ? 0.5 * gScale[id] * (gScale[id] > 1 ? 1.4 : 1) : 0.2));
    for (const sp of spacesOut) if (sp.round === k) rOuter = Math.max(rOuter, sp.apex);
    const rMean = rc ? rs / rc : (ids.filter((id) => placed[id]).reduce((a, id) => a + H[id], 0) / Math.max(1, ids.filter((id) => placed[id]).length)) || rho;
    const r0band = isBorder && k === borderStart ? 0 : roundsOut.length ? roundsOut[roundsOut.length - 1].r : 0;
    // label just before the first course symbol, half-way up the round
    let labelAt: Pt;
    if (closed) {
      const mid = Math.max(0.45, (prevTop + rMean) / 2);
      const [x, y] = F.pos(s0 - dir * lenC(0.62, Math.max(mid, 0.5)), mid);
      labelAt = { x, y };
    } else {
      const [x, y] = F.pos(s0 - dir * 0.9, (prevTop + rMean) / 2);
      labelAt = { x, y };
    }
    const b = emptyB();
    for (const id of ids) if (placed[id]) { growPt(b, X[id], Y[id], 0.45); growPt(b, TX[id], TY[id], 0.45); if (kind[id] === 'picot') { const [ox, oy] = [Math.cos(ROT[id]), Math.sin(ROT[id])]; const e = 0.5 * gScale[id] * (gScale[id] > 1 ? 1.4 : 1); growPt(b, X[id] + ox * e, Y[id] + oy * e, 0.2); } }
    growPt(b, labelAt.x, labelAt.y, 0.4);
    roundsOut.push({
      index: k, label: R.label, short: shortLabel(R.label), kind: R.kind, r: rMean, r0: r0band, rOuter: Math.max(rOuter, rMean),
      dir, joined: !!R.joined, labelAt, first, last, bounds: b, flat: fl, spiral: gK, s0,
      ...(OF ? { frame: OF.spec } : {}),
      ...(isBorder ? { border: true } : {}),
      ...(armsOut.length ? { pointed: true, outline: outlineOf(ids, rMean), arms: armsOut, hull: hullOf(armsOut, bridges, dir) } : {}),
    });
    prevTop = rMean;
    prevDir = dir;
  }

  // a body in rows with a border: the row numbers go in the margin outside the border (left / right
  // as the rows start), border rounds are numbered "R1", "R2"… at their start
  if (borderStart > 0 && rect) {
    const xs = rect.core.map((p) => p.x);
    const xL = Math.min(...xs), xR = Math.max(...xs);
    let out = 0;
    for (const r of roundsOut) if (r.border && r.first >= 0) out = Math.max(out, r.rOuter);
    for (const r of roundsOut) {
      if (r.first < 0) continue;
      if (r.border) { r.short = `R${r.short}`; continue; }
      const left = r.labelAt.x < (xL + xR) / 2;
      r.labelAt = { x: left ? xL - out - 0.8 : xR + out + 0.8, y: r.labelAt.y };
      growPt(r.bounds, r.labelAt.x, r.labelAt.y, 0.4);
    }
  }

  // unplaced nodes (should not happen for valid graphs): park them at the centre
  for (let id = 0; id < N; id++) if (!placed[id]) place(id, 0, 0, 0);

  const nodes: ChartNode[] = graph.nodes.map((nd, id) => {
    const k = kind[id];
    let cx = X[id], cy = Y[id];
    if (k === 'stitch') {
      const L = legs[id];
      const mx = L.length ? L.reduce((a, p) => a + p.x, 0) / L.length : X[id];
      const my = L.length ? L.reduce((a, p) => a + p.y, 0) / L.length : Y[id];
      const len = Math.hypot(X[id] - mx, Y[id] - my);
      const back = Math.min(0.4, len / 2);
      cx = X[id] - Math.cos(ROT[id]) * back; cy = Y[id] - Math.sin(ROT[id]) * back;
    } else if (k === 'picot') {
      const rl = picotRadius(nd) * gScale[id] * (gScale[id] > 1 ? 1.25 : 1);
      cx = X[id] + Math.cos(ROT[id]) * rl; cy = Y[id] + Math.sin(ROT[id]) * rl;
    }
    const out: ChartNode = {
      id, round: nd.round, kind: k, type: nd.type, symbol: symbolOf(nd), x: X[id], y: Y[id], rot: ROT[id],
      legs: k === 'stitch' || (k === 'tch' && nd.countsAs) ? legs[id] : [], cx, cy, s: S[id], course: !!course[id], r: H[id],
    };
    if (role[id]) out.role = role[id];
    if (fan[id]) out.fan = true;
    if (armRole[id]) out.arm = armRole[id];
    if (gScale[id] !== 1) out.scale = gScale[id];
    return out;
  });

  const bounds = emptyB();
  for (const r of roundsOut) if (r.first >= 0) unionB(bounds, r.bounds);
  if (firstRing) growPt(bounds, 0, 0, ringR[firstRing.id] + 0.3);
  if (!Number.isFinite(bounds.minX)) Object.assign(bounds, { minX: -1, minY: -1, maxX: 1, maxY: 1 });

  if (poly && opts.startAngle === undefined && Number.isFinite(polyPhase)) {
    // a polygon sits on a side (a square's sides level, a hexagon flat at the bottom): turn the
    // whole piece by starting round 1 elsewhere (everything after follows its anchors)
    const step = TAU / poly.n;
    const want = -Math.PI / 2 + Math.PI / poly.n;
    const d = mod(want - polyPhase + step / 2, step) - step / 2;
    if (Math.abs(d) > 1e-9) return layoutChart(graph, params, { ...opts, startAngle: start + d });
  }
  const shape: ChartLayout['shape'] = poly ? { kind: 'polygon', n: poly.n, from: poly.from }
    : stadium ? { kind: 'stadium', from: 1 }
    : borderStart > 0 && rect ? { kind: 'border', from: borderStart, rect: rect.core } : undefined;
  return {
    mode, unit, nodes, spaces: spacesOut, rounds: roundsOut,
    ...(shape ? { shape } : {}),
    ring: firstRing ? { kind: firstRing.chains.length ? 'chain' : 'magic', r: ringR[firstRing.id], space: firstRing.id } : undefined,
    bounds,
  };
}

export function picotRadius(n: Node): number {
  return 0.15 * Math.sqrt((n.chains ?? 3) / 3);
}

function tangentRot(F: Frame, x: number, y: number, s: number, radial: boolean): number {
  if (!radial) return 0;
  const [ox, oy] = F.out(x, y, s);
  return Math.atan2(oy, ox) + Math.PI / 2;
}

/** Make solved course positions exactly n-fold: each position becomes the mean of its n copies (one turn / n apart). */
function symmetrize(items: Item[], sol: Float64Array, n: number) {
  const m = items.length, P = m / n;
  const sig = (it: Item) => (it.kind === 'tch' ? 'st' : it.kind);
  for (let i = 0; i < m - P; i++) if (sig(items[i]) !== sig(items[i + P])) return;
  const step = TAU / n;
  // only when the round already is nearly n-fold (a pure seam effect)
  for (let j = 0; j < P; j++) {
    let mean = 0;
    for (let q = 0; q < n; q++) mean += sol[j + q * P] - q * step;
    mean /= n;
    for (let q = 0; q < n; q++) if (Math.abs(sol[j + q * P] - q * step - mean) > step / 2) return;
  }
  for (let j = 0; j < P; j++) {
    let mean = 0;
    for (let q = 0; q < n; q++) mean += sol[j + q * P] - q * step;
    mean /= n;
    for (let q = 0; q < n; q++) sol[j + q * P] = mean + q * step;
  }
}

function circMean(a: number[]): number {
  if (a.length === 1) return a[0];
  // mean around the first angle (legs of one stitch are close together)
  const ref = a[0];
  let s = 0;
  for (const x of a) s += ref + (mod(x - ref + Math.PI, TAU) - Math.PI);
  return s / a.length;
}

function shortLabel(label: string): string {
  const m = /(\d+)\s*$/.exec(label);
  if (m) return m[1];
  if (/^found/i.test(label)) return 'F';
  return label.slice(0, 3);
}

/**
 * Arc from P to Q holding `n` chains: a cubic Bézier that bulges outward (away from the centre /
 * upward) at the chord's midpoint until it is long enough for the chains (L = n·pitch + 2·pad).
 * Bulging along the outward direction rather than the chord normal keeps the two loops on either
 * side of a stitch sitting in a valley from crossing. Returns chain centres + tangent angles.
 */
function chainArc(F: Frame, radial: boolean, P: Pt, Q: Pt, n: number, sHint: number, _dir: number) {
  const L = n * DIM.chainPitch + 2 * DIM.chainEndPad;
  const dx = Q.x - P.x, dy = Q.y - P.y;
  const c = Math.hypot(dx, dy);
  const mx = (P.x + Q.x) / 2, my = (P.y + Q.y) / 2;
  const [ox, oy] = radial ? F.out(mx, my, sHint) : [0, -1];
  const ux = c > 1e-9 ? dx / c : -oy, uy = c > 1e-9 ? dy / c : ox;
  const arm = Math.max(c / 3, 0.18);
  const ctrl = (h: number) => ({
    c1: { x: P.x + ux * arm + ox * h, y: P.y + uy * arm + oy * h },
    c2: { x: Q.x - ux * arm + ox * h, y: Q.y - uy * arm + oy * h },
  });
  const at = (t: number, c1: Pt, c2: Pt): Pt => {
    const u = 1 - t;
    return {
      x: u * u * u * P.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * Q.x,
      y: u * u * u * P.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * Q.y,
    };
  };
  const M = 40;
  const lengthOf = (h: number) => {
    const { c1, c2 } = ctrl(h);
    let len = 0, px = P.x, py = P.y;
    for (let i = 1; i <= 16; i++) { const q = at(i / 16, c1, c2); len += Math.hypot(q.x - px, q.y - py); px = q.x; py = q.y; }
    return len;
  };
  const sample = (h: number) => {
    const { c1, c2 } = ctrl(h);
    const pts: Pt[] = [];
    const cum: number[] = [0];
    for (let i = 0; i <= M; i++) pts.push(at(i / M, c1, c2));
    for (let i = 1; i <= M; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { pts, cum, c1, c2 };
  };
  // gentle sag-free bow when the chord is long enough; otherwise solve the bulge for the length
  let h = Math.min(0.25, c * 0.08);
  let sm = sample(h);
  if (sm.cum[M] < L) {
    let lo = h, hi = Math.max(1, L);
    while (lengthOf(hi) < L && hi < 1e4) hi *= 2;
    for (let it = 0; it < 20; it++) { const mid = (lo + hi) / 2; if (lengthOf(mid) < L) lo = mid; else hi = mid; }
    h = hi; sm = sample(h);
  }
  const total = sm.cum[M];
  const pad = Math.min(DIM.chainEndPad, total * 0.18);
  const pitch = (total - 2 * pad) / n;
  const pts: { x: number; y: number; rot: number }[] = [];
  let j = 1;
  for (let q = 0; q < n; q++) {
    const target = pad + (q + 0.5) * pitch;
    while (j < M && sm.cum[j] < target) j++;
    const a = sm.pts[j - 1], b = sm.pts[j];
    const seg = sm.cum[j] - sm.cum[j - 1] || 1;
    const f = (target - sm.cum[j - 1]) / seg;
    pts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, rot: Math.atan2(b.y - a.y, b.x - a.x) });
  }
  let apex = 0;
  for (const p of sm.pts) apex = Math.max(apex, F.height(p.x, p.y));
  const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
  const d = `M${f3(P.x)} ${f3(P.y)}C${f3(sm.c1.x)} ${f3(sm.c1.y)} ${f3(sm.c2.x)} ${f3(sm.c2.y)} ${f3(Q.x)} ${f3(Q.y)}`;
  return { pts, d, apex };
}

/**
 * A valley bridge of a pointed round from P to Q holding `n` chains, drawn the way it blocks (the
 * designer's Preview): pinned out into a V — from P out to a pin on the bisector and back to Q,
 * the pin as far out as the chains reach (rise = ½·√(L² − d²)), the V's apex softened (a quadratic
 * through the pin). Chains evenly spaced along it, clear of the stitches at both ends.
 */
function bridgeArc(P: Pt, Q: Pt, n: number, maxRise: number) {
  const pad = 0.36;
  const L = n * DIM.chainPitch + 2 * pad;
  const mx = (P.x + Q.x) / 2, my = (P.y + Q.y) / 2;
  const rm = Math.hypot(mx, my);
  const ox = rm > 1e-9 ? mx / rm : 0, oy = rm > 1e-9 ? my / rm : -1; // outward
  const c = Math.hypot(Q.x - P.x, Q.y - P.y);
  // the pin: the apex of a V of total length L over the chord (a taut bridge still bows a little)
  // (capped: a long bridge is drawn as a compact V with its chains closer together — the chart
  // shows the count, the Preview and the template the length)
  const rise = Math.min(maxRise * c, Math.max(0.1 * c, 0.5 * Math.sqrt(Math.max(0, L * L - c * c))));
  const pin = { x: mx + ox * rise, y: my + oy * rise };
  const C = { x: 2 * pin.x - mx, y: 2 * pin.y - my };
  const at = (t: number): Pt => {
    const u = 1 - t;
    return { x: u * u * P.x + 2 * u * t * C.x + t * t * Q.x, y: u * u * P.y + 2 * u * t * C.y + t * t * Q.y };
  };
  const M = 48;
  const pts: Pt[] = [], cum = [0];
  for (let i = 0; i <= M; i++) pts.push(at(i / M));
  for (let i = 1; i <= M; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[M];
  const pd = Math.min(pad, total * 0.2);
  const step = (total - 2 * pd) / n;
  const out: { x: number; y: number; rot: number }[] = [];
  let j = 1;
  for (let q = 0; q < n; q++) {
    const target = pd + (q + 0.5) * step;
    while (j < M && cum[j] < target) j++;
    const a = pts[j - 1], b = pts[j];
    const f = (target - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, rot: Math.atan2(b.y - a.y, b.x - a.x) });
  }
  let apex = 0;
  for (const p of pts) apex = Math.max(apex, Math.hypot(p.x, p.y));
  const d = `M${r3(P.x)} ${r3(P.y)}Q${r3(C.x)} ${r3(C.y)} ${r3(Q.x)} ${r3(Q.y)}`;
  return { pts: out, d, apex, pin: { x: pin.x, y: pin.y }, step };
}

function circlePath(cx: number, cy: number, r: number): string {
  const f = (v: number) => (Math.round(v * 1000) / 1000).toString();
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
}

function emptyB(): Bounds { return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }; }
function growPt(b: Bounds, x: number, y: number, pad: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  b.minX = Math.min(b.minX, x - pad); b.minY = Math.min(b.minY, y - pad);
  b.maxX = Math.max(b.maxX, x + pad); b.maxY = Math.max(b.maxY, y + pad);
}
function unionB(b: Bounds, o: Bounds) {
  b.minX = Math.min(b.minX, o.minX); b.minY = Math.min(b.minY, o.minY);
  b.maxX = Math.max(b.maxX, o.maxX); b.maxY = Math.max(b.maxY, o.maxY);
}

/** Bounds of rounds 0..upto (inclusive), padded. */
export function boundsUpto(layout: ChartLayout, upto?: number, pad = 0.6): Bounds {
  const b = emptyB();
  for (const r of layout.rounds) if (r.first >= 0 && (upto === undefined || r.index <= upto)) unionB(b, r.bounds);
  if (layout.ring) growPt(b, 0, 0, layout.ring.r + 0.3);
  if (!Number.isFinite(b.minX)) return { ...layout.bounds };
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}


/* ------------------------------------------------------------------ arms (pointed rounds) */

/** Branch picots leave the spine at ±50°, side picots of a trefoil tip at ±88° (beside the tip loop). */
const BRANCH = (50 * Math.PI) / 180;
const TIP_BRANCH = (88 * Math.PI) / 180;
/** Half-angle of the opening at the bottom of a tip loop (where it closes on the spine). */
const LOOP_GAP = 0.5;
/** Picots on arms are drawn as larger loops (they are the fronds of the arm). */
const ARM_PICOT = 1.3;
/** Shortest chain runs either side of a picot that make a pointed loop. */
const LOOP_MIN = 4;
const OUTLINE_N = 240;
/** How fast the outline of a pointed round falls off sideways from a symbol (per unit of arc). */
const OUTLINE_SLOPE = 0.9;
const r3 = (v: number) => String(Math.round(v * 1000) / 1000);
/** Half-length of a chain oval (symbols.ts SYM.chRx). */
const SYM_CH_RX = 0.25;

interface ArmInfo {
  kind: 'spine' | 'loop';
  first: number;
  last: number;
  /** spine: chains base → highest chain worked back into; tip: chains beyond (the tip loop). */
  spine: number[];
  tip: number[];
  /** loop: chains out, picots at the top, chains back. */
  a: number[];
  picots: number[];
  b: number[];
}

const plainCh = (g: Graph, id: number, hub: Uint8Array) => { const n = g.nodes[id]; return n.type === 'ch' && n.role !== 'tch' && !hub[id]; };

/** Last node of an arm whose chain run is `c0..c1`: everything worked into its chains (or into chains made on the way back) in this round. */
function armEnd(g: Graph, kids: number[][], k: number, c0: number, c1: number, limit: number): number {
  let end = c1 + 1;
  for (let c = c0; c <= end; c++) {
    if (g.nodes[c].type !== 'ch') continue;
    for (const x of kids[c]) {
      if (x <= end || x > limit || g.nodes[x].round !== k) continue;
      // the round's join into a chain at its start is not part of an arm
      if (x === g.rounds[k].last && g.nodes[x].type === 'slst') continue;
      end = x;
    }
  }
  return end;
}

/** Highest index (0-based within c0..c1) of the run's chains that nodes from..to are worked into. */
function workedMax(g: Graph, c0: number, c1: number, from: number, to: number): number {
  let jm = -1;
  for (let x = from; x <= to; x++) for (const a of g.nodes[x].into) if ('node' in a && a.node >= c0 && a.node <= c1) jm = Math.max(jm, a.node - c0);
  return jm;
}

/**
 * Arms of round k, from the graph alone:
 *  - spine: a run of chains followed straight away by a stitch worked back into one of them
 *    ("sl st in 4th ch from hook"); the arm runs to the last node worked into its chains. Chains
 *    beyond the highest chain worked into are the tip loop.
 *  - loop: ch ≥ 4, picot(s), ch ≥ 4 with nothing worked into those chains in this round — a long
 *    pointed chain loop with a picot at its top.
 */
function detectArms(g: Graph, k: number, first: number, last: number, kids: number[][], hub: Uint8Array): ArmInfo[] {
  const out: ArmInfo[] = [];
  let id = first;
  while (id <= last) {
    if (!plainCh(g, id, hub)) { id++; continue; }
    let e = id;
    while (e + 1 <= last && plainCh(g, e + 1, hub)) e++;
    const run: number[] = [];
    for (let c = id; c <= e; c++) run.push(c);
    const a0 = e + 1 <= last ? g.nodes[e + 1].into[0] : undefined;
    if (a0 && 'node' in a0 && a0.node >= id && a0.node <= e) {
      const end = armEnd(g, kids, k, id, e, last);
      const jm = workedMax(g, id, e, e + 1, end);
      out.push({ kind: 'spine', first: id, last: end, spine: run.slice(0, jm + 1), tip: run.slice(jm + 1), a: [], picots: [], b: [] });
      id = end + 1;
      continue;
    }
    if (run.length >= LOOP_MIN) {
      let p = e + 1;
      const pics: number[] = [];
      while (p <= last && g.nodes[p].type === 'picot') pics.push(p++);
      if (pics.length && p <= last && plainCh(g, p, hub)) {
        let f = p;
        while (f + 1 <= last && plainCh(g, f + 1, hub)) f++;
        const b: number[] = [];
        for (let c = p; c <= f; c++) b.push(c);
        const free = [...run, ...b].every((c) => !kids[c].some((x) => g.nodes[x].round === k));
        if (b.length >= LOOP_MIN && free) {
          out.push({ kind: 'loop', first: id, last: f, spine: [], tip: [], a: run, picots: pics, b });
          id = f + 1;
          continue;
        }
      }
    }
    id = e + 1;
  }
  return out;
}

/**
 * Blocking outline of a pointed round: a polygon through the arm tips and, between neighbouring
 * arms, the pins of the valley bridges (where they are pinned out), in working order.
 */
function hullOf(arms: ChartArm[], bridges: { ids: number[]; pin: Pt }[], dir: number): Pt[] {
  if (arms.length < 2) return [];
  const ang = (p: Pt) => Math.atan2(-p.y, p.x);
  const s0 = arms[0].s;
  const rel = (a: number) => mod(dir * (a - s0), TAU);
  const items: { t: number; p: Pt }[] = [];
  for (const a of arms) {
    const r = a.r1 + 0.2;
    items.push({ t: rel(a.s), p: { x: r * Math.cos(a.s), y: -r * Math.sin(a.s) } });
  }
  for (const b of bridges) items.push({ t: rel(ang(b.pin)), p: b.pin });
  items.sort((a, b) => a.t - b.t);
  return items.map((q) => ({ x: Math.round(q.p.x * 1000) / 1000, y: Math.round(q.p.y * 1000) / 1000 }));
}

/** Outline radius of a pointed round at angle θ (radians, counter-clockwise from 3 o'clock). */
export function outlineRadius(r: ChartRound, theta: number): number {
  const o = r.outline;
  if (!o || !o.length) return r.rOuter;
  const M = o.length;
  const f = (mod(theta, TAU) / TAU) * M;
  const i = Math.floor(f) % M;
  const t = f - Math.floor(f);
  return o[i] * (1 - t) + o[(i + 1) % M] * t;
}
