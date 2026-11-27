/**
 * 3D view of the spring simulation of a pattern. Other features embed the 3D view only through
 * this component and these props (designer, counter, amigurumi).
 *
 * The sim runs in a Web Worker (main-thread fallback), grows the piece round by round and keeps
 * per-round snapshots. Rendering: three.js (lazy chunk) with instanced stitch posts, course yarn
 * and stitch tops; a 2D projected SVG when WebGL is unavailable.
 */
import { Component, Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Pattern } from '@/core/graph';
import { analyzeFlatness, type RoundClass } from '@/core/flatness';
import { paramsFor, type ParamSet } from '@/core/params';
import type { BlockPin, BlockSummary, SimPhase } from '@/core/sim';
import { useSettings } from '@/store';
import { SegmentedControl, ShapeBadge, Slider } from '@/ui';
import type { MetricSummary } from './protocol';
import { SvgView } from './SvgView';
import { buildTopology, readPalette, rotationToY, strainScale, type ColorBy, type ColorInputs, type Palette } from './topology';
import { useSimulation, type SimMode } from './useSimulation';
import './sim.css';

const Scene3D = lazy(() => import('./Scene3D'));

export type { ColorBy } from './topology';

export interface SimStatus {
  phase: SimPhase | 'starting' | 'error';
  nRounds: number;
  roundsGrown: number;
  shownRound: number;
  metric?: MetricSummary;
  block?: BlockSummary;
  error?: string;
  mode: SimMode;
  renderer: 'webgl' | 'svg';
  nNodes: number;
  accuracy?: 'reference' | 'fast';
  /** the shown state settled to the solver tolerance (undefined while solving) */
  converged?: boolean;
  /** strain shown at full colour in 'strain' colouring */
  strainScale: number;
}

export interface SimViewProps {
  pattern: Pattern;
  params?: ParamSet;
  /** Simulate only rounds 0..uptoRound. Default: all. */
  uptoRound?: number;
  /** Blocked (pinned flat) instead of relaxed. Default false. */
  blocked?: boolean;
  /** Node to emphasise. */
  highlightNode?: number;
  /** Show the built-in controls (round slider, relaxed/blocked toggle). Default false: bare canvas. */
  controls?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Colouring (optional). Default 'round'. */
  colorBy?: ColorBy;
  /** Called whenever the solve state changes (optional). */
  onStatus?: (s: SimStatus) => void;
  /** Change this value to reset the camera (optional). */
  resetViewKey?: number | string;
  /** Force the 2D projected rendering (optional; also used when WebGL is unavailable). */
  forceSvg?: boolean;
  /**
   * Relaxed state "resting on a table": grown flat, then let go on a table under a weak weight
   * (core/sim/table.ts). A viewer option for pieces meant to lie flat; it never changes the shape
   * classification of the plain sim. Default false.
   */
  table?: boolean;
  /** Explicit pins `{node, x, y}` (mm, any rigid frame) for the blocked state. Default: physics.md §6. */
  pins?: BlockPin[];
}

let webglCache: boolean | null = null;
export function webglAvailable(): boolean {
  if (webglCache !== null) return webglCache;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    webglCache = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglCache = false;
  }
  return webglCache;
}

class GlBoundary extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Theme-aware palette, re-read when the theme setting or the system scheme changes. */
export function usePalette(): Palette {
  const theme = useSettings((s) => s.theme);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const on = () => setTick((t) => t + 1);
    mq?.addEventListener?.('change', on);
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    return () => { mq?.removeEventListener?.('change', on); mo.disconnect(); };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readPalette(), [theme, tick]);
}

const fmt = (x: number) => x.toFixed(2);

export function SimView(props: SimViewProps) {
  const { pattern, controls = false, className, style, highlightNode, colorBy = 'round', onStatus, resetViewKey, forceSvg } = props;
  const params = props.params ?? paramsFor(pattern);
  const nRounds = pattern.graph.rounds.length;
  // built-in controls own their state, seeded from the props
  const [ownRound, setOwnRound] = useState<number>(props.uptoRound ?? nRounds - 1);
  const [ownBlocked, setOwnBlocked] = useState<boolean>(!!props.blocked);
  useEffect(() => { setOwnRound(props.uptoRound ?? nRounds - 1); }, [props.uptoRound, nRounds]);
  useEffect(() => { setOwnBlocked(!!props.blocked); }, [props.blocked]);
  const upto = Math.max(0, Math.min(nRounds - 1, controls ? ownRound : (props.uptoRound ?? nRounds - 1)));
  const blocked = controls ? ownBlocked : !!props.blocked;

  const { network, error, frame, mode } = useSimulation(pattern, params, upto, blocked, { table: props.table, pins: props.pins });
  const topology = useMemo(() => (network ? buildTopology(network) : null), [network]);
  const palette = usePalette();
  const [glFailed, setGlFailed] = useState(false);
  const useGl = !forceSvg && !glFailed && webglAvailable();

  const roundClass = useMemo<RoundClass[]>(() => {
    try { return analyzeFlatness(pattern.graph, params).rounds.map((r) => r.class); } catch { return []; }
  }, [pattern.graph, params]);

  // orientation: the full piece's axis once known (kept while scrubbing rounds), else +z
  const [axis, setAxis] = useState<[number, number, number]>([0, 0, 1]);
  useEffect(() => { setAxis([0, 0, 1]); }, [network]);
  const fm = frame?.metric;
  useEffect(() => {
    // on a table the table's normal (+z) is up; the shape metric's axis of a piece that lies flat
    // can point anywhere in its plane
    if (fm && frame && frame.step.shownRound === nRounds - 1 && !blocked && !props.table) setAxis(fm.axis);
  }, [fm, frame, nRounds, blocked, props.table]);
  const rotation = useMemo(() => rotationToY(axis), [axis]);
  // flat pieces (and blocked ones) are best seen from well above, 3D shapes from the side
  const [elevation, setElevation] = useState(55);
  useEffect(() => {
    if (fm && frame && frame.step.shownRound === nRounds - 1) setElevation(fm.class === 'flat' ? 58 : 28);
  }, [fm, frame, nRounds]);
  const elev = blocked ? 86 : props.table ? 80 : elevation;

  const [strain, setStrain] = useState<Float32Array | undefined>(undefined);
  useEffect(() => { if (frame?.strain) setStrain(frame.strain); }, [frame]);
  const sScale = useMemo(() => strainScale(strain, network?.slack), [strain, network]);
  const colors = useMemo<ColorInputs>(() => ({ by: colorBy, palette, strain: colorBy === 'strain' ? strain : undefined, roundClass, strainScale: sScale }), [colorBy, palette, strain, roundClass, sScale]);

  const done = !!frame?.step.done;
  const phase: SimStatus['phase'] = error ? 'error' : frame ? frame.step.phase : 'starting';
  useEffect(() => {
    onStatus?.({
      phase, nRounds, roundsGrown: frame?.step.roundsGrown ?? 0, shownRound: frame?.step.shownRound ?? upto,
      metric: frame?.metric, block: frame?.block, error: error ?? undefined, mode, renderer: useGl ? 'webgl' : 'svg',
      nNodes: network?.nNodes ?? 0, accuracy: frame?.accuracy, converged: frame?.converged, strainScale: sScale,
    });
  }, [phase, frame?.step.roundsGrown, frame?.step.shownRound, frame?.metric, frame?.block, frame?.converged, error, mode, useGl, nRounds, upto, network, onStatus, sScale]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitKey = `${network ? network.nNodes : 0}|${resetViewKey ?? ''}|${blocked}|${done ? 'done' : 'live'}|${axis.join(',')}|${elev}`;
  const positions = frame?.positions ?? null;
  const svg = topology && <SvgView topology={topology} positions={positions} rotation={rotation} colors={colors} highlightNode={highlightNode} elevation={elev} />;
  const solving = !error && !done;
  const label = phase === 'blocking' ? 'Blocking…' : phase === 'relaxing' ? 'Relaxing…' : 'Solving…';

  return (
    <div className={['sim-view', controls && 'sim-view--controls', className].filter(Boolean).join(' ')} style={style}>
      <div className="sim-stage" data-state={done ? 'ready' : 'solving'} data-renderer={useGl ? 'webgl' : 'svg'}>
        {error ? (
          <div className="sim-msg" role="alert">The simulation could not run: {error}</div>
        ) : topology ? (
          useGl ? (
            <GlBoundary fallback={svg} onError={() => setGlFailed(true)}>
              <Suspense fallback={svg}>
                <Scene3D topology={topology} positions={positions} rotation={rotation} colors={colors} highlightNode={highlightNode}
                  fitKey={fitKey} autoFit elevation={elev} onContextLost={() => setGlFailed(true)} />
              </Suspense>
            </GlBoundary>
          ) : svg
        ) : null}
        {!useGl && !error && (
          <p className="sim-note small">3D needs WebGL, which this browser does not offer — showing a flat projection.</p>
        )}
        {solving && (
          <div className="sim-busy" role="status" aria-live="polite">
            <span className="sim-busy__spin" aria-hidden="true" />
            {label} {frame && phase === 'growing' ? `round ${Math.min(frame.step.roundsGrown + 1, nRounds)} of ${nRounds}` : ''}
          </div>
        )}
      </div>
      {controls && (
        <div className="sim-controls">
          {nRounds > 1 && (
            <Slider label="Rounds" min={0} max={nRounds - 1} value={ownRound} onChange={setOwnRound}
              format={(v) => `${pattern.graph.rounds[v]?.label ?? v + 1} of ${nRounds}`} />
          )}
          <div className="sim-controls__row">
            <SegmentedControl label="Boundary" value={ownBlocked ? 'blocked' : 'relaxed'} onChange={(v) => setOwnBlocked(v === 'blocked')}
              options={[{ value: 'relaxed', label: 'Relaxed' }, { value: 'blocked', label: 'Blocked' }]} />
            {frame?.metric && !ownBlocked && (
              <span className="sim-readout small">
                <ShapeBadge shape={frame.metric.class}>{`tends to ${frame.metric.class === 'flat' ? 'lie flat' : frame.metric.class}`}</ShapeBadge> A {fmt(frame.metric.A)} · W {fmt(frame.metric.W)}
                {(frame.converged === false || frame.accuracy === 'fast') && <> · <em>{frame.converged === false ? 'approximate — did not fully settle' : 'approximate (fast solve)'}</em></>}
              </span>
            )}
            {ownBlocked && frame?.block && <span className="sim-readout small">{frame.block.message}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default SimView;
