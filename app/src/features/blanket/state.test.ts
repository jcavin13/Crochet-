import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEC, designBlanket } from '@/core/blanket';
import { buildSteps } from '@/core/counter';
import { addLayer, applyBorderPreset, historyOf, initialState, migrateState, moveLayer, record, redo, removeLayer, undo } from './state';
import { DEMOS } from './demos';

describe('blanket studio state', () => {
  it('undo / redo of spec edits', () => {
    let h = historyOf(DEFAULT_SPEC);
    const a = { ...DEFAULT_SPEC, body: { pattern: 'dc' } };
    const b = { ...a, size: { widthCm: 50, heightCm: 50 } };
    h = record(record(h, a), b);
    expect(h.present).toEqual(b);
    h = undo(h);
    expect(h.present).toEqual(a);
    h = undo(h);
    expect(h.present).toEqual(DEFAULT_SPEC);
    expect(undo(h)).toBe(h);
    h = redo(redo(h));
    expect(h.present).toEqual(b);
    expect(record(h, b)).toBe(h);
  });
  it('migrates damaged saves to a valid state', () => {
    expect(migrateState(undefined)).toEqual(initialState);
    expect(migrateState({ v: 1, spec: { construction: 'nope', body: { pattern: 'zz' }, size: { widthCm: 'x' } } }).spec.body.pattern).toBe(DEFAULT_SPEC.body.pattern);
    const s = migrateState({ v: 1, spec: { ...DEFAULT_SPEC, construction: 'round' }, units: 'in' });
    expect(s.spec.construction).toBe('round');
    expect(s.units).toBe('in');
  });
  it('layer edits', () => {
    const l = addLayer(addLayer([], 'sc'), 'shell');
    expect(moveLayer(l, 0, 1).map((x) => x.kind)).toEqual(['shell', 'sc']);
    expect(removeLayer(l, 0).map((x) => x.kind)).toEqual(['shell']);
    expect(applyBorderPreset(DEFAULT_SPEC, 'lace').border.layers.map((x) => x.kind)).toEqual(['mesh', 'sc', 'shell']);
  });
  it('every example design compiles (full or swatch)', () => {
    for (const d of DEMOS) {
      const r = designBlanket(d.spec);
      expect(r.compiled === 'full' || r.compiled === 'swatch', d.id).toBe(true);
      const bad = [...r.diagnostics.full, ...r.diagnostics.swatch].filter((x) => x.severity === 'error');
      expect(bad, d.id).toEqual([]);
    }
  });
  it('the counter follows odd/even row ranges and border rounds', () => {
    const r = designBlanket({ ...DEFAULT_SPEC, size: { widthCm: 30, heightCm: 30 } });
    const steps = buildSteps(r.pattern!, { granularity: 'round' });
    expect(steps.rounds.length).toBe(r.pattern!.graph.rounds.length);
    expect(steps.rounds.find((x) => x.label === 'Row 4')!.line).toMatch(/^Row 4: ch 1, sc in next st, sc in next ch-1 sp/);
    expect(steps.rounds.find((x) => x.label === 'Row 5')!.line).toMatch(/^Row 5: ch 1, sc in next st, \*ch 1/);
  });
});
