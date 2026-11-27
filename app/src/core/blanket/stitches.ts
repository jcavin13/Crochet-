/**
 * Rectangle bodies: a library of stitch patterns worked in rows, as data plus emit rules.
 *
 * Every pattern is worked over W "columns" (W = k·multiple + plus): the foundation chain has one
 * chain per column under the first row, plus the chains skipped at the hook. Each row's top has
 * exactly one target per column (stitch or ch-1 sp), so a border's first round finds W targets
 * along the top and W unused chain loops along the bottom. Rows come in a period (1 or 2 row
 * types) after Row 1, which the writer turns into "Rows 2-120:" or an odd/even pair.
 */
import type { StType, Tok } from './engine';

export interface RowDef {
  /** instruction (no label, no final ".") */
  text: string;
  /** count annotation, e.g. "(40)" or "(21 sc, 20 ch-1 sps)" */
  count: string;
  /** nodes by yarn key */
  keys: Record<string, number>;
  /** the row's target list in its working order (one entry per column) */
  toks: Tok[];
}

export interface BodyRows {
  /** chains in the foundation chain; `skip` of them are skipped at the hook (turning chain) */
  chains: number;
  skip: number;
  row1: RowDef;
  /** rows 2, 3, … cycle through these */
  period: RowDef[];
}

export type ThumbKind = 'sc' | 'hdc' | 'dc' | 'moss' | 'granny' | 'v' | 'shell' | 'griddle' | 'mesh' | 'ripple' | 'bobble';

export interface StitchPattern {
  id: string;
  name: string;
  blurb: string;
  /** columns = k·multiple + plus, k ≥ minRepeats */
  multiple: number;
  plus: number;
  minRepeats: number;
  /** rows in one repeat of the row instructions (after Row 1) */
  rowRepeat: number;
  /** stitch whose height a row has (before hRatio) */
  unit: StType;
  /** column width relative to one plain stitch width; row height relative to `unit` height */
  wRatio: number;
  hRatio: number;
  /** yarn per area relative to plain sc fabric (rough, for comparing patterns) */
  yarnFactor: number;
  drape: string;
  texture: string;
  difficulty: 1 | 2 | 3;
  /** squareness / edge behaviour notes (bias, lean, draw-in, wavy ends) */
  edge: string;
  thumb: ThumbKind;
  rows(W: number, colW: number): BodyRows;
}

const col = (colW: number, k: Tok['k'] = 'st', type = 'sc', n?: number): Tok => (k === 'sp' ? { k, n: n ?? 1, w: colW } : { k, type, w: colW });
const sts = (n: number, type: string, colW: number) => Array.from({ length: n }, () => col(colW, 'st', type));
const repeat = (n: number, f: () => Tok[]) => Array.from({ length: n }, f).flat();

/** Plain rows of one stitch. Non-counting turning chains except dc (ch 3 counts as dc). */
function solid(type: 'sc' | 'hdc' | 'dc'): StitchPattern['rows'] {
  return (W, colW) => {
    const skip = { sc: 1, hdc: 2, dc: 3 }[type];
    const row1: RowDef = {
      text: `${type} in ${['', '', '2nd', '3rd', '4th'][skip + 1]} ch from hook, ${type} in each ch across`,
      count: `(${W})`, keys: { [type]: W }, toks: sts(W, type, colW),
    };
    const row: RowDef = type === 'dc'
      ? { text: 'ch 3 (counts as dc), dc in each st across', count: `(${W})`, keys: { 'turning ch': 3, dc: W - 1 }, toks: sts(W, 'dc', colW) }
      : { text: `ch ${skip}, ${type} in each st across`, count: `(${W})`, keys: { 'turning ch': skip, [type]: W }, toks: sts(W, type, colW) };
    return { chains: W + skip, skip, row1, period: [row] };
  };
}

export const STITCH_PATTERNS: StitchPattern[] = [
  {
    id: 'sc', name: 'Single crochet', blurb: 'Dense, firm, warm rows of sc.', multiple: 1, plus: 0, minRepeats: 3, rowRepeat: 1,
    unit: 'sc', wRatio: 1, hRatio: 1, yarnFactor: 1.0, drape: 'stiff', texture: 'smooth, dense', difficulty: 1,
    edge: 'Squares up well; can lean slightly if the turning chain is skipped inconsistently.', thumb: 'sc', rows: solid('sc'),
  },
  {
    id: 'hdc', name: 'Half double crochet', blurb: 'Soft and quick, a little more drape than sc.', multiple: 1, plus: 0, minRepeats: 3, rowRepeat: 1,
    unit: 'hdc', wRatio: 1, hRatio: 1, yarnFactor: 0.95, drape: 'medium', texture: 'soft ridges', difficulty: 1,
    edge: 'Edges are straight with a non-counting ch 2; hdc fabric can bias a little — block it.', thumb: 'hdc', rows: solid('hdc'),
  },
  {
    id: 'dc', name: 'Double crochet', blurb: 'Fast and drapey; the classic quick blanket.', multiple: 1, plus: 0, minRepeats: 3, rowRepeat: 1,
    unit: 'dc', wRatio: 1, hRatio: 1, yarnFactor: 0.85, drape: 'drapey', texture: 'open, flat', difficulty: 1,
    edge: 'Tall rows: the sides need about 2 sc per row end. Counting turning chains can leave small gaps at the edges.', thumb: 'dc', rows: solid('dc'),
  },
  {
    id: 'moss', name: 'Moss (linen) stitch', blurb: 'Sc and ch-1 alternating; a woven, tweedy fabric that shows off stripes.', multiple: 2, plus: 1, minRepeats: 2, rowRepeat: 2,
    unit: 'sc', wRatio: 1.02, hRatio: 0.95, yarnFactor: 0.85, drape: 'medium', texture: 'woven, tweedy', difficulty: 1,
    edge: 'Lies flat and square; no bias. The edge columns are sc every row, so the sides are firm.', thumb: 'moss',
    rows: (W, colW): BodyRows => {
      const k = (W - 1) / 2;
      const B = (): Tok[] => [col(colW), ...repeat(k, () => [col(colW, 'sp'), col(colW)])];
      const A = (): Tok[] => [col(colW), col(colW), ...repeat(k - 1, () => [col(colW, 'sp'), col(colW)]), col(colW)];
      return {
        chains: W + 1, skip: 1,
        row1: { text: `sc in 2nd ch from hook, *ch 1, sk next ch, sc in next ch* x${k}`, count: `(${k + 1} sc, ${k} ch-1 sps)`, keys: { sc: k + 1, ch: k }, toks: B() },
        period: [
          { text: `ch 1, sc in next st, sc in next ch-1 sp, ${k > 2 ? `*ch 1, sk next st, sc in next ch-1 sp* x${k - 1}` : 'ch 1, sk next st, sc in next ch-1 sp'}, sc in next st`, count: `(${k + 2} sc, ${k - 1} ch-1 sps)`, keys: { 'turning ch': 1, ch: k - 1, sc: k + 2 }, toks: A() },
          { text: `ch 1, sc in next st, ${k > 2 ? `*ch 1, sk next st, sc in next ch-1 sp* x${k - 1}` : 'ch 1, sk next st, sc in next ch-1 sp'}, ch 1, sk next st, sc in next st`, count: `(${k + 1} sc, ${k} ch-1 sps)`, keys: { 'turning ch': 1, ch: k, sc: k + 1 }, toks: B() },
        ],
      };
    },
  },
  {
    id: 'granny', name: 'Granny stripe', blurb: 'Rows of 3-dc groups in the spaces of the row below: the granny square look in rows.', multiple: 4, plus: 3, minRepeats: 2, rowRepeat: 2,
    unit: 'dc', wRatio: 1, hRatio: 1, yarnFactor: 0.8, drape: 'drapey', texture: 'open clusters', difficulty: 2,
    edge: 'Tends to spread a little wider than its foundation chain — work the chain with a hook one size up. Edges alternate half-groups, so they stay straight.', thumb: 'granny',
    rows: (W, colW): BodyRows => {
      const G = (W - 3) / 4;
      const grp = () => sts(3, 'dc', colW);
      const B = (): Tok[] => [...grp(), ...repeat(G, () => [col(colW, 'sp'), ...grp()])];
      const A = (): Tok[] => [col(colW, 'st', 'dc'), col(colW, 'sp'), ...repeat(G, () => [...grp(), col(colW, 'sp')]), col(colW, 'st', 'dc')];
      const rep = (body: string, n: number) => (n === 1 ? body : `*${body}* x${n}`);
      return {
        chains: W + 3, skip: 3,
        row1: { text: `dc in 4th ch from hook, dc in next 2 chs, ${rep('ch 1, sk next ch, dc in next 3 chs', G)}`, count: `(${3 * G + 3} dc, ${G} ch-1 sps)`, keys: { dc: 3 * G + 3, ch: G }, toks: B() },
        period: [
          { text: `ch 4 (counts as dc, ch 1), ${rep('3 dc in next ch-1 sp, ch 1', G)}, sk next 2 sts, dc in next st`, count: `(${3 * G + 2} dc, ${G + 1} ch-1 sps)`, keys: { 'turning ch': 3, ch: G + 1, dc: 3 * G + 1 }, toks: A() },
          { text: `ch 3 (counts as dc), 2 dc in next ch-1 sp, ${rep('ch 1, 3 dc in next ch-1 sp', G - 1)}, ch 1, 2 dc in next ch-1 sp, dc in next st`, count: `(${3 * G + 3} dc, ${G} ch-1 sps)`, keys: { 'turning ch': 3, ch: G, dc: 3 * G + 2 }, toks: B() },
        ],
      };
    },
  },
  {
    id: 'v', name: 'V-stitch rows', blurb: '(dc, ch 1, dc) stacked in the V below: airy, quick, very drapey.', multiple: 3, plus: 2, minRepeats: 2, rowRepeat: 1,
    unit: 'dc', wRatio: 1.05, hRatio: 1, yarnFactor: 0.7, drape: 'very drapey', texture: 'open lattice', difficulty: 1,
    edge: 'Straight edges (a dc each end). Open fabric — stretches lengthwise when hung; block to size.', thumb: 'v',
    rows: (W, colW): BodyRows => {
      const V = (W - 2) / 3;
      const toks = (): Tok[] => [col(colW, 'st', 'dc'), ...repeat(V, () => [col(colW, 'st', 'dc'), col(colW, 'sp'), col(colW, 'st', 'dc')]), col(colW, 'st', 'dc')];
      return {
        chains: W + 3, skip: 3,
        row1: { text: `dc in 4th ch from hook, *sk next ch, v-st in next ch, sk next ch* x${V}, dc in next ch`, count: `(${2 * V + 2} dc, ${V} ch-1 sps)`, keys: { dc: 2 * V + 2, ch: V }, toks: toks() },
        period: [{ text: `ch 3 (counts as dc), *v-st in next ch-1 sp* x${V}, sk next st, dc in next st`, count: `(${2 * V + 2} dc, ${V} ch-1 sps)`, keys: { 'turning ch': 3, ch: V, dc: 2 * V + 1 }, toks: toks() }],
      };
    },
  },
  {
    id: 'shell', name: 'Shell rows', blurb: '5-dc shells offset row by row: a classic scalloped texture.', multiple: 6, plus: 1, minRepeats: 2, rowRepeat: 2,
    unit: 'dc', wRatio: 1.05, hRatio: 0.9, yarnFactor: 0.95, drape: 'medium', texture: 'scalloped fans', difficulty: 2,
    edge: 'Sides straight (half shells at the ends); the top and bottom edges are gently scalloped — a border evens them.', thumb: 'shell',
    rows: (W, colW): BodyRows => {
      const S = (W - 1) / 6;
      const A = (): Tok[] => [col(colW), ...repeat(S, () => [...sts(5, 'dc', colW), col(colW)])];
      const B = (): Tok[] => [...sts(3, 'dc', colW), ...repeat(S - 1, () => [col(colW), ...sts(5, 'dc', colW)]), col(colW), ...sts(3, 'dc', colW)];
      const rep = (body: string, n: number) => (n === 1 ? body : `*${body}* x${n}`);
      return {
        chains: W + 1, skip: 1,
        row1: { text: `sc in 2nd ch from hook, ${rep('sk next 2 chs, 5 dc in next ch, sk next 2 chs, sc in next ch', S)}`, count: `(${S + 1} sc, ${5 * S} dc)`, keys: { sc: S + 1, dc: 5 * S }, toks: A() },
        period: [
          { text: `ch 3 (counts as dc), 2 dc in same st, ${rep('sk next 2 sts, sc in next st, sk next 2 sts, 5 dc in next st', S - 1)}, sk next 2 sts, sc in next st, sk next 2 sts, 3 dc in next st`, count: `(${S} sc, ${5 * S + 1} dc)`, keys: { 'turning ch': 3, dc: 5 * S, sc: S }, toks: B() },
          { text: `ch 1, sc in next st, ${rep('sk next 2 sts, 5 dc in next st, sk next 2 sts, sc in next st', S)}`, count: `(${S + 1} sc, ${5 * S} dc)`, keys: { 'turning ch': 1, sc: S + 1, dc: 5 * S }, toks: A() },
        ],
      };
    },
  },
  {
    id: 'griddle', name: 'Griddle (sc/dc)', blurb: 'Alternating sc and dc, the dc of each row in the sc below: a bumpy, dense texture (lemon-peel family).', multiple: 2, plus: 0, minRepeats: 2, rowRepeat: 1,
    unit: 'hdc', wRatio: 1, hRatio: 1, yarnFactor: 1.0, drape: 'medium', texture: 'bumpy, dense', difficulty: 1,
    edge: 'Square and flat; rows are about hdc height. Mixed stitch heights can make the side edges look slightly uneven.', thumb: 'griddle',
    rows: (W, colW): BodyRows => {
      const m = W / 2;
      const toks = (): Tok[] => repeat(m, () => [col(colW, 'st', 'sc'), col(colW, 'st', 'dc')]);
      return {
        chains: W + 1, skip: 1,
        row1: { text: `sc in 2nd ch from hook, dc in next ch, *sc in next ch, dc in next ch* x${m - 1}`.replace(/\*sc in next ch, dc in next ch\* x1$/, 'sc in next ch, dc in next ch'), count: `(${m} sc, ${m} dc)`, keys: { sc: m, dc: m }, toks: toks() },
        period: [{ text: `ch 1, *sc in next st, dc in next st* x${m}`, count: `(${m} sc, ${m} dc)`, keys: { 'turning ch': 1, sc: m, dc: m }, toks: toks() }],
      };
    },
  },
  {
    id: 'mesh', name: 'Filet mesh', blurb: '(dc, ch 1) mesh: light and lacy, quick to work, uses little yarn.', multiple: 2, plus: 1, minRepeats: 2, rowRepeat: 1,
    unit: 'dc', wRatio: 1, hRatio: 1, yarnFactor: 0.6, drape: 'very drapey', texture: 'open grid', difficulty: 1,
    edge: 'Square grid; stretches on the bias. Block to size; a solid border helps it keep its shape.', thumb: 'mesh',
    rows: (W, colW): BodyRows => {
      const M = (W - 1) / 2;
      const toks = (): Tok[] => [col(colW, 'st', 'dc'), ...repeat(M, () => [col(colW, 'sp'), col(colW, 'st', 'dc')])];
      return {
        chains: W + 3, skip: 3,
        row1: { text: `dc in 4th ch from hook, *ch 1, sk next ch, dc in next ch* x${M}`, count: `(${M + 1} dc, ${M} ch-1 sps)`, keys: { dc: M + 1, ch: M }, toks: toks() },
        period: [{ text: `ch 4 (counts as dc, ch 1), ${M > 2 ? `*dc in next st, ch 1* x${M - 1}` : 'dc in next st, ch 1'}, dc in next st`, count: `(${M + 1} dc, ${M} ch-1 sps)`, keys: { 'turning ch': 3, ch: M, dc: M }, toks: toks() }],
      };
    },
  },
  {
    id: 'ripple', name: 'Ripple (chevron)', blurb: 'Increase and decrease waves on a 12-stitch repeat: the classic chevron blanket.', multiple: 12, plus: 1, minRepeats: 2, rowRepeat: 1,
    unit: 'dc', wRatio: 0.92, hRatio: 1, yarnFactor: 0.95, drape: 'drapey', texture: 'waves', difficulty: 2,
    edge: 'The sides are straight, but the top and bottom follow the waves: the outline is wavy at the ends (a border follows the waves, it does not straighten them). Width is measured across, so the fabric is narrower than its stitch count suggests.', thumb: 'ripple',
    rows: (W, colW): BodyRows => {
      const n = (W - 1) / 12;
      const toks = (): Tok[] => sts(W, 'dc', colW);
      const wave = (u: string, inc: string) => `dc in next 4 ${u}, dc3tog over next 3 ${u}, dc in next 4 ${u}, ${inc}`;
      const rep = (body: string, k: number) => (k === 1 ? `${body}, ` : `*${body}* x${k}, `);
      return {
        chains: W + 3, skip: 3,
        row1: { text: `2 dc in 4th ch from hook, ${n > 1 ? rep(wave('chs', '3 dc in next ch'), n - 1) : ''}${wave('chs', '2 dc in next ch')}`, count: `(${W})`, keys: { dc: W - n, dc3tog: n }, toks: toks() },
        period: [{ text: `ch 3 (counts as dc), dc in same st, ${n > 1 ? rep(wave('sts', '3 dc in next st'), n - 1) : ''}${wave('sts', '2 dc in next st')}`, count: `(${W})`, keys: { 'turning ch': 3, dc: W - 1 - n, dc3tog: n }, toks: toks() }],
      };
    },
  },
  {
    id: 'bobble', name: 'Bobble rows', blurb: 'Sc rows with a bobble every 4th stitch on alternate rows: a raised, polka-dot texture.', multiple: 4, plus: 3, minRepeats: 2, rowRepeat: 2,
    unit: 'sc', wRatio: 1.05, hRatio: 1, yarnFactor: 1.5, drape: 'thick', texture: 'raised bobbles', difficulty: 2,
    edge: 'Bobbles pull the fabric in slightly; check the width after a few repeats. Bobble rows are wrong-side rows so the bobbles pop to the right side.', thumb: 'bobble',
    rows: (W, colW): BodyRows => {
      const b = (W - 3) / 4;
      const plain = (): Tok[] => sts(W, 'sc', colW);
      const bob = (): Tok[] => [...sts(3, 'sc', colW), ...repeat(b, () => [col(colW, 'st', 'cl'), ...sts(3, 'sc', colW)])];
      return {
        chains: W + 1, skip: 1,
        row1: { text: 'sc in 2nd ch from hook, sc in each ch across', count: `(${W})`, keys: { sc: W }, toks: plain() },
        period: [
          { text: `ch 1, sc in next 3 sts, *bobble in next st, sc in next 3 sts* x${b}`.replace(/\*bobble in next st, sc in next 3 sts\* x1$/, 'bobble in next st, sc in next 3 sts'), count: `(${3 * b + 3} sc, ${b} cl)`, keys: { 'turning ch': 1, sc: 3 * b + 3, '5-dc cl': b }, toks: bob() },
          { text: 'ch 1, sc in each st across', count: `(${W})`, keys: { 'turning ch': 1, sc: W }, toks: plain() },
        ],
      };
    },
  },
];

export const STITCH_BY_ID: Record<string, StitchPattern> = Object.fromEntries(STITCH_PATTERNS.map((p) => [p.id, p]));

/** Patterns users ask for that the notation cannot express yet, with the reason. */
export const NOT_EXPRESSIBLE: { name: string; why: string }[] = [
  {
    name: 'Corner-to-corner (C2C)',
    why: 'Each C2C tile is worked into the ch-3 turning chain of the tile beside it ("sl st in next ch-3 sp"). Notation v0.1 treats a turning chain as a turning chain, never as a chain space, and has no way to attach a tile sideways to the row before — so a C2C graph cannot be written down yet.',
  },
  {
    name: 'Reverse single crochet (crab stitch) edging',
    why: 'Crab stitch is sc worked backwards round the edge without turning. The stitch graph has no "worked in the reverse direction" for a single stitch, so it would compile as ordinary sc; the border library offers a plain sc edging instead.',
  },
];
