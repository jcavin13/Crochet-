/**
 * Round engine: simulates one round worked into a target list exactly as the compiler would
 * (notation.md 3.3, 3.9) — which entries it consumes, the stitches, chains and spaces it makes,
 * the next round's list with its corners — while writing the round's notation. It lets the
 * blanket designer get exact counts, sizes and yarn for pieces far too big to compile.
 *
 * Widths are course widths in mm (stitch_params). A chain space is as wide as its chains, or as
 * the stitches it bridges when it is worked over skipped stitches ("ch 1, sk next st": mesh).
 */
import { stitchParam, type ParamSet } from '../params';
import { intoNext, writeSegs, type Seg } from './write';

export type StType = 'sc' | 'hdc' | 'dc' | 'tr' | 'dtr';
export const HEIGHT_ORDER: StType[] = ['sc', 'hdc', 'dc', 'tr', 'dtr'];

/** One entry of a target list. */
export interface Tok {
  /** st: a stitch; sp: a chain space; re: a row end; base: an unused loop of the foundation chain */
  k: 'st' | 'sp' | 're' | 'base';
  /** stitch type ('cl' for a cluster) */
  type?: string;
  /** chains of a space */
  n?: number;
  /** course width, mm (row end: the length of side it covers) */
  w: number;
  corner?: boolean;
}

/** What a target is looked up by (as in the notation). */
export type Unit = 'st' | 'sp' | 're' | 'base' | 'corner' | { sp: number } | { st: string };

/** Something made into one target. */
export type Make =
  | { st: StType; n?: number; loop?: 'blo' | 'flo' }
  | { cl: number; base?: StType }
  | { fp: StType }
  | { ch: number }
  | { picot: true };

/** One made node (graph node), for counts by yarn key and the next list. */
interface NodeRec {
  key: string;
  counts: boolean;
  /** stitch type for the next list ('cl' for clusters) */
  type?: string;
  /** input entry index worked into; -1 none */
  into: number;
  /** chain of a chain space (not a turning chain) */
  chain?: boolean;
  /** a counting turning chain stands as this type */
  countsAs?: StType;
}

export interface RoundResult {
  /** the instruction, without label and count */
  text: string;
  /** count annotation, e.g. "(52)" or "(56 sts, 4 ch-2 sps)" */
  count: string;
  /** stitch-counting nodes */
  stitches: number;
  /** chain spaces made, by length */
  spaces: Record<number, number>;
  /** nodes by yarn key ('sc', 'ch', 'turning ch', 'sl st', '5-dc cl', 'picot', …) */
  keys: Record<string, number>;
  /** the list the next round works into (corners marked) */
  next: Tok[];
  /** course length of the round (perimeter), mm */
  perimeter: number;
  /** mean height of its stitches, mm */
  height: number;
  /** course width the corner groups add over the corner entries they are worked into, mm (summed) */
  cornerGrowth: number;
  /** corners worked into */
  corners: number;
  /** deliberate change of the side counts (a set-up round's increases − decreases), mm */
  adjust?: number;
}

export const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

const unitWords = (u: Unit): [string, string] => {
  if (u === 'st') return ['st', 'sts'];
  if (u === 'sp') return ['ch-sp', 'ch-sps'];
  if (u === 're') return ['row end', 'row ends'];
  if (u === 'base') return ['ch', 'chs'];
  if (u === 'corner') return ['corner', 'corners'];
  if ('sp' in u) return [`ch-${u.sp} sp`, `ch-${u.sp} sps`];
  return [u.st, `${u.st}s`];
};

function matches(t: Tok, u: Unit): boolean {
  if (u === 'st') return t.k === 'st' || t.k === 'base';
  if (u === 'sp') return t.k === 'sp';
  if (u === 're') return t.k === 're';
  if (u === 'base') return t.k === 'base';
  if (u === 'corner') return !!t.corner;
  if ('sp' in u) return t.k === 'sp' && t.n === u.sp;
  return t.k === 'st' && t.type === u.st;
}

/** Text of one Make list as notation inside a group: "2 dc, ch 2, 2 dc". */
export function makesText(ms: Make[]): string {
  return ms.map((m) => {
    if ('st' in m) return `${m.n && m.n > 1 ? `${m.n} ` : ''}${m.st}${m.loop ? ` ${m.loop}` : ''}`;
    if ('cl' in m) return m.cl === 5 && (m.base ?? 'dc') === 'dc' ? 'bobble' : `${m.cl}-${m.base ?? 'dc'} cl`;
    if ('fp' in m) return `fp${m.fp}`;
    if ('ch' in m) return `ch ${m.ch}`;
    return 'picot';
  }).join(', ');
}

/** "3 sc", "(2 dc, ch 2, 2 dc)", "sc" — what goes before " in <place>". */
export function makesHead(ms: Make[]): string {
  if (ms.length === 1) {
    const m = ms[0];
    if ('st' in m) return `${m.n && m.n > 1 ? `${m.n} ` : ''}${m.st}${m.loop ? ` ${m.loop}` : ''}`;
    if ('cl' in m || 'fp' in m) return makesText(ms);
  }
  return `(${makesText(ms)})`;
}

const makesKey = (ms: Make[]) => JSON.stringify(ms);

/**
 * One round. Call the operations in working order, then `finish()`.
 * `cornerSyntax`: corners are written "in corner" (border rounds after rows); otherwise the
 * corner entry is addressed explicitly ("in next ch-2 sp", "in next st").
 */
export class RoundSim {
  cur = 0;
  private segs: Seg[] = [];
  private nodes: NodeRec[] = [];
  private made = false;
  private lastUsed = -1;
  /** entries skipped ("sk") or passed over: a chain run across them is pulled to their width */
  private skipped = new Set<number>();

  constructor(public list: Tok[], public P: ParamSet, public cornerSyntax = false) {}

  w(type: string): number {
    if (type === 'cl') return stitchParam(this.P, 'dc').width;
    return stitchParam(this.P, type as StType).width;
  }
  h(type: string): number {
    if (type === 'cl') return stitchParam(this.P, 'dc').height;
    return stitchParam(this.P, type as StType).height;
  }

  /** Move the cursor to just after entry k; entries passed over on the way are noted. */
  private advance(k: number) {
    for (let x = this.cur; x < k; x++) this.skipped.add(x);
    this.cur = k + 1;
  }

  /** index of the next entry matching u (from the cursor), or throw — a generator bug. */
  private find(u: Unit): number {
    for (let k = this.cur; k < this.list.length; k++) {
      if (matches(this.list[k], u)) return k;
      if (this.cornerSyntax && this.list[k].corner && u !== 'corner') throw new Error(`engine: ${JSON.stringify(u)} would pass corner ${k}`);
    }
    throw new Error(`engine: no ${JSON.stringify(u)} left (cursor ${this.cur} of ${this.list.length})`);
  }

  remaining(u: Unit, limit = this.list.length): number {
    let n = 0;
    for (let k = this.cur; k < limit; k++) if (matches(this.list[k], u)) n++;
    return n;
  }

  /** index of the next corner at or after the cursor */
  nextCorner(): number {
    for (let k = this.cur; k < this.list.length; k++) if (this.list[k].corner) return k;
    return this.list.length;
  }

  private push(rec: NodeRec) {
    this.nodes.push(rec);
  }

  private makeInto(ms: Make[], into: number) {
    for (const m of ms) {
      if ('ch' in m) {
        for (let i = 0; i < m.ch; i++) this.push({ key: 'ch', counts: false, into: -1, chain: this.made });
        continue;
      }
      if ('picot' in m) { this.push({ key: 'picot', counts: false, into: -1 }); continue; }
      this.made = true;
      if ('cl' in m) { this.push({ key: `${m.cl}-${m.base ?? 'dc'} cl`, counts: true, type: 'cl', into }); continue; }
      if ('fp' in m) { this.push({ key: `fp${m.fp}`, counts: true, type: m.fp, into }); continue; }
      for (let i = 0; i < (m.n ?? 1); i++) this.push({ key: m.st, counts: true, type: m.st, into });
    }
  }

  private seg(key: string, phrase: (n: number) => string, fixed = false) {
    this.segs.push({ key, n: 1, phrase, fixed });
  }

  /** Free text (already-merged phrase), e.g. a turning chain. */
  text(t: string) {
    this.seg(`txt:${t}`, () => t, true);
  }

  /** Non-counting turning chain for rounds of `type`: "ch 1", "ch 2 (does not count as st)". */
  turning(type: StType) {
    const n = { sc: 1, hdc: 2, dc: 3, tr: 4, dtr: 5 }[type];
    for (let i = 0; i < n; i++) this.push({ key: 'turning ch', counts: false, into: -1 });
    this.text(n === 1 ? 'ch 1' : `ch ${n} (does not count as st)`);
  }

  /** "ch 3 (counts as dc)": stands on the last target used, else takes the next stitch. */
  turningCounts(type: StType, extraCh = 0) {
    const n = { sc: 1, hdc: 2, dc: 3, tr: 4, dtr: 5 }[type];
    let base = this.lastUsed;
    if (base < 0) {
      base = this.find('st');
      this.advance(base);
      this.lastUsed = base;
    }
    for (let i = 0; i < n - 1; i++) this.push({ key: 'turning ch', counts: false, into: -1 });
    this.made = true;
    this.push({ key: 'turning ch', counts: true, type, into: base, countsAs: type });
    for (let i = 0; i < extraCh; i++) this.push({ key: 'ch', counts: false, into: -1, chain: true });
    this.text(`ch ${n + extraCh} (counts as ${type}${extraCh ? `, ch ${extraCh}` : ''})`);
  }

  /** Make `ms` into the next target matching `u` (one target). */
  into(u: Unit, ms: Make[], opts: { phrase?: (n: number) => string; key?: string } = {}) {
    const k = this.find(u);
    this.advance(k);
    this.lastUsed = k;
    this.makeInto(ms, k);
    const [one, many] = unitWords(u);
    const head = makesHead(ms);
    const single = ms.length === 1 && 'st' in ms[0] ? ms[0] : undefined;
    const fp = ms.length === 1 && 'fp' in ms[0] ? ms[0] : undefined;
    const phrase = opts.phrase ?? (fp ? (n: number) => (n === 1 ? `fp${fp.fp} around next ${one}` : `fp${fp.fp} around each of next ${n} ${many}`) : u === 'corner' && this.cornerSyntax
      ? () => `${head} in corner`
      : (n: number) => (single ? intoNext(`${single.st}${single.loop ? ` ${single.loop}` : ''}`, single.n ?? 1, one, many, n) : n === 1 ? `${head} in next ${one}` : `${head} in each of next ${n} ${many}`));
    this.seg(opts.key ?? `into:${JSON.stringify(u)}:${makesKey(ms)}`, phrase, u === 'corner' && this.cornerSyntax);
  }

  /**
   * Make `ms` into every remaining target of `u` up to the next corner ("sc in each st across to
   * corner", "2 sc in each row end across"). Every entry before the corner must match `u`.
   */
  across(u: Unit, ms: Make[]) {
    const end = this.nextCorner();
    for (let k = this.cur; k < end; k++) if (!matches(this.list[k], u)) throw new Error(`engine: across ${JSON.stringify(u)} meets ${this.list[k].k} at ${k}`);
    for (let k = this.cur; k < end; k++) this.makeInto(ms, k);
    if (end > this.cur) this.lastUsed = end - 1;
    this.cur = end;
    const [one] = unitWords(u);
    const toCorner = end < this.list.length;
    this.text(`${makesHead(ms)} in each ${one} across${toCorner ? ' to corner' : ''}`);
  }

  /** A decrease over the next n targets matching u ("sc2tog"). */
  tog(type: StType, n: number, u: Unit = 'st') {
    let last = -1;
    for (let i = 0; i < n; i++) {
      last = this.find(u);
      this.advance(last);
    }
    this.lastUsed = last;
    this.made = true;
    this.push({ key: `${type}${n}tog`, counts: true, type, into: last });
    this.seg(`tog:${type}${n}`, (r) => (r === 1 ? `${type}${n}tog` : `${r} ${type}${n}tog`));
  }

  private override?: string;
  /** Replace the written instruction (the simulation is unchanged). */
  setText(t: string) {
    this.override = t;
  }

  /** Make `ms` into the target used last ("in same st"). */
  same(ms: Make[]) {
    if (this.lastUsed < 0) throw new Error('engine: same before any target');
    this.makeInto(ms, this.lastUsed);
    const head = makesHead(ms);
    const sp = this.list[this.lastUsed].k === 'sp';
    this.text(`${head} in same ${sp ? 'sp' : 'st'}`);
  }

  /** Corner: the next corner entry, written "in corner" or explicitly. */
  corner(ms: Make[]) {
    const k = this.nextCorner();
    if (k >= this.list.length) throw new Error('engine: no corner left');
    if (k !== this.cur && (this.list[k].k !== 'sp' || this.list.slice(this.cur, k).some((t) => t.k !== 'st'))) {
      throw new Error(`engine: corner ${k} is not next (cursor ${this.cur})`);
    }
    if (this.cornerSyntax) return this.into('corner', ms);
    const t = this.list[k];
    const u: Unit = t.k === 'sp' ? { sp: t.n! } : 'st';
    const [one] = unitWords(u);
    this.into(u, ms, { phrase: () => `${makesHead(ms)} in next ${one}`, key: `corner:${makesKey(ms)}:${one}` });
  }

  /** Skip the next target matching u ("sk next st"). */
  skip(u: Unit = 'st') {
    const k = this.find(u);
    this.advance(k);
    this.skipped.add(k);
    const [one, many] = unitWords(u);
    this.seg(`sk:${JSON.stringify(u)}`, (n) => (n === 1 ? `sk next ${one}` : `sk next ${n} ${many}`));
  }

  /** Slip stitch into the next target matching u (travel). */
  slst(u: Unit = 'st') {
    const k = this.find(u);
    this.advance(k);
    this.lastUsed = k;
    this.push({ key: 'sl st', counts: false, into: k });
    const [one, many] = unitWords(u);
    this.seg(`sl:${JSON.stringify(u)}`, (n) => (n === 1 ? `sl st in next ${one}` : `sl st in next ${n} ${many}`));
  }

  /** Chains (a chain space when made after a stitch of this round). */
  chain(n: number) {
    for (let i = 0; i < n; i++) this.push({ key: made(this) ? 'ch' : 'turning ch', counts: false, into: -1, chain: this.made });
    this.seg(`ch:${n}`, (r) => (r === 1 ? `ch ${n}` : `ch ${n * r}`));
  }

  picot() {
    this.push({ key: 'picot', counts: false, into: -1 });
    this.seg('picot', (n) => (n === 1 ? 'picot' : `${n} picot`));
  }

  /** "join" (sl st in first st of the round). */
  join() {
    this.push({ key: 'sl st', counts: false, into: -1 });
    this.text('join');
  }

  /**
   * Width a chain run (nodes i..j) is pulled to: what was skipped or passed over between the
   * stitches on either side of it, less how far those stitch groups fan out beyond their own base
   * (a 3-dc group in one stitch covers about three).
   */
  private bridged(i: number, j: number): number {
    let p = i - 1;
    while (p >= 0 && !this.nodes[p].counts) p--;
    let q = j + 1;
    while (q < this.nodes.length && !this.nodes[q].counts) q++;
    if (p < 0 || q >= this.nodes.length) return 0;
    const a = this.nodes[p].into, b = this.nodes[q].into;
    if (a < 0 || b < 0 || b <= a) return 0;
    let between = 0;
    for (let x = a + 1; x < b; x++) if (this.skipped.has(x)) between += this.list[x].w;
    const overhang = (t: number) => {
      let gw = 0;
      for (const n of this.nodes) if (n.counts && n.into === t) gw += this.w(n.countsAs ?? n.type!);
      return Math.max(0, (gw - this.list[t].w) / 2);
    };
    return Math.max(0, between - overhang(a) - overhang(b));
  }

  /** Make the remaining text; compute the next list. */
  finish(count = true): RoundResult {
    const keys: Record<string, number> = {};
    for (const n of this.nodes) keys[n.key] = (keys[n.key] ?? 0) + 1;
    // next list: counting nodes and chain spaces (maximal runs of chain-space chains), in order
    const next: { tok: Tok; node: number }[] = [];
    const spaces: Record<number, number> = {};
    const wch = stitchParam(this.P, 'ch').width;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.chain) {
        let j = i;
        while (j + 1 < this.nodes.length && this.nodes[j + 1].chain) j++;
        const len = j - i + 1;
        const bridged = this.bridged(i, j);
        next.push({ tok: { k: 'sp', n: len, w: Math.max(len * wch, bridged) }, node: i });
        spaces[len] = (spaces[len] ?? 0) + 1;
        i = j;
        continue;
      }
      if (n.counts) next.push({ tok: { k: 'st', type: n.countsAs ?? n.type, w: this.w(n.countsAs ?? n.type!) }, node: i });
    }
    // corners of the next list: per corner entry worked into, its chain space inside the group or its middle stitch
    let cornerGrowth = 0, corners = 0;
    for (let c = 0; c < this.list.length; c++) {
      if (!this.list[c].corner) continue;
      const group = this.nodes.map((n, i) => (n.counts && n.into === c ? i : -1)).filter((i) => i >= 0);
      if (!group.length) continue;
      const lo = group[0], hi = group[group.length - 1];
      const inside = next.filter((x) => x.tok.k === 'sp' && x.node > lo && x.node < hi);
      corners++;
      cornerGrowth += next.filter((x) => x.node >= lo && x.node <= hi).reduce((a, x) => a + x.tok.w, 0) - this.list[c].w;
      const pick = inside.length ? inside[Math.floor((inside.length - 1) / 2)] : next.find((x) => x.node === group[Math.floor(group.length / 2)]);
      if (pick) pick.tok.corner = true;
    }
    const st = this.nodes.filter((n) => n.counts);
    const stitches = st.length;
    const height = st.length ? st.reduce((a, n) => a + this.h(n.countsAs ?? n.type!), 0) / st.length : 0;
    const perimeter = next.reduce((a, x) => a + x.tok.w, 0);
    const text = this.override ?? writeSegs(this.segs);
    const sp = Object.entries(spaces).map(([len, k]) => `${k} ch-${len} sps`);
    const countText = count ? `(${sp.length ? `${stitches} sts, ${sp.join(', ')}` : stitches})` : '';
    return { text, count: countText, stitches, spaces, keys, next: next.map((x) => x.tok), perimeter, height, cornerGrowth, corners };
  }
}

const made = (r: RoundSim) => (r as unknown as { made: boolean }).made;

/** Sum of node counts by key. */
export function addKeys(a: Record<string, number>, b: Record<string, number>, times = 1): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v * times;
  return out;
}

/** Stitch-counting total of a key table (everything but chains, turning chains, sl st, picots). */
export function stitchTotal(keys: Record<string, number>): number {
  let n = 0;
  for (const [k, v] of Object.entries(keys)) if (k !== 'ch' && k !== 'turning ch' && k !== 'sl st' && !k.startsWith('picot')) n += v;
  return n;
}
