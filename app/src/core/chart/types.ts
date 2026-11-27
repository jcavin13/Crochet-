/**
 * Types of the chart layout (pure data; no React, no DOM).
 *
 * Coordinates are SVG user units with y pointing DOWN. One unit = the width of one sc in the
 * chosen parameter set (`ChartLayout.unit` = mm per unit), so symbol sizes are constant across
 * yarn weights while round radii keep the real piece's proportions.
 */
import type { LoopMod, StitchType } from '../graph';
import type { RoundFlatness } from '../flatness';

export type Pt = { x: number; y: number };

/** What a node is drawn as. */
export type ChartNodeKind =
  /** sc, hdc, dc, tr, dtr, tog/cluster, puff, popcorn: stem(s) from anchor point(s) to the top */
  | 'stitch'
  /** a chain of a chain space or a plain chain: oval along an arc / the course */
  | 'chain'
  /** a chain of a turning chain (stacked radially); `countsAs` top included */
  | 'tch'
  /** a chain of a chain ring (laid on the ring circle) */
  | 'ringch'
  /** slip stitch: join, ring join, or a slip stitch sitting on its anchor */
  | 'slst'
  | 'picot';

/** Structural description of a symbol — the glyph is generated from this, not looked up. */
export interface SymbolSpec {
  /** Legend key, e.g. 'dc', 'dc3tog', 'tr3cl', 'puff3', 'pc5', 'picot', 'fpdc', 'sc:blo', 'ch', 'slst'. */
  key: string;
  base: StitchType;
  /** Legs joined at the top (tog / cluster / popcorn legs). 1 for ordinary stitches. */
  legs: number;
  cluster: boolean;
  /** hatches per leg = yarn-overs drawn (hdc 0, dc 1, tr 2, dtr 3) */
  hatches: number;
  loop?: LoopMod;
  /** puff: loops; picot: chains */
  size?: number;
}

export interface ChartNode {
  id: number;
  round: number;
  kind: ChartNodeKind;
  type: StitchType;
  symbol: SymbolSpec;
  /** Reference point: the top for stitches (where the next round attaches), the centre for chains / dots. */
  x: number;
  y: number;
  /** Direction in radians (SVG angle, y down): of the stem (base → top) for stitches and picots; of the course tangent for chains. */
  rot: number;
  /** Anchor points (one per leg), the stem starts. Empty for chains, picots. */
  legs: Pt[];
  /** Centre of the glyph (for hit testing / tooltips). */
  cx: number;
  cy: number;
  /** Course coordinate: unwrapped angle (radial, radians, counter-clockwise) or x (rows). Monotone within a round. */
  s: number;
  /** Whether this node takes part in the round's course (ordering / spacing). */
  course: boolean;
  /** Distance of the top from the centre (radial) or height (rows). */
  r: number;
  /** Shares its anchor with another stitch of the round (increase, shell, V…): drawn fanning from the anchor. */
  fan?: boolean;
  /** For picots: the base point is (x, y); `rot` points outward. */
  role?: 'join' | 'ringjoin' | 'travel';
  /** Part of a radial arm (a chain spine worked back along, or a pointed chain loop): its place on the arm. */
  arm?: 'spine' | 'tip' | 'back' | 'branch' | 'loop';
  /** Glyph size factor (picots on arms are drawn as larger loops). Default 1. */
  scale?: number;
}

export interface ChartSpace {
  id: number;
  round: number;
  kind: 'chsp' | 'ring';
  /** SVG path of the arc the chains lie on (chsp) or the ring circle. */
  d: string;
  /** Furthest radius / height reached by the arc. */
  apex: number;
}

export interface ChartRound {
  index: number;
  label: string;
  /** Short label drawn on the chart, e.g. '3'. */
  short: string;
  kind: 'round' | 'row' | 'foundation';
  /** Mean stitch-top radius (radial) or row height (rows). */
  r: number;
  /** Inner edge of the round's band (the previous round's r, or 0). */
  r0: number;
  /** Furthest radius reached by anything in the round (arcs, picots). */
  rOuter: number;
  /** Working direction: +1 counter-clockwise (radial) / left→right (rows), −1 the other way. */
  dir: 1 | -1;
  joined: boolean;
  /** Label anchor and the text's rotation (radians). */
  labelAt: Pt;
  first: number;
  last: number;
  /** Bounds of this round's symbols (inclusive of earlier rounds is up to the caller). */
  bounds: Bounds;
  /** Spiral (unjoined) round: the radius rises by this much over the turn, from s0 (0 = closed round). */
  spiral: number;
  /** Course coordinate where the round starts. */
  s0: number;
  /** Analytic flatness for this round (radial only). */
  flat?: RoundFlatness;
  /**
   * Pointed round (radial): it has arms — chain spines worked back along, or long chain loops with
   * a picot at the top — that stand far beyond the ring. Such a round is judged by blocking, not by
   * the circular flatness rule; its band is drawn as `outline` instead of a ring.
   */
  pointed?: boolean;
  /** Pointed rounds: the outer outline, a radius per angle (`outlineN` points at angles 2πi/N, counter-clockwise from 3 o'clock). */
  outline?: number[];
  /** Pointed rounds: the arms (base angle, base radius and tip radius) in working order. */
  arms?: ChartArm[];
}

export interface ChartArm {
  kind: 'spine' | 'loop';
  /** First and last node id of the arm (contiguous in working order). */
  first: number;
  last: number;
  /** Course angle of the arm (radians, counter-clockwise from 3 o'clock). */
  s: number;
  /** Radius of the arm's base and of its tip (chart units). */
  r0: number;
  r1: number;
  /** Spine chains (base → tip), the tip loop's chains, and the stitches worked back along the spine. */
  spine: number[];
  tip: number[];
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface ChartLayout {
  mode: 'radial' | 'rows';
  /** mm per chart unit (= sc width of the parameter set). */
  unit: number;
  nodes: ChartNode[];
  spaces: ChartSpace[];
  rounds: ChartRound[];
  /** Centre ring (radial): magic ring or chain ring. */
  ring?: { kind: 'magic' | 'chain'; r: number; space: number };
  bounds: Bounds;
}

export interface LayoutOptions {
  /** Minimum radial distance between the stitch tops of consecutive rounds (chart units). Default 0.8. */
  minRoundGap?: number;
  /** Fraction of a round's circumference symbols may fill before the radius is pushed out. Default 0.96. */
  fill?: number;
  /** Start angle of the rounds (radians, counter-clockwise from 3 o'clock). Default π/2 (12 o'clock). */
  startAngle?: number;
  /** Force a layout mode. Default: 'rows' if any round is a Row, else 'radial'. */
  mode?: 'radial' | 'rows';
}
