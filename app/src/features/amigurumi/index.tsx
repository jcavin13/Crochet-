// Amigurumi page: shapes of revolution → patterns (Shape tab) and gauge maths (Gauge tab).
// The active tab is in the URL (#/amigurumi?tab=gauge) so it can be linked.
import { useSearchParams } from 'react-router-dom';
import { Page, PageHeader, Tabs } from '@/ui';
import { ShapeTab } from './ShapeTab';
import { GaugeTab } from './GaugeTab';
import './amigurumi.css';

type Tab = 'shape' | 'gauge';

export default function AmigurumiPage() {
  const [search, setSearch] = useSearchParams();
  const tab: Tab = search.get('tab') === 'gauge' ? 'gauge' : 'shape';
  return (
    <Page wide>
      <PageHeader
        kicker="Amigurumi & sizing"
        title={tab === 'shape' ? 'Shape of revolution' : 'Gauge calculator'}
        description={tab === 'shape'
          ? 'Draw half the outline of a round shape; get stitch counts per round for your yarn and hook, with increases spread evenly.'
          : 'Your gauge and a measurement in; stitches, rows and ready-to-work patterns out.'}
      />
      <Tabs<Tab>
        label="Amigurumi tools"
        className="ami-tabs"
        value={tab}
        onChange={(t) => setSearch(t === 'shape' ? {} : { tab: t }, { replace: true })}
        tabs={[{ id: 'shape', label: 'Shape' }, { id: 'gauge', label: 'Gauge calculator' }]}
      />
      <div className="ami-body" role="tabpanel">{tab === 'shape' ? <ShapeTab /> : <GaugeTab />}</div>
    </Page>
  );
}
