// Generated notation with copy / save / open-in actions (shared by the Shape and Gauge tabs).
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, toast } from '@/ui';
import { patternHref, useCompiled } from '@/app';
import { useLibrary } from '@/store';

/** Save `text` to My patterns once per distinct text; returns the record id. */
function useSaveOnce(text: string) {
  const saved = useRef<{ text: string; id: string } | null>(null);
  return () => {
    if (saved.current?.text === text) return saved.current.id;
    const rec = useLibrary.getState().create({ text, origin: 'designer' });
    saved.current = { text, id: rec.id };
    return rec.id;
  };
}

export function PatternOutput({ text, maxHeight, compact }: { text: string; maxHeight?: number; compact?: boolean }) {
  const navigate = useNavigate();
  const save = useSaveOnce(text);
  const [savedId, setSavedId] = useState<string | null>(null);
  const compiled = useCompiled(text, 150);
  const problems = compiled.diagnostics.filter((d) => d.severity !== 'info');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Pattern copied');
    } catch {
      toast('Could not copy — select the text and copy it by hand.', { tone: 'error' });
    }
  };
  const open = (feature: string) => navigate(patternHref(feature, save()));
  return (
    <div className="ami-out">
      <div className="ami-out__bar">
        {compiled.pending ? <Badge tone="outline">Checking…</Badge>
          : problems.length === 0 ? <Badge tone="ok" dot>Compiles cleanly</Badge>
          : <Badge tone="error" dot>{problems.length} problem{problems.length > 1 ? 's' : ''}</Badge>}
        <span className="spacer" />
        <Button size="sm" icon="copy" onClick={copy}>Copy</Button>
        <Button size="sm" variant="primary" icon="download" onClick={() => { const id = save(); setSavedId(id); toast('Saved to My patterns'); }}>
          {savedId ? 'Saved' : 'Save to my patterns'}
        </Button>
      </div>
      <pre className="ami-code" style={maxHeight ? { maxHeight } : undefined} tabIndex={0} aria-label="Generated pattern">{text}</pre>
      {problems.length > 0 && (
        <ul className="ami-problems">{problems.map((d, i) => <li key={i}>{d.message}</li>)}</ul>
      )}
      {!compact && (
        <div className="row ami-out__open">
          <span className="small muted">Open in</span>
          <Button size="sm" icon="edit" onClick={() => open('editor')}>Editor</Button>
          <Button size="sm" icon="cube" onClick={() => open('sim')}>3D view</Button>
          <Button size="sm" icon="counter" onClick={() => open('counter')}>Counter</Button>
        </div>
      )}
    </div>
  );
}
