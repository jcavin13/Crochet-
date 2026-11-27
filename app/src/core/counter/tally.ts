/** Manual tally counters ("+1" mode) for people following a paper pattern. Pure reducers. */
export interface TallyCounter { id: string; name: string; value: number }
export interface TallyState { v: 1; counters: TallyCounter[]; active: string; history: { id: string; value: number }[] }

export function newTally(): TallyState {
  return { v: 1, counters: [{ id: 'c1', name: 'Rows', value: 0 }, { id: 'c2', name: 'Stitches', value: 0 }], active: 'c1', history: [] };
}

const withValue = (s: TallyState, id: string, value: number, record = true): TallyState => {
  const c = s.counters.find((x) => x.id === id);
  if (!c) return s;
  const v = Math.max(0, Math.round(value));
  if (v === c.value) return s;
  return {
    ...s,
    counters: s.counters.map((x) => (x.id === id ? { ...x, value: v } : x)),
    history: record ? [...s.history, { id, value: c.value }].slice(-200) : s.history,
  };
};

export const tallyAdd = (s: TallyState, id: string, d: number): TallyState => {
  const c = s.counters.find((x) => x.id === id);
  return c ? withValue(s, id, c.value + d) : s;
};
export const tallySet = (s: TallyState, id: string, v: number): TallyState => withValue(s, id, v);
export function tallyUndo(s: TallyState): TallyState {
  const h = s.history[s.history.length - 1];
  if (!h) return s;
  return withValue({ ...s, history: s.history.slice(0, -1) }, h.id, h.value, false);
}
export function tallyAddCounter(s: TallyState, name: string): TallyState {
  let n = s.counters.length + 1;
  const ids = new Set(s.counters.map((c) => c.id));
  while (ids.has(`c${n}`)) n++;
  const id = `c${n}`;
  return { ...s, counters: [...s.counters, { id, name: name.trim() || `Counter ${n}`, value: 0 }], active: id };
}
export function tallyRemove(s: TallyState, id: string): TallyState {
  const counters = s.counters.filter((c) => c.id !== id);
  if (!counters.length) return s;
  return { ...s, counters, active: s.active === id ? counters[0].id : s.active, history: s.history.filter((h) => h.id !== id) };
}
export const tallyRename = (s: TallyState, id: string, name: string): TallyState =>
  ({ ...s, counters: s.counters.map((c) => (c.id === id ? { ...c, name: name.slice(0, 40) } : c)) });
