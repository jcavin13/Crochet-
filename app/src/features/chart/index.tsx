import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PatternPicker, patternHref, useCurrentPattern, useStitchParams } from '@/app';
import { analyzeFlatness } from '@/core/flatness';
import type { ParamSet } from '@/core/params';
import type { ScGlyph, SymbolSet } from '@/core/chart';
import { usePersistentState, useSettings } from '@/store';
import {
  Badge, Button, Card, EmptyState, Icon, Page, PageHeader, SegmentedControl, ShapeBadge, Slider, Toggle, buttonClass, toast,
} from '@/ui';
import { ChartView, useChartLayout } from './ChartView';
import { ChartLegend } from './Legend';
import { downloadChartPng, downloadChartSvg } from './export';
import './chart.css';

type Prefs = { flatness: boolean; labels: boolean; set: SymbolSet; sc: ScGlyph; print: boolean };
const DEFAULT_PREFS: Prefs = { flatness: true, labels: true, set: 'cyc', sc: 'x', print: false };

export default function ChartPage() {
  const cur = useCurrentPattern();
  const params = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (!params.id && cur.id && cur.status === 'ready') navigate(patternHref('chart', cur.id), { replace: true });
  }, [params.id, cur.id, cur.status, navigate]);

  if (cur.status === 'loading') return <div className="shell-loading" role="progressbar" aria-label="Loading"><span /></div>;
  if (cur.status === 'missing' || !cur.record) {
    return (
      <Page>
        <EmptyState title="Pattern not found" actions={<Link className={buttonClass()} to="/library">Open the library</Link>}>
          It may have been deleted, or it lives in another browser.
        </EmptyState>
      </Page>
    );
  }
  if (!cur.pattern) {
    return (
      <Page wide className="ch-page">
        <PageHeader kicker="Chart" title={cur.record.title} actions={<PatternPicker value={cur.id} />} />
        <EmptyState
          title={cur.pending ? 'Checking the pattern…' : 'This pattern has errors'}
          actions={<Link className={buttonClass('primary')} to={patternHref('editor', cur.id!)}>Fix it in the Editor</Link>}
        >
          {cur.pending ? 'One moment.' : 'The chart is drawn from the checked pattern. Fix the errors in the Editor first.'}
        </EmptyState>
      </Page>
    );
  }
  return <ChartScreen key={cur.id} id={cur.id!} pattern={cur.pattern} title={cur.record.title} />;
}

function ChartScreen({ id, pattern, title }: { id: string; pattern: NonNullable<ReturnType<typeof useCurrentPattern>['pattern']>; title: string }) {
  const { selected } = useStitchParams(pattern);
  const params = selected as unknown as ParamSet;
  const layout = useChartLayout(pattern, params);
  const flat = useMemo(() => analyzeFlatness(pattern.graph, params), [pattern.graph, params]);
  const terms = useSettings((s) => s.terms);
  const setSettings = useSettings((s) => s.set);
  const [stored, setPrefs] = usePersistentState<Prefs>('chart:prefs', DEFAULT_PREFS);
  const prefs = { ...DEFAULT_PREFS, ...stored };
  const set = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...DEFAULT_PREFS, ...p, ...patch }));
  const rounds = pattern.graph.rounds;
  const [upto, setUpto] = useState(rounds.length - 1);
  useEffect(() => { setUpto(rounds.length - 1); }, [rounds.length]);
  const showFlat = prefs.flatness && !prefs.print;
  const svgOpts = {
    symbols: { set: prefs.set, sc: prefs.sc }, showFlatness: showFlat, showLabels: prefs.labels, uptoRound: upto,
    title, terms, mono: prefs.print,
  };

  const exportSvg = () => { downloadChartSvg(layout, svgOpts, title); toast('Chart downloaded as SVG'); };
  const exportPng = () => {
    downloadChartPng(layout, svgOpts, title).then(() => toast('Chart downloaded as PNG'), (e: Error) => toast(e.message, { tone: 'error' }));
  };
  const print = () => {
    if (!prefs.print) set({ print: true });
    setTimeout(() => window.print(), 120);
  };

  const worst = flat.worst;
  const nodeCount = useMemo(() => {
    const R = rounds[upto];
    return R && R.last >= 0 ? R.last + 1 : pattern.graph.nodes.length;
  }, [rounds, upto, pattern.graph.nodes.length]);

  return (
    <Page wide className={`ch-page${prefs.print ? ' is-print' : ''}`}>
      <PageHeader
        kicker="Chart"
        title={title}
        description={layout.mode === 'rows' ? 'Worked in rows: a grid chart, read from the bottom up.' : 'Symbol chart, read from the centre outward, round by round.'}
        actions={(
          <div className="row">
            <Link className={buttonClass('default', 'sm')} to={patternHref('editor', id)}><Icon name="edit" size={18} />Editor</Link>
            <Link className={buttonClass('default', 'sm')} to={patternHref('counter', id)}><Icon name="counter" size={18} />Counter</Link>
          </div>
        )}
      />
      <div className="ch-layout">
        <div className="ch-main">
          <Card className="ch-controls">
            <div className="ch-toolbar">
              <PatternPicker value={id} />
              <div style={{ flex: '1 1 220px' }}>
                <Slider
                  label="Show up to"
                  value={upto}
                  min={0}
                  max={Math.max(0, rounds.length - 1)}
                  onChange={setUpto}
                  format={(v) => `${rounds[v]?.label ?? ''} of ${rounds.length}`}
                />
              </div>
            </div>
            <div className="ch-toggles">
              <Toggle label="Flatness band" checked={prefs.flatness} onChange={(v) => set({ flatness: v })} disabled={layout.mode !== 'radial' || prefs.print} />
              <Toggle label="Round numbers" checked={prefs.labels} onChange={(v) => set({ labels: v })} />
              <Toggle label="Print-friendly" checked={prefs.print} onChange={(v) => set({ print: v })} />
              <SegmentedControl
                label="Symbol set"
                value={prefs.set}
                onChange={(v) => set({ set: v })}
                options={[{ value: 'cyc', label: 'CYC', title: 'Craft Yarn Council symbols' }, { value: 'jis', label: 'JIS', title: 'Japanese chart conventions' }]}
              />
              <SegmentedControl
                label="Single crochet symbol"
                value={prefs.sc}
                onChange={(v) => set({ sc: v })}
                options={[{ value: 'x', label: '×', title: 'sc as ×' }, { value: 'plus', label: '+', title: 'sc as +' }]}
              />
              <SegmentedControl
                label="Terminology"
                value={terms}
                onChange={(v) => setSettings({ terms: v })}
                options={[{ value: 'US', label: 'US', title: 'US names (sc, dc…)' }, { value: 'UK', label: 'UK', title: 'UK names (dc, tr…)' }]}
              />
            </div>
          </Card>
          <div className="ch-print-area">
            <Card className="ch-stage">
              <ChartView
                pattern={pattern}
                params={params}
                layout={layout}
                showFlatness={showFlat}
                showLabels={prefs.labels}
                uptoRound={upto}
                symbolSet={prefs.set}
                scGlyph={prefs.sc}
                terms={terms}
              />
            </Card>
            <p className="muted small" style={{ margin: 'var(--s-2) 0 0' }}>
              {nodeCount} stitches and chains shown · drag to pan, pinch or scroll to zoom, double-tap to reset · tap a symbol for what it is
            </p>
          </div>
        </div>

        <aside className="ch-side">
          <Card>
            <h2>Legend</h2>
            <ChartLegend layout={layout} terms={terms} symbolSet={prefs.set} scGlyph={prefs.sc} upto={upto} showFlatness={showFlat} />
          </Card>
          <Card>
            <h2>Flatness by round</h2>
            {!flat.applicable ? (
              <p className="muted small" style={{ margin: 0 }}>Worked in rows — the flatness check applies to pieces worked in the round.</p>
            ) : (
              <>
                <p className="ch-worst">
                  {worst
                    ? <><ShapeBadge shape={worst.class as 'cup' | 'ruffle'} /> <strong>Worst: {worst.message}</strong></>
                    : <><ShapeBadge shape="flat" /> Every round lies flat.</>}
                </p>
                <ul className="ch-report">
                  {flat.rounds.map((r) => (
                    <li key={r.round} className={worst && worst.round === r.round ? 'is-worst' : undefined}>
                      <button type="button" onClick={() => setUpto(r.round)} aria-label={`Show up to ${r.label}`}>
                        {r.class === 'n/a' ? <Badge tone="outline">n/a</Badge> : <ShapeBadge shape={r.class} />}
                        <span>{r.message}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="muted small" style={{ margin: 'var(--s-2) 0 0' }}>
                  Analytic check (rounds treated as circles; cornered motifs read slightly “over”). Tap a round to show the chart up to it.
                </p>
              </>
            )}
          </Card>
          <Card>
            <h2>Export</h2>
            <div className="ch-export">
              <Button size="sm" icon="download" onClick={exportSvg}>SVG</Button>
              <Button size="sm" icon="download" onClick={exportPng}>PNG</Button>
              <Button size="sm" onClick={print}>Print…</Button>
            </div>
            <p className="muted small" style={{ margin: 'var(--s-2) 0 0' }}>
              Exports the chart as shown (up to {rounds[upto]?.label}), with its legend. Symbols after the Craft Yarn Council chart conventions.
            </p>
          </Card>
        </aside>
      </div>
    </Page>
  );
}
