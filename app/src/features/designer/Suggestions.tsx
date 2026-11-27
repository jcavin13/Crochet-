// "Add a round": the motifs that fit the current outer round right now, ranked, each with a
// preview of the doily with it added, its flatness after solving, the growth in diameter and a
// one-line reason; edgings to finish; and "suggest the next 3 rounds" in three styles.
import { useEffect, useState } from 'react';
import { Badge, Button, ShapeBadge } from '@/ui';
import { suggestNext, type DoilySpec, type Suggestion, type Suggestions as Sug } from '@/core/generate';
import type { ParamSet } from '@/core/params';
import { DoilyThumb } from './Thumbs';
import type { Layer } from './state';

const cm = (mm: number) => `${(mm / 10).toFixed(1)} cm`;
const pct = (x: number) => (Math.round(Math.abs(x) * 100) === 0 ? '±0 %' : `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)} %`);

/** Compute suggestions off the click path (they solve ~20 candidate doilies). */
function useSuggestions(spec: DoilySpec, params: ParamSet, targetCm: number, on: boolean): Sug | null {
  const key = on ? JSON.stringify([spec.symmetry, spec.rounds, spec.style, spec.target, params.id, targetCm]) : '';
  const [state, setState] = useState<{ key: string; value: Sug } | null>(null);
  useEffect(() => {
    if (!on || state?.key === key) return;
    const t = setTimeout(() => setState({ key, value: suggestNext(spec, params, { targetCm: targetCm || undefined }) }), 30);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state?.key === key ? state.value : null;
}

function Card({ s, onAdd, compact }: { s: Suggestion; onAdd: (layers: Layer[]) => void; compact?: boolean }) {
  return (
    <li className="dz-sug" data-flat={s.flat} data-over={s.overTarget}>
      <DoilyThumb rounds={s.preview} size={compact ? 80 : 96} label={`Preview with ${s.label}`} />
      <div className="dz-sug__body">
        <div className="dz-sug__top">
          <span className="dz-sug__name">{s.label}</span>
          {s.flat ? <ShapeBadge shape="flat">{Math.abs(s.e) <= 0.1 ? `flat ${pct(s.e)}` : 'flat (loose)'}</ShapeBadge> : <ShapeBadge shape={s.e < 0 ? 'cup' : 'ruffle'} />}
          {s.overTarget && <Badge tone="warning">over your size</Badge>}
        </div>
        <span className="dz-sug__reason">{s.reason}</span>
        <span className="dz-sug__meta">+{cm(s.growthMm)} across → {cm(s.diameterMm)}</span>
      </div>
      <Button size="sm" variant={s.flat ? 'primary' : 'default'} icon="plus" onClick={() => onAdd(s.add)} aria-label={`Add ${s.label}`}>
        {s.transition && s.kind === 'motif' ? 'Add with transition' : 'Add'}
      </Button>
    </li>
  );
}

export function SuggestionsPanel({
  spec, params, targetCm, open, onAdd, onClose,
}: { spec: DoilySpec; params: ParamSet; targetCm: number; open: boolean; onAdd: (layers: Layer[], label: string) => void; onClose: () => void }) {
  const sug = useSuggestions(spec, params, targetCm, open);
  const [more, setMore] = useState(false);
  const [three, setThree] = useState(false);
  if (!open) return null;
  const add = (layers: Layer[], label: string) => { onAdd(layers, label); setThree(false); };
  return (
    <section className="dz-suggest" aria-label="Add a round">
      <div className="dz-card__head">
        <span className="dz-label">Add a round</span>
        {sug && <span className="small muted">on your {sug.outer}</span>}
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {!sug ? (
        <p className="small muted dz-thinking" role="status">Trying every motif on your doily…</p>
      ) : (
        <>
          <ol className="dz-suglist" aria-label="Motifs that fit now, best first">
            {(more ? sug.motifs : sug.motifs.slice(0, 5)).map((s) => <Card key={s.id} s={s} onAdd={(l) => add(l, `add ${s.label}`)} />)}
          </ol>
          {sug.motifs.length > 5 && (
            <Button size="sm" variant="ghost" onClick={() => setMore(!more)}>{more ? 'Show the best five' : `Show all ${sug.motifs.length} motifs`}</Button>
          )}
          {sug.finish.length > 0 && (
            <>
              <div className="dz-label dz-sug__section">Finish it</div>
              <ol className="dz-suglist">{sug.finish.map((s) => <Card key={s.id} s={s} compact onAdd={(l) => add(l, `finish: ${s.label}`)} />)}</ol>
            </>
          )}
          {sug.continuations.length > 0 && (
            <>
              <div className="dz-sug__section dz-sug__row">
                <span className="dz-label">Next three rounds</span>
                <Button size="sm" onClick={() => setThree(!three)}>{three ? 'Hide' : 'Suggest the next 3 rounds'}</Button>
              </div>
              {three && <ol className="dz-suglist">{sug.continuations.map((s) => <Card key={s.id} s={s} compact onAdd={(l) => add(l, `add 3 rounds (${s.style})`)} />)}</ol>}
            </>
          )}
        </>
      )}
    </section>
  );
}
