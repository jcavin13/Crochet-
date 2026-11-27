// The user's pattern library: zustand store over the `patterns` KV (IndexedDB).
// Built-in patterns (fixtures, corpus) are not stored; see src/app/builtins.ts.
import { create } from 'zustand';
import { kv } from './kv';
import { extractTitle } from './text';
import type { PatternOrigin, PatternRecord } from './types';
import type { Pattern } from '@/app/coreApi';

const KEY = (id: string) => `pattern:${id}`;
const WRITE_DELAY_MS = 400;

export function newId(): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `p-${Date.now().toString(36)}-${r}`;
}

type LibraryState = {
  hydrated: boolean;
  records: Record<string, PatternRecord>;
  /** ids with a pending (debounced) write */
  saving: Record<string, true>;
  hydrate: () => Promise<void>;
  create: (init: { text: string; title?: string; origin?: PatternOrigin; graph?: Pattern }) => PatternRecord;
  /** Update text; re-derives the title from the `title:` header. Persists debounced. */
  setText: (id: string, text: string) => void;
  rename: (id: string, title: string) => void;
  /** Copy any record (incl. a read-only built-in) into the user's library. */
  duplicate: (src: PatternRecord, titleSuffix?: string) => PatternRecord;
  remove: (id: string) => Promise<void>;
  /** Write all pending changes now. */
  flush: () => Promise<void>;
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useLibrary = create<LibraryState>((set, get) => {
  const writeNow = async (id: string) => {
    timers.delete(id);
    const rec = get().records[id];
    if (rec) await kv.patterns.set(KEY(id), rec);
    const { [id]: _, ...rest } = get().saving;
    set({ saving: rest });
  };
  const schedule = (id: string) => {
    clearTimeout(timers.get(id));
    set({ saving: { ...get().saving, [id]: true } });
    timers.set(id, setTimeout(() => void writeNow(id), WRITE_DELAY_MS));
  };
  const put = (rec: PatternRecord) => set({ records: { ...get().records, [rec.id]: rec } });

  return {
    hydrated: false,
    records: {},
    saving: {},

    hydrate: async () => {
      if (get().hydrated) return;
      let rows: [string, PatternRecord][] = [];
      try {
        rows = await kv.patterns.entries<PatternRecord>();
      } catch (e) {
        console.warn('[library] could not read IndexedDB; continuing with an empty library', e);
      }
      const records: Record<string, PatternRecord> = {};
      for (const [k, v] of rows) if (k.startsWith('pattern:') && v && typeof v.text === 'string') records[v.id] = v;
      // keep anything created before hydration finished
      set({ records: { ...records, ...get().records }, hydrated: true });
    },

    create: ({ text, title, origin = 'user', graph }) => {
      const now = Date.now();
      const rec: PatternRecord = { id: newId(), title: title ?? extractTitle(text), text, createdAt: now, updatedAt: now, origin, ...(graph ? { graph } : {}) };
      put(rec);
      void writeNow(rec.id);
      return rec;
    },

    setText: (id, text) => {
      const rec = get().records[id];
      if (!rec || rec.readOnly || rec.text === text) return;
      const { graph: _drop, ...rest } = rec;
      put({ ...rest, text, title: extractTitle(text, rec.title), updatedAt: Date.now() });
      schedule(id);
    },

    rename: (id, title) => {
      const rec = get().records[id];
      if (!rec) return;
      put({ ...rec, title, updatedAt: Date.now() });
      schedule(id);
    },

    duplicate: (src, titleSuffix = ' (copy)') => {
      const isBuiltin = src.origin === 'fixture' || src.origin === 'corpus';
      const title = isBuiltin ? src.title : src.title + titleSuffix;
      return get().create({ text: src.text, title, origin: isBuiltin ? 'user' : src.origin, graph: src.graph });
    },

    remove: async (id) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
      const { [id]: _, ...rest } = get().records;
      const { [id]: __, ...saving } = get().saving;
      set({ records: rest, saving });
      await kv.patterns.del(KEY(id));
    },

    flush: async () => {
      const ids = [...timers.keys()];
      ids.forEach((id) => clearTimeout(timers.get(id)));
      await Promise.all(ids.map(writeNow));
    },
  };
});

/** User records newest first. */
export function sortedRecords(records: Record<string, PatternRecord>): PatternRecord[] {
  return Object.values(records).sort((a, b) => b.updatedAt - a.updatedAt);
}
