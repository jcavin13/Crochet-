// The pattern text as written, with the current item (and its repeat) highlighted.
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { SrcSpan } from '@/core/graph';

type Range = { from: number; to: number; cls: string };

/** Absolute offsets of each line start in `text`. */
function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) out.push(i + 1);
  return out;
}

function toRange(starts: number[], s: SrcSpan | undefined, cls: string): Range | undefined {
  if (!s) return undefined;
  const a = (starts[s.line - 1] ?? 0) + s.col - 1;
  const endLine = s.endLine ?? s.line;
  const b = s.endCol !== undefined ? (starts[endLine - 1] ?? 0) + s.endCol - 1 : (starts[endLine] ?? Infinity) - 1;
  return { from: a, to: b, cls };
}

/** Split [from, to) into segments with the classes of the ranges covering them. */
function segments(text: string, from: number, to: number, ranges: Range[]) {
  const cuts = new Set([from, to]);
  for (const r of ranges) { if (r.from > from && r.from < to) cuts.add(r.from); if (r.to > from && r.to < to) cuts.add(r.to); }
  const pts = [...cuts].sort((a, b) => a - b);
  const out: { text: string; cls: string }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const cls = ranges.filter((r) => r.from <= a && r.to >= b).map((r) => r.cls).join(' ');
    out.push({ text: text.slice(a, b), cls });
  }
  return out;
}

export function NotationLine({
  text, lines, hl, rep, strip, label,
}: {
  text: string;
  /** 1-based inclusive line ranges to show (one per round) */
  lines: { from: number; to: number; current?: boolean; key: string | number }[];
  hl?: SrcSpan;
  rep?: SrcSpan;
  /** single scrolling line (phone) instead of a wrapped block */
  strip?: boolean;
  label: string;
}) {
  const starts = useMemo(() => lineStarts(text), [text]);
  const ranges = [toRange(starts, rep, 'ctr-src--rep'), toRange(starts, hl, 'ctr-src--hl')].filter(Boolean) as Range[];
  const box = useRef<HTMLDivElement>(null);
  const hlKey = hl ? `${hl.line}:${hl.col}` : '';
  useLayoutEffect(() => {
    const el = box.current;
    const mark = el?.querySelector<HTMLElement>('.ctr-src--hl');
    if (!el || !mark) return;
    // .ctr-src is position: relative, so offsetTop is relative to the scroll box
    const top = mark.offsetTop;
    const bottom = top + mark.offsetHeight;
    if (strip) {
      // whole lines only: the current item's line second from the top (one line of context above)
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 22;
      const pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
      const k = Math.round((top - pad) / lh);
      if (top < el.scrollTop + pad || bottom > el.scrollTop + el.clientHeight - pad) el.scrollTop = Math.max(0, (k - 1) * lh);
    } else if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight - 24) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    }
  }, [hlKey, strip]);
  return (
    <div ref={box} className={strip ? 'ctr-src ctr-src--strip' : 'ctr-src ctr-src--block'} aria-label={label} role="group" data-no-tap>
      {lines.map((l) => {
        const from = starts[l.from - 1] ?? 0;
        const to = (starts[l.to] ?? text.length + 1) - 1;
        const segs = segments(text, from, Math.max(from, to), ranges);
        return (
          <p key={l.key} className={l.current ? 'ctr-src__line is-current' : 'ctr-src__line'}>
            {segs.map((s, i) => (s.cls ? <mark key={i} className={s.cls}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
          </p>
        );
      })}
    </div>
  );
}
