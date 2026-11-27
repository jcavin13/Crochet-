/** Legend: the symbols used in the chart (rounds 0..upto) with US or UK names. */
import { memo, useMemo } from 'react';
import type { Terms } from '@/core/graph';
import { legendEntries, sampleGlyph, type ChartLayout, type ScGlyph, type SymbolSet } from '@/core/chart';

export const ChartLegend = memo(function ChartLegend({ layout, terms, symbolSet = 'cyc', scGlyph = 'x', upto, showFlatness }: {
  layout: ChartLayout; terms: Terms; symbolSet?: SymbolSet; scGlyph?: ScGlyph; upto?: number; showFlatness?: boolean;
}) {
  const entries = useMemo(() => legendEntries(layout, terms, upto), [layout, terms, upto]);
  return (
    <div>
      <ul className="ch-legend" aria-label="Symbols used">
        {entries.map((e) => {
          const g = sampleGlyph(e.spec, { set: symbolSet, sc: scGlyph });
          return (
            <li key={e.key}>
              <svg viewBox="-0.8 -1.75 1.6 3.3" aria-hidden="true">
                {g.stroke && <path d={g.stroke} />}
                {g.fill && <path className="f" d={g.fill} />}
              </svg>
              <span><b>{e.abbr}</b><span className="muted">{e.name}</span></span>
            </li>
          );
        })}
      </ul>
      {showFlatness && layout.mode === 'radial' && (
        <div className="ch-shapekey" aria-label="Flatness band">
          <span><i className="ch-swatch ch-swatch--flat" aria-hidden="true" />lies flat</span>
          <span><i className="ch-swatch ch-swatch--cup" aria-hidden="true" />cups (too few sts)</span>
          <span><i className="ch-swatch ch-swatch--ruffle" aria-hidden="true" />ruffles (too many)</span>
        </div>
      )}
    </div>
  );
});
