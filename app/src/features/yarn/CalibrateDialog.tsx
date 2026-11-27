// "Calibrate with a swatch": the procedure of spec/yarn.md §4 as a small dialog. The result is
// stored on one of "my yarns" (new or existing) and that yarn becomes the panel's choice.
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Dialog, Input, SegmentedControl, Select, toast } from '@/ui';
import { calibrationFromSwatches, resolveYarn, swatchModel, yarnDefaults, type SwatchInput } from '@/core/yarn';
import type { ParamSet } from '@/core/params';
import type { MyYarn, YarnCalibration } from '@/store';
import { NumField } from './fields';

const STITCHES = ['sc', 'hdc', 'dc', 'tr'] as const;

interface SwatchDraft { stitch: string; stitches?: number; rows?: number; grams?: number; meters?: number; mode: 'grams' | 'meters' }

const blank = (stitch = 'sc'): SwatchDraft => ({ stitch, stitches: 20, rows: stitch === 'sc' ? 20 : 12, mode: 'grams' });

export interface CalibrateDialogProps {
  open: boolean;
  onClose: () => void;
  params: ParamSet;
  category: string;
  yarns: MyYarn[];
  /** Pre-select this yarn (e.g. the one the panel is using). */
  yarnId?: string;
  /** Pre-fill the ball band m/100 g. */
  metersPer100g?: number;
  onSave: (target: { yarnId?: string; label?: string; metersPer100g?: number; ballGrams?: number }, calibration: YarnCalibration) => void;
}

export function CalibrateDialog({ open, onClose, params, category, yarns, yarnId, metersPer100g, onSave }: CalibrateDialogProps) {
  const [a, setA] = useState<SwatchDraft>(blank());
  const [b, setB] = useState<SwatchDraft | null>(null);
  const [m100, setM100] = useState<number | undefined>(metersPer100g);
  const [target, setTarget] = useState<string>(yarnId ?? 'new');
  const [label, setLabel] = useState('');
  const [ballGrams, setBallGrams] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const y = yarnId ? yarns.find((x) => x.id === yarnId) : undefined;
    setTarget(y ? y.id : 'new');
    setM100(y?.metersPer100g ?? metersPer100g);
    const prev = y?.calibration?.swatches;
    if (prev?.length) {
      setA({ ...blank(prev[0].stitch), ...prev[0], mode: prev[0].meters ? 'meters' : 'grams' });
      setB(prev[1] ? { ...blank(prev[1].stitch), ...prev[1], mode: prev[1].meters ? 'meters' : 'grams' } : null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cat = yarnDefaults.categories[category];
  const d = resolveYarn(params, { category, metersPer100g: m100 }).diameterMm;
  const toInput = (s: SwatchDraft): SwatchInput => ({
    stitch: s.stitch, stitches: s.stitches ?? 0, rows: s.rows ?? 0, metersPer100g: m100,
    ...(s.mode === 'meters' ? { meters: s.meters } : { grams: s.grams }),
  });
  const inputs = useMemo(() => [a, ...(b ? [b] : [])].map(toInput), [a, b, m100]); // eslint-disable-line react-hooks/exhaustive-deps
  const result = useMemo(() => calibrationFromSwatches(inputs, params, d), [inputs, params, d]);
  const ok = result.kind !== 'invalid' && Number.isFinite(result.factor);
  const pct = ok ? Math.round((result.factor - 1) * 100) : 0;

  const save = () => {
    if (!ok) return;
    const cal: YarnCalibration = {
      kind: result.kind === 'split' ? 'split' : 'single', factor: result.factor,
      ...(result.kind === 'split' ? { width: result.width, height: result.height } : {}),
      paramsId: params.id, category, swatches: inputs.map((s) => ({ ...s })), date: Date.now(),
    };
    onSave(target === 'new' ? { label: label.trim() || `My ${cat?.label.replace(/\s*\(.*\)$/, '').toLowerCase() ?? 'yarn'}`, metersPer100g: m100, ballGrams } : { yarnId: target, metersPer100g: m100 }, cal);
    toast(`Calibration saved: ×${result.factor.toFixed(2)}`);
    onClose();
  };

  const swatchFields = (s: SwatchDraft, set: (s: SwatchDraft) => void, n: number) => {
    const model = s.stitches && s.rows ? swatchModel({ stitch: s.stitch, stitches: s.stitches, rows: s.rows }, params, d).meters : NaN;
    return (
      <fieldset className="yn-swatch">
        <legend>Swatch {n}</legend>
        <div className="yn-grid">
          <Select label="Stitch" value={s.stitch} onChange={(e) => set({ ...s, stitch: e.target.value })}>
            {STITCHES.map((t) => <option key={t} value={t} disabled={n === 2 && t === a.stitch}>{t}</option>)}
          </Select>
          <NumField label="Stitches per row" value={s.stitches} step={1} min={1} onChange={(v) => set({ ...s, stitches: v })} />
          <NumField label="Rows" value={s.rows} step={1} min={1} onChange={(v) => set({ ...s, rows: v })} />
          <div className="ui-field">
            <span className="ui-field__label">Measured by</span>
            <SegmentedControl label={`Swatch ${n} measured by`} value={s.mode} onChange={(mode) => set({ ...s, mode })}
              options={[{ value: 'grams', label: 'Weight' }, { value: 'meters', label: 'Frogged' }]} />
          </div>
          {s.mode === 'grams'
            ? <NumField label="Weight, tails trimmed" unit="g" step={0.1} value={s.grams} onChange={(v) => set({ ...s, grams: v })} />
            : <NumField label="Yarn unravelled" unit="m" step={0.1} value={s.meters} onChange={(v) => set({ ...s, meters: v })} />}
        </div>
        <p className="small muted yn-swatch__model">
          Foundation ch {s.stitches ? s.stitches + ({ sc: 1, hdc: 2, dc: 3, tr: 4 }[s.stitch] ?? 1) : '…'}, then {s.rows ?? '…'} rows of {s.stitches ?? '…'} {s.stitch}
          {Number.isFinite(model) && <> · the model says <b>{model.toFixed(1)} m</b></>}
        </p>
      </fieldset>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} title="Calibrate with a swatch" sheet className="yn-cal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!ok || (target !== 'new' && !yarns.some((y) => y.id === target))}>Save calibration</Button></>}>
      <ol className="yn-steps small">
        <li>Crochet a flat swatch in the yarn and hook you will use: a foundation chain, then rows of one stitch (about 20 × 20 sc, or 20 × 12 dc). The turning chain does not count as a stitch.</li>
        <li>Cut the tails flush with the fabric.</li>
        <li>Weigh it on a scale that reads to 0.1 g (a 1 g kitchen scale is too coarse for a small swatch) — or unravel it and measure the yarn.</li>
      </ol>
      {swatchFields(a, setA, 1)}
      {b ? (
        <>
          {swatchFields(b, (s) => setB(s), 2)}
          <Button size="sm" variant="ghost" icon="close" onClick={() => setB(null)}>Remove the second swatch</Button>
        </>
      ) : (
        <Button size="sm" icon="plus" onClick={() => setB(blank(a.stitch === 'dc' ? 'sc' : 'dc'))}>Add a swatch in another stitch</Button>
      )}
      <p className="small muted">A second swatch in a taller or shorter stitch lets the estimate tell how long you pull up your loops from how big your loops are.</p>
      <div className="yn-grid">
        <NumField label="Ball band" unit="m / 100 g" value={m100} step={1} min={1} onChange={setM100}
          hint={cat ? `typical for ${cat.label}: ${cat.m_per_100g}` : undefined} />
        <Select label="Save to" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="new">A new yarn…</option>
          {yarns.map((y) => <option key={y.id} value={y.id}>{y.label}{y.calibration ? ' (replace calibration)' : ''}</option>)}
        </Select>
        {target === 'new' && (
          <>
            <div className="ui-field">
              <label className="ui-field__label" htmlFor="yn-cal-name">Name</label>
              <Input id="yn-cal-name" value={label} placeholder="e.g. Merino worsted, teal" onChange={(e) => setLabel(e.target.value)} />
            </div>
            <NumField label="Ball size" unit="g" value={ballGrams} step={5} min={1} onChange={setBallGrams} placeholder={cat ? String(cat.ball_g) : ''} />
          </>
        )}
      </div>
      <div className="yn-cal__result" aria-live="polite">
        {ok ? (
          <>
            <p><Badge tone="ok">×{result.factor.toFixed(2)}</Badge>{' '}
              {Math.abs(pct) < 2 ? 'You use about what the nominal model says.' : `You use about ${Math.abs(pct)} % ${pct > 0 ? 'more' : 'less'} yarn than the nominal model.`}</p>
            {result.kind === 'split' && <p className="small">Loops ×{result.width!.toFixed(2)} · height ×{result.height!.toFixed(2)} — separate factors from the two stitches.</p>}
            {result.reason && result.kind === 'single' && b && <p className="small muted">{result.reason}</p>}
            <p className="small muted">Estimates for this yarn then show a ±{result.kind === 'split' ? 6 : 8} % range instead of ±20 %. Calibrated against “{params.label}”.</p>
          </>
        ) : <p className="small muted">{result.reason ?? 'Fill in the swatch.'}</p>}
      </div>
    </Dialog>
  );
}
