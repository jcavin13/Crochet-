/**
 * TypeScript mirror of `spec/pattern.schema.json` (v0.1) plus the shared Diagnostic type.
 *
 * Keep this file in lock-step with the schema: every property here exists there and vice versa.
 */

/** Stitch types stored in the graph. Always US names (decision 4). */
export type StitchType =
  | 'ch'
  | 'slst'
  | 'sc'
  | 'hdc'
  | 'dc'
  | 'tr'
  | 'dtr'
  | 'puff'
  | 'popcorn'
  | 'picot';

export const STITCH_TYPES: readonly StitchType[] = [
  'ch', 'slst', 'sc', 'hdc', 'dc', 'tr', 'dtr', 'puff', 'popcorn', 'picot',
];

/** Terminology of notation text. The graph is always US. */
export type Terms = 'US' | 'UK';

/** `loop` property of a node. Omitted = both loops. */
export type LoopMod = 'flo' | 'blo' | 'fp' | 'bp';

/** What one leg of a stitch is worked into: a node (stitch top or individual chain) or a space. */
export type Anchor = NodeAnchor | SpaceAnchor;
/**
 * `part` (optional, notation.md 3.9) says which part of the node is worked into:
 *  - 'side': the end of the row that node is the edge stitch of ("sc in row end"), worked from the
 *    side by a border round;
 *  - 'base': the unused (bottom) loops of a chain, i.e. the other side of a foundation chain.
 * Omitted: the top of the stitch, or the chain itself.
 */
export interface NodeAnchor { node: number; part?: AnchorPart }
export type AnchorPart = 'side' | 'base';
export interface SpaceAnchor { space: number }

export type GroupKind = 'inc' | 'shell' | 'v';

/** Span in the notation text (1-based; columns in UTF-16 code units; end exclusive). */
export interface SrcSpan {
  line: number;
  col: number;
  endLine?: number;
  endCol?: number;
}

export interface Node {
  /** Equals the index in graph.nodes (working order). */
  id: number;
  type: StitchType;
  /** Index into graph.rounds. */
  round: number;
  /** One entry per leg. Empty for ch (except a counting turning-chain top) and picot. */
  into: Anchor[];
  loop?: LoopMod;
  /** Chain belonging to a turning chain. */
  role?: 'tch';
  /** On the top chain of a turning chain that counts as a stitch. */
  countsAs?: StitchType;
  tag?: 'cluster';
  /** popcorn: number of dc inside (default 5). */
  legs?: number;
  /** puff: number of loops (default 3). */
  loops?: number;
  /** picot: number of chains (default 3). */
  chains?: number;
  /** Nodes produced by one compound (inc / shell / V-stitch) share a group id. */
  group?: { kind: GroupKind; id: number };
  src?: SrcSpan;
}

export interface Space {
  /** Equals the index in graph.spaces. */
  id: number;
  kind: 'chsp' | 'ring';
  round: number;
  /** Chain node ids in working order. Empty for a magic ring. */
  chains: number[];
}

export type RoundKind = 'round' | 'row' | 'foundation';

export interface Round {
  index: number;
  /** e.g. 'Rnd 3', 'Row 2', 'Foundation' */
  label: string;
  kind: RoundKind;
  joined?: boolean;
  /** true if this round is worked in the opposite direction to the previous one. */
  turned?: boolean;
  /** id of the first node of the round; -1 if the round has no nodes */
  first: number;
  /** id of the last node of the round (inclusive); -1 if empty */
  last: number;
  /** number of stitch-counting nodes (notation.md 3.8) */
  stitchCount: number;
  declaredCount?: number;
  src?: { line: number; endLine?: number };
}

export interface Graph {
  nodes: Node[];
  spaces: Space[];
  rounds: Round[];
}

export interface Meta {
  title: string;
  terms?: Terms;
  yarn?: string;
  hook?: string;
  params?: string;
  source?: string;
  license?: string;
  author?: string;
  year?: string;
  notes?: string;
  /**
   * Colour plan as written by the pattern (`colors:` header), e.g. "A Oatmeal #e8dcc8; B Sage
   * #9caf88". Colour changes are not part of the stitch graph yet (notation.md 5).
   */
  colors?: string;
  extra?: Record<string, string>;
}

export interface Pattern {
  format: 'crochet-pattern';
  version: '0.1';
  meta: Meta;
  /** The .cro source text this graph was compiled from. */
  notation?: string;
  graph: Graph;
}

// ---------------------------------------------------------------------------------------------
// Diagnostics (notation.md section 4)
// ---------------------------------------------------------------------------------------------

export type Severity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  | 'E_SYNTAX'
  | 'E_UNKNOWN_STITCH'
  | 'E_UNCLOSED_REPEAT'
  | 'E_UNCLOSED_GROUP'
  | 'E_ROUND_NUMBER'
  | 'E_NO_TARGET'
  | 'E_NO_SPACE'
  | 'E_SPACE_LENGTH'
  | 'E_NO_RING'
  | 'E_NO_CHAIN'
  | 'E_REPEAT_UNEVEN'
  | 'E_COUNT_MISMATCH'
  | 'E_AFTER_FASTEN_OFF'
  | 'W_UNWORKED'
  | 'W_UNKNOWN_HEADER'
  | 'I_COUNT_UNVERIFIED'
  | 'I_REDUNDANT_TURN'
  /** Not in notation.md's list: the "info" for a trailing unworked turning chain in a row (3.3). */
  | 'I_UNWORKED_TCH';

export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  message: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  /** Graph round index (node.round) the diagnostic belongs to, when applicable. */
  round?: number;
}
