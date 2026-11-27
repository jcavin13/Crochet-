/**
 * How many targets of the previous round a list of items consumes (stitch targets, space
 * targets), read off the AST — used to re-balance a repeat count after an edit. `null` when it
 * depends on the previous round ("… around", "each st", hook-addressed chains).
 */
import type { Item, Place, StitchItem } from '../notation';

export interface Use { st: number; sp: number }

const add = (a: Use, b: Use, k = 1): Use => ({ st: a.st + b.st * k, sp: a.sp + b.sp * k });
const ZERO: Use = { st: 0, sp: 0 };

function placeUse(it: Place): Use | null {
  switch (it.kind) {
    case 'next': {
      const n = it.n ?? 1;
      if (it.unit.kind === 'space') return { st: 0, sp: n };
      if (it.unit.kind === 'ch') return null;
      return { st: n, sp: 0 };
    }
    case 'same': case 'first': case 'topOf': case 'ring': return ZERO;
    case 'each': case 'fromHook': return null;
  }
}

function stitchUse(it: StitchItem, inPlace: boolean): Use | null {
  const times = it.times ?? 1;
  if (it.target) {
    const u = placeUse(it.target.place);
    if (!u) return null;
    // "dc in next 3 sts" = one per target; "3 dc in next st" = all into one
    return { st: u.st * times, sp: u.sp * times };
  }
  if (inPlace) return ZERO;
  const count = it.count ?? 1;
  const s = it.spec;
  let per = 1;
  if (s.kind === 'tog') per = s.n;
  else if (s.kind === 'picot') per = 0;
  else if (s.kind === 'basic' && s.type === 'slst') per = 1;
  return { st: per * count * times, sp: 0 };
}

export function consumption(items: Item[], inPlace = false): Use | null {
  let total: Use = ZERO;
  for (const it of items) {
    let u: Use | null = ZERO;
    switch (it.kind) {
      case 'stitch': u = stitchUse(it, inPlace); break;
      case 'skip':
        if (it.unit.kind === 'space') u = { st: 0, sp: it.n };
        else if (it.unit.kind === 'ch') u = null;
        else u = { st: it.n, sp: 0 };
        break;
      case 'group': {
        const times = it.times?.kind === 'n' ? it.times.n : it.times ? NaN : 1;
        if (Number.isNaN(times)) return null;
        if (it.target) {
          const p = placeUse(it.target.place);
          if (!p) return null;
          const inner = consumption(it.items, true);
          if (!inner) return null;
          u = add(p, inner);
          u = { st: u.st * times, sp: u.sp * times };
        } else {
          const inner = consumption(it.items, inPlace);
          if (!inner) return null;
          u = { st: inner.st * times, sp: inner.sp * times };
        }
        break;
      }
      case 'repeat': {
        if (it.times.kind !== 'n') return null;
        const inner = consumption(it.items, inPlace);
        if (!inner) return null;
        u = { st: inner.st * it.times.n, sp: inner.sp * it.times.n };
        break;
      }
      default: u = ZERO;
    }
    if (!u) return null;
    total = add(total, u);
  }
  return total;
}
