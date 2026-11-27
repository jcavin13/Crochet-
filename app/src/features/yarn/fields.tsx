// Small number field used by the yarn panel, the calibration dialog and the yarn manager.
import { useEffect, useId, useState, type ReactNode } from 'react';

export function NumField({ label, value, onChange, unit, step = 1, min = 0, hint, placeholder, className }: {
  label: ReactNode; value: number | undefined; onChange: (v: number | undefined) => void; unit?: string; step?: number; min?: number;
  hint?: ReactNode; placeholder?: string; className?: string;
}) {
  const id = useId();
  // keep the typed text (so "1." or "" can be typed) and report parsed numbers
  const [text, setText] = useState(value === undefined || !Number.isFinite(value) ? '' : String(value));
  useEffect(() => {
    const parsed = parseFloat(text);
    if (value === undefined ? text !== '' && Number.isFinite(parsed) : parsed !== value) setText(value === undefined ? '' : String(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`ui-field yn-num ${className ?? ''}`}>
      <label className="ui-field__label" htmlFor={id}>{label}</label>
      <div className="yn-num__box">
        <input id={id} className="ui-input" type="number" inputMode="decimal" step={step} min={min} value={text} placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseFloat(e.target.value);
            onChange(Number.isFinite(v) && v >= min ? v : undefined);
          }} />
        {unit && <span className="yn-num__unit">{unit}</span>}
      </div>
      {hint && <span className="ui-field__hint">{hint}</span>}
    </div>
  );
}
