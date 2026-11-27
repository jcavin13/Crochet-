/**
 * AST of a `.cro` notation file (spec/notation.md section 2).
 *
 * Stitch names are already translated to US terms in the AST (UK is a parse/print dialect), so the
 * compiler and the printer never look at dialect-specific spellings.
 */
import type { Terms } from '../graph/types';

export interface Span {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

/** Basic stitch types that can be a base of compounds, turning chains, units. */
export type BaseType = 'sc' | 'hdc' | 'dc' | 'tr' | 'dtr';
export type LoopModAst = 'flo' | 'blo';

/** What a stitch name denotes (US). */
export type StitchSpec =
  | { kind: 'basic'; type: 'slst' | BaseType; post?: 'fp' | 'bp' }
  | { kind: 'inc'; base: BaseType }
  | { kind: 'tog'; base: BaseType; n: number; post?: 'fp' | 'bp'; /** written as dec/invdec */ alias?: 'dec' | 'invdec' }
  | { kind: 'cluster'; base: BaseType; n: number; /** written as bobble / bare cl */ alias?: 'bobble' | 'cl' }
  | { kind: 'puff'; loops: number; explicit: boolean }
  | { kind: 'popcorn'; legs: number; base: BaseType; explicit: boolean }
  | { kind: 'picot'; chains: number }
  | { kind: 'shell'; base: BaseType; n: number; explicit: boolean }
  | { kind: 'v' };

/** A unit in a place: what kind of target is meant. */
export type Unit =
  | { kind: 'st' }
  /** "same place": whatever was used last. Only meaningful with `same`. */
  | { kind: 'any' }
  /** next dc, each sc around: a stitch target of that type ('cl' = cluster-tagged node). */
  | { kind: 'stname'; type: BaseType | 'slst' | 'puff' | 'popcorn' | 'cl' }
  /** sp / ch-sp / ch-3 sp / loop; `chains` set for ch-N sp. `word` is for printing. */
  | { kind: 'space'; chains?: number; word: 'sp' | 'loop' }
  /** an individual chain */
  | { kind: 'ch' }
  /**
   * The end of a row, worked into from the side when a border round goes along the side of a
   * piece worked in rows (notation.md 3.9): `sc in each row end across`, `2 dc in next row end`.
   */
  | { kind: 'rowEnd' }
  /** A corner of a border round (notation.md 3.9): `3 sc in corner`, `(sc, ch 2, sc) in next corner`. */
  | { kind: 'corner' };

export type Place =
  | { kind: 'ring' }
  | { kind: 'same'; unit: Unit }
  | { kind: 'first'; unit: Unit }
  | { kind: 'topOf'; what: 'tch' | 'beg ch'; chains?: number }
  /** [next] [n] unit; `n` = number of targets (default 1). */
  | { kind: 'next'; n?: number; unit: Unit }
  /** each [of next n] unit [around|across|to end|across to corner] */
  | { kind: 'each'; n?: number; unit: Unit; extent?: Extent }
  /** Nth ch from hook */
  | { kind: 'fromHook'; ordinal: number };

export interface Target {
  prep: 'in' | 'into' | 'around' | 'on' | 'over' | 'to';
  loop?: LoopModAst;
  place: Place;
  span: Span;
}

/**
 * How far an `each` place or a `*…*` repeat runs: `around`, `across`, `to end`, or `across to
 * corner` (= `to corner`, `to next corner`; notation.md 3.9). In a round that has corners,
 * `across` also stops at the next corner.
 */
export type Extent = 'around' | 'across' | 'end' | 'corner';

export type Times =
  | { kind: 'n'; n: number }
  | { kind: Extent };

export interface StitchItem {
  kind: 'stitch';
  /** Number of stitches (prefix "5 sc", suffix "sc 5" or "inc x6"); undefined = 1. */
  count?: number;
  spec: StitchSpec;
  loop?: LoopModAst;
  target?: Target;
  /** "dc in next st x3": repeat of the whole item. */
  times?: number;
  /** The stitch name as written (for messages). */
  name: string;
  span: Span;
}

export type CountsAs =
  | { kind: 'counts'; type: BaseType; extraCh?: number; first?: boolean }
  | { kind: 'notCount' };

export interface ChainItem {
  kind: 'chain';
  n: number;
  countsAs?: CountsAs;
  span: Span;
}

export interface SkipItem {
  kind: 'skip';
  n: number;
  unit: Unit;
  span: Span;
}

export interface JoinItem {
  kind: 'join';
  /** explicit target, e.g. "join with sl st in top of beg ch" */
  target?: Target;
  span: Span;
}

/** ch N, join to form ring / form ring / sl st in first ch to form ring */
export interface RingJoinItem { kind: 'ringJoin'; span: Span }
/** mr / magic ring / magic circle */
export interface RingItem { kind: 'ring'; span: Span }
export interface TurnItem { kind: 'turn'; span: Span }
/**
 * "working along the other side of the chain" (notation.md 3.9): the chain cursor turns round the
 * end of the chain just worked and runs back along its unused loops.
 */
export interface OtherSideItem { kind: 'otherSide'; span: Span }
export interface FastenItem { kind: 'fasten'; span: Span }

export interface GroupItem {
  kind: 'group';
  bracket: '(' | '[';
  items: Item[];
  target?: Target;
  times?: Times;
  span: Span;
}

export interface RepeatItem {
  kind: 'repeat';
  items: Item[];
  times: Times;
  /** star: *A* xN; rep: *A, rep from * ... (rep with `more` stores the total in times.n) */
  form: 'star' | 'rep';
  span: Span;
  /** span of the opening * */
  openSpan: Span;
}

export type Item =
  | StitchItem
  | ChainItem
  | SkipItem
  | JoinItem
  | RingJoinItem
  | RingItem
  | TurnItem
  | OtherSideItem
  | FastenItem
  | GroupItem
  | RepeatItem;

/** One component of a count annotation: "16 dc", "8 ch-3 sps", "12". */
export interface CountPart {
  n: number;
  unit: CountUnit;
  /** the unit as written ("" for a bare number) */
  text: string;
  span: Span;
}

export type CountUnit =
  | { kind: 'st' }
  | { kind: 'type'; type: BaseType | 'slst' | 'puff' | 'popcorn' | 'picot' | 'ch' }
  | { kind: 'cl' }
  | { kind: 'spaces'; chains?: number }
  | { kind: 'group'; group: 'shell' | 'v' }
  | { kind: 'unknown' };

export interface CountAnn {
  parts: CountPart[];
  span: Span;
}

export interface RoundLabel {
  kind: 'round' | 'row' | 'foundation';
  /** The label word as written, e.g. "Rnd", "Rows", "Foundation". */
  word: string;
  from: number;
  to: number;
  /** true when written as a range (Rnds 6-10) */
  range: boolean;
  /**
   * "Rows 2-120 (even):" — the instruction is worked on the rows of that parity only; the rows
   * of the other parity come from a neighbouring label ("Rows 3-121 (odd):"). notation.md 1.
   */
  parity?: 'odd' | 'even';
  span: Span;
}

export interface RoundAst {
  label: RoundLabel;
  items: Item[];
  count?: CountAnn;
  /** Lines covered by this round (label line .. last continuation line). */
  span: Span;
  /** true if the parser reported an error inside this round (compiler suppresses cascades). */
  broken?: boolean;
}

export interface HeaderAst {
  /** lower-cased key */
  key: string;
  value: string;
  span: Span;
}

export interface PatternAst {
  headers: HeaderAst[];
  terms: Terms;
  rounds: RoundAst[];
}
