/**
 * Compact symmetry read-out for a pattern: overall group with a rosette glyph, per-round orders
 * with markers where the piece's order changes, and "almost symmetric" defects with a button to
 * show them on a chart. Embed only through these props.
 */
import { useMemo, useState } from 'react';
import type { Pattern } from '@/core/graph';
import { analyzeSymmetry, type SymmetryReport } from '@/core/symmetry';
import { Badge, Button, Icon } from '@/ui';
import './symmetry.css';

export interface SymmetryPanelProps {
  pattern: Pattern;
  /** Compact = one-line summary with expandable details. Default false. */
  compact?: boolean;
  /** Called when the user picks a round or a defect (to highlight it on a chart). */
  onSelectRound?: (round: number) => void;
  onSelectNodes?: (nodes: number[]) => void;
  className?: string;
  // ---- optional additions ----
  /** A precomputed report (of this pattern's graph); saves recomputing it. */
  report?: SymmetryReport;
  /** Label of the defect action button. Default "Show on chart". */
  showLabel?: string;
}

const cache = new WeakMap<object, SymmetryReport>();
/** Memoised analysis per graph (shared by every panel / chart of the same pattern). */
export function symmetryOf(pattern: Pattern): SymmetryReport {
  let r = cache.get(pattern.graph);
  if (!r) { r = analyzeSymmetry(pattern.graph); cache.set(pattern.graph, r); }
  return r;
}
export function useSymmetry(pattern: Pattern | undefined): SymmetryReport | undefined {
  return useMemo(() => (pattern ? symmetryOf(pattern) : undefined), [pattern]);
}

/** "D12 · 12-fold, mirror" */
export function groupText(r: SymmetryReport): string {
  if (!r.applicable) return 'rows — n/a';
  if (r.order <= 1) return r.mirror ? `${r.group} · mirror only` : `${r.group} · no repeat`;
  return `${r.group} · ${r.order}-fold${r.mirror ? ', mirror' : ''}`;
}

/** A tiny rosette: n petals; mirror-symmetric petals for D_n, swirled ones for C_n. */
export function SymmetryGlyph({ order, mirror, size = 28, className }: { order: number; mirror: boolean; size?: number; className?: string }) {
  const n = Math.max(1, Math.min(order, 36));
  const petals = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 360;
    // petal from the hub outwards; the swirl bends it sideways (chirality)
    const d = mirror || n === 1
      ? 'M0 -3 C 3 -6, 3 -11, 0 -13 C -3 -11, -3 -6, 0 -3 Z'
      : 'M0 -3 C 4 -5, 5 -10, 2 -13 C -1 -11, -2 -7, 0 -3 Z';
    petals.push(<path key={k} d={d} transform={`rotate(${a})`} />);
  }
  return (
    <svg className={`sy-glyph${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="-14 -14 28 28" aria-hidden="true">
      <g className="sy-glyph__petals">{n > 1 ? petals : <path d="M0 -3 C 5 -6, 6 -11, 1 -13 C -3 -11, -4 -6, 0 -3 Z" />}</g>
      <circle r="2.4" className="sy-glyph__hub" />
    </svg>
  );
}

export function SymmetryPanel(props: SymmetryPanelProps) {
  const { pattern, compact = false, onSelectRound, onSelectNodes, className, showLabel = 'Show on chart' } = props;
  const computed = useSymmetry(props.report ? undefined : pattern);
  const r = props.report ?? computed!;
  const [open, setOpen] = useState(!compact);

  if (!r.applicable) {
    return (
      <div className={`sy-panel${className ? ` ${className}` : ''}`}>
        <p className="muted small" style={{ margin: 0 }}>{r.summary[0]}</p>
      </div>
    );
  }
  const head = (
    <div className="sy-head">
      <SymmetryGlyph order={r.order} mirror={r.mirror} size={compact ? 26 : 34} />
      <div className="sy-head__text">
        <Badge tone={r.defects.length ? 'warning' : r.order > 1 ? 'accent' : 'outline'} className="sy-badge">{groupText(r)}</Badge>
        <span className="sy-head__line">{r.summary[1] ?? r.summary[0]}</span>
      </div>
    </div>
  );

  return (
    <div className={`sy-panel${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}>
      {compact ? (
        <button type="button" className="sy-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {head}
          <span className="sy-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
      ) : head}

      {r.defects.length > 0 && (
        <ul className="sy-defects" aria-label="Symmetry defects">
          {r.defects.map((d, i) => (
            <li key={i}>
              <Icon name="alert" size={16} />
              <span className="sy-defects__msg">{d.message}</span>
              {onSelectNodes && <Button size="sm" variant="ghost" onClick={() => onSelectNodes(d.nodes)}>{showLabel}</Button>}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <>
          {r.summary.length > 2 && !compact && (
            <ul className="sy-notes">
              {r.summary.slice(2).filter((l) => !r.defects.some((d) => d.message === l)).map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
          <ol className="sy-rounds" aria-label="Symmetry by round">
            {r.rounds.map((x, i) => {
              const prev = i > 0 ? r.rounds[i - 1].cumulative : undefined;
              const drop = prev !== undefined && (x.cumulative ?? 1) < prev;
              const more = x.order > (x.cumulative ?? 1);
              const Row = onSelectRound ? 'button' : 'div';
              return (
                <li key={x.round} className={drop ? 'is-drop' : undefined}>
                  <Row
                    {...(onSelectRound ? { type: 'button' as const, onClick: () => onSelectRound(x.round) } : {})}
                    className="sy-round"
                    title={`${x.label}: repeats ${x.order}× on its own${x.mirror ? ' (mirror-symmetric)' : ''}; the piece up to here is ${x.cumulative}-fold`}
                  >
                    <span className="sy-round__label">{x.label}</span>
                    <span className="sy-round__bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, (Math.log2((x.cumulative ?? 1) + 1) / Math.log2(r.rounds.reduce((m, y) => Math.max(m, y.order), 2) + 1)) * 100)}%` }} />
                    </span>
                    <span className="sy-round__n">
                      {x.cumulative}-fold{x.cumulativeMirror && x.cumulative! > 1 ? <span className="sy-m" title="mirror"> ⟷</span> : null}
                      {more && <span className="muted"> ({x.order}× own)</span>}
                    </span>
                    {drop && <span className="sy-mark" title={`${x.label} lowers the order from ${prev} to ${x.cumulative}`}>↓{x.cumulative}</span>}
                    {x.defects.length > 0 && <span className="sy-mark sy-mark--defect" title={x.defects[0].message}>≈{x.nearOrder}</span>}
                  </Row>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
export default SymmetryPanel;
