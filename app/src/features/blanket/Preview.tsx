// The colour preview: the whole blanket at scale, rows or rounds as coloured bands with the
// border — drawn from the design's own rows/rounds (heights, colours) and finished size.
import { useMemo } from 'react';
import type { BlanketDesign, BlanketSpec, PaletteColor, ThumbKind } from '@/core/blanket';
import { STITCH_BY_ID } from '@/core/blanket';

const colorOf = (palette: PaletteColor[], key: string) => palette.find((c) => c.key === key)?.hex ?? '#ccc';

function polygon(n: number, apothem: number, rot = 0): string {
  const R = apothem / Math.cos(Math.PI / n);
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n;
    pts.push(`${(R * Math.cos(a)).toFixed(2)},${(R * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** A faint texture for the body, per stitch pattern, in body units (mm). */
function Texture({ id, kind, colW, rowH }: { id: string; kind: ThumbKind; colW: number; rowH: number }) {
  const w = colW * (kind === 'granny' ? 4 : kind === 'shell' ? 6 : kind === 'v' ? 3 : kind === 'ripple' ? 12 : kind === 'bobble' ? 4 : 2);
  const h = rowH * 2;
  let body: React.ReactNode;
  switch (kind) {
    case 'granny':
      body = <><path d={`M${w * 0.1} ${h / 2}L${w * 0.35} ${h * 0.05}M${w * 0.35} ${h / 2}V${h * 0.05}M${w * 0.6} ${h / 2}L${w * 0.35} ${h * 0.05}`} /><path d={`M${w * 0.6} ${h}L${w * 0.85} ${h * 0.55}M${w * 0.85} ${h}V${h * 0.55}M${w * 1.1} ${h}L${w * 0.85} ${h * 0.55}`} /></>;
      break;
    case 'shell':
      body = <path d={`M${w * 0.1} ${h / 2}Q${w * 0.5} ${-h * 0.1} ${w * 0.9} ${h / 2}M${w * 0.6} ${h}Q${w} ${h * 0.4} ${w * 1.4} ${h}M${-w * 0.4} ${h}Q0 ${h * 0.4} ${w * 0.4} ${h}`} />;
      break;
    case 'v':
      body = <path d={`M${w * 0.2} ${h * 0.1}L${w / 2} ${h * 0.45}L${w * 0.8} ${h * 0.1}M${w * 0.2} ${h * 0.6}L${w / 2} ${h * 0.95}L${w * 0.8} ${h * 0.6}`} />;
      break;
    case 'mesh':
      body = <rect x={w * 0.15} y={h * 0.1} width={w * 0.7} height={h * 0.32} rx={w * 0.05} />;
      break;
    case 'moss':
      body = <path d={`M${w * 0.1} ${h * 0.25}H${w * 0.4}M${w * 0.6} ${h * 0.75}H${w * 0.9}`} />;
      break;
    case 'bobble':
      body = <circle cx={w / 2} cy={h / 4} r={Math.min(w, h) * 0.16} />;
      break;
    case 'griddle':
      body = <path d={`M${w * 0.25} ${h * 0.05}V${h * 0.45}M${w * 0.75} ${h * 0.55}V${h * 0.95}`} />;
      break;
    case 'ripple':
      body = null;
      break;
    default:
      body = <path d={`M${w * 0.25} ${h * 0.08}V${h * 0.42}M${w * 0.75} ${h * 0.58}V${h * 0.92}`} />;
  }
  return (
    <pattern id={id} width={w} height={h} patternUnits="userSpaceOnUse">
      <g fill="none" stroke="#000" strokeOpacity="0.16" strokeWidth={Math.max(0.6, colW * 0.12)} strokeLinecap="round">{body}</g>
    </pattern>
  );
}

export function BlanketPreview({ design, spec, className, label }: { design: BlanketDesign; spec: BlanketSpec; className?: string; label?: string }) {
  const W = design.size.achieved.widthCm * 10;
  const H = design.size.achieved.heightCm * 10;
  const pad = Math.max(W, H) * 0.03;
  const content = useMemo(() => draw(design, spec), [design, spec]);
  return (
    <svg className={className} viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`} role="img" aria-label={label ?? `Colour preview, ${design.size.achieved.widthCm} by ${design.size.achieved.heightCm} cm`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="bk-shadow" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy={Math.max(W, H) * 0.004} stdDeviation={Math.max(W, H) * 0.006} floodOpacity="0.25" /></filter>
        {content.defs}
      </defs>
      <g filter="url(#bk-shadow)">{content.body}</g>
    </svg>
  );
}

function draw(d: BlanketDesign, spec: BlanketSpec): { defs: React.ReactNode; body: React.ReactNode } {
  const W = d.size.achieved.widthCm * 10;
  const H = d.size.achieved.heightCm * 10;
  const pal = spec.palette;
  if (spec.construction === 'rect') {
    const pat = STITCH_BY_ID[spec.body.pattern];
    const border = d.lines.filter((l) => l.section === 'border');
    const rows = d.lines.filter((l) => l.label === 'Row');
    const bw = border.reduce((a, l) => a + l.height, 0);
    const bodyW = W - 2 * bw, bodyH = H - 2 * bw;
    const rowH = rows.length ? bodyH / rows.length : bodyH;
    const colW = d.size.body ? bodyW / d.size.body.columns : 5;
    const out: React.ReactNode[] = [];
    // border rounds: outermost first
    let inset = bw;
    const rects: { x: number; y: number; w: number; h: number; c: string }[] = [];
    for (const l of border) {
      inset -= l.height;
      rects.push({ x: inset, y: inset, w: W - 2 * inset, h: H - 2 * inset, c: colorOf(pal, l.color) });
    }
    rects.reverse().forEach((r, i) => out.push(<rect key={`b${i}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={Math.min(W, H) * 0.004} fill={r.c} />));
    const ripple = pat?.id === 'ripple';
    rows.forEach((l, i) => {
      const y = bw + bodyH - (i + 1) * rowH;
      out.push(<rect key={i} x={bw} y={y} width={bodyW} height={rowH + Math.min(0.6, rowH * 0.1)} fill={colorOf(pal, l.color)} />);
    });
    if (pat) out.push(<rect key="tex" x={bw} y={bw} width={bodyW} height={bodyH} fill="url(#bk-tex)" />);
    if (ripple) {
      // the wavy top and bottom edges
      const period = 12 * colW, amp = Math.min(rowH * 2.2, bw > 0 ? bw * 0.9 : rowH * 2);
      const wave = (y0: number, dir: number) => {
        let p = `M${bw} ${y0}`;
        for (let x = 0; x < bodyW - 1e-6; x += period / 2) p += `L${bw + Math.min(bodyW, x + period / 2)} ${y0 + (Math.round(x / (period / 2)) % 2 ? -1 : 1) * dir * amp * 0.5}`;
        return p;
      };
      out.push(<path key="wave-t" d={wave(bw, 1)} fill="none" stroke="#000" strokeOpacity="0.2" strokeWidth={Math.max(1, colW * 0.4)} />);
      out.push(<path key="wave-b" d={wave(bw + bodyH, -1)} fill="none" stroke="#000" strokeOpacity="0.2" strokeWidth={Math.max(1, colW * 0.4)} />);
    }
    return { defs: pat ? <Texture id="bk-tex" kind={pat.thumb} colW={colW} rowH={rowH} /> : null, body: out };
  }
  if (spec.construction === 'motif' && d.motif) {
    const m = d.motif;
    const a = m.acrossMm;
    const rounds = m.lines.filter((l) => l.label === 'Rnd');
    const radii: number[] = [];
    let r = 0;
    for (const l of rounds) { r += l.height; radii.push(r); }
    const scale = a / 2 / (radii[radii.length - 1] || 1);
    const cells: React.ReactNode[] = [];
    const joinC = colorOf(pal, m.joinColor);
    m.grid.forEach((row, i) => row.forEach((cw, j) => {
      const colours = m.colorways[cw]?.rounds ?? [];
      let cx: number, cy: number;
      if (m.shape === 'square') { cx = j * a + a / 2; cy = i * a + a / 2; }
      else { const side = a / Math.sqrt(3); cx = j * a + a / 2 + (i % 2 ? a / 2 : 0); cy = side + i * 1.5 * side; }
      const shapes = radii.map((rr, k) => ({ rr: rr * scale, c: colorOf(pal, colours[k] ?? colours[0]) })).reverse();
      cells.push(
        <g key={`${i}-${j}`} transform={`translate(${cx} ${cy})`}>
          {shapes.map((s, k) => (m.shape === 'square'
            ? <rect key={k} x={-s.rr} y={-s.rr} width={2 * s.rr} height={2 * s.rr} fill={s.c} stroke={k === 0 ? joinC : 'none'} strokeWidth={a * 0.012} />
            : <polygon key={k} points={polygon(6, s.rr, Math.PI / 6)} fill={s.c} stroke={k === 0 ? joinC : 'none'} strokeWidth={a * 0.012} />))}
        </g>,
      );
    }));
    return { defs: null, body: cells };
  }
  // in the round: nested shapes from the round heights, scaled to the finished size
  const style = spec.round.style;
  const rounds = d.lines.filter((l) => l.label === 'Rnd');
  const total = rounds.reduce((a, l) => a + l.height, 0) || 1;
  const cx = W / 2, cy = H / 2;
  const out: React.ReactNode[] = [];
  const isRect = style === 'rect-round';
  const core = isRect ? Math.max(0, W - H) : 0;
  const half = (isRect ? H : Math.min(W, H)) / 2;
  const k = half / total;
  let acc = 0;
  const bands = rounds.map((l, i) => { acc += l.height; return { r: acc * k, c: colorOf(pal, l.color), i, note: l.note }; });
  let squareFrom = 0;
  if (style === 'circle-to-square') squareFrom = rounds.findIndex((l) => l.note === 'squaring round');
  const lace = style === 'mandala' && rounds.length >= 2 && rounds[rounds.length - 1].note?.startsWith('lace');
  bands.slice().reverse().forEach((b) => {
    const key = `r${b.i}`;
    if (style === 'circle' || style === 'mandala' || (style === 'circle-to-square' && b.i < squareFrom)) {
      if (lace && b.i === bands.length - 1) out.push(<path key={key} d={scallop(cx, cy, b.r, 48)} fill={b.c} />);
      else out.push(<circle key={key} cx={cx} cy={cy} r={b.r} fill={b.c} />);
    } else if (style === 'hexagon' || style === 'octagon') {
      const n = style === 'hexagon' ? 6 : 8;
      out.push(<polygon key={key} points={polygon(n, b.r, style === 'hexagon' ? Math.PI / 6 : Math.PI / 8)} transform={`translate(${cx} ${cy})`} fill={b.c} />);
    } else if (isRect) {
      out.push(<rect key={key} x={cx - core / 2 - b.r} y={cy - b.r} width={core + 2 * b.r} height={2 * b.r} rx={b.r * 0.05} fill={b.c} />);
    } else {
      out.push(<rect key={key} x={cx - b.r} y={cy - b.r} width={2 * b.r} height={2 * b.r} rx={b.r * 0.015} fill={b.c} />);
    }
  });
  return { defs: null, body: out };
}

function scallop(cx: number, cy: number, r: number, n: number): string {
  let p = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI, a1 = ((i + 1) / n) * 2 * Math.PI, am = (a0 + a1) / 2;
    const x0 = cx + (r * 0.96) * Math.cos(a0), y0 = cy + (r * 0.96) * Math.sin(a0);
    const xm = cx + r * 1.04 * Math.cos(am), ym = cy + r * 1.04 * Math.sin(am);
    const x1 = cx + (r * 0.96) * Math.cos(a1), y1 = cy + (r * 0.96) * Math.sin(a1);
    p += `${i ? '' : `M${x0} ${y0}`}Q${xm} ${ym} ${x1} ${y1}`;
  }
  return `${p}Z`;
}
