/** Legend: the symbols used in the chart (rounds 0..upto) with US or UK names. */
import { memo, useMemo } from 'react';
import type { Terms } from '@/core/graph';
import { BORDER_NOTE, legendEntries, sampleGlyph, type ChartLayout, type ScGlyph, type SymbolSet } from '@/core/chart';

export const ChartLegend = memo(function ChartLegend({ layout, terms, symbolSet = 'cyc', scGlyph = 'x', upto, showFlatness }: {
  layout: ChartLayout; terms: Terms; symbolSet?: SymbolSet; scGlyph?: ScGlyph; upto?: number; showFlatness?: boolean;
}) {
  const entries = useMemo(() => legendEntries(layout, terms, upto), [layout, terms, upto]);
  const loose = layout.rounds.some((r) => r.flat?.slackOnly && !r.pointed && (upto === undefined || r.index <= upto));
  const pointed = layout.rounds.some((r) => r.pointed && r.first >= 0 && (upto === undefined || r.index <= upto));
  const border = layout.rounds.some((r) => r.border && r.first >= 0 && (upto === undefined || r.index <= upto));
  return (
    <div>
      <ul className="ch-legend" aria-label="Symbols used">
        {entries.map((e) => {
          const g = sampleGlyph(e.spec, { set: symbolSet, sc: scGlyph });
          const small = e.key === 'mr' ? '-0.85 -1.2 1.7 2.5' : ['ch', 'slst', 'picot'].includes(e.spec.base) || (e.spec.base === 'sc' && e.spec.legs === 1) ? '-0.55 -0.8 1.1 1.6' : '-0.75 -1.6 1.5 3.1';
          return (
            <li key={e.key}>
              <svg viewBox={small} aria-hidden="true">
                {g.stroke && <path d={g.stroke} />}
                {g.fill && <path className="f" d={g.fill} />}
              </svg>
              <span><b>{e.abbr}</b><span className="muted">{e.name}</span></span>
            </li>
          );
        })}
      </ul>
      {pointed && (
        <p className="ch-shapekey" aria-label="Pointed round">
          <span title="The arms stand off the circle (chain spines, pointed loops): such a round is stiffened and pinned out, so it is judged by how it blocks, not by the circle rule.">
            <i className="ch-swatch ch-swatch--pointed" aria-hidden="true" />pointed round: pin the arm tips and the valleys out to the dashed star — judged by blocking
          </span>
        </p>
      )}
      {border && (
        <p className="ch-shapekey" aria-label="Border rounds">
          <span title="Rounds worked round the rows (R1, R2…): flatness does not apply; the blanket studio checks how the border fits the edges and corners.">
            R1, R2… {BORDER_NOTE}
          </span>
        </p>
      )}
      {showFlatness && layout.mode === 'radial' && (
        <div className="ch-shapekey" aria-label="Flatness band">
          <span><i className="ch-swatch ch-swatch--flat" aria-hidden="true" />lies flat</span>
          {loose && (
            <span title="Flat by the count rule only if the chain loops sag or stretch to take up the difference — expect long, floppy (or strained) loops.">
              <i className="ch-swatch ch-swatch--loose" aria-hidden="true" />flat (loose loops)
            </span>
          )}
          <span><i className="ch-swatch ch-swatch--cup" aria-hidden="true" />cups (too few sts)</span>
          <span><i className="ch-swatch ch-swatch--ruffle" aria-hidden="true" />ruffles (too many)</span>
        </div>
      )}
    </div>
  );
});
