// Small hand-drawn SVGs: stitch-pattern texture thumbnails (from the stitch layout of each
// pattern, not from the chart renderer) and the border corner close-up.
import type { BlanketDesign, PaletteColor, ThumbKind } from '@/core/blanket';

const S = 'currentColor';

/** A few rows of the stitch pattern, drawn with chart-like marks. */
export function StitchThumb({ kind, size = 64 }: { kind: ThumbKind; size?: number }) {
  const rows: React.ReactNode[] = [];
  const W = 64, H = 64;
  const x = (c: number, n: number) => 4 + (c + 0.5) * ((W - 8) / n);
  const add = (n: React.ReactNode) => rows.push(n);
  const stitchMark = (cx: number, y: number, h: number, t: 'sc' | 'hdc' | 'dc', k: string) => {
    if (t === 'sc') add(<path key={k} d={`M${cx - 2.5} ${y - 2.5}l5 5M${cx + 2.5} ${y - 2.5}l-5 5`} />);
    else add(<path key={k} d={`M${cx} ${y + h / 2}V${y - h / 2}M${cx - 3} ${y - h / 2}h6${t === 'dc' ? `M${cx - 2} ${y + 1}l4 -2` : ''}`} />);
  };
  switch (kind) {
    case 'sc': case 'hdc': case 'dc': {
      const n = 6, rh = kind === 'sc' ? 9 : kind === 'hdc' ? 12 : 16;
      for (let r = 0; r * rh < H - 6; r++) for (let c = 0; c < n; c++) stitchMark(x(c, n), H - 6 - r * rh - rh / 2, rh - 4, kind, `${r}-${c}`);
      break;
    }
    case 'moss':
      for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
        const cx = x(c, 7), y = H - 8 - r * 9;
        if ((c + r) % 2 === 0) stitchMark(cx, y, 5, 'sc', `${r}-${c}`);
        else add(<ellipse key={`${r}-${c}`} cx={cx} cy={y} rx={3} ry={1.6} />);
      }
      break;
    case 'griddle':
      for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) stitchMark(x(c, 6), H - 10 - r * 14, 10, (c + r) % 2 ? 'dc' : 'sc', `${r}-${c}`);
      break;
    case 'granny':
      for (let r = 0; r < 4; r++) for (let g = 0; g < 3; g++) {
        const cx = 10 + g * 20 + (r % 2 ? 10 : 0), y0 = H - 6 - r * 15;
        if (cx > W - 6) continue;
        add(<path key={`${r}-${g}`} d={`M${cx} ${y0}L${cx - 5} ${y0 - 12}M${cx} ${y0}V${y0 - 12}M${cx} ${y0}L${cx + 5} ${y0 - 12}`} />);
      }
      break;
    case 'v':
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        const cx = 10 + c * 15, y0 = H - 6 - r * 15;
        add(<path key={`${r}-${c}`} d={`M${cx} ${y0}L${cx - 4} ${y0 - 12}M${cx} ${y0}L${cx + 4} ${y0 - 12}`} />);
      }
      break;
    case 'shell':
      for (let r = 0; r < 4; r++) for (let g = 0; g < 3; g++) {
        const cx = 8 + g * 22 + (r % 2 ? 11 : 0), y0 = H - 6 - r * 14;
        if (cx > W - 4) continue;
        add(<path key={`${r}-${g}`} d={[-2, -1, 0, 1, 2].map((k) => `M${cx} ${y0}L${cx + k * 3.6} ${y0 - 12 + Math.abs(k)}`).join('')} />);
      }
      break;
    case 'mesh':
      for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) add(<rect key={`${r}-${c}`} x={5 + c * 11.5} y={5 + r * 14} width={8} height={10} rx={1} />);
      break;
    case 'ripple':
      for (let r = 0; r < 6; r++) add(<path key={r} d={`M2 ${12 + r * 9}l10 -6l10 6l10 -6l10 6l10 -6l10 6`} />);
      break;
    case 'bobble':
      for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
        const cx = x(c, 6), y = H - 7 - r * 9.5;
        if (r % 2 === 1 && c % 2 === 1) add(<ellipse key={`${r}-${c}`} cx={cx} cy={y} rx={3.6} ry={4} fill={S} fillOpacity="0.35" />);
        else stitchMark(cx, y, 5, 'sc', `${r}-${c}`);
      }
      break;
  }
  return (
    <svg className="bk-thumb" width={size} height={size} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <g fill="none" stroke={S} strokeWidth="1.4" strokeLinecap="round">{rows}</g>
    </svg>
  );
}

/** Stitches of the corner group from its notation text: "3 sc in corner", "(2 dc, ch 2, 2 dc) in corner". */
export function cornerGroupOf(text: string): { sts: number; ch: number; st: string } | undefined {
  const m = /(\(([^()]*)\)|(\d+ )?(sc|hdc|dc|tr)(?: blo)?) in (?:corner|next ch-\d+ sp|next st)/.exec(text);
  if (!m) return undefined;
  const inner = m[2] ?? m[1];
  let sts = 0, ch = 0, st = 'sc';
  for (const part of inner.split(',')) {
    const p = part.trim();
    const c = /^ch (\d+)/.exec(p);
    if (c) { ch += +c[1]; continue; }
    const s = /^(\d+ )?(sc|hdc|dc|tr)/.exec(p);
    if (s) { sts += s[1] ? +s[1] : 1; st = s[2]; }
  }
  return { sts, ch, st };
}

/** The top-left corner of the blanket, enlarged: last body rows, row ends, border rounds with their corner groups. */
export function CornerCloseUp({ design, palette, size = 220 }: { design: BlanketDesign; palette: PaletteColor[]; size?: number }) {
  const border = design.lines.filter((l) => l.section === 'border');
  const rows = design.lines.filter((l) => l.label === 'Row');
  if (!border.length) return null;
  const hex = (k: string) => palette.find((c) => c.key === k)?.hex ?? '#ccc';
  const unit = 10; // px per stitch width
  const st = design.params.stitches;
  const px = (mm: number) => (mm / st.sc.width) * unit;
  const bandH = border.map((l) => px(l.height));
  const total = bandH.reduce((a, b) => a + b, 0);
  const ox = total + 8, oy = total + 8; // body corner
  const V = Math.max(110, ox + 70);
  const out: React.ReactNode[] = [];
  // body rows (bottom-right of the corner)
  const rowH = rows.length ? px((design.size.body?.heightCm ?? 0) * 10 / rows.length) : 10;
  for (let r = 0; r * rowH < V - oy; r++) {
    const l = rows[rows.length - 1 - r];
    if (!l) break;
    out.push(<rect key={`row${r}`} x={ox} y={oy + r * rowH} width={V - ox} height={rowH} fill={hex(l.color)} />);
    out.push(<line key={`rl${r}`} x1={ox} x2={V} y1={oy + (r + 1) * rowH} y2={oy + (r + 1) * rowH} className="bk-cu-line" />);
  }
  // border rounds: L-shaped bands outwards, with stitch ticks and the corner fan
  let inner = 0;
  border.forEach((l, i) => {
    const h = bandH[i];
    const x0 = ox - inner - h, y0 = oy - inner - h;
    out.push(<path key={`b${i}`} d={`M${x0} ${V}V${y0}H${V}V${y0 + h}H${x0 + h}V${V}Z`} fill={hex(l.color)} />);
    // ticks along both legs
    for (let t = x0 + h + unit / 2; t < V; t += unit) out.push(<line key={`tt${i}-${t}`} x1={t} x2={t} y1={y0 + 1.5} y2={y0 + h - 1.5} className="bk-cu-tick" />);
    for (let t = y0 + h + unit / 2; t < V; t += unit) out.push(<line key={`tl${i}-${t}`} y1={t} y2={t} x1={x0 + 1.5} x2={x0 + h - 1.5} className="bk-cu-tick" />);
    // corner group: a fan of its stitches from the inner corner point
    const g = cornerGroupOf(l.text);
    const cxp = x0 + h, cyp = y0 + h;
    if (g) {
      const n = g.sts;
      for (let k = 0; k < n; k++) {
        const a = Math.PI + (Math.PI / 2) * ((k + 0.5) / n);
        out.push(<line key={`f${i}-${k}`} x1={cxp} y1={cyp} x2={cxp + Math.cos(a) * h * 1.25} y2={cyp + Math.sin(a) * h * 1.25} className="bk-cu-fan" />);
      }
      if (g.ch) out.push(<circle key={`c${i}`} cx={cxp - h * 0.55} cy={cyp - h * 0.55} r={Math.max(1.5, h * 0.18)} className="bk-cu-sp" />);
    }
    inner += h;
  });
  return (
    <svg className="bk-corner" width={size} height={size} viewBox={`0 0 ${V} ${V}`} role="img" aria-label="Corner close-up: the border rounds and their corner groups">
      {out}
      <line x1={ox} y1={oy} x2={V} y2={oy} className="bk-cu-edge" />
      <line x1={ox} y1={oy} x2={ox} y2={V} className="bk-cu-edge" />
    </svg>
  );
}
