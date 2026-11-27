// Interactive SVG profile editor: drag control points (mouse or touch), tap the curve to add a
// point, select a point to remove it or make it a corner. Shows the mirror axis and the mirrored
// silhouette, a 1 cm grid, dimensions, and the realised profile with one tick per round.
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { ProfilePoint, RevolveResult, RoundKind } from '@/core/amigurumi';
import { sampleProfile } from '@/core/amigurumi';

export const KIND_COLOR: Record<RoundKind, string> = {
  start: 'var(--ink-2)', inc: 'var(--accent)', dec: 'var(--indigo)', even: 'var(--ink-3)',
};

interface Props {
  points: ProfilePoint[];
  smooth: boolean;
  onChange: (pts: ProfilePoint[]) => void;
  result?: RevolveResult;
  snap: boolean;
  selected: number | null;
  onSelect: (i: number | null) => void;
  highlightRound?: number | null;
}

const pathOf = (pts: { r: number; z: number }[], mirror = false) =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${(mirror ? -p.r : p.r).toFixed(2)},${(-p.z).toFixed(2)}`).join('');

export function ProfileEditor({ points, smooth, onChange, result, snap, selected, onSelect, highlightRound }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ i: number; id: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // frame: fixed while dragging so the view does not swim under the finger
  const frameFrom = (pts: { r: number; z: number }[]) => {
    let rMax = 10, zMin = 0, zMax = 10;
    for (const p of pts) { rMax = Math.max(rMax, p.r); zMin = Math.min(zMin, p.z); zMax = Math.max(zMax, p.z); }
    const pad = Math.max(8, 0.12 * Math.max(rMax * 2, zMax - zMin));
    return { x0: -rMax - pad, x1: rMax + pad * 1.6, z0: zMin - pad, z1: zMax + pad };
  };
  const liveFrame = frameFrom([...points, ...(result?.realised ?? [])]);
  const frozen = useRef(liveFrame);
  if (!drag.current) frozen.current = liveFrame;
  const f = frozen.current;
  const W = f.x1 - f.x0, H = f.z1 - f.z0;
  const unit = Math.max(W, H) / 100; // ~1% of the view, for stroke widths and handles

  const target = useMemo(() => sampleProfile({ points, smooth }).pts, [points, smooth]);

  const toData = (e: { clientX: number; clientY: number }) => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = el.getScreenCTM();
    const p = m ? pt.matrixTransform(m.inverse()) : pt;
    return { r: p.x, z: -p.y };
  };
  const snapPt = (p: { r: number; z: number }) => {
    let { r, z } = p;
    if (snap) { r = Math.round(r / 2.5) * 2.5; z = Math.round(z / 2.5) * 2.5; }
    if (r < 2) r = 0; // snap to the axis
    return { r: Math.max(0, +r.toFixed(1)), z: +z.toFixed(1) };
  };
  const move = (i: number, p: { r: number; z: number }) => {
    const next = points.map((q, j) => (j === i ? { ...q, ...snapPt(p) } : q));
    onChange(next);
  };

  const onDown = (i: number) => (e: PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { i, id: e.pointerId, moved: false };
    onSelect(i);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.moved = true;
    move(d.i, toData(e));
  };
  const onUp = (e: PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  const addAt = (e: PointerEvent) => {
    const p = snapPt(toData(e));
    // insert between the pair of neighbouring control points whose chord is closest
    let best = 0, bd = Infinity;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1];
      const dr = b.r - a.r, dz = b.z - a.z, L2 = dr * dr + dz * dz || 1;
      const u = Math.min(1, Math.max(0, ((p.r - a.r) * dr + (p.z - a.z) * dz) / L2));
      const d = Math.hypot(p.r - (a.r + u * dr), p.z - (a.z + u * dz));
      if (d < bd) { bd = d; best = i; }
    }
    const next = [...points.slice(0, best + 1), p, ...points.slice(best + 1)];
    onChange(next);
    onSelect(best + 1);
  };
  const onKey = (e: KeyboardEvent) => {
    if (selected === null) return;
    const step = e.shiftKey ? 5 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (d) {
      e.preventDefault();
      const p = points[selected];
      onChange(points.map((q, j) => (j === selected ? { ...q, r: Math.max(0, +(p.r + d[0]).toFixed(1)), z: +(p.z + d[1]).toFixed(1) } : q)));
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && points.length > 2) {
      e.preventDefault();
      onChange(points.filter((_, j) => j !== selected));
      onSelect(null);
    } else if (e.key === 'Escape') onSelect(null);
  };

  // grid every 1 cm (2 cm when large), labels in cm
  const step = Math.max(W, H) > 220 ? 20 : 10;
  const gx: number[] = [], gz: number[] = [];
  for (let x = Math.ceil(f.x0 / step) * step; x <= f.x1; x += step) gx.push(x);
  for (let z = Math.ceil(f.z0 / step) * step; z <= f.z1; z += step) gz.push(z);
  const fs = unit * 3.2;

  const realised = result?.realised ?? [];
  const tb = target.reduce((a, p) => ({ rMax: Math.max(a.rMax, p.r), zMin: Math.min(a.zMin, p.z), zMax: Math.max(a.zMax, p.z) }), { rMax: 0, zMin: Infinity, zMax: -Infinity });

  return (
    <svg
      ref={svg}
      className="ami-editor"
      viewBox={`${f.x0} ${-f.z1} ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="application"
      aria-label="Profile editor: drag the points; tap the curve to add a point; select a point and press Delete to remove it, arrow keys to nudge it."
      tabIndex={0}
      onKeyDown={onKey}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerDown={() => onSelect(null)}
    >
      <g className="ami-grid">
        {gx.map((x) => <line key={`x${x}`} x1={x} x2={x} y1={-f.z1} y2={-f.z0} strokeWidth={unit * 0.15} />)}
        {gz.map((z) => <line key={`z${z}`} y1={-z} y2={-z} x1={f.x0} x2={f.x1} strokeWidth={unit * 0.15} />)}
        {gz.map((z) => <text key={`tz${z}`} x={f.x1 - unit * 1.5} y={-z - unit * 0.8} fontSize={fs} textAnchor="end">{z / 10} cm</text>)}
      </g>
      {/* mirrored silhouette and the axis of revolution */}
      <path d={pathOf(target, true)} className="ami-mirror" strokeWidth={unit * 0.5} />
      <line className="ami-axis" x1={0} x2={0} y1={-f.z1} y2={-f.z0} strokeWidth={unit * 0.35} strokeDasharray={`${unit * 2} ${unit * 1.2}`} />
      <text className="ami-axis-label" x={unit} y={-f.z1 + fs * 1.4} fontSize={fs}>axis</text>

      {/* dimensions of the target */}
      {isFinite(tb.zMax) && (
        <g className="ami-dim" fontSize={fs}>
          <line x1={-tb.rMax} x2={tb.rMax} y1={-f.z0 - unit * 3} y2={-f.z0 - unit * 3} strokeWidth={unit * 0.25} />
          <text x={0} y={-f.z0 - unit * 4} textAnchor="middle">⌀ {(tb.rMax / 5).toFixed(1)} cm</text>
          <line x1={f.x0 + unit * 3} x2={f.x0 + unit * 3} y1={-tb.zMax} y2={-tb.zMin} strokeWidth={unit * 0.25} />
          <text x={f.x0 + unit * 4} y={-(tb.zMax + tb.zMin) / 2} dominantBaseline="middle">{((tb.zMax - tb.zMin) / 10).toFixed(1)} cm</text>
        </g>
      )}

      {/* target curve: wide invisible stroke to tap-to-add */}
      <path d={pathOf(target)} className="ami-target-hit" strokeWidth={unit * 5} onPointerDown={(e) => { e.stopPropagation(); addAt(e); }} />
      <path d={pathOf(target)} className="ami-target" strokeWidth={unit * 0.6} />

      {/* realised profile with a tick per round */}
      {realised.length > 1 && (
        <g>
          <path d={pathOf(realised)} className="ami-realised" strokeWidth={unit * 0.7} />
          {result!.rounds.map((r) => (
            <circle
              key={r.n}
              cx={r.realised.r}
              cy={-r.realised.z}
              r={unit * (highlightRound === r.n ? 1.6 : 0.9)}
              fill={KIND_COLOR[r.kind]}
              stroke={highlightRound === r.n ? 'var(--ink)' : 'none'}
              strokeWidth={unit * 0.3}
            >
              <title>{`Rnd ${r.n}: ${r.count} sts (${r.change >= 0 && r.n > 1 ? '+' : ''}${r.n > 1 ? r.change : 'start'})`}</title>
            </circle>
          ))}
        </g>
      )}

      {/* control points */}
      {points.map((p, i) => (
        <g key={i} className="ami-handle" data-selected={selected === i || undefined} onPointerDown={onDown(i)} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
          <circle cx={p.r} cy={-p.z} r={unit * 4.5} className="ami-handle__hit" />
          {p.corner || !smooth
            ? <rect x={p.r - unit * 1.6} y={-p.z - unit * 1.6} width={unit * 3.2} height={unit * 3.2} className="ami-handle__dot" strokeWidth={unit * 0.5} />
            : <circle cx={p.r} cy={-p.z} r={unit * 1.8} className="ami-handle__dot" strokeWidth={unit * 0.5} />}
          {(hover === i || selected === i) && (
            <text x={p.r + unit * 3} y={-p.z - unit * 2.5} fontSize={fs} className="ami-handle__label">{`r ${(p.r / 10).toFixed(1)} · z ${(p.z / 10).toFixed(1)} cm`}</text>
          )}
        </g>
      ))}
    </svg>
  );
}
