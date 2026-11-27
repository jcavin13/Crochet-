// The designers' yarn figures: core/yarn's estimate for the user's yarn ("my yarns" choice or ball
// band, calibration, units) — the same figure the YarnPanel, the counter and the library show.
import { useMemo } from 'react';
import type { Pattern } from '@/core/graph';
import type { ParamSet } from '@/core/params';
import { estimateYarn, formatLength, formatMass, type YarnEstimate, type YarnUnits } from '@/core/yarn';
import { useYarnFor } from '@/features/yarn/useYarn';

export interface DesignYarn {
  est?: YarnEstimate;
  units: YarnUnits;
  /** "≈ 12 m · 4 g" (net) */
  value: string;
  /** "nominal estimate" / "calibrated estimate", with the yarn's name when it is one of mine */
  hint: string;
  /** net metres per graph round (index = round), for the layer builder */
  perRound: number[];
}

export function useDesignYarn(pattern: Pattern | undefined, params: ParamSet): DesignYarn {
  const y = useYarnFor(params);
  const units = (y.units ?? 'metric') as YarnUnits;
  return useMemo(() => {
    let est: YarnEstimate | undefined;
    try { est = pattern ? estimateYarn(pattern, params, { yarn: y.spec }) : undefined; } catch { est = undefined; }
    if (!est) return { units, value: '–', hint: 'no estimate', perRound: [] };
    const status = est.yarn?.status === 'calibrated' ? 'calibrated' : 'nominal';
    return {
      est, units,
      value: `≈ ${formatLength(est.net.meters, units)} · ${formatMass(est.net.grams ?? 0, units)}`,
      hint: `${status} estimate${y.myYarn ? ` · ${y.myYarn.label}` : ''}`,
      perRound: est.perRound.map((r) => r.meters),
    };
  }, [pattern, params, y.spec, y.myYarn, units]);
}

export { formatLength };
