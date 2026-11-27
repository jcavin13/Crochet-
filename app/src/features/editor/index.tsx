import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Icon, Menu, Page, SegmentedControl, SplitPane, buttonClass, toast,
} from '@/ui';
import { compilerAvailable, type Diagnostic } from '@/app/coreApi';
import { patternHref, useCurrentPattern } from '@/app/hooks';
import { PatternPicker } from '@/app/PatternPicker';
import { exportPattern } from '@/app/patternActions';
import { useLibrary } from '@/store/library';
import { forkTitle } from '@/store/text';
import { useSettings } from '@/store/settings';
import { NotationEditor, type NotationEditorHandle } from './NotationEditor';
import { parse, print } from '@/core/notation';
import { compile, stripSrc, type Terms } from '@/core/graph';
import { DiagnosticsList, RoundsTable, type Hint } from './Panels';
import { FlatnessCard } from './FlatnessCard';
import { useStitchParams } from '@/app';
import type { ParamSet } from '@/core/params';
import { SymmetryPanel, useSymmetry } from '@/features/symmetry/SymmetryPanel';
import { NewPatternDialog } from './NewPatternDialog';
import './editor.css';

export default function EditorPage() {
  const params = useParams();
  const navigate = useNavigate();
  const cur = useCurrentPattern();
  const [newOpen, setNewOpen] = useState(false);

  // Show the resolved id in the URL so the page is linkable.
  useEffect(() => {
    if (!params.id && cur.id && cur.status === 'ready') navigate(patternHref('editor', cur.id), { replace: true });
  }, [params.id, cur.id, cur.status, navigate]);

  if (cur.status === 'loading') return <div className="shell-loading" role="progressbar" aria-label="Loading"><span /></div>;
  if (cur.status === 'missing' || !cur.record) {
    return (
      <Page>
        <EmptyState
          title="Pattern not found"
          actions={<><Link className={buttonClass()} to="/library">Open the library</Link><Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>New pattern</Button></>}
        >
          It may have been deleted, or it lives in another browser. Patterns are stored on the device where you made them.
        </EmptyState>
        <NewPatternDialog open={newOpen} onClose={() => setNewOpen(false)} />
      </Page>
    );
  }
  return <EditorView cur={cur} onNew={() => setNewOpen(true)} newDialog={<NewPatternDialog open={newOpen} onClose={() => setNewOpen(false)} />} />;
}

function EditorView({ cur, onNew, newDialog }: { cur: ReturnType<typeof useCurrentPattern>; onNew: () => void; newDialog: React.ReactNode }) {
  const navigate = useNavigate();
  const editor = useRef<NotationEditorHandle>(null);
  const [pane, setPane] = useState('notation');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saving = useLibrary((s) => (cur.id ? !!s.saving[cur.id] : false));
  const terms = useSettings((s) => s.terms);
  const setSettings = useSettings((s) => s.set);
  const rec = cur.record!;
  const { selected } = useStitchParams(cur.pattern);
  const params = selected as unknown as ParamSet;
  const sym = useSymmetry(cur.pattern);
  // undo stack for applied fixes (texts before each fix); survives the fork of a built-in
  const [undo, setUndo] = useState<{ text: string; label: string }[]>([]);

  const counts = { error: 0, warning: 0, info: 0 };
  for (const d of cur.diagnostics) if (d.code !== 'I_NO_COMPILER') counts[d.severity]++;
  const problems = counts.error + counts.warning + counts.info;

  const onChange = useCallback((text: string) => {
    if (!cur.readOnly) return cur.setText(text);
    // Typing into a built-in: fork it into My patterns and keep going there.
    const copy = useLibrary.getState().create({ text, title: forkTitle(text, rec), origin: 'user' });
    navigate(patternHref('editor', copy.id), { replace: true });
    toast('Copied to My patterns — your edits are saved there.');
  }, [cur, rec, navigate]);

  const applyFix = useCallback((text: string, label: string) => {
    setUndo((u) => [...u.slice(-19), { text: cur.text, label }]);
    onChange(text);
    if (!cur.readOnly) toast(label ? `Applied — ${label}` : 'Applied');
  }, [cur.text, cur.readOnly, onChange]);
  const undoFix = useCallback(() => {
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo(undo.slice(0, -1));
    onChange(last.text);
    toast('Fix undone');
  }, [undo, onChange]);

  // symmetry defects as hints in the Problems list, positioned by the nodes' source spans
  const hints = useMemo<Hint[]>(() => {
    if (!sym || !cur.pattern) return [];
    const nodes = cur.pattern.graph.nodes;
    return sym.defects.flatMap((d) => {
      const src = d.nodes.map((id) => nodes[id]?.src).filter((x): x is NonNullable<typeof x> => !!x);
      if (!src.length) return [];
      const a = src.reduce((m, x) => (x.line < m.line || (x.line === m.line && x.col < m.col) ? x : m));
      const b = src.reduce((m, x) => {
        const el = x.endLine ?? x.line, ec = x.endCol ?? x.col + 1;
        const ml = m.endLine ?? m.line, mc = m.endCol ?? m.col + 1;
        return el > ml || (el === ml && ec > mc) ? x : m;
      });
      return [{ message: d.message, line: a.line, col: a.col, endLine: b.endLine ?? b.line, endCol: b.endCol ?? b.col + 1, kind: 'Symmetry' }];
    });
  }, [sym, cur.pattern]);

  const jump = useCallback((d: Pick<Diagnostic, 'line' | 'col'> & Partial<Diagnostic>) => {
    setPane('notation');
    requestAnimationFrame(() => editor.current?.jumpTo(d.line, d.col, d.endLine, d.endCol));
  }, []);

  // US/UK: rewrite the notation in the other dialect (parse → print), keeping the compiled graph.
  const textTerms = useMemo<Terms>(() => (/^\s*terms\s*:\s*UK\b/im.test(headerBlock(cur.text)) ? 'UK' : 'US'), [cur.text]);
  const convertTerms = (v: Terms) => {
    if (v === textTerms) { if (terms !== v) setSettings({ terms: v }); return; }
    const res = convertNotationTerms(cur.text, v);
    if (!res.ok) { toast(res.reason, { tone: 'error' }); return; }
    setSettings({ terms: v });
    onChange(res.text);
    if (!cur.readOnly) toast(`Converted to ${v} terms${res.droppedComments ? ' (comments inside the rounds were removed)' : ''}.`);
  };

  const save = () => { void useLibrary.getState().flush().then(() => toast(cur.readOnly ? 'Examples are read-only — type to make your own copy.' : 'Saved on this device')); };

  const status = cur.readOnly
    ? <Badge tone="outline">Example · read-only</Badge>
    : saving ? <Badge tone="neutral">Saving…</Badge> : <Badge tone="ok"><Icon name="check" size={12} />Saved</Badge>;

  const check = !compilerAvailable ? <Badge tone="info">checker pending</Badge>
    : cur.pending ? <Badge>checking…</Badge>
    : counts.error ? <Badge tone="error" dot>{counts.error} error{counts.error > 1 ? 's' : ''}</Badge>
    : counts.warning ? <Badge tone="warning" dot>{counts.warning} warning{counts.warning > 1 ? 's' : ''}</Badge>
    : <Badge tone="ok" dot>checks out</Badge>;

  const rounds = cur.pattern?.graph.rounds;

  return (
    <Page wide className="ed-page">
      <header className="ed-head">
        <div className="ed-head__title">
          <div className="ed-head__kicker">Editor</div>
          <h1>{rec.title}</h1>
          <div className="row ed-head__status">{status}{check}{rounds && <span className="muted small">{rounds.length} rounds · {rounds[rounds.length - 1]?.stitchCount ?? 0} sts in the last</span>}</div>
        </div>
        <div className="ed-head__actions">
          <SegmentedControl
            label="Terminology"
            value={textTerms}
            onChange={(v) => convertTerms(v)}
            options={[{ value: 'US', label: 'US', title: 'US terms (sc, dc…)' }, { value: 'UK', label: 'UK', title: 'UK terms (dc, tr…)' }]}
          />
          <div className="ed-open" role="group" aria-label="Open this pattern in">
            <Link className={buttonClass('default', 'sm')} to={patternHref('chart', cur.id!)}><Icon name="chart" size={18} />Chart</Link>
            <Link className={buttonClass('default', 'sm')} to={patternHref('sim', cur.id!)}><Icon name="cube" size={18} />3D</Link>
            <Link className={buttonClass('default', 'sm')} to={patternHref('counter', cur.id!)}><Icon name="counter" size={18} />Counter</Link>
          </div>
          <Menu
            label="Pattern actions"
            items={[
              { label: 'New pattern…', icon: 'plus', onSelect: onNew },
              { label: cur.readOnly ? 'Duplicate to My patterns' : 'Duplicate', icon: 'copy', onSelect: () => { cur.duplicate(); toast('Duplicated'); } },
              'separator',
              { label: 'Download notation (.cro)', icon: 'download', onSelect: () => exportPattern(rec, 'cro') },
              { label: 'Download graph (.crochet.json)', icon: 'download', onSelect: () => exportPattern(rec, 'json'), disabled: !cur.pattern },
              ...(!cur.readOnly ? ['separator' as const, { label: 'Delete…', icon: 'trash' as const, danger: true, onSelect: () => setConfirmDelete(true) }] : []),
            ]}
          />
        </div>
      </header>

      {cur.readOnly && (
        <div className="ed-banner">
          <Icon name="info" />
          <span>This is a built-in example. Start typing to make your own copy, or <button type="button" className="ed-linkbtn" onClick={() => { cur.duplicate(); toast('Copied to My patterns'); }}>duplicate it</button>.</span>
        </div>
      )}

      <SplitPane
        label="Editor view"
        active={pane}
        onActiveChange={setPane}
        columns="minmax(0, 1.35fr) minmax(320px, 1fr)"
        panes={[
          {
            id: 'notation',
            label: 'Notation',
            content: (
              <Card flush className="ed-card">
                <div className="ed-toolbar">
                  <PatternPicker value={cur.id} label="Pattern" />
                </div>
                <div className="ed-scroll">
                  <NotationEditor ref={editor} value={cur.text} onChange={onChange} diagnostics={cur.diagnostics} stale={cur.pending} onSave={save} />
                </div>
              </Card>
            ),
          },
          {
            id: 'check',
            label: <>Check {compilerAvailable && problems > 0 && <Badge tone={counts.error ? 'error' : counts.warning ? 'warning' : 'info'}>{problems}</Badge>}</>,
            content: (
              <div className="ed-side">
                <Card>
                  <h2 className="ed-side__title">Problems</h2>
                  <DiagnosticsList diagnostics={cur.diagnostics.filter((d) => d.code !== 'I_NO_COMPILER')} onJump={jump} compilerReady={compilerAvailable} hints={hints} />
                </Card>
                <Card>
                  <h2 className="ed-side__title">Stitch counts</h2>
                  {cur.pattern ? (
                    <>
                      <RoundsTable pattern={cur.pattern} onJump={(line) => jump({ line, col: 1 })} />
                      <div className="ed-sym">
                        <SymmetryPanel
                          pattern={cur.pattern}
                          report={sym}
                          compact
                          showLabel="Show in text"
                          onSelectRound={(r) => { const l = cur.pattern?.graph.rounds[r]?.src?.line; if (l) jump({ line: l, col: 1 }); }}
                          onSelectNodes={(ids) => { const h = hints.find((x) => sym?.defects.some((d) => d.nodes === ids && d.message === x.message)); if (h) jump(h); }}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="muted small" style={{ margin: 0 }}>
                      {compilerAvailable ? 'Fix the errors above to see per-round counts.' : 'Per-round counts appear here once the checker is available.'}
                    </p>
                  )}
                </Card>
                {cur.pattern && (
                  <Card>
                    <h2 className="ed-side__title">Flatness</h2>
                    <FlatnessCard
                      pattern={cur.pattern}
                      text={cur.text}
                      params={params}
                      symmetry={sym}
                      busy={cur.pending}
                      onApply={applyFix}
                      onUndo={undo.length ? undoFix : undefined}
                      undoLabel={undo[undo.length - 1]?.label}
                      onJump={(line) => jump({ line, col: 1 })}
                    />
                  </Card>
                )}
              </div>
            ),
          },
        ]}
      />
      <p className="ed-hint muted small">
        Notation guide: <code>spec/notation.md</code>. Saved automatically in this browser · <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd> saves now.
      </p>

      {newDialog}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this pattern?"
        body={<>“{rec.title}” will be removed from this device. Download it first if you want to keep a copy.</>}
        confirmLabel="Delete"
        danger
        onConfirm={() => { void useLibrary.getState().remove(rec.id); navigate('/library'); toast('Pattern deleted'); }}
      />
    </Page>
  );
}

/** Lines before the first round line (headers and comments). */
function headerBlock(text: string): string {
  const m = /^\s*(Rnds?|Rounds?|R|Rows?|Foundation|Start|Setup)\b[^:\n]*:/im.exec(text);
  return m ? text.slice(0, m.index) : text;
}

/**
 * Rewrite notation in US or UK terms (parse → print), only when it parses without errors and the
 * result compiles to the same graph. Comment lines at the top are kept; the printer drops others.
 */
function convertNotationTerms(text: string, terms: Terms): { ok: true; text: string; droppedComments: boolean } | { ok: false; reason: string } {
  const p = parse(text);
  const errs = p.diagnostics.filter((d) => d.severity === 'error');
  if (errs.length) {
    const d = errs[0];
    return { ok: false, reason: `Can't switch to ${terms} terms while the notation has ${errs.length === 1 ? 'an error' : `${errs.length} errors`} (line ${d.line}: ${d.message.replace(/\.$/, '')}). Fix ${errs.length === 1 ? 'it' : 'them'} first.` };
  }
  let out = print(p.ast, { terms });
  const before = compile(p.ast);
  if (before.pattern) {
    const after = compile(parse(out).ast);
    if (!after.pattern || JSON.stringify(stripSrc(after.pattern).graph) !== JSON.stringify(stripSrc(before.pattern).graph)) {
      return { ok: false, reason: `Can't switch to ${terms} terms: the converted text would not give the same stitches. The notation is unchanged.` };
    }
  }
  const lines = text.split(/\r?\n/);
  const lead: string[] = [];
  for (const l of lines) { if (/^\s*#/.test(l)) lead.push(l); else if (l.trim()) break; }
  const total = lines.filter((l) => /^\s*#/.test(l) || /\s#/.test(l)).length;
  if (lead.length) out = `${lead.join('\n')}\n${out}`;
  return { ok: true, text: out, droppedComments: total > lead.length };
}
