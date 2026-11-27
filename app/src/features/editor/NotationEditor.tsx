import { forwardRef, memo, useImperativeHandle, useMemo, useRef } from 'react';
import type { Diagnostic } from '@/app/coreApi';
import { diagnosticMarks, isRoundLine, offsetOf, segments, tokenizeLine } from './highlight';

export type NotationEditorHandle = { jumpTo: (line: number, col?: number, endLine?: number, endCol?: number) => void; focus: () => void };

/**
 * A plain <textarea> over an identical "mirror" that draws line numbers, syntax colour and
 * diagnostic underlines. The mirror is in normal flow and sizes the box; the textarea is laid
 * exactly on top (no own scrolling), so wrapping and positions always agree.
 */
export const NotationEditor = forwardRef<NotationEditorHandle, {
  value: string;
  onChange: (v: string) => void;
  diagnostics: Diagnostic[];
  stale?: boolean;
  label?: string;
  onSave?: () => void;
}>(function NotationEditor({ value, onChange, diagnostics, stale, label = 'Pattern notation', onSave }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    jumpTo: (line, col = 1, endLine, endCol) => {
      const el = ta.current;
      if (!el) return;
      const a = offsetOf(value, line, col);
      const b = endLine ? Math.max(a, offsetOf(value, endLine, endCol ?? col)) : a;
      el.focus({ preventScroll: true });
      el.setSelectionRange(a, b);
      const row = mirror.current?.children[line - 1] as HTMLElement | undefined;
      row?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    },
  }), [value]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); onSave?.(); }
  };

  return (
    <div className="ed-box" data-stale={stale || undefined}>
      <Mirror ref={mirror} value={value} diagnostics={diagnostics} />
      <textarea
        ref={ta}
        className="ed-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={label}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        wrap="soft"
      />
    </div>
  );
});

const Mirror = memo(forwardRef<HTMLDivElement, { value: string; diagnostics: Diagnostic[] }>(function Mirror({ value, diagnostics }, ref) {
  const lines = useMemo(() => value.split('\n'), [value]);
  const { marks, eol } = useMemo(() => diagnosticMarks(lines, diagnostics), [lines, diagnostics]);
  let inHeader = true;
  return (
    <div className="ed-mirror" ref={ref} aria-hidden="true">
      {lines.map((line, i) => {
        if (inHeader && isRoundLine(line)) inHeader = false;
        const segs = segments(line, tokenizeLine(line, inHeader), marks[i]);
        const worst = eol[i] ?? marks[i].reduce<string | undefined>((w, s) => (s === 'error' || w === 'error' ? 'error' : s === 'warning' || w === 'warning' ? 'warning' : s ?? w), undefined);
        return (
          <div key={i} className="ed-line" data-n={i + 1} data-sev={worst}>
            {segs.length === 0 && '​'}
            {segs.map((s, j) => (
              <span key={j} className={`t-${s.tok}`} data-sev={s.sev}>{s.text}</span>
            ))}
            {eol[i] && <span className="ed-eol" data-sev={eol[i]} />}
          </div>
        );
      })}
    </div>
  );
}));
