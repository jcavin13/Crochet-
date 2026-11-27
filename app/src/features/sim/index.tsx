// 3D page: the spring simulation of a pattern — watch it grow round by round, relaxed or blocked,
// and compare the simulated shape with the analytic flatness check.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PatternPicker, patternHref, useCurrentPattern, useStitchParams } from '@/app';
import type { Pattern } from '@/core/graph';
import { analyzeFlatness, type RoundClass } from '@/core/flatness';
import { paramSetById, paramsFile, simConfig, type ParamSet } from '@/core/params';
import { usePersistentState } from '@/store';
import {
  Badge, Button, Card, EmptyState, Icon, IconButton, Page, PageHeader, SegmentedControl, Select, ShapeBadge, Slider, buttonClass,
} from '@/ui';
import { SimView, usePalette, type ColorBy, type SimStatus } from './SimView';
import { closedShapeNote, explainDisagreement } from './explain';
import { roundColor, toCss, type Palette } from './topology';
import './sim.css';

type Prefs = { colorBy: ColorBy; paramsId: string };
const DEFAULT_PREFS: Prefs = { colorBy: 'round', paramsId: '' };

export default function SimPage() {
  const cur = useCurrentPattern();
  const params = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (!params.id && cur.id && cur.status === 'ready') navigate(patternHref('sim', cur.id), { replace: true });
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
      <Page wide className="sim-page">
        <PageHeader kicker="3D view" title={cur.record.title} actions={<PatternPicker value={cur.id} />} />
        <EmptyState
          title={cur.pending ? 'Checking the pattern…' : 'This pattern has errors'}
          actions={<Link className={buttonClass('primary')} to={patternHref('editor', cur.id!)}>Fix it in the Editor</Link>}
        >
          {cur.pending ? 'One moment.' : 'The simulation runs on the checked pattern. Fix the errors in the Editor first.'}
        </EmptyState>
      </Page>
    );
  }
  return <SimScreen key={cur.id} id={cur.id!} pattern={cur.pattern} title={cur.record.title} />;
}

const CLASS_WORD: Record<'flat' | 'cup' | 'ruffle', string> = { flat: 'tends to lie flat', cup: 'tends to cup', ruffle: 'tends to ruffle' };

function SimScreen({ id, pattern, title }: { id: string; pattern: Pattern; title: string }) {
  const auto = useStitchParams(pattern);
  const [stored, setPrefs] = usePersistentState<Prefs>('sim:prefs', DEFAULT_PREFS);
  const prefs = { ...DEFAULT_PREFS, ...stored };
  const params = ((prefs.paramsId && paramSetById(prefs.paramsId)) || auto.selected) as unknown as ParamSet;
  const nRounds = pattern.graph.rounds.length;
  const [round, setRound] = useState(nRounds - 1);
  const [blocked, setBlocked] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [status, setStatus] = useState<SimStatus | null>(null);
  const onStatus = useCallback((s: SimStatus) => setStatus(s), []);

  const flat = useMemo(() => analyzeFlatness(pattern.graph, params), [pattern.graph, params]);
  const analyticRound = flat.rounds[round];
  const ready = status?.phase === 'ready' && status.shownRound === round;

  // play: step through the rounds, waiting for each one to be solved
  useEffect(() => {
    if (!playing) return;
    if (!ready) return;
    if (round >= nRounds - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setRound((r) => Math.min(nRounds - 1, r + 1)), 450);
    return () => clearTimeout(t);
  }, [playing, ready, round, nRounds]);
  const play = () => {
    if (playing) { setPlaying(false); return; }
    if (round >= nRounds - 1) setRound(0);
    setBlocked(false);
    setPlaying(true);
  };

  const m = status?.metric;
  const blk = status?.block;
  const explanation = m && analyticRound ? explainDisagreement(m.class, analyticRound.class) : null;
  // approximate: the solve stopped at its iteration cap, or used the looser fast tolerances
  const unsettled = !!m && status?.converged === false;
  const approximate = !!m && (unsettled || status?.accuracy === 'fast');
  const closedNote = closedShapeNote(flat.rounds, round);
  const palette = usePalette();

  return (
    <Page wide className="sim-page">
      <PageHeader kicker="3D view" title={title} actions={<PatternPicker value={id} />} />
      <div className="sim-layout">
        <div className="sim-main">
          <div className="sim-toolbar">
            <SegmentedControl label="Boundary" value={blocked ? 'blocked' : 'relaxed'}
              onChange={(v) => { setPlaying(false); setBlocked(v === 'blocked'); }}
              options={[{ value: 'relaxed', label: 'Relaxed', title: 'Free in space' }, { value: 'blocked', label: 'Blocked', title: 'Pinned flat, edge stretched 5 %' }]} />
            <span className="spacer" />
            <IconButton icon="cube" label="Reset view" onClick={() => setResetKey((k) => k + 1)} />
          </div>
          <SimView pattern={pattern} params={params} uptoRound={round} blocked={blocked} colorBy={prefs.colorBy}
            onStatus={onStatus} resetViewKey={resetKey} />
          <div className="sim-roundbar">
            <Button className="sim-play" variant={playing ? 'default' : 'primary'} onClick={play} aria-pressed={playing}
              disabled={nRounds < 2}>{playing ? 'Pause' : 'Play'}</Button>
            <Slider label="Show up to" min={0} max={Math.max(0, nRounds - 1)} value={round}
              onChange={(v) => { setPlaying(false); setRound(v); }}
              format={(v) => `${pattern.graph.rounds[v]?.label ?? v + 1} (${v + 1} of ${nRounds})`} />
          </div>
          <Legend by={prefs.colorBy} nRounds={nRounds} palette={palette} scale={status?.strainScale ?? 0.1} />
        </div>

        <aside className="sim-side">
          <Card>
            <h2 className="ui-card__title">Shape</h2>
            <dl className="sim-shape">
              <dt>Simulation</dt>
              <dd>
                {m ? <><ShapeBadge shape={m.class}>{`tends to ${m.class === 'flat' ? 'lie flat' : m.class}`}</ShapeBadge><span className="small">A {m.A.toFixed(2)} · W {m.W.toFixed(2)}</span>
                  {approximate && <Badge tone="warning">{unsettled ? 'approximate — did not fully settle' : 'approximate (fast solve)'}</Badge>}</>
                  : <span className="small muted">{status?.phase === 'error' ? 'failed' : 'solving…'}</span>}
              </dd>
              <dt>Count rule</dt>
              <dd>
                {analyticRound && analyticRound.class !== 'n/a'
                  ? <><ShapeBadge shape={analyticRound.class}>{analyticRound.slackOnly ? 'flat (loose loops)' : undefined}</ShapeBadge><span className="small">{pct(analyticRound.e)}</span></>
                  : <Badge>n/a</Badge>}
              </dd>
              {m && <><dt>Size</dt><dd className="small">Rg {(m.Rg / 10).toFixed(1)} cm · edge radius {(m.outer_radius / 10).toFixed(1)} cm</dd></>}
            </dl>
            {m && (
              <p className="sim-explain">
                {pattern.graph.rounds[round]?.label ?? 'This round'}: the simulated piece {CLASS_WORD[m.class]}
                {m.class === 'flat' ? '' : m.class === 'cup' ? ` (depth A = ${m.A.toFixed(2)} of its size)` : ` (waviness W = ${m.W.toFixed(2)})`}.
                {' '}{explanation ?? (approximate ? 'The count rule points the same way, but this state is approximate.' : 'The count rule points the same way.')}
              </p>
            )}
            {approximate && (
              <p className="sim-explain sim-approx" role="note">
                <Icon name="alert" size={16} />{' '}
                {unsettled
                  ? 'Approximate — the solver did not fully settle (it hit its iteration limit), so A, W and the shape class may still change. Treat them as a rough tendency.'
                  : 'Approximate — this large piece was solved to a looser tolerance, so A and W are rough and a shape with several stable forms may settle differently.'}
              </p>
            )}
            {closedNote && <p className="sim-explain muted">{closedNote}</p>}
            {analyticRound && analyticRound.class !== 'n/a' && (analyticRound.class !== 'flat' || analyticRound.slackOnly) && (
              <p className="sim-explain muted">{analyticRound.message}</p>
            )}
          </Card>

          <Card>
            <h2 className="ui-card__title">Display</h2>
            <Select label="Colour" value={prefs.colorBy} onChange={(e) => setPrefs({ ...prefs, colorBy: e.target.value as ColorBy })}>
              <option value="round">By round</option>
              <option value="strain">By strain (stretched / compressed)</option>
              <option value="flatness">By flatness check of each round</option>
            </Select>
            <Select label="Yarn & hook" value={prefs.paramsId} onChange={(e) => setPrefs({ ...prefs, paramsId: e.target.value })}>
              <option value="">Auto ({auto.selected.label})</option>
              {paramsFile.sets.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Card>

          <Card>
            <h2 className="ui-card__title">Blocking</h2>
            {blocked ? (
              blk ? (
                <>
                  <p className="sim-verdict" data-verdict={blk.verdict}><Icon name={blk.verdict === 'impossible' ? 'alert' : 'check'} size={18} />{blk.message}</p>
                  <p className="small muted">
                    Mean strain {(blk.meanAbsStrain * 100).toFixed(1)} %, max {(blk.maxAbsStrain * 100).toFixed(0)} %;
                    {' '}{(blk.buckleFraction * 100).toFixed(1)} % of the course compressed more than {(simConfig.block_buckle_strain * 100).toFixed(0)} %.
                  </p>
                </>
              ) : <p className="small muted">Pinning it out…</p>
            ) : (
              <p className="small muted">Switch to <strong>Blocked</strong> to pin the piece flat, with the edge stretched {Math.round((simConfig.block_stretch - 1) * 100)} %, and see whether it can be blocked.</p>
            )}
          </Card>

          <Card>
            <h2 className="ui-card__title">How to read this</h2>
            <p className="small">Each stitch is a post from where it was worked to its top; the yarn runs through the tops. Thin grey arcs are chain loops. Drag to turn, pinch or scroll to zoom, two fingers to pan.</p>
            <ul className="sim-limits">
              <li>Stitch-level springs, not yarn: it shows the shape, not the drape or the texture.</li>
              <li>Nominal stitch sizes for the chosen yarn and hook; your tension will differ.</li>
              <li>No gravity, no stuffing, and no self-collision: strong ruffles may pass through themselves, and closed shapes relax like an empty bag.</li>
              <li>It reacts to mismatches of a few percent; the count rule tolerates ±{Math.round(simConfig.flatness.tol * 100)} %. When they differ, neither is the final word: the 3D shape is a tendency, not a verdict.</li>
              <li>Ruffled and closed shapes have several stable forms; the one shown is one of them.</li>
            </ul>
            {status && (
              <p className="small muted">
                {status.nNodes} stitches · {status.mode === 'worker' ? 'solved in a background worker' : 'solved on the page'} · {status.renderer === 'webgl' ? '3D' : 'flat projection'}
                {status.accuracy === 'fast' && ' · large piece: solved to a looser tolerance, so A and W are approximate'}
                {status.converged === false && ' · did not fully settle'}
              </p>
            )}
          </Card>
        </aside>
      </div>
    </Page>
  );
}

const fmtPct = (x: number) => `${x < 0.1 ? (x * 100).toFixed(1) : Math.round(x * 100)} %`;
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} % length`;

function Legend({ by, nRounds, palette, scale }: { by: ColorBy; nRounds: number; palette: Palette; scale: number }) {
  if (by === 'strain') {
    const grad = `linear-gradient(90deg, ${toCss(palette.compression)}, ${toCss(palette.neutral)}, ${toCss(palette.tension)})`;
    return (
      <ul className="sim-legend" aria-label="Legend">
        <li>compressed −{fmtPct(scale)}<span className="sim-ramp" style={{ background: grad }} />stretched +{fmtPct(scale)}</li>
      </ul>
    );
  }
  if (by === 'flatness') {
    return (
      <ul className="sim-legend" aria-label="Legend">
        <li><span className="sim-swatch" style={{ background: 'var(--shape-flat)' }} />round lies flat</li>
        <li><span className="sim-swatch" style={{ background: 'var(--shape-cup)' }} />too few stitches (cups)</li>
        <li><span className="sim-swatch" style={{ background: 'var(--shape-ruffle)' }} />too many (ruffles)</li>
      </ul>
    );
  }
  return (
    <ul className="sim-legend" aria-label="Legend">
      <li><span className="sim-swatch" style={{ background: toCss(roundColor(0, nRounds, palette)) }} />odd rounds</li>
      <li><span className="sim-swatch" style={{ background: toCss(roundColor(1, nRounds, palette)) }} />even rounds</li>
      <li><span className="sim-swatch" style={{ background: toCss(palette.chain) }} />chain loops, slip stitches</li>
    </ul>
  );
}
