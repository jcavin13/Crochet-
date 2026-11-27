import { useNavigate } from 'react-router-dom';
import { Select } from '@/ui';
import { useAllPatterns, useFeatureBase, patternHref } from './hooks';

/**
 * Dropdown of all patterns (mine + built-ins). Choosing one navigates the current feature route
 * (`/<feature>/<id>`), or calls `onSelect` if given.
 */
export function PatternPicker({ value, onSelect, label = 'Pattern', feature }: { value?: string; onSelect?: (id: string) => void; label?: string; feature?: string }) {
  const { mine, builtins } = useAllPatterns();
  const navigate = useNavigate();
  const base = useFeatureBase();
  const fixtures = builtins.filter((b) => b.origin === 'fixture');
  const corpus = builtins.filter((b) => b.origin === 'corpus');
  const choose = (id: string) => (onSelect ? onSelect(id) : navigate(patternHref(feature ?? base, id)));
  return (
    <div className="pattern-picker">
      <span className="pattern-picker__label">{label}</span>
      <Select aria-label={label} value={value ?? ''} onChange={(e) => choose(e.target.value)}>
        {!value && <option value="" disabled>Choose a pattern…</option>}
        {mine.length > 0 && (
          <optgroup label="My patterns">
            {mine.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </optgroup>
        )}
        <optgroup label="Examples">
          {fixtures.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </optgroup>
        {corpus.length > 0 && (
          <optgroup label="Corpus (public domain)">
            {corpus.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </optgroup>
        )}
      </Select>
    </div>
  );
}
