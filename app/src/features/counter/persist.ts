// Persistence keys and small records for the counter (IndexedDB via usePersistentState).
import { loadPersistent, setPersistent } from '@/store';
import type { Granularity } from '@/core/counter';

export const progressKey = (id: string) => `counter:${id}`;
export const INDEX_KEY = 'counter:index';
export const PREFS_KEY = 'counter:prefs';
export const TALLY_KEY = 'counter:tally';

/** "Continue where you left off": one entry per pattern with saved progress. */
export interface IndexEntry {
  id: string;
  title: string;
  /** 0…1 */
  fraction: number;
  /** e.g. "Rnd 5 · 14 / 32" */
  where: string;
  updatedAt: number;
  finished: boolean;
}
export type CounterIndex = Record<string, IndexEntry>;

export interface CounterPrefs {
  haptics: boolean;
  sound: boolean;
  wake: boolean;
  chartOpen: boolean;
  /** default granularity for new patterns */
  granularity: Granularity;
}
export const DEFAULT_PREFS: CounterPrefs = { haptics: true, sound: false, wake: false, chartOpen: false, granularity: 'group' };

// Always read the stored index before updating it, so a write never clobbers other entries.
export async function writeIndexEntry(e: IndexEntry) {
  await loadPersistent(INDEX_KEY, {});
  await setPersistent<CounterIndex>(INDEX_KEY, (prev) => {
    const cur = prev?.[e.id];
    if (cur && cur.fraction === e.fraction && cur.where === e.where && cur.title === e.title && cur.finished === e.finished) return prev;
    return { ...(prev ?? {}), [e.id]: e };
  });
}

export async function removeIndexEntry(id: string) {
  await loadPersistent(INDEX_KEY, {});
  await setPersistent<CounterIndex>(INDEX_KEY, (prev) => {
    const next = { ...(prev ?? {}) };
    delete next[id];
    return next;
  });
}
