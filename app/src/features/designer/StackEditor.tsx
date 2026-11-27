// The motif stack (guided mode): one row per round, with motif, parameters (auto or fixed),
// reorder / remove, and a palette to add rounds.
import { useState } from 'react';
import { Badge, Button, IconButton, Select, ShapeBadge } from '@/ui';
import {
  MOTIFS, MOTIF_ORDER, type GenerateResult, type GeneratedRound, type MotifId, type ParamValue, type RoundSpec,
} from '@/core/generate';

const fmt = (m: MotifId, key: string, v: ParamValue) => {
  const def = MOTIFS[m].params.find((d) => d.key === key);
  return def?.format ? def.format(v) : String(v);
};

/** Short human summary of the parameters a round ended up with. */
export function paramSummary(r: Pick<GeneratedRound, 'motif' | 'params'>): string {
  const m = MOTIFS[r.motif];
  const parts: string[] = [];
  for (const d of m.params) {
    if (!(d.key in r.params)) continue;
    const v = r.params[d.key];
    if (d.key === 'per') { parts.push(`${v}× per repeat`); continue; }
    if (d.key === 'alt') { if (v) parts.push('sc between'); continue; }
    if (d.key === 'inc' && v === 0) continue;
    if (d.key === 'inc') { parts.push(`+${v} per repeat`); continue; }
    if (d.key === 'fill') { if (r.motif !== 'picot') parts.push(`${v} st per ch`); continue; }
    if (d.key === 'ring' && r.params.ringCh) { parts.push(`ch-${r.params.ringCh} ring`); continue; }
    parts.push(fmt(r.motif, d.key, v));
  }
  return parts.join(' · ');
}

export function StackEditor({
  rounds, result, onChange,
}: { rounds: RoundSpec[]; result: GenerateResult | undefined; onChange: (rounds: RoundSpec[]) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const made = (i: number) => result?.rounds.filter((r) => r.source === i) ?? [];
  const set = (i: number, rs: RoundSpec) => onChange(rounds.map((r, j) => (j === i ? rs : r)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 1 || j >= rounds.length || i < 1) return; // the centre stays first
    const next = rounds.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    if (open === i) setOpen(j);
  };
  const remove = (i: number) => { onChange(rounds.filter((_, j) => j !== i)); setOpen(null); };

  // what the last round leaves: decides which palette motifs need a transition first
  const last = result?.rounds[result.rounds.length - 1];
  const lastSolid = last ? last.spaces === 0 : true;

  return (
    <div className="dz-stack">
      <ol className="dz-rounds" aria-label="Rounds, from the centre out">
        {rounds.map((rs, i) => {
          const m = MOTIFS[rs.motif];
          const outs = made(i);
          const main = outs.find((r) => !r.auto);
          const auto = outs.filter((r) => r.auto);
          const isOpen = open === i;
          return (
            <li key={i} className="dz-round" data-open={isOpen}>
              {auto.map((a) => (
                <div key={a.number} className="dz-auto" title="Added automatically so the next motif has something to work into">
                  <span className="dz-num">{a.number}</span>
                  <span>{MOTIFS[a.motif].label} <span className="muted">(added: {MOTIFS[rs.motif].label.toLowerCase()} needs {a.spaces ? 'chain spaces' : 'stitches'})</span></span>
                  <ShapeBadge shape={a.class === 'n/a' ? 'flat' : a.class} />
                </div>
              ))}
              <div className="dz-round__row">
                <span className="dz-num">{main?.number ?? '–'}</span>
                <button type="button" className="dz-round__main" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen}>
                  <span className="dz-round__name">{m.label}</span>
                  <span className="dz-round__sum">{main ? paramSummary(main) : 'could not be placed'}</span>
                </button>
                {main && main.class !== 'n/a' && (
                  <ShapeBadge shape={main.class}>{main.class === 'flat' ? 'Flat' : main.class === 'cup' ? 'Cups' : 'Ruffles'}</ShapeBadge>
                )}
                <div className="dz-round__tools">
                  <IconButton icon="chevron-left" className="dz-up" label={`Move round ${i + 1} inwards`} disabled={i < 2} onClick={() => move(i, -1)} />
                  <IconButton icon="chevron-right" className="dz-down" label={`Move round ${i + 1} outwards`} disabled={i < 1 || i >= rounds.length - 1} onClick={() => move(i, 1)} />
                  <IconButton icon="trash" label={`Remove round ${i + 1}`} disabled={i === 0 && rounds.length > 1} onClick={() => remove(i)} />
                </div>
              </div>
              {isOpen && (
                <div className="dz-params">
                  <p className="dz-blurb">{m.blurb}</p>
                  {i > 0 && (
                    <Select label="Motif" value={rs.motif} onChange={(e) => set(i, { motif: e.target.value as MotifId })}>
                      {MOTIF_ORDER.filter((id) => id !== 'centre').map((id) => <option key={id} value={id}>{MOTIFS[id].label}</option>)}
                    </Select>
                  )}
                  <div className="dz-params__grid">
                    {m.params.map((d) => {
                      const fixed = rs.params?.[d.key];
                      const used = main?.params[d.key];
                      return (
                        <Select
                          key={d.key}
                          label={d.label}
                          hint={d.hint}
                          value={fixed === undefined ? '__auto' : String(fixed)}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const params = { ...(rs.params ?? {}) };
                            if (raw === '__auto') delete params[d.key];
                            else params[d.key] = typeof d.values[0] === 'number' ? Number(raw) : raw;
                            set(i, { ...rs, params });
                          }}
                        >
                          <option value="__auto">{used !== undefined ? `auto (${fmt(rs.motif, d.key, used)})` : 'auto'}</option>
                          {d.values.map((v) => <option key={String(v)} value={String(v)}>{fmt(rs.motif, d.key, v)}</option>)}
                        </Select>
                      );
                    })}
                  </div>
                  {main && <p className="dz-msg small muted">{main.message} Nominal excess {pct(main.e)}.</p>}
                  {rs.params && Object.keys(rs.params).length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => set(i, { motif: rs.motif })}>Reset to auto</Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="dz-palette">
        <div className="dz-palette__head">Add a round</div>
        <div className="dz-palette__grid">
          {(rounds.length ? MOTIF_ORDER.filter((id) => id !== 'centre') : ['centre' as MotifId]).map((id) => {
            const mm = MOTIFS[id];
            const needs = rounds.length && !mm.accepts.includes(lastSolid ? 'solid' : 'lace');
            return (
              <button
                key={id}
                type="button"
                className="dz-chip"
                onClick={() => { onChange([...rounds, { motif: id }]); setOpen(null); }}
                title={`${mm.blurb}${needs ? ` (a ${lastSolid ? 'chain-loop mesh' : 'straightening'} round is added first)` : ''}`}
              >
                <span>{mm.label}</span>
                {needs ? <Badge tone="outline">+{lastSolid ? 'mesh' : 'filler'}</Badge> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)}%`;
