// Doily designer: choose a symmetry order and motif rules, get a valid, flatness-checked pattern.
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Button, Card, Icon, IconButton, Input, Menu, Page, PageHeader, SegmentedControl, ShapeBadge, Slider, SplitPane, Toggle, toast,
} from '@/ui';
import { patternHref } from '@/app';
import { useLibrary, usePersistentState } from '@/store';
import { ChartView } from '@/features/chart/ChartView';
import { PRESETS, MOTIFS, type GenerateResult, type Height, type TargetShape } from '@/core/generate';
import { paramsFile } from '@/core/params';
import { StackEditor, paramSummary, pct } from './StackEditor';
import { clampSym, compute, initialState, shareCode, type DesignerState, type Mode } from './state';
import './designer.css';

const HEIGHTS: Height[] = ['sc', 'hdc', 'dc', 'tr'];

export default function DesignerPage() {
  const [state, setState, hydrated] = usePersistentState<DesignerState>('designer:state', initialState);
  if (!hydrated) return <div className="shell-loading" role="progressbar" aria-label="Loading"><span /></div>;
  const s = state?.v === 1 ? state : initialState;
  return <Designer state={s} setState={setState} />;
}

function Designer({ state, setState }: { state: DesignerState; setState: (s: DesignerState) => void }) {
  const navigate = useNavigate();
  const [pane, setPane] = useState('design');
  const saved = useRef<{ text: string; id: string } | null>(null);
  const patch = (p: Partial<DesignerState>) => setState({ ...state, ...p });
  const patchRandom = (p: Partial<DesignerState['random']>) => patch({ random: { ...state.random, ...p } });

  const deferred = useDeferredValue(state);
  const { spec, result, params } = useMemo(() => compute(deferred), [deferred]);
  const stale = deferred !== state;

  const ensureSaved = () => {
    if (saved.current?.text === result.text) return saved.current.id;
    const rec = useLibrary.getState().create({ text: result.text, origin: 'designer' });
    saved.current = { text: result.text, id: rec.id };
    return rec.id;
  };
  const save = () => {
    const again = saved.current?.text === result.text;
    const id = ensureSaved();
    toast(again ? 'Already in My patterns' : 'Saved to My patterns', { action: { label: 'Open', onClick: () => navigate(patternHref('editor', id)) } });
  };
  const open = (feature: string) => navigate(patternHref(feature, ensureSaved()));

  const toGuided = () => {
    patch({ mode: 'guided', symmetry: spec.symmetry, rounds: spec.rounds.map((r) => ({ motif: r.motif, params: { ...(r.prefer ?? {}), ...(r.params ?? {}) } })), presetId: undefined });
    toast('Copied into the round stack — edit away.');
  };

  const shape = overallShape(result);
  const summary = (
    <div className="dz-summary" aria-live="polite">
      <ShapeBadge shape={shape}>{shape === 'flat' ? 'Lies flat' : shape === 'cup' ? 'Cups' : 'Ruffles'}</ShapeBadge>
      <span>{result.stats.rounds} rnds</span>
      <span>{(result.stats.diameterMm / 10).toFixed(1)} cm</span>
      {stale && <Badge>updating…</Badge>}
    </div>
  );

  const controls = (
    <div className="dz-controls">
      <SegmentedControl<Mode>
        label="How to design"
        className="dz-modes"
        value={state.mode}
        onChange={(mode) => patch({ mode })}
        options={[{ value: 'guided', label: 'Build' }, { value: 'random', label: 'Surprise me' }, { value: 'presets', label: 'Presets' }]}
      />

      <Card className="dz-card">
        <div className="dz-sym">
          <div>
            <div className="dz-label">Repeats around</div>
            <div className="small muted">{state.mode === 'random' && state.random.anySymmetry ? 'chosen by the seed' : `${clampSym(state.symmetry)}-fold symmetry`}</div>
          </div>
          <div className="dz-stepper" role="group" aria-label="Symmetry order">
            <IconButton icon="chevron-left" label="Fewer repeats" disabled={state.symmetry <= 3} onClick={() => patch({ symmetry: clampSym(state.symmetry - 1) })} />
            <output className="dz-stepper__val" aria-live="polite">{clampSym(state.symmetry)}</output>
            <IconButton icon="chevron-right" label="More repeats" disabled={state.symmetry >= 24} onClick={() => patch({ symmetry: clampSym(state.symmetry + 1) })} />
          </div>
        </div>
      </Card>

      {state.mode === 'guided' && (
        <Card className="dz-card">
          <div className="dz-card__head"><span className="dz-label">Rounds</span><span className="small muted">from the centre out · tap a round for its settings</span></div>
          <StackEditor rounds={state.rounds} result={result} onChange={(rounds) => patch({ rounds, presetId: undefined })} />
        </Card>
      )}

      {state.mode === 'random' && (
        <Card className="dz-card stack">
          <div className="dz-seed">
            <label className="dz-label" htmlFor="dz-seed">Seed</label>
            <Input id="dz-seed" inputMode="numeric" value={String(state.random.seed)} onChange={(e) => { const v = parseInt(e.target.value.replace(/\D/g, ''), 10); patchRandom({ seed: Number.isFinite(v) ? v : 0 }); }} />
            <Button variant="primary" icon="sparkle" onClick={() => patchRandom({ seed: Math.floor(Math.random() * 1_000_000) })}>Surprise me</Button>
          </div>
          <p className="small muted dz-share">Share: <code>{shareCode(state, spec)}</code></p>
          <Slider label="Fewest rounds" min={3} max={16} value={state.random.roundsMin} onChange={(v) => patchRandom({ roundsMin: v, roundsMax: Math.max(v, state.random.roundsMax) })} />
          <Slider label="Most rounds" min={3} max={16} value={state.random.roundsMax} onChange={(v) => patchRandom({ roundsMax: v, roundsMin: Math.min(v, state.random.roundsMin) })} />
          <Slider label="Largest diameter" min={0} max={60} step={2} value={state.random.maxCm} format={(v) => (v ? `${v} cm` : 'any')} onChange={(v) => patchRandom({ maxCm: v })} />
          <Toggle label="Let the seed choose the symmetry" checked={state.random.anySymmetry} onChange={(v) => patchRandom({ anySymmetry: v })} />
          <div className="dz-picked">
            <div className="dz-label">This design</div>
            <ol className="dz-mini">
              {result.rounds.map((r) => <li key={r.number}><span>{MOTIFS[r.motif].label}</span><ShapeBadge shape={r.class === 'n/a' ? 'flat' : r.class} /></li>)}
            </ol>
            <Button icon="edit" onClick={toGuided}>Edit these rounds</Button>
          </div>
        </Card>
      )}

      {state.mode === 'presets' && (
        <div className="dz-presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="dz-preset"
              aria-pressed={state.presetId === p.id}
              onClick={() => patch({
                presetId: p.id, symmetry: p.spec.symmetry, rounds: p.spec.rounds, title: '',
                target: p.spec.target ?? { shape: 'flat' }, lacy: p.spec.style?.lacy ?? state.lacy,
              })}
            >
              <span className="dz-preset__name">{p.label}</span>
              <span className="dz-preset__meta">{p.spec.symmetry}-fold · {p.spec.rounds.length} rounds</span>
              <span className="dz-preset__blurb">{p.blurb}</span>
            </button>
          ))}
          <p className="small muted">Picking a preset loads it into <button type="button" className="dz-link" onClick={() => patch({ mode: 'guided' })}>Build</button>, where every round can be changed.</p>
        </div>
      )}

      <Card className="dz-card stack">
        <div className="dz-label">Shape</div>
        <SegmentedControl<TargetShape>
          label="Target shape"
          value={state.target.shape}
          onChange={(shape) => patch({ target: { ...state.target, shape } })}
          options={[{ value: 'flat', label: 'Flat' }, { value: 'ruffle', label: 'Ruffled edge' }, { value: 'bowl', label: 'Bowl' }]}
        />
        {state.target.shape !== 'flat' && (
          <>
            <Slider label="Rounds off flat" min={1} max={4} value={state.target.rounds ?? 2} onChange={(v) => patch({ target: { ...state.target, rounds: v } })} format={(v) => `last ${v}`} />
            <Slider label={state.target.shape === 'ruffle' ? 'How much over' : 'How much under'} min={0.05} max={0.4} step={0.05} value={state.target.amount ?? 0.15} onChange={(v) => patch({ target: { ...state.target, amount: v } })} format={(v) => `${Math.round(v * 100)}% past flat`} />
          </>
        )}
        <Slider label="Texture" min={0} max={1} step={0.05} value={state.lacy} onChange={(v) => patch({ lacy: v })} format={(v) => (v < 0.34 ? 'solid' : v > 0.66 ? 'lacy' : 'balanced')} hint="Breaks ties between flat choices: longer chains when lacy." />
        <div className="ui-field">
          <span className="ui-field__label"><span>Stitch heights</span></span>
          <div className="row" role="group" aria-label="Stitch heights the solver may use">
            {HEIGHTS.map((h) => {
              const on = state.heights.includes(h);
              return (
                <button key={h} type="button" className="dz-toggle" aria-pressed={on}
                  onClick={() => { const next = on ? state.heights.filter((x) => x !== h) : HEIGHTS.filter((x) => x === h || state.heights.includes(x)); if (next.length) patch({ heights: next }); }}>
                  {state.terms === 'UK' ? ({ sc: 'dc', hdc: 'htr', dc: 'tr', tr: 'dtr' } as const)[h] : h}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="dz-card stack">
        <div className="dz-label">Yarn &amp; text</div>
        <label className="ui-field">
          <span className="ui-field__label"><span>Yarn and hook</span></span>
          <select className="ui-select" value={state.paramsId} onChange={(e) => patch({ paramsId: e.target.value })}>
            {paramsFile.sets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <SegmentedControl<'US' | 'UK'> label="Terms" value={state.terms} onChange={(terms) => patch({ terms })} options={[{ value: 'US', label: 'US terms' }, { value: 'UK', label: 'UK terms' }]} />
        <label className="ui-field">
          <span className="ui-field__label"><span>Title</span></span>
          <Input value={state.title} placeholder={result.text.match(/^title: (.*)$/m)?.[1] ?? ''} onChange={(e) => patch({ title: e.target.value })} />
        </label>
      </Card>

      <div className="dz-jump">
        {summary}
        <Button variant="primary" onClick={() => { setPane('result'); window.scrollTo({ top: 0 }); }}>View pattern <Icon name="chevron-right" size={18} /></Button>
      </div>
    </div>
  );

  const results = <Results result={result} params={params} summary={summary} stale={stale} />;

  return (
    <Page wide className="dz-page">
      <PageHeader
        kicker="Generative designer"
        title="Doily designer"
        description="Pick a symmetry and the motifs; every round is solved so it lies flat (or ruffles or cups, if you ask), and the result is ordinary notation you can edit."
        actions={
          <>
            <Button variant="primary" icon="library" onClick={save}>Save to my patterns</Button>
            <Menu
              label="Open in…"
              trigger={<Button icon="more">Open in…</Button>}
              items={[
                { label: 'Editor', icon: 'edit', onSelect: () => open('editor') },
                { label: 'Chart', icon: 'chart', onSelect: () => open('chart') },
                { label: '3D view', icon: 'cube', onSelect: () => open('sim') },
                { label: 'Counter', icon: 'counter', onSelect: () => open('counter') },
              ]}
            />
          </>
        }
      />
      <SplitPane
        label="Designer"
        className="dz-split"
        columns="minmax(340px, 420px) minmax(0, 1fr)"
        active={pane}
        onActiveChange={setPane}
        panes={[
          { id: 'design', label: 'Design', content: controls },
          { id: 'result', label: 'Pattern', content: results },
        ]}
      />
    </Page>
  );
}

function overallShape(r: GenerateResult): 'flat' | 'cup' | 'ruffle' {
  const bad = r.rounds.filter((x) => x.class === 'cup' || x.class === 'ruffle');
  if (!bad.length) return 'flat';
  return bad[bad.length - 1].class as 'cup' | 'ruffle';
}

function Results({ result, params, summary, stale }: { result: GenerateResult; params: ReturnType<typeof compute>['params']; summary: React.ReactNode; stale: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(result.text); toast('Notation copied'); }
    catch { toast('Copy failed — select the text and copy it by hand', { tone: 'error' }); }
  };
  const st = result.stats;
  const rows = showAll ? result.rounds : result.rounds.slice(-6);
  return (
    <div className="dz-results" data-stale={stale}>
      <div className="dz-stats" aria-label="Pattern statistics">
        <Stat k="Rounds" v={String(st.rounds)} />
        <Stat k="Stitches" v={st.stitches.toLocaleString()} />
        <Stat k="Diameter" v={`${(st.diameterMm / 10).toFixed(1)} cm`} hint={params.label} />
        <Stat k="Yarn" v={`≈ ${st.yarnM < 10 ? st.yarnM.toFixed(1) : Math.round(st.yarnM)} m`} hint="rough: summed stitch sizes" />
      </div>

      <Card flush className="dz-chart">
        {result.pattern ? <ChartView pattern={result.pattern} params={params} showFlatness /> : <p className="dz-pad">The generated text did not compile — see the warnings below.</p>}
      </Card>

      <Card className="dz-card">
        <div className="dz-card__head">
          <span className="dz-label">Flatness</span>
          {summary}
        </div>
        {result.warnings.length > 0 && (
          <ul className="dz-warn">
            {result.warnings.map((w, i) => <li key={i}><Icon name="alert" size={16} /> <span>{w}</span></li>)}
          </ul>
        )}
        <table className="dz-table">
          <thead><tr><th scope="col">Rnd</th><th scope="col">Motif</th><th scope="col">Shape</th><th scope="col" className="dz-num-col">Excess</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.number}>
                <td>{r.number}</td>
                <td>
                  <span className="dz-motif">{MOTIFS[r.motif].label}{r.auto ? <Badge tone="outline">added</Badge> : null}</span>
                  <span className="dz-motif__sum">{paramSummary(r)}</span>
                </td>
                <td>{r.class === 'n/a' ? '—' : <ShapeBadge shape={r.class} />}{r.aim !== 'flat' && <span className="small muted"> aim: {r.aim === 'cup' ? 'cup' : 'ruffle'}</span>}</td>
                <td className="dz-num-col" title={`flat window ${pct(r.eMin)} … ${pct(r.eMax)}`}>{pct(r.e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.rounds.length > 6 && (
          <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show the outer rounds only' : `Show all ${result.rounds.length} rounds`}</Button>
        )}
      </Card>

      <Card className="dz-card">
        <div className="dz-card__head">
          <span className="dz-label">Notation</span>
          <span className="small muted">read-only here · {result.diagnostics.length ? `${result.diagnostics.length} problems` : 'checked: 0 errors, 0 warnings'}</span>
          <span className="spacer" />
          <Button size="sm" icon="copy" onClick={copy}>Copy</Button>
        </div>
        <pre className="dz-code" tabIndex={0} aria-label="Generated notation">{result.text}</pre>
      </Card>
    </div>
  );
}

function Stat({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="dz-stat" title={hint}>
      <span className="dz-stat__k">{k}</span>
      <span className="dz-stat__v">{v}</span>
      {hint && <span className="dz-stat__h">{hint}</span>}
    </div>
  );
}
