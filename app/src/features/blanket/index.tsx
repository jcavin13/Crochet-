// Blanket design studio (#/blanket): rectangles in rows with borders, blankets worked in the round,
// and motif blankets (planner). The design itself runs in a Web Worker (useDesign).
// #/blanket?demo=<id> loads one of the example designs (demos.ts).
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePersistentState } from '@/store';
import { initialState, migrateState, type BlanketState } from './state';
import { Studio } from './Studio';
import { DEMO_BY_ID } from './demos';
import './blanket.css';

export default function BlanketPage() {
  const [raw, setRaw, hydrated] = usePersistentState<BlanketState>('blanket:state', initialState);
  const [params, setParams] = useSearchParams();
  const demo = params.get('demo');
  useEffect(() => {
    if (!hydrated || !demo) return;
    const d = DEMO_BY_ID[demo];
    if (d) setRaw({ ...migrateState(raw), spec: d.spec, step: d.step ?? 0 });
    const next = new URLSearchParams(params);
    next.delete('demo');
    setParams(next, { replace: true });
  }, [hydrated, demo]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!hydrated || (demo && DEMO_BY_ID[demo])) return <div className="shell-loading" role="progressbar" aria-label="Loading"><span /></div>;
  return <Studio state={migrateState(raw)} setState={setRaw} />;
}
