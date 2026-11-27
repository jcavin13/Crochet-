/**
 * CONTRACT STUB — compact symmetry read-out for a pattern (overall group, per-round orders,
 * defects). Replaced by the real implementation; embed only through these props.
 */
import type { Pattern } from '@/core/graph';

export interface SymmetryPanelProps {
  pattern: Pattern;
  /** Compact = one-line summary with expandable details. Default false. */
  compact?: boolean;
  /** Called when the user picks a round or a defect (to highlight it on a chart). */
  onSelectRound?: (round: number) => void;
  onSelectNodes?: (nodes: number[]) => void;
  className?: string;
}

export function SymmetryPanel(_props: SymmetryPanelProps) {
  return <div>Symmetry analysis pending.</div>;
}
export default SymmetryPanel;
