import { useMemo } from 'react';
import { declaredCounts } from '@/store/text';
import type { Pattern } from './coreApi';

/**
 * Decorative rosette thumbnail: one ring of dots per round, dot count = stitch count (from the
 * compiled graph if given, else the declared `(N)` annotations). Not a chart — just a recognisable mark.
 */
export function PatternGlyph({ text, pattern, size = 96, className }: { text: string; pattern?: Pattern; size?: number; className?: string }) {
  const counts = useMemo(() => {
    const fromGraph = pattern?.graph.rounds.map((r) => r.stitchCount);
    const raw = fromGraph?.length ? fromGraph : declaredCounts(text);
    let last = 6;
    return raw.map((n) => (last = n ?? last));
  }, [text, pattern]);

  const c = 50;
  const rounds = counts.length || 1;
  const rMax = 44;
  const step = rMax / (rounds + 0.6);
  const growth = counts.length > 1 ? counts[counts.length - 1] / (counts[0] || 1) / counts.length : 1;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx={c} cy={c} r={step * 0.55} fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.2" />
      {counts.map((n, i) => {
        const r = step * (i + 1.2);
        const k = Math.min(n, 96);
        const dot = Math.max(0.7, Math.min(2.6, (Math.PI * r) / k * 0.55));
        // waviness hints at ruffling when stitch counts outgrow the circumference
        const wav = growth > 2.2 ? 0.08 * (i / rounds) : 0;
        return (
          <g key={i} opacity={0.45 + 0.55 * ((i + 1) / rounds)}>
            {Array.from({ length: k }, (_, j) => {
              const a = (j / k) * Math.PI * 2 - Math.PI / 2;
              const rr = r * (1 + wav * Math.sin(a * 8));
              return <circle key={j} cx={c + rr * Math.cos(a)} cy={c + rr * Math.sin(a)} r={dot} fill="currentColor" />;
            })}
          </g>
        );
      })}
    </svg>
  );
}
