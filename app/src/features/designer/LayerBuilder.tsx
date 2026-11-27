// The layer builder: the stack of rounds is the main object. Each layer shows a thumbnail of its
// repeat, the motif, the numbers the solver chose in plain words, its flatness and the running
// diameter. The selected layer opens its automatic-sizing panel: per parameter an Auto toggle, the
// value chosen and the runner-up values with their flatness ("ch 4 → −6 % · ch 5 → +1 % ✓"), a
// one-tap fix when an override breaks flatness, the stitch budget a flat next round needs, and
// "double the repeats from here".
import { useMemo } from 'react';
import { Badge, Button, IconButton, Select, ShapeBadge } from '@/ui';
import {
  MOTIFS, MOTIF_ORDER, explainRound, fixesFor, flatBudget, halveEntries, plainSentence,
  type GenerateResult, type GeneratedRound, type MotifId, type ParamValue, type Plan,
} from '@/core/generate';
import type { ParamSet } from '@/core/params';
import type { DoilySpec } from '@/core/generate';
import { RoundGlyph } from './Thumbs';
import {
  duplicateLayer, insertLayer, lockLayer, moveLayer, removeLayer, unlockLayer, type Layer,
} from './state';
import { LockIcon } from './icons';

export const pct = (x: number) => (Math.round(Math.abs(x) * 100) === 0 ? '±0 %' : `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)} %`);
const cm = (mm: number) => `${(mm / 10).toFixed(1)} cm`;
const REASON = { spaces: 'needs chain spaces', stitches: 'needs stitches', fit: 'did not fit the round below' } as const;

const fmt = (m: MotifId, key: string, v: ParamValue) => {
  const def = MOTIFS[m].params.find((d) => d.key === key);
  return def?.format ? def.format(v) : String(v);
};

/** Short human summary of the parameters a round ended up with (used by the results table). */
export function paramSummary(r: Pick<GeneratedRound, 'motif' | 'params' | 'repeats'>): string {
  return plainSentence(r.motif, r.params, r.repeats ?? 1);
}

function Badges({ r }: { r: GeneratedRound }) {
  if (r.class === 'n/a') return null;
  if (r.slackOnly) return <ShapeBadge shape="flat">flat (loose loops)</ShapeBadge>;
  return <ShapeBadge shape={r.class} />;
}

export interface LayerBuilderProps {
  layers: Layer[];
  spec: DoilySpec;
  plan: Plan;
  result: GenerateResult;
  params: ParamSet;
  selected: number | null;
  onSelect: (i: number | null) => void;
  onChange: (layers: Layer[], label: string) => void;
  /** Open the "add a round" panel. */
  onAdd: () => void;
}

export function LayerBuilder({ layers, spec, plan, result, params, selected, onSelect, onChange, onAdd }: LayerBuilderProps) {
  const made = (i: number) => result.rounds.filter((r) => r.source === i);
  return (
    <div className="dz-stack">
      <ol className="dz-rounds" aria-label="Rounds, from the centre out">
        {layers.map((ly, i) => {
          const outs = made(i);
          const main = outs.find((r) => !r.auto);
          const autos = outs.filter((r) => r.auto);
          const isOpen = selected === i;
          const anyAuto = main ? MOTIFS[ly.motif].params.some((d) => d.key in main.params && !(d.key in (ly.params ?? {}))) : false;
          return (
            <li key={i} className="dz-round" data-open={isOpen} data-locked={!!ly.locked}>
              {autos.map((a) => (
                <div key={a.number} className="dz-auto" title="Added automatically so the next motif has something to work into">
                  <span className="dz-num">{a.number}</span>
                  <RoundGlyph entries={a.entries} repeats={a.repeats} tone={a.class === 'flat' ? 'flat' : 'off'} size={44} />
                  <span>{MOTIFS[a.motif].label} <span className="muted">— added: {MOTIFS[ly.motif].label.toLowerCase()} {REASON[a.autoReason ?? 'spaces']}</span></span>
                  <Badges r={a} />
                </div>
              ))}
              <div className="dz-round__row">
                <span className="dz-num" aria-hidden="true">{main?.number ?? '–'}</span>
                <button type="button" className="dz-round__main" onClick={() => onSelect(isOpen ? null : i)} aria-expanded={isOpen} aria-label={`Round ${main?.number ?? i + 1}: ${MOTIFS[ly.motif].label}`}>
                  {main && <RoundGlyph entries={main.entries} repeats={main.repeats} tone={main.class === 'flat' && !main.slackOnly ? 'flat' : 'off'} />}
                  <span className="dz-round__text">
                    <span className="dz-round__top">
                      <span className="dz-round__name">{MOTIFS[ly.motif].label}</span>
                      {main && <Badges r={main} />}
                      {ly.locked && <Badge tone="outline"><LockIcon size={12} /> locked</Badge>}
                      {main?.doubled && <Badge tone="info">×2 repeats</Badge>}
                    </span>
                    <span className="dz-round__sum">
                      {main ? <>{plainSentence(main.motif, main.params, main.repeats)}{anyAuto ? <span className="dz-why"> — chosen to lie flat</span> : <span className="dz-why"> — your numbers</span>}</> : 'could not be placed'}
                    </span>
                  </span>
                  {main && <span className="dz-round__dia" title="Running diameter after this round">{cm(2 * main.r)}</span>}
                </button>
              </div>
              {isOpen && main && (
                <LayerDetail
                  i={i} layers={layers} spec={spec} plan={plan} result={result} main={main} params={params} onChange={onChange} onSelect={onSelect}
                />
              )}
            </li>
          );
        })}
      </ol>
      <Button variant="primary" icon="plus" className="dz-addbtn" onClick={onAdd}>{layers.length ? 'Add a round' : 'Start with a centre'}</Button>
    </div>
  );
}

function LayerDetail({
  i, layers, spec, plan, result, main, params, onChange, onSelect,
}: { i: number; layers: Layer[]; spec: DoilySpec; plan: Plan; result: GenerateResult; main: GeneratedRound; params: ParamSet; onChange: LayerBuilderProps['onChange']; onSelect: LayerBuilderProps['onSelect'] }) {
  const ly = layers[i];
  const m = MOTIFS[ly.motif];
  const planIndex = main.number - 1;
  const ex = useMemo(() => explainRound(spec, params, planIndex, plan), [spec, params, planIndex, plan]);
  const fixes = useMemo(() => fixesFor(spec, params, planIndex, plan), [spec, params, planIndex, plan]);
  const budget = flatBudget(main.r, main.repeats, params);
  const prev = result.rounds[planIndex - 1];
  const canDouble = !!ly.double || (!!prev && i > 0 && !!halveEntries(prev.entries));
  const set = (next: Layer, label: string) => onChange(layers.map((r, j) => (j === i ? next : r)), label);
  const setParam = (key: string, v: ParamValue | undefined) => {
    const p = { ...(ly.params ?? {}) };
    if (v === undefined) delete p[key]; else p[key] = v;
    set({ ...ly, params: p }, v === undefined ? `${key} back on auto` : `set ${key}`);
  };
  return (
    <div className="dz-params">
      <p className="dz-blurb">{m.blurb}</p>
      <div className="dz-detail__tools" role="group" aria-label={`Round ${main.number} tools`}>
        <IconButton icon="chevron-left" className="dz-up" label="Move inwards" disabled={i < 2} onClick={() => { onChange(moveLayer(layers, i, -1), 'move round'); onSelect(i - 1); }} />
        <IconButton icon="chevron-right" className="dz-down" label="Move outwards" disabled={i < 1 || i >= layers.length - 1} onClick={() => { onChange(moveLayer(layers, i, 1), 'move round'); onSelect(i + 1); }} />
        <IconButton icon="copy" label="Duplicate this round" disabled={i < 1} onClick={() => { onChange(duplicateLayer(layers, i), 'duplicate round'); onSelect(i + 1); }} />
        <IconButton icon="plus" label="Insert a mesh round after this one" onClick={() => { onChange(insertLayer(layers, i + 1, [{ motif: 'mesh' }]), 'insert round'); onSelect(i + 1); }} />
        <button
          type="button" className="dz-lock" aria-pressed={!!ly.locked}
          onClick={() => onChange(ly.locked ? unlockLayer(layers, i) : lockLayer(layers, i, main.params), ly.locked ? 'unlock' : 'lock')}
          title="A locked layer keeps its numbers when you re-solve or change other layers"
        >
          <LockIcon size={16} open={!ly.locked} /> {ly.locked ? 'Locked' : 'Lock numbers'}
        </button>
        <span className="spacer" />
        <IconButton icon="trash" label="Remove this round" disabled={i === 0 && layers.length > 1} onClick={() => { onChange(removeLayer(layers, i), 'remove round'); onSelect(null); }} />
      </div>
      {i > 0 && (
        <Select label="Motif" value={ly.motif} onChange={(e) => set({ motif: e.target.value as MotifId, locked: false }, 'change motif')}>
          {MOTIF_ORDER.filter((id) => id !== 'centre').map((id) => <option key={id} value={id}>{MOTIFS[id].label}</option>)}
        </Select>
      )}

      <div className="dz-sizing" aria-label="Automatic sizing">
        <div className="dz-sizing__head">
          <span className="dz-label">Numbers</span>
          <span className="small muted">Auto = the solver picks the value that lies flattest. Tap an alternative to use it.</span>
        </div>
        {ex?.params.map((p) => {
          const def = m.params.find((d) => d.key === p.key)!;
          const fixed = ly.params?.[p.key];
          return (
            <div key={p.key} className="dz-param" data-auto={p.auto}>
              <div className="dz-param__head">
                <span className="dz-param__label">{p.label}</span>
                <label className="dz-auto-toggle">
                  <input type="checkbox" checked={p.auto} disabled={ly.locked} onChange={(e) => setParam(p.key, e.target.checked ? undefined : p.chosen)} />
                  <span>Auto</span>
                </label>
                {!p.auto && (
                  <select className="ui-select dz-param__sel" aria-label={p.label} value={String(fixed ?? p.chosen)} disabled={ly.locked}
                    onChange={(e) => setParam(p.key, typeof def.values[0] === 'number' ? Number(e.target.value) : e.target.value)}>
                    {def.values.map((v) => <option key={String(v)} value={String(v)}>{fmt(ly.motif, p.key, v)}</option>)}
                  </select>
                )}
              </div>
              <div className="dz-alts" role="list" aria-label={`${p.label}: alternatives and their flatness`}>
                {p.alts.map((a) => (
                  <button
                    key={String(a.value)} type="button" role="listitem" className="dz-alt" data-chosen={a.chosen} data-cls={a.cls} data-loose={a.loose}
                    disabled={ly.locked || a.chosen}
                    title={a.cls === 'flat' ? (a.loose ? 'flat only with loose / taut loops' : 'lies flat') : a.cls === 'cup' ? 'would cup' : 'would ruffle'}
                    onClick={() => setParam(p.key, a.value)}
                  >
                    <span>{a.label}</span> <span className="dz-alt__e">→ {pct(a.e)}</span>{a.chosen && <span aria-label="chosen"> ✓</span>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {fixes.length > 0 && (
          <div className="dz-fixes" role="group" aria-label="Fixes">
            <span className="small">{main.message}</span>
            {fixes.map((f) => (
              <Button key={f.key} size="sm" variant="primary" onClick={() => {
                if (f.value === 'auto') set({ motif: ly.motif, ...(ly.double ? { double: true } : {}) }, 'fix');
                else setParam(f.key, f.value);
              }}>{f.text} ({pct(f.e)})</Button>
            ))}
          </div>
        )}
        {!fixes.length && <p className="dz-msg small muted">{main.message} Nominal excess {pct(main.e)}.</p>}
        <p className="dz-budget small"><strong>Next round:</strong> {budget.text}</p>
      </div>

      {i > 0 && (
        <label className="dz-double" data-disabled={!canDouble}>
          <input type="checkbox" checked={!!ly.double} disabled={!canDouble} onChange={(e) => set({ ...ly, double: e.target.checked || undefined }, 'double repeats')} />
          <span>
            <strong>Double the repeats from this round outward</strong> ({main.repeats / (ly.double ? 2 : 1)} → {(main.repeats / (ly.double ? 2 : 1)) * 2})
            <span className="small muted"> {canDouble
              ? 'Each repeat of the round below is split in two; every later round is worked twice as often, with stitch counts kept consistent.'
              : 'Needs the round below to have 2, 4… identical groups per repeat (set its groups per repeat to 2 first).'}</span>
          </span>
        </label>
      )}
      {Object.keys(ly.params ?? {}).length > 0 && !ly.locked && (
        <Button size="sm" variant="ghost" onClick={() => set({ motif: ly.motif, ...(ly.double ? { double: true } : {}) }, 'reset to auto')}>Put every number back on auto</Button>
      )}
    </div>
  );
}
