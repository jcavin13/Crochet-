/**
 * Snowflake designer types. A snowflake is a small n-pointed lace motif (usually 6 points, in
 * thread): a centre round, 0–5 body rounds solved to lie flat like a doily, and one arm round whose
 * points are spines of chain with picot / trefoil / bobble tips and side branches, joined by valley
 * bridges. It is stiffened and pinned out, so the arm round is judged by how it blocks, not by the
 * circular flatness rule.
 */
import type { Pattern } from '../../graph';
import type { FlatnessReport, RoundClass } from '../../flatness';
import type { Entry, Op, RoundParams } from '../types';

export type SnowCentreStyle = 'ring' | 'spoked' | 'double-spoked' | 'cluster' | 'petal';
export type SnowBodyMotif = 'hexagon' | 'corners' | 'major-minor';
export type TipStyle = 'picot' | 'trefoil' | 'spike' | 'bobble' | 'loop';
export type MinorStyle = 'none' | 'picot' | 'spike' | 'trefoil';
export type ValleyDepth = 'deep' | 'medium' | 'shallow';

export interface ArmSpec {
  /** Spine length in chains (the arm without its tip), 3–24. */
  length: number;
  /** Pairs of side branches (picots) worked on the way back down the spine, 0–3. */
  branches: number;
  /** Picot size of the tip (and branches), in chains, 3–6. */
  picot: number;
  tip: TipStyle;
  /** Stitch worked back down the spine: slip stitches (delicate) or sc (bold). */
  back: 'slst' | 'sc';
  /** Branch picots grow by one chain each pair towards the centre (fern look). */
  graded?: boolean;
}

export interface MinorSpec {
  style: MinorStyle;
  /** Spine of a minor spike/trefoil, chains. */
  length: number;
  picot: number;
}

export interface ValleySpec {
  /** deep = taut bridges close to the body; shallow = slack bridges that pin out into a scallop. */
  depth: ValleyDepth;
  /** Anchor the bridge with an sc into the valley loop of the round below. */
  anchor: boolean;
  /** Fixed bridge chains per gap; undefined = solved from the gap and the depth. */
  chains?: number;
}

export interface SnowflakeSpec {
  /** Number of major points (5, 6, 8 or 12; 3–12 accepted). */
  points: number;
  centre: { style: SnowCentreStyle; params?: RoundParams };
  /** Body rounds between the centre and the arms (0–5), each solved to lie flat. */
  body: { motif: SnowBodyMotif; params?: RoundParams }[];
  arm: ArmSpec;
  minor: MinorSpec;
  valley: ValleySpec;
  title?: string;
  seed?: number;
  terms?: 'US' | 'UK';
  notes?: string;
}

/** Role of each chain loop of a repeat, for the round above. */
export type SlotRole = 'point' | 'minor' | 'valley';

export interface SnowPlannedRound {
  kind: 'centre' | 'body' | 'arms';
  name: string;
  params: RoundParams;
  ops: Op[];
  entries: Entry[];
  /** Roles of the chain loops of one repeat (spaceSlots order). */
  roles: SlotRole[];
  ringChains?: number;
  /** Predicted flatness (body rounds). */
  e: number; eMin: number; eMax: number;
  cls: 'flat' | 'cup' | 'ruffle';
  rho: number; r: number;
  prevLead: number;
}

export interface SnowRound {
  number: number;
  kind: SnowPlannedRound['kind'];
  name: string;
  params: RoundParams;
  /** Body/centre: flatness class from the real check. Arm round: 'pointed' (judged by blocking). */
  class: RoundClass | 'pointed';
  e: number;
  message: string;
  stitches: number;
  text: string;
  /** Radius handed on (body) or tip radius (arms), mm. */
  radiusMm: number;
}

export interface Pt { x: number; y: number }
export interface Seg { a: Pt; b: Pt }

export interface Bridge {
  /** Chains in the bridge. */
  chains: number;
  /** Straight gap between its anchors, mm. */
  gapMm: number;
  /** Rest length / gap: < 0.95 pulls tight, > 2.2 sags. */
  ratio: number;
  /** Where the bridge is pinned (its midpoint pulled outward). */
  pin: Pt;
  verdict: 'tight' | 'ok' | 'sags';
}

export interface BlockedShape {
  points: number;
  /** Radius where the arms start (top of the body), mm. */
  bodyR: number;
  /** Major tip radius, mm. */
  tipR: number;
  /** Minor tip radius (0 when none), mm. */
  minorTipR: number;
  /** Deepest valley pin radius, mm. */
  valleyR: number;
  /** Smallest distance between the arms of neighbouring points (branches included), minus thread, mm. */
  clearanceMm: number;
  /** Diameter across the points, mm (tip to opposite tip; odd n: tip to the opposite valley edge). */
  acrossMm: number;
  /** Outline, closed, in mm (centre at 0,0; first major point straight up). */
  outline: Pt[];
  /** Pin marks: tips, branch tips and valleys, mm. */
  pins: { p: Pt; kind: 'tip' | 'branch' | 'valley' | 'minor' }[];
  /** Segments drawn by previews: spines, branches, bridges. */
  arms: { spine: Seg[]; branches: Seg[]; tips: Pt[] }[];
  bridges: Bridge[];
  /** Every valley bridge of the piece as anchor → pin → anchor (for drawing). */
  web: { a: Pt; pin: Pt; b: Pt }[];
  /** Body radii of each centre/body round, mm. */
  rings: number[];
}

export interface SnowCheckItem {
  id: 'body' | 'web' | 'clearance' | 'shape';
  ok: boolean;
  /** One sentence, crocheter's words. */
  text: string;
}

export interface SnowCheck {
  ok: boolean;
  /** "Blocks to a crisp star: tip radius 4.1 cm, valley radius 2.3 cm, arm branches clear each other by 3 mm." */
  summary: string;
  items: SnowCheckItem[];
}

export interface SnowStats {
  rounds: number;
  stitches: number;
  /** Across the points when blocked, mm. */
  diameterMm: number;
  /** Rough thread length, m. */
  threadM: number;
}

export interface SnowflakeResult {
  spec: SnowflakeSpec;
  text: string;
  pattern?: Pattern;
  flatness?: FlatnessReport;
  rounds: SnowRound[];
  planned: SnowPlannedRound[];
  shape: BlockedShape;
  check: SnowCheck;
  stats: SnowStats;
  warnings: string[];
  diagnostics: { severity: string; code: string; message: string }[];
}
