// usePersistentState(key, initial): useState that survives reloads, stored in IndexedDB
// (the `state` KV). Components using the same key share one value.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { kv } from './kv';

type Entry = { value: unknown; hydrated: boolean; loading?: Promise<void> };
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

const emit = (key: string) => listeners.get(key)?.forEach((l) => l());

function entry(key: string, initial: unknown): Entry {
  let e = entries.get(key);
  if (!e) {
    e = { value: initial, hydrated: false };
    entries.set(key, e);
  }
  return e;
}

/** Load a key from storage (once). Exported for tests and for prefetching. */
export function loadPersistent(key: string, initial: unknown): Promise<void> {
  const e = entry(key, initial);
  if (e.hydrated) return Promise.resolve();
  e.loading ??= kv.state.get(key).then(
    (v) => {
      // a write that happened before load finished wins
      if (!e.hydrated && v !== undefined) e.value = v;
      e.hydrated = true;
      emit(key);
    },
    () => { e.hydrated = true; emit(key); },
  );
  return e.loading;
}

/** Read the current value (not reactive). */
export function getPersistent<T>(key: string, initial: T): T {
  return entry(key, initial).value as T;
}

/** Set a value and write it to storage. */
export async function setPersistent<T>(key: string, value: T | ((prev: T) => T)): Promise<void> {
  const e = entry(key, undefined);
  const next = typeof value === 'function' ? (value as (p: T) => T)(e.value as T) : value;
  e.value = next;
  e.hydrated = true;
  emit(key);
  try { await kv.state.set(key, next); } catch (err) { console.warn('[persistentState] write failed', key, err); }
}

export async function deletePersistent(key: string): Promise<void> {
  entries.delete(key);
  emit(key);
  await kv.state.del(key);
}

/** Forget in-memory values (tests). */
export function resetPersistentCache() {
  entries.clear();
}

/**
 * Like useState, persisted under `key` (namespace it: `counter:<patternId>`). Values must be
 * structured-cloneable. Returns [value, setValue, hydrated]; `value` is `initial` until hydrated.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void, boolean] {
  const subscribe = useCallback((cb: () => void) => {
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(cb);
    return () => { set!.delete(cb); };
  }, [key]);
  const snap = useSyncExternalStore(subscribe, () => entry(key, initial).value, () => initial) as T;
  const hydrated = useSyncExternalStore(subscribe, () => entry(key, initial).hydrated, () => false);
  useEffect(() => { void loadPersistent(key, initial); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const setValue = useCallback((v: T | ((prev: T) => T)) => { void setPersistent<T>(key, v); }, [key]);
  return [snap, setValue, hydrated];
}
