// The counter for one pattern: a pointer into the stitch graph, driven by one big tap zone.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCurrentPattern, patternHref } from '@/app';
import { usePersistentState, useSettings } from '@/store';
import {
  Button, ConfirmDialog, Dialog, EmptyState, Icon, Menu, SegmentedControl, buttonClass, toast,
} from '@/ui';
import {
  buildSteps, jumpToNode, jumpToRound, newProgress, next as nextStep, pace, patternAst, patternHash, positionOf,
  positionText, prev as prevStep, reconcile, reset as resetProgress, roundExpectation, setGranularity, setNote,
  stepAt, undo as undoProgress, type CounterProgress, type Granularity, type Step, type StepList,
} from '@/core/counter';
import type { Pattern } from '@/core/graph';
import { ChartView } from '@/features/chart/ChartView';
import { click, useKeys, useReducedMotion, useTapSwipe, useWakeLock, vibrate, vibrateSupported } from './device';
import { NotationLine } from './NotationLine';
import { DEFAULT_PREFS, PREFS_KEY, progressKey, writeIndexEntry, type CounterPrefs } from './persist';
import { CtrIcon } from './icons';

const GRAN_OPTIONS: { value: Granularity; label: string; title: string }[] = [
  { value: 'stitch', label: 'Stitch', title: 'One tap per stitch' },
  { value: 'group', label: 'Item', title: 'One tap per pattern item (ch 3, 3 dc in next sp, a shell…)' },
  { value: 'round', label: 'Round', title: 'One tap per round' },
];

const sizeClass = (t: string) => (t.length <= 12 ? 'is-xl' : t.length <= 22 ? 'is-lg' : t.length <= 36 ? 'is-md' : t.length <= 70 ? 'is-sm' : 'is-xs');

function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return '< 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** Keep "ch-4", "ch-2 sp", "dc2tog" from breaking at the hyphen. */
function keepTogether(t: string) {
  return t.split(/(\S+-\S+(?: sps?)?)/).map((part, i) => (i % 2 ? <span key={i} className="ctr-nowrap">{part}</span> : part));
}

function Ring({ fraction, children, label }: { fraction: number; children: React.ReactNode; label: string }) {
  const r = 25;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div className="ctr-ring" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)}>
      <svg viewBox="0 0 60 60" width="60" height="60" aria-hidden="true">
        <circle cx="30" cy="30" r={r} className="ctr-ring__track" />
        <circle cx="30" cy="30" r={r} className="ctr-ring__fill" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 30 30)" />
      </svg>
      <span className="ctr-ring__text">{children}</span>
    </div>
  );
}

/** Source lines of round r (1-based, inclusive). */
function roundLines(pattern: Pattern, r: number) {
  const s = pattern.graph.rounds[r]?.src;
  return s ? { from: s.line, to: s.endLine ?? s.line } : undefined;
}

export function CounterScreen() {
  const { id, status, record, pattern, diagnostics } = useCurrentPattern();
  if (status === 'loading' || !id) return <div className="ctr-screen ctr-screen--empty"><h1 className="ctr-sr">Counter</h1></div>;
  if (status === 'missing') {
    return (
      <div className="ctr-screen ctr-screen--empty">
        <EmptyState title={<h1 className="ctr-h1-inline">Pattern not found</h1>} actions={<Link className={buttonClass('primary')} to="/counter">All counters</Link>}>
          This pattern is not in your library any more.
        </EmptyState>
      </div>
    );
  }
  if (!pattern) {
    const errors = diagnostics.filter((d) => d.severity === 'error').length;
    return (
      <div className="ctr-screen ctr-screen--empty">
        <EmptyState
          title={<h1 className="ctr-h1-inline">{record?.title ?? 'Counter'}</h1>}
          actions={<><Link className={buttonClass('primary')} to={patternHref('editor', id)}>Open in the Editor</Link><Link className={buttonClass()} to="/counter">All counters</Link></>}
        >
          {errors ? `The notation has ${errors} error${errors === 1 ? '' : 's'}; fix ${errors === 1 ? 'it' : 'them'} in the Editor and the counter will follow.` : 'Reading the pattern…'}
        </EmptyState>
      </div>
    );
  }
  return <Counter key={id} id={id} pattern={pattern} title={pattern.meta.title || record?.title || 'Pattern'} />;
}

function Counter({ id, pattern, title }: { id: string; pattern: Pattern; title: string }) {
  const graph = pattern.graph;
  const N = graph.nodes.length;
  const terms = useSettings((s) => s.terms);
  const [prefs, setPrefs] = usePersistentState<CounterPrefs>(PREFS_KEY, DEFAULT_PREFS);
  const [saved, setSaved, hydrated] = usePersistentState<CounterProgress | null>(progressKey(id), null);
  const hash = useMemo(() => patternHash(pattern), [pattern]);
  const ast = useMemo(() => patternAst(pattern), [pattern]);
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const P = { ...DEFAULT_PREFS, ...prefs };

  // create / reconcile saved progress once storage is read
  useEffect(() => {
    if (!hydrated) return;
    if (!saved) { setSaved(newProgress(id, pattern, Date.now(), P.granularity)); return; }
    if (saved.textHash !== hash || saved.nodeCount !== N || saved.nodeIndex > N) {
      const r = reconcile(saved, pattern, Date.now());
      setSaved(r.progress);
      if (r.message) toast(r.message, { ms: 9000 });
    }
  }, [hydrated, saved, hash, N]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = saved && saved.textHash === hash && saved.nodeCount === N ? saved : null;
  const granularity = p?.granularity ?? P.granularity;
  const list: StepList = useMemo(() => buildSteps(pattern, { granularity, terms, ast }), [pattern, granularity, terms, ast]);
  const nodeIndex = p?.nodeIndex ?? 0;
  const si = stepAt(list, nodeIndex);
  const step: Step | undefined = list.steps[si];
  const pos = positionOf(list, graph, nodeIndex);
  const finished = pos.finished;
  const [checkpoint, setCheckpoint] = useState<number | null>(null);
  const wake = useWakeLock(P.wake);

  // keep the "continue" index up to date
  useEffect(() => {
    if (!p) return;
    const R = graph.rounds[pos.round];
    void writeIndexEntry({
      id, title, fraction: pos.pieceFraction, finished,
      where: finished ? 'Finished' : `${R?.label ?? ''} · ${pos.done} / ${pos.total}`,
      updatedAt: p.updatedAt,
    });
  }, [p?.nodeIndex, p?.updatedAt, title]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((fn: (s: CounterProgress) => CounterProgress) => {
    setSaved((prev) => (prev && prev.textHash === hash ? fn(prev) : prev));
  }, [setSaved, hash]);

  const feedback = (kind: 'tick' | 'round') => {
    if (P.haptics) vibrate(kind === 'tick' ? 12 : [30, 60, 30]);
    if (P.sound) click(kind);
  };

  const goNext = () => {
    if (!p) return;
    if (checkpoint !== null) { setCheckpoint(null); return; }
    if (!step) return;
    update((s) => nextStep(s, list, graph, Date.now()));
    if (step.endsRound) {
      feedback('round');
      if (step.last + 1 < N) setCheckpoint(step.round);
    } else feedback('tick');
  };
  const goBack = () => {
    if (!p) return;
    setCheckpoint(null);
    update((s) => prevStep(s, list, graph, Date.now()));
  };
  const doUndo = () => {
    if (!p?.history.length) return;
    setCheckpoint(null);
    update((s) => undoProgress(s, graph, Date.now()));
  };
  const setGran = (g: Granularity) => {
    update((s) => setGranularity(s, g, Date.now()));
    setPrefs((x) => ({ ...DEFAULT_PREFS, ...x, granularity: g }));
  };
  const jumpRound = (r: number) => {
    setCheckpoint(null);
    update((s) => jumpToRound(s, graph, r, Date.now()));
    toast(`Jumped to ${graph.rounds[r].label}`, { action: { label: 'Undo', onClick: () => update((s) => undoProgress(s, graph, Date.now())) } });
  };

  const tap = useTapSwipe(goNext, (dir) => (dir < 0 ? goNext() : goBack()));
  useKeys((e) => {
    // Space / Enter on a focused button or link activate it instead
    const onControl = !!(e.target as HTMLElement | null)?.closest?.('button, a, [role="radio"]');
    if (e.key === 'ArrowRight' || ((e.key === ' ' || e.key === 'Enter') && !onControl)) { e.preventDefault(); goNext(); }
    else if (e.key === 'ArrowLeft' || (e.key === 'Backspace' && !onControl)) { e.preventDefault(); goBack(); }
    else if ((e.key === 'z' && e.ctrlKey) || e.key === 'u') { e.preventDefault(); doUndo(); }
  });

  // dialogs
  const [roundsOpen, setRoundsOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [jumpTarget, setJumpTarget] = useState<number | null>(null);

  const prevS = list.steps[si - 1];
  const nextS = finished ? undefined : list.steps[si + 1];
  // during the end-of-round check, the header still shows the round just finished
  const shownRound = checkpoint ?? pos.round;
  const R = graph.rounds[shownRound];
  const shownDone = checkpoint !== null ? R.stitchCount : pos.done;
  const curRound = step?.round ?? pos.round;
  const expectation = checkpoint !== null ? roundExpectation(graph, checkpoint, terms) : undefined;
  const pc = p ? pace(p, graph) : undefined;
  const note = p?.notes[curRound];
  const lines = roundLines(pattern, curRound);
  const inStepDone = step && nodeIndex > step.first ? nodeIndex - step.first : 0;
  const nextLabel = nextS && nextS.round !== step?.round ? `${graph.rounds[nextS.round].label}: ` : '';
  const highlightNode = Math.min(nodeIndex, N - 1);
  const repeat = step?.repeat;
  const notationText = pattern.notation ?? '';

  const chart = (big: boolean) => (
    <ChartView
      pattern={pattern}
      highlightNode={highlightNode}
      dimAfter
      uptoRound={big ? undefined : Math.min(curRound + 1, graph.rounds.length - 1)}
      onNodeClick={(nid) => { if (nid !== nodeIndex) setJumpTarget(nid); }}
      className="ctr-chart__view"
    />
  );

  const wakeLabel = wake === 'unsupported' ? 'Keep screen on (not supported in this browser)' : wake === 'on' ? 'Screen stays on (tap to allow sleep)' : wake === 'denied' ? 'Keep screen on (the browser refused; tap to retry)' : 'Keep screen on';

  const menuItems = [
    { label: 'Jump to round…', icon: 'grid' as const, onSelect: () => setRoundsOpen(true) },
    { label: note ? `Edit note for ${graph.rounds[curRound]?.label}` : `Add a note to ${graph.rounds[curRound]?.label}`, icon: 'edit' as const, onSelect: () => setNoteOpen(true) },
    'separator' as const,
    { label: `Terms: ${terms} (switch to ${terms === 'US' ? 'UK' : 'US'})`, icon: 'auto' as const, onSelect: () => useSettings.getState().set({ terms: terms === 'US' ? 'UK' : 'US' }) },
    { label: `Click sound: ${P.sound ? 'on' : 'off'}`, icon: 'sparkle' as const, onSelect: () => { const v = !P.sound; setPrefs((x) => ({ ...DEFAULT_PREFS, ...x, sound: v })); if (v) click(); } },
    { label: vibrateSupported() ? `Vibrate on tap: ${P.haptics ? 'on' : 'off'}` : 'Vibrate on tap (not available here)', icon: 'counter' as const, disabled: !vibrateSupported(), onSelect: () => setPrefs((x) => ({ ...DEFAULT_PREFS, ...x, haptics: !P.haptics })) },
    'separator' as const,
    { label: 'Open in the Editor', icon: 'edit' as const, onSelect: () => navigate(patternHref('editor', id)) },
    { label: 'Start over…', icon: 'trash' as const, danger: true, onSelect: () => setResetOpen(true) },
  ];

  return (
    <div className="ctr-screen" data-reduced={reduced || undefined}>
      <div className="ctr-main">
        <header className="ctr-bar">
          <Link to="/counter" className="ctr-iconlink" aria-label="All counters"><Icon name="chevron-left" size={22} /></Link>
          <h1 className="ctr-title" title={title}>{title}</h1>
          <button
            type="button"
            className="ctr-toggle"
            aria-pressed={P.wake}
            disabled={wake === 'unsupported'}
            title={wakeLabel}
            aria-label={wakeLabel}
            onClick={() => setPrefs((x) => ({ ...DEFAULT_PREFS, ...x, wake: !P.wake }))}
          >
            <CtrIcon name={P.wake && wake === 'on' ? 'screen-on' : 'screen'} />
          </button>
          <button
            type="button"
            className="ctr-toggle ctr-phone-only"
            aria-pressed={P.chartOpen}
            aria-label={P.chartOpen ? 'Hide chart' : 'Show chart'}
            title={P.chartOpen ? 'Hide chart' : 'Show chart'}
            onClick={() => setPrefs((x) => ({ ...DEFAULT_PREFS, ...x, chartOpen: !P.chartOpen }))}
          >
            <Icon name="chart" size={20} />
          </button>
          <Menu label="Counter options" items={menuItems} />
        </header>

        <section className="ctr-progress" aria-label="Progress">
          <Ring fraction={checkpoint !== null ? 1 : pos.total ? pos.done / pos.total : pos.nodeFraction} label={`${R?.label ?? ''} progress`}>
            <b>{shownDone}</b><small>/{R?.stitchCount ?? 0}</small>
          </Ring>
          <div className="ctr-progress__text">
            <button type="button" className="ctr-roundbtn" onClick={() => setRoundsOpen(true)} aria-label={`${R?.label}, change round`}>
              <span className="ctr-roundbtn__label">{finished ? 'Finished' : R?.label}</span>
              <span className="ctr-roundbtn__of">of {graph.rounds.length}</span>
              <Icon name="chevron-right" size={16} />
            </button>
            <div className="ctr-meta">
              <span>{finished ? 'all rounds done' : `${shownDone} / ${R?.stitchCount ?? 0} sts`}</span>
              {repeat && !finished && <span className="ctr-rep">repeat {repeat.index} of {repeat.total}</span>}
            </div>
            <div className="ctr-piece" role="progressbar" aria-label="Whole piece" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos.pieceFraction * 100)}>
              <span style={{ width: `${pos.pieceFraction * 100}%` }} />
            </div>
            <div className="ctr-piece__label">
              {Math.round(pos.pieceFraction * 100)}% of the piece
              {pc?.roundRemainingMs !== undefined && !finished && checkpoint === null && <> · {fmtDuration(pc.roundRemainingMs).startsWith('<') ? '' : '~'}{fmtDuration(pc.roundRemainingMs)} left in round</>}
            </div>
          </div>
        </section>

        {notationText && lines && (
          <div className="ctr-phone-only ctr-src-wrap">
            <NotationLine strip text={notationText} lines={[{ ...lines, key: curRound }]} hl={step?.src} rep={step?.repeatSrc} label="Round as written" />
          </div>
        )}
        {note && (
          <button type="button" className="ctr-note" onClick={() => setNoteOpen(true)}>
            <Icon name="edit" size={16} /><span>{note}</span>
          </button>
        )}

        {P.chartOpen && <div className="ctr-minichart ctr-phone-only" data-no-tap>{chart(false)}</div>}

        <div
          className="ctr-tap"
          {...tap}
          role="button"
          tabIndex={-1}
          aria-label={checkpoint !== null ? 'Continue to the next round' : 'Done — next instruction'}
          data-state={finished ? 'finished' : checkpoint !== null ? 'checkpoint' : 'step'}
        >
          {finished ? (
            <div className="ctr-done">
              <div className="ctr-done__badge"><Icon name="check" size={40} /></div>
              <p className="ctr-done__title">Finished!</p>
              <p className="ctr-done__body">Fasten off and weave in the ends.{p && <> Worked over {fmtDuration(p.updatedAt - p.startedAt)}.</>}</p>
              <Button onClick={() => setResetOpen(true)}>Start over</Button>
            </div>
          ) : checkpoint !== null && expectation ? (
            <div className="ctr-check" aria-live="polite">
              <p className="ctr-check__kicker"><Icon name="check" size={18} /> {graph.rounds[checkpoint].label} done</p>
              <p className="ctr-check__title">Count your stitches</p>
              <p className="ctr-check__body">{expectation.text}.</p>
              {graph.rounds[checkpoint + 1]?.turned && <p className="ctr-check__turn">Turn your work.</p>}
              {p?.notes[checkpoint + 1] && <p className="ctr-check__note">Note for {graph.rounds[checkpoint + 1].label}: {p.notes[checkpoint + 1]}</p>}
              <p className="ctr-hint">Tap to start {graph.rounds[checkpoint + 1]?.label ?? 'the next round'}</p>
            </div>
          ) : (
            <>
              <p className="ctr-prev" aria-hidden="true">{prevS ? (prevS.round !== step?.round ? `${graph.rounds[prevS.round].label}: ${prevS.text}` : prevS.text) : ' '}</p>
              <div className="ctr-now">
                <p className={`ctr-now__text ${sizeClass(step?.text ?? '')}`} aria-live="polite">{keepTogether(step?.text ?? '')}</p>
              </div>
              <p className="ctr-now__meta">
                {step && <span>{positionText(step)}</span>}
                {step?.into && granularity !== 'round' && <span>into {step.into}</span>}
                {inStepDone > 0 && step && <span className="ctr-partial">{inStepDone} of {step.last - step.first + 1} done</span>}
              </p>
              <p className="ctr-next" aria-hidden="true"><span className="ctr-next__k">then</span> {nextS ? `${nextLabel}${nextS.text}` : 'finish'}</p>
              <p className="ctr-hint">Tap anywhere · swipe ← next · swipe → back</p>
            </>
          )}
        </div>

        <footer className="ctr-controls">
          <button type="button" className="ctr-btn ctr-btn--back" onClick={goBack} disabled={!p || (nodeIndex === 0 && checkpoint === null)} aria-label="Back one step">
            <CtrIcon name="back" /><span>Back</span>
          </button>
          <SegmentedControl label="Count by" options={GRAN_OPTIONS} value={granularity} onChange={setGran} className="ctr-gran" />
          <button type="button" className="ctr-btn" onClick={doUndo} disabled={!p?.history.length} aria-label="Undo">
            <CtrIcon name="undo" /><span>Undo</span>
          </button>
        </footer>
      </div>

      <aside className="ctr-side" aria-label="Chart and pattern">
        <div className="ctr-card ctr-chart">{chart(true)}</div>
        {notationText && (
          <div className="ctr-card">
            <h2 className="ctr-card__title">Pattern <small>as written{pattern.meta.terms ? ` (${pattern.meta.terms} terms)` : ''}</small></h2>
            <NotationLine
              text={notationText}
              lines={graph.rounds.map((Rr, r) => (Rr.src ? { from: Rr.src.line, to: Rr.src.endLine ?? Rr.src.line, current: r === curRound, key: r } : null)).filter((x, i, a) => x && a.findIndex((y) => y && y.from === x.from) === i) as { from: number; to: number; current?: boolean; key: number }[]}
              hl={step?.src}
              rep={step?.repeatSrc}
              label="Pattern as written"
            />
          </div>
        )}
        <div className="ctr-card">
          <h2 className="ctr-card__title">Note for {graph.rounds[curRound]?.label}</h2>
          <NoteEditor key={curRound} value={p?.notes[curRound] ?? ''} rows={2} onSave={(t) => update((s) => setNote(s, curRound, t, Date.now()))} />
        </div>
      </aside>

      <Dialog open={roundsOpen} onClose={() => setRoundsOpen(false)} title="Jump to round" sheet>
        <ul className="ctr-rounds">
          {graph.rounds.map((Rr, r) => {
            const done = Rr.last >= 0 && nodeIndex > Rr.last;
            const cur = r === curRound && !finished;
            return (
              <li key={r}>
                <button type="button" className="ctr-rounds__btn" aria-current={cur || undefined} onClick={() => { setRoundsOpen(false); if (!cur) jumpRound(r); }} disabled={Rr.first < 0}>
                  <span className="ctr-rounds__label">{Rr.label}</span>
                  <span className="ctr-rounds__count">{Rr.stitchCount} sts</span>
                  {p?.notes[r] && <Icon name="edit" size={14} aria-label="has a note" />}
                  <span className="ctr-rounds__state">{cur ? 'here' : done ? <Icon name="check" size={16} aria-label="done" /> : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Dialog>

      <NoteDialog
        open={noteOpen}
        label={graph.rounds[curRound]?.label ?? ''}
        value={p?.notes[curRound] ?? ''}
        onClose={() => setNoteOpen(false)}
        onSave={(t) => update((s) => setNote(s, curRound, t, Date.now()))}
      />

      <ConfirmDialog
        open={resetOpen}
        title="Start over?"
        body="The counter goes back to the first stitch. Your notes are kept, and Undo brings your place back."
        confirmLabel="Start over"
        danger
        onConfirm={() => { setCheckpoint(null); update((s) => resetProgress(s, graph, Date.now())); }}
        onClose={() => setResetOpen(false)}
      />

      <ConfirmDialog
        open={jumpTarget !== null}
        title="Jump here?"
        body={jumpTarget !== null && <JumpBody list={list} graph={pattern} id={jumpTarget} />}
        confirmLabel="Jump"
        onConfirm={() => { if (jumpTarget !== null) { setCheckpoint(null); update((s) => jumpToNode(s, graph, jumpTarget, Date.now())); } }}
        onClose={() => setJumpTarget(null)}
      />
    </div>
  );
}

function JumpBody({ list, graph, id }: { list: StepList; graph: Pattern; id: number }) {
  const s = list.steps[list.stepOfNode[id]];
  const R = graph.graph.rounds[graph.graph.nodes[id]?.round ?? 0];
  if (!s || !R) return null;
  return <p>Continue from <b>{R.label}</b>, {positionText(s)}: <b>{s.text}</b>. Undo brings you back.</p>;
}

function NoteEditor({ value, onSave, rows = 3 }: { value: string; onSave: (t: string) => void; rows?: number }) {
  const [t, setT] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <textarea
      className="ctr-notearea"
      value={t}
      placeholder="e.g. changed to the blue ball here"
      rows={rows}
      onChange={(e) => { const v = e.target.value; setT(v); clearTimeout(timer.current); timer.current = setTimeout(() => onSave(v), 400); }}
      onBlur={() => { clearTimeout(timer.current); if (t !== value) onSave(t); }}
    />
  );
}

function NoteDialog({ open, label, value, onClose, onSave }: { open: boolean; label: string; value: string; onClose: () => void; onSave: (t: string) => void }) {
  const [t, setT] = useState(value);
  useEffect(() => { if (open) setT(value); }, [open, value]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Note for ${label}`}
      sheet
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { onSave(t); onClose(); }}>Save note</Button></>}
    >
      <textarea className="ctr-notearea" value={t} onChange={(e) => setT(e.target.value)} rows={4} placeholder="e.g. changed to the blue ball here" autoFocus />
    </Dialog>
  );
}

