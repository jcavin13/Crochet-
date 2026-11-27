/**
 * CONTRACT STUB — symmetry analysis of a stitch graph. Replaced by the real implementation;
 * other features code against these types.
 */
import type { Graph } from '../graph';

export interface SymmetryDefect {
  round: number;
  /** Node ids that break the round's dominant repeat. */
  nodes: number[];
  message: string;
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
}

export function analyzeSymmetry(graph: Graph): SymmetryReport {
  return { order: 1, mirror: false, group: 'C1', rounds: [], defects: [], summary: ['Symmetry analysis pending.'], applicable: false };
}
