import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compilePattern } from '../notation';
import { paramsFor } from '../params';
import { chartToSvg, glyph, hatchesOf, layoutChart, legendEntries, sampleGlyph, symbolOf } from './index';

const fixDir = fileURLToPath(new URL('../../../../spec/fixtures/', import.meta.url));
const load = (f: string) => compilePattern(readFileSync(fixDir + f, 'utf8')).pattern!;
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('chartToSvg', () => {
  const p = load('simple_doily.cro');
  const L = layoutChart(p.graph, paramsFor(p));
  const g = p.graph;
  const svg = chartToSvg(L, { title: 'Simple doily' });

  it('emits one element per symbol with its key', () => {
    const by = (pred: (n: (typeof g.nodes)[number]) => boolean) => g.nodes.filter(pred).length;
    expect(count(svg, 'data-sym="dc"')).toBe(by((n) => n.type === 'dc'));
    expect(count(svg, 'data-sym="sc"')).toBe(by((n) => n.type === 'sc'));
    expect(count(svg, 'data-sym="ch"')).toBe(by((n) => n.type === 'ch'));
    expect(count(svg, 'data-sym="slst"')).toBe(by((n) => n.type === 'slst'));
    expect(count(svg, 'data-sym="picot"')).toBe(16);
    expect(count(svg, 'data-node="')).toBe(g.nodes.length);
  });

  it('is standalone: namespace, size, embedded styles, resolved colours', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toMatch(/width="\d+" height="\d+"/);
    expect(svg).toContain('<style>');
    expect(svg).not.toContain('var(--');
    expect(svg).toContain('Simple doily');
    // legend lists the symbols with names
    expect(svg).toContain('double crochet');
    expect(svg).toContain('lies flat');
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });

  it('honours uptoRound, UK names and print mode', () => {
    const two = chartToSvg(L, { uptoRound: 1, legend: false });
    const nodesUpTo1 = g.rounds[1].last + 1;
    expect(count(two, 'data-node="')).toBe(nodesUpTo1);
    expect(count(two, 'data-sym="sc"')).toBe(0);
    const uk = chartToSvg(L, { terms: 'UK' });
    expect(uk).toContain('treble crochet');
    const mono = chartToSvg(L, { mono: true });
    expect(mono).not.toContain('fill-opacity');
  });

  it('draws a magic ring for mr patterns', () => {
    const q = load('flat_sc_circle.cro');
    const s = chartToSvg(layoutChart(q.graph, paramsFor(q)));
    expect(count(s, 'data-sym="mr"')).toBe(1);
    expect(count(s, 'data-sym="sc"')).toBe(q.graph.nodes.filter((n) => n.type === 'sc').length);
  });
});

describe('symbols', () => {
  it('one hatch per yarn-over, from the stitch height', () => {
    expect(['sc', 'hdc', 'dc', 'tr', 'dtr'].map((t) => hatchesOf(t as 'dc'))).toEqual([0, 0, 1, 2, 3]);
    // stem + top bar + hatches = number of strokes
    for (const [t, strokes] of [['hdc', 2], ['dc', 3], ['tr', 4], ['dtr', 5]] as const) {
      const spec = symbolOf({ id: 0, type: t, round: 0, into: [{ node: 0 }] });
      expect(count(sampleGlyph(spec).stroke, 'M'), t).toBe(strokes);
    }
  });

  it('decreases join their legs at the top; clusters fan from one place', () => {
    const tog = symbolOf({ id: 0, type: 'dc', round: 0, into: [{ node: 1 }, { node: 2 }, { node: 3 }] });
    expect(tog.key).toBe('dc3tog');
    expect(count(sampleGlyph(tog).stroke, 'L')).toBe(3 + 3 + 1); // 3 legs, 3 hatches, 1 bar
    const cl = symbolOf({ id: 0, type: 'tr', round: 0, into: [{ node: 1 }, { node: 1 }, { node: 1 }], tag: 'cluster' });
    expect(cl.key).toBe('tr3cl');
    expect(count(sampleGlyph(cl).stroke, 'Q')).toBe(3);
  });

  it('CYC and JIS differ where documented', () => {
    const slst = symbolOf({ id: 0, type: 'slst', round: 0, into: [{ node: 0 }] });
    const cyc = sampleGlyph(slst, { set: 'cyc' }).fill, jis = sampleGlyph(slst, { set: 'jis' }).fill;
    expect(cyc).not.toBe(jis);
    const puff = symbolOf({ id: 0, type: 'puff', round: 0, into: [{ node: 0 }], loops: 3 });
    expect(sampleGlyph(puff, { set: 'cyc' }).fill).toBe('');
    expect(sampleGlyph(puff, { set: 'jis' }).fill).not.toBe('');
    const sc = symbolOf({ id: 0, type: 'sc', round: 0, into: [{ node: 0 }] });
    expect(sampleGlyph(sc, { sc: 'x' }).stroke).not.toBe(sampleGlyph(sc, { sc: 'plus' }).stroke);
  });

  it('legend lists the symbols used, in US and UK', () => {
    const p = load('chain_space_motif.cro');
    const L = layoutChart(p.graph, paramsFor(p));
    const us = legendEntries(L, 'US').map((e) => e.abbr);
    expect(us).toEqual(['mr', 'ch', 'sl st', 'sc']);
    const uk = legendEntries(L, 'UK');
    expect(uk.map((e) => e.abbr)).toEqual(['mr', 'ch', 'ss', 'dc']);
    expect(uk.find((e) => e.abbr === 'dc')!.name).toBe('double crochet');
    for (const n of L.nodes) expect(glyph(n).stroke + glyph(n).fill).not.toBe('');
  });
});
