// Designer page: Doily | Snowflake. Both share the layer idea, the checks and the save / open flow.
import { lazy, Suspense, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SegmentedControl } from '@/ui';
import { usePersistentState } from '@/store';
import { DoilyDesigner } from './DoilyDesigner';
import { initialSnow, initialState, migrateSnow, migrateState, type DesignerState, type Kind, type SnowState } from './state';
import './designer.css';

const SnowflakeDesigner = lazy(() => import('./snowflake/SnowflakeDesigner'));

const Loading = () => <div className="shell-loading" role="progressbar" aria-label="Loading"><span /></div>;

export default function DesignerPage() {
  const [raw, setState, hydrated] = usePersistentState<DesignerState>('designer:state', initialState);
  const [rawSnow, setSnow, snowHydrated] = usePersistentState<SnowState>('designer:snowflake', initialSnow);
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => migrateState(raw), [raw]);
  const snow = useMemo(() => migrateSnow(rawSnow), [rawSnow]);
  if (!hydrated || !snowHydrated) return <Loading />;
  const urlKind = params.get('kind');
  const kind: Kind = urlKind === 'snowflake' || urlKind === 'doily' ? urlKind : state.kind;
  const setKind = (k: Kind) => {
    setState({ ...state, kind: k });
    const next = new URLSearchParams(params);
    next.set('kind', k);
    next.delete('view');
    setParams(next, { replace: true });
  };
  const kindSwitch = (
    <SegmentedControl<Kind>
      label="What to design" className="dz-kind" value={kind} onChange={setKind}
      options={[{ value: 'doily', label: 'Doily' }, { value: 'snowflake', label: 'Snowflake' }]}
    />
  );
  if (kind === 'snowflake') {
    return (
      <Suspense fallback={<Loading />}>
        <SnowflakeDesigner state={snow} setState={setSnow} kindSwitch={kindSwitch} />
      </Suspense>
    );
  }
  return <DoilyDesigner state={state} setState={setState} kindSwitch={kindSwitch} />;
}
