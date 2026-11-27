// Which yarn the user is working with, for a param set: the per-weight choice (one of "my yarns",
// or a typed-in ball band) resolved into a YarnSpec for core/yarn. Shared by YarnPanel, the
// counter and the library so they all show the same figure.
import { useMemo } from 'react';
import { categoryKey, yarnDefaults, type YarnSpec } from '@/core/yarn';
import type { ParamSet } from '@/core/params';
import { useMyYarns, useYarnChoice, useSettings, type MyYarn, type YarnChoice } from '@/store';

/** YarnSpec of one of my yarns; its calibration applies only to the category it was made for. */
export function specFromMyYarn(y: MyYarn, category: string): { spec: YarnSpec; note?: string } {
  const spec: YarnSpec = { id: y.id, label: y.label, metersPer100g: y.metersPer100g, ballGrams: y.ballGrams, category: y.category && yarnDefaults.categories[y.category] ? y.category : undefined };
  const c = y.calibration;
  if (!c) return { spec };
  if (c.category !== category) {
    const cat = yarnDefaults.categories[c.category]?.label ?? c.category;
    return { spec, note: `${y.label}'s calibration was made for ${cat} stitch sizes, not this pattern's — not applied.` };
  }
  if (c.kind === 'split' && c.width && c.height) spec.calibrationSplit = { width: c.width, height: c.height };
  else spec.calibration = c.factor;
  return { spec };
}

export function specFromChoice(choice: YarnChoice, yarns: MyYarn[], category: string, base: YarnSpec = {}): { spec: YarnSpec; yarn?: MyYarn; note?: string } {
  const y = choice.yarnId ? yarns.find((x) => x.id === choice.yarnId) : undefined;
  if (y) {
    const { spec, note } = specFromMyYarn(y, category);
    return { spec: { ...base, ...spec, allowance: choice.allowance ?? base.allowance }, yarn: y, note };
  }
  return {
    spec: {
      ...base,
      metersPer100g: choice.metersPer100g ?? base.metersPer100g,
      ballGrams: choice.ballGrams ?? base.ballGrams,
      allowance: choice.allowance ?? base.allowance,
    },
  };
}

export function useYarnFor(params: Pick<ParamSet, 'yarn_weight'>, base?: YarnSpec) {
  const category = categoryKey(params.yarn_weight);
  const [choice, setChoice, choiceHydrated] = useYarnChoice(category);
  const { yarns, hydrated, add, update, remove } = useMyYarns();
  const units = useSettings((s) => s.yarnUnits ?? 'metric');
  const resolved = useMemo(() => specFromChoice(choice ?? {}, yarns, category, base), [choice, yarns, category, base]);
  return {
    category, choice: choice ?? {}, setChoice, yarns, hydrated: hydrated && choiceHydrated, add, update, remove, units,
    spec: resolved.spec, myYarn: resolved.yarn, note: resolved.note,
  };
}
