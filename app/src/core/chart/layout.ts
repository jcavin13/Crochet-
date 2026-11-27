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
 * Rows (any `Row` round): the same machinery with x for the angle and height for the radius.
 */
import { analyzeFlatness, type RoundFlatness } from '../flatness';
import { childrenOf, type Graph, type Node } from '../graph';
import { heightOf, stitchParam, type ParamSet } from '../params';
import { solveOrdered } from './solve';
import { symbolOf } from './symbols';
import type { Bounds, ChartLayout, ChartNode, ChartNodeKind, ChartRound, ChartSpace, LayoutOptions, Pt } from './types';

const TAU = Math.PI * 2;

/** Display constants (chart units = sc widths). */
export const DIM = {
  stHalf: 0.32,
  clusterHalf: 0.42,
  tchHalf: 0.34,
  tchLooseHalf: 0.22,
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

type ItemKind = 'st' | 'tch' | 'tchLoose' | 'ch' | 'join' | 'picot';
interface Item { ids: number[]; rep: number; kind: ItemKind; half: number; w: number; t: number }

interface Frame {
  pos(s: number, h: number): [number, number];
  height(x: number, y: number): number;
  course(x: number, y: number): number;
  out(x: number, y: number, s: number): [number, number];
}
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
  const F = radial ? radialFrame : rowFrame;
  const minGap = opts.minRoundGap ?? 0.8;
  const fill = opts.fill ?? 0.96;
  const start = opts.startAngle ?? Math.PI / 2;
  const unit = stitchParam(params, 'sc').width || 1;
  const hOf = (n: Node) => heightOf(params, n) / unit;
  const wRel = (n: Node) => stitchParam(params, n.type).width / unit;
  const flat = radial ? analyzeFlatness(graph, params) : undefined;

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

  const place = (id: number, x: number, y: number, rot: number, tx = x, ty = y) => {
    X[id] = x; Y[id] = y; TX[id] = tx; TY[id] = ty; ROT[id] = rot; placed[id] = 1;
    H[id] = F.height(tx, ty);
  };

  // spaces
  const chainSpace = new Int32Array(N).fill(-1);
  for (const s of graph.spaces) for (const c of s.chains) if (c >= 0 && c < N) chainSpace[c] = s.id;
  const kids = childrenOf(graph);
  const posInSpace: Map<number, number>[] = kids.spaces.map((ids) => new Map(ids.map((id, j) => [id, j + 1])));
  const ringR = new Float64Array(graph.spaces.length);
  for (const s of graph.spaces) {
    if (s.kind !== 'ring') continue;
    ringR[s.id] = s.chains.length ? Math.max(DIM.minChainRingR, (s.chains.length * DIM.chainPitch) / TAU) : DIM.magicR;
  }
  // Stitches worked into a space one after another (a shell written out, "3 dc in sp") or as one
  // compound (shell, V, inc) fan from one chain: the mean of their physics.md c_q positions.
  const fanJ = new Map<number, number>(); // node id -> effective j
  kids.spaces.forEach((list, sid) => {
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
    const m = kids.spaces[sp.id].length;
    const j = fanJ.get(n.id * 0x10000 + sp.id) ?? posInSpace[sp.id].get(n.id) ?? 1;
    const q = Math.min(nCh, Math.max(1, Math.floor((j * (nCh + 1)) / (m + 1) + 0.5)));
    const c = sp.chains[q - 1];
    if (!placed[c]) return null;
    return { x: X[c], y: Y[c], ramp: ramp[c], resolved: true };
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

    // --- ring chains of rings made in this round
    for (const sp of graph.spaces) {
      if (sp.kind !== 'ring' || sp.round !== k || ringPlaced.has(sp.id) || !sp.chains.length) continue;
      ringPlaced.add(sp.id);
      const n = sp.chains.length;
      const r0 = ringR[sp.id];
      sp.chains.forEach((c, j) => {
        const s = start + (TAU * (j + 0.5)) / n;
        const [x, y] = F.pos(s, r0);
        place(c, x, y, tangentRot(F, x, y, s, radial));
        S[c] = s; kind[c] = 'ringch';
      });
      const ring = { x: 0, y: 0 };
      spacesOut.push({ id: sp.id, round: k, kind: 'ring', d: circlePath(ring.x, ring.y, r0), apex: r0 });
    }
    for (const sp of graph.spaces) {
      if (sp.kind === 'ring' && sp.round === k && !sp.chains.length && !ringPlaced.has(sp.id)) {
        ringPlaced.add(sp.id);
        spacesOut.push({ id: sp.id, round: k, kind: 'ring', d: circlePath(0, 0, ringR[sp.id]), apex: ringR[sp.id] });
      }
    }

    // --- hub chains (centre of "ch 2, 6 sc in 2nd ch from hook")
    const anyPlacedBefore = first > 0 && placed.slice(0, first).some((p, i) => p && kind[i] !== 'ringch');
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

    // --- classify + build items
    const items: Item[] = [];
    const itemOf = new Int32Array(last - first + 1).fill(-1);
    const travel: number[] = [];
    const ringJoins: number[] = [];
    let run: number[] | null = null;
    const flushRun = (counting: boolean) => {
      if (!run) return;
      const rep = run[run.length - 1];
      items.push({
        ids: run, rep, kind: counting ? 'tch' : 'tchLoose',
        half: counting ? DIM.tchHalf : DIM.tchLooseHalf, w: counting ? 1 : 0.05, t: NaN,
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
        ? Math.max(DIM.clusterHalf, DIM.stHalf * wRel(n)) : DIM.stHalf * Math.max(1, wRel(n)) * (legsN > 2 ? 1.1 : 1);
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
        if (p && p.resolved) out.push(F.course(p.x, p.y));
        else {
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
    if (radial) {
      rho = Math.max(meanNat, prevTop + minGap, totalLin / (TAU * fill), flatTarget(k) / unit);
    } else {
      rho = Math.max(meanNat, prevTop + minGap);
    }
    // Push-out beyond the natural radius, shared in proportion to stitch height (a sc in a valley
    // stays short while the tall stitches of the round reach the round's radius).
    const hMean = stItems.length ? stItems.reduce((a, it) => a + hOf(graph.nodes[it.rep]), 0) / stItems.length : 1;
    const kappa = 1 + Math.max(0, rho - meanNat) / Math.max(0.3, hMean);

    if (central) {
      // spread evenly by width: round 1 into a ring, foundation chain
      let cum = 0;
      for (const it of items) {
        const c = cum + it.half;
        it.t = radial ? start + (dir * TAU * c) / Math.max(totalLin, 1e-9) : c;
        it.w = 1;
        cum += lin(it);
      }
    } else {
      for (const it of items) {
        if (it.kind === 'st' || it.kind === 'tch') {
          const a = rawLegCourse(graph.nodes[it.rep]);
          if (a.length) it.t = radial ? circMean(a) : a.reduce((x, y) => x + y, 0) / a.length;
        }
      }
      if (!radial) {
        // direction of a row from its anchors
        const fin = items.filter((it) => Number.isFinite(it.t));
        if (fin.length >= 2 && Math.abs(fin[fin.length - 1].t - fin[0].t) > 1e-6) dir = fin[fin.length - 1].t > fin[0].t ? 1 : -1;
        else dir = (-prevDir) as 1 | -1;
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
          if (ti >= 0 && Number.isFinite(items[ti].t)) it.t = items[ti].t + (radial ? dir * TAU : 0);
          if (Number.isFinite(it.t)) ref = it.t;
          continue;
        }
        if (!Number.isFinite(it.t)) continue;
        if (radial) {
          if (Number.isFinite(ref)) it.t = ref + dir * (mod(dir * (it.t - ref) + eps, TAU) - eps);
        }
        ref = it.t;
      }
      // interpolate the rest by width
      const cum: number[] = [];
      let c = 0;
      for (const it of items) { cum.push(c + it.half); c += lin(it); }
      const fins = items.map((it, i) => (Number.isFinite(it.t) ? i : -1)).filter((i) => i >= 0);
      const toC = (d: number) => (radial ? d / rho : d);
      if (fins.length === 0) {
        items.forEach((it, i) => { it.t = (radial ? start : 0) + dir * toC(cum[i]); });
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
          if (radial) {
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

    // --- solve the course
    const n = items.length;
    const target = new Float64Array(n), weight = new Float64Array(n), gap = new Float64Array(Math.max(0, n - 1));
    for (let i = 0; i < n; i++) { target[i] = dir * items[i].t; weight[i] = items[i].w; }
    const toCourse = (d: number) => (radial ? d / rho : d);
    for (let i = 0; i + 1 < n; i++) gap[i] = toCourse(items[i].half + items[i + 1].half);
    let wrapGap = n > 1 ? toCourse(items[n - 1].half + items[0].half) : 0;
    if (radial && n > 2) {
      // Spread a closed round round its circle: share most of the free circumference among the
      // gaps (less between stitches worked into the same place, so fans stay fans); the anchors
      // decide the rest.
      const span = dir * (items[n - 1].t - items[0].t);
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
        for (let i = 0; i < n; i++) { const kk = key(items[i]); if (kk || items[i].kind === 'st' || items[i].kind === 'tch') cur = kk; before[i] = cur; }
        cur = '';
        for (let i = n - 1; i >= 0; i--) { const kk = key(items[i]); if (kk || items[i].kind === 'st' || items[i].kind === 'tch') cur = kk; after[i] = cur; }
        const share = new Float64Array(n);
        let tot = 0;
        for (let i = 0; i < n; i++) {
          const a = items[i], b = items[(i + 1) % n];
          const ka = before[i], kb = after[(i + 1) % n];
          share[i] = a.kind === 'join' || b.kind === 'join' ? 0.15 : ka && ka === kb ? 0.3 : 1;
          tot += share[i];
        }
        const give = (0.8 * free) / tot;
        for (let i = 0; i + 1 < n; i++) gap[i] += share[i] * give;
        wrapGap += share[n - 1] * give;
      }
    }
    const sol = solveOrdered({
      target, weight, gap,
      maxSpan: radial && n > 1 ? TAU - wrapGap : undefined,
    });
    for (let i = 0; i < n; i++) for (const id of items[i].ids) { S[id] = dir * sol[i]; course[id] = 1; }

    // --- radii and positions of stitches and counting turning chains
    const spiral = radial && R.kind === 'round' && !R.joined;
    const hBar = stItems.length ? stItems.reduce((a, it) => a + hOf(graph.nodes[it.rep]), 0) / stItems.length : 0.5;
    const gK = spiral ? Math.min(Math.max(minGap, rho - prevTop), Math.max(minGap, hBar)) : 0;
    const s0 = n ? S[items[0].rep] : start;
    const rampOf = (s: number) => (spiral ? (Math.min(1, Math.max(0, (dir * (s - s0)) / TAU)) - 0.5) * gK : 0);
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
      let top = base - inh + hOf(nd) * kappa + rp;
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
          place(id, x, y, tangentRot(F, x, y, s, radial));
          ramp[id] = rampOf(s);
        });
      } else if (it.kind === 'join') {
        const nd = graph.nodes[it.rep];
        const a = nd.into[0];
        const t = a && 'node' in a ? a.node : -1;
        const h = t >= 0 && placed[t] ? H[t] : rho;
        const s = S[it.rep];
        const [x, y] = F.pos(s, h - 0.1);
        place(it.rep, x, y, tangentRot(F, x, y, s, radial));
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
      place(id, x, y, tangentRot(F, x, y, s, radial));
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
      place(id, x, y, tangentRot(F, x, y, s, radial));
      S[id] = s;
    }

    // --- chains: arcs between their neighbours
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
          place(id, x, y, tangentRot(F, x, y, S[id], radial));
        }
      } else {
        const P = endpoint(runIds[0] - 1, first, last, true);
        const Q = endpoint(runIds[runIds.length - 1] + 1, first, last, false);
        const arc = chainArc(F, radial, P, Q, runIds.length, S[runIds[0]], dir);
        runIds.forEach((id, q) => { const c = arc.pts[q]; place(id, c.x, c.y, c.rot); ramp[id] = rampOf(S[id]); });
        if (sp0 >= 0) spacesOut.push({ id: sp0, round: k, kind: 'chsp', d: arc.d, apex: arc.apex });
      }
      i = j + 1;
    }

    function endpoint(id: number, a: number, b: number, before: boolean): Pt {
      if (id >= a && id <= b && placed[id]) {
        const nd = graph.nodes[id];
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
    for (const id of ids) if (placed[id]) rOuter = Math.max(rOuter, H[id] + (kind[id] === 'picot' ? 0.5 : 0.2));
    for (const sp of spacesOut) if (sp.round === k) rOuter = Math.max(rOuter, sp.apex);
    const rMean = rc ? rs / rc : (ids.filter((id) => placed[id]).reduce((a, id) => a + H[id], 0) / Math.max(1, ids.filter((id) => placed[id]).length)) || rho;
    const r0band = roundsOut.length ? roundsOut[roundsOut.length - 1].r : 0;
    // label just before the first course symbol, half-way up the round
    let labelAt: Pt;
    if (radial) {
      const mid = Math.max(0.45, (prevTop + rMean) / 2);
      const [x, y] = F.pos(s0 - (dir * 0.62) / Math.max(mid, 0.5), mid);
      labelAt = { x, y };
    } else {
      const [x, y] = F.pos(s0 - dir * 0.9, (prevTop + rMean) / 2);
      labelAt = { x, y };
    }
    const b = emptyB();
    for (const id of ids) if (placed[id]) { growPt(b, X[id], Y[id], 0.45); growPt(b, TX[id], TY[id], 0.45); if (kind[id] === 'picot') { const [ox, oy] = [Math.cos(ROT[id]), Math.sin(ROT[id])]; growPt(b, X[id] + ox * 0.5, Y[id] + oy * 0.5, 0.2); } }
    growPt(b, labelAt.x, labelAt.y, 0.4);
    roundsOut.push({
      index: k, label: R.label, short: shortLabel(R.label), kind: R.kind, r: rMean, r0: r0band, rOuter: Math.max(rOuter, rMean),
      dir, joined: !!R.joined, labelAt, first, last, bounds: b, flat: fl, spiral: gK, s0,
    });
    prevTop = rMean;
    prevDir = dir;
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
      const rl = picotRadius(nd);
      cx = X[id] + Math.cos(ROT[id]) * rl; cy = Y[id] + Math.sin(ROT[id]) * rl;
    }
    const out: ChartNode = {
      id, round: nd.round, kind: k, type: nd.type, symbol: symbolOf(nd), x: X[id], y: Y[id], rot: ROT[id],
      legs: k === 'stitch' || (k === 'tch' && nd.countsAs) ? legs[id] : [], cx, cy, s: S[id], course: !!course[id], r: H[id],
    };
    if (role[id]) out.role = role[id];
    if (fan[id]) out.fan = true;
    return out;
  });

  const bounds = emptyB();
  for (const r of roundsOut) if (r.first >= 0) unionB(bounds, r.bounds);
  if (firstRing) growPt(bounds, 0, 0, ringR[firstRing.id] + 0.3);
  if (!Number.isFinite(bounds.minX)) Object.assign(bounds, { minX: -1, minY: -1, maxX: 1, maxY: 1 });

  return {
    mode, unit, nodes, spaces: spacesOut, rounds: roundsOut,
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
 * Circular arc from P to Q holding `n` chains, bulging outward (away from the centre / upward),
 * long enough for the chains: L = n·pitch + 2·pad. Returns chain centres + tangent angles.
 */
function chainArc(F: Frame, radial: boolean, P: Pt, Q: Pt, n: number, sHint: number, _dir: number) {
  const L = n * DIM.chainPitch + 2 * DIM.chainEndPad;
  let dx = Q.x - P.x, dy = Q.y - P.y;
  let c = Math.hypot(dx, dy);
  const mx = (P.x + Q.x) / 2, my = (P.y + Q.y) / 2;
  // outward normal
  let nx: number, ny: number;
  if (c < 1e-6) {
    const [ox, oy] = F.out(mx, my, sHint);
    nx = ox; ny = oy; dx = -oy * 1e-3; dy = ox * 1e-3; c = 1e-3;
  } else {
    nx = -dy / c; ny = dx / c;
    const [ox, oy] = radial ? F.out(mx, my, sHint) : [0, -1];
    if (nx * ox + ny * oy < 0) { nx = -nx; ny = -ny; }
  }
  let alpha: number;
  if (L <= c * 1.01) alpha = 0.3;
  else {
    const ratio = L / c;
    let lo = 1e-4, hi = 1.8 * Math.PI;
    const f = (a: number) => a / 2 / Math.sin(a / 2);
    if (f(hi) < ratio) alpha = hi;
    else {
      for (let it = 0; it < 48; it++) { const mid = (lo + hi) / 2; if (f(mid) < ratio) lo = mid; else hi = mid; }
      alpha = (lo + hi) / 2;
    }
  }
  const Rr = c / (2 * Math.sin(alpha / 2));
  const cxx = mx - nx * Rr * Math.cos(alpha / 2), cyy = my - ny * Rr * Math.cos(alpha / 2);
  const v0x = P.x - cxx, v0y = P.y - cyy;
  const rotv = (a: number): [number, number] => [v0x * Math.cos(a) - v0y * Math.sin(a), v0x * Math.sin(a) + v0y * Math.cos(a)];
  const apexX = cxx + nx * Rr, apexY = cyy + ny * Rr;
  const [hx, hy] = rotv(alpha / 2);
  const [gx, gy] = rotv(-alpha / 2);
  const sgn = Math.hypot(cxx + hx - apexX, cyy + hy - apexY) <= Math.hypot(cxx + gx - apexX, cyy + gy - apexY) ? 1 : -1;
  const Larc = Rr * alpha;
  const pad = Math.min(DIM.chainEndPad, Larc * 0.18);
  const pitch = (Larc - 2 * pad) / n;
  const pts: { x: number; y: number; rot: number }[] = [];
  for (let q = 0; q < n; q++) {
    const u = (pad + (q + 0.5) * pitch) / Larc;
    const a = sgn * alpha * u;
    const [vx, vy] = rotv(a);
    const ang = Math.atan2(vy, vx) + (sgn > 0 ? Math.PI / 2 : -Math.PI / 2);
    pts.push({ x: cxx + vx, y: cyy + vy, rot: ang });
  }
  const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
  const d = `M${f3(P.x)} ${f3(P.y)}A${f3(Rr)} ${f3(Rr)} 0 ${alpha > Math.PI ? 1 : 0} ${sgn > 0 ? 1 : 0} ${f3(Q.x)} ${f3(Q.y)}`;
  return { pts, d, apex: F.height(apexX, apexY) };
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

