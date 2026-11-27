/**
 * Blankets worked in the round from the centre: squares (granny, solid granny, mitred), circles,
 * circle-to-square, hexagons, octagons, rectangles from a foundation chain (worked round both
 * sides of it, notation.md 3.9) and mandala-style circles with a lace edge.
 *
 * Polygons are worked with the same round engine as borders (explicit corner targets: "in next
 * ch-2 sp"), so their corners follow the polygon rule; circles follow the flat-circle rule
 * (spec/flatness.md): the stitch count of round k is 2πρ_k / w.
 */
import { simConfig, stitchParam, type ParamSet } from '../params';
import { RoundSim, type RoundResult, type StType, type Tok } from './engine';
import { cornersOf, listPerimeter, workLayers, type BorderKind, type CornerStyle } from './borders';
import { polygonCheck, type PolygonInput, type PolygonRound } from './checks';
import type { Line } from './rect';

export type RoundStyleId = 'granny-square' | 'solid-square' | 'mitred-square' | 'circle' | 'circle-to-square' | 'hexagon' | 'octagon' | 'rect-round' | 'mandala';

export interface RoundStyle {
  id: RoundStyleId;
  name: string;
  blurb: string;
  shape: 'square' | 'circle' | 'hexagon' | 'octagon' | 'rectangle';
  /** polygon sides (0 for circles) */
  sides: number;
  /** texture rounds the style can cycle through */
  textures: BorderKind[];
  defaultTextures: BorderKind[];
  /** the blanket's size is width × width (true) or width × height */
  squareOnly: boolean;
}

export const ROUND_STYLES: RoundStyle[] = [
  { id: 'granny-square', name: 'Giant granny square', blurb: 'The classic: 3-dc groups and ch-1 spaces, (3 dc, ch 2, 3 dc) corners, one more group per side every round.', shape: 'square', sides: 4, textures: ['granny'], defaultTextures: ['granny'], squareOnly: true },
  { id: 'solid-square', name: 'Solid granny square', blurb: 'Solid dc rounds with chain-space corners; texture rounds (hdc, sc ridges) can be mixed in.', shape: 'square', sides: 4, textures: ['dc', 'hdc', 'sc', 'sc-blo'], defaultTextures: ['dc'], squareOnly: true },
  { id: 'mitred-square', name: 'Mitred square', blurb: 'Plain sc (or hdc) rounds with stitch corners: a dense, square-from-the-centre fabric.', shape: 'square', sides: 4, textures: ['sc', 'hdc', 'dc', 'sc-blo'], defaultTextures: ['sc'], squareOnly: true },
  { id: 'circle', name: 'Circle', blurb: 'A flat circle: every round adds the stitches the flat-circle rule asks for, increases staggered so it stays round.', shape: 'circle', sides: 0, textures: ['dc', 'hdc', 'sc', 'sc-blo'], defaultTextures: ['dc'], squareOnly: true },
  { id: 'circle-to-square', name: 'Circle to square', blurb: 'A dc circle centre, a squaring round graded sc → hdc → dc → tr towards the corners, then square rounds.', shape: 'square', sides: 4, textures: ['dc', 'hdc', 'sc', 'sc-blo'], defaultTextures: ['dc'], squareOnly: true },
  { id: 'hexagon', name: 'Hexagon', blurb: 'Six corners from a magic ring; corner groups follow the hexagon rule (+6.93 × round height per round).', shape: 'hexagon', sides: 6, textures: ['dc', 'hdc', 'sc', 'sc-blo'], defaultTextures: ['dc'], squareOnly: true },
  { id: 'octagon', name: 'Octagon', blurb: 'Eight corners; nearly round, with gentle points.', shape: 'octagon', sides: 8, textures: ['dc', 'hdc', 'sc', 'sc-blo'], defaultTextures: ['dc'], squareOnly: true },
  { id: 'rect-round', name: 'Rectangle in the round', blurb: 'Worked round both sides of a foundation chain, corners growing every round: no seams, no row ends.', shape: 'rectangle', sides: 4, textures: ['sc', 'hdc', 'dc', 'sc-blo'], defaultTextures: ['sc'], squareOnly: false },
  { id: 'mandala', name: 'Mandala circle', blurb: 'Bands of dc, hdc and ridge rounds on the flat-circle rule, finished with a chain-arc and picot lace edge.', shape: 'circle', sides: 0, textures: ['dc', 'hdc', 'sc', 'sc-blo'], defaultTextures: ['dc', 'dc', 'sc-blo', 'hdc'], squareOnly: true },
];
export const ROUND_STYLE_BY_ID: Record<RoundStyleId, RoundStyle> = Object.fromEntries(ROUND_STYLES.map((s) => [s.id, s])) as Record<RoundStyleId, RoundStyle>;

export interface RoundsInput {
  style: RoundStyleId;
  /** texture kinds, cycled round by round (allowed: style.textures) */
  textures: BorderKind[];
  corner: CornerStyle;
  /** finished size, mm (circles/polygons: across; rectangle: width × height) */
  widthMm: number;
  heightMm: number;
  P: ParamSet;
  /** colour key of round index i (0-based) */
  color: (i: number) => string;
  /** stop after this many rounds (the swatch) */
  maxRounds?: number;
  /** lace edge for mandalas */
  lace?: boolean;
}

export interface RoundsBuild {
  lines: Line[];
  polygon: PolygonRound[];
  /** finished size, mm */
  widthMm: number;
  heightMm: number;
  rounds: number;
  notes: string[];
}

const TEX_ST: Record<string, StType> = { sc: 'sc', hdc: 'hdc', dc: 'dc', 'sc-blo': 'sc', granny: 'dc' };
const tex = (i: RoundsInput, k: number): BorderKind => {
  const t = i.textures.filter((x) => ROUND_STYLE_BY_ID[i.style].textures.includes(x));
  const list = t.length ? t : ROUND_STYLE_BY_ID[i.style].defaultTextures;
  return list[k % list.length];
};

/** Across size of a polygon list: flat-to-flat for n sides of a perimeter p. */
export const acrossOf = (n: number, p: number) => (p / n) / Math.tan(Math.PI / n);

/* ------------------------------------------------------------------ first rounds */

interface Start { text: string; count: string; keys: Record<string, number>; toks: Tok[]; height: number }

function ringStart(style: RoundStyleId, first: BorderKind, P: ParamSet): Start {
  const w = (t: string) => stitchParam(P, t as StType).width;
  const h = (t: string) => stitchParam(P, t as StType).height;
  const wch = stitchParam(P, 'ch').width;
  const st = (type: string, corner = false): Tok => ({ k: 'st', type, w: w(type), corner });
  const sp = (n: number, corner = false): Tok => ({ k: 'sp', n, w: n * wch, corner });
  if (style === 'granny-square' || style === 'solid-square') {
    const toks: Tok[] = [st('dc'), st('dc'), st('dc'), sp(2, true)];
    for (let k = 0; k < 3; k++) toks.push(st('dc'), st('dc'), st('dc'), sp(2, true));
    return {
      text: 'ch 4, join to form ring, ch 3 (counts as dc), 2 dc in ring, ch 2, *3 dc in ring, ch 2* x3, join', count: '(12 dc, 4 ch-2 sps)',
      keys: { ch: 12, 'sl st': 2, 'turning ch': 3, dc: 11 }, toks, height: h('dc'),
    };
  }
  if (style === 'hexagon' || style === 'octagon') {
    const n = style === 'hexagon' ? 6 : 8;
    const c = style === 'hexagon' ? 2 : 1;
    const toks: Tok[] = [];
    for (let k = 0; k < n; k++) toks.push(st('dc'), st('dc'), sp(c, true));
    return {
      text: `mr, ch 3 (does not count as st), *2 dc in ring, ch ${c}* x${n}, join`, count: `(${2 * n} sts, ${n} ch-${c} sps)`,
      keys: { 'turning ch': 3, dc: 2 * n, ch: n * c, 'sl st': 1 }, toks, height: h('dc'),
    };
  }
  // mitred square: 8 sc / 8 hdc (corners every other st) or 12 dc (every third)
  const s = TEX_ST[first] ?? 'sc';
  const m = s === 'dc' ? 12 : 8;
  const every = m / 4;
  const toks: Tok[] = Array.from({ length: m }, (_, k) => st(s, k % every === every - 1 - (every === 3 ? 1 : 0)));
  const tch = s === 'sc' ? 'ch 1' : `ch ${s === 'hdc' ? 2 : 3} (does not count as st)`;
  return { text: `mr, ${tch}, ${m} ${s} in ring, join`, count: `(${m})`, keys: { 'turning ch': s === 'sc' ? 1 : s === 'hdc' ? 2 : 3, [s]: m, 'sl st': 1 }, toks, height: h(s) };
}

/** Granny round on a granny round: travel to the first corner, then groups in every space. */
function grannyRound(list: Tok[], P: ParamSet): RoundResult {
  const sim = new RoundSim(list, P, false);
  const c = cornersOf(list);
  // travel: sl st over the stitches before the first corner space, then into it
  for (let k = 0; k < c[0]; k++) sim.slst('st');
  sim.slst({ sp: 2 });
  sim.turningCounts('dc');
  sim.same([{ st: 'dc', n: 2 }, { ch: 2 }, { st: 'dc', n: 3 }]);
  sim.chain(1);
  const side = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (list[k].k === 'sp') { sim.into({ sp: list[k].n! }, [{ st: 'dc', n: 3 }]); sim.chain(1); }
  };
  for (let i = 0; i < c.length; i++) {
    if (i > 0) {
      sim.corner([{ st: 'dc', n: 3 }, { ch: 2 }, { st: 'dc', n: 3 }]);
      sim.chain(1);
    }
    side(c[i] + 1, i + 1 < c.length ? c[i + 1] : list.length);
  }
  sim.join();
  return sim.finish();
}

/* ------------------------------------------------------------------ circles */

/** Flat-circle rounds: counts from the cumulative radius, increases spread and staggered. */
function circleRounds(i: RoundsInput, targetDia: number, maxRounds: number, mult = 6): { lines: Line[]; checks: PolygonRound[]; list: Tok[]; rho: number } {
  const P = i.P;
  const w = stitchParam(P, 'sc').width;
  const lines: Line[] = [];
  const checks: PolygonRound[] = [];
  let rho = 0;
  let prev = 0;
  let list: Tok[] = [];
  const tol = simConfig.flatness.tol;
  for (let k = 0; k < maxRounds; k++) {
    const kind = tex(i, k);
    const s = TEX_ST[kind];
    const loop = kind === 'sc-blo' ? 'blo' as const : undefined;
    const h = stitchParam(P, s).height;
    let text: string, count: string, keys: Record<string, number>, N: number;
    if (k === 0) {
      N = s === 'dc' ? 12 : s === 'hdc' ? 8 : 6;
      rho = Math.max(h, (N * w) / (2 * Math.PI));
      const tch = s === 'sc' ? 'ch 1' : `ch ${s === 'hdc' ? 2 : 3} (does not count as st)`;
      text = `mr, ${tch}, ${N} ${s} in ring, join`;
      count = `(${N})`;
      keys = { 'turning ch': s === 'sc' ? 1 : s === 'hdc' ? 2 : 3, [s]: N, 'sl st': 1 };
      list = Array.from({ length: N }, () => ({ k: 'st' as const, type: s, w }));
    } else {
      rho += h;
      N = Math.max(prev, mult * Math.round((2 * Math.PI * rho) / w / mult));
      const inc = N - prev;
      const sim = new RoundSim(list, P, false);
      sim.turning(s);
      // increases at evenly spread positions, shifted half a step on alternate rounds (no corners)
      const end = k % 2 === 1;
      const incAt = new Set<number>();
      for (let j = 0; j < inc; j++) incAt.add(Math.min(prev - 1, Math.floor(((j + (end ? 1 : 0.5)) * prev) / inc + 1e-9) - (end ? 1 : 0)));
      for (let j = 0; j < prev; j++) sim.into('st', [{ st: s, n: incAt.has(j) ? 2 : 1, loop }]);
      sim.join();
      const r = sim.finish();
      text = r.text;
      count = r.count;
      keys = r.keys;
      list = r.next;
      N = r.stitches;
    }
    const C = N * w;
    const e = C / (2 * Math.PI * rho) - 1;
    const cls = e > tol ? 'ruffle' : e < -tol ? 'cup' : 'flat';
    const label = `Rnd ${k + 1}`;
    checks.push({ label, perCorner: 0, perSide: 0, class: cls, message: cls === 'flat' ? `${label} lies flat (flat-circle rule).` : `${label} will ${cls} (${Math.round(e * 100)}%).` });
    lines.push({ label: 'Rnd', n: k + 1, text, count, keys, color: i.color(k), section: 'rounds', height: h, note: kind === 'sc-blo' ? 'ridge round (back loops)' : undefined });
    prev = N;
    if (2 * rho >= targetDia - h / 2) break;
  }
  return { lines, checks, list, rho };
}

/* ------------------------------------------------------------------ the styles */

export function buildRounds(i: RoundsInput): RoundsBuild {
  const style = ROUND_STYLE_BY_ID[i.style];
  const P = i.P;
  const max = i.maxRounds ?? 400;
  const w = stitchParam(P, 'sc').width;
  const notes: string[] = [];
  const target = i.widthMm;

  if (style.id === 'circle' || style.id === 'mandala') {
    const lace = style.id === 'mandala' && (i.lace ?? true);
    const edgeMm = lace ? stitchParam(P, 'sc').height * 2 : 0;
    const c = circleRounds(i, target - 2 * edgeMm, max);
    const lines = c.lines;
    let list = c.list;
    if (lace && lines.length < max) {
      // lace edge: ch-3 arcs over every other stitch, then (2 sc, picot, 2 sc) in each arc
      const n = lines.length;
      const a = new RoundSim(list, P, false);
      a.turning('sc');
      for (let j = 0; j < list.length / 2; j++) { a.into('st', [{ st: 'sc' }]); a.chain(3); a.skip('st'); }
      a.join();
      const ra = a.finish();
      lines.push({ label: 'Rnd', n: n + 1, text: ra.text, count: ra.count, keys: ra.keys, color: i.color(n), section: 'rounds', height: stitchParam(P, 'sc').height, note: 'lace edge: chain arcs' });
      list = ra.next;
      if (lines.length < max) {
        const b = new RoundSim(list, P, false);
        b.turning('sc');
        for (const t of list) if (t.k === 'sp') b.into({ sp: 3 }, [{ st: 'sc', n: 2 }, { picot: true }, { st: 'sc', n: 2 }]);
        b.join();
        const rb = b.finish();
        lines.push({ label: 'Rnd', n: n + 2, text: rb.text, count: rb.count, keys: rb.keys, color: i.color(n + 1), section: 'rounds', height: stitchParam(P, 'sc').height, note: 'lace edge: picot scallops' });
      }
      notes.push('The lace edge is two rounds of chain arcs and picot scallops; chain arcs lie flat only if their loops sag a little — block the edge.');
    }
    const dia = 2 * c.rho + 2 * (lace ? edgeMm : 0);
    return { lines, polygon: c.checks, widthMm: dia, heightMm: dia, rounds: lines.length, notes };
  }

  if (style.id === 'circle-to-square') {
    // centre circle of about a third of the size (at least 3 rounds), then square it
    const centre = circleRounds({ ...i, textures: ['dc'] }, Math.max(target / 3, 4 * stitchParam(P, 'dc').height * 2), Math.min(max, 12), 12);
    const lines = centre.lines;
    const checks = centre.checks;
    if (lines.length >= max) return { lines, polygon: checks, widthMm: 2 * centre.rho, heightMm: 2 * centre.rho, rounds: lines.length, notes };
    // squaring round: corners at every quarter; heights graded so the tops lie on a square
    let list = centre.list;
    while (list.length % 4 !== 0) list = list.slice(0, -1); // (circle counts are multiples of 12)
    const q = list.length / 4;
    list = list.map((t, k) => ({ ...t, corner: k % q === 0 }));
    const types: StType[] = ['sc', 'hdc', 'dc', 'tr', 'dtr'];
    const hOf = (t: StType) => stitchParam(P, t).height;
    const pick = (need: number) => types.reduce((b, t) => (Math.abs(hOf(t) - need) < Math.abs(hOf(b) - need) ? t : b));
    const rho = centre.rho;
    const base = rho + hOf('sc');
    const cornerSt = pick(base * Math.SQRT2 - rho);
    const sim = new RoundSim(list, P, false);
    sim.turning(cornerSt);
    for (let c = 0; c < 4; c++) {
      sim.corner([{ st: cornerSt, n: 2 }, { ch: 2 }, { st: cornerSt, n: 2 }]);
      for (let j = 1; j < q; j++) {
        const theta = ((j / q) * Math.PI) / 2 - Math.PI / 4;
        sim.into('st', [{ st: pick(base / Math.cos(theta) - rho) }]);
      }
    }
    sim.join();
    const sq = sim.finish();
    lines.push({ label: 'Rnd', n: lines.length + 1, text: sq.text, count: sq.count, keys: sq.keys, color: i.color(lines.length), section: 'rounds', height: hOf('dc'), note: 'squaring round' });
    checks.push({ label: `Rnd ${lines.length}`, perCorner: 0, perSide: 0, class: 'flat', message: `Rnd ${lines.length} squares the circle: graded stitches (sc at the middle of each side up to ${cornerSt} at the corners) — not judged by the polygon rule; block it square.` });
    notes.push(`The squaring round grades the stitch height from sc at the middle of each side to ${cornerSt} at the corners, so the tops lie on a square.`);
    const rest = squareOn(i, sq.next, base * 2, lines.length, max);
    return { lines: [...lines, ...rest.lines], polygon: [...checks, ...rest.checks], widthMm: rest.across, heightMm: rest.across, rounds: lines.length + rest.lines.length, notes };
  }

  if (style.id === 'rect-round') {
    // a strip of L chains worked round both sides; corners grow every round
    const hs = stitchParam(P, 'sc').height;
    const texH = (k: number) => stitchParam(P, TEX_ST[tex(i, k)]).height;
    let W = i.widthMm, H = i.heightMm;
    if (H > W) { [W, H] = [H, W]; notes.push('Worked with the long side along the foundation chain (width and length swapped).'); }
    let R = 0, sum = hs;
    while (2 * (sum + texH(R)) <= H + texH(R) * 0.5 && R < 400) { sum += texH(R); R++; }
    const L = Math.max(3, Math.round((W - 2 * sum) / w));
    const lines: Line[] = [{ label: 'Foundation', n: 0, text: `ch ${L + 1}`, count: '', keys: { ch: L, 'turning ch': 1 }, color: i.color(0), section: 'rounds', height: 0 }];
    // Rnd 1: sc round both sides; 5 sc round each end, the 2nd and 4th of each five are corners
    const st = (corner = false): Tok => ({ k: 'st', type: 'sc', w, corner });
    const toks: Tok[] = [st(), ...Array.from({ length: L - 2 }, () => st()), st(), st(true), st(), st(true), st(), ...Array.from({ length: L - 2 }, () => st()), st(), st(true), st(), st(true)];
    lines.push({
      label: 'Rnd', n: 1, color: i.color(0), section: 'rounds', height: hs,
      text: `sc in 2nd ch from hook, sc in next ${L - 2} ch${L - 2 === 1 ? '' : 's'}, 5 sc in next ch, working along the other side of the chain, sc in next ${L - 2} ch${L - 2 === 1 ? '' : 's'}, 4 sc in next ch, join`,
      count: `(${2 * L + 6})`, keys: { sc: 2 * L + 6, 'sl st': 1 },
    });
    if (max <= 1) return { lines, polygon: [], widthMm: L * w + 2 * hs, heightMm: 2 * hs, rounds: 1, notes };
    const layers = Array.from({ length: Math.min(R, max - 1) }, (_, k) => ({ kind: tex(i, k), corner: i.corner }));
    const { rounds, checks } = workLayers(toks, layers, P, false, 4);
    const poly: PolygonInput[] = [];
    rounds.forEach((r, k) => {
      lines.push({ label: 'Rnd', n: k + 2, text: r.result.text, count: r.result.count, keys: r.result.keys, color: i.color(k + 1), section: 'rounds', height: r.result.height, note: r.kind === 'setup' ? r.note : undefined });
      poly.push({ ...checks[k], label: `Rnd ${k + 2}` });
    });
    const grown = rounds.reduce((a, r) => a + r.result.height, 0);
    notes.push('Round 1 goes round both sides of the foundation chain: the stitches on the second side go into the unused loops of the chain.');
    return { lines, polygon: polygonCheck(4, poly, w), widthMm: L * w + 2 * (hs + grown), heightMm: 2 * (hs + grown), rounds: lines.length - 1, notes };
  }

  // polygons from a ring: granny / solid / mitred squares, hexagon, octagon
  const n = style.sides;
  const s0 = ringStart(style.id, tex(i, 0), P);
  const lines: Line[] = [{ label: 'Rnd', n: 1, text: s0.text, count: s0.count, keys: s0.keys, color: i.color(0), section: 'rounds', height: s0.height }];
  const rest = squareOn(i, s0.toks, acrossOf(n, listPerimeter(s0.toks)), 1, max, n, style.id === 'granny-square');
  return { lines: [...lines, ...rest.lines], polygon: rest.checks, widthMm: rest.across, heightMm: rest.across, rounds: 1 + rest.lines.length, notes };
}

/** Cornered rounds on `list` until the piece is `target` across (polygon rule). */
function squareOn(i: RoundsInput, list: Tok[], startAcross: number, done: number, max: number, n = 4, granny = false): { lines: Line[]; checks: PolygonRound[]; across: number } {
  const P = i.P;
  const w = stitchParam(P, 'sc').width;
  const lines: Line[] = [];
  const poly: PolygonInput[] = [];
  let cur = list;
  let across = startAcross;
  let k = done;
  let drift = 0;
  let prevCorner: { kind: string; corner: import('./engine').Make[] } | undefined;
  while (k < max && across < i.widthMm - stitchParam(P, 'dc').height) {
    if (granny) {
      const r = grannyRound(cur, P);
      lines.push({ label: 'Rnd', n: k + 1, text: r.text, count: r.count, keys: r.keys, color: i.color(k), section: 'rounds', height: r.height });
      poly.push({ label: `Rnd ${k + 1}`, cornerGrowth: r.perimeter - listPerimeter(cur), corners: r.corners, height: r.height });
      cur = r.next;
      across = acrossOf(n, r.perimeter);
      k++;
      continue;
    }
    const layer = { kind: tex(i, k), corner: i.corner };
    const res = workLayers(cur, [layer], P, false, n, drift, prevCorner);
    drift = res.drift;
    const rounds = res.rounds;
    rounds.forEach((r, j) => {
      prevCorner = { kind: r.kind, corner: r.corner };
      poly.push({ ...res.checks[j], label: `Rnd ${k + 1}` });
      lines.push({ label: 'Rnd', n: k + 1, text: r.result.text, count: r.result.count, keys: r.result.keys, color: i.color(k), section: 'rounds', height: r.result.height, note: r.kind === 'setup' ? r.note : r.kind === 'sc-blo' ? 'ridge round (back loops)' : undefined });
      cur = r.result.next;
      across = acrossOf(n, r.result.perimeter);
      k++;
    });
  }
  return { lines, checks: polygonCheck(n, poly, w), across };
}
