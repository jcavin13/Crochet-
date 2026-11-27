// Blanket swatches on the chart page from a link (#/chart?blanket=…).
import { describe, expect, it } from 'vitest';
import { layoutChart } from '@/core/chart';
import { specFromQuery, swatchFromQuery } from './swatch';

const q = (s: string) => new URLSearchParams(s);

describe('chart ?blanket= links', () => {
  it('a body in rows with its border', () => {
    const sw = swatchFromQuery(q('blanket=rect:dc:sc,shell'))!;
    expect(sw).toBeTruthy();
    expect(sw.pattern.graph.rounds.some((r) => r.kind === 'row')).toBe(true);
    expect(layoutChart(sw.pattern.graph, sw.params).shape?.kind).toBe('border');
  });
  it('a piece in the round, a demo, a small whole blanket', () => {
    expect(layoutChart(swatchFromQuery(q('blanket=round:granny-square:granny'))!.pattern.graph, swatchFromQuery(q('blanket=round:granny-square:granny'))!.params).shape?.kind).toBe('polygon');
    expect(specFromQuery(q('blanket=demo:hexagon'))?.round.style).toBe('hexagon');
    const full = swatchFromQuery(q('blanket=round:circle-to-square:dc,hdc&full=1&w=30'))!;
    expect(full.pattern.graph.rounds.length).toBeGreaterThan(8);
  });
  it('unknown designs are refused', () => {
    expect(specFromQuery(q('blanket=rect:nope:sc'))).toBeNull();
    expect(specFromQuery(q('blanket=rect:dc:lace-of-dreams'))).toBeNull();
    expect(specFromQuery(q('blanket=round:dodecagon'))).toBeNull();
    expect(specFromQuery(q('blanket=demo:missing'))).toBeNull();
    expect(swatchFromQuery(q('blanket='))).toBeNull();
  });
});
