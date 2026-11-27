// Shape tab: profile → round-by-round amigurumi pattern.
import { Suspense, lazy, useDeferredValue, useMemo, useState } from 'react';
import { Badge, Button, Card, SegmentedControl, Select, Slider, SplitPane, Toggle } from '@/ui';
import { useCompiled, useStitchParams } from '@/app';
import { usePersistentState } from '@/store';
import {
  PRESETS, presetById, presetProfile, revolve, scaleProfile, profileBounds, startCountFor,
  type AmiStitch, type ProfilePoint, type RevolveResult,
} from '@/core/amigurumi';
import { paramSetById, paramsFile } from '@/core/params';
import type { SimViewProps } from '@/features/sim/SimView';
import { KIND_COLOR, ProfileEditor } from './ProfileEditor';
import { LathePreview } from './LathePreview';
import { PatternOutput } from './PatternOutput';

const SimView = lazy(() => import('@/features/sim/SimView')) as React.LazyExoticComponent<(p: SimViewProps) => React.ReactNode>;

interface ShapeState {
  preset: string;
  custom: boolean;
  points: ProfilePoint[];
  smooth: boolean;
  stitch: AmiStitch;
  paramsId: string; // '' = the app setting
  stagger: boolean;
  repeat: boolean;
  crisp: boolean;
  snap: boolean;
}

const fromPreset = (id: string, height?: number): Pick<ShapeState, 'preset' | 'custom' | 'points' | 'smooth'> => {
  const p = presetProfile(id, height);
  return { preset: id, custom: false, points: p.points, smooth: p.smooth !== false };
};
const INITIAL: ShapeState = { ...fromPreset('sphere'), stitch: 'sc', paramsId: '', stagger: true, repeat: false, crisp: true, snap: true };

const cm = (mm: number, d = 1) => `${(mm / 10).toFixed(d)} cm`;

export function ShapeTab() {
  const [st, setSt] = usePersistentState<ShapeState>('amigurumi:shape', INITIAL);
  const set = (patch: Partial<ShapeState>) => setSt((s) => ({ ...s, ...patch }));
  const { selectedId: appParamsId } = useStitchParams();
  const appParams = paramSetById(appParamsId) ?? paramsFile.sets[0];
  const sets = paramsFile.sets;
  const params = (st.paramsId && paramSetById(st.paramsId)) || appParams;
  const [sel, setSel] = useState<number | null>(null);
  const [hl, setHl] = useState<number | null>(null);
  const [simOn, setSimOn] = useState(false);

  const pts = useDeferredValue(st.points);
  const preset = presetById(st.preset);
  const title = st.custom ? `Custom shape (${preset?.label.toLowerCase() ?? 'shape'})` : `${preset?.label ?? 'Shape'} ${cm(profileBounds(pts).zMax - profileBounds(pts).zMin)}`;
  const result = useMemo<RevolveResult | null>(() => {
    try {
      return revolve({
        profile: { points: pts, smooth: st.smooth }, params, stitch: st.stitch, stagger: st.stagger,
        crispCorners: st.crisp, repeat: st.repeat ? startCountFor(params, st.stitch) : 1, title,
      });
    } catch {
      return null;
    }
  }, [pts, st.smooth, params, st.stitch, st.stagger, st.crisp, st.repeat, title]);

  const b = profileBounds(st.points);
  const heightMm = b.zMax - b.zMin;
  const setHeight = (mm: number) => set({ points: scaleProfile({ points: st.points }, mm).points });

  const selPt = sel !== null ? st.points[sel] : undefined;
  const updatePoints = (points: ProfilePoint[]) => set({ points, custom: true });
  const addPoint = () => {
    // after the selected point, or in the middle of the longest span
    const P = st.points;
    let i = sel ?? -1;
    if (i < 0 || i >= P.length - 1) {
      let best = 0, len = -1;
      for (let j = 0; j + 1 < P.length; j++) { const l = Math.hypot(P[j + 1].r - P[j].r, P[j + 1].z - P[j].z); if (l > len) { len = l; best = j; } }
      i = best;
    }
    const a = P[i], c = P[i + 1];
    const mid = { r: +((a.r + c.r) / 2).toFixed(1), z: +((a.z + c.z) / 2).toFixed(1) };
    updatePoints([...P.slice(0, i + 1), mid, ...P.slice(i + 1)]);
    setSel(i + 1);
  };

  const shapePane = (
    <div className="stack">
      <Card className="ami-controls">
        <div className="ami-controls__grid">
          <Select label="Preset" hint={preset && !st.custom ? preset.description : 'Edited by hand — pick a preset to start over.'} value={st.custom ? '' : st.preset} onChange={(e) => { if (e.target.value) { set(fromPreset(e.target.value)); setSel(null); } }}>
            {st.custom && <option value="">Custom (edited)</option>}
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
          <Slider label="Height" value={Math.round(heightMm)} min={15} max={300} step={1} onChange={setHeight} format={(v) => cm(v)} />
          <div className="ui-field">
            <span className="ui-field__label">Stitch</span>
            <SegmentedControl label="Stitch" value={st.stitch} onChange={(v) => set({ stitch: v })}
              options={[{ value: 'sc', label: 'sc' }, { value: 'hdc', label: 'hdc' }, { value: 'dc', label: 'dc' }]} />
          </div>
          <Select label="Yarn and hook" value={st.paramsId} onChange={(e) => set({ paramsId: e.target.value })}
            hint={`${st.stitch} ${params.stitches[st.stitch].width.toFixed(1)} × ${params.stitches[st.stitch].height.toFixed(1)} mm`}>
            <option value="">App setting ({appParams.label})</option>
            {sets.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </div>
      </Card>

      <Card flush className="ami-editor-card">
        <div className="ami-editor-bar">
          <Button size="sm" icon="plus" onClick={addPoint}>Add point</Button>
          <Button size="sm" icon="trash" disabled={sel === null || st.points.length <= 2}
            onClick={() => { updatePoints(st.points.filter((_, j) => j !== sel)); setSel(null); }}>Remove</Button>
          <Button size="sm" disabled={!selPt || !st.smooth}
            onClick={() => sel !== null && updatePoints(st.points.map((p, j) => (j === sel ? { ...p, corner: !p.corner } : p)))}>
            {selPt?.corner ? 'Make smooth' : 'Make corner'}
          </Button>
          <span className="spacer" />
          <Toggle label="Snap" checked={st.snap} onChange={(v) => set({ snap: v })} />
          <Toggle label="Smooth" checked={st.smooth} onChange={(v) => set({ smooth: v, custom: true })} />
          {st.custom && <Button size="sm" variant="ghost" onClick={() => { set(fromPreset(st.preset)); setSel(null); }}>Reset</Button>}
        </div>
        <ProfileEditor points={st.points} smooth={st.smooth} onChange={updatePoints} result={result ?? undefined}
          snap={st.snap} selected={sel} onSelect={setSel} highlightRound={hl} />
        <div className="ami-legend small">
          <span><i className="ami-swatch ami-swatch--target" /> drawn profile</span>
          <span><i className="ami-swatch ami-swatch--real" /> what the counts make</span>
          <span><i className="ami-dot" style={{ background: KIND_COLOR.inc }} /> inc</span>
          <span><i className="ami-dot" style={{ background: KIND_COLOR.dec }} /> dec</span>
          <span><i className="ami-dot" style={{ background: KIND_COLOR.even }} /> even</span>
        </div>
        <p className="small muted ami-editor-help">Drag the points. Tap the curve to add a point; select one to remove it or make it a corner (arrow keys nudge it). The dashed line is the axis the profile is turned around.</p>
      </Card>

      <Card>
        <div className="stack">
          <Toggle label="Stagger increases between rounds" checked={st.stagger} onChange={(v) => set({ stagger: v })} />
          <p className="small muted ami-explain">
            Increases (and decreases) are spaced evenly around each round. If every round put them in the same
            places they would stack into columns and the piece would grow corners — the hexagon look of a
            textbook ball. With staggering on, each round's increases are placed midway between the previous
            round's (as near as the stitches allow, keeping clear of the round before too). Turn it off to
            stack them deliberately, e.g. for a hexagonal or pointed look.
          </p>
          <Toggle label={`Symmetric repeats (counts in multiples of ${result ? startCountFor(params, st.stitch) : 6})`} checked={st.repeat} onChange={(v) => set({ repeat: v })} />
          <Toggle label="Crisp corners (back loops only after a sharp corner)" checked={st.crisp} onChange={(v) => set({ crisp: v })} />
        </div>
      </Card>
    </div>
  );

  const compiled = useCompiled(result?.text ?? '', 400);

  const patternPane = result ? (
    <div className="stack">
      <Card>
        <div className="ami-preview">
          <LathePreview result={result} />
          <dl className="ami-stats">
            <div><dt>Rounds</dt><dd>{result.rounds.length}</dd></div>
            <div><dt>Stitches</dt><dd>{result.totalStitches}</dd></div>
            <div><dt>Height</dt><dd>{cm(result.dims.heightMm)} <span className="muted">/ {cm(result.targetDims.heightMm)} drawn</span></dd></div>
            <div><dt>Widest</dt><dd>{cm(result.dims.diameterMm)} <span className="muted">/ {cm(result.targetDims.diameterMm)} drawn</span></dd></div>
            <div><dt>Yarn</dt><dd>≈ {Math.round(result.yarnMm / 1000)} m <span className="muted">(rough, ±30%)</span></dd></div>
            <div><dt>Start</dt><dd>{result.start.kind === 'ring' ? `magic ring, ${result.start.count}` : `chain ring of ${result.start.count}`}</dd></div>
          </dl>
        </div>
        <CountStrip result={result} onHover={setHl} />
      </Card>

      {result.warnings.length > 0 && (
        <Card className="ami-warnings">
          <ul>
            {result.warnings.map((w, i) => (
              <li key={i}><Badge tone={w.severity === 'warning' ? 'warning' : 'info'}>{w.severity === 'warning' ? 'Check' : 'Note'}</Badge> <span>{w.message}</span></li>
            ))}
          </ul>
        </Card>
      )}

      {st.preset === 'sphere' && !st.custom && <SphereNote result={result} />}

      <Card>
        <h2 className="ui-card__title">Pattern</h2>
        <PatternOutput text={result.text} maxHeight={360} />
      </Card>

      <Card>
        <div className="row">
          <h2 className="ui-card__title" style={{ margin: 0 }}>Physics preview</h2>
          <span className="spacer" />
          <Toggle label="Simulate" checked={simOn} onChange={setSimOn} />
        </div>
        <p className="small muted">The spring simulation of the compiled pattern — a second opinion on the shape (unstuffed). It can be slow on large pieces.</p>
        {simOn && (compiled.pattern
          ? <Suspense fallback={<p className="small muted">Loading the 3D view…</p>}>
              <div className="ami-sim"><SimView pattern={compiled.pattern} params={params} controls /></div>
            </Suspense>
          : <p className="small muted">Compiling…</p>)}
      </Card>

      <RoundTable result={result} onHover={setHl} />
    </div>
  ) : <Card><p>This profile cannot be turned into rounds. Try moving the points.</p></Card>;

  return (
    <SplitPane label="Shape view" columns="minmax(0, 1.05fr) minmax(0, 1fr)"
      panes={[{ id: 'shape', label: 'Profile', content: shapePane }, { id: 'pattern', label: `Pattern${result ? ` (${result.rounds.length} rnds)` : ''}`, content: patternPane }]} />
  );
}

function CountStrip({ result, onHover }: { result: RevolveResult; onHover: (n: number | null) => void }) {
  const max = Math.max(...result.rounds.map((r) => r.count));
  return (
    <div className="ami-strip" role="img" aria-label={`Stitches per round: ${result.rounds.map((r) => r.count).join(', ')}`}>
      {result.rounds.map((r) => (
        <div key={r.n} className="ami-strip__col" onPointerEnter={() => onHover(r.n)} onPointerLeave={() => onHover(null)} title={`Rnd ${r.n}: ${r.count} sts${r.n > 1 ? ` (${r.change > 0 ? '+' : ''}${r.change})` : ''}`}>
          <div className="ami-strip__bar" style={{ height: `${(100 * r.count) / max}%`, background: KIND_COLOR[r.kind] }} data-blo={r.blo || undefined} />
        </div>
      ))}
      <div className="ami-strip__axis small muted"><span>Rnd 1</span><span>max {max}</span><span>Rnd {result.rounds.length}</span></div>
    </div>
  );
}

function RoundTable({ result, onHover }: { result: RevolveResult; onHover: (n: number | null) => void }) {
  return (
    <Card flush>
      <details className="ami-table">
        <summary>Round by round: target vs. realised</summary>
        <div className="ami-table__scroll">
          <table>
            <thead><tr><th>Rnd</th><th>Sts</th><th>±</th><th title="2πr/w before rounding">Target</th><th title="Distance of the realised shape from the drawing">Off</th><th>Instructions</th></tr></thead>
            <tbody>
              {result.rounds.map((r) => (
                <tr key={r.n} onPointerEnter={() => onHover(r.n)} onPointerLeave={() => onHover(null)}>
                  <td>{r.n}</td>
                  <td><b>{r.count}</b></td>
                  <td style={{ color: KIND_COLOR[r.kind] }}>{r.n === 1 ? '—' : r.change > 0 ? `+${r.change}` : r.change}</td>
                  <td>{r.exact.toFixed(1)}{r.clamped ? ' ⚠' : ''}</td>
                  <td>{(r.distance).toFixed(1)} mm</td>
                  <td className="mono">{r.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

function SphereNote({ result }: { result: RevolveResult }) {
  const counts = result.rounds.map((r) => r.count);
  return (
    <Card className="ami-note">
      <h2 className="ui-card__title">Compared with the textbook ball</h2>
      <p className="small">
        Textbook (fixture <span className="mono">sc_sphere</span>): <span className="mono">6, 12, 18, 24, 30 ×6, 24, 18, 12, 6</span> — 14 rounds, 300 sts.<br />
        This sphere: <span className="mono">{counts.join(', ')}</span> — {counts.length} rounds, {result.totalStitches} sts.
      </p>
      <p className="small muted">
        The textbook ball grows at the flat-disc rate (+6 a round) to its equator, works even, and closes the same way:
        a flat disc, a short tube and a flat disc that stuffing pushes round. A true sphere widens like a sine —
        fast at the poles, slowing towards the equator — so its counts creep up to the same 30. Same size, about the
        same stitches; the true one needs less stuffing pressure to look round. Turn on symmetric repeats and turn off
        staggering to get counts in sixes and textbook-style rounds.
      </p>
    </Card>
  );
}
