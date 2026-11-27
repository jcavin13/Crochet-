/**
 * Compiler: AST → stitch graph (notation.md section 3).
 *
 * Model (read this before changing anything):
 *
 *  - Nodes are appended in working order. `pushNode` is the only way to add one.
 *  - Consecutive `ch` nodes form a *chain run*. A run is classified when it closes (a non-ch node
 *    is appended, or the round ends):
 *      ring      — closed by "join to form ring" → ring space whose chains are the run (3.4);
 *      tch       — the run started before any stitch other than sl st in this round → every chain
 *                  gets role "tch", no space;
 *      plain     — foundation round chains, or chains addressed one by one ("2nd ch from hook");
 *                  for a turning-chain run addressed from the hook, the skipped chains at the hook
 *                  end are the turning chain;
 *      chsp      — anything else → a chain space.
 *    A counts-as chain (`ch 3 (counts as dc)`) closes its turning part immediately; any extra
 *    chains (`ch 5 (counts as dc, ch 2)`) start a new run.
 *  - Each round sees the previous round's target list (targets.ts), reversed if this round is
 *    turned, and a cursor that starts before the first entry. `take(unit)` moves the cursor
 *    forward to the next entry matching the unit (passing over others) and consumes it.
 *    `lastUsed` is the anchor most recently used (for `same st` and counts-as bases).
 *  - Individual chains (`ch` unit) are addressed through a separate chain cursor, set by
 *    `Nth ch from hook` (runs away from the hook) or by entering the next chain space.
 *  - Target errors (no stitch left, wrong space…) abort the rest of the round; the next round is
 *    then "suppressed": its target/count diagnostics are dropped because they would be cascades.
 */
import type {
  ChainItem, CountAnn, Extent, GroupItem, Item, JoinItem, PatternAst, Place, RepeatItem,
  RoundAst, SkipItem, Span, StitchItem, StitchSpec, Target, Unit,
} from '../notation/ast';
import { KNOWN_HEADERS } from '../notation/parser';
import { nameOf, skipWord } from '../notation/vocab';
import {
  anchorId, buildTargets, cornerTargets, entryAnchor, entryMatches, nodeCounts, perimeterTargets, unitNoun, type Entry,
} from './targets';
import type {
  Anchor, Diagnostic, DiagnosticCode, GroupKind, LoopMod, Meta, Node, Pattern, Round, RoundKind,
  Severity, Space, StitchType,
} from './types';

export interface CompileOptions {
  /** Source text, stored as pattern.notation. */
  notation?: string;
}

export interface CompileResult {
  /** Present only when there are no errors. */
  pattern?: Pattern;
  diagnostics: Diagnostic[];
}

/** Codes whose diagnostics depend on the previous round's targets (suppressed after a broken round). */
const TARGET_FAMILY = new Set<DiagnosticCode>([
  'E_NO_TARGET', 'E_NO_SPACE', 'E_SPACE_LENGTH', 'E_NO_CHAIN', 'E_REPEAT_UNEVEN', 'E_COUNT_MISMATCH', 'W_UNWORKED', 'I_UNWORKED_TCH',
]);

/**
 * Sanity cap on the size of a compiled pattern (R15). The largest crochet object on record — the
 * Lorenz manifold — has about 25 500 stitches; anything beyond this is almost certainly a typo
 * ("ch 200000") and would freeze the chart and the 3D view.
 */
export const MAX_NODES = 50000;

class TargetError extends Error {
  constructor(public code: DiagnosticCode, public msg: string, public span: Span) {
    super(msg);
  }
}

interface ChainRun {
  nodes: number[];
  round: number;
  tchCandidate: boolean;
  closed: boolean;
  /** "Nth ch from hook" addressed this run: N-1 chains at the hook end are skipped. */
  hookSkip?: number;
  /** some chain of this run was used as an anchor */
  addressed: boolean;
  fate?: 'tch' | 'plain' | 'chsp' | 'ring';
}

interface RoundState {
  index: number;
  label: string;
  kind: RoundKind;
  ast: RoundAst;
  prevLabel?: string;
  targets: Entry[];
  cursor: number;
  /** target-list indices this round consumed or skipped, in order (for the closing-arc rule) */
  used: number[];
  /** chain lengths of the previous round's spaces this round worked into */
  workedSpaceLens: Set<number>;
  lastUsed?: Anchor;
  /** id of the first node of this round */
  start: number;
  firstStitch?: number;
  /** a node other than ch / sl st has been made in this round */
  madeStitch: boolean;
  ringThisRound?: number;
  openRun?: ChainRun;
  /** `part: 'base'`: walking the unused loops (other side) of a chain */
  chainCursor?: { chains: number[]; pos: number; part?: 'base' };
  /** chains addressed one by one in this round, in order (for "working along the other side") */
  chainsWorked: number[];
  turned: boolean;
  /** worked around rows: the target list is the perimeter (notation.md 3.9) */
  perimeter: boolean;
  /** the target list has corners (a border round) */
  hasCorners: boolean;
  /** the target list has foundation-chain (base) entries */
  hasBase: boolean;
  /** border rounds: entries (not spaces) passed over without being worked or skipped */
  passedOver: Entry[];
  /** drop target-family diagnostics (cascade guard) */
  suppress: boolean;
  /** an error (reported or suppressed) happened in this round */
  unreliable: boolean;
  fastenReported: boolean;
}

interface Slot {
  anchor: Anchor;
}

const canonLabel = (kind: RoundKind, n: number) => (kind === 'foundation' ? 'Foundation' : `${kind === 'row' ? 'Row' : 'Rnd'} ${n}`);

class Compiler {
  nodes: Node[] = [];
  spaces: Space[] = [];
  rounds: Round[] = [];
  diags: Diagnostic[] = [];
  groupSeq = 0;
  lastRing?: number;
  lastChainRun?: ChainRun;
  fastened = false;
  fastenSpan?: Span;
  fastenRoundReported = false;
  turnNext = false;
  prevUnreliable = false;
  tooBig = false;
  /** round index → anchors of the corners of the list that round was worked into */
  cornerInput = new Map<number, Anchor[]>();
  cur!: RoundState;

  constructor(private ast: PatternAst) {}

  // ----- diagnostics ---------------------------------------------------------------------------

  diag(severity: Severity, code: DiagnosticCode, message: string, span: Span, round?: number): void {
    const c = this.cur;
    if (c && round === c.index) {
      if (severity === 'error') c.unreliable = true;
      if (c.suppress && TARGET_FAMILY.has(code)) return;
    }
    const d: Diagnostic = { severity, code, message, ...span };
    if (round !== undefined) d.round = round;
    this.diags.push(d);
  }
  err(code: DiagnosticCode, message: string, span: Span): void {
    this.diag('error', code, `${this.cur.label}: ${message}`, span, this.cur.index);
  }
  name(t: StitchType | string): string {
    return nameOf(t as StitchType, this.ast.terms);
  }

  // ----- top level -----------------------------------------------------------------------------

  run(opts: CompileOptions): CompileResult {
    this.checkNumbering();
    for (const block of this.blocks()) {
      for (const { r, n } of block) {
        if (this.tooBig) break;
        this.compileRound(r, n);
      }
    }
    const diagnostics = this.diags;
    if (diagnostics.some((d) => d.severity === 'error')) return { diagnostics };
    const graph = { nodes: this.nodes.map(canonicalNode), spaces: this.spaces, rounds: this.rounds };
    const pattern: Pattern = opts.notation !== undefined
      ? { format: 'crochet-pattern', version: '0.1', meta: this.meta(), notation: opts.notation, graph }
      : { format: 'crochet-pattern', version: '0.1', meta: this.meta(), graph };
    return { pattern, diagnostics };
  }

  meta(): Meta {
    const m: Meta = { title: 'Untitled', terms: this.ast.terms };
    const extra: Record<string, string> = {};
    for (const h of this.ast.headers) {
      if (h.key === 'terms') continue;
      if (KNOWN_HEADERS.has(h.key)) (m as unknown as Record<string, string>)[h.key] = h.value;
      else extra[h.key] = h.value;
    }
    const out: Meta = { title: m.title, terms: m.terms };
    for (const k of ['yarn', 'hook', 'params', 'source', 'license', 'author', 'year', 'notes'] as const) {
      if (m[k] !== undefined) out[k] = m[k];
    }
    if (Object.keys(extra).length) out.extra = extra;
    return out;
  }

  /**
   * The rounds in working order: one block per label, except that consecutive parity labels
   * ("Rows 2-120 (even):", "Rows 3-121 (odd):") form one block whose rows are interleaved by number.
   */
  blocks(): { r: RoundAst; n: number }[][] {
    const out: { r: RoundAst; n: number }[][] = [];
    const rs = this.ast.rounds;
    for (let i = 0; i < rs.length; i++) {
      const L = rs[i].label;
      if (!L.parity) {
        const b: { r: RoundAst; n: number }[] = [];
        for (let n = L.from; n <= Math.max(L.from, L.to); n++) b.push({ r: rs[i], n });
        out.push(b);
        continue;
      }
      const b: { r: RoundAst; n: number }[] = [];
      let j = i;
      for (; j < rs.length && rs[j].label.parity && rs[j].label.kind === L.kind; j++) {
        for (let n = rs[j].label.from; n <= Math.max(rs[j].label.from, rs[j].label.to); n += 2) b.push({ r: rs[j], n });
      }
      b.sort((x, y) => x.n - y.n);
      out.push(b);
      i = j - 1;
    }
    return out;
  }

  /** E_ROUND_NUMBER: numbers increase by one; Foundation only first; a Row↔Rnd switch may restart at 1. */
  checkNumbering(): void {
    let prev: { kind: RoundKind; to: number } | undefined;
    const rs = this.ast.rounds;
    for (let i = 0; i < rs.length; i++) {
      const L0 = rs[i].label;
      if (!L0.parity) continue;
      // a block of parity labels: each label's ends have its parity; together they cover a run
      let j = i;
      const nums: number[] = [];
      for (; j < rs.length && rs[j].label.parity && rs[j].label.kind === L0.kind; j++) {
        const L = rs[j].label;
        const want = L.parity === 'even' ? 0 : 1;
        if (L.from % 2 !== want || L.to % 2 !== want) {
          this.diags.push({ severity: 'error', code: 'E_ROUND_NUMBER', ...L.span,
            message: `"${L.word} ${L.from}-${L.to} (${L.parity})" — both ends of an ${L.parity} range must be ${L.parity} numbers.` });
        }
        for (let n = L.from; n <= L.to; n += 2) nums.push(n);
      }
      nums.sort((a, b) => a - b);
      const gap = nums.findIndex((n, k) => k > 0 && n !== nums[k - 1] + 1);
      if (gap > 0) {
        const L = rs[i].label;
        this.diags.push({ severity: 'error', code: 'E_ROUND_NUMBER', ...L.span,
          message: `the odd and even ranges starting here must together cover every ${L.kind === 'row' ? 'row' : 'round'} from ${nums[0]} to ${nums[nums.length - 1]} once, but ${nums[gap - 1] === nums[gap] ? `${nums[gap]} appears twice` : `${nums[gap - 1] + 1} is missing`}.` });
      }
      i = j - 1;
    }
    this.ast.rounds.forEach((r, i) => {
      const L = r.label;
      const add = (msg: string) =>
        this.diags.push({ severity: 'error', code: 'E_ROUND_NUMBER', message: msg, ...L.span });
      if (L.parity) {
        // inside a parity block: only the block's first label is checked against the round before
        const first = i === 0 || !rs[i - 1].label.parity || rs[i - 1].label.kind !== L.kind;
        if (!first) return;
        let lo = L.from, hi = L.to;
        for (let j = i; j < rs.length && rs[j].label.parity && rs[j].label.kind === L.kind; j++) {
          lo = Math.min(lo, rs[j].label.from);
          hi = Math.max(hi, rs[j].label.to);
        }
        const expected = !prev || prev.kind === 'foundation' ? 1 : prev.to + 1;
        const restartOk = prev && prev.kind !== 'foundation' && prev.kind !== L.kind && lo === 1;
        if (lo !== expected && !restartOk) add(`expected ${canonLabel(L.kind, expected)} here but the odd/even ranges start at ${lo} — round numbers must increase by one.`);
        prev = { kind: L.kind, to: hi };
        return;
      }
      if (L.kind === 'foundation') {
        if (i !== 0) add(`"${L.word}" (round 0) may only be the first round, but it comes after ${prev ? canonLabel(prev.kind, prev.to) : 'another round'}.`);
        prev = { kind: 'foundation', to: 0 };
        return;
      }
      if (L.to < L.from) add(`range "${L.word} ${L.from}-${L.to}" runs backwards — expected the second number to be larger.`);
      const expected = !prev || prev.kind === 'foundation' ? 1 : prev.to + 1;
      const restartOk = prev && prev.kind !== 'foundation' && prev.kind !== L.kind && L.from === 1;
      if (L.from !== expected && !restartOk) {
        const what = L.from === (prev?.to ?? -1) ? 'a duplicate' : L.from < expected ? 'out of order' : 'a gap';
        add(`expected ${canonLabel(L.kind, expected)} here but found ${L.word} ${L.from} (${what}) — round numbers must increase by one.`);
      }
      prev = { kind: L.kind, to: Math.max(L.from, L.to) };
    });
  }

  // ----- rounds --------------------------------------------------------------------------------

  compileRound(ast: RoundAst, n: number): void {
    const index = this.rounds.length;
    const kind = ast.label.kind;
    const label = canonLabel(kind, n);
    const prev = this.rounds[index - 1];
    const autoTurn = !!prev && prev.kind === 'row' && kind === 'row';
    // a round after rows goes round the piece, starting across the top of the last row (3.9)
    const perimeter = !!prev && prev.kind === 'row' && kind === 'round';
    let turned = autoTurn || perimeter || this.turnNext;
    this.turnNext = false;
    // an explicit "turn" as the first item of a Rnd turns this round (in a Row it is redundant)
    if (ast.items[0]?.kind === 'turn' && kind !== 'row') turned = true;

    let targets: Entry[];
    if (!prev) targets = [];
    else if (perimeter) targets = perimeterTargets(this.nodes, this.spaces, this.rounds, index - 1);
    else {
      const corners = this.cornerInput.get(index - 1);
      targets = corners
        ? cornerTargets(this.nodes, this.spaces, index - 1, prev, corners)
        : buildTargets(this.nodes, this.spaces, index - 1, prev.first, prev.last);
      if (turned) targets = targets.slice().reverse();
    }
    const hasCorners = targets.some((e) => e.corner);
    if (hasCorners) this.cornerInput.set(index, targets.filter((e) => e.corner).map(entryAnchor));

    this.cur = {
      index, label, kind, ast, prevLabel: prev?.label, targets, cursor: 0, used: [], workedSpaceLens: new Set(), start: this.nodes.length,
      madeStitch: false, turned, suppress: !!ast.broken || this.prevUnreliable,
      unreliable: !!ast.broken, fastenReported: false, chainsWorked: [],
      perimeter, hasCorners, hasBase: targets.some((e) => e.kind === 'base'), passedOver: [],
    };
    const R: Round = {
      index, label, kind, joined: false, turned, first: -1, last: -1, stitchCount: 0,
    };
    this.rounds.push(R);

    if (this.fastened) {
      this.cur.fastenReported = true;
      this.cur.unreliable = true;
      if (!this.fastenRoundReported) this.diag('error', 'E_AFTER_FASTEN_OFF',
        `${label}: the pattern was fastened off earlier, so nothing may follow — found another round.`, ast.label.span, index);
      this.fastenRoundReported = true;
    } else if (ast.items.length === 0 && !ast.broken) {
      this.diag('error', 'E_SYNTAX',
        `${label}: the round has no instructions — expected stitches after "${ast.label.word} ${ast.label.from}:".`, ast.label.span, index);
      this.cur.suppress = true;
    } else {
      try {
        this.compileItems(ast.items, undefined, true);
      } catch (e) {
        if (!(e instanceof TargetError)) throw e;
        this.err(e.code, e.msg, e.span);
        this.cur.suppress = true; // the count / unworked checks of this round would be cascades
      }
    }
    this.closeRun();

    // finalize the round record
    const first = this.cur.start;
    const last = this.nodes.length - 1;
    if (last >= first) {
      R.first = first;
      R.last = last;
    }
    let count = 0;
    for (let id = first; id <= last; id++) if (nodeCounts(this.nodes[id])) count++;
    R.stitchCount = count;
    const lastNode = last >= first ? this.nodes[last] : undefined;
    if (lastNode && lastNode.type === 'slst' && lastNode.into.length === 1) {
      const a = lastNode.into[0];
      if ('node' in a && a.node >= first && nodeCounts(this.nodes[a.node])) R.joined = true;
    }
    // after "fasten off" the round was never worked: a count check would only be a cascade
    if (ast.count && !this.cur.fastenReported) this.checkCount(ast.count, R);
    this.checkUnworked();
    R.src = { line: ast.span.line, endLine: ast.span.endLine };
    this.prevUnreliable = this.cur.unreliable;
  }

  /**
   * W_UNWORKED (3.3, 4a): targets after the cursor were never consumed or passed over. Stitch
   * targets always count; a space target counts when this round worked into spaces of the same
   * chain length (so a round that skips most of the previous round's ch-3 loops is caught, while
   * ch-1 spaces a round of "sc in next st" passes over everywhere stay silent at the end too).
   *
   * A chain arc as the last thing before the join (or the end) may span the trailing targets, but
   * only as many as one arc plausibly covers: the stretch from the last target used, round the end
   * of the list, to the first target used must be no longer than the widest step between two
   * consecutive targets used inside this round (at least 3, i.e. two unworked entries under the
   * arc — the old leniency for the usual "…ch 4, join" finish).
   */
  checkUnworked(): void {
    const c = this.cur;
    if (c.suppress || c.unreliable) return;
    if (c.passedOver.length) {
      this.diag('warning', 'W_UNWORKED',
        `${c.label}: ${this.entriesText(c.passedOver)} of ${c.prevLabel} ${c.passedOver.length === 1 ? 'is' : 'are'} passed over without being worked${this.sidesText(c.passedOver)} — expected each to be worked into or skipped with "${skipWord(this.ast.terms)}".`,
        c.ast.label.span, c.index);
    }
    const rest = c.targets.slice(c.cursor).filter((e) =>
      e.kind !== 'space' || c.workedSpaceLens.has(this.spaces[e.space].chains.length));
    if (rest.length === 0) return;
    if (c.hasCorners) {
      this.diag('warning', 'W_UNWORKED',
        `${c.label}: ${this.entriesText(rest)} of ${c.prevLabel} ${rest.length === 1 ? 'is' : 'are'} left unworked at the end of the round${this.sidesText(rest)} — expected every stitch${rest.some((e) => e.kind === 'rowEnd') ? ', row end' : ''} and space to be worked into or skipped with "${skipWord(this.ast.terms)}".`,
        c.ast.label.span, c.index);
      return;
    }
    let k = this.nodes.length - 1;
    while (k >= c.start && this.nodes[k].type === 'slst') k--;
    const endsWithArc = k >= c.start && this.nodes[k].type === 'ch' && this.nodes[k].role !== 'tch';
    if (endsWithArc && this.arcCoversTrailing()) return;
    const span = c.ast.label.span;
    if (c.kind === 'row' && rest.every((e) => e.kind === 'stitch' && this.nodes[e.node].countsAs !== undefined)) {
      this.diag('info', 'I_UNWORKED_TCH',
        `${c.label}: the turning chain at the end of ${c.prevLabel} is not worked into (normal in rows, but check the stitch count).`,
        span, c.index);
      return;
    }
    const nSt = rest.filter((e) => e.kind === 'stitch').length;
    const nSp = rest.length - nSt;
    const parts: string[] = [];
    if (nSt) parts.push(`${nSt} stitch${nSt === 1 ? '' : 'es'}`);
    if (nSp) parts.push(`${nSp} chain space${nSp === 1 ? '' : 's'}`);
    const what = parts.join(' and ');
    const verb = rest.length === 1 ? 'is' : 'are';
    const arcNote = endsWithArc ? ' — more than the closing chain arc can span' : '';
    const expectWord = nSp ? 'every stitch and space' : 'every stitch';
    this.diag('warning', 'W_UNWORKED',
      `${c.label}: ${what} of ${c.prevLabel} ${verb} left unworked at the end of the round${arcNote} — expected ${expectWord} to be worked into or skipped with "${skipWord(this.ast.terms)}".`,
      span, c.index);
  }

  /** "2 stitches and 3 row ends" */
  entriesText(es: Entry[]): string {
    const n = (k: Entry['kind']) => es.filter((e) => e.kind === k).length;
    const parts: string[] = [];
    const add = (k: number, one: string, many: string) => { if (k) parts.push(`${k} ${k === 1 ? one : many}`); };
    add(n('stitch'), 'stitch', 'stitches');
    add(n('rowEnd'), 'row end', 'row ends');
    add(n('base'), 'foundation chain', 'foundation chains');
    add(n('space'), 'chain space', 'chain spaces');
    return parts.join(' and ');
  }

  /** " on the top edge and the bottom" for perimeter entries; "" otherwise. */
  sidesText(es: Entry[]): string {
    if (!this.cur.perimeter) return '';
    const names = [...new Set(es.map((e) => this.sideName(e)))];
    return names.length ? ` (on ${names.join(' and ')})` : '';
  }

  sideName(e: Entry | undefined): string {
    const c = this.cur;
    if (!e || !c.perimeter) return 'this side';
    switch (e.side) {
      case 0: return `the top edge (${c.prevLabel})`;
      case 1: return 'the first side (row ends)';
      case 2: return 'the bottom (foundation chain)';
      case 3: return 'the second side (row ends)';
      default: return 'this side';
    }
  }

  /** Closing-arc rule (see checkUnworked). */
  arcCoversTrailing(): boolean {
    const c = this.cur;
    const n = c.targets.length;
    const used = c.used;
    if (used.length === 0) return n <= 2;
    let maxGap = 0;
    for (let i = 1; i < used.length; i++) maxGap = Math.max(maxGap, used[i] - used[i - 1]);
    const wrapGap = n - used[used.length - 1] + used[0];
    return wrapGap <= Math.max(maxGap, 3);
  }

  // ----- count annotations (3.8) ---------------------------------------------------------------

  checkCount(count: CountAnn, R: Round): void {
    const c = this.cur;
    const nodes = R.first >= 0 ? this.nodes.slice(R.first, R.last + 1) : [];
    const spacesHere = this.spaces.filter((s) => s.round === c.index && s.kind === 'chsp');
    let declared: number | undefined;
    let typedSum = 0;
    let typedOnly = true;
    let anyTyped = false;
    for (const p of count.parts) {
      let actual: number | undefined;
      let noun = p.text;
      const u = p.unit;
      switch (u.kind) {
        case 'st':
          actual = R.stitchCount;
          declared = p.n;
          noun = p.n === 1 ? 'stitch' : 'stitches';
          break;
        case 'type':
          if (u.type === 'ch' || u.type === 'slst') break;
          if (u.type === 'picot') actual = nodes.filter((x) => x.type === 'picot').length;
          else if (u.type === 'puff' || u.type === 'popcorn') actual = nodes.filter((x) => x.type === u.type).length;
          else actual = nodes.filter((x) => nodeCounts(x) && (x.countsAs === u.type || (x.type === u.type && x.tag !== 'cluster'))).length;
          if (u.type !== 'picot') { typedSum += p.n; anyTyped = true; }
          break;
        case 'cl':
          actual = nodes.filter((x) => x.tag === 'cluster').length;
          typedSum += p.n;
          anyTyped = true;
          break;
        case 'spaces':
          actual = spacesHere.filter((s) => u.chains === undefined || s.chains.length === u.chains).length;
          break;
        case 'group': {
          const ids = new Set(nodes.filter((x) => x.group?.kind === u.group).map((x) => x.group!.id));
          actual = ids.size;
          typedOnly = false;
          break;
        }
        case 'unknown':
          break;
      }
      if (actual === undefined) {
        typedOnly = false;
        this.diag('info', 'I_COUNT_UNVERIFIED',
          `${c.label}: cannot check "${p.n} ${p.text}" — the compiler does not count that unit.`, p.span, c.index);
        continue;
      }
      if (actual !== p.n) {
        const said = u.kind === 'st' && p.text === '' ? (count.parts.length === 1 ? `(${p.n})` : `${p.n} stitches`) : `${p.n} ${p.text}`;
        const made = u.kind === 'st' ? `${actual} ${actual === 1 ? 'stitch' : 'stitches'}` : `${actual} ${p.text || noun}`;
        this.diag('error', 'E_COUNT_MISMATCH',
          `${c.label}: count mismatch — pattern says ${said} but the round makes ${made}.`,
          count.parts.length === 1 ? count.span : p.span, c.index);
      }
    }
    if (declared === undefined && anyTyped && typedOnly && typedSum === R.stitchCount) declared = typedSum;
    if (declared !== undefined) R.declaredCount = declared;
  }

  // ----- nodes and chain runs ------------------------------------------------------------------

  pushNode(n: Omit<Node, 'id' | 'round'>, src: Span): Node {
    const c = this.cur;
    if (this.nodes.length >= MAX_NODES) {
      this.tooBig = true;
      throw new TargetError('E_SYNTAX',
        `the pattern grows past ${MAX_NODES.toLocaleString('en')} stitches here — check for a mistyped count (e.g. "ch 200000"); the app cannot chart or simulate a piece that large.`, src);
    }
    if (n.type !== 'ch') this.closeRun();
    const node = { id: this.nodes.length, round: c.index, ...n, src: toSrc(src) } as Node;
    this.nodes.push(node);
    if (n.type === 'ch') {
      if (!c.openRun) {
        c.openRun = {
          nodes: [], round: c.index, closed: false, addressed: false,
          tchCandidate: !c.madeStitch && c.kind !== 'foundation',
        };
        this.lastChainRun = c.openRun;
      }
      c.openRun.nodes.push(node.id);
    } else if (n.type !== 'slst') {
      c.madeStitch = true;
    }
    if (nodeCounts(node)) {
      c.madeStitch = true;
      if (c.firstStitch === undefined) c.firstStitch = node.id;
    }
    return node;
  }

  /** Classify and close the open chain run (see file comment). */
  closeRun(asRing = false): ChainRun | undefined {
    const c = this.cur;
    const run = c.openRun;
    if (!run) return undefined;
    c.openRun = undefined;
    run.closed = true;
    if (asRing) {
      run.fate = 'ring';
    } else if (run.addressed) {
      run.fate = 'plain';
      if (run.tchCandidate && run.hookSkip) {
        for (const id of run.nodes.slice(run.nodes.length - run.hookSkip)) this.nodes[id].role = 'tch';
      }
    } else if (run.tchCandidate) {
      run.fate = 'tch';
      for (const id of run.nodes) this.nodes[id].role = 'tch';
    } else if (c.kind === 'foundation') {
      run.fate = 'plain';
    } else {
      run.fate = 'chsp';
      this.spaces.push({ id: this.spaces.length, kind: 'chsp', round: c.index, chains: run.nodes.slice() });
    }
    return run;
  }

  newGroup(): number {
    return this.groupSeq++;
  }

  // ----- items ---------------------------------------------------------------------------------

  /**
   * Compile a sequence. `slot` is the place of an enclosing group (stitches without their own
   * target go there).
   */
  compileItems(items: Item[], slot: Slot | undefined, top = false): void {
    for (const it of items) {
      if (this.fastened) {
        if (!this.cur.fastenReported) {
          this.cur.fastenReported = true;
          this.err('E_AFTER_FASTEN_OFF', `nothing may follow "fasten off" — found more instructions here.`, it.span);
        }
        return;
      }
      this.compileItem(it, slot, top);
    }
  }

  compileItem(it: Item, slot: Slot | undefined, top: boolean): void {
    switch (it.kind) {
      case 'stitch': return this.compileStitch(it, slot);
      case 'chain': return this.compileChain(it);
      case 'skip': return this.compileSkip(it);
      case 'join': return this.compileJoin(it);
      case 'ringJoin': return this.compileRingJoin(it.span);
      case 'ring': {
        this.closeRun();
        const id = this.spaces.length;
        this.spaces.push({ id, kind: 'ring', round: this.cur.index, chains: [] });
        this.lastRing = id;
        this.cur.ringThisRound = id;
        return;
      }
      case 'turn': return this.compileTurn(it.span, top);
      case 'otherSide': return this.compileOtherSide(it.span);
      case 'fasten':
        this.fastened = true;
        this.fastenSpan = it.span;
        return;
      case 'group': return this.compileGroup(it, slot);
      case 'repeat': return this.compileRepeat(it, slot);
    }
  }

  compileTurn(span: Span, _top: boolean): void {
    const c = this.cur;
    if (c.kind === 'row') {
      this.diag('info', 'I_REDUNDANT_TURN', `${c.label}: "turn" is not needed — rows are turned automatically.`, span, c.index);
      return;
    }
    if (this.nodes.length === c.start) return; // handled at round start
    if (c.perimeter && !c.madeStitch) {
      this.diag('info', 'I_REDUNDANT_TURN', `${c.label}: "turn" is not needed — a round worked around rows starts across the top of ${c.prevLabel}, turned.`, span, c.index);
      return;
    }
    this.turnNext = true;
  }

  // ----- target resolution ---------------------------------------------------------------------

  noun(u: Unit): string {
    return unitNoun(u, (t) => this.name(t));
  }

  noTarget(u: Unit, span: Span): TargetError {
    const c = this.cur;
    // "has none left" only when the previous round had some to begin with (N2)
    const had = c.targets.some((e) => entryMatches(e, u, this.nodes, this.spaces));
    const none = had ? 'has none left' : u.kind === 'space' ? 'made none' : 'has none';
    if (u.kind === 'space') {
      const what = this.noun(u);
      return new TargetError('E_NO_SPACE',
        c.prevLabel ? `needs a ${what} to work into but ${c.prevLabel} ${none}.` : `needs a ${what} to work into but there is no previous round.`, span);
    }
    const what = u.kind === 'stname' ? this.noun(u) : 'stitch';
    if (!c.prevLabel) {
      return new TargetError('E_NO_TARGET',
        `needs a ${what} to work into but there is no previous round — start with "mr", "ch N, join to form ring" or a foundation chain.`, span);
    }
    return new TargetError('E_NO_TARGET', `needs a ${what} to work into but ${c.prevLabel} ${none}.`, span);
  }

  /** Chains come from the chain cursor (not the target list) unless this is a border round's bottom. */
  chainFromCursor(): boolean {
    const c = this.cur;
    return !c.hasBase || (!!c.chainCursor && c.chainCursor.pos < c.chainCursor.chains.length);
  }

  /** Move to the next entry matching `u` and consume it. */
  take(u: Unit, span: Span, setLast = true): Anchor {
    const c = this.cur;
    if (u.kind === 'ch' && this.chainFromCursor()) return this.takeChain(span, setLast);
    for (let k = c.cursor; k < c.targets.length; k++) {
      const e = c.targets[k];
      if (entryMatches(e, u, this.nodes, this.spaces)) {
        if (c.hasCorners && k > c.cursor) {
          // A corner is never passed over (see below). Going to a corner leaves the stitches before
          // it unworked (warning); a row end or foundation chain passed over is a wrong unit.
          const passed = c.targets.slice(c.cursor, k).filter((x) => x.kind !== 'space');
          if (u.kind === 'corner') c.passedOver.push(...passed);
          else {
            const wrong = passed.find((x) => x.kind === 'rowEnd' || x.kind === 'base');
            if (wrong) {
              const what = wrong.kind === 'rowEnd' ? 'row end' : 'foundation chain';
              const use = wrong.kind === 'rowEnd' ? 'row end' : 'ch';
              throw new TargetError('E_NO_TARGET',
                `needs a ${this.noun(u)} but the next target on ${this.sideName(wrong)} is a ${what} — write "${this.name('sc')} in next ${use}" (or "… in each ${use} across") to work along this side.`, span);
            }
          }
        }
        c.cursor = k + 1;
        c.used.push(k);
        if (e.kind === 'space') c.workedSpaceLens.add(this.spaces[e.space].chains.length);
        const a: Anchor = entryAnchor(e);
        if (setLast) c.lastUsed = a;
        return a;
      }
      if (c.hasCorners && e.corner && u.kind !== 'corner') {
        throw new TargetError('E_NO_TARGET',
          `needs a ${this.noun(u)} to work into but ${this.sideName(c.targets[c.cursor] ?? e)} has none left before the corner — work the corner first (e.g. "3 ${this.name('sc')} in corner"), or check the number of ${this.noun(u)}${u.kind === 'st' ? 'e' : ''}s along this side.`, span);
      }
    }
    if (u.kind === 'corner') {
      const had = c.targets.some((e) => e.corner);
      throw new TargetError('E_NO_TARGET', had
        ? `needs a corner but no corner is left in ${c.prevLabel} — all ${c.targets.filter((e) => e.corner).length} corners have been worked (or passed) already.`
        : `needs a corner but ${c.prevLabel ?? 'the previous round'} has none — corners exist only in a round worked around rows (a border) and in the rounds after it.`, span);
    }
    if (u.kind === 'space' && u.chains !== undefined) {
      const next = c.targets.slice(c.cursor).find((e) => e.kind === 'space');
      if (next && next.kind === 'space') {
        const len = this.spaces[next.space].chains.length;
        throw new TargetError('E_SPACE_LENGTH',
          `"next ch-${u.chains} ${u.word}" — the next space is a ch-${len} sp (no ch-${u.chains} ${u.word} is left in ${c.prevLabel}).`, span);
      }
    }
    throw this.noTarget(u, span);
  }

  /**
   * Unit of a stitch written without a target: the next stitch — or, while working along a
   * chain ("sc in 2nd ch from hook, 9 sc") with no stitch targets left, the next chain.
   */
  defaultUnit(): Unit {
    const c = this.cur;
    if (c.chainCursor && c.chainCursor.pos < c.chainCursor.chains.length && this.remaining({ kind: 'st' }) === 0) return { kind: 'ch' };
    return { kind: 'st' };
  }

  remaining(u: Unit, limit?: number, from?: number): number {
    const c = this.cur;
    if (u.kind === 'ch' && this.chainFromCursor()) {
      if (c.chainCursor) return c.chainCursor.chains.length - c.chainCursor.pos;
      const f = this.foundationRun();
      return f ? f.nodes.length : 0;
    }
    let n = 0;
    const end = Math.min(limit ?? c.targets.length, c.targets.length);
    for (let k = from ?? c.cursor; k < end; k++) if (entryMatches(c.targets[k], u, this.nodes, this.spaces)) n++;
    return n;
  }

  /** remaining(u, limit) > 0, stopping at the first match. */
  hasRemaining(u: Unit, limit?: number): boolean {
    const c = this.cur;
    if (u.kind === 'ch' && this.chainFromCursor()) return this.remaining(u) > 0;
    const end = Math.min(limit ?? c.targets.length, c.targets.length);
    for (let k = c.cursor; k < end; k++) if (entryMatches(c.targets[k], u, this.nodes, this.spaces)) return true;
    return false;
  }

  /**
   * End (exclusive) of the side the cursor is on: the next corner after the cursor. A corner the
   * cursor stands on belongs to the side (it is worked as an ordinary stitch) — 3.9.
   */
  sideLimit(span: Span, what: string): number {
    const c = this.cur;
    if (!c.hasCorners) {
      throw new TargetError('E_NO_TARGET',
        `"${what}" but ${c.prevLabel ?? 'the previous round'} has no corners — corners exist only in a round worked around rows (a border) and in the rounds after it; use "across" or "around".`, span);
    }
    for (let k = c.cursor + 1; k < c.targets.length; k++) if (c.targets[k].corner) return k;
    return c.targets.length;
  }

  /** A plain chain run of the previous round nobody has addressed yet (a foundation chain). */
  foundationRun(): ChainRun | undefined {
    const r = this.lastChainRun;
    if (r && r.closed && r.round === this.cur.index - 1 && r.fate === 'plain' && !r.addressed) return r;
    return undefined;
  }

  takeChain(span: Span, setLast: boolean): Anchor {
    const c = this.cur;
    if (!c.chainCursor || c.chainCursor.pos >= c.chainCursor.chains.length) {
      const f = this.foundationRun();
      if (f) {
        f.addressed = true;
        c.chainCursor = { chains: f.nodes.slice().reverse(), pos: 0 };
      } else {
        // enter the next chain space of the previous round
        let found = false;
        for (let k = c.cursor; k < c.targets.length; k++) {
          const e = c.targets[k];
          if (e.kind === 'space') {
            c.cursor = k + 1;
            c.used.push(k);
            c.workedSpaceLens.add(this.spaces[e.space].chains.length);
            const chains = this.spaces[e.space].chains.slice();
            c.chainCursor = { chains: c.turned ? chains.reverse() : chains, pos: 0 };
            found = true;
            break;
          }
        }
        if (!found) {
          throw new TargetError('E_NO_CHAIN',
            'needs a chain to work into but there is none — use "Nth ch from hook" right after a chain, or work into a chain space.', span);
        }
      }
    }
    const cc = c.chainCursor!;
    const id = cc.chains[cc.pos++];
    const a: Anchor = cc.part ? { node: id, part: cc.part } : { node: id };
    if (!cc.part) c.chainsWorked.push(id);
    if (setLast) c.lastUsed = a;
    return a;
  }

  /** "working along the other side of the chain" (3.9). */
  compileOtherSide(span: Span): void {
    const c = this.cur;
    if (c.hasBase) return; // a border round: the foundation chain is already part of the round
    const worked = c.chainsWorked;
    if (worked.length < 2) {
      throw new TargetError('E_NO_CHAIN',
        '"working along the other side of the chain" needs a chain worked from the hook earlier in this round, as in "sc in 2nd ch from hook, sc in each ch across, 3 sc in last ch, working along the other side of the chain, sc in each ch across".', span);
    }
    // round the end of the chain: back along the unused loops, not into the last chain again
    c.chainCursor = { chains: worked.slice(0, -1).reverse(), pos: 0, part: 'base' };
  }

  /** Resolve a place to one or more slots. `single` = all stitches go into one place. */
  resolve(t: Target, into: Anchor[] = []): { slots: Anchor[]; single: boolean } {
    const c = this.cur;
    const p: Place = t.place;
    const one = (a: Anchor) => {
      into.push(a);
      return { slots: into, single: true };
    };
    switch (p.kind) {
      case 'ring': {
        if (this.lastRing === undefined) {
          throw new TargetError('E_NO_RING', '"in ring" but no ring has been made — start with "mr" or "ch N, join to form ring".', t.span);
        }
        const a = { space: this.lastRing };
        c.lastUsed = a;
        return one(a);
      }
      case 'same': {
        if (c.lastUsed) return one(c.lastUsed);
        return one(this.take(p.unit.kind === 'space' ? p.unit : { kind: 'st' }, t.span));
      }
      case 'first':
        return one(this.first(p.unit, t.span));
      case 'topOf':
        if (c.kind === 'row') return one(this.take({ kind: 'st' }, t.span));
        return one(this.first({ kind: 'st' }, t.span));
      case 'fromHook':
        return one(this.fromHook(p.ordinal, t.span));
      case 'next': {
        const n = p.n ?? 1;
        const slots = into;
        for (let k = 0; k < n; k++) slots.push(this.take(p.unit, t.span));
        return { slots, single: n === 1 };
      }
      case 'each': {
        const slots = into;
        const sided = p.extent === 'corner' || (p.extent === 'across' && c.hasCorners);
        if (p.n !== undefined) {
          for (let k = 0; k < p.n; k++) slots.push(this.take(p.unit, t.span));
        } else if (sided) {
          // "across" / "across to corner" in a border round: to the end of this side (may be none)
          const limit = this.sideLimit(t.span, 'across to corner');
          while (this.hasRemaining(p.unit, limit)) slots.push(this.take(p.unit, t.span));
        } else {
          // nothing counted as remaining: take() either throws the right error or (for chains)
          // enters the next chain space
          if (!this.hasRemaining(p.unit)) slots.push(this.take(p.unit, t.span));
          while (this.hasRemaining(p.unit)) slots.push(this.take(p.unit, t.span));
        }
        return { slots, single: false };
      }
    }
  }

  /** `first st` / `first dc`: the first such node of the *current* round (3.3). */
  first(u: Unit, span: Span): Anchor {
    const c = this.cur;
    if (u.kind === 'ch') {
      const run = c.openRun ?? this.lastChainRun;
      if (!run || run.nodes.length === 0) throw new TargetError('E_NO_CHAIN', '"first ch" but no chain has been made.', span);
      return { node: run.nodes[0] };
    }
    if (u.kind === 'space') {
      const s = this.spaces.find((x) => x.round === c.index && x.kind === 'chsp');
      if (!s) throw new TargetError('E_NO_SPACE', `"first ${this.noun(u)}" but this round has made no chain space yet.`, span);
      return { space: s.id };
    }
    for (let id = c.start; id < this.nodes.length; id++) {
      const n = this.nodes[id];
      if (!nodeCounts(n)) continue;
      if (u.kind === 'stname') {
        if (!entryMatches({ kind: 'stitch', node: id }, u, this.nodes, this.spaces)) continue;
      }
      return { node: id };
    }
    throw new TargetError('E_NO_TARGET',
      `"first ${this.noun(u)}" — this round has no ${this.noun(u)} yet to join or work into.`, span);
  }

  fromHook(ord: number, span: Span): Anchor {
    const c = this.cur;
    let run = c.openRun;
    if (!run) {
      const r = this.lastChainRun;
      if (r && r.round >= c.index - 1) run = r;
    }
    if (!run) {
      throw new TargetError('E_NO_CHAIN', `"${ordinal(ord)} ch from hook" but no chain has just been made.`, span);
    }
    const len = run.nodes.length;
    if (len < ord) {
      throw new TargetError('E_NO_CHAIN',
        `"${ordinal(ord)} ch from hook" but the chain just made has only ${len} ch.`, span);
    }
    const id = run.nodes[len - ord];
    c.chainsWorked.push(id);
    run.addressed = true;
    run.hookSkip = ord - 1;
    if (run.closed) {
      // previous round's foundation chain: the skipped chains at the hook end are a turning chain
      for (const k of run.nodes.slice(len - ord + 1)) if (!this.nodes[k].role && run.fate === 'plain') this.nodes[k].role = 'tch';
    }
    c.chainCursor = { chains: run.nodes.slice(0, len - ord).reverse(), pos: 0 };
    const a = { node: id };
    c.lastUsed = a;
    return a;
  }

  // ----- stitches ------------------------------------------------------------------------------

  compileStitch(it: StitchItem, slot: Slot | undefined): void {
    const times = it.times ?? 1;
    const spec = it.spec;
    let loop: LoopMod | undefined = it.target?.loop ?? it.loop;
    if ((spec.kind === 'basic' || spec.kind === 'tog') && spec.post) loop = spec.post;
    for (let rep = 0; rep < times; rep++) {
      if (spec.kind === 'picot') {
        for (let k = 0; k < (it.count ?? 1); k++) this.pushNode({ type: 'picot', into: [], chains: spec.chains }, it.span);
        continue;
      }
      if (spec.kind === 'tog') {
        this.compileTog(it, spec, slot, loop);
        continue;
      }
      // Slots are collected first, then worked; if the targets run out part-way, the stitches
      // that did find a target are still made (so the next round's diagnostics stay meaningful).
      const slots: Anchor[] = [];
      let perSlot = it.count ?? 1;
      try {
        if (it.target) {
          this.resolve(it.target, slots);
        } else if (slot) {
          slots.push(slot.anchor);
        } else {
          perSlot = 1;
          const u = this.defaultUnit();
          for (let k = 0; k < (it.count ?? 1); k++) slots.push(this.take(u, it.span));
        }
      } finally {
        for (const a of slots) for (let k = 0; k < perSlot; k++) this.emitUnit(spec, a, loop, it.span);
      }
    }
  }

  compileTog(it: StitchItem, spec: Extract<StitchSpec, { kind: 'tog' }>, slot: Slot | undefined, loop: LoopMod | undefined): void {
    for (let k = 0; k < (it.count ?? 1); k++) {
      let legs: Anchor[];
      if (it.target) {
        const p = it.target.place;
        if (p.kind === 'each') {
          this.err('E_SYNTAX', `"${it.name}" works ${spec.n} stitches together — it cannot go "in each" ${this.noun(p.unit)}; use "in next ${spec.n} sts".`, it.target.span);
          return;
        }
        if (p.kind === 'next' && (p.n ?? 1) !== 1 && p.n !== spec.n) {
          this.err('E_SYNTAX', `"${it.name}" works ${spec.n} stitches together but the target names ${p.n} — expected "in next ${spec.n} sts".`, it.target.span);
          return;
        }
        const r = this.resolve(it.target);
        legs = r.single ? Array.from({ length: spec.n }, () => r.slots[0]) : r.slots;
      } else if (slot) {
        legs = Array.from({ length: spec.n }, () => slot.anchor);
      } else {
        legs = [];
        const u = this.defaultUnit();
        for (let j = 0; j < spec.n; j++) legs.push(this.take(u, it.span));
      }
      const n: Omit<Node, 'id' | 'round'> = { type: spec.base, into: legs };
      if (loop) n.loop = loop;
      this.pushNode(n, it.span);
    }
  }

  /** One "unit" of a stitch spec into one anchor (inc = 2 nodes, shell = N nodes, V = 3 nodes). */
  emitUnit(spec: StitchSpec, a: Anchor, loop: LoopMod | undefined, span: Span): void {
    const base = (type: StitchType, extra: Partial<Node> = {}) => {
      const n: Omit<Node, 'id' | 'round'> = { type, into: [a], ...extra };
      if (loop && type !== 'ch') n.loop = loop;
      return this.pushNode(n, span);
    };
    const grp = (kind: GroupKind) => ({ kind, id: this.newGroup() });
    switch (spec.kind) {
      case 'basic':
        base(spec.type);
        return;
      case 'inc': {
        const g = grp('inc');
        base(spec.base, { group: g });
        base(spec.base, { group: g });
        return;
      }
      case 'cluster': {
        const n: Omit<Node, 'id' | 'round'> = { type: spec.base, into: Array.from({ length: spec.n }, () => a), tag: 'cluster' };
        if (loop) n.loop = loop;
        this.pushNode(n, span);
        return;
      }
      case 'puff':
        base('puff', { loops: spec.loops });
        return;
      case 'popcorn':
        base('popcorn', { legs: spec.legs });
        return;
      case 'shell': {
        const g = grp('shell');
        for (let k = 0; k < spec.n; k++) base(spec.base, { group: g });
        return;
      }
      case 'v': {
        const g = grp('v');
        base('dc', { group: g });
        this.pushNode({ type: 'ch', into: [], group: g }, span);
        base('dc', { group: g });
        return;
      }
      case 'picot':
      case 'tog':
        return; // handled by the caller
    }
  }

  // ----- chains --------------------------------------------------------------------------------

  compileChain(it: ChainItem): void {
    const c = this.cur;
    const ca = it.countsAs;
    if (!ca || ca.kind === 'notCount') {
      for (let k = 0; k < it.n; k++) this.pushNode({ type: 'ch', into: [] }, it.span);
      return;
    }
    const extra = ca.extraCh ?? 0;
    const h = Math.max(1, it.n - extra);
    // base: the target most recently used; else a ring made in this round; else the first stitch target
    let baseA: Anchor;
    if (c.lastUsed) baseA = c.lastUsed;
    else if (c.ringThisRound !== undefined) baseA = { space: c.ringThisRound };
    else baseA = this.take({ kind: 'st' }, it.span);
    c.lastUsed = baseA;
    // a chain run already open in mid-round is closed first (the turning chain stands on its own)
    if (c.openRun && !c.openRun.tchCandidate) this.closeRun();
    for (let k = 0; k < h - 1; k++) this.pushNode({ type: 'ch', into: [], role: 'tch' }, it.span);
    this.pushNode({ type: 'ch', into: [baseA], role: 'tch', countsAs: ca.type }, it.span);
    const run = this.cur.openRun;
    if (run) {
      run.tchCandidate = true;
      this.closeRun();
    }
    for (let k = 0; k < extra; k++) this.pushNode({ type: 'ch', into: [] }, it.span);
  }

  compileSkip(it: SkipItem): void {
    for (let k = 0; k < it.n; k++) this.take(it.unit, it.span, false);
  }

  compileJoin(it: JoinItem): void {
    let a: Anchor;
    if (it.target) {
      const r = this.resolve(it.target);
      a = r.slots[0];
    } else {
      a = this.first({ kind: 'st' }, it.span);
    }
    this.pushNode({ type: 'slst', into: [a] }, it.span);
  }

  compileRingJoin(span: Span): void {
    const c = this.cur;
    const run = c.openRun;
    if (!run || run.nodes.length === 0) {
      throw new TargetError('E_NO_CHAIN', '"join to form ring" needs a chain right before it, as in "ch 6, join to form ring".', span);
    }
    this.closeRun(true);
    const id = this.spaces.length;
    this.spaces.push({ id, kind: 'ring', round: c.index, chains: run.nodes.slice() });
    this.lastRing = id;
    c.ringThisRound = id;
    this.pushNode({ type: 'slst', into: [{ node: run.nodes[0] }] }, span);
  }

  // ----- groups and repeats --------------------------------------------------------------------

  compileGroup(it: GroupItem, slot: Slot | undefined): void {
    const once = () => {
      if (it.target) {
        const r = this.resolve(it.target);
        for (const a of r.slots) this.compileItems(it.items, { anchor: a });
        this.cur.lastUsed = r.slots[r.slots.length - 1];
      } else {
        this.compileItems(it.items, slot);
      }
    };
    if (!it.times || it.times.kind === 'n') {
      const n = it.times?.n ?? 1;
      for (let k = 0; k < n; k++) once();
      return;
    }
    const reqs = it.target ? this.placeRequests(it.target.place) : this.requests(it.items, !!slot);
    this.repeatUntilExhausted(once, reqs, it.span, 'group', it.times.kind);
  }

  compileRepeat(it: RepeatItem, slot: Slot | undefined): void {
    if (it.times.kind === 'n') {
      for (let k = 0; k < it.times.n; k++) this.compileItems(it.items, slot);
      return;
    }
    const reqs = this.requests(it.items, !!slot);
    this.repeatUntilExhausted(() => this.compileItems(it.items, slot), reqs, it.span, 'repeat', it.times.kind);
  }

  /**
   * `*…* around` (3.3): repeat while any target kind the body uses remains. A repetition that runs
   * out of targets part-way is E_REPEAT_UNEVEN.
   */
  repeatUntilExhausted(body: () => void, reqs: Unit[], span: Span, what: 'repeat' | 'group', extent: Extent = 'around'): void {
    const c = this.cur;
    const label = what === 'repeat' ? 'the repeat "* … *"' : 'the group';
    if (reqs.length === 0) {
      this.err('E_REPEAT_UNEVEN', `${label} is worked "around" but does not work into any stitch or space, so it would never end — give a count like "x6".`, span);
      return;
    }
    // in a border round, "across" / "to corner" ends at the next corner (3.9)
    const limit = extent === 'corner' || (extent === 'across' && c.hasCorners) ? this.sideLimit(span, 'to corner') : undefined;
    let reps = 0;
    for (let guard = 0; guard < 100000; guard++) {
      if (reqs.every((u) => !this.hasRemaining(u, limit))) break;
      const before = { cursor: c.cursor, chain: c.chainCursor?.pos, chains: c.chainCursor?.chains };
      try {
        body();
      } catch (e) {
        if (!(e instanceof TargetError) || this.tooBig) throw e;
        if (reps === 0 && e.code !== 'E_NO_TARGET' && e.code !== 'E_NO_SPACE') throw e;
        const left = this.remaining({ kind: 'st' }, limit, before.cursor);
        this.err('E_REPEAT_UNEVEN',
          `${label} does not fit evenly: after ${reps} full repeat${reps === 1 ? '' : 's'} ${left} stitch${left === 1 ? ' is' : 'es are'} left in ${c.prevLabel ?? 'the previous round'}, not enough for another repeat.`,
          span);
        // the cursor is exhausted: later target errors in this round would be cascades
        c.suppress = true;
        return;
      }
      reps++;
      if (c.cursor === before.cursor && c.chainCursor?.pos === before.chain && c.chainCursor?.chains === before.chains) {
        this.err('E_REPEAT_UNEVEN', `${label} is worked "around" but one repeat uses up no stitches, so it would never end.`, span);
        return;
      }
    }
  }

  /** Units a body consumes from the target list (for `around`). */
  requests(items: Item[], inSlot: boolean): Unit[] {
    const out: Unit[] = [];
    for (const it of items) {
      switch (it.kind) {
        case 'stitch':
          if (it.spec.kind === 'picot') break;
          if (it.target) out.push(...this.placeRequests(it.target.place));
          else if (!inSlot) out.push({ kind: 'st' });
          break;
        case 'skip':
          out.push(it.unit);
          break;
        case 'group':
          if (it.target) out.push(...this.placeRequests(it.target.place));
          else out.push(...this.requests(it.items, inSlot));
          break;
        case 'repeat':
          out.push(...this.requests(it.items, inSlot));
          break;
        default:
          break;
      }
    }
    return out;
  }

  placeRequests(p: Place): Unit[] {
    if (p.kind === 'next' || p.kind === 'each') return [p.unit];
    if (p.kind === 'topOf' && this.cur.kind === 'row') return [{ kind: 'st' }];
    return [];
  }
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

function toSrc(s: Span) {
  return { line: s.line, col: s.col, endLine: s.endLine, endCol: s.endCol };
}

/** Node with keys in schema order (stable JSON output). */
export function canonicalNode(n: Node): Node {
  const o: Node = { id: n.id, type: n.type, round: n.round, into: n.into };
  if (n.loop !== undefined) o.loop = n.loop;
  if (n.role !== undefined) o.role = n.role;
  if (n.countsAs !== undefined) o.countsAs = n.countsAs;
  if (n.tag !== undefined) o.tag = n.tag;
  if (n.legs !== undefined) o.legs = n.legs;
  if (n.loops !== undefined) o.loops = n.loops;
  if (n.chains !== undefined) o.chains = n.chains;
  if (n.group !== undefined) o.group = n.group;
  if (n.src !== undefined) o.src = n.src;
  return o;
}


/** Compile an AST to a pattern. `pattern` is present only if there are no errors. */
export function compile(ast: PatternAst, opts: CompileOptions = {}): CompileResult {
  return new Compiler(ast).run(opts);
}

