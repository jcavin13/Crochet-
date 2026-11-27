/**
 * Automatic sizing, made visible: why the solver chose each number of a round, what the
 * alternatives would do, how to fix a round the user pushed off flat, and the stitch budget a flat
 * next round needs.
 *
 *   explainRound(spec, params, planIndex)  → per parameter: chosen value and the alternatives with
 *                                              their predicted excess ("ch 4 → −6 % · ch 5 → +1 % ✓")
 *   fixesFor(spec, params, planIndex)      → single-parameter changes that make the round flat again
 *   flatBudget(r, repeats, params)         → "a flat round here needs ≈ 96 stitch-widths: 8 per repeat"
 *
 * Everything uses the same predictor as the solver (predict.ts = spec/flatness.md), so the numbers
 * agree with the flatness check of the compiled pattern.
 */
import { simConfig, stitchParam, type ParamSet } from '../params';
import { planDoily, type Plan } from './generate';
import { sectorEntries } from './emit';
import { MOTIFS, type MotifCtx } from './motifs';
import { predictRound, startState, type FlatState, type Prediction } from './predict';
import type { DoilySpec, Height, Iface, ParamValue, RoundParams } from './types';

export interface ParamAlt {
  value: ParamValue;
  label: string;
  /** Predicted nominal excess of the round with this value (others as chosen). */
  e: number;
  cls: Prediction['cls'];
  /** Flat only with sagging / taut loops. */
  loose: boolean;
  chosen: boolean;
}

export interface ParamExplain {
  key: string;
  label: string;
  /** The user left this parameter on auto. */
  auto: boolean;
  chosen?: ParamValue;
  chosenLabel?: string;
  /** Alternatives around the chosen value (at most 5), in value order. */
  alts: ParamAlt[];
}

export interface Fix {
  key: string;
  label: string;
  value: ParamValue | 'auto';
  /** "Fix: set chain length to ch 5" */
  text: string;
  e: number;
}

export interface RoundExplain {
  planIndex: number;
  params: ParamExplain[];
  /** One sentence: the numbers in plain words. */
  sentence: string;
}

const TAU = 2 * Math.PI;
const tol = () => simConfig.flatness.tol;

function shapeScore(p: Prediction): number {
  if (p.cls === 'flat') return Math.abs(p.e) + (Math.abs(p.e) > tol() ? 5 : 0);
  return 10 + (p.cls === 'cup' ? -tol() - p.eMax : p.eMin - tol());
}

function contextOf(spec: DoilySpec, params: ParamSet, plan: Plan, i: number): { ctx: MotifCtx; state: FlatState } {
  const p = plan.planned[i];
  const prev = plan.planned[i - 1];
  const heights: Height[] = spec.style?.heights?.length ? spec.style.heights : ['sc', 'hdc', 'dc', 'tr'];
  let prevIface: Iface = prev ? prev.iface : { kind: 'ring', entries: [] };
  if (p.doubled && prev) {
    const h = prev.entries.length / 2;
    prevIface = { ...prevIface, entries: prev.entries.slice(0, h) };
  }
  const ctx: MotifCtx = {
    prev: prevIface, repeats: p.reps, index: i, heights, lacy: spec.style?.lacy ?? 0.5,
    prevMotif: prev?.motif, prevParams: prev?.params, params,
  };
  return { ctx, state: p.before };
}

/** Candidates of round i with `fixed` pinned, each predicted; best per value of `key`. */
function bestPerValue(spec: DoilySpec, params: ParamSet, plan: Plan, i: number, fixed: RoundParams, key: string) {
  const p = plan.planned[i];
  const { ctx, state } = contextOf(spec, params, plan, i);
  const out = new Map<string, { value: ParamValue; pred: Prediction; score: number }>();
  for (const c of MOTIFS[p.motif].candidates(ctx, fixed)) {
    if (!(key in c.params)) continue;
    const entries = sectorEntries(c.ops);
    if (!entries.some((e) => e.kind === 'st')) continue;
    const st = i === 0 ? startState(params, c.ringChains ?? 0) : state;
    const pred = predictRound(entries, p.reps, st, params);
    const score = shapeScore(pred) + 0.01 * c.cost;
    const k = String(c.params[key]);
    const cur = out.get(k);
    if (!cur || score < cur.score) out.set(k, { value: c.params[key], pred, score });
  }
  return out;
}

const userParams = (spec: DoilySpec, plan: Plan, i: number): RoundParams => {
  const p = plan.planned[i];
  return p.auto ? {} : spec.rounds[p.source]?.params ?? {};
};

/** Why the solver chose each parameter of planned round `planIndex`. */
export function explainRound(spec: DoilySpec, params: ParamSet, planIndex: number, plan: Plan = planDoily(spec, params)): RoundExplain | null {
  const p = plan.planned[planIndex];
  if (!p) return null;
  const m = MOTIFS[p.motif];
  const fixedByUser = userParams(spec, plan, planIndex);
  const out: ParamExplain[] = [];
  for (const d of m.params) {
    if (!(d.key in p.params)) continue;
    const { [d.key]: _drop, ...others } = p.params;
    const per = bestPerValue(spec, params, plan, planIndex, others, d.key);
    const fmt = (v: ParamValue) => (d.format ? d.format(v) : String(v));
    const chosen = p.params[d.key];
    let alts: ParamAlt[] = [...per.values()].map((x) => ({
      value: x.value, label: fmt(x.value), e: x.pred.e, cls: x.pred.cls, loose: x.pred.cls === 'flat' && Math.abs(x.pred.e) > tol(),
      chosen: String(x.value) === String(chosen),
    }));
    // value order (as the motif lists them), a window of 5 around the chosen one
    const order = (v: ParamValue) => { const k = d.values.findIndex((x) => String(x) === String(v)); return k < 0 ? 1e6 : k; };
    alts.sort((a, b) => order(a.value) - order(b.value) || String(a.value).localeCompare(String(b.value)));
    const at = alts.findIndex((a) => a.chosen);
    if (alts.length > 5) {
      const lo = Math.max(0, Math.min(alts.length - 5, at - 2));
      alts = alts.slice(lo, lo + 5);
    }
    if (alts.length <= 1 && !(d.key in fixedByUser)) continue; // nothing to choose between
    out.push({ key: d.key, label: d.label, auto: !(d.key in fixedByUser), chosen, chosenLabel: fmt(chosen), alts });
  }
  return { planIndex, params: out, sentence: plainSentence(p.motif, p.params, p.reps) };
}

/** "ch 5 loops · 3 dc per shell — chosen to lie flat" style summary of a round's numbers. */
export function plainSentence(motif: string, prm: RoundParams, reps: number): string {
  const n = (k: string) => prm[k];
  switch (motif) {
    case 'centre': return `${Number(n('per')) * reps} ${n('st')} into a ${n('ring') === 'chain' && n('ringCh') ? `ch-${n('ringCh')} ring` : 'magic ring'}${n('style') === 'spoked' ? `, ch ${n('ch')} between` : ''}`;
    case 'mesh': return `ch ${n('ch')} loops, ${Number(n('per')) * reps} around`;
    case 'arches': return `ch ${n('ch')} arches, one per loop`;
    case 'spokes': return `${n('st')} spokes with ch ${n('ch')} between, ${Number(n('per')) * reps} around`;
    case 'clusters': return `${n('legs')}-${n('base')} clusters, ch ${n('ch')} between, ${Number(n('per')) * reps} around`;
    case 'puffs': return `${Number(n('pair')) === 2 ? 'puff pairs' : 'puffs'}, ch ${n('ch')} between, ${Number(n('per')) * reps} around`;
    case 'vstitch': return `V-stitches with ch ${n('gap')} inside, ch ${n('ch')} between, ${Number(n('per')) * reps} around`;
    case 'shells': return `${n('size')} dc per shell${Number(n('gap')) ? ` (ch ${n('gap')} inside)` : ''}, ch ${n('ch')} between, ${Number(n('per')) * reps} shells`;
    case 'petals': return `${n('base')}-cluster petals, ch ${n('gap')} inside, ch ${n('ch')} between`;
    case 'fans': return `${n('size')}-stitch ${n('form') === 'shell' ? 'shells' : 'scallops'}, ${Number(n('per')) * reps} around`;
    case 'picot': return `ch-${n('picot')} picots, ${n('fill')} sc each side, ch ${n('ch')} between`;
    case 'solid': case 'filler': case 'accent':
      return 'inc' in prm && prm.inc !== undefined
        ? `${n('st')} in every stitch, ${n('inc')} increases per repeat${motif === 'accent' ? `, ${n('per')} ${n('kind')} per repeat` : ''}`
        : `${n('st')}, ${n('fill')} per chain into the loops`;
    default: return '';
  }
}

/** Single-parameter changes (or "back to auto") that make planned round `planIndex` flat. */
export function fixesFor(spec: DoilySpec, params: ParamSet, planIndex: number, plan: Plan = planDoily(spec, params)): Fix[] {
  const p = plan.planned[planIndex];
  if (!p || p.aim !== 'flat') return [];
  const now = p.pred;
  if (now.cls === 'flat' && Math.abs(now.e) <= tol()) return [];
  const m = MOTIFS[p.motif];
  const user = userParams(spec, plan, planIndex);
  const fixes: (Fix & { score: number })[] = [];
  for (const d of m.params) {
    if (!(d.key in p.params)) continue;
    const fmt = (v: ParamValue) => (d.format ? d.format(v) : String(v));
    // the user's other pins stay; auto parameters may be re-solved
    const { [d.key]: _drop, ...pins } = user;
    const per = bestPerValue(spec, params, plan, planIndex, pins, d.key);
    for (const x of per.values()) {
      if (String(x.value) === String(p.params[d.key])) continue;
      if (x.pred.cls !== 'flat' || Math.abs(x.pred.e) > tol()) continue;
      const iNow = d.values.findIndex((v) => String(v) === String(p.params[d.key]));
      const iNew = d.values.findIndex((v) => String(v) === String(x.value));
      const dist = iNow >= 0 && iNew >= 0 ? Math.abs(iNow - iNew) : 3;
      const delta = typeof x.value === 'number' && typeof p.params[d.key] === 'number' ? x.value - (p.params[d.key] as number) : 0;
      const text = delta && /per|size|inc|legs/.test(d.key) && !/repeat/i.test(d.label)
        ? `Fix: ${delta > 0 ? 'add' : 'remove'} ${Math.abs(delta)} — ${d.label.toLowerCase()} ${fmt(x.value)}`
        : `Fix: set ${d.label.toLowerCase()} to ${fmt(x.value)}`;
      fixes.push({ key: d.key, label: d.label, value: x.value, text, e: x.pred.e, score: dist + 3 * Math.abs(x.pred.e) + (d.key in user ? 0 : 0.5) });
    }
  }
  if (Object.keys(user).length) {
    // everything back on auto
    const sp: DoilySpec = { ...spec, rounds: spec.rounds.map((r, j) => (j === p.source ? { ...r, params: {} } : r)) };
    const alt = planDoily(sp, params).planned.find((q) => q.source === p.source && !q.auto);
    if (alt && alt.pred.cls === 'flat' && Math.abs(alt.pred.e) <= tol()) {
      fixes.push({ key: '*', label: 'all', value: 'auto', text: 'Fix: put every number of this round back on auto', e: alt.pred.e, score: 4 });
    }
  }
  fixes.sort((a, b) => a.score - b.score || a.text.localeCompare(b.text));
  const seen = new Set<string>();
  return fixes.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true))).slice(0, 3).map(({ score: _s, ...f }) => f);
}

export interface FlatBudget {
  /** Radius the next round starts from, mm. */
  radiusMm: number;
  /** Course length a flat next round of dc height needs, in stitch widths. */
  widths: number;
  perRepeat: number;
  /** The same for a round of sc. */
  scWidths: number;
  scPerRepeat: number;
  /** One chain (in a loop, nominal) counts as this many stitch widths. */
  chainAsWidth: number;
  text: string;
}

/** The course a flat next round needs at radius r (handed on by the round below). */
export function flatBudget(r: number, repeats: number, params: ParamSet): FlatBudget {
  const w = stitchParam(params, 'dc').width;
  const ws = stitchParam(params, 'sc').width;
  const widths = (TAU * (r + stitchParam(params, 'dc').height)) / w;
  const scWidths = (TAU * (r + stitchParam(params, 'sc').height)) / ws;
  const chainAsWidth = (stitchParam(params, 'ch').width * simConfig.flatness.chain_nominal) / w;
  const perRepeat = widths / repeats, scPerRepeat = scWidths / repeats;
  const round1 = (x: number) => (x >= 10 ? Math.round(x) : Math.round(x * 2) / 2);
  return {
    radiusMm: r, widths, perRepeat, scWidths, scPerRepeat, chainAsWidth,
    text: `A flat round here needs ≈ ${Math.round(widths)} stitch-widths of dc (${round1(perRepeat)} per repeat), or ≈ ${Math.round(scWidths)} of sc (${round1(scPerRepeat)} per repeat); a chain in a loop counts as about ${chainAsWidth.toFixed(1)}.`,
  };
}
