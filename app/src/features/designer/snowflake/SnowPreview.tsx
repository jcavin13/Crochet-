// The snowflake as it will block: drawn from the predicted pinned-out geometry (spines, branches,
// picot tips, valley bridges, body rings). Used for the big preview, the gallery and thumbnails —
// the symbol chart lays rounds out as circles, which suits pointed rounds poorly.
import { memo } from 'react';
import type { BlockedShape, Pt } from '@/core/generate/snowflake';

const p2 = (p: Pt) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;

export const SnowPreview = memo(function SnowPreview({
  shape, size = 320, pins = false, outline = false, label, className,
}: { shape: BlockedShape; size?: number | string; pins?: boolean; outline?: boolean; label?: string; className?: string }) {
  const R = shape.tipR * 1.1 + 2;
  const scale = R / 50; // stroke widths in "viewBox per 100" units
  const spine = shape.arms.map((a) => a.spine.map((s) => `M${p2(s.a)}L${p2(s.b)}`).join('')).join('');
  const branches = shape.arms.map((a) => a.branches.map((s) => `M${p2(s.a)}L${p2(s.b)}`).join('')).join('');
  const web = shape.web.map((w) => {
    const c = { x: 2 * w.pin.x - (w.a.x + w.b.x) / 2, y: 2 * w.pin.y - (w.a.y + w.b.y) / 2 };
    return `M${p2(w.a)}Q${p2(c)} ${p2(w.b)}`;
  }).join('');
  const tipR = Math.max(0.4, shape.tipR * 0.018);
  const tips = shape.arms.flatMap((a) => a.tips).map((t) => `M${(t.x - tipR).toFixed(2)} ${t.y.toFixed(2)}a${tipR} ${tipR} 0 1 0 ${(2 * tipR).toFixed(2)} 0a${tipR} ${tipR} 0 1 0 ${(-2 * tipR).toFixed(2)} 0`).join('');
  return (
    <svg
      className={`sf-preview ${className ?? ''}`} viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} width={size} height={size}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}
    >
      {outline && shape.outline.length > 2 && <path className="sf-outline" d={`M${shape.outline.map(p2).join('L')}Z`} strokeWidth={0.4 * scale} />}
      {shape.rings.map((r, i) => <circle key={i} className="sf-ring" cx={0} cy={0} r={r} strokeWidth={(i === shape.rings.length - 1 ? 0.9 : 0.5) * scale} />)}
      <path className="sf-web" d={web} strokeWidth={0.7 * scale} />
      <path className="sf-spine" d={spine} strokeWidth={1.0 * scale} />
      <path className="sf-branch" d={branches} strokeWidth={0.7 * scale} />
      <path className="sf-tip" d={tips} strokeWidth={0.5 * scale} />
      {pins && shape.pins.map((p, i) => <circle key={i} className="sf-pin" data-kind={p.kind} cx={p.p.x} cy={p.p.y} r={0.55 * scale} />)}
    </svg>
  );
});
