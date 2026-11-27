/**
 * Ops → notation text (US or UK), and ops → the interface a sector leaves for the next round.
 *
 * Round-start idioms follow the corpus:
 *   into a space        `sl st in next ch-4 sp, ch 1, sc in same sp, …`
 *   tall first stitch   `ch 3 (counts as dc)`, fused with a following chain: `ch 5 (counts as dc, ch 2)`
 *   short first stitch  `ch 1, sc in same st` / `ch 2, hdc in same sp`
 *   first cluster       `ch 2, 2-dc cl in same sp` (a 3-dc cl whose first leg is the chain)
 *   puff / popcorn      `ch 2, puff in same sp` / `ch 3, pc in same sp`
 * and every round ends `…, join.` with a count annotation.
 */
import type { Entry, HookStitch, Item, Op, Place, Plain, Stitch } from './types';

export type Terms = 'US' | 'UK';

const TCH: Record<Plain, number> = { sc: 1, hdc: 2, dc: 3, tr: 4, dtr: 5 };
const UK: Record<string, string> = { sc: 'dc', hdc: 'htr', dc: 'tr', tr: 'dtr', dtr: 'trtr' };

export function plainName(t: Plain, terms: Terms): string {
  return terms === 'UK' ? UK[t] : t;
}

export function stitchName(s: Stitch, terms: Terms, legsOverride?: number): string {
  switch (s.t) {
    case 'cl': return `${legsOverride ?? s.legs}-${plainName(s.base, terms)} cl`;
    case 'puff': return 'puff';
    case 'pc': return s.legs === 5 ? 'pc' : `${s.legs}-${plainName('dc', terms)} pc`;
    default: return plainName(s.t, terms);
  }
}

const isTall = (s: Stitch): s is { t: 'dc' | 'tr' | 'dtr' } => s.t === 'dc' || s.t === 'tr' || s.t === 'dtr';

/** English ordinal for "4th ch from hook". */
export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

export function entryOf(s: Stitch): Entry {
  switch (s.t) {
    case 'cl': return { kind: 'st', type: s.base, cluster: true };
    case 'puff': return { kind: 'st', type: 'puff' };
    case 'pc': return { kind: 'st', type: 'popcorn' };
    default: return { kind: 'st', type: s.t };
  }
}

/** The targets one sector leaves for the next round (notation.md 3.3/3.4). */
export function sectorEntries(ops: Op[]): Entry[] {
  const out: Entry[] = [];
  let chainRun = false;
  const pushCh = (n: number) => {
    const last = out[out.length - 1];
    if (chainRun && last?.kind === 'sp') last.len += n;
    else out.push({ kind: 'sp', len: n });
    chainRun = true;
  };
  const pushItems = (items: Item[]) => {
    for (const it of items) {
      if (it.k === 'st') { for (let i = 0; i < it.n; i++) out.push(entryOf(it.s)); chainRun = false; }
      else if (it.k === 'ch') pushCh(it.n);
      else if (it.k === 'hook') {
        if (chainRun && out[out.length - 1]?.kind === 'sp') out.pop();
        chainRun = false;
        if (it.s.t !== 'slst') out.push(entryOf(it.s));
      } else if (it.k === 'along') {
        chainRun = false;
        if (it.s.t !== 'slst') for (let i = 0; i < it.count; i++) out.push(entryOf(it.s as Stitch));
      } else chainRun = false; // picot interrupts a chain run
    }
  };
  for (const op of ops) {
    if (op.k === 'into') pushItems(op.items);
    else if (op.k === 'each') { for (let i = 0; i < op.count; i++) out.push(entryOf(op.s)); chainRun = false; }
    else if (op.k === 'ch') pushCh(op.n);
    else if (op.k === 'picot') chainRun = false;
    else if (op.k === 'hook') {
      // a hook-addressed chain run is plain chains, not a chain space (notation.md 4a)
      if (chainRun && out[out.length - 1]?.kind === 'sp') out.pop();
      chainRun = false;
      if (op.s.t !== 'slst') out.push(entryOf(op.s));
    } else if (op.k === 'along') {
      chainRun = false;
      if (op.s.t !== 'slst') for (let i = 0; i < op.count; i++) out.push(entryOf(op.s as Stitch));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ text */

class Writer {
  /** Kind of the place most recently worked ('st' | 'sp'), for "same st" / "same sp". */
  lastKind: 'st' | 'sp' | 'ring' = 'st';
  constructor(readonly terms: Terms) {}
  sk() { return this.terms === 'UK' ? 'miss' : 'sk'; }
  slst() { return this.terms === 'UK' ? 'ss' : 'sl st'; }
  name(s: Stitch) { return stitchName(s, this.terms); }
  hookName(s: HookStitch) { return s.t === 'slst' ? this.slst() : stitchName(s, this.terms); }

  place(p: Place): string {
    switch (p.to) {
      case 'st': this.lastKind = 'st'; return 'next st';
      case 'sp': this.lastKind = 'sp'; return `next ch-${p.len} sp`;
      case 'ring': this.lastKind = 'ring'; return 'ring';
      case 'same': return this.lastKind === 'ring' ? 'ring' : `same ${this.lastKind}`;
    }
  }
  item(it: Item): string {
    if (it.k === 'ch') return `ch ${it.n}`;
    if (it.k === 'picot') return it.n === 3 ? 'picot' : `ch-${it.n} picot`;
    if (it.k === 'hook') return `${this.hookName(it.s)} in ${ordinal(it.nth)} ch from hook`;
    if (it.k === 'along') return it.count === 1 ? `${this.hookName(it.s)} in next ch` : `${this.hookName(it.s)} in next ${it.count} ch`;
    return it.n === 1 ? this.name(it.s) : `${it.n} ${this.name(it.s)}`;
  }
  items(items: Item[], where: string): string {
    if (items.length === 1 && items[0].k === 'st') return `${this.item(items[0])} in ${where}`;
    return `(${items.map((i) => this.item(i)).join(', ')}) in ${where}`;
  }
  op(o: Op): string {
    switch (o.k) {
      case 'into': return this.items(o.items, this.place(o.place));
      case 'each': this.lastKind = 'st'; return o.count === 1 ? `${this.name(o.s)} in next st` : `${this.name(o.s)} in next ${o.count} sts`;
      case 'ch': return `ch ${o.n}`;
      case 'picot': return o.n === 3 ? 'picot' : `ch-${o.n} picot`;
      case 'skipSt': return `${this.sk()} ${o.n} st${o.n === 1 ? '' : 's'}`;
      case 'skipSp': return `${this.sk()} next ch-${o.len} sp`;
      case 'hook': return `${this.hookName(o.s)} in ${ordinal(o.nth)} ch from hook`;
      case 'along': return o.count === 1 ? `${this.hookName(o.s)} in next ch` : `${this.hookName(o.s)} in next ${o.count} ch`;
    }
  }

  /**
   * The first op of a round, written with its turning-chain idiom. Returns the pieces and how many
   * ops (1 or 2: a following chain fused into `ch 5 (counts as dc, ch 2)`) it used.
   */
  start(ops: Op[], prevLead: number): { pieces: string[]; used: number } {
    const o = ops[0];
    const pieces: string[] = [];
    let where: string;
    if (o.k === 'into' && o.place.to === 'sp') {
      // travel: slip-stitch across the stitches before the first space, as the corpus does
      if (prevLead === 2) pieces.push(`${this.slst()} in next st`);
      else if (prevLead > 2) pieces.push(`${this.slst()} in next ${prevLead - 1} sts`);
      pieces.push(`${this.slst()} in next ch-${o.place.len} sp`);
      this.lastKind = 'sp';
      where = 'same sp';
    } else if (o.k === 'into' && o.place.to === 'ring') {
      this.lastKind = 'ring';
      where = 'ring';
    } else {
      this.lastKind = 'st';
      where = 'same st';
    }
    let items: Item[];
    let eachRest = 0;
    if (o.k === 'each') { items = [{ k: 'st', s: o.s, n: 1 }]; eachRest = o.count - 1; }
    else if (o.k === 'into') items = o.items;
    else throw new Error(`a round cannot start with "${o.k}"`);
    const first = items[0];
    if (first.k !== 'st') throw new Error('the first item of a round must be a stitch');
    const s = first.s;
    let used = 1;
    let remaining: Item[];
    if (isTall(s)) {
      const h = TCH[s.t];
      remaining = first.n > 1 ? [{ k: 'st', s, n: first.n - 1 }, ...items.slice(1)] : items.slice(1);
      const nm = plainName(s.t, this.terms);
      let fuse = 0;
      if (first.n === 1 && remaining[0]?.k === 'ch') { fuse = remaining[0].n; remaining = remaining.slice(1); }
      else if (first.n === 1 && remaining.length === 0 && eachRest === 0 && ops[1]?.k === 'ch') { fuse = (ops[1] as { n: number }).n; used = 2; }
      pieces.push(fuse ? `ch ${h + fuse} (counts as ${nm}, ch ${fuse})` : `ch ${h} (counts as ${nm})`);
    } else if (s.t === 'cl') {
      pieces.push(`ch ${TCH[s.base] - 1}`);
      pieces.push(`${stitchName(s, this.terms, s.legs - 1)} in ${where}`);
      remaining = first.n > 1 ? [{ k: 'st', s, n: first.n - 1 }, ...items.slice(1)] : items.slice(1);
    } else {
      const lead = s.t === 'sc' ? 1 : s.t === 'hdc' || s.t === 'puff' ? 2 : 3;
      pieces.push(`ch ${lead}`);
      remaining = items;
    }
    // a group with hook-addressed stitches (a snowflake arm) must stay one group, so that its last
    // stitch goes back into the group's place and not into the chain worked last
    if (items.some((it) => it.k === 'hook' || it.k === 'along') || (items.some((it) => it.k === 'picot') && items.some((it) => it.k === 'ch'))) {
      if (remaining.length) pieces.push(this.items(remaining, where));
      if (eachRest) pieces.push(eachRest === 1 ? `${this.name(s)} in next st` : `${this.name(s)} in next ${eachRest} sts`);
      return { pieces, used };
    }
    // the rest of the first group, in the same place; chains between its stitches written out
    let run: Item[] = [];
    const flush = () => { if (run.length) pieces.push(this.items(run, where)); run = []; };
    for (const it of remaining) {
      if (it.k === 'ch') { flush(); pieces.push(`ch ${it.n}`); } else run.push(it);
    }
    flush();
    if (eachRest) pieces.push(eachRest === 1 ? `${this.name(s)} in next st` : `${this.name(s)} in next ${eachRest} sts`);
    return { pieces, used };
  }
}

/** Smallest block that the op list is a whole-number repetition of. */
export function period(ops: Op[]): number {
  const keys = ops.map((o) => JSON.stringify(o));
  for (let u = 1; u < keys.length; u++) {
    if (keys.length % u) continue;
    let ok = true;
    for (let i = u; i < keys.length && ok; i++) ok = keys[i] === keys[i % u];
    if (ok) return u;
  }
  return keys.length;
}

export interface RoundText {
  /** The instruction part after `Rnd N: ` and before the count annotation. */
  body: string;
}

/**
 * Write one round: the first repeat with its starting idiom, then `*…* x(N−1)`, then `join`.
 * `prevLead` = stitches of the previous round before its first chain space (for travel slip
 * stitches). `ring` = how a centre round opens its ring.
 */
export function writeRound(opts: {
  sector: Op[]; repeats: number; terms: Terms; prevLead: number; ring?: { chains: number }; fastenOff?: boolean;
}): string {
  const { sector, repeats, terms } = opts;
  const W = new Writer(terms);
  const u = period(sector);
  const unit = sector.slice(0, u);
  const total = repeats * (sector.length / u);
  const parts: string[] = [];
  if (opts.ring) parts.push(opts.ring.chains ? `ch ${opts.ring.chains}, join to form ring` : 'mr');

  // "dc in each st around" / "2 dc in each st around" when the repeat is a single plain stitch op
  const single = unit.length === 1 ? unit[0] : undefined;
  const st = new Writer(terms);
  if (single && single.k === 'each' && single.count === 1) {
    const { pieces } = W.start(unit, opts.prevLead);
    parts.push(...pieces, `${st.name(single.s)} in each st around`);
  } else if (single && single.k === 'into' && single.place.to === 'st' && single.items.length === 1 && single.items[0].k === 'st') {
    const { pieces } = W.start(unit, opts.prevLead);
    parts.push(...pieces, `${st.item(single.items[0])} in each st around`);
  } else if (single && single.k === 'into' && single.place.to === 'ring' && single.items.length === 1 && single.items[0].k === 'st') {
    // centre: all stitches into the ring in one go
    const it = single.items[0];
    const { pieces } = W.start([{ k: 'into', place: { to: 'ring' }, items: [{ k: 'st', s: it.s, n: it.n * total }] }], 0);
    parts.push(...pieces);
  } else {
    const { pieces, used } = W.start(unit, opts.prevLead);
    parts.push(...pieces);
    for (const o of unit.slice(used)) parts.push(W.op(o));
    const R = new Writer(terms);
    R.lastKind = W.lastKind;
    // inside the repeat "same" refers to what the repeat itself worked into
    const rep = unit.map((o) => R.op(o)).join(', ');
    if (total > 1) parts.push(`*${rep}* x${total - 1}`);
  }
  parts.push('join');
  if (opts.fastenOff) parts.push('fasten off');
  return parts.join(', ');
}

/** Count annotation for a round from its sector entries (× repeats). */
export function countAnnotation(entries: Entry[], repeats: number, terms: Terms, picots: number): string {
  const sts = entries.filter((e) => e.kind === 'st') as Extract<Entry, { kind: 'st' }>[];
  const kinds = new Map<string, number>();
  for (const e of sts) {
    const key = e.cluster ? 'cl' : e.type === 'popcorn' ? 'pc' : e.type === 'puff' ? 'puff' : plainName(e.type, terms);
    kinds.set(key, (kinds.get(key) ?? 0) + repeats);
  }
  const spaces = new Map<number, number>();
  for (const e of entries) if (e.kind === 'sp') spaces.set(e.len, (spaces.get(e.len) ?? 0) + repeats);
  const N = sts.length * repeats;
  const parts: string[] = [];
  if (kinds.size === 1 && !spaces.size && !picots) {
    const [k] = [...kinds.keys()];
    return k === 'cl' || k === 'pc' || k === 'puff' ? `(${N} ${k})` : `(${N})`;
  }
  if (kinds.size === 1) parts.push(`${N} ${[...kinds.keys()][0]}`);
  else {
    parts.push(`${N} sts`);
    for (const k of ['cl', 'pc', 'puff']) if (kinds.has(k)) parts.push(`${kinds.get(k)} ${k}`);
  }
  if (picots) parts.push(`${picots * repeats} picot`);
  for (const [len, c] of [...spaces.entries()].sort((a, b) => a[0] - b[0])) parts.push(`${c} ch-${len} sps`);
  return `(${parts.join(', ')})`;
}

/** Picots per sector. */
export function picotCount(ops: Op[]): number {
  let n = 0;
  for (const o of ops) {
    if (o.k === 'picot') n++;
    else if (o.k === 'into') for (const it of o.items) if (it.k === 'picot') n++;
  }
  return n;
}
