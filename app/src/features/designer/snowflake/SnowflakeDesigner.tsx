// Snowflake designer: point count, centre / body / arm layers with thumbnails, the arm editor,
// style sliders, seed + "surprise me", a gallery of variations ("more like this"), the snowflake
// check (body flat · valley web · arm clearance · blocked shape), symmetry, the blocking template,
// notation, and save / open in Editor, Chart, 3D, Counter.
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Card, Icon, IconButton, Input, Page, PageHeader, SegmentedControl, ShapeBadge, Slider, SplitPane, Tabs, Toggle,
} from '@/ui';
import { ChartView } from '@/features/chart/ChartView';
import { SimView, type SimStatus } from '@/features/sim/SimView';
import { SymmetryPanel } from '@/features/symmetry/SymmetryPanel';
import { paramSetById, paramsFile } from '@/core/params';
import { PIN_OVERSTRETCH } from '@/core/sim';
import {
  generateSnowflake, snowflakePins, randomSnowflake, snowflakeVariations, planSnowflake, blockedShape, normaliseSpec, armSentence, snowflakeTemplateSvg,
  SNOWFLAKE_PRESETS, CENTRE_LABEL, BODY_LABEL, TIP_LABEL, MINOR_LABEL, CENTRE_BLURB, BODY_BLURB,
  type SnowflakeSpec, type SnowCentreStyle, type SnowBodyMotif, type TipStyle, type MinorStyle, type ValleyDepth, type BlockedShape,
} from '@/core/generate/snowflake';
import { RoundGlyph } from '../Thumbs';
import { Stat, copyText, useSaveOpen } from '../DoilyDesigner';
import { TemplateCard } from '../TemplateCard';
import type { SnowState } from '../state';
import { SnowPreview } from './SnowPreview';
import './snowflake.css';

type View = 'preview' | 'gallery' | 'chart' | '3d' | 'template';
const VIEWS: View[] = ['preview', 'gallery', 'chart', '3d', 'template'];
const cm = (mm: number) => `${(mm / 10).toFixed(1)} cm`;
const pct = (x: number) => (Math.round(Math.abs(x) * 100) === 0 ? '±0 %' : `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)} %`);

const THREAD = 'thread-10_1.5mm';
const paramsOf = (id: string) => paramSetById(id) ?? paramSetById(THREAD) ?? paramsFile.sets[0];

function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="sf-chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="dz-toggle" title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

interface Thumb { spec: SnowflakeSpec; shape: BlockedShape; ok: boolean }

/** Gallery thumbnails, computed off the click path. */
function useGallery(seed: number, count: number, base: SnowflakeSpec | undefined, c: Parameters<typeof randomSnowflake>[1], paramsId: string, on: boolean): Thumb[] | null {
  const key = on ? JSON.stringify([seed, count, base, c, paramsId]) : '';
  const [st, setSt] = useState<{ key: string; items: Thumb[] } | null>(null);
  useEffect(() => {
    if (!on || st?.key === key) return;
    const t = setTimeout(() => {
      const params = paramsOf(paramsId);
      const specs = snowflakeVariations(seed, count, { ...c, params }, base);
      const items = specs.map((spec) => {
        const s = normaliseSpec(spec);
        const plan = planSnowflake(s, params);
        const shape = blockedShape(s, plan, params);
        return { spec, shape, ok: shape.tipR > 1.3 * shape.valleyR };
      });
      setSt({ key, items });
    }, 30);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return st?.key === key ? st.items : null;
}

export default function SnowflakeDesigner({ state, setState, kindSwitch }: { state: SnowState; setState: (s: SnowState) => void; kindSwitch: ReactNode }) {
  const [search, setSearch] = useSearchParams();
  const view: View = VIEWS.includes(search.get('view') as View) ? (search.get('view') as View) : 'preview';
  const setView = (v: View) => { const n = new URLSearchParams(search); n.set('view', v); setSearch(n, { replace: true }); };
  const [pane, setPane] = useState(search.get('view') ? 'result' : 'design');
  const [blocked, setBlocked] = useState(true);
  const [onTable, setOnTable] = useState(true);
  const [simStatus, setSimStatus] = useState<SimStatus | null>(null);
  const [galleryCount, setGalleryCount] = useState(12);

  const patch = (p: Partial<SnowState>) => setState({ ...state, ...p });
  const setSpec = (s: Partial<SnowflakeSpec>) => patch({ spec: { ...state.spec, ...s, seed: undefined } });
  const spec = state.spec;

  const deferred = useDeferredValue(state);
  const params = useMemo(() => paramsOf(deferred.paramsId), [deferred.paramsId]);
  const res = useMemo(() => generateSnowflake(deferred.spec, params), [deferred.spec, params]);
  const stale = deferred !== state;
  const { actions } = useSaveOpen(res.text);
  const constraints = { bold: state.bold, spiky: state.spiky, ornate: state.ornate, sizeCm: [Math.max(3, state.sizeCm - 1), state.sizeCm + 1] as [number, number], points: spec.points };
  const gallery = useGallery(state.gallerySeed, galleryCount, state.base, constraints, state.paramsId, view === 'gallery');
  const title = res.text.match(/^title: (.*)$/m)?.[1] ?? 'Snowflake';

  const surprise = (seed = Math.floor(Math.random() * 1_000_000)) => {
    const s = randomSnowflake(seed, { ...constraints, params });
    patch({ seed, spec: s });
  };

  const pins = useMemo(() => snowflakePins(res), [res]);
  useEffect(() => { setSimStatus(null); }, [res]);
  const sh = res.shape;
  const check = res.check;
  // second opinion from the 3D view (once it has pinned the piece out): does the template ask for
  // more than the thread gives?
  const simBlock = simStatus?.phase === 'ready' && blocked ? simStatus.block : undefined;
  const simItem = simBlock?.pinStretch ? (() => {
    const st = simBlock.pinStretch;
    const pc = (x: number) => `${Math.round(x * 100)} %`;
    const parts = `arms ${pc(st.spines)}, chain loops ${pc(st.chains)}, body ${pc(st.body)}`;
    const over = Math.max(st.spines, st.chains, st.body) > PIN_OVERSTRETCH;
    return over
      ? { ok: false, text: `3D check disagrees: ${simBlock.message.replace(/\.$/, '')} (largest stretch: ${parts}) — the template's radii are probably too large for this thread; pin a little inside the marks.` }
      : { ok: true, text: `3D check agrees: pinned to the template, nothing stretches more than ${pc(Math.max(st.spines, st.chains, st.body))} (${parts}).` };
  })() : null;
  const bodyCount = spec.body.length;

  const layers = (
    <ol className="dz-rounds sf-layers" aria-label="Snowflake rounds, from the centre out">
      {res.rounds.map((r, i) => {
        const p = res.planned[i];
        const isArms = r.kind === 'arms';
        const bi = i - 1;
        // a deferred (stale) result can have more body rounds than the spec just set: skip them
        if (r.kind === 'body' && !spec.body[bi]) return null;
        return (
          <li key={i} className="dz-round" data-open="false">
            <div className="dz-round__row sf-layer">
              <span className="dz-num" aria-hidden="true">{r.number}</span>
              {isArms ? <SnowPreview shape={sh} size={52} /> : <RoundGlyph entries={p.entries} repeats={spec.points} tone={r.class === 'flat' ? 'flat' : 'off'} />}
              <span className="dz-round__text">
                <span className="dz-round__top">
                  <span className="dz-round__name">{isArms ? `Arms: ${TIP_LABEL[spec.arm.tip].toLowerCase()}` : r.kind === 'centre' ? `Centre: ${CENTRE_LABEL[spec.centre.style].toLowerCase()}` : BODY_LABEL[spec.body[bi].motif]}</span>
                  {isArms ? <Badge tone="info">pointed — judged by blocking</Badge> : <ShapeBadge shape={r.class === 'flat' || r.class === 'cup' || r.class === 'ruffle' ? r.class : 'flat'} />}
                </span>
                <span className="dz-round__sum">
                  {isArms ? armSentence(res.spec, { anchors: [], bridges: sh.bridges.map((b) => ({ from: 0, to: 0, chains: b.chains })) }) : describeParams(r.params)}
                  {!isArms && <span className="dz-why"> — chosen to lie flat ({pct(r.e)})</span>}
                </span>
              </span>
              <span className="dz-round__dia">{cm(2 * r.radiusMm)}</span>
              {r.kind === 'body' && (
                <span className="sf-layer__tools">
                  <IconButton icon="chevron-left" className="dz-up" label="Move inwards" disabled={bi < 1} onClick={() => { const b = spec.body.slice(); [b[bi - 1], b[bi]] = [b[bi], b[bi - 1]]; setSpec({ body: b }); }} />
                  <IconButton icon="trash" label={`Remove body round ${bi + 1}`} onClick={() => setSpec({ body: spec.body.filter((_, j) => j !== bi) })} />
                </span>
              )}
            </div>
            {r.kind === 'centre' && (
              <div className="sf-layer__edit">
                <Chips<SnowCentreStyle> label="Centre" value={spec.centre.style} onChange={(style) => setSpec({ centre: { style } })}
                  options={(Object.keys(CENTRE_LABEL) as SnowCentreStyle[]).map((k) => ({ value: k, label: CENTRE_LABEL[k], title: CENTRE_BLURB[k] }))} />
              </div>
            )}
            {r.kind === 'body' && (
              <div className="sf-layer__edit">
                <Chips<SnowBodyMotif> label={`Body round ${bi + 1}`} value={spec.body[bi].motif} onChange={(motif) => setSpec({ body: spec.body.map((b, j) => (j === bi ? { motif } : b)) })}
                  options={(Object.keys(BODY_LABEL) as SnowBodyMotif[]).map((k) => ({ value: k, label: BODY_LABEL[k], title: BODY_BLURB[k] }))} />
                {spec.body[bi].motif === 'corners' && (
                  <Chips<string> label="Sides" value={String(spec.body[bi].params?.side ?? 'auto')}
                    onChange={(side) => setSpec({ body: spec.body.map((b, j) => (j === bi ? { motif: b.motif, ...(side === 'auto' ? {} : { params: { side } }) } : b)) })}
                    options={[{ value: 'auto', label: 'sides: auto' }, { value: 'chain', label: 'chain sides' }, { value: 'shell', label: 'shell sides' }, { value: 'solid', label: 'solid dc sides' }]} />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );

  const controls = (
    <div className="dz-controls">
      <Card className="dz-card">
        <div className="dz-sym">
          <div>
            <div className="dz-label">Points</div>
            <div className="small muted">{spec.points === 6 ? 'six, like real ice crystals' : `${spec.points}-pointed star`}</div>
          </div>
          <div className="dz-stepper" role="group" aria-label="Number of points">
            <IconButton icon="chevron-left" label="Fewer points" disabled={spec.points <= 3} onClick={() => setSpec({ points: spec.points - 1 })} />
            <output className="dz-stepper__val" aria-live="polite">{spec.points}</output>
            <IconButton icon="chevron-right" label="More points" disabled={spec.points >= 12} onClick={() => setSpec({ points: spec.points + 1 })} />
          </div>
        </div>
        <div className="dz-orders">
          {[5, 6, 8, 12].map((n) => <button key={n} type="button" className="dz-toggle" aria-pressed={spec.points === n} onClick={() => setSpec({ points: n })}>{n}</button>)}
        </div>
      </Card>

      <Card className="dz-card">
        <div className="dz-card__head">
          <span className="dz-label">Rounds</span>
          <span className="small muted">centre and body lie flat; the arms are pinned out</span>
        </div>
        {layers}
        <Button size="sm" icon="plus" disabled={bodyCount >= 5} onClick={() => setSpec({ body: [...spec.body, { motif: spec.body.length % 2 ? 'corners' : 'hexagon' }] })}>Add a body round</Button>
      </Card>

      <Card className="dz-card stack">
        <div className="dz-label">Arms</div>
        <Chips<TipStyle> label="Tip" value={spec.arm.tip} onChange={(tip) => setSpec({ arm: { ...spec.arm, tip } })}
          options={(['picot', 'trefoil', 'spike', 'bobble', 'loop'] as TipStyle[]).map((t) => ({ value: t, label: TIP_LABEL[t] }))} />
        <Slider label="Arm length" min={3} max={24} value={spec.arm.length} format={(v) => `ch ${v}`} onChange={(v) => setSpec({ arm: { ...spec.arm, length: v } })} />
        <Slider label="Branch pairs" min={0} max={3} value={spec.arm.branches} format={(v) => (v ? `${v} pair${v > 1 ? 's' : ''} of side picots` : 'none')} disabled={spec.arm.tip === 'loop'} onChange={(v) => setSpec({ arm: { ...spec.arm, branches: v } })} />
        <Slider label="Picot size" min={3} max={6} value={spec.arm.picot} format={(v) => `ch-${v}`} onChange={(v) => setSpec({ arm: { ...spec.arm, picot: v } })} />
        <div className="sf-row">
          <SegmentedControl<'slst' | 'sc'> label="Back down the spine" value={spec.arm.back} onChange={(back) => setSpec({ arm: { ...spec.arm, back } })}
            options={[{ value: 'slst', label: 'sl st (fine)' }, { value: 'sc', label: 'sc (bold)' }]} />
          <Toggle label="Graded branches" checked={!!spec.arm.graded} disabled={spec.arm.branches < 2} onChange={(v) => setSpec({ arm: { ...spec.arm, graded: v } })} />
        </div>
        <div className="dz-label">Minor points between the arms</div>
        <Chips<MinorStyle> label="Minor points" value={spec.minor.style} onChange={(style) => setSpec({ minor: { ...spec.minor, style } })}
          options={(['none', 'picot', 'spike', 'trefoil'] as MinorStyle[]).map((m) => ({ value: m, label: MINOR_LABEL[m] }))} />
        {spec.minor.style !== 'none' && spec.minor.style !== 'picot' && (
          <Slider label="Minor arm length" min={2} max={12} value={spec.minor.length} format={(v) => `ch ${v}`} onChange={(v) => setSpec({ minor: { ...spec.minor, length: v } })} />
        )}
        <div className="dz-label">Valleys</div>
        <SegmentedControl<ValleyDepth> label="Valley depth" value={spec.valley.depth} onChange={(depth) => setSpec({ valley: { ...spec.valley, depth, chains: undefined } })}
          options={[{ value: 'deep', label: 'Deep' }, { value: 'medium', label: 'Medium' }, { value: 'shallow', label: 'Shallow' }]} />
        <Toggle label="Anchor the bridge with an sc in the valley" checked={spec.valley.anchor} onChange={(anchor) => setSpec({ valley: { ...spec.valley, anchor } })} />
        <Slider label="Bridge chains" min={0} max={20} value={spec.valley.chains ?? 0}
          format={(v) => (v ? `ch ${v}` : `auto (ch ${[...new Set(sh.bridges.map((b) => b.chains))].join('/')})`)}
          hint="Auto sizes each bridge from the gap it spans and the depth."
          onChange={(v) => setSpec({ valley: { ...spec.valley, chains: v || undefined } })} />
      </Card>

      <Card className="dz-card stack">
        <div className="dz-card__head"><span className="dz-label">Surprise me</span><span className="small muted">style and size for new ideas and the gallery</span></div>
        <Slider label="Delicate ↔ bold" min={0} max={1} step={0.05} value={state.bold} format={(v) => (v < 0.34 ? 'delicate' : v > 0.66 ? 'bold' : 'balanced')} onChange={(v) => patch({ bold: v })} />
        <Slider label="Rounded ↔ spiky" min={0} max={1} step={0.05} value={state.spiky} format={(v) => (v < 0.34 ? 'rounded' : v > 0.66 ? 'spiky' : 'balanced')} onChange={(v) => patch({ spiky: v })} />
        <Slider label="Plain ↔ ornate" min={0} max={1} step={0.05} value={state.ornate} format={(v) => (v < 0.34 ? 'plain' : v > 0.66 ? 'ornate' : 'balanced')} onChange={(v) => patch({ ornate: v })} />
        <Slider label="Size across the points" min={4} max={14} value={state.sizeCm} format={(v) => `about ${v} cm`} onChange={(v) => patch({ sizeCm: v })} />
        <div className="dz-seed">
          <label className="dz-label" htmlFor="sf-seed">Seed</label>
          <Input id="sf-seed" inputMode="numeric" value={String(state.seed)} onChange={(e) => { const v = parseInt(e.target.value.replace(/\D/g, ''), 10); if (Number.isFinite(v)) surprise(v); }} />
          <Button variant="primary" icon="sparkle" onClick={() => surprise()}>Surprise me</Button>
        </div>
        <div className="dz-label">Presets</div>
        <div className="sf-chips">
          {SNOWFLAKE_PRESETS.map((p) => <button key={p.id} type="button" className="dz-toggle" title={p.blurb} onClick={() => patch({ spec: p.spec })}>{p.label}</button>)}
        </div>
      </Card>

      <Card className="dz-card stack">
        <div className="dz-label">Thread</div>
        <label className="ui-field">
          <span className="ui-field__label"><span>Thread and hook</span></span>
          <select className="ui-select" value={state.paramsId} onChange={(e) => patch({ paramsId: e.target.value })}>
            {paramsFile.sets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <SegmentedControl<'US' | 'UK'> label="Terms" value={spec.terms ?? 'US'} onChange={(terms) => patch({ spec: { ...spec, terms } })} options={[{ value: 'US', label: 'US terms' }, { value: 'UK', label: 'UK terms' }]} />
        <label className="ui-field">
          <span className="ui-field__label"><span>Title</span></span>
          <Input value={spec.title ?? ''} placeholder={title} onChange={(e) => patch({ spec: { ...spec, title: e.target.value || undefined } })} />
        </label>
      </Card>

      <div className="dz-jump">
        <span className="dz-summary">{check.ok ? <Badge tone="ok">crisp star</Badge> : <Badge tone="warning">check</Badge>}<span>{cm(sh.acrossMm)} across</span></span>
        <Button variant="primary" onClick={() => { setPane('result'); window.scrollTo({ top: 0 }); }}>Snowflake <Icon name="chevron-right" size={18} /></Button>
      </div>
    </div>
  );

  const checkCard = (
    <Card className="dz-card sf-check" data-ok={check.ok}>
      <div className="dz-card__head">
        <span className="dz-label">Snowflake check</span>
        {check.ok ? <Badge tone="ok" dot>blocks to a crisp star</Badge> : <Badge tone="warning" dot>needs a look</Badge>}
        {simItem && !simItem.ok && <Badge tone="warning" dot>3D view disagrees</Badge>}
        {stale && <Badge>updating…</Badge>}
      </div>
      <p className="sf-check__sum">{check.summary}</p>
      <ul className="sf-check__items">
        {check.items.map((it) => (
          <li key={it.id} data-ok={it.ok}><Icon name={it.ok ? 'check' : 'alert'} size={16} /><span>{it.text}</span></li>
        ))}
        {simItem && <li key="sim" data-ok={simItem.ok}><Icon name={simItem.ok ? 'check' : 'alert'} size={16} /><span>{simItem.text}</span></li>}
      </ul>
      <p className="small muted">
        The circle rule for flatness only fits the centre and body. The arm round is pointed: it is judged by the predicted pinned-out shape
        (chains at rest length, picots pinned to points, branches at about 50°). Approximate — the 3D tab pins the simulated piece to these marks as a second opinion.
      </p>
    </Card>
  );

  const resultTabs = (
    <Tabs<View> label="Snowflake views" className="sf-tabs" value={view} onChange={setView}
      tabs={[{ id: 'preview', label: 'Preview' }, { id: 'gallery', label: 'Variations' }, { id: 'chart', label: 'Chart' }, { id: '3d', label: '3D' }, { id: 'template', label: 'Template' }]} />
  );

  const results = (
    <div className="dz-results" data-stale={stale}>
      <div className="dz-stats" aria-label="Snowflake statistics">
        <Stat k="Rounds" v={String(res.stats.rounds)} />
        <Stat k="Stitches" v={res.stats.stitches.toLocaleString()} />
        <Stat k="Across" v={cm(res.stats.diameterMm)} hint={`point to point, blocked · ${params.label}`} />
        <Stat k="Thread" v={`≈ ${res.stats.threadM.toFixed(1)} m`} hint="rough: summed stitch sizes" />
      </div>
      {resultTabs}
      {view === 'preview' && (
        <Card flush className="sf-stage">
          <SnowPreview shape={sh} size="100%" pins outline label={`Predicted blocked shape of the ${title}`} />
          <div className="sf-stage__legend small muted">
            Predicted pinned-out shape · tips {cm(sh.tipR)} from the centre · valleys {cm(sh.valleyR)} · red dots are pin points
          </div>
        </Card>
      )}
      {view === 'gallery' && (
        <Card className="dz-card">
          <div className="dz-card__head">
            <span className="dz-label">{state.base ? 'More like this' : 'Variations'}</span>
            <span className="small muted">{state.base ? 'small changes to the design you picked' : 'fresh ideas from your style sliders'} · tap one to open it</span>
            <span className="spacer" />
            <Button size="sm" icon="sparkle" onClick={() => patch({ base: spec, gallerySeed: state.gallerySeed + 1 })}>More like this one</Button>
            <Button size="sm" onClick={() => patch({ base: undefined, gallerySeed: state.gallerySeed + 1 })}>Fresh ideas</Button>
          </div>
          {!gallery ? <p className="small muted" role="status">Designing {galleryCount} snowflakes…</p> : (
            <ul className="sf-gallery">
              {gallery.map((g, i) => (
                <li key={i}>
                  <button type="button" className="sf-gallery__item" onClick={() => { patch({ spec: g.spec }); setView('preview'); }} aria-label={`Open variation ${i + 1}: ${g.spec.points} points, ${TIP_LABEL[g.spec.arm.tip].toLowerCase()}`}>
                    <SnowPreview shape={g.shape} size="100%" />
                    <span className="sf-gallery__cap">{g.spec.points} pts · {TIP_LABEL[g.spec.arm.tip].toLowerCase()}{g.spec.arm.branches ? ` · ${g.spec.arm.branches} br` : ''} · {cm(g.shape.acrossMm)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {galleryCount < 24 && gallery && <Button size="sm" variant="ghost" onClick={() => setGalleryCount(24)}>Show 12 more</Button>}
        </Card>
      )}
      {view === 'chart' && (
        <Card flush className="dz-chart">
          {res.pattern ? <ChartView pattern={res.pattern} params={params} showFlatness={false} /> : <p className="dz-pad">The generated text did not compile.</p>}
          <p className="small muted dz-pad">Symbol chart — on a narrow screen one arm is shown enlarged; work it ×{res.spec.points}. Switch to Whole to see the full snowflake.</p>
        </Card>
      )}
      {view === '3d' && res.pattern && (
        <Card flush className="sf-sim">
          <div className="sf-sim__bar">
            <SegmentedControl<'relaxed' | 'blocked'> label="Physics state" value={blocked ? 'blocked' : 'relaxed'} onChange={(v) => setBlocked(v === 'blocked')}
              options={[{ value: 'blocked', label: 'Blocked (pinned)' }, { value: 'relaxed', label: 'Before blocking' }]} />
            {!blocked && <Toggle label="Resting on a table" checked={onTable} onChange={setOnTable} />}
          </div>
          <SimView pattern={res.pattern} params={params} blocked={blocked} table={onTable} pins={pins} style={{ height: 420 }} onStatus={setSimStatus} />
          <p className="sf-sim__cap small muted" data-testid="sf-sim-caption">
            {blocked
              ? <>Pinned out on the blocking template: tips, branch tips and valleys held at the template’s {pins.length} pin marks, the rest of the thread settles flat between them.{simBlock ? ` ${simBlock.message}` : ''}</>
              : onTable
                ? <>Before blocking: the finished piece unpinned, resting on a table — arms lie roughly where they want to, valley chains hang loose.</>
                : <>Before blocking, free in space (no table): the spring model has almost no stiffness against bending, so thin lace can look crumpled here — a tendency, not a verdict.</>}
            {' '}Approximate spring physics.
          </p>
        </Card>
      )}
      {view === 'template' && (
        <Card className="dz-card">
          <TemplateCard svg={snowflakeTemplateSvg({ ...res, title: `${title} — blocking template` })} title={title} />
        </Card>
      )}
      {checkCard}
      {res.pattern && <Card className="dz-card"><SymmetryPanel pattern={res.pattern} compact /></Card>}
      <Card className="dz-card">
        <div className="dz-card__head">
          <span className="dz-label">Rounds</span>
        </div>
        <table className="dz-table">
          <thead><tr><th scope="col">Rnd</th><th scope="col">Round</th><th scope="col">Judged by</th><th scope="col" className="dz-num-col">Sts</th></tr></thead>
          <tbody>
            {res.rounds.map((r) => (
              <tr key={r.number}>
                <td>{r.number}</td>
                <td><span className="dz-motif">{r.name}</span><span className="dz-motif__sum">{r.kind === 'arms' ? `tips at ${cm(r.radiusMm)}` : `${cm(2 * r.radiusMm)} across`}</span></td>
                <td>{r.class === 'pointed' ? <Badge tone="info">pointed round — judged by blocking</Badge> : <><ShapeBadge shape={r.class === 'n/a' ? 'flat' : r.class} /> <span className="small muted">{pct(r.e)}</span></>}</td>
                <td className="dz-num-col">{r.stitches}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {res.warnings.length > 0 && <ul className="dz-warn">{res.warnings.map((w, i) => <li key={i}><Icon name="alert" size={16} /> <span>{w}</span></li>)}</ul>}
      </Card>
      <Card className="dz-card">
        <div className="dz-card__head">
          <span className="dz-label">Notation</span>
          <span className="small muted">{res.diagnostics.length ? `${res.diagnostics.length} problems` : 'checked: 0 errors, 0 warnings'}</span>
          <span className="spacer" />
          <Button size="sm" icon="copy" onClick={() => copyText(res.text)}>Copy</Button>
        </div>
        <pre className="dz-code" tabIndex={0} aria-label="Generated notation">{res.text}</pre>
      </Card>
    </div>
  );

  return (
    <Page wide className="dz-page sf-page">
      <PageHeader
        kicker="Generative designer"
        title="Snowflake designer"
        description="Small pointed lace motifs in thread: a flat centre and body, then arms with picot, trefoil or bobble tips and side branches. Checked by how they block, with a printable pin-out template."
        actions={actions}
      />
      {kindSwitch}
      <SplitPane
        label="Snowflake designer" className="dz-split" columns="minmax(340px, 440px) minmax(0, 1fr)" active={pane} onActiveChange={setPane}
        panes={[
          { id: 'design', label: 'Design', content: controls },
          { id: 'result', label: 'Snowflake', content: results },
        ]}
      />
    </Page>
  );
}

function describeParams(p: Record<string, unknown>): string {
  const parts: string[] = [];
  if (p.st) parts.push(String(p.st));
  if (p.per) parts.push(`${p.per} per point`);
  if (p.size) parts.push(`${p.size} dc each side of the corner`);
  if (p.corner) parts.push(`ch-${p.corner} corner`);
  if (p.gap) parts.push(`ch ${p.gap} inside`);
  if (p.side) parts.push(`${p.side} sides`);
  if (p.minorForm) parts.push(p.minorForm === 'v' ? 'V at the minor points' : 'sc at the minor points');
  if (p.fill) parts.push(`${p.fill} dc per side loop`);
  if (p.inc) parts.push(`${p.inc} inc`);
  if (p.ch) parts.push(`ch ${p.ch} loops`);
  if (p.ringCh) parts.push(`ch-${p.ringCh} ring`);
  return parts.join(' · ');
}
