/**
 * Yarn requirement read-out (metres, grams, balls, range, per colour, per round, by stitch) with
 * the yarn inputs (my yarns or a ball band, ball size, allowance), units and the swatch
 * calibration. Embed only through these props.
 *
 *   <YarnPanel pattern={pattern} params={params} compact />          a compiled pattern
 *   <YarnPanel counts={{ dc: 18000, ch: 153 }} params={params} />    stitch counts (blankets)
 *   <YarnPanel estimate={est} params={params} />                     a ready-made estimate
 */
import { useMemo, useState } from 'react';
import type { Pattern } from '@/core/graph';
import { paramsFor, type ParamSet } from '@/core/params';
import {
  ballsNeeded, estimateYarn, estimateYarnFromCounts, formatLength, formatMass, formatRange, rescaleEstimate, yarnDefaults,
  type YarnEstimate, type YarnOptions, type YarnUnits,
} from '@/core/yarn';
import { Badge, Button, Icon, SegmentedControl, Select } from '@/ui';
import { useSettings, type YarnCalibration } from '@/store';
import { CalibrateDialog } from './CalibrateDialog';
import { NumField } from './fields';
import { useYarnFor } from './useYarn';
import './yarn.css';

export interface YarnPanelProps {
  /** Either a compiled pattern … */
  pattern?: Pattern;
  /** … or a ready-made estimate (for pieces estimated from counts). */
  estimate?: YarnEstimate;
  params?: ParamSet;
  options?: YarnOptions;
  /** One-line summary with expandable details. Default false. */
  compact?: boolean;
  className?: string;
  /** … or stitch counts by key ('dc', 'ch', 'turning ch', 'sc2tog' …): recomputed when the yarn changes. */
  counts?: Record<string, number>;
  /** Heading shown above the panel (default "Yarn"); null hides it. */
  title?: string | null;
  /** Start expanded in compact mode. */
  defaultOpen?: boolean;
  /** Colour names / swatches for colour keys of options.colorOfRound (display only). */
  colorLabels?: Record<string, { label?: string; css?: string }>;
}

const CUSTOM = '__custom';

export function YarnPanel(props: YarnPanelProps) {
  const { pattern, compact = false, className, counts, options, title = 'Yarn', defaultOpen = false } = props;
  const params = props.params ?? paramsFor(pattern);
  const y = useYarnFor(params, options?.yarn);
  const units = y.units as YarnUnits;
  const [open, setOpen] = useState(defaultOpen || !compact);
  const [calOpen, setCalOpen] = useState(false);

  const est = useMemo<YarnEstimate | undefined>(() => {
    try {
      const opts: YarnOptions = { ...options, yarn: y.spec };
      if (pattern) return estimateYarn(pattern, params, opts);
      if (counts) return estimateYarnFromCounts(counts, params, { yarn: y.spec });
      if (props.estimate) return rescaleEstimate(props.estimate, params, y.spec);
    } catch (e) {
      console.warn('[yarn] estimate failed', e);
    }
    return undefined;
  }, [pattern, counts, props.estimate, params, options, y.spec]);

  if (!est || !est.yarn) {
    return <div className={`yn ${className ?? ''}`}><p className="small muted">No yarn estimate for this piece.</p></div>;
  }
  const yarn = est.yarn;
  const buy = ballsNeeded(est.total.grams!, yarn.ballGrams);
  const ballM = (yarn.ballGrams * yarn.metersPer100g) / 100;
  const headline = (
    <span className="yn-head__nums">
      ≈ <b>{formatLength(est.net.meters, units)}</b> · {formatMass(est.net.grams!, units)} · <b>{buy.balls} ball{buy.balls === 1 ? '' : 's'}</b>
    </span>
  );
  const status = <Badge tone={yarn.status === 'calibrated' ? 'ok' : 'outline'} title={yarn.status === 'calibrated' ? 'Calibrated with your swatch' : 'Nominal model: not checked against your yarn'}>{yarn.status}</Badge>;
  const ballWord = `${formatMass(yarn.ballGrams, units)} ball${yarn.defaulted.ballGrams ? ' (typical)' : ''}`;
  const firstBreak = est.ballBreaks?.[0];

  const saveCalibration = (t: { yarnId?: string; label?: string; metersPer100g?: number; ballGrams?: number }, cal: YarnCalibration) => {
    if (t.yarnId) {
      y.update(t.yarnId, { calibration: cal, ...(t.metersPer100g ? { metersPer100g: t.metersPer100g } : {}) });
      y.setChoice({ ...y.choice, yarnId: t.yarnId });
    } else {
      const n = y.add({ label: t.label ?? 'My yarn', metersPer100g: t.metersPer100g, ballGrams: t.ballGrams ?? y.choice.ballGrams, category: y.category, calibration: cal });
      y.setChoice({ ...y.choice, yarnId: n.id });
    }
  };

  const details = (
    <div className="yn-body">
      <p className="yn-range">
        likely <b>{formatRange(est.net.metersLow, est.net.metersHigh, units)}</b>
        <span className="muted"> · plus {Math.round(yarn.allowance * 100)} % allowance ({formatLength(est.total.meters - est.net.meters, units)}) for tails, swatch and tension drift → buy <b>{buy.balls} × {ballWord}</b> ({buy.exact < 0.1 ? 'under 0.1' : buy.exact.toFixed(1)} balls' worth)</span>
      </p>

      <YarnInputs y={y} yarn={yarn} />

      <div className="yn-row">
        {status}
        <span className="small muted yn-row__grow">
          {yarn.status === 'calibrated' ? `Calibrated (×${yarn.kWidth === yarn.kHeight ? yarn.kWidth.toFixed(2) : `${yarn.kWidth.toFixed(2)} loops, ×${yarn.kHeight.toFixed(2)} height`}), ±${Math.round((yarn.band.high - 1) * 100)} %` : 'Not yet calibrated: ±20 %'}
        </span>
        <Button size="sm" icon="hook" onClick={() => setCalOpen(true)}>{yarn.status === 'calibrated' ? 'Recalibrate' : 'Calibrate with a swatch'}</Button>
      </div>

      {est.perRound.length > 1 && <RoundStrip est={est} units={units} ballM={ballM} />}
      {firstBreak ? (
        <p className="small yn-break"><Icon name="info" size={16} /> You'll need a second {ballWord} around <b>{firstBreak.label}</b>{est.ballBreaks!.length > 1 ? ` (${est.ballBreaks!.length + 1} balls in all, without allowance)` : ''}.</p>
      ) : est.perRound.length > 1 && (
        <p className="small muted yn-break">One {ballWord} is enough: the piece uses about {Math.round(100 * est.net.meters / ballM)} % of it.</p>
      )}

      {est.byColor && (Object.keys(est.byColor).length > 1 || !est.byColor.main) && (
        <table className="yn-table">
          <caption className="small muted">By colour (net; buy with the allowance)</caption>
          <thead><tr><th>Colour</th><th>Length</th><th>Weight</th><th>Balls</th></tr></thead>
          <tbody>
            {Object.entries(est.byColor).sort((p, q) => q[1].meters - p[1].meters).map(([k, a]) => {
              const lab = props.colorLabels?.[k];
              const b = ballsNeeded(a.grams! * (1 + yarn.allowance), yarn.ballGrams);
              return (
                <tr key={k}>
                  <td>{lab?.css && <i className="yn-dot" style={{ background: lab.css }} />}{lab?.label ?? k}</td>
                  <td>{formatLength(a.meters, units)}</td>
                  <td>{formatMass(a.grams!, units)}</td>
                  <td>{b.balls} <span className="muted">({b.exact.toFixed(1)})</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <ByStitch est={est} units={units} />

      <details className="yn-notes">
        <summary className="small">How accurate is this?</summary>
        <p className="small">
          The estimate adds up the yarn in every stitch from its size and how it is built (loops, yarn-overs, pull-throughs).
          It has not been checked against real yarn: tension alone moves the true figure by 10–20 % between crocheters.
          Weigh a swatch to calibrate it for your yarn and your hands; then it is usually within about 8 %.
          Fuzzy, boucle and other novelty yarns are not covered.
        </p>
        <ul className="small muted">{est.notes.map((n, i) => <li key={i}>{n}</li>)}{y.note && <li>{y.note}</li>}</ul>
      </details>

      <CalibrateDialog open={calOpen} onClose={() => setCalOpen(false)} params={params} category={y.category} yarns={y.yarns}
        yarnId={y.myYarn?.id} metersPer100g={y.myYarn?.metersPer100g ?? y.choice.metersPer100g} onSave={saveCalibration} />
    </div>
  );

  if (compact) {
    return (
      <div className={`yn yn--compact ${className ?? ''}`} data-open={open || undefined}>
        <button type="button" className="yn-line" aria-expanded={open} onClick={() => setOpen(!open)}>
          {title && <span className="yn-line__title">{title}</span>}
          {headline}
          {status}
          <Icon name="chevron-right" size={16} className="yn-line__chev" />
        </button>
        {open && details}
      </div>
    );
  }
  return (
    <div className={`yn ${className ?? ''}`}>
      <div className="yn-head">
        {title && <h3 className="yn-head__title">{title}</h3>}
        {headline}
        {status}
      </div>
      {details}
    </div>
  );
}
export default YarnPanel;

function YarnInputs({ y, yarn }: { y: ReturnType<typeof useYarnFor>; yarn: NonNullable<YarnEstimate['yarn']> }) {
  const setUnits = useSettings((s) => s.set);
  const value = y.myYarn ? y.myYarn.id : CUSTOM;
  const cat = yarnDefaults.categories[y.category];
  const typicalName = cat?.label.replace(/\s*\(.*\)$/, '').toLowerCase() ?? 'this weight';
  return (
    <div className="yn-inputs">
      <Select label="Yarn" value={value} onChange={(e) => y.setChoice(e.target.value === CUSTOM ? { ...y.choice, yarnId: undefined } : { ...y.choice, yarnId: e.target.value })}>
        <option value={CUSTOM}>{y.choice.metersPer100g ? 'My ball band (typed in)' : `Typical ${typicalName}`}</option>
        {y.yarns.map((m) => <option key={m.id} value={m.id}>{m.label}{m.calibration ? ' · calibrated' : ''}</option>)}
      </Select>
      {!y.myYarn && (
        <>
          <NumField label="Ball band" unit="m / 100 g" step={5} min={1} value={y.choice.metersPer100g} placeholder={String(cat?.m_per_100g ?? '')}
            onChange={(v) => y.setChoice({ ...y.choice, metersPer100g: v })}
            hint={yarn.defaulted.metersPer100g ? <>typical for {typicalName} — check your ball band</> : undefined} />
          <NumField label="Ball size" unit="g" step={5} min={1} value={y.choice.ballGrams} placeholder={String(cat?.ball_g ?? '')}
            onChange={(v) => y.setChoice({ ...y.choice, ballGrams: v })} />
        </>
      )}
      <NumField label="Allowance" unit="%" step={1} min={0} value={y.choice.allowance !== undefined ? Math.round(y.choice.allowance * 100) : undefined}
        placeholder={String(Math.round(yarnDefaults.allowance * 100))} onChange={(v) => y.setChoice({ ...y.choice, allowance: v === undefined ? undefined : v / 100 })} />
      <div className="ui-field">
        <span className="ui-field__label">Units</span>
        <SegmentedControl label="Units" value={y.units} onChange={(v) => setUnits({ yarnUnits: v })}
          options={[{ value: 'metric', label: 'm · g' }, { value: 'imperial', label: 'yd · oz' }]} />
      </div>
    </div>
  );
}

function RoundStrip({ est, units, ballM }: { est: YarnEstimate; units: YarnUnits; ballM: number }) {
  const max = Math.max(...est.perRound.map((r) => r.meters), 1e-9);
  const breaks = new Set((est.ballBreaks ?? []).map((b) => b.round));
  const n = est.perRound.length;
  return (
    <div className="yn-strip-wrap">
      <div className="yn-strip" role="img" aria-label={`Yarn per round: ${est.perRound.map((r) => `${r.label} ${formatLength(r.meters, units)}`).join(', ')}`}>
        {est.perRound.map((r) => (
          <div key={r.round} className="yn-strip__col" data-break={breaks.has(r.round) || undefined}
            title={`${r.label}: ${formatLength(r.meters, units)} (total so far ${formatLength(r.cumulative, units)})`}>
            <div className="yn-strip__bar" style={{ height: `${Math.max(2, (100 * r.meters) / max)}%` }} />
          </div>
        ))}
        <svg className="yn-strip__cum" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
          <polyline fill="none" vectorEffect="non-scaling-stroke" points={est.perRound.map((r, i) => `${i + 0.5},${100 - (100 * r.cumulative) / est.net.meters}`).join(' ')} />
        </svg>
      </div>
      <div className="yn-strip__axis small muted">
        <span>{est.perRound[0].label}</span>
        <span>bars: per round · line: running total{ballM < est.net.meters ? ' · marks: new ball' : ''}</span>
        <span>{est.perRound[n - 1].label}</span>
      </div>
    </div>
  );
}

function ByStitch({ est, units }: { est: YarnEstimate; units: YarnUnits }) {
  const rows = Object.entries(est.byStitch).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return null;
  const shown = rows.slice(0, 6);
  const rest = rows.slice(6).reduce((s, [, m]) => s + m, 0);
  if (rest > 0) shown.push([`${rows.length - 6} others`, rest]);
  return (
    <div className="yn-bystitch">
      <div className="small muted">By stitch (net)</div>
      <ul>
        {shown.map(([k, m]) => (
          <li key={k}>
            <span className="yn-bystitch__k mono">{k}</span>
            <span className="yn-bystitch__bar"><span style={{ width: `${(100 * m) / est.net.meters}%` }} /></span>
            <span className="yn-bystitch__v">{formatLength(m, units)} <span className="muted">{Math.round((100 * m) / est.net.meters)} %</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
