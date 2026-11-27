/**
 * Flatness predictor for a candidate round, from its sector entries alone — the same closed form
 * as core/flatness (spec/flatness.md), so the solver can score hundreds of candidates without
 * compiling. The generator re-checks the final pattern with the real analyzeFlatness, and a test
 * asserts the two agree.
 */
import { simConfig, stitchParam, type ParamSet } from '../params';
import type { Entry } from './types';

export interface FlatState {
  /** Classifiable rounds so far. */
  k: number;
  /** Radius handed to the next round. */
  r: number;
}

export interface Prediction {
  e: number; eMin: number; eMax: number;
  cls: 'flat' | 'cup' | 'ruffle';
  rho: number; r: number;
  next: FlatState;
}

const TAU = 2 * Math.PI;

export function startState(params: ParamSet, ringChains: number): FlatState {
  return { k: 0, r: (ringChains * stitchParam(params, 'ch').width) / TAU };
}

export function predictRound(entries: Entry[], repeats: number, state: FlatState, params: ParamSet): Prediction {
  const { tol, chain_slack_min: slack, chain_nominal: nominal } = simConfig.flatness;
  const wch = stitchParam(params, 'ch').width;
  let sumW = 0, sumH = 0, nSt = 0, nCh = 0, nSp = 0;
  for (const en of entries) {
    if (en.kind === 'sp') { nCh += en.len; nSp++; continue; }
    const p = stitchParam(params, en.type);
    sumW += p.width; sumH += p.height; nSt++;
  }
  sumW *= repeats; nCh *= repeats; nSp *= repeats;
  const hBar = nSt ? sumH / nSt : 0;
  const cMax = sumW + nCh * wch, cMin = sumW + nCh * wch * slack, c = sumW + nCh * wch * nominal;
  const magic = state.k === 0 && state.r === 0;
  const rho = magic ? Math.max(hBar, c / TAU) : state.r + hBar;
  let rise = 0;
  if (nSp > 0) {
    const d = Math.max(0, TAU * rho - sumW) / nSp;
    const L = (nCh / nSp) * wch;
    if (L > d) rise = 0.5 * Math.sqrt(L * L - d * d);
  }
  const need = TAU * rho;
  const eMax = cMax / need - 1, eMin = cMin / need - 1, e = c / need - 1;
  const cls = eMax < -tol ? 'cup' : eMin > tol ? 'ruffle' : 'flat';
  return { e, eMin, eMax, cls, rho, r: rho + rise, next: { k: state.k + 1, r: rho + rise } };
}
