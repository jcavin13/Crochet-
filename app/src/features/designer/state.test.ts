import { describe, expect, it } from 'vitest';
import { PRESETS } from '@/core/generate';
import { historyOf, record, redo, undo, HISTORY_LIMIT } from './history';
import {
  initialState, migrateState, migrateSnow, initialSnow, lockLayer, resolveUnlocked, moveLayer, duplicateLayer, insertLayer, removeLayer,
  specOf, toLayers, type DesignerStateV1,
} from './state';

describe('designer state migration', () => {
  it('upgrades a v1 save and keeps the design', () => {
    const v1: DesignerStateV1 = {
      v: 1, mode: 'guided', symmetry: 8, rounds: PRESETS[3].spec.rounds, target: { shape: 'flat' }, lacy: 0.3, heights: ['sc', 'dc'],
      terms: 'UK', paramsId: 'worsted-4_5.0mm', title: 'Mine', random: { seed: 5, roundsMin: 6, roundsMax: 8, maxCm: 30, anySymmetry: true },
    };
    const s = migrateState(v1);
    expect(s.v).toBe(2);
    expect(s.kind).toBe('doily');
    expect(s.symmetry).toBe(8);
    expect(s.rounds).toEqual(PRESETS[3].spec.rounds);
    expect(s.terms).toBe('UK');
    expect(s.title).toBe('Mine');
    expect(s.targetCm).toBe(30);
    expect(s.random.seed).toBe(5);
  });
  it('falls back safely on damaged or unknown saves', () => {
    expect(migrateState(undefined)).toEqual(initialState);
    expect(migrateState({ v: 7 })).toEqual(initialState);
    const bad = migrateState({ v: 2, symmetry: 'x', rounds: [{ nope: 1 }], paramsId: 'gone', kind: 'snowflake', targetCm: 15 });
    expect(bad.symmetry).toBe(initialState.symmetry);
    expect(bad.rounds).toEqual(initialState.rounds);
    expect(bad.paramsId).toBe(initialState.paramsId);
    expect(bad.kind).toBe('snowflake');
    expect(bad.targetCm).toBe(15);
    expect(migrateState(initialState)).toEqual(initialState);
    expect(migrateSnow({ v: 1, spec: { points: 'six' } })).toEqual(initialSnow);
    expect(migrateSnow(initialSnow)).toEqual(initialSnow);
  });
});

describe('undo / redo', () => {
  it('walks back and forth and drops the redo branch on a new edit', () => {
    let h = historyOf(1);
    h = record(h, 2); h = record(h, 3);
    expect(h.present).toBe(3);
    h = undo(h); expect(h.present).toBe(2);
    h = undo(h); expect(h.present).toBe(1);
    h = undo(h); expect(h.present).toBe(1);
    h = redo(h); expect(h.present).toBe(2);
    h = record(h, 9); expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
    expect(record(h, 9)).toBe(h); // no duplicate entries
  });
  it('is capped', () => {
    let h = historyOf(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = record(h, i);
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});

describe('layer operations', () => {
  const rounds = toLayers(PRESETS[0].spec);
  it('move / duplicate / insert / remove keep the centre first', () => {
    expect(moveLayer(rounds, 1, -1)).toBe(rounds);
    expect(moveLayer(rounds, 2, -1)[1].motif).toBe(rounds[2].motif);
    expect(duplicateLayer(rounds, 3).length).toBe(rounds.length + 1);
    expect(duplicateLayer(rounds, 3)[4]).toEqual(rounds[3]);
    expect(insertLayer(rounds, 0, [{ motif: 'mesh' }])[1].motif).toBe('mesh');
    expect(removeLayer(rounds, 0)).toBe(rounds);
    expect(removeLayer(rounds, 2).length).toBe(rounds.length - 1);
  });
  it('locked layers survive "re-solve all"', () => {
    const locked = lockLayer(rounds, 3, { ch: 5, per: 1 });
    const re = resolveUnlocked(locked);
    expect(re[3].params).toEqual({ ch: 5, per: 1 });
    expect(re[3].locked).toBe(true);
    expect(re[2].params).toBeUndefined();
    expect(specOf({ ...initialState, rounds: locked }).rounds[3]).not.toHaveProperty('locked');
  });
});
