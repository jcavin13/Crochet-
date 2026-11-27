/**
 * Standalone SVG export of a chart layout: embedded styles, resolved colours, one element per
 * symbol (`data-sym="<key>"`, `data-node="<id>"`), round labels, the flatness band and a legend.
 * Pure string building — renders the same outside the app.
 */
import type { Terms } from '../graph';
import { boundsUpto } from './layout';
import { glyph, legendEntries, magicRingGlyph, sampleGlyph, type SymbolOptions } from './symbols';
import type { ChartLayout, ChartRound } from './types';

const TAU = Math.PI * 2;

export interface ChartColors {
  bg: string;
  ink: string;
  ink2: string;
  ink3: string;
  alt: string;
  band: string;
  flat: string; cup: string; ruffle: string;
  flatSoft: string; cupSoft: string; ruffleSoft: string;
}

/** Light-theme token values (ui/theme.css). The app passes the live, resolved tokens. */
export const DEFAULT_COLORS: ChartColors = {
  bg: '#fffcf5', ink: '#2a241d', ink2: '#554b3f', ink3: '#7a6e5f', alt: '#2f4f78', band: '#f4efe4',
  flat: '#007a5a', cup: '#0067a3', ruffle: '#c25400',
  flatSoft: '#d4ede4', cupSoft: '#d6e6f3', ruffleSoft: '#f7e0cf',
};

export interface SvgOptions {
  colors?: ChartColors;
  symbols?: SymbolOptions;
  showFlatness?: boolean;
  showLabels?: boolean;
  uptoRound?: number;
  /** Pixels per chart unit for width/height attributes. Default 28. */
  scale?: number;
  title?: string;
  /** Add a legend (and flatness key) below the chart. Default true. */
  legend?: boolean;
  terms?: Terms;
  /** Black-on-white, no tints (print). */
  mono?: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (v: number) => String(Math.round(v * 1000) / 1000);

/** Annulus (r0 < r1) centred on the origin, fill-rule evenodd. */
export function roundBandPath(r0: number, r1: number): string {
  const ring = (r: number) => `M${f(-r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
  return r0 > 1e-6 ? ring(r1) + ring(r0) : ring(r1);
}

/** Radius of a round's top edge at angle θ (follows the ramp of a spiral round). */
export function roundEdge(r: ChartRound, theta: number): number {
  if (!r.spiral) return r.r;
  const frac = (((r.dir * (theta - r.s0)) % TAU) + TAU) % TAU / TAU;
  return r.r + (frac - 0.5) * r.spiral;
}

/** Sample angles over one turn from `base` (direction `dir`), with breakpoints at the rounds' seams. */
function turnAngles(base: number, dir: number, seams: number[], M = 144): number[] {
  const u: number[] = [];
  for (let i = 0; i <= M; i++) u.push((TAU * i) / M);
  for (const s0 of seams) {
    const x = (((dir * (s0 - base)) % TAU) + TAU) % TAU;
    for (const e of [-1e-4, 1e-4]) { const v = x + e; if (v > 0 && v < TAU) u.push(v); }
  }
  u.sort((a, b) => a - b);
  return u.map((v) => base + dir * v);
}

function poly(r: ChartRound, angles: number[], reverse: boolean, close: boolean): string {
  const a = reverse ? [...angles].reverse() : angles;
  const pts = a.map((t) => {
    const rr = roundEdge(r, t);
    return `${f(rr * Math.cos(t))} ${f(-rr * Math.sin(t))}`;
  });
  return `M${pts.join('L')}${close ? 'Z' : ''}`;
}

/** Band of round `k` (between the previous round's edge and its own), as a closed path. */
export function bandPath(layout: ChartLayout, k: number): string {
  const r = layout.rounds[k];
  let prev: ChartRound | undefined;
  for (let j = k - 1; j >= 0; j--) if (layout.rounds[j].first >= 0) { prev = layout.rounds[j]; break; }
  if (!r.spiral && !prev?.spiral) return roundBandPath(prev ? prev.r : 0, r.r);
  const seams = [r.s0, ...(prev ? [prev.s0] : [])];
  const angles = turnAngles(r.s0 + 2e-4 * r.dir, r.dir, seams).slice(0, -1);
  const outer = poly(r, angles, false, true);
  return prev ? outer + poly(prev, angles, true, true) : outer;
}

/** The top edge of a round (circle, or spiral segment). */
export function edgePath(r: ChartRound): string {
  if (!r.spiral) return roundBandPath(0, r.r);
  return poly(r, turnAngles(r.s0 + 2e-4 * r.dir, r.dir, []).slice(0, -1), false, false);
}

export function chartToSvg(layout: ChartLayout, o: SvgOptions = {}): string {
  const C = o.mono ? { ...DEFAULT_COLORS, bg: '#ffffff', ink: '#000000', ink2: '#333333', alt: '#000000' } : (o.colors ?? DEFAULT_COLORS);
  const upto = o.uptoRound ?? layout.rounds.length - 1;
  const scale = o.scale ?? 28;
  const showFlat = (o.showFlatness ?? true) && !o.mono && layout.mode === 'radial';
  const showLabels = o.showLabels ?? true;
  const terms = o.terms ?? 'US';
  const b = boundsUpto(layout, upto, 0.8);
  const chartW = b.maxX - b.minX, chartH = b.maxY - b.minY;
  const entries = o.legend === false ? [] : legendEntries(layout, terms, upto);
  // legend columns sized to the longest entry (≈0.23 units per character at 0.42 font size)
  const entryW = entries.reduce((m, e) => Math.max(m, 1.2 + (e.abbr.length + e.name.length + 1) * 0.22), 4);
  const cols = Math.max(1, Math.floor(chartW / entryW));
  const rowsN = Math.ceil(entries.length / cols);
  const flatRows = showFlat ? (chartW >= 15 ? 1 : 2.4) : 0;
  const titleH = o.title ? 1.4 : 0;
  const legendH = entries.length ? 1.0 + rowsN * 1.5 + flatRows * 1.2 : 0;
  const W = chartW, Hh = chartH + titleH + legendH;
  const x0 = b.minX, y0 = b.minY - titleH;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(W)} ${f(Hh)}" width="${Math.round(W * scale)}" height="${Math.round(Hh * scale)}" role="img" aria-label="${esc(o.title ?? 'Crochet chart')}">`);
  out.push(`<style>
.sym path{fill:none;stroke:${C.ink};stroke-width:0.065;stroke-linecap:round;stroke-linejoin:round}
.sym path.f{fill:${C.ink};stroke:none}
.alt path{stroke:${C.alt}}.alt path.f{fill:${C.alt};stroke:none}
.lbl{font:600 0.42px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;fill:${C.ink2};text-anchor:middle;dominant-baseline:central;paint-order:stroke;stroke:${C.bg};stroke-width:0.14px}
.ttl{font:600 0.7px Georgia,serif;fill:${C.ink}}
.lg{font:0.42px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;fill:${C.ink}}
.lg .n{fill:${C.ink2}}
</style>`);
  out.push(`<rect x="${f(x0)}" y="${f(y0)}" width="${f(W)}" height="${f(Hh)}" fill="${C.bg}"/>`);
  if (o.title) out.push(`<text class="ttl" x="${f(x0 + 0.6)}" y="${f(y0 + 0.95)}">${esc(o.title)}</text>`);

  // bands
  if (layout.mode === 'radial') {
    for (const r of layout.rounds) {
      if (r.first < 0 || r.index > upto || r.r <= r.r0) continue;
      const cls = r.flat?.class;
      if (showFlat && cls && cls !== 'n/a') {
        const fill = cls === 'flat' ? C.flatSoft : cls === 'cup' ? C.cupSoft : C.ruffleSoft;
        const edge = cls === 'flat' ? C.flat : cls === 'cup' ? C.cup : C.ruffle;
        out.push(`<path d="${bandPath(layout, r.index)}" fill="${fill}" fill-rule="evenodd" fill-opacity="${r.index % 2 ? 0.55 : 0.9}"><title>${esc(r.flat!.message)}</title></path>`);
        if (cls !== 'flat') out.push(`<path d="${edgePath(r)}" fill="none" stroke="${edge}" stroke-width="0.06" stroke-dasharray="${cls === 'cup' ? '0.45 0.3' : '0.1 0.2'}" stroke-linecap="round"/>`);
      } else if (!o.mono && r.index % 2 === 1) {
        out.push(`<path d="${bandPath(layout, r.index)}" fill="${C.band}" fill-rule="evenodd"/>`);
      }
    }
  }
  if (layout.ring?.kind === 'magic') {
    const g = magicRingGlyph(layout.ring.r);
    out.push(`<g class="sym" data-sym="mr"><path d="${g.stroke}"/></g>`);
  }
  for (const n of layout.nodes) {
    if (n.round > upto) continue;
    const g = glyph(n, o.symbols);
    const alt = !o.mono && n.round % 2 === 1 ? ' alt' : '';
    out.push(`<g class="sym${alt}" data-sym="${esc(n.symbol.key)}" data-node="${n.id}">${g.stroke ? `<path d="${g.stroke}"/>` : ''}${g.fill ? `<path class="f" d="${g.fill}"/>` : ''}</g>`);
  }
  if (showLabels) {
    for (const r of layout.rounds) {
      if (r.first < 0 || r.index > upto) continue;
      out.push(`<text class="lbl" x="${f(r.labelAt.x)}" y="${f(r.labelAt.y)}">${esc(r.short)}</text>`);
    }
  }
  // legend
  if (entries.length) {
    let y = b.maxY + 0.6;
    const colW = W / cols;
    entries.forEach((e, i) => {
      const cx = x0 + (i % cols) * colW + 0.8;
      const cy = y + Math.floor(i / cols) * 1.5 + 0.7;
      const g = sampleGlyph(e.spec, o.symbols);
      const s = 0.45;
      out.push(`<g class="sym" transform="translate(${f(cx)} ${f(cy)}) scale(${s})">${g.stroke ? `<path d="${g.stroke}" style="stroke-width:${f(0.065 / s)}"/>` : ''}${g.fill ? `<path class="f" d="${g.fill}"/>` : ''}</g>`);
      out.push(`<text class="lg" x="${f(cx + 0.7)}" y="${f(cy + 0.15)}"><tspan font-weight="600">${esc(e.abbr)}</tspan><tspan class="n" dx="0.25">${esc(e.name)}</tspan></text>`);
    });
    y += rowsN * 1.5 + 0.6;
    if (showFlat) {
      const keys: [string, string, string][] = [['flat', C.flatSoft, 'lies flat'], ['cup', C.cupSoft, 'cups (too few stitches)'], ['ruffle', C.ruffleSoft, 'ruffles (too many)']];
      keys.forEach(([, fill, label], i) => {
        const x = x0 + 0.6 + (W >= 15 ? i * (W / 3) : 0);
        if (W < 15 && i > 0) y += 0.7;
        out.push(`<rect x="${f(x)}" y="${f(y)}" width="0.6" height="0.45" fill="${fill}" stroke="${C.ink3}" stroke-width="0.03"/>`);
        out.push(`<text class="lg" x="${f(x + 0.8)}" y="${f(y + 0.35)}">${esc(label)}</text>`);
      });
    }
  }
  out.push('</svg>');
  return out.join('\n');
}
