/**
 * CONTRACT STUB — replaced by the 3D viewer. Other features embed the 3D view only through this
 * component and these props.
 */
import type { Pattern } from '@/core/graph';
import type { ParamSet } from '@/core/params';

export interface SimViewProps {
  pattern: Pattern;
  params?: ParamSet;
  /** Simulate only rounds 0..uptoRound. Default: all. */
  uptoRound?: number;
  /** Blocked (pinned flat) instead of relaxed. Default false. */
  blocked?: boolean;
  /** Node to emphasise. */
  highlightNode?: number;
  /** Show the built-in controls (round slider, relaxed/blocked toggle). Default false: bare canvas. */
  controls?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function SimView(_props: SimViewProps) {
  return <div role="img" aria-label="3D view (not yet implemented)" style={{ padding: 16 }}>3D view pending.</div>;
}
export default SimView;
