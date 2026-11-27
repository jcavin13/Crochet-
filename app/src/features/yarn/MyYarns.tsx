// "My yarns" manager (About & settings): add / edit / delete yarns, their ball band data and swatch
// calibrations. Stored on this device (IndexedDB) via @/store/yarns.
import { useState } from 'react';
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, Input, Menu, Select, toast } from '@/ui';
import { paramsFile, paramSetById, type ParamSet } from '@/core/params';
import { categoryKey, yarnDefaults } from '@/core/yarn';
import { useMyYarns, type MyYarn } from '@/store';
import { CalibrateDialog } from './CalibrateDialog';
import { NumField } from './fields';
import './yarn.css';

type Draft = Pick<MyYarn, 'label' | 'metersPer100g' | 'ballGrams' | 'category' | 'fibre' | 'notes'>;

/** A param set to calibrate against for a yarn: the app's, if it is the yarn's weight, else one of that weight. */
function paramsForYarn(y: MyYarn | undefined, appParams: ParamSet): ParamSet {
  const cat = y?.calibration ? y.calibration.category : y?.category;
  if (!cat || categoryKey(appParams.yarn_weight) === cat) return y?.calibration ? paramSetById(y.calibration.paramsId) ?? appParams : appParams;
  return paramsFile.sets.find((s) => categoryKey(s.yarn_weight) === cat) ?? appParams;
}

export function MyYarnsManager({ appParams }: { appParams: ParamSet }) {
  const { yarns, hydrated, add, update, remove } = useMyYarns();
  const [edit, setEdit] = useState<{ id?: string; draft: Draft } | null>(null);
  const [cal, setCal] = useState<MyYarn | 'new' | null>(null);
  const [del, setDel] = useState<MyYarn | null>(null);
  const calParams = paramsForYarn(cal && cal !== 'new' ? cal : undefined, appParams);

  const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="stack">
      {!hydrated ? <p className="muted small">Loading…</p> : yarns.length === 0 ? (
        <EmptyState title="No yarns yet" actions={<><Button variant="primary" icon="plus" onClick={() => setEdit({ draft: { label: '' } })}>Add a yarn</Button><Button icon="hook" onClick={() => setCal('new')}>Calibrate with a swatch</Button></>}>
          Add the yarns you use (from the ball band) so yarn estimates show your grams and balls; weigh a swatch to calibrate them to your tension.
        </EmptyState>
      ) : (
        <>
          <ul className="yn-mine">
            {yarns.map((y) => {
              const cat = y.category ? yarnDefaults.categories[y.category] : undefined;
              const c = y.calibration;
              return (
                <li key={y.id} className="yn-mine__item">
                  <div className="yn-mine__text">
                    <span className="yn-mine__name">{y.label}</span>
                    <span className="yn-mine__meta">
                      {cat && <span>{cat.label}</span>}
                      <span>{y.metersPer100g ? `${y.metersPer100g} m / 100 g` : 'm / 100 g not set'}</span>
                      {y.ballGrams && <span>{y.ballGrams} g balls</span>}
                      {y.fibre && <span>{y.fibre}</span>}
                      {c
                        ? <Badge tone="ok" title={`Against ${paramSetById(c.paramsId)?.label ?? c.paramsId}, ${fmtDate(c.date)}`}>calibrated ×{c.factor.toFixed(2)}{c.kind === 'split' ? ` (loops ×${c.width!.toFixed(2)}, height ×${c.height!.toFixed(2)})` : ''}</Badge>
                        : <Badge tone="outline">nominal</Badge>}
                    </span>
                  </div>
                  <Menu label={`Actions for ${y.label}`} items={[
                    { label: 'Edit…', icon: 'edit', onSelect: () => setEdit({ id: y.id, draft: { label: y.label, metersPer100g: y.metersPer100g, ballGrams: y.ballGrams, category: y.category, fibre: y.fibre, notes: y.notes } }) },
                    { label: c ? 'Recalibrate…' : 'Calibrate with a swatch…', icon: 'hook', onSelect: () => setCal(y) },
                    ...(c ? [{ label: 'Clear calibration', icon: 'close' as const, onSelect: () => { update(y.id, { calibration: undefined }); toast('Calibration cleared'); } }] : []),
                    'separator',
                    { label: 'Delete…', icon: 'trash', danger: true, onSelect: () => setDel(y) },
                  ]} />
                </li>
              );
            })}
          </ul>
          <div className="row">
            <Button icon="plus" onClick={() => setEdit({ draft: { label: '' } })}>Add a yarn</Button>
            <Button icon="hook" onClick={() => setCal('new')}>Calibrate a new yarn</Button>
          </div>
        </>
      )}

      <YarnDialog
        open={!!edit} title={edit?.id ? 'Edit yarn' : 'Add a yarn'} draft={edit?.draft ?? { label: '' }}
        onClose={() => setEdit(null)}
        onSave={(d) => {
          if (edit?.id) update(edit.id, d); else add({ ...d, label: d.label || 'My yarn' });
          toast(edit?.id ? 'Yarn saved' : 'Yarn added');
          setEdit(null);
        }}
      />
      <CalibrateDialog
        open={!!cal} onClose={() => setCal(null)} params={calParams} category={categoryKey(calParams.yarn_weight)} yarns={yarns}
        yarnId={cal && cal !== 'new' ? cal.id : undefined} metersPer100g={cal && cal !== 'new' ? cal.metersPer100g : undefined}
        onSave={(t, c) => {
          if (t.yarnId) update(t.yarnId, { calibration: c, ...(t.metersPer100g ? { metersPer100g: t.metersPer100g } : {}) });
          else add({ label: t.label ?? 'My yarn', metersPer100g: t.metersPer100g, ballGrams: t.ballGrams, category: c.category, calibration: c });
        }}
      />
      <ConfirmDialog
        open={!!del} onClose={() => setDel(null)} title="Delete this yarn?"
        body={<>“{del?.label}” and its calibration are removed from this device.</>}
        confirmLabel="Delete" danger onConfirm={() => { if (del) { remove(del.id); toast('Yarn deleted'); } }}
      />
    </div>
  );
}

function YarnDialog({ open, title, draft, onClose, onSave }: { open: boolean; title: string; draft: Draft; onClose: () => void; onSave: (d: Draft) => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) { setLastOpen(open); if (open) setD(draft); }
  const cat = d.category ? yarnDefaults.categories[d.category] : undefined;
  return (
    <Dialog open={open} onClose={onClose} title={title} sheet className="yn-cal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave(d)}>Save</Button></>}>
      <div className="yn-grid">
        <div className="ui-field" style={{ gridColumn: '1 / -1' }}>
          <label className="ui-field__label" htmlFor="yn-y-name">Name</label>
          <Input id="yn-y-name" value={d.label} placeholder="e.g. Merino worsted, teal" onChange={(e) => setD({ ...d, label: e.target.value })} />
        </div>
        <Select label="Weight" value={d.category ?? ''} onChange={(e) => setD({ ...d, category: e.target.value || undefined })}>
          <option value="">Not set</option>
          {Object.entries(yarnDefaults.categories).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
        </Select>
        <NumField label="Ball band" unit="m / 100 g" value={d.metersPer100g} step={5} min={1} onChange={(v) => setD({ ...d, metersPer100g: v })}
          hint={cat ? `typical ${cat.m_per_100g_range[0]}–${cat.m_per_100g_range[1]}` : 'from the label: metres ÷ grams × 100'} />
        <NumField label="Ball size" unit="g" value={d.ballGrams} step={5} min={1} onChange={(v) => setD({ ...d, ballGrams: v })} placeholder={cat ? String(cat.ball_g) : ''} />
        <div className="ui-field">
          <label className="ui-field__label" htmlFor="yn-y-fibre">Fibre</label>
          <Input id="yn-y-fibre" value={d.fibre ?? ''} placeholder="e.g. 100% wool" onChange={(e) => setD({ ...d, fibre: e.target.value || undefined })} />
        </div>
      </div>
    </Dialog>
  );
}
