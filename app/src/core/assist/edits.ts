/**
 * Candidate edits of one round's notation (the "moves" of the flatness assistant). Each draft
 * is a set of item replacements / removals / repeat-count changes on the round's AST, or a
 * rewrite of the body of a solid round; `materialize` turns it into text edits.
 */
import type { Graph } from '../graph';
import { stitchCounting } from '../graph';
import type { BaseType, ChainItem, Item, PatternAst, RepeatItem, RoundAst, StitchItem } from '../notation';
import { consumption, type Use } from './consume';
import { DUMMY, LineIndex, printItems, walkItems, type TextEdit } from './text';

export interface Draft {
  kind: 'chain' | 'count' | 'shell' | 'solid' | 'inc' | 'skip' | 'repeat';
  /** Crocheter's description, e.g. "change ch 5 → ch 3 in each repeat". */
  change: string;
  /** Edit size for ranking (≈ stitches changed per repeat). */
  size: number;
  mods: Map<Item, Item | null>;
  /** Repeat-count changes (repeat → new total). */
  times: Map<RepeatItem, number>;
  /** Replace the round's body (solid rewrite): original offsets + text. */
  body?: TextEdit;
  /** Re-balance the main repeat count after the item changes so the round consumes what it did. */
  rebalance?: boolean;
  /** Chain spaces change length: "ch-N" references in the count and in the next round follow. */
  renameSpaces?: { from: number; to: number };
}

const newDraft = (kind: Draft['kind'], change: string, size: number): Draft => ({ kind, change, size, mods: new Map(), times: new Map() });

export interface RoundParts {
  /** Index of the first body item (after turning chain, ring, travelling slip stitches). */
  bodyStart: number;
  /** Index after the last body item (before join / fasten off / turn). */
  bodyEnd: number;
  tch?: ChainItem;
  tchCounts: boolean;
}

export function roundParts(r: RoundAst): RoundParts {
  const it = r.items;
  let i = 0, tch: ChainItem | undefined;
  while (i < it.length) {
    const x = it[i];
    if (x.kind === 'ring' || x.kind === 'ringJoin') { i++; continue; }
    if (x.kind === 'chain' && it[i + 1]?.kind === 'ringJoin') { i++; continue; }
    if (x.kind === 'stitch' && x.spec.kind === 'basic' && x.spec.type === 'slst') { i++; continue; }
    if (x.kind === 'chain' && !tch) { tch = x; i++; continue; }
    break;
  }
  let j = it.length;
  while (j > i && ['join', 'fasten', 'turn'].includes(it[j - 1].kind)) j--;
  return { bodyStart: i, bodyEnd: j, tch, tchCounts: tch?.countsAs?.kind === 'counts' };
}

/** The round's main repeat: the top-level `*…* xN` with the most repetitions. */
export function mainRepeat(items: Item[]): RepeatItem | undefined {
  let best: RepeatItem | undefined;
  for (const x of items) if (x.kind === 'repeat' && x.times.kind === 'n' && (!best || x.times.n > (best.times as { n: number }).n)) best = x;
  return best;
}

/** Items with the draft's changes applied (for consumption arithmetic). */
export function applyMods(items: Item[], d: Draft): Item[] {
  const out: Item[] = [];
  for (const x of items) {
    const m = d.mods.has(x) ? d.mods.get(x)! : x;
    if (m === null) continue;
    let y = m;
    if (y.kind === 'repeat' || y.kind === 'group') y = { ...y, items: applyMods(y.items, d) } as Item;
    if (x.kind === 'repeat' && d.times.has(x)) y = { ...(y as RepeatItem), times: { kind: 'n', n: d.times.get(x)! } };
    out.push(y);
  }
  return out;
}

/** Set `d.times` so the round consumes what it did before the item changes. False if impossible. */
export function rebalance(r: RoundAst, d: Draft, target?: Use): boolean {
  const rep = mainRepeat(r.items);
  if (!rep || rep.times.kind !== 'n') return false;
  const before = target ?? consumption(r.items);
  const modItems = applyMods(r.items, d);
  const after = consumption(modItems);
  const modRep = modItems.find((x, i) => r.items[i] === rep) as RepeatItem | undefined ?? (applyMods([rep], d)[0] as RepeatItem);
  const body = modRep && modRep.kind === 'repeat' ? consumption(modRep.items) : null;
  if (!before || !after || !body) return false;
  let dn: number | undefined;
  for (const k of ['st', 'sp'] as const) {
    const diff = before[k] - after[k];
    if (body[k] === 0) { if (diff !== 0) return false; continue; }
    if (diff % body[k] !== 0) return false;
    const v = diff / body[k];
    if (dn !== undefined && v !== dn) return false;
    dn = v;
  }
  if (dn === undefined) return dn === undefined && before.st === after.st && before.sp === after.sp;
  const cur = d.times.get(rep) ?? rep.times.n;
  const n = cur + dn;
  if (n < 1) return false;
  if (n !== rep.times.n) d.times.set(rep, n); else d.times.delete(rep);
  return true;
}

/** Text edits for a draft (offsets into the original text). */
export function materialize(text: string, li: LineIndex, ast: PatternAst, r: RoundAst, d: Draft): TextEdit[] {
  const edits: TextEdit[] = [];
  if (d.body) edits.push(d.body);
  const removeAt = (list: Item[], i: number) => {
    const x = list[i];
    if (i > 0) return { from: li.end(list[i - 1].span), to: li.end(x.span), insert: '' };
    if (i + 1 < list.length) return { from: li.start(x.span), to: li.start(list[i + 1].span), insert: '' };
    return { from: li.start(x.span), to: li.end(x.span), insert: '' };
  };
  const visit = (list: Item[]) => {
    list.forEach((x, i) => {
      if (d.mods.has(x)) {
        const m = d.mods.get(x)!;
        edits.push(m === null ? removeAt(list, i) : { from: li.start(x.span), to: li.end(x.span), insert: printItems(expandFlat([m]), ast) });
        return;
      }
      if (x.kind === 'repeat' || x.kind === 'group') visit(x.items);
      if (x.kind === 'repeat' && d.times.has(x)) {
        const n = d.times.get(x)!;
        const last = x.items[x.items.length - 1];
        const from = last ? li.end(last.span) : li.start(x.span);
        const to = li.end(x.span);
        const tail = text.slice(from, to);
        const m = /(\d+)(?!.*\d)/s.exec(tail);
        if (m) {
          const v = /more/i.test(tail) ? n - 1 : n;
          edits.push({ from: from + m.index, to: from + m.index + m[1].length, insert: String(v) });
        }
      }
    });
  };
  visit(r.items);
  if (d.renameSpaces && r.count) {
    const { from: N, to: N2 } = d.renameSpaces;
    const parts = r.count.parts;
    const merge = parts.some((p) => p.unit.kind === 'spaces' && p.unit.chains === N2);
    for (const [i, p] of parts.entries()) {
      if (p.unit.kind !== 'spaces' || p.unit.chains !== N) continue;
      if (merge && i > 0) { edits.push({ from: li.end(parts[i - 1].span), to: li.end(p.span), insert: '' }); continue; }
      const a = li.start(p.span), b = li.end(p.span);
      const m = new RegExp(`ch-\\s*${N}(?!\\d)`).exec(text.slice(a, b));
      if (m) edits.push({ from: a + m.index, to: a + m.index + m[0].length, insert: `ch-${N2}` });
    }
  }
  return edits;
}

/** Edits to a later round so its "ch-N sp" references follow a change of chain length. */
export function renameSpaceRefs(li: LineIndex, ast: PatternAst, r: RoundAst, from: number, to: number): TextEdit[] {
  const edits: TextEdit[] = [];
  const hit = (x: Item): Item | null => {
    const tg = (x as { target?: StitchItem['target'] }).target;
    if (x.kind === 'skip' && x.unit.kind === 'space' && x.unit.chains === from) return { ...x, unit: { ...x.unit, chains: to } };
    if (tg && 'unit' in tg.place && tg.place.unit.kind === 'space' && tg.place.unit.chains === from) {
      return { ...x, target: { ...tg, place: { ...tg.place, unit: { ...tg.place.unit, chains: to } } } } as Item;
    }
    return null;
  };
  const visit = (list: Item[]) => {
    for (const x of list) {
      const y = hit(x);
      if (y && x.kind !== 'group' && x.kind !== 'repeat') { edits.push({ from: li.start(x.span), to: li.end(x.span), insert: printItems([y], ast) }); continue; }
      if (y && x.kind === 'group') {
        // only the group's own target: replace the text after the closing bracket
        const tg = (x as { target?: StitchItem['target'] }).target!;
        const yy = y as typeof x;
        edits.push({ from: li.start(tg.span), to: li.end(tg.span), insert: printItems([{ ...yy, items: [], bracket: '(' } as Item], ast).replace(/^\(\)\s*/, '').replace(/\s*x\d+$|\s*(around|across|to end)$/, '') });
      }
      if (x.kind === 'group' || x.kind === 'repeat') visit(x.items);
    }
  };
  visit(r.items);
  return edits;
}

// ------------------------------------------------------------------ helpers to build items

const st = (type: BaseType, loop: StitchItem['loop'], count: number | undefined, place: StitchItem['target'] extends infer T ? T : never): StitchItem => ({
  kind: 'stitch', count, spec: { kind: 'basic', type }, loop, target: place, name: type, span: DUMMY,
});
const next = (n?: number) => ({ prep: 'in' as const, place: { kind: 'next' as const, n: n && n > 1 ? n : undefined, unit: { kind: 'st' as const } }, span: DUMMY });
const same = () => ({ prep: 'in' as const, place: { kind: 'same' as const, unit: { kind: 'st' as const } }, span: DUMMY });
const eachAround = () => ({ prep: 'in' as const, place: { kind: 'each' as const, unit: { kind: 'st' as const }, extent: 'around' as const }, span: DUMMY });

function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a; }

// ------------------------------------------------------------------ the moves

export interface SolidInfo { S: BaseType; loop?: 'flo' | 'blo'; P: number; count: number }

/** Is graph round g a solid round of one plain stitch worked into every stitch of round g−1? */
export function solidInfo(graph: Graph, g: number): SolidInfo | null {
  if (g < 1) return null;
  const R = graph.rounds[g], Rp = graph.rounds[g - 1];
  if (!R || !Rp || R.first < 0 || R.kind !== 'round') return null;
  if (graph.spaces.some((s) => s.round === g && s.kind === 'chsp')) return null;
  let S: string | undefined, loop: string | undefined | null = null;
  const anchors = new Set<number>();
  for (let id = R.first; id <= R.last; id++) {
    const n = graph.nodes[id];
    if (n.type === 'ch' && !n.countsAs) continue;
    if (n.type === 'slst') continue;
    if (!stitchCounting(n) || n.tag === 'cluster') return null;
    const t = n.countsAs ?? n.type;
    if (!['sc', 'hdc', 'dc', 'tr', 'dtr'].includes(t)) return null;
    if (n.loop === 'fp' || n.loop === 'bp') return null;
    if (S === undefined) S = t; else if (S !== t) return null;
    if (loop === null) loop = n.loop; else if (loop !== n.loop && !n.countsAs) return null;
    for (const a of n.into) {
      if (!('node' in a)) return null;
      const tn = graph.nodes[a.node];
      if (!tn || tn.round !== g - 1) return null;
      anchors.add(a.node);
    }
  }
  if (!S || anchors.size !== Rp.stitchCount) return null;
  return { S: S as BaseType, loop: (loop ?? undefined) as SolidInfo['loop'], P: Rp.stitchCount, count: R.stitchCount };
}

/** Body items of a solid round: P stitches into P, n repeats, m increases per repeat. */
export function solidBody(info: SolidInfo, n: number, m: number, tchCounts: boolean): { items: Item[]; unit: string } | null {
  const { S, loop, P } = info;
  if (P % n !== 0) return null;
  const q = P / n;
  if (m < 0 || m > q) return null;
  if (m === 0) return { items: [st(S, loop, undefined, eachAround())], unit: `${S} in each st` };
  if (m === q) {
    const items: Item[] = tchCounts ? [st(S, loop, undefined, same()), st(S, loop, 2, eachAround())] : [st(S, loop, 2, eachAround())];
    return { items, unit: `2 ${S} in each st` };
  }
  const g = gcd(q, m), u = q / g, mu = m / g;
  const unit: Item[] = [];
  let run = 0;
  const flush = () => { if (run > 0) unit.push(st(S, loop, undefined, next(run))); run = 0; };
  for (let j = 0; j < u; j++) {
    const inc = Math.floor(((j + 1) * mu) / u) - Math.floor((j * mu) / u) === 1;
    if (inc) { flush(); unit.push(st(S, loop, 2, next())); } else run++;
  }
  flush();
  const K = n * g;
  const rep = (k: number): RepeatItem => ({ kind: 'repeat', items: unit, times: { kind: 'n', n: k }, form: 'star', span: DUMMY, openSpan: DUMMY });
  if (!tchCounts) return { items: [rep(K)], unit: unitText(unit) };
  // the counting turning chain stands in the first stitch: write the first repeat out without it
  const first = unit[0] as StitchItem;
  const k0 = (first.target?.place.kind === 'next' ? first.target.place.n ?? 1 : 1) - 1;
  const head: Item[] = [...(k0 > 0 ? [st(S, loop, undefined, next(k0))] : []), ...unit.slice(1)];
  return { items: K > 1 ? [...head, rep(K - 1)] : head, unit: unitText(unit) };
}

function unitText(unit: Item[]): string {
  return unit.map((x) => {
    const s = x as StitchItem;
    if (s.count === 2) return 'inc';
    const k = s.target?.place.kind === 'next' ? s.target.place.n ?? 1 : 1;
    return `${k} ${s.spec.kind === 'basic' ? s.spec.type : ''}`.trim();
  }).join(', ');
}

/** All candidate drafts for AST round r (graph round g). */
export function drafts(text: string, li: LineIndex, ast: PatternAst, r: RoundAst, graph: Graph, g: number, opts: {
  order: number; flatCount: number; ownOrder: number;
}): Draft[] {
  const out: Draft[] = [];
  const parts = roundParts(r);
  const inRepeat = (parents: Item[]) => parents.some((p) => p.kind === 'repeat');
  const anyInRepeat = (xs: { parents: Item[] }[]) => xs.some((x) => inRepeat(x.parents));
  const where = (xs: { parents: Item[] }[]) => (anyInRepeat(xs) ? ' in each repeat' : '');

  // ---- chain lengths (incl. the chains after a "counts as dc, ch N" turning chain)
  const chains = new Map<number, { it: ChainItem; parents: Item[]; extra: boolean; list: Item[] }[]>();
  walkItems(r.items, (x, parents) => {
    if (x.kind !== 'chain') return;
    const list = parents.length ? (parents[parents.length - 1] as { items: Item[] }).items : r.items;
    const idx = list.indexOf(x);
    if (list[idx + 1]?.kind === 'ringJoin') return;
    if (x === parts.tch) {
      if (x.countsAs?.kind === 'counts' && x.countsAs.extraCh) {
        const N = x.countsAs.extraCh;
        if (!chains.has(N)) chains.set(N, []);
        chains.get(N)!.push({ it: x, parents, extra: true, list });
      }
      return;
    }
    if (!chains.has(x.n)) chains.set(x.n, []);
    chains.get(x.n)!.push({ it: x, parents, extra: false, list });
  });
  for (const [N, xs] of chains) {
    for (let N2 = 0; N2 <= N + 4; N2++) {
      if (N2 === N) continue;
      if (N2 === 0 && (N > 2 || xs.some((x) => x.extra))) continue;
      const d = newDraft('chain', N2 === 0 ? `leave out the ch ${N}${where(xs)}` : `change ch ${N} → ch ${N2}${where(xs)}`, Math.abs(N2 - N) * 0.6 + (N2 === 0 ? 1 : 0));
      if (N2 > 0) d.renameSpaces = { from: N, to: N2 };
      for (const x of xs) {
        if (x.extra) {
          const c = x.it.countsAs as Extract<ChainItem['countsAs'], { kind: 'counts' }>;
          d.mods.set(x.it, { ...x.it, n: x.it.n - N + N2, countsAs: { ...c, extraCh: N2 || undefined } });
        } else d.mods.set(x.it, N2 === 0 ? null : { ...x.it, n: N2 });
      }
      out.push(d);
    }
  }

  // ---- number of stitches worked into one place; shell sizes
  type SI = { it: StitchItem; parents: Item[] };
  const inPlace = new Map<string, SI[]>();
  const shells = new Map<string, SI[]>();
  walkItems(r.items, (x, parents) => {
    if (x.kind !== 'stitch') return;
    const parent = parents[parents.length - 1];
    if (x.spec.kind === 'shell' && !x.count) {
      const k = `${x.spec.base}${x.spec.n}`;
      if (!shells.has(k)) shells.set(k, []);
      shells.get(k)!.push({ it: x, parents });
      return;
    }
    if (x.spec.kind !== 'basic' || x.spec.type === 'slst' || x.times) return;
    const pk = x.target?.place.kind;
    const single = x.target && (pk === 'same' || pk === 'ring' || pk === 'first' || pk === 'topOf' || (pk === 'next' && (x.target.place as { n?: number }).n === undefined));
    const grouped = !x.target && parent?.kind === 'group' && !!parent.target;
    if (!single && !grouped) return;
    if (!single && (x.count ?? 1) === 1 && !(parent?.kind === 'group')) return;
    const unit = x.target ? (x.target.place.kind === 'ring' ? 'ring' : (x.target.place as { unit?: { kind: string } }).unit?.kind === 'space' ? 'sp' : 'st') : 'grp';
    const k = `${x.spec.type}|${x.loop ?? ''}|${unit}`;
    if (!inPlace.has(k)) inPlace.set(k, []);
    inPlace.get(k)!.push({ it: x, parents });
  });
  for (const [k, xs] of inPlace) {
    const [type, , unit] = k.split('|');
    const cMax = Math.max(...xs.map((x) => x.it.count ?? 1));
    // a single stitch into each place "into each st" is not a place-count (it is a solid round)
    if (unit === 'st' && cMax === 1) continue;
    for (const dl of [-2, -1, 1, 2]) {
      if (xs.some((x) => (x.it.count ?? 1) + dl < 1)) continue;
      const placeWord = unit === 'sp' ? 'space' : unit === 'ring' ? 'ring' : unit === 'grp' ? 'group' : 'stitch';
      const d = newDraft('count', `work ${cMax + dl} ${type} instead of ${cMax} ${type} in each ${placeWord}${unit !== 'grp' ? '' : ''}`, Math.abs(dl));
      for (const x of xs) d.mods.set(x.it, { ...x.it, count: (x.it.count ?? 1) + dl === 1 ? undefined : (x.it.count ?? 1) + dl });
      out.push(d);
    }
  }
  for (const [, xs] of shells) {
    const s0 = xs[0].it.spec as Extract<StitchItem['spec'], { kind: 'shell' }>;
    for (const dl of [-3, -2, -1, 1, 2]) {
      const n2 = s0.n + dl;
      if (n2 < 2) continue;
      const d = newDraft('shell', `use ${n2}-${s0.base} shells instead of ${s0.n}-${s0.base}`, Math.abs(dl));
      for (const x of xs) d.mods.set(x.it, { ...x.it, spec: { ...s0, n: n2, explicit: true } });
      out.push(d);
      // fewer / more shells: combine with a skip change below via rebalance drafts
    }
  }

  // ---- add / remove one increase per repeat (stitch runs inside repeats)
  const runs = new Map<string, SI[]>();
  const pairs = new Map<string, SI[]>();
  walkItems(r.items, (x, parents) => {
    if (x.kind !== 'stitch' || !inRepeat(parents) || x.spec.kind !== 'basic' || x.spec.type === 'slst' || x.spec.post || x.times) return;
    const pl = x.target?.place;
    if (!x.target && (x.count ?? 1) >= 2) {
      const k = `n|${x.spec.type}|${x.loop ?? ''}|${x.count}`;
      (runs.get(k) ?? runs.set(k, []).get(k)!).push({ it: x, parents });
    } else if (pl?.kind === 'next' && pl.unit.kind === 'st' && (pl.n ?? 1) >= 2 && (x.count ?? 1) === 1) {
      const k = `t|${x.spec.type}|${x.loop ?? x.target!.loop ?? ''}|${pl.n}`;
      (runs.get(k) ?? runs.set(k, []).get(k)!).push({ it: x, parents });
    } else if (pl?.kind === 'next' && pl.unit.kind === 'st' && (pl.n ?? 1) === 1 && x.count === 2) {
      const k = `p|${x.spec.type}|${x.loop ?? ''}`;
      (pairs.get(k) ?? pairs.set(k, []).get(k)!).push({ it: x, parents });
    }
  });
  for (const [, xs] of runs) {
    const x0 = xs[0].it;
    const type = (x0.spec as { type: BaseType }).type;
    const k = x0.target ? ((x0.target.place as { n?: number }).n ?? 1) : x0.count!;
    const d = newDraft('inc', `add an increase in each repeat (${type} in next ${k} sts → ${type} in next ${k - 1 === 1 ? 'st' : `${k - 1} sts`}, 2 ${type} in next st)`, 1.2);
    for (const x of xs) {
      const loop = x.it.loop ?? x.it.target?.loop;
      // replace one item by two: encode as a replacement whose printed text is "a, b"
      d.mods.set(x.it, { kind: 'group', bracket: '(', items: [st(type, loop, undefined, next(k - 1)), st(type, loop, 2, next())], span: DUMMY, flat: true } as unknown as Item);
    }
    out.push(d);
  }
  for (const [, xs] of pairs) {
    const type = (xs[0].it.spec as { type: BaseType }).type;
    const d = newDraft('inc', `drop one increase in each repeat (2 ${type} in next st → ${type} in next st)`, 1.2);
    for (const x of xs) d.mods.set(x.it, { ...x.it, count: undefined });
    out.push(d);
  }

  // ---- skips (with the repeat count re-balanced so the round still goes all the way round)
  const skips = new Map<string, { it: Extract<Item, { kind: 'skip' }>; parents: Item[] }[]>();
  walkItems(r.items, (x, parents) => {
    if (x.kind !== 'skip') return;
    const k = `${x.n}|${JSON.stringify(x.unit)}`;
    (skips.get(k) ?? skips.set(k, []).get(k)!).push({ it: x, parents });
  });
  for (const [, xs] of skips) {
    const n = xs[0].it.n;
    for (const dl of [-1, 1, 2, 3]) {
      const n2 = n + dl;
      if (n2 < 0) continue;
      const d = newDraft('skip', n2 === 0 ? `stop skipping (no "sk ${n}")` : `skip ${n2} instead of ${n}`, 1 + Math.abs(dl) * 0.5);
      for (const x of xs) d.mods.set(x.it, n2 === 0 ? null : { ...x.it, n: n2 });
      d.rebalance = true;
      out.push(d);
      // skip change + one fewer / more stitch per shell (keeps the edge width in proportion)
      for (const [, ss] of shells) {
        const s0 = ss[0].it.spec as Extract<StitchItem['spec'], { kind: 'shell' }>;
        for (const sd of [-2, -1, 1]) {
          if (s0.n + sd < 2) continue;
          const d2 = newDraft('skip', `${d.change} and use ${s0.n + sd}-${s0.base} shells`, d.size + Math.abs(sd));
          for (const [kk, v] of d.mods) d2.mods.set(kk, v);
          for (const x of ss) d2.mods.set(x.it, { ...x.it, spec: { ...s0, n: s0.n + sd, explicit: true } });
          d2.rebalance = true;
          out.push(d2);
        }
      }
    }
  }

  // ---- rewrite a solid round with evenly spread increases
  const info = solidInfo(graph, g);
  if (info && parts.bodyEnd > parts.bodyStart) {
    const from = li.start(r.items[parts.bodyStart].span), to = li.end(r.items[parts.bodyEnd - 1].span);
    const ns = new Set<number>();
    for (const n of [opts.order, opts.ownOrder, 2 * opts.order, 3 * opts.order]) if (n >= 1 && info.P % n === 0 && n <= info.P) ns.add(n);
    if (ns.size === 0) ns.add(1);
    const delta = opts.flatCount - info.P;
    const seen = new Set<string>();
    for (const n of ns) {
      const m0 = Math.round(delta / n);
      for (const m of [m0 - 1, m0, m0 + 1]) {
        const body = solidBody(info, n, m, parts.tchCounts);
        if (!body) continue;
        const ins = printItems(body.items, ast);
        if (seen.has(ins) || ins === text.slice(from, to)) continue;
        seen.add(ins);
        const total = info.P + n * m;
        const d = newDraft('solid', m === 0 ? `work ${total} sts without increases (${info.S} in each st)` : `work ${total} sts: ${n * m} increases spread evenly (${body.unit}) ×${n * gcd(info.P / n, m)}`,
          1 + Math.abs(total - info.count) / Math.max(1, opts.order));
        d.body = { from, to, insert: ins };
        out.push(d);
      }
    }
  }
  return out;
}

/** Print helper that understands the "flat" pseudo-group used for one-to-two item splits. */
export function expandFlat(items: Item[]): Item[] {
  const out: Item[] = [];
  for (const x of items) {
    if (x.kind === 'group' && (x as unknown as { flat?: boolean }).flat) out.push(...expandFlat(x.items));
    else if (x.kind === 'group' || x.kind === 'repeat') out.push({ ...x, items: expandFlat(x.items) } as Item);
    else out.push(x);
  }
  return out;
}
