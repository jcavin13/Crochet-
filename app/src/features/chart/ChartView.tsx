/**
 * CONTRACT STUB — replaced by the chart renderer. Other features embed the chart only through
 * this component and these props.
 */
import type { Pattern } from '@/core/graph';
import type { ParamSet } from '@/core/params';

export interface ChartViewProps {
  pattern: Pattern;
  /** Parameter set used for layout proportions and the flatness band. Default: paramsFor(pattern). */
  params?: ParamSet;
  /** Draw the per-round flat / cup / ruffle colour band. Default true. */
  showFlatness?: boolean;
  /** Draw only rounds 0..uptoRound (index into graph.rounds). Default: all. */
  uptoRound?: number;
  /** Node to emphasise (the counter's current stitch). Nodes before it are drawn as done when `dimAfter` is set. */
  highlightNode?: number;
  /** Fade nodes after highlightNode (work not yet done). */
  dimAfter?: boolean;
  onNodeClick?: (nodeId: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function ChartView(_props: ChartViewProps) {
  return <div role="img" aria-label="chart (not yet implemented)" style={{ padding: 16 }}>Chart renderer pending.</div>;
}
export default ChartView;
