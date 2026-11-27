// Doily designer: a layer-by-layer builder with suggestions, visible automatic sizing, undo/redo,
// a build-up scrubber on the chart, symmetry analysis and a blocking template.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Button, Card, Icon, IconButton, Input, Menu, Page, PageHeader, SegmentedControl, ShapeBadge, Slider, SplitPane, Toggle, toast,
} from '@/ui';
import { patternHref } from '@/app';
import { useLibrary } from '@/store';
import { ChartView } from '@/features/chart/ChartView';
import { SymmetryPanel } from '@/features/symmetry/SymmetryPanel';
import { PRESETS, MOTIFS, compatibleOrders, planDoily, type GenerateResult, type Height, type TargetShape } from '@/core/generate';
import { doilyTemplateSvg } from '@/core/generate/snowflake';
import { paramsFile } from '@/core/params';
import { historyOf, record, redo, sync, undo, type History } from './history';
import { LayerBuilder, paramSummary, pct } from './LayerBuilder';
import { SuggestionsPanel } from './Suggestions';
import { TemplateCard } from './TemplateCard';
import { RedoIcon, UndoIcon } from './icons';
import { clampSym, compute, resolveUnlocked, shareCode, toLayers, type DesignerState, type Layer, type Mode } from './state';

const HEIGHTS: Height[] = ['sc', 'hdc', 'dc', 'tr'];
type Design = Pick<DesignerState, 'symmetry' | 'rounds'>;
const designOf = (s: DesignerState): Design => ({ symmetry: s.symmetry, rounds: s.rounds });
const cm = (mm: number) => `${(mm / 10).toFixed(1)} cm`;

/** Save / open-in helpers shared by both designers. */
export function useSaveOpen(text: string) {
  const navigate = useNavigate();
  const saved = useRef<{ text: string; id: string } | null>(null);
  const ensureSaved = () => {
    const lib = useLibrary.getState();
    if (saved.current?.text === text && lib.records[saved.current.id]) return saved.current.id;
    const existing = Object.values(lib.records).find((r) => r.origin === 'designer' && r.text === text);
    if (existing) { saved.current = { text, id: existing.id }; return existing.id; }
    const rec = lib.create({ text, origin: 'designer' });
    saved.current = { text, id: rec.id };
    return rec.id;
  };
  const save = () => {
    const again = saved.current?.text === text || Object.values(useLibrary.getState().records).some((r) => r.origin === 'designer' && r.text === text);
    const id = ensureSaved();
    toast(again ? 'Already in My patterns' : 'Saved to My patterns', { action: { label: 'Open', onClick: () => navigate(patternHref('editor', id)) } });
  };
  const open = (feature: string) => navigate(patternHref(feature, ensureSaved()));
  const actions = (
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
  );
  return { save, open, actions };
}

export function copyText(text: string) {
  navigator.clipboard.writeText(text).then(() => toast('Notation copied'), () => toast('Copy failed — select the text and copy it by hand', { tone: 'error' }));
}

export function DoilyDesigner({ state, setState, kindSwitch }: { state: DesignerState; setState: (s: DesignerState) => void; kindSwitch: ReactNode }) {
  const [pane, setPane] = useState('design');
  const [selected, setSelected] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hist, setHist] = useState<History<Design>>(() => historyOf(designOf(state)));
  const stateRef = useRef(state);
  stateRef.current = state;

  const patch = (p: Partial<DesignerState>) => setState({ ...state, ...p });
  const patchRandom = (p: Partial<DesignerState['random']>) => patch({ random: { ...state.random, ...p } });
  /** A design change (symmetry or layers): recorded for undo. */
  const commit = useCallback((d: Partial<Design>, extra: Partial<DesignerState> = {}) => {
    const s = stateRef.current;
    const next = { ...designOf(s), ...d };
    setHist((h) => record(sync(h, designOf(s)), next));
    setState({ ...s, ...extra, ...next });
  }, [setState]);
  const doUndo = useCallback(() => setHist((h) => { const u = undo(h); if (u !== h) setState({ ...stateRef.current, ...u.present }); return u; }), [setState]);
  const doRedo = useCallback(() => setHist((h) => { const u = redo(h); if (u !== h) setState({ ...stateRef.current, ...u.present }); return u; }), [setState]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo]);

  const deferred = useDeferredValue(state);
  const { spec, result, params } = useMemo(() => compute(deferred), [deferred]);
  const plan = useMemo(() => planDoily(spec, params), [spec, params]);
  const stale = deferred !== state;
  const { actions } = useSaveOpen(result.text);

  const setLayers = (rounds: Layer[]) => commit({ rounds }, { presetId: undefined });
  const selRound = selected !== null ? result.rounds.find((r) => r.source === selected && !r.auto) : undefined;
  const upto = scrub ?? (selRound ? selRound.number - 1 : undefined);
  const highlight = selRound && result.pattern ? result.pattern.graph.rounds[selRound.number - 1]?.first : undefined;

  const toGuided = () => {
    commit({ symmetry: spec.symmetry, rounds: toLayers(spec) }, { mode: 'guided', presetId: undefined });
    toast('Opened in the layer builder — every round can be changed.');
  };

  const shape = overallShape(result);
  const summary = (
    <div className="dz-summary" aria-live="polite">
      <ShapeBadge shape={shape}>{shape === 'flat' ? 'Lies flat' : shape === 'cup' ? 'Cups' : 'Ruffles'}</ShapeBadge>
      <span>{result.stats.rounds} rnds</span>
      <span>{cm(result.stats.diameterMm)}{state.targetCm ? ` of ${state.targetCm} cm` : ''}</span>
      {stale && <Badge>updating…</Badge>}
    </div>
  );

  const n = clampSym(state.symmetry);
  const orders = compatibleOrders(n);
  const lockedCount = state.rounds.filter((r) => r.locked).length;

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
            <div className="small muted">{state.mode === 'random' && state.random.anySymmetry ? 'chosen by the seed' : `${n}-fold symmetry: every round is ${n} identical repeats`}</div>
          </div>
          <div className="dz-stepper" role="group" aria-label="Symmetry order">
            <IconButton icon="chevron-left" label="Fewer repeats" disabled={state.symmetry <= 3} onClick={() => commit({ symmetry: clampSym(state.symmetry - 1) })} />
            <output className="dz-stepper__val" aria-live="polite">{n}</output>
            <IconButton icon="chevron-right" label="More repeats" disabled={state.symmetry >= 24} onClick={() => commit({ symmetry: clampSym(state.symmetry + 1) })} />
          </div>
        </div>
        {state.mode === 'guided' && (orders.divisors.length > 0 || orders.multiples.length > 0) && (
          <div className="dz-orders">
            <span className="small muted">Keeps the design's character:</span>
            {[...orders.divisors, ...orders.multiples].map((o) => (
              <button key={o} type="button" className="dz-toggle" onClick={() => commit({ symmetry: o })} title={o < n ? `${o} bigger repeats` : `${o} smaller repeats`}>{o}</button>
            ))}
            <span className="small muted dz-orders__note">
              Changing it re-solves every unlocked layer for the new count{lockedCount ? `; the ${lockedCount} locked layer${lockedCount > 1 ? 's keep their' : ' keeps its'} numbers per repeat, so stitch totals scale` : ''}.
              To go from {n} to {2 * n} points part-way out, open a layer and use “double the repeats”.
            </span>
          </div>
        )}
      </Card>

      {state.mode === 'guided' && (
        <Card className="dz-card">
          <div className="dz-card__head">
            <span className="dz-label">Layers</span>
            <span className="small muted">centre out · tap one for its numbers</span>
            <span className="spacer" />
            <div className="dz-undo" role="group" aria-label="History">
              <button type="button" className="dz-iconbtn" onClick={doUndo} disabled={!hist.past.length} aria-label="Undo" title="Undo (Ctrl+Z)"><UndoIcon /></button>
              <button type="button" className="dz-iconbtn" onClick={doRedo} disabled={!hist.future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><RedoIcon /></button>
            </div>
          </div>
          <LayerBuilder
            layers={state.rounds} spec={spec} plan={plan} result={result} params={params}
            selected={selected} onSelect={(i) => { setSelected(i); setScrub(null); }}
            onChange={(rounds) => setLayers(rounds)} onAdd={() => setAddOpen(true)}
          />
          <div className="dz-resolve">
            <Button size="sm" icon="auto" onClick={() => setLayers(resolveUnlocked(state.rounds))} disabled={!state.rounds.some((r) => !r.locked && (Object.keys(r.params ?? {}).length > 0))}>
              Re-solve all unlocked layers
            </Button>
            <span className="small muted">{lockedCount ? `${lockedCount} locked` : 'Lock a layer to keep its numbers.'}</span>
          </div>
          <SuggestionsPanel
            spec={spec} params={params} targetCm={state.targetCm} open={addOpen}
            onAdd={(layers) => { setLayers([...state.rounds, ...layers]); setSelected(state.rounds.length + layers.length - 1); }}
            onClose={() => setAddOpen(false)}
          />
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
          <Toggle label="Let the seed choose the symmetry" checked={state.random.anySymmetry} onChange={(v) => patchRandom({ anySymmetry: v })} />
          <div className="dz-picked">
            <div className="dz-label">This design</div>
            <ol className="dz-mini">
              {result.rounds.map((r) => <li key={r.number}><span>{MOTIFS[r.motif].label}</span><ShapeBadge shape={r.class === 'n/a' ? 'flat' : r.class} /></li>)}
            </ol>
            <Button variant="primary" icon="edit" onClick={toGuided}>Edit layer by layer</Button>
          </div>
        </Card>
      )}

      {state.mode === 'presets' && (
        <div className="dz-presets">
          {PRESETS.map((p) => (
            <button
              key={p.id} type="button" className="dz-preset" aria-pressed={state.presetId === p.id}
              onClick={() => commit({ symmetry: p.spec.symmetry, rounds: p.spec.rounds }, {
                presetId: p.id, title: p.spec.title ?? '', target: p.spec.target ?? { shape: 'flat' }, lacy: p.spec.style?.lacy ?? state.lacy,
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
        <div className="dz-label">Size &amp; yarn</div>
        <Slider
          label="Target size" min={0} max={60} step={1} value={state.targetCm}
          format={(v) => (v ? `about ${v} cm in ${params.label.split(',')[0].toLowerCase()}` : 'no target')}
          hint={state.targetCm ? `Now ${cm(result.stats.diameterMm)} across. Suggestions and “surprise me” keep to it.` : 'Suggestions and “surprise me” will keep to it.'}
          onChange={(v) => patch({ targetCm: v })}
        />
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

      <Card className="dz-card stack">
        <div className="dz-label">Shape</div>
        <SegmentedControl<TargetShape>
          label="Target shape" value={state.target.shape} onChange={(shape) => patch({ target: { ...state.target, shape } })}
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

      <div className="dz-jump">
        {summary}
        <Button variant="primary" onClick={() => { setPane('result'); window.scrollTo({ top: 0 }); }}>Chart <Icon name="chevron-right" size={18} /></Button>
      </div>
    </div>
  );

  const total = result.rounds.length;
  const shownUpto = upto ?? total - 1;
  const results = (
    <div className="dz-results" data-stale={stale}>
      <div className="dz-stats" aria-label="Pattern statistics">
        <Stat k="Rounds" v={String(result.stats.rounds)} />
        <Stat k="Stitches" v={result.stats.stitches.toLocaleString()} />
        <Stat k="Diameter" v={cm(result.stats.diameterMm)} hint={state.targetCm ? `target ${state.targetCm} cm · ${params.label}` : params.label} />
        <Stat k="Yarn" v={`≈ ${result.stats.yarnM < 10 ? result.stats.yarnM.toFixed(1) : Math.round(result.stats.yarnM)} m`} hint="rough: summed stitch sizes" />
      </div>

      <Card flush className="dz-chart">
        {result.pattern
          ? <ChartView pattern={result.pattern} params={params} showFlatness uptoRound={upto} highlightNode={highlight} onRoundClick={(r) => { const g = result.rounds[r]; if (g && !g.auto) setSelected(g.source); setScrub(null); }} />
          : <p className="dz-pad">The generated text did not compile — see the warnings below.</p>}
        <div className="dz-scrub">
          <Slider
            label="Build-up" min={1} max={Math.max(1, total)} value={shownUpto + 1}
            format={(v) => `round ${v} of ${total}${result.rounds[v - 1] ? ` · ${MOTIFS[result.rounds[v - 1].motif].label} · ${cm(2 * result.rounds[v - 1].r)}` : ''}`}
            onChange={(v) => setScrub(v - 1 >= total - 1 ? null : v - 1)}
          />
        </div>
      </Card>

      {result.pattern && (
        <Card className="dz-card">
          <SymmetryPanel pattern={result.pattern} compact onSelectRound={(r) => setScrub(r)} />
        </Card>
      )}

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
        <FlatTable result={result} onPick={(i) => { const g = result.rounds[i]; if (!g.auto) setSelected(g.source); setScrub(null); }} />
      </Card>

      <Card className="dz-card">
        <div className="dz-card__head">
          <span className="dz-label">Notation</span>
          <span className="small muted">read-only here · {result.diagnostics.length ? `${result.diagnostics.length} problems` : 'checked: 0 errors, 0 warnings'}</span>
          <span className="spacer" />
          <Button size="sm" icon="copy" onClick={() => copyText(result.text)}>Copy</Button>
        </div>
        <pre className="dz-code" tabIndex={0} aria-label="Generated notation">{result.text}</pre>
      </Card>

      <details className="dz-card ui-card dz-details">
        <summary className="dz-label">Blocking template</summary>
        <TemplateCard svg={doilyTemplateSvg(result, result.text.match(/^title: (.*)$/m)?.[1] ?? 'Doily')} title={result.text.match(/^title: (.*)$/m)?.[1] ?? 'doily'}
          note="Rings at every round's radius and a line through each repeat. Print at 100 %; the bar must measure 5 cm." />
      </details>
    </div>
  );

  return (
    <Page wide className="dz-page">
      <PageHeader
        kicker="Generative designer"
        title="Doily designer"
        description="Build a doily layer by layer: pick motifs (or take a suggestion), and every round's chain lengths, stitch counts and increases are solved so it lies flat. The result is ordinary notation you can edit."
        actions={actions}
      />
      {kindSwitch}
      <SplitPane
        label="Designer" className="dz-split" columns="minmax(340px, 460px) minmax(0, 1fr)" active={pane} onActiveChange={setPane}
        panes={[
          { id: 'design', label: 'Layers', content: controls },
          { id: 'result', label: 'Chart & pattern', content: results },
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

function FlatTable({ result, onPick }: { result: GenerateResult; onPick: (i: number) => void }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll || result.rounds.length <= 12 ? result.rounds : result.rounds.slice(-8);
  return (
    <>
      <table className="dz-table">
        <thead><tr><th scope="col">Rnd</th><th scope="col">Motif</th><th scope="col">Shape</th><th scope="col" className="dz-num-col">Excess</th><th scope="col" className="dz-num-col">Across</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.number} onClick={() => onPick(r.number - 1)} className="dz-row-pick">
              <td>{r.number}</td>
              <td>
                <span className="dz-motif">{MOTIFS[r.motif].label}{r.auto ? <Badge tone="outline">added</Badge> : null}</span>
                <span className="dz-motif__sum">{paramSummary(r)}</span>
              </td>
              <td>{r.class === 'n/a' ? '—' : r.slackOnly ? <ShapeBadge shape="flat">flat (loose loops)</ShapeBadge> : <ShapeBadge shape={r.class} />}{r.aim !== 'flat' && <span className="dz-aim">aimed: {r.aim === 'cup' ? 'cup' : 'ruffle'}</span>}</td>
              <td className="dz-num-col" title={`flat window ${pct(r.eMin)} … ${pct(r.eMax)}`}>{pct(r.e)}</td>
              <td className="dz-num-col">{cm(2 * r.r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.rounds.length > 12 && (
        <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show the outer rounds only' : `Show all ${result.rounds.length} rounds`}</Button>
      )}
    </>
  );
}

export function Stat({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="dz-stat" title={hint}>
      <span className="dz-stat__k">{k}</span>
      <span className="dz-stat__v">{v}</span>
      {hint && <span className="dz-stat__h">{hint}</span>}
    </div>
  );
}
