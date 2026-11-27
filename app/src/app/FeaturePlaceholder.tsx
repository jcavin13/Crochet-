import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, Page, PageHeader, buttonClass } from '@/ui';
import { compilerAvailable } from './coreApi';
import { patternHref, useCurrentPattern } from './hooks';
import { navByKey } from './nav';
import { PatternPicker } from './PatternPicker';
import { PatternGlyph } from './PatternGlyph';

/** Shared stand-in for wave-2 feature pages: header, pattern picker, current pattern summary. */
export function FeaturePlaceholder({ feature, description, usesPattern = true }: { feature: string; description: string; usesPattern?: boolean }) {
  const nav = navByKey[feature];
  return (
    <Page wide>
      <PageHeader kicker="Coming in wave 2" title={nav?.label ?? feature} description={description} />
      {usesPattern ? <PatternPanel feature={feature} /> : (
        <EmptyState title="Not built yet" actions={<Link to="/" className={buttonClass('primary')}>Back to the gallery</Link>}>
          This tool is being built. Meanwhile, try the Editor with one of the example patterns.
        </EmptyState>
      )}
    </Page>
  );
}

function PatternPanel({ feature }: { feature: string }) {
  const cur = useCurrentPattern();
  const errors = cur.diagnostics.filter((d) => d.severity === 'error').length;
  const rounds = cur.pattern?.graph.rounds;
  return (
    <div className="placeholder-grid">
      <div className="placeholder-art">
        <div>
          <PatternGlyph text={cur.text} pattern={cur.pattern} size={160} />
          <strong>{navByKey[feature]?.label} is on its way</strong>
          <span>It will draw the pattern you pick here.</span>
        </div>
      </div>
      <Card className="stack">
        <PatternPicker value={cur.id} />
        <h2 style={{ margin: 0 }}>{cur.record?.title ?? 'No pattern'}</h2>
        <dl className="kv">
          <dt>Source</dt><dd>{cur.record?.readOnly ? 'Built-in example' : 'My patterns'}</dd>
          <dt>Rounds</dt><dd>{rounds ? rounds.length : '—'}</dd>
          <dt>Last round</dt><dd>{rounds?.length ? `${rounds[rounds.length - 1].stitchCount} sts` : '—'}</dd>
          <dt>Check</dt>
          <dd>
            {!compilerAvailable ? <Badge tone="info">compiler pending</Badge>
              : errors ? <Badge tone="error">{errors} error{errors > 1 ? 's' : ''}</Badge>
              : <Badge tone="ok">compiles</Badge>}
          </dd>
        </dl>
        {cur.id && <Link className={buttonClass()} to={patternHref('editor', cur.id)}>Open in Editor</Link>}
      </Card>
    </div>
  );
}
