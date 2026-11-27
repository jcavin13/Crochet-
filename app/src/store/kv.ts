// Key-value persistence. IndexedDB via idb-keyval in the browser; swappable for tests.
import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval';

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  entries<T>(): Promise<[string, T][]>;
}

/** IndexedDB-backed KV. One database per store (idb-keyval cannot add stores to an existing DB). */
export function idbKV(dbName: string, storeName = 'kv'): KV {
  let store: UseStore | null = null;
  const s = () => (store ??= createStore(dbName, storeName)); // lazy: no IndexedDB access at import time
  return {
    get: (k) => get(k, s()),
    set: (k, v) => set(k, v, s()),
    del: (k) => del(k, s()),
    entries: async <T,>() => (await entries(s())) as [string, T][],
  };
}

/** In-memory KV (tests, private mode fallback). Values are structured-cloned like IndexedDB would. */
export function memoryKV(): KV & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    map,
    get: async (k) => clone(map.get(k) as never),
    set: async (k, v) => { map.set(k, clone(v)); },
    del: async (k) => { map.delete(k); },
    entries: async <T,>() => [...map.entries()].map(([k, v]) => [k, clone(v)] as [string, T]),
  };
}

const hasIDB = typeof indexedDB !== 'undefined';
let backends: { patterns: KV; state: KV } = {
  patterns: hasIDB ? idbKV('crochet-patterns') : memoryKV(),
  state: hasIDB ? idbKV('crochet-state') : memoryKV(),
};

/** `patterns`: the pattern library. `state`: feature data via usePersistentState. */
export const kv = {
  get patterns() { return backends.patterns; },
  get state() { return backends.state; },
};

/** Replace the backends (tests). */
export function setKVBackends(b: Partial<typeof backends>) {
  backends = { ...backends, ...b };
}
