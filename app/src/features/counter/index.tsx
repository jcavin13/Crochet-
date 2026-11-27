// Counter feature. Routes:  #/counter (landing: continue list, start, tally)  ·  #/counter/tally
// (pattern-free "+1" counters)  ·  #/counter/<pattern id> (the counter itself).
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PatternPicker, builtinById, patternHref, useAllPatterns } from '@/app';
import { deletePersistent, usePersistentState } from '@/store';
import { ConfirmDialog, IconButton, Page, PageHeader, Section, buttonClass } from '@/ui';
import { CounterScreen } from './CounterScreen';
import { TallyScreen } from './Tally';
import { CtrIcon } from './icons';
import { INDEX_KEY, progressKey, removeIndexEntry, type CounterIndex } from './persist';
import './counter.css';

export default function CounterPage() {
  const { id } = useParams();
  if (!id) return <Landing />;
  if (id === 'tally') return <TallyScreen />;
  return <CounterScreen />;
}

function ago(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function Landing() {
  const [index, , hydrated] = usePersistentState<CounterIndex>(INDEX_KEY, {});
  const { mine, hydrated: libHydrated } = useAllPatterns();
  const [forget, setForget] = useState<string | null>(null);
  const exists = (id: string) => !!builtinById[id] || !libHydrated || mine.some((r) => r.id === id);
  const entries = Object.values(index ?? {}).filter((e) => exists(e.id)).sort((a, b) => b.updatedAt - a.updatedAt);
  const inProgress = entries.filter((e) => !e.finished);
  const finished = entries.filter((e) => e.finished);

  const row = (e: CounterIndex[string]) => (
    <li key={e.id} className="ctr-cont">
      <Link to={patternHref('counter', e.id)} className="ctr-cont__link">
        <span className="ctr-cont__title">{e.title}</span>
        <span className="ctr-cont__where">{e.where} · {ago(e.updatedAt)}</span>
        <span className="ctr-cont__bar" aria-hidden="true"><span style={{ width: `${Math.round(e.fraction * 100)}%` }} /></span>
      </Link>
      <span className="ctr-cont__pct">{Math.round(e.fraction * 100)}%</span>
      <IconButton icon="close" label={`Forget progress on ${e.title}`} onClick={() => setForget(e.id)} />
    </li>
  );

  return (
    <Page>
      <PageHeader
        kicker="Counter"
        title="Row & stitch counter"
        description="Follows the pattern stitch by stitch: what to make next, what it goes into, and how many you should have at the end of each round. Saved on this device; works offline."
      />
      <Section title="Continue where you left off">
        {!hydrated ? <p className="ctr-muted">Loading…</p> : inProgress.length ? (
          <ul className="ctr-conts">{inProgress.map(row)}</ul>
        ) : (
          <p className="ctr-muted">Nothing in progress yet. Pick a pattern below to start counting.</p>
        )}
      </Section>
      <Section title="Start counting a pattern">
        <div className="ctr-start">
          <PatternPicker label="Pattern" feature="counter" />
          <Link to={patternHref('counter', 'fixture:simple_doily')} className={buttonClass('primary')}>Try the simple doily</Link>
        </div>
      </Section>
      <Section title="Following a paper pattern?">
        <Link to="/counter/tally" className="ctr-tallycard">
          <span className="ctr-tallycard__icon"><CtrIcon name="tally" size={28} /></span>
          <span>
            <b>Tally counter</b>
            <span className="ctr-muted"> — big +1 button with named counters (rows, repeats, sleeves…). No pattern needed.</span>
          </span>
        </Link>
      </Section>
      {finished.length > 0 && (
        <Section title="Finished">
          <ul className="ctr-conts">{finished.map(row)}</ul>
        </Section>
      )}
      <ConfirmDialog
        open={forget !== null}
        title="Forget this progress?"
        body="The saved position, round times and notes for this pattern are deleted from this device. The pattern itself stays."
        confirmLabel="Forget"
        danger
        onConfirm={() => { if (forget) { void deletePersistent(progressKey(forget)); void removeIndexEntry(forget); } }}
        onClose={() => setForget(null)}
      />
    </Page>
  );
}
