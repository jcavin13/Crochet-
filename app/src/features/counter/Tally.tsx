// "+1" mode: named manual counters for people following a paper pattern. No pattern needed.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePersistentState } from '@/store';
import { Button, ConfirmDialog, Dialog, Icon, Input, Menu } from '@/ui';
import {
  newTally, tallyAdd, tallyAddCounter, tallyRemove, tallyRename, tallySet, tallyUndo, type TallyState,
} from '@/core/counter';
import { click, useKeys, useTapSwipe, vibrate } from './device';
import { CtrIcon } from './icons';
import { DEFAULT_PREFS, PREFS_KEY, TALLY_KEY, type CounterPrefs } from './persist';

export function TallyScreen() {
  const [state, setState, hydrated] = usePersistentState<TallyState>(TALLY_KEY, newTally());
  const [prefs] = usePersistentState<CounterPrefs>(PREFS_KEY, DEFAULT_PREFS);
  const P = { ...DEFAULT_PREFS, ...prefs };
  const active = state.counters.find((c) => c.id === state.active) ?? state.counters[0];
  const [naming, setNaming] = useState<{ id?: string; name: string } | null>(null);
  const [zeroing, setZeroing] = useState(false);
  const [removing, setRemoving] = useState(false);

  const add = (d: number) => {
    if (!hydrated || !active) return;
    setState((s) => tallyAdd(s, active.id, d));
    if (d > 0) { if (P.haptics) vibrate(12); if (P.sound) click(); }
  };
  const tap = useTapSwipe(() => add(1), (dir) => add(dir < 0 ? 1 : -1));
  useKeys((e) => {
    const onControl = !!(e.target as HTMLElement | null)?.closest?.('button, a, [role="radio"]');
    if (e.key === 'ArrowRight' || e.key === '+' || ((e.key === ' ' || e.key === 'Enter') && !onControl)) { e.preventDefault(); add(1); }
    else if (e.key === 'ArrowLeft' || e.key === '-') { e.preventDefault(); add(-1); }
    else if (e.key === 'u' || (e.key === 'z' && e.ctrlKey)) { e.preventDefault(); setState(tallyUndo); }
  });

  return (
    <div className="ctr-screen ctr-screen--tally">
      <div className="ctr-main">
        <header className="ctr-bar">
          <Link to="/counter" className="ctr-iconlink" aria-label="All counters"><Icon name="chevron-left" size={22} /></Link>
          <h1 className="ctr-title">Tally counter</h1>
          <Menu
            label="Tally options"
            items={[
              { label: 'Add a counter…', icon: 'plus', onSelect: () => setNaming({ name: '' }) },
              { label: `Rename “${active?.name}”…`, icon: 'edit', onSelect: () => active && setNaming({ id: active.id, name: active.name }) },
              { label: `Set “${active?.name}” to 0…`, icon: 'auto', onSelect: () => setZeroing(true) },
              'separator',
              { label: `Remove “${active?.name}”`, icon: 'trash', danger: true, disabled: state.counters.length < 2, onSelect: () => setRemoving(true) },
            ]}
          />
        </header>

        <div className="ctr-tally-tabs" role="radiogroup" aria-label="Counters">
          {state.counters.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.id === active?.id}
              className="ctr-chip"
              onClick={() => setState((s) => ({ ...s, active: c.id }))}
            >
              <span className="ctr-chip__name">{c.name}</span>
              <span className="ctr-chip__val">{c.value}</span>
            </button>
          ))}
          <button type="button" className="ctr-chip ctr-chip--add" onClick={() => setNaming({ name: '' })} aria-label="Add a counter">
            <CtrIcon name="plus" size={18} />
          </button>
        </div>

        <div className="ctr-tap ctr-tap--tally" {...tap} role="button" tabIndex={0} aria-label={`Add one to ${active?.name}`}>
          <p className="ctr-tally__name">{active?.name}</p>
          <p className="ctr-tally__value" aria-live="polite">{active?.value ?? 0}</p>
          <p className="ctr-hint">Tap anywhere for +1 · swipe → for −1</p>
        </div>

        <footer className="ctr-controls">
          <button type="button" className="ctr-btn ctr-btn--back" onClick={() => add(-1)} disabled={!active?.value} aria-label="Minus one">
            <CtrIcon name="minus" /><span>−1</span>
          </button>
          <span className="ctr-controls__spacer" />
          <button type="button" className="ctr-btn" onClick={() => setState(tallyUndo)} disabled={!state.history.length} aria-label="Undo">
            <CtrIcon name="undo" /><span>Undo</span>
          </button>
        </footer>
      </div>

      <Dialog
        open={!!naming}
        onClose={() => setNaming(null)}
        title={naming?.id ? 'Rename counter' : 'New counter'}
        sheet
        footer={<>
          <Button onClick={() => setNaming(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => {
            if (!naming) return;
            setState((s) => (naming.id ? tallyRename(s, naming.id, naming.name.trim() || 'Counter') : tallyAddCounter(s, naming.name)));
            setNaming(null);
          }}>{naming?.id ? 'Rename' : 'Add'}</Button>
        </>}
      >
        <label className="ctr-field">
          <span>Name</span>
          <Input value={naming?.name ?? ''} maxLength={40} autoFocus placeholder="e.g. Repeats, Sleeve 2" onChange={(e) => setNaming((n) => (n ? { ...n, name: e.target.value } : n))} />
        </label>
      </Dialog>
      <ConfirmDialog open={zeroing} title={`Set “${active?.name}” to 0?`} body="Undo brings the number back." confirmLabel="Set to 0" onConfirm={() => active && setState((s) => tallySet(s, active.id, 0))} onClose={() => setZeroing(false)} />
      <ConfirmDialog open={removing} title={`Remove “${active?.name}”?`} confirmLabel="Remove" danger onConfirm={() => active && setState((s) => tallyRemove(s, active.id))} onClose={() => setRemoving(false)} />
    </div>
  );
}
