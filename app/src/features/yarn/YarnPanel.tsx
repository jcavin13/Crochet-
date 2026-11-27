/**
 * CONTRACT STUB — yarn requirement read-out (metres, grams, balls, range, per-colour) with the
 * yarn inputs (m/100 g, ball size, allowance, calibration). Replaced by the real implementation;
 * embed only through these props.
 */
import type { Pattern } from '@/core/graph';
import type { ParamSet } from '@/core/params';
import type { YarnEstimate, YarnOptions } from '@/core/yarn';

export interface YarnPanelProps {
  /** Either a compiled pattern … */
  pattern?: Pattern;
  /** … or a ready-made estimate (for pieces estimated from counts). */
  estimate?: YarnEstimate;
  params?: ParamSet;
  options?: YarnOptions;
  /** One-line summary with expandable details. Default false. */
  compact?: boolean;
  className?: string;
}

export function YarnPanel(_props: YarnPanelProps) {
  return <div>Yarn estimate pending.</div>;
}
export default YarnPanel;
