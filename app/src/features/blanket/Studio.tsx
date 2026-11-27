// The blanket studio: guided steps on the left (shape, size, body, colours, border), the blanket
// on the right (colour preview at scale, checks, yarn per colour, the written pattern, the swatch).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge, Button, Card, Icon, IconButton, Input, Menu, Page, PageHeader, SegmentedControl, Slider, SplitPane, Toggle, buttonClass, toast,
} from '@/ui';
import { patternHref } from '@/app';
import { useLibrary } from '@/store';
import { ChartView } from '@/features/chart/ChartView';
import { YarnPanel } from '@/features/yarn/YarnPanel';
import { estimateYarnFromCounts, type YarnEstimate } from '@/core/yarn';
import {
  BLANKET_SIZES, BORDERS, BORDER_PRESETS, MOTIF_JOINS, MOTIF_LAYOUTS, NOT_EXPRESSIBLE, PALETTES, ROUND_STYLES, ROUND_STYLE_BY_ID,
  ROW_END_RULES, SIZE_NOTE, STITCH_BY_ID, STITCH_PATTERNS, STRIPE_KINDS, KEYS, blanketParamSets, bordersFor, planStripes,
  randomBlanket, ruleText, surpriseStripes, type BlanketDesign, type BlanketSpec, type BorderKind, type CornerStyle, type StripePlan,
} from '@/core/blanket';
import {
  addLayer, applyBorderPreset, fmtLen, historyOf, moveLayer, record, redo, removeLayer, setPalette, sync, undo,
  type BlanketState, type History, type Units,
} from './state';
import { useDesign } from './useDesign';
import { DEMOS } from './demos';
import { BlanketPreview } from './Preview';
import { CornerCloseUp, StitchThumb } from './Thumbs';

const SimView = lazy(() => import('@/features/sim/SimView').then((m) => ({ default: m.SimView })));

/** Over this many nodes the counter (which compiles on this device) is not offered. */
const COUNTER_MAX = 20000;

export function Studio({ state, setState }: { state: BlanketState; setState: (s: BlanketState) => void }) {
  const spec = state.spec;
  const [pane, setPane] = useState('design');
  const [hist, setHist] = useState<History<BlanketSpec>>(() => historyOf(spec));
  const stateRef = useRef(state);
  stateRef.current = state;
  const patch = (p: Partial<BlanketState>) => setState({ ...stateRef.current, ...p });
  const commit = useCallback((next: BlanketSpec) => {
    const s = stateRef.current;
    setHist((h) => record(sync(h, s.spec), next));
    setState({ ...s, spec: next });
  }, [setState]);
  const edit = (p: Partial<BlanketSpec>) => commit({ ...stateRef.current.spec, ...p });
  const doUndo = useCallback(() => setHist((h) => { const u = undo(h); if (u !== h) setState({ ...stateRef.current, spec: u.present }); return u; }), [setState]);
  const doRedo = useCallback(() => setHist((h) => { const u = redo(h); if (u !== h) setState({ ...stateRef.current, spec: u.present }); return u; }), [setState]);
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

  const { design, pending, error } = useDesign(spec);
  const units = state.units;
  const { actions, openCounter } = useSaveOpen(design);

  const summary = design && (
    <div className="bk-summary" aria-live="polite">
      <b>{fmtLen(design.size.achieved.widthCm, units)} × {fmtLen(design.size.achieved.heightCm, units)}</b>
      <span>{design.counts.stitches.toLocaleString('en')} sts</span>
      {pending && <Badge>updating…</Badge>}
    </div>
  );

  const steps: { title: string; sub: string; body: ReactNode }[] = [
    { title: 'Shape & construction', sub: spec.construction === 'rect' ? 'Rectangle in rows + border' : spec.construction === 'round' ? `In the round: ${ROUND_STYLE_BY_ID[spec.round.style].name}` : 'Motif blanket (planner)', body: <ShapeStep spec={spec} edit={edit} /> },
    { title: 'Size, yarn & gauge', sub: design ? `${fmtLen(design.size.achieved.widthCm, units)} × ${fmtLen(design.size.achieved.heightCm, units)} finished` : '', body: <SizeStep state={state} spec={spec} edit={edit} patch={patch} design={design} /> },
    spec.construction === 'rect'
      ? { title: 'Body stitch', sub: STITCH_BY_ID[spec.body.pattern]?.name ?? '', body: <BodyStep spec={spec} edit={edit} design={design} /> }
      : spec.construction === 'round'
        ? { title: 'Rounds', sub: `${design?.counts.rounds ?? '…'} rounds`, body: <RoundStep spec={spec} edit={edit} /> }
        : { title: 'Motifs & layout', sub: `${spec.motif.cols} × ${spec.motif.rows} ${spec.motif.style === 'hexagon' ? 'hexagons' : 'squares'}`, body: <MotifStep spec={spec} edit={edit} /> },
    { title: 'Colours', sub: `${spec.palette.length} colours · ${STRIPE_KINDS.find((k) => k.kind === spec.stripes.kind)?.name.toLowerCase()}`, body: <ColorStep spec={spec} edit={edit} design={design} seed={state.seed} setSeed={(seed) => patch({ seed })} /> },
  ];
  if (spec.construction === 'rect') steps.push({ title: 'Border', sub: spec.border.enabled ? `${spec.border.layers.length + 1} rounds` : 'none', body: <BorderStep spec={spec} edit={edit} design={design} /> });

  const controls = (
    <div className="bk-controls">
      <div className="bk-toolbar">
        <Button size="sm" icon="sparkle" onClick={() => { const s = randomBlanket(state.seed + 1, { construction: spec.construction }); patch({ seed: state.seed + 1, spec: s }); setHist((h) => record(h, s)); }}>Surprise me</Button>
        <span className="spacer" />
        <div className="bk-undo" role="group" aria-label="History">
          <IconButton icon="chevron-left" label="Undo" disabled={!hist.past.length} onClick={doUndo} />
          <IconButton icon="chevron-right" label="Redo" disabled={!hist.future.length} onClick={doRedo} />
        </div>
      </div>
      {steps.map((s, i) => (
        <details key={s.title} className="bk-step ui-card" open={state.step === i || undefined} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && state.step !== i) patch({ step: i }); }}>
          <summary className="bk-step__head">
            <span className="bk-step__num">{i + 1}</span>
            <span className="bk-step__text"><span className="bk-step__title">{s.title}</span><span className="bk-step__sub">{s.sub}</span></span>
            <Icon name="chevron-right" className="bk-step__chev" />
          </summary>
          <div className="bk-step__body">{s.body}</div>
        </details>
      ))}
      <div className="bk-jump">
        {summary}
        <Button variant="primary" onClick={() => { setPane('result'); window.scrollTo({ top: 0 }); }}>Blanket <Icon name="chevron-right" size={18} /></Button>
      </div>
    </div>
  );

  const results = design ? (
    <Results design={design} spec={spec} state={state} patch={patch} edit={edit} pending={pending} openCounter={openCounter} />
  ) : (
    <Card className="bk-card"><p className="muted">{error ? `Could not design this blanket: ${error}` : 'Designing…'}</p></Card>
  );

  return (
    <Page wide className="bk-page">
      <PageHeader
        kicker="Design studio"
        title="Blankets"
        description="Rectangles worked in rows with a fitted border, blankets worked in the round from the centre, and motif blankets: sized from your gauge, coloured stripe by stripe, with the whole pattern written out and checked."
        actions={actions}
      />
      <SplitPane
        label="Blanket studio" className="bk-split" columns="minmax(340px, 460px) minmax(0, 1fr)" active={pane} onActiveChange={setPane}
        panes={[{ id: 'design', label: 'Design', content: controls }, { id: 'result', label: 'Blanket', content: results }]}
      />
    </Page>
  );
}

/* ------------------------------------------------------------------ save / open */

function useSaveOpen(design?: BlanketDesign) {
  const navigate = useNavigate();
  const text = design?.text ?? '';
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
    if (!design) return;
    const id = ensureSaved();
    toast('Saved to My patterns', { action: { label: 'Open', onClick: () => navigate(patternHref('editor', id)) } });
  };
  const tooBig = !design || design.compiled !== 'full' || design.counts.nodes > COUNTER_MAX;
  const openCounter = () => {
    if (!design) return;
    if (tooBig) {
      toast(`This blanket is too big for the stitch-by-stitch counter (it compiles the whole pattern on this device). Use the tally counter for rows and repeats.`, { action: { label: 'Tally', onClick: () => navigate('/counter/tally') }, ms: 6000 });
      return;
    }
    navigate(patternHref('counter', ensureSaved()));
  };
  const actions = (
    <>
      <Button variant="primary" icon="library" onClick={save} disabled={!design}>Save to my patterns</Button>
      <Menu
        label="Open in…"
        trigger={<Button icon="more" disabled={!design}>Open in…</Button>}
        items={[
          { label: 'Editor', icon: 'edit', onSelect: () => design && navigate(patternHref('editor', ensureSaved())) },
          { label: tooBig ? 'Counter (too big — tally instead)' : 'Counter', icon: 'counter', onSelect: openCounter },
        ]}
      />
    </>
  );
  return { actions, openCounter };
}

/* ------------------------------------------------------------------ steps */

type Edit = (p: Partial<BlanketSpec>) => void;

function Chips<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="bk-chips" role="group" aria-label={label}>
      {options.map((o) => <button key={String(o.value)} type="button" className="bk-toggle" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

function ShapeStep({ spec, edit }: { spec: BlanketSpec; edit: Edit }) {
  return (
    <div className="stack">
      <SegmentedControl<BlanketSpec['construction']>
        label="Construction" className="bk-seg" value={spec.construction} onChange={(construction) => edit({ construction })}
        options={[{ value: 'rect', label: 'In rows' }, { value: 'round', label: 'In the round' }, { value: 'motif', label: 'Motifs' }]}
      />
      {spec.construction === 'rect' && <p className="small muted bk-p">Worked in rows from a foundation chain, then a border in rounds: across the top, down the row ends, along the foundation chain and up the other side.</p>}
      {spec.construction === 'round' && (
        <div className="bk-styles">
          {ROUND_STYLES.map((s) => (
            <button key={s.id} type="button" className="bk-style" aria-pressed={spec.round.style === s.id}
              onClick={() => edit({ round: { ...spec.round, style: s.id, textures: s.defaultTextures } })}>
              <RoundIcon style={s.id} />
              <span className="bk-style__name">{s.name}</span>
            </button>
          ))}
          <p className="small muted bk-p">{ROUND_STYLE_BY_ID[spec.round.style].blurb}</p>
        </div>
      )}
      {spec.construction === 'motif' && <p className="small muted bk-p">A grid of squares or hexagons in several colourways. The motif is a real, checked pattern; the joins are described in words (the notation cannot join motifs yet).</p>}
      <details className="small">
        <summary className="muted">Start from an example</summary>
        <div className="bk-chips bk-examples">
          {DEMOS.filter((d) => d.id !== 'edge-fit').map((d) => <button key={d.id} type="button" className="bk-toggle" onClick={() => edit(d.spec)}>{d.name}</button>)}
        </div>
      </details>
    </div>
  );
}

function RoundIcon({ style }: { style: string }) {
  const c = 'currentColor';
  const shape = (() => {
    switch (style) {
      case 'circle': case 'mandala': return <><circle cx="16" cy="16" r="13" /><circle cx="16" cy="16" r="8" /><circle cx="16" cy="16" r="3" /></>;
      case 'hexagon': return <><polygon points="16,3 27,9.5 27,22.5 16,29 5,22.5 5,9.5" /><polygon points="16,10 21,13 21,19 16,22 11,19 11,13" /></>;
      case 'octagon': return <><polygon points="11,3 21,3 29,11 29,21 21,29 11,29 3,21 3,11" /><polygon points="13.5,10 18.5,10 22,13.5 22,18.5 18.5,22 13.5,22 10,18.5 10,13.5" /></>;
      case 'circle-to-square': return <><rect x="3" y="3" width="26" height="26" rx="1" /><circle cx="16" cy="16" r="8" /></>;
      case 'rect-round': return <><rect x="2" y="7" width="28" height="18" rx="1" /><rect x="8" y="13" width="16" height="6" /></>;
      default: return <><rect x="3" y="3" width="26" height="26" rx="1" /><rect x="10" y="10" width="12" height="12" /></>;
    }
  })();
  return <svg className="bk-style__icon" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><g fill="none" stroke={c} strokeWidth="1.6">{shape}</g></svg>;
}

function SizeStep({ state, spec, edit, patch, design }: { state: BlanketState; spec: BlanketSpec; edit: Edit; patch: (p: Partial<BlanketState>) => void; design?: BlanketDesign }) {
  const units = state.units;
  const toU = (cm: number) => (units === 'cm' ? Math.round(cm) : Math.round((cm / 2.54) * 10) / 10);
  const fromU = (v: number) => (units === 'cm' ? v : v * 2.54);
  const squareOnly = spec.construction === 'round' && ROUND_STYLE_BY_ID[spec.round.style].squareOnly;
  return (
    <div className="stack">
      <div className="bk-chips bk-sizes" role="group" aria-label="Size presets">
        {BLANKET_SIZES.map((s) => (
          <button key={s.id} type="button" className="bk-size" aria-pressed={spec.size.preset === s.id} title={s.note}
            onClick={() => edit({ size: { preset: s.id, widthCm: s.widthCm, heightCm: s.heightCm } })}>
            <span className="bk-size__name">{s.name}</span>
            <span className="bk-size__dim">{units === 'cm' ? `${s.widthCm}×${s.heightCm}` : `${s.widthIn}×${s.heightIn}″`}</span>
          </button>
        ))}
      </div>
      {spec.construction !== 'motif' && (
        <div className="bk-dims">
          <label className="ui-field"><span className="ui-field__label"><span>{squareOnly ? 'Across' : 'Width'} ({units})</span></span>
            <Input inputMode="decimal" value={String(toU(spec.size.widthCm))} onChange={(e) => { const v = parseFloat(e.target.value); if (v > 0) edit({ size: { widthCm: fromU(v), heightCm: squareOnly ? fromU(v) : spec.size.heightCm } }); }} />
          </label>
          {!squareOnly && (
            <label className="ui-field"><span className="ui-field__label"><span>Length ({units})</span></span>
              <Input inputMode="decimal" value={String(toU(spec.size.heightCm))} onChange={(e) => { const v = parseFloat(e.target.value); if (v > 0) edit({ size: { widthCm: spec.size.widthCm, heightCm: fromU(v) } }); }} />
            </label>
          )}
          <SegmentedControl<Units> label="Units" value={units} onChange={(u) => patch({ units: u })} options={[{ value: 'cm', label: 'cm' }, { value: 'in', label: 'in' }]} />
        </div>
      )}
      <p className="small muted bk-p">{SIZE_NOTE}</p>
      <label className="ui-field">
        <span className="ui-field__label"><span>Yarn and hook</span></span>
        <select className="ui-select" value={spec.paramsId} onChange={(e) => edit({ paramsId: e.target.value })}>
          {blanketParamSets().map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <Toggle label="Use my own gauge" checked={state.myGauge || !!spec.gauge} onChange={(v) => { patch({ myGauge: v }); if (!v) edit({ gauge: undefined }); }} />
      {(state.myGauge || spec.gauge) && (
        <div className="bk-gauge">
          <label className="ui-field"><span className="ui-field__label"><span>Stitches / 10 cm</span></span>
            <Input inputMode="decimal" placeholder="e.g. 14" value={spec.gauge?.sts ? String(spec.gauge.sts) : ''} onChange={(e) => { const v = parseFloat(e.target.value); edit({ gauge: { sts: v > 0 ? v : 0, rows: spec.gauge?.rows ?? 0 } }); }} />
          </label>
          <label className="ui-field"><span className="ui-field__label"><span>Rows / 10 cm</span></span>
            <Input inputMode="decimal" placeholder="e.g. 16" value={spec.gauge?.rows ? String(spec.gauge.rows) : ''} onChange={(e) => { const v = parseFloat(e.target.value); edit({ gauge: { sts: spec.gauge?.sts ?? 0, rows: v > 0 ? v : 0 } }); }} />
          </label>
          <p className="small muted bk-p">Measured over the {spec.construction === 'rect' ? `body pattern (${STITCH_BY_ID[spec.body.pattern]?.name.toLowerCase()})` : 'main stitch'}, blocked. Not sure? <Link to="/amigurumi?tab=gauge">Gauge calculator</Link>.</p>
        </div>
      )}
      {design && (
        <div className="bk-achieved">
          <span>Finished</span>
          <b>{fmtLen(design.size.achieved.widthCm, units, 1)} × {fmtLen(design.size.achieved.heightCm, units, 1)}</b>
          <span className="muted">target {fmtLen(design.size.target.widthCm, units)} × {fmtLen(squareOnly ? design.size.target.widthCm : design.size.target.heightCm, units)}</span>
          {design.size.body && <span className="muted">body {design.size.body.columns} sts × {design.size.body.rows} rows · border {fmtLen(design.size.borderCm, units, 1)} each side</span>}
        </div>
      )}
    </div>
  );
}

function BodyStep({ spec, edit, design }: { spec: BlanketSpec; edit: Edit; design?: BlanketDesign }) {
  const pat = STITCH_BY_ID[spec.body.pattern];
  const rows = design?.lines.filter((l) => l.label === 'Row') ?? [];
  const preview = rows.slice(0, 1 + (pat?.rowRepeat ?? 1));
  return (
    <div className="stack">
      <div className="bk-patterns" role="radiogroup" aria-label="Stitch pattern">
        {STITCH_PATTERNS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={p.id === spec.body.pattern} className="bk-pat" onClick={() => edit({ body: { pattern: p.id } })}>
            <StitchThumb kind={p.thumb} size={56} />
            <span className="bk-pat__name">{p.name}</span>
            <span className="bk-pat__meta">{'●'.repeat(p.difficulty)}{'○'.repeat(3 - p.difficulty)} · {p.drape}</span>
          </button>
        ))}
      </div>
      {pat && (
        <div className="bk-patinfo">
          <p className="bk-p">{pat.blurb}</p>
          <dl className="bk-dl">
            <dt>Multiple</dt><dd>{pat.multiple === 1 ? 'any number' : `${pat.multiple}${pat.plus ? ` + ${pat.plus}` : ''}`} sts</dd>
            <dt>Row repeat</dt><dd>{pat.rowRepeat === 1 ? 'every row the same' : `${pat.rowRepeat} rows`}</dd>
            <dt>Drape</dt><dd>{pat.drape}, {pat.texture}</dd>
            <dt>Yarn appetite</dt><dd>{pat.yarnFactor >= 1.2 ? 'hungry' : pat.yarnFactor <= 0.75 ? 'thrifty' : 'average'} (×{pat.yarnFactor.toFixed(2)} of plain sc)</dd>
          </dl>
          <p className="small bk-note"><Icon name="info" size={16} /> {pat.edge}</p>
          {preview.length > 0 && (
            <div className="bk-repeat">
              <span className="small muted">Row repeat</span>
              {preview.map((l) => <code key={l.n} className="bk-code-line"><b>Row {l.n}{l.n > 1 && pat.rowRepeat > 1 ? ` (and every ${pat.rowRepeat === 2 ? (l.n % 2 ? 'odd' : 'even') : ''} row)` : l.n > 1 ? '+' : ''}:</b> {l.text}. {l.count}</code>)}
            </div>
          )}
        </div>
      )}
      <details className="small muted">
        <summary>Not expressible yet</summary>
        {NOT_EXPRESSIBLE.map((x) => <p key={x.name}><b>{x.name}.</b> {x.why}</p>)}
      </details>
    </div>
  );
}

const TEX_NAME: Record<string, string> = { sc: 'sc', hdc: 'hdc', dc: 'dc', 'sc-blo': 'sc ridge', granny: 'granny' };

function RoundStep({ spec, edit }: { spec: BlanketSpec; edit: Edit }) {
  const st = ROUND_STYLE_BY_ID[spec.round.style];
  const tex = spec.round.textures.length ? spec.round.textures : st.defaultTextures;
  return (
    <div className="stack">
      <div className="ui-field">
        <span className="ui-field__label"><span>Texture rounds (repeating, centre out)</span></span>
        <div className="bk-texseq">
          {tex.map((t, i) => (
            <span key={i} className="bk-texchip">
              {TEX_NAME[t] ?? t}
              {tex.length > 1 && <button type="button" aria-label={`Remove round ${i + 1} of the cycle`} onClick={() => edit({ round: { ...spec.round, textures: tex.filter((_, j) => j !== i) } })}>×</button>}
            </span>
          ))}
        </div>
        <div className="bk-chips">
          {st.textures.map((t) => <button key={t} type="button" className="bk-chip" onClick={() => edit({ round: { ...spec.round, textures: [...tex, t].slice(-6) } })}>{TEX_NAME[t] ?? t}</button>)}
        </div>
      </div>
      {st.sides > 0 && st.id !== 'granny-square' && (
        <div className="ui-field">
          <span className="ui-field__label"><span>Corners</span></span>
          <Chips<CornerStyle> label="Corner style" value={spec.round.corner} onChange={(corner) => edit({ round: { ...spec.round, corner } })}
            options={[{ value: 'auto', label: 'Automatic' }, { value: 'solid', label: 'Solid (3 dc)' }, { value: 'chain', label: 'Chain space (2 dc, ch 2, 2 dc)' }]} />
          <p className="small muted bk-p">Corner groups follow the {st.sides === 4 ? 'square' : st.sides === 6 ? 'hexagon' : 'octagon'} rule: each round must add {st.sides === 4 ? '8' : st.sides === 6 ? '6.93' : '6.63'} × its height of edge, all of it at the corners.</p>
        </div>
      )}
      {st.id === 'mandala' && <Toggle label="Lace edge (chain arcs + picot scallops)" checked={spec.round.lace ?? true} onChange={(lace) => edit({ round: { ...spec.round, lace } })} />}
    </div>
  );
}

function MotifStep({ spec, edit }: { spec: BlanketSpec; edit: Edit }) {
  const m = spec.motif;
  const set = (p: Partial<typeof m>) => edit({ motif: { ...m, ...p } });
  return (
    <div className="stack">
      <Chips label="Motif" value={m.style} onChange={(style) => set({ style })}
        options={[{ value: 'granny-square', label: 'Granny square' }, { value: 'solid-square', label: 'Solid square' }, { value: 'hexagon', label: 'Hexagon' }]} />
      <Slider label="Rounds per motif" min={2} max={12} value={m.rounds} onChange={(rounds) => set({ rounds })} />
      <Slider label="Across" min={2} max={20} value={m.cols} onChange={(cols) => set({ cols })} format={(v) => `${v} motifs`} />
      <Slider label="Down" min={2} max={24} value={m.rows} onChange={(rows) => set({ rows })} format={(v) => `${v} motifs`} />
      <Slider label="Colourways" min={1} max={8} value={m.colorways} onChange={(colorways) => set({ colorways })} />
      <div className="ui-field"><span className="ui-field__label"><span>Layout</span></span>
        <Chips label="Layout" value={m.layout} onChange={(layout) => set({ layout })} options={MOTIF_LAYOUTS.map((l) => ({ value: l.id, label: l.name }))} />
      </div>
      {m.layout === 'random' && <Button size="sm" icon="sparkle" onClick={() => set({ seed: m.seed + 1 })}>Shuffle (seed {m.seed})</Button>}
      <div className="ui-field"><span className="ui-field__label"><span>Joining</span></span>
        <Chips label="Join" value={m.join} onChange={(join) => set({ join })} options={MOTIF_JOINS.map((j) => ({ value: j.id, label: j.name }))} />
        <p className="small muted bk-p">{MOTIF_JOINS.find((j) => j.id === m.join)?.text}</p>
      </div>
    </div>
  );
}

function ColorStep({ spec, edit, design, seed, setSeed }: { spec: BlanketSpec; edit: Edit; design?: BlanketDesign; seed: number; setSeed: (n: number) => void }) {
  const keys = spec.palette.map((c) => c.key);
  const plan = spec.stripes;
  const setPlan = (p: StripePlan) => edit({ stripes: p });
  const n = spec.construction === 'rect' ? design?.counts.rows ?? 120 : design?.counts.rounds ?? 30;
  const ideas = useMemo(() => [1, 2, 3, 4].map((k) => surpriseStripes(seed * 10 + k, keys.slice(0, Math.max(2, keys.length - 1)))), [seed, keys.join('')]);
  const word = spec.construction === 'rect' ? 'rows' : 'rounds';
  const selected = 'colors' in plan && plan.colors ? plan.colors : keys;
  const toggleColor = (k: string) => {
    if (!('colors' in plan)) return;
    const cur = plan.colors && plan.colors.length ? plan.colors : keys;
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    if (next.length) setPlan({ ...plan, colors: next } as StripePlan);
  };
  return (
    <div className="stack">
      <div className="bk-palette-row">
        <label className="ui-field bk-grow"><span className="ui-field__label"><span>Palette</span></span>
          <select className="ui-select" value="" onChange={(e) => e.target.value && edit(setPalette(spec, e.target.value))}>
            <option value="">Load a palette…</option>
            {PALETTES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <ul className="bk-palette">
        {spec.palette.map((c, i) => (
          <li key={c.key} className="bk-swatch">
            <span className="bk-swatch__key">{c.key}</span>
            <input type="color" aria-label={`Colour ${c.key}`} value={c.hex} onChange={(e) => edit({ palette: spec.palette.map((p, j) => (j === i ? { ...p, hex: e.target.value } : p)) })} />
            <Input aria-label={`Name of colour ${c.key}`} value={c.name} onChange={(e) => edit({ palette: spec.palette.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)) })} />
            {spec.palette.length > 1 && <IconButton icon="close" label={`Remove colour ${c.key}`} onClick={() => edit({ palette: spec.palette.filter((_, j) => j !== i) })} />}
          </li>
        ))}
      </ul>
      {spec.palette.length < 12 && <Button size="sm" icon="plus" onClick={() => edit({ palette: [...spec.palette, { key: KEYS.find((k) => !keys.includes(k)) ?? 'Z', name: 'New colour', hex: '#b8a9c9' }] })}>Add a colour</Button>}
      {spec.construction !== 'motif' && (
        <>
          <div className="ui-field">
            <span className="ui-field__label"><span>{spec.construction === 'rect' ? 'Stripes' : 'Colour per round'}</span></span>
            <Chips label="Stripe plan" value={plan.kind} onChange={(kind) => setPlan(defaultPlan(kind, keys, seed))} options={STRIPE_KINDS.map((k) => ({ value: k.kind, label: k.name, title: k.blurb }))} />
          </div>
          {'colors' in plan && (
            <div className="bk-chips" role="group" aria-label="Colours in the plan">
              {keys.map((k) => {
                const c = spec.palette.find((p) => p.key === k)!;
                return <button key={k} type="button" className="bk-colchip" aria-pressed={selected.includes(k)} onClick={() => toggleColor(k)}><i style={{ background: c.hex }} />{k}</button>;
              })}
            </div>
          )}
          {plan.kind === 'even' && <Slider label="Stripe height" min={1} max={40} value={plan.rows} onChange={(rows) => setPlan({ ...plan, rows })} format={(v) => `${v} ${word}`} />}
          {plan.kind === 'fibonacci' && <Slider label="Unit" min={1} max={6} value={plan.unit} onChange={(unit) => setPlan({ ...plan, unit })} format={(v) => `${v} ${word}`} />}
          {plan.kind === 'random' && (
            <>
              <Slider label="Shortest stripe" min={1} max={20} value={plan.min} onChange={(min) => setPlan({ ...plan, min, max: Math.max(min, plan.max) })} format={(v) => `${v} ${word}`} />
              <Slider label="Longest stripe" min={1} max={40} value={plan.max} onChange={(max) => setPlan({ ...plan, max, min: Math.min(max, plan.min) })} format={(v) => `${v} ${word}`} />
              <Button size="sm" icon="sparkle" onClick={() => setPlan({ ...plan, seed: plan.seed + 1 })}>Reshuffle (seed {plan.seed})</Button>
            </>
          )}
          {plan.kind === 'custom' && (
            <label className="ui-field"><span className="ui-field__label"><span>Sequence (colour × {word}, repeated)</span></span>
              <Input value={plan.seq.map((x) => `${x.color}${x.rows}`).join(' ')} onChange={(e) => {
                const seq = e.target.value.trim().split(/[\s,]+/).map((t) => /^([A-Z])(\d+)$/i.exec(t)).filter(Boolean).map((m) => ({ color: m![1].toUpperCase(), rows: +m![2] }));
                if (seq.length) setPlan({ kind: 'custom', seq });
              }} placeholder="A4 B2 C1" />
            </label>
          )}
          <div className="ui-field">
            <span className="ui-field__label"><span>Stripe ideas</span><Button size="sm" variant="ghost" icon="sparkle" onClick={() => setSeed(seed + 1)}>More</Button></span>
            <div className="bk-ideas">
              {ideas.map((p, i) => (
                <button key={i} type="button" className="bk-idea" onClick={() => setPlan(p)} aria-label={`Use stripe idea ${i + 1}: ${p.kind}`}>
                  <StripeBar plan={p} n={Math.min(n, 80)} spec={spec} />
                  <span className="small">{STRIPE_KINDS.find((k) => k.kind === p.kind)?.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <p className="small bk-note"><Icon name="info" size={16} /> Colour changes are annotations: they are written into the pattern as a <code>colors:</code> line and <code># Rows 13-18: colour B</code> comments and drive the yarn per colour, but they are not yet part of the stitch graph.</p>
    </div>
  );
}

function defaultPlan(kind: StripePlan['kind'], keys: string[], seed: number): StripePlan {
  switch (kind) {
    case 'solid': return { kind, color: keys[0] };
    case 'even': return { kind, rows: 8, colors: keys.slice(0, 3) };
    case 'fibonacci': return { kind, unit: 2, colors: keys.slice(0, 3) };
    case 'random': return { kind, seed, min: 2, max: 10, colors: keys.slice(0, 4) };
    case 'gradient': return { kind, colors: keys };
    case 'custom': return { kind, seq: keys.slice(0, 3).map((c, i) => ({ color: c, rows: [6, 2, 2][i] ?? 2 })) };
  }
}

function StripeBar({ plan, n, spec }: { plan: StripePlan; n: number; spec: BlanketSpec }) {
  const cs = planStripes(plan, n, spec.palette.map((c) => c.key));
  return (
    <svg className="bk-stripebar" viewBox={`0 0 ${n} 10`} preserveAspectRatio="none" aria-hidden="true">
      {cs.map((c, i) => <rect key={i} x={i} y={0} width={1.05} height={10} fill={spec.palette.find((p) => p.key === c)?.hex ?? '#ccc'} />)}
    </svg>
  );
}

const ROW_END_OPTIONS = ['auto', ...ROW_END_RULES.map((r) => `${r.num}/${r.den}`)];

function BorderStep({ spec, edit, design }: { spec: BlanketSpec; edit: Edit; design?: BlanketDesign }) {
  const b = spec.border;
  const keys = spec.palette.map((c) => c.key);
  const setBorder = (p: Partial<BlanketSpec['border']>) => edit({ border: { ...b, ...p } });
  const ideas = bordersFor(spec.body.pattern);
  const edges = design?.checks.edges ?? [];
  const badEdge = edges.find((e) => e.class !== 'ok');
  const badCorner = design?.checks.polygon.filter((p) => p.class !== 'flat' && !p.intended) ?? [];
  const colorSel = (value: string | undefined, onChange: (v: string) => void, label: string) => (
    <select className="ui-select bk-colsel" aria-label={label} value={value ?? keys[keys.length - 1]} onChange={(e) => onChange(e.target.value)}
      style={{ borderLeft: `14px solid ${spec.palette.find((p) => p.key === (value ?? keys[keys.length - 1]))?.hex ?? '#ccc'}` }}>
      {spec.palette.map((c) => <option key={c.key} value={c.key}>{c.key} · {c.name}</option>)}
    </select>
  );
  return (
    <div className="stack">
      <Toggle label="Work a border" checked={b.enabled} onChange={(enabled) => setBorder({ enabled })} />
      {b.enabled && (
        <>
          <div className="ui-field">
            <span className="ui-field__label"><span>Ready-made borders</span></span>
            <div className="bk-chips">
              {BORDER_PRESETS.map((p) => <button key={p.id} type="button" className="bk-toggle" onClick={() => edit(applyBorderPreset(spec, p.id))}>{p.name}</button>)}
            </div>
          </div>
          {ideas.length > 0 && (
            <div className="bk-suggest">
              <span className="small muted">Borders that suit {STITCH_BY_ID[spec.body.pattern]?.name.toLowerCase()}:</span>
              {ideas.map((x) => <button key={x.id} type="button" className="bk-sugg" onClick={() => edit(applyBorderPreset(spec, x.id))}><b>{x.name}</b> <span className="muted">{x.why}</span></button>)}
            </div>
          )}
          <ol className="bk-layers">
            <li className="bk-layer bk-layer--edge">
              <span className="bk-layer__num">1</span>
              <div className="bk-layer__main">
                <span className="bk-layer__name">Edge round (sc)</span>
                <span className="small muted">evens the edge: sc across the top and bottom, sc in the row ends</span>
                <div className="bk-layer__opts">
                  {colorSel(b.edgeColor, (v) => setBorder({ edgeColor: v }), 'Colour of the edge round')}
                  <select className="ui-select" aria-label="Corners of the edge round" value={b.edgeCorner} onChange={(e) => setBorder({ edgeCorner: e.target.value as 'sc3' | 'ch2' })}>
                    <option value="sc3">solid corners (3 sc)</option>
                    <option value="ch2">chain corners (sc, ch, sc)</option>
                  </select>
                  <select className="ui-select" aria-label="Stitches per row end" value={b.rowEnds === 'auto' ? 'auto' : `${b.rowEnds.num}/${b.rowEnds.den}`}
                    onChange={(e) => { const v = e.target.value; if (v === 'auto') setBorder({ rowEnds: 'auto' }); else { const [num, den] = v.split('/').map(Number); setBorder({ rowEnds: { num, den } }); } }}>
                    {ROW_END_OPTIONS.map((o) => <option key={o} value={o}>{o === 'auto' ? 'row ends: fitted' : ruleText({ num: +o.split('/')[0], den: +o.split('/')[1] })}</option>)}
                  </select>
                </div>
              </div>
            </li>
            {b.layers.map((l, i) => {
              const def = BORDERS.find((d) => d.kind === l.kind)!;
              return (
                <li key={i} className="bk-layer">
                  <span className="bk-layer__num">{i + 2}</span>
                  <div className="bk-layer__main">
                    <span className="bk-layer__name">{def.name}{def.ruffle && <Badge tone="warning">ruffles</Badge>}</span>
                    <span className="small muted">{def.blurb}</span>
                    <div className="bk-layer__opts">
                      {colorSel(l.color, (v) => setBorder({ layers: b.layers.map((x, j) => (j === i ? { ...x, color: v } : x)) }), `Colour of border round ${i + 2}`)}
                      {!def.final && def.kind !== 'mesh' && (
                        <select className="ui-select" aria-label={`Corners of border round ${i + 2}`} value={l.corner ?? 'auto'} onChange={(e) => setBorder({ layers: b.layers.map((x, j) => (j === i ? { ...x, corner: e.target.value as CornerStyle } : x)) })}>
                          <option value="auto">corners: automatic</option>
                          <option value="solid">corners: solid</option>
                          <option value="chain">corners: chain space</option>
                        </select>
                      )}
                    </div>
                  </div>
                  <div className="bk-layer__tools">
                    <IconButton icon="chevron-left" className="bk-up" label="Move up" disabled={i === 0} onClick={() => setBorder({ layers: moveLayer(b.layers, i, -1) })} />
                    <IconButton icon="chevron-right" className="bk-down" label="Move down" disabled={i === b.layers.length - 1} onClick={() => setBorder({ layers: moveLayer(b.layers, i, 1) })} />
                    <IconButton icon="trash" label="Remove this round" onClick={() => setBorder({ layers: removeLayer(b.layers, i) })} />
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="bk-chips">
            {BORDERS.map((d) => <button key={d.kind} type="button" className="bk-chip" onClick={() => setBorder({ layers: addLayer(b.layers, d.kind as BorderKind, keys[0]) })}>{d.name}</button>)}
          </div>
          {design && (
            <div className="bk-checks">
              <div className="bk-checks__row">
                <CornerCloseUp design={design} palette={spec.palette} size={190} />
                <ul className="bk-checklist">
                  {edges.map((e) => <li key={e.side} className={`is-${e.class}`}><Icon name={e.class === 'ok' ? 'check' : 'alert'} size={16} /> <span>{e.message}</span></li>)}
                  {design.checks.polygon.map((p) => <li key={p.label} className={`is-${p.class === 'flat' || p.intended ? 'ok' : 'off'}`}><Icon name={p.class === 'flat' || p.intended ? 'check' : 'alert'} size={16} /> <span>{p.message}</span></li>)}
                </ul>
              </div>
              {badEdge && <Button variant="primary" size="sm" icon="auto" onClick={() => setBorder({ rowEnds: 'auto' })}>Fix the sides: {badEdge.fix ?? 'fitted row ends'}</Button>}
              {badCorner.length > 0 && <Button size="sm" icon="auto" onClick={() => setBorder({ layers: b.layers.map((l) => ({ ...l, corner: 'auto' })) })}>Fix the corners (automatic corner groups)</Button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ results */

function perColourEstimate(design: BlanketDesign): YarnEstimate | undefined {
  try {
    const total = estimateYarnFromCounts(design.counts.keys, design.params);
    const byColor: Record<string, YarnEstimate['net']> = {};
    for (const [c, keys] of Object.entries(design.counts.byColor)) byColor[c] = estimateYarnFromCounts(keys, design.params).net;
    return { ...total, byColor };
  } catch {
    return undefined;
  }
}

function Results({ design, spec, state, patch, edit, pending, openCounter }: {
  design: BlanketDesign; spec: BlanketSpec; state: BlanketState; patch: (p: Partial<BlanketState>) => void; edit: Edit; pending: boolean; openCounter: () => void;
}) {
  const units = state.units;
  const estimate = useMemo(() => perColourEstimate(design), [design]);
  const colorLabels = useMemo(() => Object.fromEntries(spec.palette.map((c) => [c.key, { label: `${c.key} · ${c.name}`, css: c.hex }])), [spec.palette]);
  const hours = design.timeMin / 60;
  const shown = design.warnings.filter((w) => !w.startsWith('Pattern check'));
  const sections = design.sections.filter((s) => s.kind !== 'header');
  const print = () => {
    document.body.classList.add('bk-printing');
    window.print();
    setTimeout(() => document.body.classList.remove('bk-printing'), 500);
  };
  return (
    <div className="bk-results" data-stale={pending}>
      <Card className="bk-hero">
        <BlanketPreview design={design} spec={spec} className="bk-hero__svg" />
        <div className="bk-hero__cap">
          <span><b>{fmtLen(design.size.achieved.widthCm, units, 1)} × {fmtLen(design.size.achieved.heightCm, units, 1)}</b> finished, drawn to scale</span>
          <span className="bk-legend">
            {spec.palette.filter((c) => design.counts.byColor[c.key]).map((c) => <span key={c.key}><i style={{ background: c.hex }} />{c.name}</span>)}
          </span>
        </div>
      </Card>

      <div className="bk-stats">
        <Stat k="Finished" v={`${fmtLen(design.size.achieved.widthCm, units)} × ${fmtLen(design.size.achieved.heightCm, units)}`} hint={`target ${fmtLen(design.size.target.widthCm, units)} × ${fmtLen(design.size.target.heightCm, units)}`} />
        <Stat k="Stitches" v={design.counts.stitches.toLocaleString('en')} hint={`${design.counts.nodes.toLocaleString('en')} with chains & sl sts`} />
        <Stat k={spec.construction === 'rect' ? 'Rows + rounds' : spec.construction === 'motif' ? 'Motifs' : 'Rounds'} v={spec.construction === 'rect' ? `${design.counts.rows} + ${design.counts.rounds}` : spec.construction === 'motif' ? String(spec.motif.cols * spec.motif.rows) : String(design.counts.rounds)} />
        <Stat k="Time" v={hours < 1 ? `${Math.round(design.timeMin)} min` : `≈ ${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`} hint={`at ${spec.spm ?? 20} sts/min (a guess — set yours below)`} />
      </div>

      {(shown.length > 0 || design.checks.notes.length > 0) && (
        <Card className="bk-card">
          {shown.length > 0 && <ul className="bk-warn">{shown.map((w, i) => <li key={i}><Icon name="alert" size={16} /> <span>{w}</span></li>)}</ul>}
          <ul className="bk-notes">{design.checks.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Card>
      )}

      {design.motif && (
        <Card className="bk-card">
          <div className="bk-card__head"><span className="bk-label">Motif plan</span><span className="small muted">{design.motif.notes[0]}</span></div>
          <table className="bk-table">
            <thead><tr><th>Colourway</th><th>Rounds (centre out)</th><th className="bk-num-col">Motifs</th></tr></thead>
            <tbody>
              {design.motif.colorways.map((cw) => (
                <tr key={cw.index}>
                  <td>{cw.index + 1}</td>
                  <td><span className="bk-cw">{cw.rounds.map((k, i) => <i key={i} title={k} style={{ background: spec.palette.find((p) => p.key === k)?.hex }} />)}</span></td>
                  <td className="bk-num-col">{design.motif!.totals[cw.index]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">{MOTIF_JOINS.find((j) => j.id === spec.motif.join)?.text}</p>
        </Card>
      )}

      <Card className="bk-card">
        <YarnPanel estimate={estimate} params={design.params} title="Yarn per colour" colorLabels={colorLabels} />
        <Slider label="My speed" min={5} max={60} value={spec.spm ?? 20} onChange={(spm) => edit({ spm })} format={(v) => `${v} stitches a minute`} hint="Used for the time estimate only." />
      </Card>

      <Card className="bk-card bk-print">
        <div className="bk-card__head">
          <span className="bk-label">Written pattern</span>
          <span className="small muted">{design.compiled === 'full' ? `checked: compiles to ${design.counts.nodes.toLocaleString('en')} stitches, 0 errors` : 'full text; checked on a swatch (too big to compile whole)'}</span>
          <span className="spacer" />
          <SegmentedControl<'US' | 'UK'> label="Terms" value={spec.terms ?? 'US'} onChange={(terms) => edit({ terms })} options={[{ value: 'US', label: 'US' }, { value: 'UK', label: 'UK' }]} />
          <Button size="sm" icon="copy" onClick={() => navigator.clipboard.writeText(design.text).then(() => toast('Pattern copied'), () => toast('Copy failed', { tone: 'error' }))}>Copy</Button>
          <Button size="sm" onClick={print}>Print</Button>
        </div>
        <pre className="bk-code bk-code" tabIndex={0} aria-label="Pattern header">{design.sections[0]?.text}</pre>
        {sections.map((s, i) => (
          <details key={i} className="bk-section" open={i < 2 || undefined}>
            <summary className="bk-label">{s.title}</summary>
            <pre className="bk-code bk-code" tabIndex={0}>{s.text}</pre>
          </details>
        ))}
        <div className="row bk-open">
          <Button size="sm" icon="counter" onClick={openCounter}>Count it</Button>
          <span className="small muted">{design.compiled !== 'full' || design.counts.nodes > COUNTER_MAX ? 'Too big for the stitch-by-stitch counter (it compiles the whole pattern on this device): use the tally counter for rows and repeats.' : 'Opens the stitch-by-stitch counter.'}</span>
        </div>
      </Card>

      <Card className="bk-card">
        <div className="bk-card__head">
          <span className="bk-label">Swatch</span>
          <Badge tone="info">swatch — not the whole blanket</Badge>
          <span className="spacer" />
          <Toggle label="Chart" checked={state.showChart} onChange={(v) => patch({ showChart: v })} />
          <Toggle label="3D" checked={state.showSim} onChange={(v) => patch({ showSim: v })} />
        </div>
        <p className="small muted">{design.swatchNote} The chart and the 3D view are for checking structure on a small piece; colours are not shown there.</p>
        {design.swatch && state.showChart && <div className="bk-chart"><ChartView pattern={design.swatch} params={design.params} showFlatness={spec.construction !== 'rect'} /></div>}
        {design.swatch && state.showSim && (
          <div className="bk-sim"><Suspense fallback={<p className="small muted">Loading the 3D view…</p>}><SimView pattern={design.swatch} params={design.params} controls /></Suspense></div>
        )}
        {(state.showChart || state.showSim) && <pre className="bk-code bk-code bk-swatch-text">{design.swatchText}</pre>}
      </Card>
    </div>
  );
}

export function Stat({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="bk-stat" title={hint}>
      <span className="bk-stat__k">{k}</span>
      <span className="bk-stat__v">{v}</span>
      {hint && <span className="bk-stat__h">{hint}</span>}
    </div>
  );
}

export { buttonClass };
