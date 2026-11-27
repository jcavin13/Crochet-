// Undo / redo for the layer stack: a plain past / present / future history (pure; tested).
export interface History<T> { past: T[]; present: T; future: T[] }

export const HISTORY_LIMIT = 60;

export const historyOf = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** Record a new present (drops the redo branch; identical states are not recorded twice). */
export function record<T>(h: History<T>, next: T, eq: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)): History<T> {
  if (eq(h.present, next)) return h;
  const past = [...h.past, h.present];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, present: next, future: [] };
}
export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}
export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
/** The present changed from outside (e.g. state loaded): keep the history only if it agrees. */
export function sync<T>(h: History<T>, present: T): History<T> {
  return JSON.stringify(h.present) === JSON.stringify(present) ? h : record(h, present);
}
