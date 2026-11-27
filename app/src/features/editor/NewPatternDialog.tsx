import { useNavigate } from 'react-router-dom';
import { Dialog, Icon } from '@/ui';
import { templates } from '@/app/templates';
import { PatternGlyph } from '@/app/PatternGlyph';
import { useLibrary } from '@/store/library';
import './editor.css';

/** Choose a template; creates the pattern in My patterns and opens it in the Editor. */
export function NewPatternDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const create = (text: string) => {
    const rec = useLibrary.getState().create({ text, origin: 'user' });
    onClose();
    navigate(`/editor/${encodeURIComponent(rec.id)}`);
  };
  return (
    <Dialog open={open} onClose={onClose} title="New pattern" sheet>
      <div className="tpl-list">
        {templates.map((t) => (
          <button key={t.id} type="button" className="tpl" onClick={() => create(t.text)}>
            <span className="tpl__glyph"><PatternGlyph text={t.text} size={56} /></span>
            <span className="tpl__text">
              <strong>{t.title}</strong>
              <span className="muted small">{t.description}</span>
            </span>
            <Icon name="chevron-right" />
          </button>
        ))}
      </div>
    </Dialog>
  );
}
