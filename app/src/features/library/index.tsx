import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, ConfirmDialog, EmptyState, Icon, Input, Menu, Page, PageHeader, Section, ShapeBadge, toast } from '@/ui';
import { builtins, type BuiltinRecord } from '@/app/builtins';
import { patternHref, useAllPatterns } from '@/app/hooks';
import { PatternGlyph } from '@/app/PatternGlyph';
import { exportPattern, importPatterns } from '@/app/patternActions';
import { NewPatternDialog } from '@/features/editor/NewPatternDialog';
import { useLibrary } from '@/store/library';
import type { PatternRecord } from '@/store/types';
import './library.css';

const originLabel: Record<PatternRecord['origin'], string> = { user: 'Mine', designer: 'Designer', fixture: 'Example', corpus: 'Corpus' };

function matches(r: PatternRecord, q: string) {
  if (!q) return true;
  const hay = `${r.title}\n${r.text}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

const fmtDate = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};

export default function LibraryPage() {
  const { mine, hydrated } = useAllPatterns();
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [toDelete, setToDelete] = useState<PatternRecord | null>(null);
  const navigate = useNavigate();

  const mineShown = useMemo(() => mine.filter((r) => matches(r, q)), [mine, q]);
  const builtinShown = useMemo(() => builtins.filter((r) => matches(r, q)), [q]);

  const onImport = async () => {
    const ids = await importPatterns();
    if (ids.length === 1) navigate(patternHref('editor', ids[0]));
  };

  return (
    <Page>
      <PageHeader
        title="Library"
        description="Your patterns live in this browser (IndexedDB). Download them to keep a copy or move them to another device."
        actions={<>
          <Button icon="upload" onClick={onImport}>Import</Button>
          <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>New pattern</Button>
        </>}
      />

      <div className="lib-search">
        <Icon name="search" />
        <Input type="search" placeholder="Search titles and notation…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patterns" />
      </div>

      <Section title={<>My patterns <span className="lib-count">{mine.length}</span></>}>
        {!hydrated ? (
          <p className="muted">Loading…</p>
        ) : mine.length === 0 ? (
          <div className="lib-empty">
            <EmptyState
              title="No patterns of your own yet"
              actions={<><Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>Start a pattern</Button><Button icon="upload" onClick={onImport}>Import a .cro file</Button></>}
            >
              Start from a template, import a <code>.cro</code> or <code>.crochet.json</code> file, or open an example below and start typing.
            </EmptyState>
          </div>
        ) : mineShown.length === 0 ? (
          <p className="muted">No match for “{q}”.</p>
        ) : (
          <ul className="lib-list">
            {mineShown.map((r) => (
              <Row key={r.id} r={r} onDelete={() => setToDelete(r)} />
            ))}
          </ul>
        )}
      </Section>

      <Section title={<>Built-in <span className="lib-count">{builtins.length}</span></>}>
        {builtinShown.length === 0 ? <p className="muted">No match for “{q}”.</p> : (
          <ul className="lib-list">
            {builtinShown.map((r) => <Row key={r.id} r={r} />)}
          </ul>
        )}
      </Section>

      <NewPatternDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete this pattern?"
        body={<>“{toDelete?.title}” will be removed from this device. This cannot be undone.</>}
        confirmLabel="Delete"
        danger
        onConfirm={() => { if (toDelete) { void useLibrary.getState().remove(toDelete.id); toast('Pattern deleted'); } }}
      />
    </Page>
  );
}

function Row({ r, onDelete }: { r: PatternRecord | BuiltinRecord; onDelete?: () => void }) {
  const navigate = useNavigate();
  const b = r as BuiltinRecord;
  const duplicate = () => {
    const copy = useLibrary.getState().duplicate(r);
    toast(`“${copy.title}” added to My patterns`);
    navigate(patternHref('editor', copy.id));
  };
  return (
    <li className="lib-row">
      <Link to={patternHref('editor', r.id)} className="lib-row__main">
        <span className="lib-row__glyph"><PatternGlyph text={r.text} pattern={r.graph} size={48} /></span>
        <span className="lib-row__text">
          <span className="lib-row__title">{r.title}</span>
          <span className="lib-row__meta">
            <Badge tone={r.readOnly ? 'outline' : 'accent'}>{originLabel[r.origin]}</Badge>
            {b.expectedShape && <ShapeBadge shape={b.expectedShape} />}
            {!r.readOnly && <span>Edited {fmtDate(r.updatedAt)}</span>}
            {r.graph && <Badge tone="info">graph only</Badge>}
          </span>
        </span>
      </Link>
      <div className="lib-row__actions">
        {r.readOnly && <Button size="sm" icon="copy" onClick={duplicate} className="lib-row__dup">Duplicate</Button>}
        <Menu
          label={`Actions for ${r.title}`}
          items={[
            { label: 'Open in Editor', icon: 'edit', onSelect: () => navigate(patternHref('editor', r.id)) },
            { label: 'Open in Chart', icon: 'chart', onSelect: () => navigate(patternHref('chart', r.id)) },
            { label: 'Open in 3D', icon: 'cube', onSelect: () => navigate(patternHref('sim', r.id)) },
            { label: 'Open in Counter', icon: 'counter', onSelect: () => navigate(patternHref('counter', r.id)) },
            'separator',
            { label: r.readOnly ? 'Duplicate to My patterns' : 'Duplicate', icon: 'copy', onSelect: duplicate },
            { label: 'Download .cro', icon: 'download', onSelect: () => exportPattern(r, 'cro') },
            { label: 'Download .crochet.json', icon: 'download', onSelect: () => exportPattern(r, 'json') },
            ...(onDelete ? ['separator' as const, { label: 'Delete…', icon: 'trash' as const, danger: true, onSelect: onDelete }] : []),
          ]}
        />
      </div>
    </li>
  );
}
