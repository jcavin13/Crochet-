import { beforeEach, describe, expect, it } from 'vitest';
import { memoryKV, setKVBackends } from './kv';
import { resetPersistentCache } from './persistentState';
import { MY_YARNS_KEY, addYarn, removeYarn, updateYarn, yarnStore, type MyYarn } from './yarns';

let state: ReturnType<typeof memoryKV>;
beforeEach(() => {
  state = memoryKV();
  setKVBackends({ state, patterns: memoryKV() });
  resetPersistentCache();
});

describe('my yarns', () => {
  it('add / update / remove are pure', () => {
    const { list, yarn } = addYarn([], { label: 'Wool', metersPer100g: 200, ballGrams: 100 }, 5);
    expect(list).toHaveLength(1);
    expect(yarn).toMatchObject({ label: 'Wool', createdAt: 5, updatedAt: 5 });
    expect(yarn.id).toMatch(/^y-/);
    const up = updateYarn(list, yarn.id, { calibration: { kind: 'single', factor: 1.1, paramsId: 'worsted-4_5.0mm', category: 'medium-4', swatches: [], date: 6 } }, 7);
    expect(up[0].calibration?.factor).toBe(1.1);
    expect(up[0].updatedAt).toBe(7);
    expect(list[0].calibration).toBeUndefined();
    expect(removeYarn(up, yarn.id)).toEqual([]);
  });
  it('persists the list in the state store', async () => {
    const y: MyYarn = { id: 'y-1', label: 'Cotton 10', metersPer100g: 560, ballGrams: 50, category: 'thread-10', createdAt: 1, updatedAt: 1 };
    await yarnStore.set([y]);
    expect(await state.get(MY_YARNS_KEY)).toEqual([y]);
    resetPersistentCache();
    await yarnStore.load();
    expect(yarnStore.get()).toEqual([y]);
  });
});
