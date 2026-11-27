// "My yarns": the user's yarns (ball band data) with their swatch calibrations, persisted in
// IndexedDB through usePersistentState. Plus the per-weight "which yarn am I using" choice that
// every YarnPanel and the counter share. Pure helpers are exported for tests.
import { useCallback } from 'react';
import { usePersistentState, setPersistent, getPersistent, loadPersistent } from './persistentState';

export interface YarnSwatchRecord {
  stitch: string;
  stitches: number;
  rows: number;
  grams?: number;
  meters?: number;
  metersPer100g?: number;
}

export interface YarnCalibration {
  kind: 'single' | 'split';
  /** measured / model; 1.12 = you use 12 % more yarn than the nominal model. */
  factor: number;
  /** Split factors (loop terms, height terms), from two different stitches. */
  width?: number;
  height?: number;
  /** stitch_params set the swatch was compared against (the factor absorbs your gauge vs. it). */
  paramsId: string;
  /** Yarn category the calibration is valid for (a factor for worsted means nothing for thread). */
  category: string;
  swatches: YarnSwatchRecord[];
  date: number;
}

export interface MyYarn {
  id: string;
  label: string;
  /** Ball band metres per 100 g. */
  metersPer100g?: number;
  /** Grams per ball / skein. */
  ballGrams?: number;
  /** Yarn weight category key (spec/yarn_defaults.json), e.g. 'medium-4', 'thread-10'. */
  category?: string;
  fibre?: string;
  notes?: string;
  calibration?: YarnCalibration;
  createdAt: number;
  updatedAt: number;
}

/** What the yarn panel of a given weight category uses: one of my yarns, or a typed-in ball band. */
export interface YarnChoice {
  yarnId?: string;
  metersPer100g?: number;
  ballGrams?: number;
  /** Allowance as a fraction (default 0.10). */
  allowance?: number;
}

export const MY_YARNS_KEY = 'yarn:mine';
export const choiceKey = (category: string) => `yarn:choice:${category}`;

export function newYarnId(): string {
  return `y-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function addYarn(list: MyYarn[], y: Omit<MyYarn, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<MyYarn, 'id'>>, now = Date.now()): { list: MyYarn[]; yarn: MyYarn } {
  const yarn: MyYarn = { ...y, id: y.id ?? newYarnId(), createdAt: now, updatedAt: now };
  return { list: [...list, yarn], yarn };
}
export function updateYarn(list: MyYarn[], id: string, patch: Partial<Omit<MyYarn, 'id' | 'createdAt'>>, now = Date.now()): MyYarn[] {
  return list.map((y) => (y.id === id ? { ...y, ...patch, updatedAt: now } : y));
}
export function removeYarn(list: MyYarn[], id: string): MyYarn[] {
  return list.filter((y) => y.id !== id);
}

/** The persisted list with add / update / remove. `hydrated` is false until storage was read. */
export function useMyYarns() {
  const [yarns, setYarns, hydrated] = usePersistentState<MyYarn[]>(MY_YARNS_KEY, []);
  const add = useCallback((y: Parameters<typeof addYarn>[1]) => {
    const { yarn } = addYarn([], y);
    setYarns((l) => [...(l ?? []), yarn]);
    return yarn;
  }, [setYarns]);
  const update = useCallback((id: string, patch: Parameters<typeof updateYarn>[2]) => setYarns((l) => updateYarn(l ?? [], id, patch)), [setYarns]);
  const remove = useCallback((id: string) => setYarns((l) => removeYarn(l ?? [], id)), [setYarns]);
  return { yarns: yarns ?? [], hydrated, add, update, remove };
}

/** The yarn choice for a weight category (shared by every panel showing that weight, and the counter). */
export function useYarnChoice(category: string) {
  return usePersistentState<YarnChoice>(choiceKey(category), {});
}

/** Non-hook access (tests, scripts). */
export const yarnStore = {
  load: () => loadPersistent(MY_YARNS_KEY, []),
  get: () => getPersistent<MyYarn[]>(MY_YARNS_KEY, []),
  set: (v: MyYarn[] | ((p: MyYarn[]) => MyYarn[])) => setPersistent<MyYarn[]>(MY_YARNS_KEY, v),
};
