// Gauge calculator tab: gauge + measurements → stitch counts (and patterns where it makes sense).
import { useId, useMemo, type ReactNode } from 'react';
import { Badge, Button, Card, SegmentedControl, Toggle } from '@/ui';
import { useStitchParams } from '@/app';
import { usePersistentState } from '@/store';
import { circle, convertGauge, gaugeFromParams, hat, paramsFromGauge, rectangle, tube, type AmiStitch, type Gauge } from '@/core/amigurumi';
import { paramSetById, paramsFile } from '@/core/params';
import { PatternOutput } from './PatternOutput';
import { YarnPanel } from '@/features/yarn/YarnPanel';

interface GaugeState {
  stitch: AmiStitch;
  gauge: Gauge;
  rect: { w: number; h: number; ease: number; multiple: number; plus: number };
  circle: { d: number; regular: boolean };
  tube: { c: number; ease: number; h: number; multiple: number; plus: number };
  hat: { head: number; ease: number; h: number; multiple: number };
  conv: { ps: number; pr: number; sts: number; rows: number; hook: number };
}

const INITIAL: GaugeState = {
  stitch: 'sc',
  gauge: { stitches: 16, rows: 17 },
  rect: { w: 10, h: 10, ease: 0, multiple: 1, plus: 0 },
  circle: { d: 12, regular: true },
  tube: { c: 56, ease: -10, h: 5, multiple: 2, plus: 0 },
  hat: { head: 56, ease: 8, h: 20, multiple: 1 },
  conv: { ps: 14, pr: 16, sts: 80, rows: 60, hook: 5 },
};

const f1 = (x: number) => String(+x.toFixed(1));

function Num({ label, value, onChange, unit, step = 1, min, hint }: { label: ReactNode; value: number; onChange: (v: number) => void; unit?: string; step?: number; min?: number; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="ui-field ami-num">
      <label className="ui-field__label" htmlFor={id}>{label}</label>
      <div className="ami-num__box">
        <input id={id} className="ui-input" type="number" inputMode="decimal" step={step} min={min} value={Number.isFinite(value) ? value : ''}
          onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
        {unit && <span className="ami-num__unit">{unit}</span>}
      </div>
      {hint && <span className="ui-field__hint">{hint}</span>}
    </div>
  );
}

function RepeatField({ multiple, plus, onChange }: { multiple: number; plus: number; onChange: (m: number, p: number) => void }) {
  const id = useId();
  return (
    <div className="ui-field ami-repeat">
      <label className="ui-field__label" htmlFor={id}>Stitch count must be</label>
      <div className="ami-repeat__row">
        <span className="small muted">a multiple of</span>
        <input id={id} className="ui-input" type="number" inputMode="numeric" min={1} value={multiple} aria-label="multiple of"
          onChange={(e) => { const v = parseInt(e.target.value, 10); if (v > 0) onChange(v, plus); }} />
        <span className="small muted">plus</span>
        <input className="ui-input" type="number" inputMode="numeric" min={0} value={plus} aria-label="plus"
          onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 0) onChange(multiple, v); }} />
      </div>
      <span className="ui-field__hint">For a stitch-pattern repeat, e.g. 6 + 1 for shells; 1 + 0 = any count.</span>
    </div>
  );
}

function Out({ items }: { items: [ReactNode, ReactNode][] }) {
  return <dl className="ami-results">{items.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function PatternDetails({ text, label = 'Pattern' }: { text: string; label?: string }) {
  return (
    <details className="ami-details">
      <summary>{label}</summary>
      <PatternOutput text={text} maxHeight={260} />
    </details>
  );
}

export function GaugeTab() {
  const [st, setSt] = usePersistentState<GaugeState>('amigurumi:gauge', INITIAL);
  const { selectedId } = useStitchParams();
  const params = paramSetById(selectedId) ?? paramsFile.sets[0];
  const patch = <K extends keyof GaugeState>(k: K, v: Partial<GaugeState[K]>) =>
    setSt((s) => ({ ...s, [k]: typeof s[k] === 'object' ? { ...(s[k] as object), ...v } : v }));
  const g = st.gauge;
  const valid = g.stitches > 0 && g.rows > 0;
  const w = 100 / g.stitches, h = 100 / g.rows;

  const res = useMemo(() => {
    if (!valid) return null;
    try {
      return {
        rect: rectangle({ gauge: g, widthCm: st.rect.w, heightCm: st.rect.h, easePct: st.rect.ease, stitch: st.stitch, multiple: st.rect.multiple, plus: st.rect.plus, params }),
        circle: circle({ gauge: g, diameterCm: st.circle.d, stitch: st.stitch, regular: st.circle.regular, params }),
        tube: tube({ gauge: g, circumferenceCm: st.tube.c, easePct: st.tube.ease, heightCm: st.tube.h, multiple: st.tube.multiple, plus: st.tube.plus, stitch: st.stitch, params }),
        hat: hat({ gauge: g, headCm: st.hat.head, negativeEasePct: st.hat.ease, heightCm: st.hat.h, multiple: st.hat.multiple, stitch: st.stitch, params }),
        conv: convertGauge({ pattern: { stitches: st.conv.ps, rows: st.conv.pr }, mine: g, stitches: st.conv.sts, rows: st.conv.rows, hookMm: st.conv.hook }),
      };
    } catch {
      return null;
    }
  }, [st, g, valid, params]);

  // yarn from stitch counts at *your* gauge (the calculators can describe pieces too big to compile)
  const gp = useMemo(() => (valid ? paramsFromGauge(g, st.stitch, params) : params), [g, st.stitch, params, valid]);
  const yarnCounts = useMemo(() => {
    if (!res) return null;
    const s = st.stitch;
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    return {
      rect: { ch: res.rect.foundationChain, [s]: res.rect.stitches * res.rect.rows, 'turning ch': (res.rect.rows - 1) * res.rect.turningChain },
      circle: { [s]: sum(res.circle.counts) },
      tube: { ch: res.tube.stitches, 'sl st': 1, [s]: res.tube.stitches * res.tube.rounds },
      hat: { [s]: sum(res.hat.counts) },
    };
  }, [res, st.stitch]);
  const yarn = (k: keyof NonNullable<typeof yarnCounts>) => yarnCounts && <YarnPanel counts={yarnCounts[k]} params={gp} compact className="ami-yarnline" />;

  return (
    <div className="ami-gauge">
      <Card className="ami-gauge__main">
        <h2 className="ui-card__title">Your gauge</h2>
        <p className="small muted">Stitches and rows in 10 cm of your swatch, in the stitch you will use. Everything below follows from it.</p>
        <div className="ami-form">
          <div className="ui-field">
            <span className="ui-field__label">Stitch</span>
            <SegmentedControl label="Stitch" value={st.stitch} onChange={(v) => setSt((s) => ({ ...s, stitch: v }))}
              options={[{ value: 'sc', label: 'sc' }, { value: 'hdc', label: 'hdc' }, { value: 'dc', label: 'dc' }]} />
          </div>
          <Num label="Stitches / 10 cm" value={g.stitches} step={0.5} min={1} onChange={(v) => patch('gauge', { stitches: v })} />
          <Num label="Rows / 10 cm" value={g.rows} step={0.5} min={1} onChange={(v) => patch('gauge', { rows: v })} />
        </div>
        <div className="row">
          <Button size="sm" onClick={() => { const x = gaugeFromParams(params, st.stitch); patch('gauge', { stitches: +x.stitches.toFixed(1), rows: +x.rows.toFixed(1) }); }}>
            Use my stitch parameters
          </Button>
          <span className="small muted">{params.label} (About &amp; settings)</span>
        </div>
        {valid && (
          <Out items={[
            ['One stitch', `${f1(w)} × ${f1(h)} mm`],
            ['Flat circle adds', `${f1((2 * Math.PI * h) / w)} sts a round`],
          ]} />
        )}
      </Card>

      {!res ? <Card><p>Enter a gauge above zero.</p></Card> : (
        <div className="ami-gauge__grid">
          <Card>
            <h2 className="ui-card__title">Rectangle or swatch</h2>
            <div className="ami-form">
              <Num label="Width" unit="cm" value={st.rect.w} onChange={(v) => patch('rect', { w: v })} />
              <Num label="Height" unit="cm" value={st.rect.h} onChange={(v) => patch('rect', { h: v })} />
              <Num label="Ease" unit="%" value={st.rect.ease} onChange={(v) => patch('rect', { ease: v })} />
              <RepeatField multiple={st.rect.multiple} plus={st.rect.plus} onChange={(multiple, plus) => patch('rect', { multiple, plus })} />
            </div>
            <Out items={[
              ['Stitches', <b key="s">{res.rect.stitches}</b>],
              ['Rows', <b key="r">{res.rect.rows}</b>],
              ['Foundation chain', `${res.rect.foundationChain} (incl. ${res.rect.turningChain} turning ch)`],
              ['Finished size', `${f1(res.rect.actualWidthCm)} × ${f1(res.rect.actualHeightCm)} cm`],
            ]} />
            {yarn('rect')}
            <PatternDetails text={res.rect.text} />
          </Card>

          <Card>
            <h2 className="ui-card__title">Flat circle</h2>
            <div className="ami-form">
              <Num label="Diameter" unit="cm" value={st.circle.d} onChange={(v) => patch('circle', { d: v })} />
              <div className="ami-form__full"><Toggle label={`Textbook increases (+${res.circle.startCount} every round)`} checked={st.circle.regular} onChange={(v) => patch('circle', { regular: v })} /></div>
            </div>
            <Out items={[
              ['Rounds', <b key="r">{res.circle.rounds}</b>],
              ['Start', `magic ring, ${res.circle.startCount} ${st.stitch}`],
              ['Flat rate', `${f1(res.circle.perRound)} sts / round (2π·h/w)`],
              ['Last round', `${res.circle.counts[res.circle.counts.length - 1]} sts`],
              ['Finished', `⌀ ${f1(res.circle.actualDiameterCm)} cm`],
            ]} />
            <p className="small muted mono ami-seq">{res.circle.counts.join(' · ')}</p>
            {yarn('circle')}
            <PatternDetails text={res.circle.text} />
          </Card>

          <Card>
            <h2 className="ui-card__title">Tube</h2>
            <p className="small muted">A cuff, a hat band, a sleeve, an amigurumi leg.</p>
            <div className="ami-form">
              <Num label="Circumference" unit="cm" value={st.tube.c} onChange={(v) => patch('tube', { c: v })} />
              <Num label="Ease" unit="%" value={st.tube.ease} onChange={(v) => patch('tube', { ease: v })} hint="negative = snug" />
              <Num label="Length" unit="cm" value={st.tube.h} onChange={(v) => patch('tube', { h: v })} />
              <RepeatField multiple={st.tube.multiple} plus={st.tube.plus} onChange={(multiple, plus) => patch('tube', { multiple, plus })} />
            </div>
            <Out items={[
              ['Stitches', <b key="s">{res.tube.stitches}</b>],
              ['Rounds', <b key="r">{res.tube.rounds}</b>],
              ['Finished', `${f1(res.tube.actualCircumferenceCm)} cm around × ${f1(res.tube.actualHeightCm)} cm`],
            ]} />
            {yarn('tube')}
            <PatternDetails text={res.tube.text} />
          </Card>

          <Card>
            <h2 className="ui-card__title">Top-down hat</h2>
            <div className="ami-form">
              <Num label="Head" unit="cm" value={st.hat.head} onChange={(v) => patch('hat', { head: v })} />
              <Num label="Negative ease" unit="%" value={st.hat.ease} onChange={(v) => patch('hat', { ease: v })} />
              <Num label="Height" unit="cm" value={st.hat.h} onChange={(v) => patch('hat', { h: v })} hint="crown to brim" />
              <Num label="Body sts: multiple of" value={st.hat.multiple} min={1} onChange={(v) => patch('hat', { multiple: Math.max(1, Math.round(v)) })} />
            </div>
            <Out items={[
              ['Body stitches', <b key="s">{res.hat.stitches}</b>],
              ['Crown', `${res.hat.crownRounds} rounds (⌀ ${f1(res.hat.crownDiameterCm)} cm)`],
              ['Then even', `${res.hat.bodyRounds} rounds`],
              ['Finished', `${f1(res.hat.actualCircumferenceCm)} cm around, ${f1(res.hat.actualHeightCm)} cm tall`],
            ]} />
            {res.hat.warnings.map((m, i) => <p key={i} className="small"><Badge tone="warning">Check</Badge> {m}</p>)}
            {yarn('hat')}
            <PatternDetails text={res.hat.text} />
          </Card>

          <Card className="ami-gauge__wide">
            <h2 className="ui-card__title">Pattern gauge vs. my gauge</h2>
            <p className="small muted">The pattern says one gauge, your swatch says another (your gauge is the one at the top).</p>
            <div className="ami-form">
              <Num label="Pattern: sts / 10 cm" value={st.conv.ps} step={0.5} onChange={(v) => patch('conv', { ps: v })} />
              <Num label="Pattern: rows / 10 cm" value={st.conv.pr} step={0.5} onChange={(v) => patch('conv', { pr: v })} />
              <Num label="Pattern says: stitches" value={st.conv.sts} onChange={(v) => patch('conv', { sts: v })} />
              <Num label="… and rows" value={st.conv.rows} onChange={(v) => patch('conv', { rows: v })} />
              <Num label="My hook" unit="mm" value={st.conv.hook} step={0.25} onChange={(v) => patch('conv', { hook: v })} />
            </div>
            <Out items={[
              ['Work instead', <b key="a">{res.conv.stitches} sts × {res.conv.rows} rows</b>],
              ['If you keep the counts', `${f1(res.conv.widthFactor * 100)}% wide × ${f1(res.conv.heightFactor * 100)}% tall`],
              ['Hook to try', res.conv.suggestedHookMm ? `${res.conv.suggestedHookMm} mm (a guess)` : 'keep yours'],
            ]} />
            <p className="small ami-hint">{res.conv.hint}</p>
          </Card>
        </div>
      )}
    </div>
  );
}
