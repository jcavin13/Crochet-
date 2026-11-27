/**
 * Analytic flatness check — implementation of spec/flatness.md.
 * Pure function of (graph, params); no simulation.
 */
import type { Graph, Node } from '../graph';
import { stitchCounting } from '../graph';
import { simConfig, stitchParam, heightOf, type ParamSet } from '../params';
import { cornerGroups, detectPolygon, detectStadiumRectangle, borderCornerGroups, type PolygonInfo } from './corners';
import { polygonCheck, polygonCornerGrowth, edgeFit, fitRowEnds, ruleText, type EdgeClass, type PolygonInput } from './polygon';
import { borderListsCached, nodeCounts, anchorId, type Entry } from '../graph/targets';

export type ShapeClass = 'flat' | 'cup' | 'ruffle';
export type RoundClass = ShapeClass | 'n/a';
/**
 * Which rule judged a round: the circle rule; the n-gon rule (a polygon worked from the centre,
 * detected by `detectPolygon`); the border rules (edge fit per side + polygon rule per corner,
 * for rounds worked round rows); or none (rows).
 */
export type RoundShape = 'circle' | 'polygon' | 'border' | 'rows';

export { cornerGroups, detectPolygon, detectStadium, detectStadiumRectangle, borderCornerGroups } from './corners';
export type { PolygonInfo } from './corners';
export * from './polygon';

/** A round's corner group, described for a crocheter, and the group the rule asks for. */
export interface CornerEdit {
  /** "(3 dc, ch 2, 3 dc)" / "3 sc" — the corner group the round has now */
  now: string;
  /** the corner group that would put the round within tolerance, or undefined when it already is */
  suggest?: string;
  /** stitches to add (+) / remove (−) per corner group */
  delta: number;
}

/** Detail of a polygon round (shape 'polygon'). Distances in mm. */
export interface PolygonDetail {
  /** corners */
  n: number;
  /** apothem of the round's stitch tops (the polygon's inradius) */
  apothem: number;
  /** perimeter a flat n-gon needs there: 2·n·apothem·tan(π/n) */
  need: number;
  /** signed stitches over (+) / under (−) per corner, at the nominal course length */
  perCorner: number;
  /** stitches added along an average side (increases not in the corners), this round; NaN when unknown */
  sideIncrease: number;
  /** the first polygon round after circle rounds (a circle-to-square's squaring round) */
  transition: boolean;
  corner?: CornerEdit;
}

export interface BorderSide {
  /** "the top edge", "the first side (row ends)", "side 2"… */
  side: string;
  class: EdgeClass;
  /** stitches placed along the side (corner columns once), the side's length and what they cover (mm) */
  placed: number;
  lengthMm: number;
  coverMm: number;
  /** signed stitches too many (+) / too few (−) */
  off: number;
  rule: string;
  fix?: string;
  message: string;
}
export interface BorderCorner {
  /** node ids of the corner group (working order) */
  nodes: number[];
  /** this round's growth of the corner and what the polygon rule asks for, mm */
  growth: number;
  need: number;
  /** signed stitches over (+) / under (−) this round */
  off: number;
}
/** Detail of a border round (shape 'border'). */
export interface BorderDetail {
  /** the first border round: its sides are judged by the edge fit (later rounds: by the side growth) */
  edge: boolean;
  /** per side, the edge fit (first border round only; [] for later rounds) */
  sides: BorderSide[];
  corners: BorderCorner[];
  /** polygon rule over the border rounds so far: signed stitches per corner, accumulated */
  perCorner: number;
  /** signed stitches per side this round (later rounds; 0 on the edge round) */
  perSide: number;
  cornerClass: ShapeClass;
  cornerMessage: string;
  corner?: CornerEdit;
}

export interface RoundFlatness {
  round: number;            // index into graph.rounds
  label: string;
  class: RoundClass;
  /** Relative excess of course length over 2πρ: bounds from chain compliance, and nominal. */
  eMin: number; eMax: number; e: number;
  /** Signed: stitches over (+) or under (−) flat; 0 when flat or n/a. */
  stitchesOff: number;
  /** Stitch-top radius and radius handed to the next round (params units, mm). */
  rho: number; r: number;
  /** Incremental ratio: are this round's increases right for flat? (−1 tube … 0 flat … >0 ruffling). NaN for round 1. */
  g: number;
  cMin: number; cMax: number; c: number;
  /**
   * Signed stitches over (+) / under (−) flat at the *nominal* course length, for every
   * classified round — also for flat ones ("flat (+3 sts, within tolerance)"). 0 for n/a.
   */
  stitchesNominal: number;
  /**
   * The round is classified flat only thanks to chain compliance: its nominal excess `e` is
   * outside ±tol, but the chain-slack band [eMin, eMax] reaches back inside it. Such a round lies
   * flat only if its loops sag (e > tol: long, floppy loops) or are pulled taut (e < −tol).
   */
  slackOnly: boolean;
  /**
   * A cupping round that is far beyond a "fix a few stitches" correction: its stitch count is
   * decreasing (the shape is closing, as in a ball) or it is more than `closing_e` under flat
   * (a tube, cone or deep bowl). The message then says it is a 3D form instead of quoting an
   * absurd deficit. Numeric fields are unchanged.
   */
  closing: boolean;
  message: string;
  /** Which rule judged the round (additive; the numeric fields above are relative to that rule's need). */
  shape: RoundShape;
  /** shape 'polygon': the n-gon rule's detail */
  polygon?: PolygonDetail;
  /** shape 'border': per side and per corner */
  border?: BorderDetail;
}
export interface FlatnessReport {
  rounds: RoundFlatness[];
  /** Class of the last classifiable round ('n/a' if none). */
  final: RoundClass;
  /** The classifiable round furthest from flat, if any round is not flat. */
  worst: RoundFlatness | null;
  /** False when no round can be judged (a piece worked in rows without a border). */
  applicable: boolean;
  /** The polygon the piece was detected as (worked from the centre), if any. */
  polygon: PolygonInfo | null;
}
export interface FlatnessOptions { tol?: number; chainSlackMin?: number; chainNominal?: number }

const TAU = 2 * Math.PI;
/**
 * |e| beyond this (as a fraction): on a cupping round, a 3D form rather than a fixable flat piece;
 * on a round flat only by chain slack, "long, floppy loops" rather than loops that sag a little.
 */
export const CLOSING_E = 0.5;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function analyzeFlatness(graph: Graph, params: ParamSet, opts: FlatnessOptions = {}): FlatnessReport {
  const tol = opts.tol ?? simConfig.flatness.tol;
  const slack = opts.chainSlackMin ?? simConfig.flatness.chain_slack_min;
  const nominal = opts.chainNominal ?? simConfig.flatness.chain_nominal;
  const wch = stitchParam(params, 'ch').width;

  // chain id -> its chsp (only chsp chains are course elements); ring start radius
  const chspOf = new Map<number, number>();
  for (const s of graph.spaces) if (s.kind === 'chsp') for (const c of s.chains) chspOf.set(c, s.id);
  const firstRing = graph.spaces.find((s) => s.kind === 'ring');
  const inRound = graph.rounds.some((r) => r.kind === 'round') && !graph.rounds.some((r) => r.kind === 'row');
  // polygons worked from the centre (spec/flatness.md, "Polygons"); borders round rows ("Borders")
  const poly = inRound ? detectPolygon(graph) ?? detectStadiumRectangle(graph) : null;
  const borders = inRound ? new Map<number, RoundFlatness>() : borderRounds(graph, params, nominal);

  const out: RoundFlatness[] = [];
  let rPrev = firstRing ? (firstRing.chains.length * wch) / TAU : 0;
  let rhoPrev = rPrev, cPrev = 0, k = 0, countPrev = -1;
  // the polygon's own track: apothem handed on, and the previous round's stitch-top apothem
  let aPrev = NaN, aTopPrev = NaN, needPrev = NaN;

  for (const round of graph.rounds) {
    const b = borders.get(round.index);
    if (b) { out.push(b); continue; }
    const nodes: Node[] = round.first < 0 ? [] : graph.nodes.slice(round.first, round.last + 1);
    const st = nodes.filter(stitchCounting);
    // A turning chain that counts as X occupies the course like an X (flatness.md).
    const sumW = st.reduce((a, n) => a + stitchParam(params, n.countsAs ?? n.type).width, 0);
    const spaceIds = new Set<number>();
    let nCh = 0;
    for (const n of nodes) if (n.type === 'ch' && chspOf.has(n.id)) { nCh++; spaceIds.add(chspOf.get(n.id)!); }
    const base: RoundFlatness = {
      round: round.index, label: round.label, class: 'n/a', eMin: 0, eMax: 0, e: 0, stitchesOff: 0,
      rho: rhoPrev, r: rPrev, g: NaN, cMin: 0, cMax: 0, c: 0, stitchesNominal: 0, slackOnly: false, closing: false, message: `${round.label}: not worked in the round — flatness does not apply.`,
      shape: round.kind === 'round' ? 'circle' : 'rows',
    };
    if (!inRound || round.kind !== 'round' || (st.length === 0 && nCh === 0)) { out.push(base); continue; }
    k++;
    const hBar = mean(st.map((n) => heightOf(params, n)));
    const cMax = sumW + nCh * wch, cMin = sumW + nCh * wch * slack, c = sumW + nCh * wch * nominal;
    const magicStart = k === 1 && rPrev === 0;
    const rho = magicStart ? Math.max(hBar, c / TAU) : rPrev + hBar;
    const riseFor = (need: number) => {
      if (spaceIds.size === 0) return 0;
      const d = Math.max(0, need - sumW) / spaceIds.size;
      const L = (nCh / spaceIds.size) * wch;
      return L > d ? 0.5 * Math.sqrt(L * L - d * d) : 0;
    };
    const rise = riseFor(TAU * rho);
    const wBar = st.length ? sumW / st.length : wch;
    const decreasing = countPrev >= 0 && round.stitchCount < countPrev;

    // ---- which rule: the n-gon rule from the polygon's first cornered round on (not for a
    // round 1 worked into a magic ring, which is flat by construction)
    // A polygon's base round — round 1 into a chain ring with n chain spaces, as a granny
    // square's "(3 dc, ch 2) x4 in ring": its spaces are the corners the next round works into —
    // is judged against the n-gon from the centre too.
    const baseRound = !!poly && round.index === poly.from - 1 && k === 1 && !magicStart && spaceIds.size === poly.n;
    const isPoly = !!poly && (round.index >= poly.from || baseRound) && !magicStart;
    let need = TAU * rho, tolK = tol, top = rho, polygon: PolygonDetail | undefined;
    let sideInc = NaN, cornerNow: { ids: number[] } | null = null;
    let polyRise = 0, ownPerCorner = 0;
    if (isPoly) {
      const nP = poly!.n, T = Math.tan(Math.PI / nP);
      const first = !Number.isFinite(aPrev);
      const gs = poly!.groups.get(round.index) ?? cornerGroups(graph, round.index);
      const groups = gs.length === nP ? gs : [];
      const inCorner = new Set(groups.flat());
      const side = st.filter((n) => !inCorner.has(n.id));
      const sideH = groups.length && side.length ? side.map((n) => heightOf(params, n)) : [hBar];
      // a squaring round after two or more circle rounds (circle-to-square): judged against the
      // polygon it makes — apothem at the middle of a side, where its shortest stitches are
      const transition = first && k > 2;
      let a: number;
      if (baseRound) {
        a = rho;
        need = 2 * nP * a * T;
      } else if (transition) {
        a = rPrev + Math.min(...sideH);
        need = 2 * nP * a * T;
      } else {
        // the polygon rule, accumulated: each round adds 2·n·Δa·tan(π/n) to the perimeter the
        // round below needed. The first polygon round grows from the round below's own course and
        // from its stitch tops: that round's chain loops are where the corners are made (a granny
        // square's ch-2 corners), not a rise of the whole edge.
        a = (first ? rhoPrev : aPrev) + mean(sideH);
        need = (first ? cPrev : needPrev) + 2 * nP * T * (a - (first ? rhoPrev : aTopPrev));
      }
      if (first) aTopPrev = rhoPrev;
      // ±1 stitch per corner, or ±tol, whichever is larger (the polygon rule's tolerance)
      tolK = Math.max(tol, (nP * wBar) / need);
      top = a;
      // loops along the sides stand out and push the next round out; the corner groups' chain
      // spaces are the corners themselves (they make the polygon's points, not a rise of its edge)
      {
        const lo = new Map(groups.map((gr) => [gr[0], gr[gr.length - 1]] as [number, number]));
        const inCornerSpan = (id: number) => { for (const [a, b] of lo) if (id > a && id < b) return true; return false; };
        const sideSp = new Set<number>();
        let sideCh = 0, cornerCh = 0;
        for (const n of nodes) {
          if (n.type !== 'ch' || !chspOf.has(n.id)) continue;
          if (inCornerSpan(n.id)) cornerCh++; else { sideCh++; sideSp.add(chspOf.get(n.id)!); }
        }
        if (sideSp.size) {
          const d = Math.max(0, need - sumW - cornerCh * wch * nominal) / sideSp.size;
          const L = (sideCh / sideSp.size) * wch;
          polyRise = L > d ? 0.5 * Math.sqrt(L * L - d * d) : 0;
        }
      }
      // this round's own growth against its own requirement, per corner (for the corner edit)
      ownPerCorner = (transition || baseRound ? c - need : (c - cPrev) - (need - (first ? cPrev : needPrev))) / nP / wBar;
      if (groups.length) {
        // increases along the sides (not in the corners): side stitches minus the stitches of the round below they use
        const anchors = new Set<string>();
        let nS = 0;
        for (const n of side) {
          if (!n.into.length || !n.into.every((x) => 'node' in x && !x.part && graph.nodes[x.node]?.round === round.index - 1)) continue;
          nS++;
          for (const x of n.into) anchors.add(anchorId(x));
        }
        sideInc = (nS - anchors.size) / nP;
        cornerNow = { ids: typicalGroup(graph, groups) };
      }
      polygon = { n: nP, apothem: a, need, perCorner: 0, sideIncrease: sideInc, transition };
    }

    const eMax = cMax / need - 1, eMin = cMin / need - 1, e = c / need - 1;
    let cls: ShapeClass = 'flat', off = 0;
    if (eMax < -tolK) { cls = 'cup'; off = (cMax - need) / wBar; }
    else if (eMin > tolK) { cls = 'ruffle'; off = (cMin - need) / wBar; }
    const nominalOff = (c - need) / wBar;
    let g: number;
    if (isPoly) {
      const nP = poly!.n;
      g = k === 1 || top === aTopPrev ? NaN : (c - cPrev) / (2 * nP * Math.tan(Math.PI / nP) * (top - aTopPrev)) - 1;
    } else g = k === 1 || rho === rhoPrev ? NaN : (c - cPrev) / (TAU * (rho - rhoPrev)) - 1;
    const slackOnly = cls === 'flat' && Math.abs(e) > tolK;
    const closing = cls === 'cup' && (decreasing || eMax < -CLOSING_E);
    let message: string;
    if (cls === 'flat') {
      const n = Math.round(nominalOff);
      const shapeNote = polygon ? `${polygon.transition ? 'squaring round, judged against the ' : ''}${poly!.stadium ? 'rectangle' : shapeName(polygon.n)}` : '';
      if (slackOnly && e > CLOSING_E) {
        message = `${round.label} lies flat only if its chain loops take up the slack (${pct(e)} at nominal loop length) — expect long, floppy loops.`;
      } else if (slackOnly && e > 0) {
        message = `${round.label} lies flat only if its chain loops sag a little (${pct(e)} at nominal loop length).`;
      } else if (slackOnly) {
        message = `${round.label} lies flat only if its chain loops are pulled taut (${pct(e)} at nominal loop length) — expect tight, strained loops.`;
      } else if (polygon) {
        message = n === 0 ? `${round.label} lies flat (${shapeNote}).` : `${round.label} lies flat (${shapeNote}; ${n > 0 ? '+' : '−'}${Math.abs(n)} sts, within tolerance).`;
      } else {
        message = n === 0 ? `${round.label} lies flat.` : `${round.label} lies flat (${n > 0 ? '+' : '−'}${Math.abs(n)} sts, within tolerance).`;
      }
    } else if (closing) {
      message = decreasing
        ? `${round.label} closes the shape (far under flat) — this is a 3D form, not a flat piece.`
        : `${round.label} is far under flat (${pct(eMax)}) — this is a 3D form (tube, cone or deep bowl), not a flat piece.`;
    } else if (polygon) {
      const nP = polygon.n;
      const q = Math.max(1, Math.round(Math.abs(off) / nP));
      // the corner edit fixes this round's own share (earlier rounds have their own edits)
      const own = Math.sign(ownPerCorner) === (cls === 'cup' ? -1 : 1) && Math.abs(ownPerCorner) >= 0.5 ? Math.round(Math.abs(ownPerCorner)) : q;
      const delta = cls === 'cup' ? own : -own;
      const ce = cornerNow ? cornerEdit(graph, params, cornerNow.ids, delta) : undefined;
      polygon.corner = ce;
      const use = ce?.suggest ? `; use ${ce.suggest} in each corner (now ${ce.now})` : cls === 'cup' ? '; use a bigger corner group' : '; use a smaller corner group';
      if (cls === 'ruffle' && !polygon.transition && sideInc >= 1) {
        const sI = Math.round(sideInc);
        message = `${round.label}: the sides will wave — about ${sts(sI)} per side over flat (${pct(eMin)}); work one stitch in each stitch along the sides and keep the increases in the corners.`;
      } else if (cls === 'cup') {
        message = `${round.label}: corners are about ${sts(q)} short — the corners will cup (${pct(eMax)})${use}.`;
      } else {
        message = `${round.label}: corners are about ${sts(q)} over — the corners will ruffle (${pct(eMin)})${use}.`;
      }
    } else if (cls === 'cup') {
      message = `${round.label} will cup: about ${sts(Math.max(1, Math.round(Math.abs(off))))} under flat (${pct(eMax)}).`;
    } else {
      message = `${round.label} will ruffle: about ${sts(Math.max(1, Math.round(Math.abs(off))))} over flat (${pct(eMin)}).`;
    }
    if (polygon) {
      polygon.perCorner = nominalOff / polygon.n;
      // flat only with loose loops: the corner group that takes the slack out
      const loose = slackOnly && Math.abs(nominalOff / polygon.n) >= 0.5 ? -Math.sign(nominalOff) * Math.max(1, Math.round(Math.abs(nominalOff / polygon.n))) : 0;
      if (!polygon.corner && cornerNow) polygon.corner = cornerEdit(graph, params, cornerNow.ids, loose);
    }
    out.push({
      round: round.index, label: round.label, class: cls, eMin, eMax, e, stitchesOff: off, rho, r: rho + rise, g, cMin, cMax, c,
      stitchesNominal: nominalOff, slackOnly, closing, message, shape: polygon ? 'polygon' : 'circle', ...(polygon ? { polygon } : {}),
    });
    countPrev = round.stitchCount;
    // rho / r stay the circle rule's (the chart's radii and the sim read them); a polygon keeps its own apothem track
    rPrev = rho + rise; rhoPrev = rho; cPrev = c;
    // after a squaring round the polygon grows from what that round actually made (as the blanket studio does)
    if (polygon) { aTopPrev = polygon.apothem; aPrev = polygon.apothem + (baseRound ? 0 : polyRise); needPrev = polygon.transition || baseRound ? c : need; }
  }
  const real = out.filter((r) => r.class !== 'n/a');
  const dev = (r: RoundFlatness) => (r.class === 'cup' ? -r.eMax : r.class === 'ruffle' ? r.eMin : 0);
  const bad = real.filter((r) => r.class !== 'flat').sort((a, b) => dev(b) - dev(a));
  return { rounds: out, final: real.length ? real[real.length - 1].class : 'n/a', worst: bad[0] ?? null, applicable: real.length > 0, polygon: poly };
}

const SHAPE_NAMES: Record<number, string> = { 3: 'triangle', 4: 'square', 5: 'pentagon', 6: 'hexagon', 7: 'heptagon', 8: 'octagon' };
const shapeName = (n: number) => SHAPE_NAMES[n] ?? `${n}-gon`;
const sts = (n: number) => `${n} stitch${n === 1 ? '' : 'es'}`;
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)}%`;

/** The corner group most groups look like (a round's first group may hold a beginning cluster or a turning chain). */
function typicalGroup(graph: Graph, groups: number[][]): number[] {
  const sig = (ids: number[]) => ids.map((id) => stName(graph.nodes[id])).join(',');
  const tally = new Map<string, number>();
  for (const gr of groups) tally.set(sig(gr), (tally.get(sig(gr)) ?? 0) + 1);
  let best = groups[0];
  for (const gr of groups) if ((tally.get(sig(gr)) ?? 0) > (tally.get(sig(best)) ?? 0) || ((tally.get(sig(gr)) ?? 0) === (tally.get(sig(best)) ?? 0) && gr.length > best.length)) best = gr;
  return best;
}

/** Name of a stitch-counting node for a corner group: "dc", "3-dc cl", "puff". */
function stName(n: Node): string {
  if (n.tag === 'cluster') return `${n.into.length}-${n.type} cl`;
  return n.countsAs ?? n.type;
}

/**
 * A corner group (`ids`: its stitch-counting nodes, working order) as a crocheter writes it —
 * "(3 dc, ch 2, 3 dc)", "3 sc", "(2 sc, picot, 2 sc)" — and the group with `delta` more (+) or
 * fewer (−) stitches. A cluster corner changes its chain instead (a cluster is one stitch wide).
 */
export function cornerEdit(graph: Graph, params: ParamSet, ids: number[], delta: number): CornerEdit | undefined {
  if (!ids.length) return undefined;
  const lo = ids[0], hi = ids[ids.length - 1];
  const tally = new Map<string, number>();
  for (const id of ids) tally.set(stName(graph.nodes[id]), (tally.get(stName(graph.nodes[id])) ?? 0) + 1);
  if (tally.size !== 1) return undefined; // mixed stitches: no one-line rewrite
  const X = [...tally.keys()][0];
  const cnt = (k: number) => (k === 1 ? X : `${k} ${X}`);
  // what sits inside the group: chains and picots between the two halves
  const inIds = new Set(ids);
  let before = 0, chains = 0, picot = false, seenMid = false;
  for (let id = lo; id <= hi; id++) {
    const n = graph.nodes[id];
    if (inIds.has(id)) { if (!seenMid) before++; continue; }
    if (n.type === 'ch' && !n.countsAs) { chains++; seenMid = true; }
    else if (n.type === 'picot') { picot = true; seenMid = true; }
  }
  const s = ids.length, after = s - before;
  const mid = chains ? `ch ${chains}` : picot ? 'picot' : '';
  const write = (a: number, m: string, b: number) => (m ? `(${[a ? cnt(a) : '', m, b ? cnt(b) : ''].filter(Boolean).join(', ')})` : cnt(a + b));
  const now = write(mid ? before : s, mid, mid ? after : 0);
  if (!delta) return { now, delta: 0 };
  if (X.endsWith(' cl') && chains) {
    const w = stitchParam(params, graph.nodes[ids[0]].type).width, wc = stitchParam(params, 'ch').width;
    const c2 = Math.max(1, chains + Math.round((delta * w) / wc));
    return c2 === chains ? { now, delta } : { now, suggest: write(before, `ch ${c2}`, after), delta };
  }
  const s2 = s + delta;
  if (s2 < 1) return { now, delta };
  if (!mid) return { now, suggest: cnt(s2), delta };
  const a = Math.ceil(s2 / 2);
  return { now, suggest: write(a, mid, s2 - a), delta };
}

/* --------------------------------------------------------------------------------------------
 * Borders: rounds worked round a piece in rows (spec/flatness.md, "Borders"). The first border
 * round's sides are judged by the edge fit, every border round's corners by the polygon rule,
 * accumulated over the border rounds; later rounds' sides by their growth (polygonCheck).
 * ------------------------------------------------------------------------------------------ */

const EDGE_NAMES = ['Top edge', 'First side (row ends)', 'Bottom (foundation chain)', 'Second side (row ends)'];
const UNIT_NAMES = ['stitch', 'row end', 'foundation ch', 'row end'];
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

function borderRounds(graph: Graph, params: ParamSet, nominal: number): Map<number, RoundFlatness> {
  const out = new Map<number, RoundFlatness>();
  const lists = borderListsCached(graph);
  if (!lists.size) return out;
  const groupsBy = borderCornerGroups(graph);
  const wch = stitchParam(params, 'ch').width;
  const W = (n: Node) => stitchParam(params, n.countsAs ?? n.type).width;
  const nodesOf = (r: number) => { const R = graph.rounds[r]; return R.first < 0 ? [] : graph.nodes.slice(R.first, R.last + 1); };
  const stOf = (r: number) => nodesOf(r).filter(stitchCounting);
  /** a row's height: the mean stitch height, bobbles (clusters, puffs, popcorns) left out — they stand out of the fabric */
  const BOBBLE = (n: Node) => n.tag === 'cluster' || n.type === 'puff' || n.type === 'popcorn';
  const rowH = (r: number) => { const xs = stOf(r); const ys = xs.filter((n) => !BOBBLE(n)); return mean((ys.length ? ys : xs).map((n) => heightOf(params, n))); };
  /** a row's column width: the mean stitch width (a chain of a chain space spans one column) */
  const colW = (r: number) => mean(stOf(r).map(W)) || wch;
  const entryKey = (e: Entry) => (e.kind === 'space' ? `s${e.space}` : e.kind === 'rowEnd' ? `n${e.node}:side` : e.kind === 'base' ? `n${e.node}:base` : `n${e.node}`);
  /** width of each chain space of a border round, mm (see entryW) */
  const spaceW = new Map<number, number>();
  /** course length of each border round, mm */
  const courseOf = new Map<number, number>();
  const inputs: PolygonInput[] = [];
  const nodeSide = new Map<number, string>();
  let firstRow = -1, lastRow = -1;

  for (const r of [...lists.keys()].sort((a, b) => a - b)) {
    const list = lists.get(r)!;
    const R = graph.rounds[r];
    const edge = graph.rounds[r - 1]?.kind === 'row';
    if (edge) { lastRow = r - 1; firstRow = lastRow; while (firstRow - 1 >= 0 && graph.rounds[firstRow - 1].kind === 'row') firstRow--; }
    const nodes = nodesOf(r);
    const st = nodes.filter(stitchCounting);
    if (!st.length || firstRow < 0) continue;
    // width of what a stitch of this round is worked into (one column of the round below)
    const entryW = (e: Entry): number => {
      if (e.kind === 'stitch') return W(graph.nodes[e.node]);
      if (e.kind === 'space') return spaceW.get(e.space) ?? graph.spaces[e.space].chains.length * (edge ? colW(lastRow) : wch);
      if (e.kind === 'base') return colW(firstRow);
      return rowH(e.row);
    };
    const at = new Map(list.map((e, i) => [entryKey(e), i] as [string, number]));
    const legsAt = (n: Node) => n.into.map((x) => at.get(anchorId(x))).filter((i): i is number => i !== undefined);
    const worked = new Set<number>();
    for (const n of nodes) for (const i of legsAt(n)) worked.add(i);
    // a chain space is pulled to the width of what it bridges — the entries of the round below
    // passed over between the stitches either side of it, less how far those stitches' groups fan
    // out beyond their own base (a 3-dc group in one stitch covers about three) — or is as long as
    // its chains, whichever is more (the blanket studio's engine measures it the same way)
    const R0 = R.first;
    const fan = new Map<number, number>();
    for (const n of st) { const l = legsAt(n); if (l.length === 1) fan.set(l[0], (fan.get(l[0]) ?? 0) + W(n)); }
    const overhang = (i: number) => Math.max(0, ((fan.get(i) ?? 0) - entryW(list[i])) / 2);
    for (const s of graph.spaces) {
      if (s.round !== r || s.kind !== 'chsp' || !s.chains.length) continue;
      let i1: number | undefined, i2: number | undefined;
      for (let id = s.chains[0] - 1; id >= R0 && i1 === undefined; id--) { const n = graph.nodes[id]; const l = stitchCounting(n) ? legsAt(n) : []; if (l.length) i1 = Math.max(...l); }
      for (let id = s.chains[s.chains.length - 1] + 1; id <= R.last && i2 === undefined; id++) { const n = graph.nodes[id]; const l = stitchCounting(n) ? legsAt(n) : []; if (l.length) i2 = Math.min(...l); }
      let bridged = 0;
      if (i1 !== undefined && i2 !== undefined && i2 > i1 + 1) {
        for (let i = i1 + 1; i < i2; i++) if (!worked.has(i)) bridged += entryW(list[i]);
        bridged = Math.max(0, bridged - overhang(i1) - overhang(i2));
      }
      spaceW.set(s.id, Math.max(s.chains.length * wch, bridged));
    }
    const chW = (id: number) => { const sp = graph.spaces.find((s) => s.round === r && s.kind === 'chsp' && s.chains.includes(id)); return sp ? (spaceW.get(sp.id) ?? 0) / sp.chains.length : 0; };
    const course = st.reduce((a, n) => a + W(n), 0) + graph.spaces.reduce((a, s) => a + (s.round === r && s.kind === 'chsp' ? spaceW.get(s.id) ?? 0 : 0), 0);
    courseOf.set(r, course);

    const groups = (groupsBy.get(r) ?? []).map((ids) => ids.filter((id) => nodeCounts(graph.nodes[id]))).filter((x) => x.length);
    const inCorner = new Set(groups.flat());
    const nC = groups.length;
    const h = mean(st.map((n) => heightOf(params, n)));
    const wR = mean(st.map(W));
    // segment (side) of every list entry: the entries between corner j and corner j+1
    const corners = list.map((e, i) => (e.corner ? i : -1)).filter((i) => i >= 0);
    const seg = list.map((_e, i) => {
      let j = -1;
      for (let q = 0; q < corners.length; q++) if (corners[q] < i) j = q;
      return j < 0 ? corners.length - 1 : j;
    });
    // side names: the edge round's from the perimeter; later rounds' from the nodes they work into
    const segName = new Map<number, string>();
    const segKind = new Map<number, number>();
    for (let j = 0; j < corners.length; j++) {
      const ents = list.filter((e, i) => seg[i] === j && !e.corner);
      if (edge) {
        const sides = ents.map((e) => e.side ?? -1).filter((x) => x >= 0);
        const sk = sides.length ? sides[0] : list[corners[(j + 1) % corners.length]]?.side ?? j;
        segKind.set(j, sk);
        segName.set(j, EDGE_NAMES[sk] ?? `Side ${j + 1}`);
      } else {
        const tally = new Map<string, number>();
        for (const e of ents) {
          const ids = e.kind === 'space' ? graph.spaces[e.space].chains : [e.node];
          for (const id of ids) { const nm = nodeSide.get(id); if (nm) tally.set(nm, (tally.get(nm) ?? 0) + 1); }
        }
        const best = [...tally].sort((a, b) => b[1] - a[1])[0];
        segName.set(j, best ? best[0] : `Side ${j + 1}`);
      }
    }
    // nodes per side; every node of the round inherits the side of the last anchored node before it
    const sideNodes = new Map<number, Node[]>();
    const sideCh = new Map<number, number>();
    let cur = -1;
    for (const n of nodes) {
      if (n.into.length) { const i = at.get(anchorId(n.into[0])); if (i !== undefined) cur = list[i].corner ? -1 : seg[i]; }
      if (cur < 0 || inCorner.has(n.id)) continue;
      nodeSide.set(n.id, segName.get(cur)!);
      if (stitchCounting(n)) { const l = sideNodes.get(cur) ?? []; l.push(n); sideNodes.set(cur, l); }
      else if (n.type === 'ch') sideCh.set(cur, (sideCh.get(cur) ?? 0) + chW(n.id));
    }
    for (const gr of groups) for (const id of gr) nodeSide.set(id, 'corner');
    // corners: what each corner group adds to the course, against the polygon rule
    const cornerOut: BorderCorner[] = [];
    let cornerGrowth = 0;
    const need1 = polygonCornerGrowth(Math.max(3, nC), h);
    for (const ids of groups) {
      const lo = ids[0], hi = ids[ids.length - 1];
      let gw = 0;
      for (let id = lo; id <= hi; id++) gw += ids.includes(id) ? W(graph.nodes[id]) : graph.nodes[id].type === 'ch' ? chW(id) : 0;
      const ti = at.get(anchorId(graph.nodes[lo].into[0]));
      const growth = gw - (ti !== undefined ? entryW(list[ti]) : wR);
      cornerGrowth += growth;
      cornerOut.push({ nodes: ids, growth, need: need1, off: (growth - need1) / wR });
    }
    // the edge fit, per side (first border round)
    const sidesOut: BorderSide[] = [];
    if (edge) {
      for (let j = 0; j < corners.length; j++) {
        const sk = segKind.get(j) ?? j;
        const sn = sideNodes.get(j) ?? [];
        const ents = list.filter((e, i) => seg[i] === j && !e.corner);
        const cornerCols = list.filter((e) => e.corner && e.side === sk);
        const lengthMm = sk === 0 ? list.filter((e) => e.side === 0).reduce((a, e) => a + entryW(e), 0)
          : sk === 2 ? list.filter((e) => e.side === 2).length * colW(firstRow)
            : ents.reduce((a, e) => a + (e.kind === 'rowEnd' ? rowH(e.row) : 0), 0);
        const cover = sn.reduce((a, n) => a + W(n), 0) + (sideCh.get(j) ?? 0) + cornerCols.reduce((a, e) => a + entryW(e), 0);
        const placed = sn.length + cornerCols.length;
        if (!placed || lengthMm <= 0) continue;
        const tally = new Map<string, number>();
        for (const n of sn) tally.set(stName(n), (tally.get(stName(n)) ?? 0) + 1);
        const X = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'sc';
        const units = ents.filter((e) => e.kind !== 'space').length;
        const unit = UNIT_NAMES[sk] ?? 'stitch';
        let rule = `${sn.length} ${X}`;
        if (units) {
          const d = gcd(sn.length, units), a = sn.length / d, b = units / d;
          rule = b === 1 ? `${a} ${X} per ${unit}` : b <= 6 ? `${a} ${X} per ${b} ${unit}s` : `${sn.length} ${X} over ${units} ${unit}s`;
        }
        let fix: string | undefined;
        if ((sk === 1 || sk === 3) && X === 'sc' && units && sn.length) {
          const fr = fitRowEnds(lengthMm / units, W(sn[0]));
          if (Math.abs(fr.num / fr.den - sn.length / units) > 1e-9) fix = ruleText(fr);
        }
        sidesOut.push(edgeFit(segName.get(j)!, placed, lengthMm, cover / placed, rule, fix));
      }
    }
    // the polygon rule over the border rounds, accumulated, on the corner groups' growth; a later
    // round's sides by their own growth (polygonCheck's side check: more than tol of their length)
    const before = courseOf.get(r - 1);
    inputs.push({ label: R.label, cornerGrowth, corners: nC, height: h, ...(edge || before === undefined ? {} : { before, after: course }) });
    const pc = polygonCheck(Math.max(3, nC), inputs, wR)[inputs.length - 1];
    const perSide = pc.perSide;
    const sidesCarry = pc.class !== 'flat' && /sides will/.test(pc.message);
    // the round's verdict: the worst of the corners and (edge round) the sides
    const rel: { cls: ShapeClass; rel: number; off: number }[] = [];
    for (const s of sidesOut) if (s.class !== 'ok') rel.push({ cls: s.class === 'wavy' ? 'ruffle' : 'cup', rel: s.coverMm / s.lengthMm - 1, off: s.off });
    if (pc.class !== 'flat') rel.push(sidesCarry
      ? { cls: pc.class, rel: (pc.perSide * wR * Math.max(1, nC)) / Math.max(1e-9, before ?? course), off: pc.perSide * Math.max(1, nC) }
      : { cls: pc.class, rel: (pc.perCorner * wR) / (need1 * Math.max(1, inputs.length)), off: pc.perCorner * Math.max(1, nC) });
    rel.sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel));
    const worst = rel[0];
    const cls: ShapeClass = worst ? worst.cls : 'flat';
    const big = groups.length ? typicalGroup(graph, groups) : [];
    // the corner edit: this round's own shortfall / excess per corner (earlier rounds have their own)
    const own = cornerOut.length ? cornerOut.reduce((a, c) => a + c.off, 0) / cornerOut.length : 0;
    const step = Math.abs(own) >= 0.5 && Math.sign(own) === Math.sign(pc.perCorner) ? Math.round(Math.abs(own)) : Math.max(1, Math.round(Math.abs(pc.perCorner)));
    const delta = pc.class === 'flat' || sidesCarry ? 0 : pc.perCorner < 0 ? step : -step;
    const ce = big.length ? cornerEdit(graph, params, big, delta) : undefined;
    let cornerMessage = pc.message;
    if (ce?.suggest) cornerMessage = cornerMessage.replace(/; use a (bigger|smaller) corner group\.$/, `; use ${ce.suggest} in each corner (now ${ce.now}).`);
    let message: string;
    if (cls === 'flat') {
      const q = Math.round(Math.abs(pc.perCorner) * 10) / 10;
      message = `${R.label} lies flat: ${edge ? 'every side fits its edge and ' : ''}the corners lie flat${q >= 0.5 ? ` (${pc.perCorner > 0 ? '+' : '−'}${q} st per corner, within tolerance)` : ''}.`;
    } else {
      const sides = sidesOut.filter((s) => s.class !== 'ok').map((s) => s.message);
      const parts = sides.length ? [`${R.label} — ${sides.join(' ')}`] : [];
      if (pc.class !== 'flat') parts.push(cornerMessage);
      // corners and sides both off: say so for the sides too
      if (pc.class !== 'flat' && !sidesCarry && before && Math.abs(pc.perSide) >= 1 && Math.abs((pc.perSide * wR * Math.max(1, nC)) / before) > simConfig.flatness.tol) {
        const q = Math.round(Math.abs(pc.perSide) * 10) / 10;
        parts.push(`The sides will ${pc.perSide > 0 ? 'wave' : 'pull in'} too — about ${q} stitches per side ${pc.perSide > 0 ? 'more' : 'fewer'} than they need.`);
      }
      message = parts.join(' ');
    }
    const e = worst ? worst.rel : 0;
    out.set(r, {
      round: r, label: R.label, class: cls, eMin: e, eMax: e, e, stitchesOff: worst ? worst.off : 0, rho: 0, r: 0, g: NaN,
      cMin: course, cMax: course, c: course, stitchesNominal: worst ? worst.off : 0, slackOnly: false, closing: false, message, shape: 'border',
      border: { edge, sides: sidesOut, corners: cornerOut, perCorner: pc.perCorner, perSide, cornerClass: pc.class, cornerMessage, ...(ce ? { corner: ce } : {}) },
    });
  }
  return out;
}

