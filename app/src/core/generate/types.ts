/**
 * Types of the generative doily designer (pure; no React/DOM).
 *
 * Model: a doily is a stack of round motifs applied with n-fold symmetry. Each round is written as
 * one *sector* (the repeat) worked n times. A motif is a rule that, given the previous round's
 * interface (the ordered targets of one sector: stitches and chain spaces) and its parameters,
 * emits the ops of one sector and so defines the interface it leaves for the next round.
 */
import type { Pattern } from '../graph';
import type { FlatnessReport, RoundClass } from '../flatness';

/* ------------------------------------------------------------------ stitches and ops */

/** Plain stitch heights the designer works with. */
export type Height = 'sc' | 'hdc' | 'dc' | 'tr';
export type Plain = Height | 'dtr';

/** A stitch the designer can emit. Clusters are `<legs>-<base> cl` (dcNtog with tag cluster). */
export type Stitch =
  | { t: Plain }
  | { t: 'cl'; base: 'dc' | 'tr'; legs: number }
  | { t: 'puff' }
  | { t: 'pc'; legs: number };

/** A stitch worked into a chain of this round by hook addressing: any designer stitch or a slip stitch. */
export type HookStitch = Stitch | { t: 'slst' };

/** What a group worked into one place contains. */
export type Item =
  | { k: 'st'; s: Stitch; n: number }
  | { k: 'ch'; n: number }
  | { k: 'picot'; n: number }
  /** Inside a group: `sl st in 4th ch from hook` (a stitch with its own target; see Op 'hook'). */
  | { k: 'hook'; s: HookStitch; nth: number }
  /** Inside a group: `sl st in next 5 ch` (see Op 'along'). */
  | { k: 'along'; s: HookStitch; count: number };

/** Where an op is worked. `same` re-uses the place of the previous op (a space or a stitch). */
export type Place = { to: 'st' } | { to: 'sp'; len: number } | { to: 'same' } | { to: 'ring' };

export type Op =
  /** Items worked into one place: `dc in next st`, `5 dc in next ch-4 sp`, `(sc, picot, sc) in same sp`. */
  | { k: 'into'; place: Place; items: Item[] }
  /** One stitch into each of the next `count` stitches: `dc in next 3 sts`. */
  | { k: 'each'; s: Stitch; count: number }
  | { k: 'ch'; n: number }
  | { k: 'picot'; n: number }
  | { k: 'skipSt'; n: number }
  | { k: 'skipSp'; len: number }
  /**
   * `sl st in 4th ch from hook`: a stitch into the chain run just made (notation.md 3.3), counting
   * back from the hook. The chain run becomes plain chains (no chain space); chains skipped at the
   * hook end stand as a loop / standing chain. Used for snowflake spines, tips and spikes.
   */
  | { k: 'hook'; s: HookStitch; nth: number }
  /** `sl st in next 5 ch`: continue along that chain run, away from the hook (back down a spine). */
  | { k: 'along'; s: HookStitch; count: number };

/* ------------------------------------------------------------------ interfaces */

/** One target a round leaves for the next (notation.md 3.3), per sector, in working order. */
export type Entry =
  | { kind: 'st'; type: Plain | 'puff' | 'popcorn'; cluster?: boolean }
  | { kind: 'sp'; len: number };

export interface Iface {
  /** 'ring': nothing worked yet. 'solid': stitches only. 'lace': has chain spaces. */
  kind: 'ring' | 'solid' | 'lace';
  /** The targets of ONE sector (the pattern repeats it n times). */
  entries: Entry[];
}

/* ------------------------------------------------------------------ motifs */

export type MotifId =
  | 'centre' | 'solid' | 'accent' | 'filler' | 'spokes' | 'mesh' | 'arches' | 'clusters' | 'puffs'
  | 'vstitch' | 'shells' | 'petals' | 'fans' | 'picot';

export type ParamValue = number | string;
/** Per-round parameters. A missing key means "auto" (chosen by the flatness solver). */
export type RoundParams = Record<string, ParamValue>;

export interface ParamDef {
  key: string;
  label: string;
  /** Discrete values the solver may choose from (the UI offers them, plus "auto"). */
  values: ParamValue[];
  /** Display text for a value. */
  format?: (v: ParamValue) => string;
  hint?: string;
}

export interface MotifInfo {
  id: MotifId;
  label: string;
  /** One-line description in crocheter's language. */
  blurb: string;
  /** Interfaces it can be worked onto. */
  accepts: Iface['kind'][];
  /** 'lacy' motifs make chain spaces; 'solid' ones close the fabric. Used by the density slider. */
  texture: 'lacy' | 'solid' | 'edge';
  params: ParamDef[];
}

/* ------------------------------------------------------------------ specs and results */

export type TargetShape = 'flat' | 'ruffle' | 'bowl';

export interface ShapeTarget {
  shape: TargetShape;
  /** For ruffle / bowl: how many final rounds are deliberately off flat (default 2). */
  rounds?: number;
  /** For ruffle / bowl: how far past the flat tolerance, as a fraction (default 0.15 = 15 %). */
  amount?: number;
}

export interface StyleSpec {
  /** 0 = solid … 1 = lacy. Breaks ties between flat candidates (longer chains when lacy). */
  lacy?: number;
  /** Stitch heights the solver may use when a round's height is on auto. */
  heights?: Height[];
}

export interface RoundSpec {
  motif: MotifId;
  /** Fixed parameters; anything absent is chosen automatically. */
  params?: RoundParams;
  /**
   * Double the repeats from this round outward (e.g. 6 → 12 points). Only possible where the round
   * below splits into two identical halves per repeat (e.g. 2 loops per repeat); otherwise it is
   * ignored with a warning.
   */
  double?: boolean;
  /** Soft preferences: used when they cost little flatness (the random sampler's "character"). */
  prefer?: RoundParams;
}

export interface DoilySpec {
  /** Number of repeats around (3–24). */
  symmetry: number;
  rounds: RoundSpec[];
  target?: ShapeTarget;
  style?: StyleSpec;
  terms?: 'US' | 'UK';
  title?: string;
  /** Recorded in the header so a random design can be reproduced. */
  seed?: number;
  /** Free text for the `notes:` header. */
  notes?: string;
}

export interface GeneratedRound {
  /** Round number (1-based, as printed). */
  number: number;
  motif: MotifId;
  /** Parameters actually used (fixed + solved). */
  params: RoundParams;
  /** Inserted by the generator to make the user's next motif possible. */
  auto?: boolean;
  /** Why it was inserted: the next motif needs chain spaces / stitches, or did not fit otherwise. */
  autoReason?: 'spaces' | 'stitches' | 'fit';
  /** Index into spec.rounds of the round this was made for (for a transition: the round it serves). */
  source: number;
  /** Nominal excess and class from the real flatness check of the compiled pattern. */
  e: number;
  eMin: number;
  /** Flat only thanks to chain compliance (flatness.md "flat (loose loops)"). */
  slackOnly?: boolean;
  eMax: number;
  class: RoundClass;
  /** What the solver aimed for. */
  aim: 'flat' | 'ruffle' | 'cup';
  stitches: number;
  spaces: number;
  message: string;
  /** Notation of this round (one line). */
  text: string;
  /** Repeats around in this round (the spec's symmetry, doubled where a round doubled it). */
  repeats: number;
  /** The targets one repeat of this round leaves for the next (for thumbnails and suggestions). */
  entries: Entry[];
  /** Stitch-top radius and radius handed to the next round, mm (flatness model). */
  rho: number;
  r: number;
  /** This round doubled the repeats. */
  doubled?: boolean;
}

export interface DoilyStats {
  rounds: number;
  stitches: number;
  chains: number;
  /** Outer diameter in mm (2 × outer radius from the flatness model). */
  diameterMm: number;
  /** Rough yarn estimate in metres (summed stitch sizes; see generate.ts). */
  yarnM: number;
}

export interface GenerateResult {
  text: string;
  pattern?: Pattern;
  flatness?: FlatnessReport;
  rounds: GeneratedRound[];
  warnings: string[];
  stats: DoilyStats;
  /** Compiler diagnostics (should always be empty; surfaced if not). */
  diagnostics: { severity: string; code: string; message: string }[];
}
