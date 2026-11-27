/**
 * Printable blocking templates (SVG in millimetres, so it prints at 100 % = actual size).
 *
 *   snowflakeTemplateSvg(result)   n radial guide lines through the points, rings at the body,
 *                                  valley and tip radii, the predicted outline, pin marks at tips,
 *                                  branch tips and valleys, a 5 cm scale bar and a "print at 100 %" note
 *   doilyTemplateSvg(result)       rings at every round's radius, n sector lines, pins around the edge
 *
 * Element classes are stable (`guide`, `ring`, `outline`, `pin`, `scale`) so tests can count them.
 */
import type { GenerateResult } from '../types';
import type { BlockedShape, SnowflakeResult } from './types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const f = (x: number) => (Math.round(x * 100) / 100).toString();

interface Frame { R: number; title: string; sub: string }

function frame({ R, title, sub }: Frame, body: string): string {
  const margin = 14;
  const half = R + margin;
  const w = 2 * half, top = 22, bottom = 34;
  const h = w + top + bottom;
  // scale bar: 50 mm, bottom left; the print note below it
  const sx = -half + 8, sy = half + 10;
  const scale = `<g class="scale"><line x1="${f(sx)}" y1="${f(sy)}" x2="${f(sx + 50)}" y2="${f(sy)}" stroke="#000" stroke-width="0.6"/>`
    + [0, 10, 20, 30, 40, 50].map((t) => `<line x1="${f(sx + t)}" y1="${f(sy - (t % 50 ? 1.5 : 2.5))}" x2="${f(sx + t)}" y2="${f(sy)}" stroke="#000" stroke-width="0.4"/>`).join('')
    + `<text x="${f(sx + 25)}" y="${f(sy + 5)}" font-size="3.5" text-anchor="middle" font-family="sans-serif">5 cm</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" viewBox="${f(-half)} ${f(-half - top)} ${f(w)} ${f(h)}">`
    + `<rect class="paper" x="${f(-half)}" y="${f(-half - top)}" width="${f(w)}" height="${f(h)}" fill="#fff"/>`
    + `<text x="${f(-half + 8)}" y="${f(-half - top + 8)}" font-size="5" font-family="sans-serif" font-weight="bold">${esc(title)}</text>`
    + `<text x="${f(-half + 8)}" y="${f(-half - top + 14)}" font-size="3.2" font-family="sans-serif">${esc(sub)}</text>`
    + body + scale
    + `<text class="note" x="${f(sx)}" y="${f(sy + 12)}" font-size="3.2" font-family="sans-serif">Print at 100 % (actual size, no "fit to page"): the bar must measure 5 cm.</text>`
    + `<text x="${f(sx)}" y="${f(sy + 17)}" font-size="3" font-family="sans-serif" fill="#555">Pin through the marks onto foam board under cling film; stiffen and let dry.</text>`
    + '</svg>';
}

const pinMark = (x: number, y: number, kind: string) =>
  `<g class="pin" data-kind="${kind}"><circle cx="${f(x)}" cy="${f(y)}" r="1.2" fill="none" stroke="#c0392b" stroke-width="0.4"/><line x1="${f(x - 1.8)}" y1="${f(y)}" x2="${f(x + 1.8)}" y2="${f(y)}" stroke="#c0392b" stroke-width="0.3"/><line x1="${f(x)}" y1="${f(y - 1.8)}" x2="${f(x)}" y2="${f(y + 1.8)}" stroke="#c0392b" stroke-width="0.3"/></g>`;

const ring = (r: number, dash = '') => `<circle class="ring" cx="0" cy="0" r="${f(r)}" fill="none" stroke="#888" stroke-width="0.3"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

function guides(n: number, R: number, offset = 0): string {
  let s = '';
  for (let k = 0; k < n; k++) {
    const a = ((k + offset) * 2 * Math.PI) / n;
    s += `<line class="guide" x1="0" y1="0" x2="${f(R * Math.sin(a))}" y2="${f(-R * Math.cos(a))}" stroke="#2c7fb8" stroke-width="0.35"/>`;
  }
  return s;
}

/** The pin-out template of a snowflake at 100 % scale. */
export function snowflakeTemplateSvg(res: Pick<SnowflakeResult, 'shape' | 'spec'> & { title?: string }): string {
  const sh: BlockedShape = res.shape;
  const R = sh.tipR + 4;
  const outline = sh.outline.length ? `<path class="outline" d="M${sh.outline.map((p) => `${f(p.x)} ${f(p.y)}`).join(' L')} Z" fill="none" stroke="#111" stroke-width="0.4" stroke-dasharray="1.5 1"/>` : '';
  const body = guides(sh.points, R)
    + ring(sh.bodyR, '1 1') + ring(sh.valleyR, '2 1') + ring(sh.tipR)
    + (sh.minorTipR ? ring(sh.minorTipR, '0.6 1.2') : '')
    + `<circle cx="0" cy="0" r="0.8" fill="#000"/>`
    + outline
    + sh.pins.map((p) => pinMark(p.p.x, p.p.y, p.kind)).join('');
  const cm = (mm: number) => (mm / 10).toFixed(1);
  return frame({
    R, title: res.title ?? 'Snowflake blocking template',
    sub: `${sh.points} points · tips ${cm(sh.tipR)} cm from centre · valleys ${cm(sh.valleyR)} cm · ${cm(sh.acrossMm)} cm across · ${sh.pins.length} pins`,
  }, body);
}

/** The same kind of template for a doily: a ring at each round, n sector lines, pins round the edge. */
export function doilyTemplateSvg(res: GenerateResult, title = 'Doily blocking template'): string {
  const rounds = res.rounds;
  const outer = rounds[rounds.length - 1];
  const n = outer?.repeats ?? 6;
  const Rout = outer?.r ?? 10;
  const R = Rout + 4;
  let body = guides(n, R);
  for (const r of rounds) body += ring(r.r, r === outer ? '' : '1 1');
  body += `<circle cx="0" cy="0" r="0.8" fill="#000"/>`;
  // pins at the outer edge: one on each sector line and one midway
  for (let k = 0; k < 2 * n; k++) {
    const a = (k * Math.PI) / n;
    body += pinMark(Rout * Math.sin(a), -Rout * Math.cos(a), k % 2 ? 'edge' : 'point');
  }
  return frame({ R, title, sub: `${n} repeats · ${rounds.length} rounds · ${(2 * Rout / 10).toFixed(1)} cm across (outer ring) · ${2 * n} pins` }, body);
}
