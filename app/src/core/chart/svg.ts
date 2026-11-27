/**
 * Standalone SVG export of a chart layout: embedded styles, resolved colours, one element per
 * symbol (`data-sym="<key>"`, `data-node="<id>"`), round labels, the flatness band and a legend.
 * Pure string building — renders the same outside the app.
 */
import type { Terms } from '../graph';
import { framePath } from './frames';
import { boundsUpto } from './layout';
import { glyph, legendEntries, magicRingGlyph, sampleGlyph, type SymbolOptions } from './symbols';
import type { ChartLayout, ChartRound } from './types';
import type { WedgeView } from './wedge';

const TAU = Math.PI * 2;

/** What the chart says about a pointed round instead of flat / cup / ruffle. */
export const POINTED_NOTE = 'pointed round — judged by blocking';
/** Legend text of a pointed round's dashed outline. */
export const POINTED_KEY = 'pointed round: pin the tips and valleys out to the dashed star — judged by blocking, not by the flatness rule';

/** "One repeat of 6 — work it 6 times" (one-arm / one-repeat view). */
export function wedgeNote(w: Pick<WedgeView, 'kind' | 'order'>): string {
  if (w.kind === 'corner') return 'Corner detail — all four corners are worked alike';
  return `${w.kind === 'arm' ? 'One arm' : 'One repeat'} of ${w.order} — work it ×${w.order}`;
}

/** What the chart says about border rounds (worked round a body in rows): the rules their band shows. */
export const BORDER_NOTE = 'border rounds — judged by the edge fit (each side) and the corner rule (each corner)';

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
  /** Draw one repeat wedge enlarged (`wedgeView`) instead of the whole piece. */
  wedge?: WedgeView | null;
  /** In the wedge view: draw the rest faintly (default) or leave it out (default in mono). */
  ghost?: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (v: number) => String(Math.round(v * 1000) / 1000);

const ringPath = (r: number) => `M${f(-r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;

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

/** Blocking outline of a pointed round (through the arm tips and the valley pins), closed; '' if none. */
export function hullPath(r: ChartRound): string {
  const h = r.hull ?? [];
  if (h.length < 3) return '';
  return `M${h.map((p) => `${f(p.x)} ${f(p.y)}`).join('L')}Z`;
}

/** One-repeat view (layout rotated, arm up): the outline next to the arm only, open. */
export function wedgeHullPath(r: ChartRound, half: number): string {
  const near = (p: { x: number; y: number }) => Math.abs(Math.atan2(-p.y, p.x) - Math.PI / 2) <= half * 1.15 + 1e-6;
  const pts = (r.hull ?? []).filter(near).sort((a, b) => Math.atan2(-b.y, b.x) - Math.atan2(-a.y, a.x));
  if (pts.length < 2) return '';
  return `M${pts.map((p) => `${f(p.x)} ${f(p.y)}`).join('L')}`;
}

/** Outline of a pointed round (its arms' star hull), closed. */
export function outlinePath(r: ChartRound): string {
  const o = r.outline ?? [];
  if (!o.length) return roundBandPath(0, r.rOuter);
  const pts = o.map((rr, i) => { const t = (TAU * i) / o.length; return `${f(rr * Math.cos(t))} ${f(-rr * Math.sin(t))}`; });
  return `M${pts.join('L')}Z`;
}

/** Band of round `k` (between the previous round's edge and its own), as a closed path; a pointed round's is its outline. */
export function bandPath(layout: ChartLayout, k: number): string {
  const r = layout.rounds[k];
  if (r.pointed) {
    let prev: ChartRound | undefined;
    for (let j = k - 1; j >= 0; j--) if (layout.rounds[j].first >= 0) { prev = layout.rounds[j]; break; }
    return outlinePath(r) + (prev && !prev.pointed ? ringPath(prev.r) : '');
  }
  // a border round (round a body in rows): between its own and the round below's offset of the body's rectangle
  if (r.border && r.frame) return framePath(r.frame, r.r) + framePath(r.frame, Math.max(0, r.r0));
  let prev: ChartRound | undefined;
  for (let j = k - 1; j >= 0; j--) if (layout.rounds[j].first >= 0) { prev = layout.rounds[j]; break; }
  if (r.frame || prev?.frame) {
    // a polygon / stadium round: its band has the round's shape
    const outer = r.frame ? framePath(r.frame, r.r) : ringPath(r.r);
    const inner = !prev || prev.r <= 1e-6 ? '' : prev.frame ? framePath(prev.frame, prev.r) : ringPath(prev.r);
    return outer + inner;
  }
  if (!r.spiral && !prev?.spiral) return roundBandPath(prev ? prev.r : 0, r.r);
  const seams = [r.s0, ...(prev ? [prev.s0] : [])];
  const angles = turnAngles(r.s0 + 2e-4 * r.dir, r.dir, seams).slice(0, -1);
  const outer = poly(r, angles, false, true);
  return prev ? outer + poly(prev, angles, true, true) : outer;
}

/** The top edge of a round (circle, or spiral segment). */
export function edgePath(r: ChartRound): string {
  if (r.frame) return framePath(r.frame, r.r);
  if (!r.spiral) return roundBandPath(0, r.r);
  return poly(r, turnAngles(r.s0 + 2e-4 * r.dir, r.dir, []).slice(0, -1), false, false);
}

function wrapWords(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) { if ((cur + ' ' + w).trim().length > perLine) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  return lines;
}

export function chartToSvg(full: ChartLayout, o: SvgOptions = {}): string {
  const C = o.mono ? { ...DEFAULT_COLORS, bg: '#ffffff', ink: '#000000', ink2: '#333333', ink3: '#777777', alt: '#000000' } : (o.colors ?? DEFAULT_COLORS);
  const W8 = o.wedge ?? null;
  const layout = W8 ? W8.layout : full;
  const ghost = W8 ? (o.ghost ?? !o.mono) : false;
  const upto = o.uptoRound ?? layout.rounds.length - 1;
  const scale = o.scale ?? 28;
  const showFlat = (o.showFlatness ?? true) && !o.mono && (layout.mode === 'radial' || layout.rounds.some((r) => r.border && r.flat && r.flat.class !== 'n/a'));
  const showLabels = o.showLabels ?? true;
  const terms = o.terms ?? 'US';
  const b = W8 ? { ...W8.bounds } : boundsUpto(layout, upto, 0.8);
  if (W8) {
    // a narrow wedge: room for its title and note
    const need = Math.max(wedgeNote(W8).length * 0.23 + 1.4, (o.title?.length ?? 0) * 0.36 + 1.4, 9);
    const w0 = b.maxX - b.minX;
    if (w0 < need) { b.minX -= (need - w0) / 2; b.maxX += (need - w0) / 2; }
  }
  const chartW = b.maxX - b.minX, chartH = b.maxY - b.minY;
  const entries = o.legend === false ? [] : legendEntries(layout, terms, upto);
  // legend columns sized to the longest entry (≈0.23 units per character at 0.42 font size)
  const entryW = entries.reduce((m, e) => Math.max(m, 1.2 + (e.abbr.length + e.name.length + 1) * 0.22), 4);
  const cols = Math.max(1, Math.floor(chartW / entryW));
  const rowsN = Math.ceil(entries.length / cols);
  const looseKey = showFlat && layout.rounds.some((r) => r.flat?.slackOnly && !r.pointed && r.index <= upto);
  const anyPointed = layout.mode === 'radial' && layout.rounds.some((r) => r.pointed && r.first >= 0 && r.index <= upto);
  const flatRows = showFlat ? (chartW >= 15 ? 1 : 2.4 + (looseKey ? 0.6 : 0)) : 0;
  const keyLines = anyPointed ? wrapWords(POINTED_KEY, Math.max(20, Math.floor((chartW - 2) / 0.22))) : [];
  const anyBorder = layout.rounds.some((r) => r.border && r.first >= 0 && r.index <= upto);
  const borderLines = anyBorder && entries.length ? wrapWords(`R1, R2… ${BORDER_NOTE}`, Math.max(20, Math.floor((chartW - 2) / 0.22))) : [];
  const pointedRows = (entries.length ? keyLines.length + 0.4 : 0) + (borderLines.length ? borderLines.length + 0.3 : 0);
  const titleH = (o.title ? 1.4 : 0) + (W8 ? 0.9 : 0);
  const legendH = entries.length ? 1.0 + rowsN * 1.5 + flatRows * 1.2 + pointedRows * 0.7 : 0;
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
  if (W8) out.push(`<text class="lg" data-wedge="${W8.order}" x="${f(x0 + 0.6)}" y="${f(y0 + (o.title ? 1.4 : 0) + 0.6)}"><tspan font-weight="600">${esc(wedgeNote(W8))}</tspan></text>`);

  // bands ("flat (loose loops)" rounds get a hatch over the flat tint)
  const anyLoose = looseKey;
  if (anyLoose) {
    out.push(`<defs><pattern id="loose" patternUnits="userSpaceOnUse" width="0.32" height="0.32" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="0.32" stroke="${C.flat}" stroke-width="0.07" stroke-opacity="0.55"/></pattern></defs>`);
  }
  if (layout.mode === 'rows' && showFlat) {
    // a body in rows with a border: the border rounds' bands, round the body's rectangle
    for (const r of layout.rounds) {
      if (!r.border || !r.frame || r.first < 0 || r.index > upto) continue;
      const cls = r.flat?.class;
      if (!cls || cls === 'n/a') continue;
      const fill = cls === 'flat' ? C.flatSoft : cls === 'cup' ? C.cupSoft : C.ruffleSoft;
      const edge = cls === 'flat' ? C.flat : cls === 'cup' ? C.cup : C.ruffle;
      out.push(`<path data-band="${r.index}" d="${bandPath(layout, r.index)}" fill="${fill}" fill-rule="evenodd" fill-opacity="${r.index % 2 ? 0.55 : 0.9}"><title>${esc(r.flat!.message)}</title></path>`);
      if (cls !== 'flat') out.push(`<path d="${framePath(r.frame, r.r)}" fill="none" stroke="${edge}" stroke-width="0.06" stroke-dasharray="${cls === 'cup' ? '0.45 0.3' : '0.1 0.2'}" stroke-linecap="round"/>`);
    }
  }
  if (layout.mode === 'radial') {
    for (const r of layout.rounds) {
      if (r.first < 0 || r.index > upto) continue;
      if (r.pointed) {
        // judged by blocking, not by the circle rule: no tint (a filled star reads as a flower), only
        // the faint dashed outline it is pinned out to — through the arm tips and the valley pins
        const d = W8 ? wedgeHullPath(r, W8.half) : hullPath(r);
        if (d) out.push(`<path data-hull="${r.index}" d="${d}" fill="none" stroke="${C.ink3}" stroke-opacity="0.55" stroke-width="0.035" stroke-dasharray="0.26 0.2" stroke-linecap="round" stroke-linejoin="round"><title>${esc(`${r.label}: ${POINTED_NOTE}`)}</title></path>`);
        continue;
      }
      if (r.r <= r.r0) continue;
      const cls = r.flat?.class;
      if (showFlat && cls && cls !== 'n/a') {
        const fill = cls === 'flat' ? C.flatSoft : cls === 'cup' ? C.cupSoft : C.ruffleSoft;
        const edge = cls === 'flat' ? C.flat : cls === 'cup' ? C.cup : C.ruffle;
        out.push(`<path d="${bandPath(layout, r.index)}" fill="${fill}" fill-rule="evenodd" fill-opacity="${r.index % 2 ? 0.55 : 0.9}"><title>${esc(r.flat!.message)}</title></path>`);
        if (cls === 'flat' && r.flat!.slackOnly) out.push(`<path d="${bandPath(layout, r.index)}" fill="url(#loose)" fill-rule="evenodd"/>`);
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
    const lvl = W8 ? W8.inside[n.id] : 2;
    if (lvl === 0 && !ghost) continue;
    const g = glyph(n, o.symbols);
    const alt = !o.mono && n.round % 2 === 1 ? ' alt' : '';
    out.push(`<g class="sym${alt}" data-sym="${esc(n.symbol.key)}" data-node="${n.id}"${lvl === 2 ? '' : ` opacity="${lvl === 1 ? 0.4 : 0.12}"`}>${g.stroke ? `<path d="${g.stroke}"/>` : ''}${g.fill ? `<path class="f" d="${g.fill}"/>` : ''}</g>`);
  }
  if (showLabels) {
    if (W8) {
      for (const l of W8.labels) out.push(`<text class="lbl" x="${f(l.x)}" y="${f(l.y)}">${esc(l.text)}</text>`);
    } else {
      for (const r of layout.rounds) {
        if (r.first < 0 || r.index > upto) continue;
        out.push(`<text class="lbl" x="${f(r.labelAt.x)}" y="${f(r.labelAt.y)}">${esc(r.short)}</text>`);
      }
    }
  }
  // legend
  if (entries.length) {
    // (one-repeat / corner views: the rest of the piece, ghosted, does not run on under the legend)
    if (W8) out.push(`<rect x="${f(x0)}" y="${f(b.maxY)}" width="${f(W)}" height="${f(y0 + Hh - b.maxY)}" fill="${C.bg}"/>`);
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
      if (anyLoose) keys.splice(1, 0, ['loose', C.flatSoft, 'flat (loose loops)']);
      keys.forEach(([key, fill, label], i) => {
        const x = x0 + 0.6 + (W >= 15 ? i * (W / keys.length) : 0);
        if (W < 15 && i > 0) y += 0.7;
        out.push(`<rect x="${f(x)}" y="${f(y)}" width="0.6" height="0.45" fill="${fill}" stroke="${C.ink3}" stroke-width="0.03"/>`);
        if (key === 'loose') out.push(`<rect x="${f(x)}" y="${f(y)}" width="0.6" height="0.45" fill="url(#loose)"/>`);
        out.push(`<text class="lg" x="${f(x + 0.8)}" y="${f(y + 0.35)}">${esc(label)}</text>`);
      });
      y += 0.7;
    }
    if (anyPointed) {
      // the dashed outline of a pointed round, wrapped to the chart's width
      const lines = keyLines;
      const x = x0 + 0.6;
      out.push(`<path d="M${f(x)} ${f(y + 0.22)}h0.6" stroke="${C.ink3}" stroke-width="0.05" stroke-dasharray="0.16 0.1"/>`);
      lines.forEach((l, i) => out.push(`<text class="lg" x="${f(x + 0.8)}" y="${f(y + 0.35 + i * 0.6)}">${esc(l)}</text>`));
      y += lines.length * 0.6 + 0.3;
    }
    if (borderLines.length) {
      borderLines.forEach((l, i) => out.push(`<text class="lg" data-border-note="1" x="${f(x0 + 0.6)}" y="${f(y + 0.35 + i * 0.6)}">${esc(l)}</text>`));
    }
  }
  out.push('</svg>');
  return out.join('\n');
}
