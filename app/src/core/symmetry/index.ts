/**
 * Symmetry analysis of a stitch graph (pure; no DOM). Method and limits: README.md here.
 *
 *   analyzeSymmetry(graph) → SymmetryReport
 *     per round: own rotational order, cumulative order of the piece so far, mirror symmetry,
 *     "almost symmetric" defects (a typo in one repeat) with the nodes that break the repeat;
 *     whole piece: order, dihedral or cyclic group label, plain-language summary, and a drawing
 *     frame (sector boundaries and mirror axes on the outermost round) for chart overlays.
 */
import type { Graph } from '../graph';
import { buildSequences, type Elem, type RoundSeq } from './sequence';

export type { Elem, Leg, RoundSeq } from './sequence';
export { buildSequences } from './sequence';

export interface SymmetryDefect {
  round: number;
  /** Node ids that break the round's dominant repeat. */
  nodes: number[];
  message: string;
  /** The order the round would have without this defect. */
  order?: number;
  /** 1-based stitch numbers (within the round) around the defect, for messages and jumping. */
  stitches?: [number, number];
}
export interface RoundSymmetry {
  round: number;
  label: string;
  /** Rotational order of this round on its own (1 = no repeat). */
  order: number;
  /** True if one repeat reads the same forwards and backwards (dihedral / mirror symmetry). */
  mirror: boolean;
  /** Stitch-counting nodes per repeat. */
  period: number;
  /** Order the round would have without its defects, when that is higher than `order`. */
  nearOrder?: number;
  defects: SymmetryDefect[];
  /** Order of the piece from the centre up to and including this round. */
  cumulative?: number;
  /** The piece up to this round is mirror-symmetric. */
  cumulativeMirror?: boolean;
  /** Number of structural elements (stitches, chain spaces, picots) in the round. */
  elements?: number;
}
/**
 * Where to draw the symmetry on a chart: positions on `round`'s element sequence, in element
 * units (an integer = through that element, x.5 = between element x and x+1, wrapping).
 */
export interface SymmetryFrame {
  round: number;
  /** Representative node id of every element of `round` (chart positions come from these). */
  elementNodes: number[];
  /** `order` sector boundaries; sector 0 (from sectors[0] to sectors[1]) is one repeat. */
  sectors: number[];
  /** Mirror axes as half-lines from the centre (2·order of them) when the piece is dihedral. */
  axes: number[];
}
export interface SymmetryReport {
  /** Rotational order of the whole piece: the largest n for which every round is n-fold. */
  order: number;
  /** Whole piece mirror-symmetric (dihedral D_n rather than cyclic C_n). */
  mirror: boolean;
  /** 'D6', 'C12', 'C1'… */
  group: string;
  rounds: RoundSymmetry[];
  defects: SymmetryDefect[];
  /** Plain-language summary lines. */
  summary: string[];
  /** False for pieces worked in rows. */
  applicable: boolean;
  /** Drawing frame for chart overlays (absent when not applicable). */
  frame?: SymmetryFrame;
}

// ------------------------------------------------------------------------------------------------

const mod = (a: number, m: number) => ((a % m) + m) % m;

function divisorsDesc(n: number): number[] {
  const out: number[] = [];
  for (let d = 1; d * d <= n; d++) if (n % d === 0) { out.push(d); if (d * d !== n) out.push(n / d); }
  return out.sort((a, b) => b - a);
}
function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a; }

function fullLabel(e: Elem): string {
  return `${e.base}|${e.legs.map((l) => (l.sub >= 0 ? `${l.tl}@${l.sub}` : l.tl)).join(',')}`;
}
function mirrorLabel(e: Elem): string {
  return `${e.base}|${[...e.legs].reverse().map((l) => (l.sub >= 0 ? `${l.tl}@${l.size - 1 - l.sub}` : l.tl)).join(',')}`;
}

class Interner {
  private m = new Map<string, number>();
  id(s: string): number { let v = this.m.get(s); if (v === undefined) { v = this.m.size; this.m.set(s, v); } return v; }
}

interface Ctx {
  seqs: RoundSeq[];
  L: number[];
  lab: number[][];
  mir: number[][];
}

/**
 * Is round r invariant under shifting its elements by p, with anchors in round q moving by
 * shift(q)? shift(q) === null: any constant shift (determined from the first leg into q).
 */
function rotOK(c: Ctx, r: number, p: number, shift: (q: number) => number | null): boolean {
  const L = c.L[r], lab = c.lab[r], el = c.seqs[r].elems;
  const D = new Map<number, number>();
  for (let i = 0; i < L; i++) {
    const j = (i + p) % L;
    if (lab[i] !== lab[j]) return false;
    const a = el[i].legs, b = el[j].legs;
    if (a.length !== b.length) return false;
    for (let k = 0; k < a.length; k++) {
      const q = a[k].round;
      if (q < 0 || a[k].pos < 0) continue;
      if (b[k].round !== q) return false;
      const Lq = c.L[q];
      if (!Lq) continue;
      let s = shift(q);
      if (s === null) {
        const known = D.get(q);
        const d = mod(b[k].pos - a[k].pos, Lq);
        if (known === undefined) { D.set(q, d); continue; }
        s = known;
      }
      if (mod(a[k].pos + s, Lq) !== b[k].pos) return false;
    }
  }
  return true;
}

/**
 * Valid mirror centres of round r: c such that element c−i is the mirror image of element i,
 * with anchors in round q mirrored about some centre c'_q (accepted by `okPrev`). Candidates are
 * tested modulo `p` (the reflection classes under the round's rotations).
 */
function mirrorCentres(c: Ctx, r: number, p: number, okPrev: (q: number, cq: number) => boolean, limit = Infinity): number[] {
  const L = c.L[r], lab = c.lab[r], mir = c.mir[r], el = c.seqs[r].elems;
  const out: number[] = [];
  for (let cc = 0; cc < Math.min(p, L) && out.length < limit; cc++) {
    let ok = true;
    const C = new Map<number, number>();
    for (let i = 0; i < L && ok; i++) {
      const j = mod(cc - i, L);
      if (lab[j] !== mir[i]) { ok = false; break; }
      const a = el[i].legs, b = el[j].legs;
      if (a.length !== b.length) { ok = false; break; }
      for (let k = 0; k < a.length; k++) {
        const bk = b[a.length - 1 - k];
        const q = a[k].round;
        if (q < 0 || a[k].pos < 0) continue;
        if (bk.round !== q) { ok = false; break; }
        const Lq = c.L[q];
        if (!Lq) continue;
        const cq = mod(a[k].pos + bk.pos, Lq);
        const known = C.get(q);
        if (known === undefined) C.set(q, cq);
        else if (known !== cq) { ok = false; break; }
      }
    }
    if (!ok) continue;
    for (const [q, cq] of C) if (!okPrev(q, cq)) { ok = false; break; }
    if (ok) out.push(cc);
  }
  return out;
}

// ---------------------------------------------------------------- defects ("almost symmetric")

interface Tok { id: number; parts: { base: string; tls: string; deltas: string } }

/** Own-structure tokens: element label + (repaired) target labels + how far each leg advances. */
function defectTokens(c: Ctx, r: number, repaired: string[][], intern: Interner): Tok[] {
  const el = c.seqs[r].elems;
  const last = new Map<number, number>();
  // last leg position per round, cyclically: start from the final anchored element
  for (let i = el.length - 1; i >= 0; i--) {
    for (let k = el[i].legs.length - 1; k >= 0; k--) {
      const l = el[i].legs[k];
      if (l.round >= 0 && l.pos >= 0 && !last.has(l.round)) last.set(l.round, l.pos);
    }
  }
  return el.map((e) => {
    const tls = e.legs.map((l) => {
      const t = l.round >= 0 && l.pos >= 0 ? (repaired[l.round]?.[l.pos] ?? l.tl) : l.tl;
      return l.sub >= 0 ? `${t}@${l.sub}` : t;
    }).join(',');
    const deltas = e.legs.map((l) => {
      if (l.round < 0 || l.pos < 0) return 'R';
      const Lq = c.L[l.round];
      const prev = last.get(l.round);
      last.set(l.round, l.pos);
      return prev === undefined ? '?' : `${l.round === r - 1 ? '' : `q${l.round}:`}${mod(l.pos - prev, Lq)}`;
    }).join(',');
    const parts = { base: e.base, tls, deltas };
    return { id: intern.id(`${parts.base}|${tls}|${deltas}`), parts };
  });
}

interface BlockResult { good: number; bad: { start: number; len: number }[]; word: number[]; wordStart: number }

/** Cover the cyclic token sequence with copies of its most frequent length-p word. */
function blocks(t: number[], p: number): BlockResult | null {
  const L = t.length;
  if (p < 1 || p > L) return null;
  const counts = new Map<string, { n: number; at: number }>();
  for (let s = 0; s < L; s++) {
    let k = '';
    for (let j = 0; j < p; j++) k += `${t[(s + j) % L]},`;
    const v = counts.get(k);
    if (v) v.n++; else counts.set(k, { n: 1, at: s });
  }
  let best: { n: number; at: number } | undefined;
  for (const v of counts.values()) if (!best || v.n > best.n) best = v;
  if (!best) return null;
  const word = Array.from({ length: p }, (_, j) => t[(best!.at + j) % L]);
  const isWord = (s: number) => { for (let j = 0; j < p; j++) if (t[(s + j) % L] !== word[j]) return false; return true; };
  const occ: boolean[] = Array.from({ length: L }, (_, s) => isWord(s));
  // start at an occurrence that follows a non-occurrence region if possible (so a bad block is
  // not split across the start)
  let start = best.at;
  for (let s = 0; s < L; s++) if (occ[s] && !occ[mod(s - p, L)]) { start = s; break; }
  let pos = 0, good = 0;
  const bad: { start: number; len: number }[] = [];
  while (pos < L) {
    const s = (start + pos) % L;
    if (occ[s] && pos + p <= L) { good++; pos += p; continue; }
    let k = 1;
    while (pos + k < L && !(occ[(start + pos + k) % L] && pos + k + p <= L)) k++;
    bad.push({ start: s, len: k });
    pos += k;
  }
  return { good, bad, word, wordStart: start };
}

function describeDiff(seg: Tok[], ref: Tok[], humanSeg: string[], humanRef: string[]): string {
  if (seg.length === ref.length) {
    for (let i = 0; i < seg.length; i++) {
      const a = seg[i].parts, b = ref[i].parts;
      if (a.base !== b.base) return `one repeat has ${humanSeg[i]} where the others have ${humanRef[i]}`;
    }
    for (let i = 0; i < seg.length; i++) {
      const a = seg[i].parts, b = ref[i].parts;
      if (a.tls !== b.tls) {
        const w = (s: string) => s.split(',').map((x) => x.replace(/@\d+$/, '').replace(/^sp(\d+)$/, 'ch-$1 sp')).join(' + ');
        return `one repeat works a ${humanSeg[i]} into ${w(a.tls)} where the others work into ${w(b.tls)}`;
      }
    }
    for (let i = 0; i < seg.length; i++) {
      const a = seg[i].parts, b = ref[i].parts;
      if (a.deltas !== b.deltas) {
        const sk = (d: string) => {
          const v = Number(d.split(',')[0]);
          return Number.isFinite(v) ? (v === 0 ? 'works into the same place' : v === 1 ? 'goes into the next place' : `skips ${v - 1}`) : 'is placed differently';
        };
        return `one repeat ${sk(a.deltas)} before its ${humanSeg[i]} where the others ${sk(b.deltas).replace(/^works/, 'work').replace(/^goes/, 'go').replace(/^skips/, 'skip').replace(/^is/, 'are')}`;
      }
    }
    return 'one repeat is worked differently';
  }
  const fmt = (h: string[]) => h.join(', ');
  return seg.length > ref.length
    ? `one repeat has ${seg.length - ref.length} extra item${seg.length - ref.length > 1 ? 's' : ''} (${fmt(humanSeg)} where the others have ${fmt(humanRef)})`
    : `one repeat is short by ${ref.length - seg.length} item${ref.length - seg.length > 1 ? 's' : ''} (${fmt(humanSeg)} where the others have ${fmt(humanRef)})`;
}

// ---------------------------------------------------------------- main

export function analyzeSymmetry(graph: Graph): SymmetryReport {
  const S = buildSequences(graph);
  if (!S.applicable) {
    return {
      order: 1, mirror: false, group: 'C1', rounds: [], defects: [], applicable: false,
      summary: ['Worked in rows — rotational symmetry applies to pieces worked in the round.'],
    };
  }
  const intern = new Interner();
  const c: Ctx = {
    seqs: S.rounds,
    L: S.rounds.map((r) => r.elems.length),
    lab: S.rounds.map((r) => r.elems.map((e) => intern.id(fullLabel(e)))),
    mir: S.rounds.map((r) => r.elems.map((e) => intern.id(mirrorLabel(e)))),
  };
  const nR = S.rounds.length;
  const cum: number[] = new Array(nR).fill(0);
  const own: number[] = new Array(nR).fill(1);
  const ownMirror: boolean[] = new Array(nR).fill(false);
  // mirror centres of the piece so far, as residues modulo L_r / cum_r (null: round has no elements)
  const S_m: (Set<number> | null)[] = new Array(nR).fill(null);
  const cumMirror: boolean[] = new Array(nR).fill(false);
  let cumPrev = 0; // 0 = unconstrained
  let mirrorAlive = true;

  for (let r = 0; r < nR; r++) {
    const L = c.L[r];
    if (!L) { cum[r] = cumPrev; cumMirror[r] = mirrorAlive; continue; }
    // own order
    for (const n of divisorsDesc(L)) if (rotOK(c, r, L / n, () => null)) { own[r] = n; break; }
    // cumulative order
    const bound = cumPrev === 0 ? L : gcd(L, cumPrev);
    const dir = S.rounds[r].dir;
    let cr = 1;
    for (const n of divisorsDesc(bound)) {
      const ok = rotOK(c, r, L / n, (q) => {
        const Lq = c.L[q];
        if (Lq % n !== 0) return NaN; // impossible → mismatch
        return mod(dir * S.rounds[q].dir * (Lq / n), Lq);
      });
      if (ok) { cr = n; break; }
    }
    cum[r] = cr;
    cumPrev = cr;
    // own mirror (anchors mirrored about any centre)
    ownMirror[r] = mirrorCentres(c, r, L / own[r], () => true, 1).length > 0;
    // cumulative mirror
    if (mirrorAlive) {
      const centres = mirrorCentres(c, r, L / cr, (q, cq) => {
        const Sq = S_m[q];
        if (!Sq) return true;
        const pq = c.L[q] / cum[q];
        return Sq.has(mod(cq, pq));
      });
      if (centres.length) S_m[r] = new Set(centres); else mirrorAlive = false;
    }
    cumMirror[r] = mirrorAlive;
  }

  // ---- defects
  const repaired: string[][] = S.rounds.map((r) => r.elems.map((e) => e.base));
  const defects: SymmetryDefect[] = [];
  const near: (number | undefined)[] = new Array(nR).fill(undefined);
  const dIntern = new Interner();
  let cumBefore = 0;
  for (let r = 0; r < nR; r++) {
    const L = c.L[r];
    if (!L) continue;
    const toks = defectTokens(c, r, repaired, dIntern);
    const t = toks.map((x) => x.id);
    // the order this round "should" have: what the piece had below it, else the next round's own order
    const cands: number[] = [];
    if (cumBefore > 1) cands.push(cumBefore);
    if (r + 1 < nR && own[r + 1] > 1) cands.push(gcd(own[r + 1], cumBefore || own[r + 1]));
    let ownT = 1;
    for (const n of divisorsDesc(L)) {
      let ok = true;
      const p = L / n;
      for (let i = 0; i < L && ok; i++) if (t[i] !== t[(i + p) % L]) ok = false;
      if (ok) { ownT = n; break; }
    }
    const tried = new Set<number>();
    let found: SymmetryDefect | undefined;
    for (const top of cands) {
      for (const n of divisorsDesc(top)) {
        if (found || n <= Math.max(ownT, 1) || n < 2 || tried.has(n) || ownT % n === 0) continue;
        tried.add(n);
        const p = Math.round(L / n);
        if (p < 1 || Math.abs(L - n * p) > Math.max(2, Math.floor(p / 2))) continue;
        const b = blocks(t, p);
        if (!b) continue;
        const maxBad = Math.max(1, Math.floor(n / 6));
        const badLen = b.bad.reduce((a, x) => a + x.len, 0);
        if (b.bad.length === 0 || b.bad.length > maxBad || b.good < n - maxBad || badLen > b.bad.length * (p + 3)) continue;
        const el = S.rounds[r].elems;
        const nodes: number[] = [];
        let msgs: string[] = [];
        let stA = Infinity, stB = -Infinity;
        // stitch numbers within the round
        const stitchNo = new Map<number, number>();
        let k = 0;
        for (const e of el) if (e.stitch) stitchNo.set(el.indexOf(e), ++k);
        for (const seg of b.bad) {
          const idx = Array.from({ length: seg.len }, (_, j) => (seg.start + j) % L);
          idx.forEach((i) => nodes.push(...el[i].nodes));
          const numbers = idx.map((i) => stitchNo.get(i)).filter((x): x is number => x !== undefined);
          if (!numbers.length) {
            // a space only: name the stitches either side
            for (let j = 1; j < L; j++) { const v = stitchNo.get(mod(seg.start - j, L)); if (v) { numbers.push(v); break; } }
            for (let j = 0; j < L; j++) { const v = stitchNo.get((seg.start + seg.len + j) % L); if (v) { numbers.push(v); break; } }
          }
          if (numbers.length) { stA = Math.min(stA, ...numbers); stB = Math.max(stB, ...numbers); }
          // reference: the word aligned at the segment start
          // reference word tokens taken from a good copy
          const goodStart = b.wordStart;
          const refToks = Array.from({ length: p }, (_, j) => toks[(goodStart + j) % L]);
          const refHuman = Array.from({ length: p }, (_, j) => el[(goodStart + j) % L].human);
          // align the bad segment to the word when it is a substitution of a whole copy
          let segToks = idx.map((i) => toks[i]);
          let segHuman = idx.map((i) => el[i].human);
          let refT = refToks, refH = refHuman;
          if (seg.len === p) {
            const o = mod(seg.start - goodStart, p);
            refT = Array.from({ length: p }, (_, j) => refToks[(o + j) % p]);
            refH = Array.from({ length: p }, (_, j) => refHuman[(o + j) % p]);
            // repair labels for the next round's view
            idx.forEach((i, j) => { if (refT[j].parts.base !== toks[i].parts.base) repaired[r][i] = refT[j].parts.base; });
          } else if (seg.len < p && seg.len > 0) {
            segToks = idx.map((i) => toks[i]); segHuman = idx.map((i) => el[i].human);
          }
          msgs.push(describeDiff(segToks, refT, segHuman, refH));
        }
        msgs = [...new Set(msgs)];
        const where = Number.isFinite(stA) ? (stA === stB ? ` near stitch ${stA}` : ` near stitches ${stA}–${stB}`) : '';
        const label = S.rounds[r].label;
        found = {
          round: S.rounds[r].round, nodes: [...new Set(nodes)].sort((a, b2) => a - b2), order: n,
          message: `${label} is ${n}-fold except${where}: ${msgs.join('; ')}.`,
        };
        if (Number.isFinite(stA)) found.stitches = [stA, stB];
      }
      if (found) break;
    }
    if (found) { defects.push(found); near[r] = found.order; }
    cumBefore = found ? (cumBefore ? gcd(cumBefore, found.order!) : found.order!) : (cumBefore ? gcd(cumBefore, ownT) : ownT);
    if (cum[r] > cumBefore) cumBefore = cum[r];
  }

  // ---- assemble
  const rounds: RoundSymmetry[] = S.rounds.map((rs, r) => {
    const R = graph.rounds[rs.round];
    const out: RoundSymmetry = {
      round: rs.round, label: rs.label, order: own[r], mirror: ownMirror[r],
      period: own[r] ? Math.round((R?.stitchCount ?? 0) / own[r]) : 0,
      defects: defects.filter((d) => d.round === rs.round),
      cumulative: cum[r] || 1, cumulativeMirror: cumMirror[r], elements: c.L[r],
    };
    if (near[r] && near[r]! > own[r]) out.nearOrder = near[r];
    return out;
  });
  let lastR = -1;
  for (let r = nR - 1; r >= 0; r--) if (c.L[r]) { lastR = r; break; }
  const order = lastR >= 0 ? cum[lastR] || 1 : 1;
  const mirror = lastR >= 0 ? cumMirror[lastR] : false;
  const group = `${mirror ? 'D' : 'C'}${order}`;

  let frame: SymmetryFrame | undefined;
  if (lastR >= 0) {
    const L = c.L[lastR], p = L / order;
    const ms = S_m[lastR];
    const centre = mirror && ms && ms.size ? Math.min(...ms) : -1;
    const s0 = centre >= 0 ? centre / 2 : -0.5;
    frame = {
      round: S.rounds[lastR].round,
      elementNodes: S.rounds[lastR].elems.map((e) => e.rep),
      sectors: Array.from({ length: order }, (_, k) => mod(s0 + k * p, L)),
      axes: centre >= 0 ? Array.from({ length: 2 * order }, (_, k) => mod((centre + k * p) / 2, L)) : [],
    };
  }

  return { order, mirror, group, rounds, defects, summary: summarize(rounds, order, mirror, group, defects), applicable: true, frame };
}

function rangeLabel(rs: RoundSymmetry[], a: number, b: number): string {
  const la = rs[a].label, lb = rs[b].label;
  if (a === b) return la;
  const na = /(\d+)/.exec(la)?.[1], nb = /(\d+)/.exec(lb)?.[1];
  if (na && nb && /^Rnd/.test(la) && /^Rnd/.test(lb)) return `Rnds ${na}–${nb}`;
  return `${la} – ${lb}`;
}

function summarize(rounds: RoundSymmetry[], order: number, mirror: boolean, group: string, defects: SymmetryDefect[]): string[] {
  const out: string[] = [];
  const rs = rounds.filter((r) => (r.elements ?? 0) > 0);
  if (!rs.length) return ['No rounds to analyse.'];
  out.push(order > 1
    ? `Whole piece: ${order}-fold${mirror ? ' with mirror symmetry' : ''} (${group}).`
    : mirror ? `Whole piece: no rotational repeat, but mirror-symmetric (${group}).` : `Whole piece: no rotational symmetry (${group}).`);
  const cums = rs.map((r) => r.cumulative ?? 1);
  if (cums.every((x) => x === cums[0])) {
    if (rs.length > 1) out.push(`Every round keeps it ${cums[0]}-fold.`);
  } else {
    let i = 0;
    while (i + 1 < rs.length && cums[i + 1] === cums[0]) i++;
    const parts = [`${rangeLabel(rs, 0, i)} ${i === 0 ? 'is' : 'are'} ${cums[0]}-fold`];
    for (let j = i + 1; j < rs.length; j++) {
      if (cums[j] !== cums[j - 1]) parts.push(`${rs[j].label} reduces it to ${cums[j]}`);
    }
    out.push(`${parts.join('; ')}.`);
  }
  const extra = rs.filter((r) => r.order > (r.cumulative ?? 1) && r.order > 1);
  for (const r of extra.slice(0, 2)) {
    out.push(`${r.label} repeats ${r.order} times, but it sits on the rounds below so that the piece stays ${r.cumulative}-fold.`);
  }
  if (extra.length > 2) out.push(`(${extra.length - 2} more round${extra.length - 2 > 1 ? 's' : ''} repeat more often than the piece as a whole.)`);
  for (const d of defects) out.push(d.message);
  return out;
}
