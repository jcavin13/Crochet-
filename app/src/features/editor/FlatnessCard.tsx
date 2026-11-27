/**
 * Flatness card: per-round flat / cup / ruffle with the analytic message; for rounds that are not
 * flat, ranked notation fixes from the assistant (preview + one-tap apply), "Fix all rounds",
 * "Undo last fix", and a "what should this round be" calculator on every round.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Pattern } from '@/core/graph';
import { analyzeFlatness, type RoundFlatness } from '@/core/flatness';
import type { ParamSet } from '@/core/params';
import type { SymmetryReport } from '@/core/symmetry';
import { fixAll, needsFix, suggestCountsForRound, suggestRoundFixes, type FixSuggestion } from '@/core/assist';
import type { BaseType } from '@/core/notation';
import { Badge, Button, Icon, ShapeBadge, toast } from '@/ui';

function RoundBadge({ r }: { r: RoundFlatness }) {
  if (r.class === 'n/a') return <Badge tone="outline">n/a</Badge>;
  if (r.slackOnly) return <ShapeBadge shape="flat">loose loops</ShapeBadge>;
  return <ShapeBadge shape={r.class} />;
}

export function FlatnessCard({ pattern, text, params, symmetry, busy, onApply, onUndo, undoLabel, onJump }: {
  pattern: Pattern;
  text: string;
  params: ParamSet;
  symmetry?: SymmetryReport;
  /** A compile is pending: the text and the pattern may disagree. */
  busy: boolean;
  onApply: (text: string, label: string) => void;
  onUndo?: () => void;
  undoLabel?: string;
  onJump: (line: number) => void;
}) {
  const flat = useMemo(() => analyzeFlatness(pattern.graph, params), [pattern.graph, params]);
  const [open, setOpen] = useState<number | null>(null);
  const [calc, setCalc] = useState<number | null>(null);
  const [fixes, setFixes] = useState<{ round: number; text: string; list: FixSuggestion[] } | null>(null);
  const [working, setWorking] = useState<number | 'all' | null>(null);
  useEffect(() => { setFixes(null); setOpen(null); }, [text]);

  if (!flat.applicable) {
    return <p className="muted small" style={{ margin: 0 }}>Worked in rows — the flatness check and its fixes apply to pieces worked in the round.</p>;
  }
  const bad = flat.rounds.filter((r) => needsFix(r));
  const suggest = (round: number) => {
    setOpen(round);
    if (fixes && fixes.round === round && fixes.text === text) return;
    setWorking(round);
    // let the "finding fixes" state paint first: the search compiles a few dozen variants
    setTimeout(() => {
      const list = suggestRoundFixes(text, round, params, { max: 4 });
      setFixes({ round, text, list });
      setWorking(null);
    }, 16);
  };
  const doFixAll = () => {
    setWorking('all');
    setTimeout(() => {
      const res = fixAll(text, params);
      setWorking(null);
      if (!res.steps.length) { toast('No clean fix found: every candidate edit would break a later round or the symmetry.'); return; }
      onApply(res.text, `${res.steps.length} round${res.steps.length > 1 ? 's' : ''} fixed`);
    }, 16);
  };
  const lineOf = (round: number) => pattern.graph.rounds[round]?.src?.line;

  return (
    <div className="ed-flat">
      <div className="ed-flat__head">
        {bad.length === 0
          ? <span className="ed-flat__ok"><Icon name="check" size={16} /> Every round lies flat.</span>
          : <span>{bad.length} round{bad.length > 1 ? 's' : ''} {bad.length > 1 ? 'are' : 'is'} not flat{bad.some((r) => r.slackOnly) ? ' (or flat only with loose loops)' : ''}.</span>}
        <div className="ed-flat__actions">
          {onUndo && <Button size="sm" variant="ghost" onClick={onUndo} title={undoLabel ? `Undo: ${undoLabel}` : undefined}>Undo last fix</Button>}
          {bad.length > 0 && <Button size="sm" icon="sparkle" onClick={doFixAll} disabled={busy || working !== null}>{working === 'all' ? 'Fixing…' : 'Fix all rounds'}</Button>}
        </div>
      </div>
      <ul className="ed-flat__list">
        {flat.rounds.map((r) => {
          const needs = needsFix(r);
          const isOpen = open === r.round;
          const line = lineOf(r.round);
          return (
            <li key={r.round} className={needs ? 'is-off' : undefined}>
              <div className="ed-flat__row">
                <RoundBadge r={r} />
                <button type="button" className="ed-flat__msg" onClick={() => line && onJump(line)} title={line ? `Go to line ${line}` : undefined}>{r.message}</button>
                {r.class !== 'n/a' ? (
                  <button type="button" className={`ed-flat__calc${calc === r.round ? ' is-on' : ''}`} aria-expanded={calc === r.round} onClick={() => setCalc(calc === r.round ? null : r.round)} title="What should this round be?" aria-label={`What should ${r.label} be?`}>
                    ≈?
                  </button>
                ) : <span />}
              </div>
              {needs && (
                <div className="ed-flat__more">
                  <Button size="sm" variant={isOpen ? 'primary' : 'default'} icon="sparkle" onClick={() => (isOpen ? setOpen(null) : suggest(r.round))} disabled={busy} aria-expanded={isOpen}>
                    {isOpen ? 'Hide fixes' : 'Suggest fixes'}
                  </Button>
                </div>
              )}
              {calc === r.round && <Calculator pattern={pattern} round={r.round} params={params} symmetry={symmetry} />}
              {isOpen && (
                <div className="ed-fixes" role="region" aria-label={`Fixes for ${r.label}`}>
                  {working === r.round && <p className="muted small">Trying edits to {r.label}…</p>}
                  {fixes?.round === r.round && working !== r.round && (fixes.list.length === 0
                    ? <p className="muted small" style={{ margin: 0 }}>No small edit to this round makes it flat while keeping every later round working and the symmetry intact. The calculator (≈?) shows what a flat round needs here.</p>
                    : (
                      <ol className="ed-fixes__list">
                        {fixes.list.map((s, i) => <FixItem key={i} s={s} best={i === 0} onApply={() => onApply(s.text, s.label)} disabled={busy || text !== s.base} />)}
                      </ol>
                    ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="muted small" style={{ margin: 'var(--s-2) 0 0' }}>
        Fixes are edits to the notation, checked by the compiler (later rounds included), keeping the symmetry; counts update automatically. Analytic check — rounds treated as circles.
      </p>
    </div>
  );
}

function FixItem({ s, best, onApply, disabled }: { s: FixSuggestion; best: boolean; onApply: () => void; disabled: boolean }) {
  const outcome = s.result.class === 'flat' && !s.result.slackOnly ? 'flat' : s.result.class === 'flat' ? 'loose' : s.result.class;
  return (
    <li className="ed-fix">
      <div className="ed-fix__top">
        <span className="ed-fix__label">
          {best && <Badge tone="accent">best</Badge>} {s.change}
          {s.adjusted.length > 0 && <span className="muted"> · also {s.adjusted.join(', ')}</span>}
        </span>
        <Button size="sm" variant={best ? 'primary' : 'default'} onClick={onApply} disabled={disabled}>Apply</Button>
      </div>
      <div className="ed-fix__result">
        {outcome === 'flat' ? <ShapeBadge shape="flat">lies flat</ShapeBadge> : outcome === 'loose' ? <ShapeBadge shape="flat">loose loops</ShapeBadge> : <ShapeBadge shape={outcome as 'cup' | 'ruffle'}>still {outcome === 'cup' ? 'cups' : 'ruffles'}</ShapeBadge>}
        <span className="muted small">{s.result.e >= 0 ? '+' : '−'}{Math.round(Math.abs(s.result.e) * 100)}% at nominal loop length{s.countsUpdated ? ` · ${s.countsUpdated} count${s.countsUpdated > 1 ? 's' : ''} updated` : ''}</span>
      </div>
      {s.attention.length > 0 && (
        <p className="ed-fix__warn small"><Icon name="alert" size={14} /> Then {s.attention.join(', ')} need{s.attention.length === 1 ? 's' : ''} attention{s.attentionDetails[0] ? `: ${s.attentionDetails[0]}` : ''}</p>
      )}
      <div className="ed-diff" aria-label="Preview of the change">
        {s.diff.before.map((l, i) => <div key={`b${i}`} className="ed-diff__del"><span aria-hidden="true">−</span>{l}</div>)}
        {s.diff.after.map((l, i) => <div key={`a${i}`} className="ed-diff__add"><span aria-hidden="true">+</span>{l}</div>)}
      </div>
    </li>
  );
}

const STITCHES: BaseType[] = ['sc', 'hdc', 'dc', 'tr', 'dtr'];

function Calculator({ pattern, round, params, symmetry }: { pattern: Pattern; round: number; params: ParamSet; symmetry?: SymmetryReport }) {
  const base = useMemo(() => suggestCountsForRound(pattern.graph, round, params, { symmetry }), [pattern.graph, round, params, symmetry]);
  const [stitch, setStitch] = useState<BaseType | undefined>(undefined);
  const [order, setOrder] = useState<number | undefined>(undefined);
  const s = useMemo(() => (base ? suggestCountsForRound(pattern.graph, round, params, { symmetry, stitch: stitch ?? base.stitch, order: order ?? base.order }) : null), [base, pattern.graph, round, params, symmetry, stitch, order]);
  if (!s || !base) return null;
  const R = pattern.graph.rounds[round];
  return (
    <div className="ed-calc" role="group" aria-label={`What should ${R.label} be?`}>
      <div className="ed-calc__ctrl">
        <label>
          <span>Stitch</span>
          <select value={stitch ?? base.stitch} onChange={(e) => setStitch(e.target.value as BaseType)}>
            {STITCHES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label>
          <span>Repeats</span>
          <input type="number" inputMode="numeric" min={1} max={48} value={order ?? base.order} onChange={(e) => setOrder(Math.max(1, Math.min(48, Number(e.target.value) || 1)))} />
        </label>
        <span className="muted small">radius ≈ {(s.rho / 10).toFixed(1)} cm · now {R.stitchCount} sts</span>
      </div>
      <p className="ed-calc__msg">{s.message}</p>
      <ul className="ed-calc__opts">
        {s.options.map((o, i) => (
          <li key={i}><code>{o.text}</code> <span className="muted small">= {o.total} {s.stitch}{o.chains ? ` + ${o.chains * s.order} ch` : ''} ({o.e >= 0 ? '+' : '−'}{Math.round(Math.abs(o.e) * 100)}%)</span></li>
        ))}
      </ul>
    </div>
  );
}
