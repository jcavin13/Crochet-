/**
 * Suggestions for the layer builder: what to add next, given the doily so far.
 *
 *   suggestNext(spec, params, { targetCm })
 *     .motifs         every motif that can follow the current outer round, ranked; each solved for
 *                     flatness on top of the real doily, with its preview, flatness, growth in
 *                     diameter and a one-line reason ("fits your ch-5 loops; keeps 12-fold")
 *     .finish         2–3 edgings that finish the piece
 *     .continuations  three complete next-3-round continuations: lacy, solid, dramatic edge
 *
 * Deterministic: the same spec, parameter set and target always give the same list in the same order.
 */
import type { ParamSet } from '../params';
import { simConfig } from '../params';
import { planDoily, MAX_SYMMETRY, type Plan } from './generate';
import { MOTIFS, MOTIF_ORDER, spaceSlots } from './motifs';
import { GRAMMAR } from './random';
import type { DoilySpec, Entry, MotifId, RoundSpec } from './types';

export interface PreviewRound {
  motif: MotifId;
  entries: Entry[];
  reps: number;
  rho: number;
  r: number;
  cls: 'flat' | 'cup' | 'ruffle';
  /** A round this suggestion adds. */
  added: boolean;
  auto: boolean;
}

export interface Suggestion {
  id: string;
  kind: 'motif' | 'finish' | 'continuation';
  label: string;
  style?: 'lacy' | 'solid' | 'dramatic';
  /** Rounds to append to spec.rounds. */
  add: RoundSpec[];
  /** The motif needs a transition round first (the solver inserts it; `add` already lists it). */
  transition?: MotifId;
  reason: string;
  /** Every added round hits its aim. */
  flat: boolean;
  /** Excess of the worst added round (nominal). */
  e: number;
  growthMm: number;
  diameterMm: number;
  overTarget: boolean;
  preview: PreviewRound[];
  score: number;
}

export interface SuggestOptions {
  /** Wanted finished diameter (cm); suggestions that overshoot it rank lower. */
  targetCm?: number;
}

export interface Suggestions {
  motifs: Suggestion[];
  finish: Suggestion[];
  continuations: Suggestion[];
  /** Plain words about the current outer round ("12 ch-5 loops, 12-fold"). */
  outer: string;
}

export function previewOf(plan: Plan, firstAdded = Infinity): PreviewRound[] {
  return plan.planned.map((p, i) => ({
    motif: p.motif, entries: p.entries, reps: p.reps, rho: p.pred.rho, r: p.pred.r, cls: p.pred.cls,
    added: i >= firstAdded, auto: p.auto,
  }));
}

const missed = (p: Plan['planned'][number]) => p.pred.cls !== (p.aim === 'cup' ? 'cup' : p.aim);

function describeOuter(plan: Plan): { text: string; loops?: number; stitches: number; reps: number } {
  const last = plan.planned[plan.planned.length - 1];
  if (!last) return { text: 'nothing yet', stitches: 0, reps: 0 };
  const { slots } = spaceSlots(last.entries);
  const sts = last.entries.filter((e) => e.kind === 'st').length * last.reps;
  if (!slots.length) return { text: `${sts} stitches, ${last.reps}-fold`, stitches: sts, reps: last.reps };
  const lens = [...new Set(slots.map((s) => s.len))].sort((a, b) => b - a);
  return {
    text: `${slots.length * last.reps} ch-${lens.join('/ch-')} loops, ${last.reps}-fold`,
    loops: lens[0], stitches: sts, reps: last.reps,
  };
}

function evaluate(spec: DoilySpec, params: ParamSet, add: RoundSpec[], base: Plan, opts: SuggestOptions) {
  const sp: DoilySpec = { ...spec, rounds: [...spec.rounds, ...add] };
  const plan = planDoily(sp, params);
  const first = plan.planned.findIndex((p) => p.source >= spec.rounds.length);
  const added = first < 0 ? [] : plan.planned.slice(first);
  const prevR = base.planned[base.planned.length - 1]?.pred.r ?? 0;
  const lastR = plan.planned[plan.planned.length - 1]?.pred.r ?? 0;
  // the rounds already there may shift a little when the lookahead sees a new neighbour
  const allOk = plan.planned.every((p) => !missed(p));
  const worst = added.reduce((w, p) => (Math.abs(p.pred.e) > Math.abs(w) ? p.pred.e : w), 0);
  const diameterMm = 2 * lastR;
  const overTarget = !!opts.targetCm && diameterMm / 10 > opts.targetCm * 1.05;
  const skipped = plan.warnings.some((w) => /skipped/.test(w));
  return {
    plan, added, flat: allOk && added.length > 0 && !skipped, e: worst, growthMm: 2 * (lastR - prevR), diameterMm, overTarget,
    preview: previewOf(plan, first < 0 ? plan.planned.length : first),
    transition: added.find((p) => p.auto)?.motif,
  };
}

const fmtCm = (mm: number) => `${(mm / 10).toFixed(1)} cm`;

function targetCost(diameterMm: number, opts: SuggestOptions): number {
  if (!opts.targetCm) return 0;
  const over = diameterMm / 10 - opts.targetCm * 1.05;
  return over > 0 ? 3 + over : 0;
}

/** Ranked suggestions for the round(s) to add next. */
export function suggestNext(spec: DoilySpec, params: ParamSet, opts: SuggestOptions = {}): Suggestions {
  const base = planDoily(spec, params);
  const outer = describeOuter(base);
  const last = base.planned[base.planned.length - 1];
  const tol = simConfig.flatness.tol;
  const order = `keeps ${last?.reps ?? spec.symmetry}-fold`;

  if (!spec.rounds.length || !last) {
    const centres: { label: string; params: RoundSpec['params']; why: string }[] = [
      { label: 'Solid dc centre', params: { style: 'solid', st: 'dc' }, why: 'a closed disc to build on' },
      { label: 'Spoked centre', params: { style: 'spoked', st: 'dc' }, why: 'spokes with chain spaces — lace from round 2' },
      { label: 'Solid sc centre', params: { style: 'solid', st: 'sc' }, why: 'a small, firm start' },
    ];
    const motifs = centres.map((c, i) => {
      const ev = evaluate({ ...spec, rounds: [] }, params, [{ motif: 'centre', params: c.params }], base, opts);
      return {
        id: `centre-${i}`, kind: 'motif' as const, label: c.label, add: [{ motif: 'centre' as MotifId, params: c.params }],
        reason: `${c.why}; ${spec.symmetry}-fold`, flat: ev.flat, e: ev.e, growthMm: ev.growthMm, diameterMm: ev.diameterMm,
        overTarget: ev.overTarget, preview: ev.preview, score: i,
      };
    });
    return { motifs, finish: [], continuations: [], outer: outer.text };
  }

  // ---- single motifs
  const lastTwo = spec.rounds.slice(-2).map((r) => r.motif);
  const motifs: Suggestion[] = [];
  for (const id of MOTIF_ORDER) {
    if (id === 'centre') continue;
    const m = MOTIFS[id];
    const kind = last.iface.kind;
    const tr: MotifId | undefined = m.accepts.includes(kind) ? undefined : kind === 'solid' ? 'mesh' : 'filler';
    const add: RoundSpec[] = tr ? [{ motif: tr }, { motif: id }] : [{ motif: id }];
    const ev = evaluate(spec, params, add, base, opts);
    if (!ev.added.length || !ev.added.some((p) => p.motif === id)) continue;
    const fits = tr
      ? `needs ${tr === 'mesh' ? 'chain loops' : 'stitches'} to work into — a ${tr === 'mesh' ? 'chain-loop mesh' : 'straightening'} round goes first`
      : kind === 'lace'
        ? `fits your ch-${outer.loops} loops`
        : `works into your ${outer.stitches} stitches`;
    const edge = m.texture === 'edge' ? '; a finishing edge' : '';
    const grammar = GRAMMAR[last.motif]?.[id] ?? 0;
    const flatWord = ev.flat ? (Math.abs(ev.e) <= tol ? '' : ' (loose loops)') : '; will not lie flat here';
    const score = (ev.flat ? 0 : 10) + 2 * Math.abs(ev.e) + (tr ? 0.6 : 0) + targetCost(ev.diameterMm, opts)
      + (lastTwo.length === 2 && lastTwo.every((x) => x === id) ? 0.8 : 0) + (m.texture === 'edge' ? 0.3 : 0) - 0.08 * grammar;
    motifs.push({
      id: `motif-${id}`, kind: 'motif', label: m.label, add, transition: tr,
      reason: `${fits}; ${order}${edge}${flatWord}`,
      flat: ev.flat, e: ev.e, growthMm: ev.growthMm, diameterMm: ev.diameterMm, overTarget: ev.overTarget, preview: ev.preview, score,
    });
  }
  motifs.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));

  // ---- finishing edges
  const edges: { label: string; add: RoundSpec[]; why: string }[] = [
    { label: 'Picot edge', add: [{ motif: 'picot' }], why: 'the classic finish: sc and a picot in every loop' },
    { label: 'Scalloped edge', add: [{ motif: 'fans', params: { form: 'scallop' } }], why: 'graduated scallops, a soft rounded rim' },
    { label: 'Shells + picots', add: [{ motif: 'fans', params: { form: 'shell' } }, { motif: 'picot' }], why: 'shell fans, then picots on top — a richer border' },
    { label: 'Loops + picots', add: [{ motif: 'mesh' }, { motif: 'picot' }], why: 'one more ring of loops, then picots — light and lacy' },
  ];
  const finish = edges.map((x, i) => {
    const ev = evaluate(spec, params, x.add, base, opts);
    return {
      id: `finish-${i}`, kind: 'finish' as const, label: x.label, add: x.add, transition: ev.transition,
      reason: `${x.why}; ${order}${ev.transition ? '; a transition round is added' : ''}`,
      flat: ev.flat, e: ev.e, growthMm: ev.growthMm, diameterMm: ev.diameterMm, overTarget: ev.overTarget, preview: ev.preview,
      score: (ev.flat ? 0 : 10) + 2 * Math.abs(ev.e) + targetCost(ev.diameterMm, opts) + 0.15 * i,
    };
  }).sort((a, b) => a.score - b.score || a.id.localeCompare(b.id)).slice(0, 3);

  // ---- next three rounds, three styles
  const lace = last.iface.kind === 'lace';
  const styles: { style: Suggestion['style'] & string; label: string; why: string; options: RoundSpec[][] }[] = [
    {
      style: 'lacy', label: 'Lacy', why: 'open loops that keep the doily light',
      options: lace
        ? [[{ motif: 'mesh' }, { motif: 'arches' }, { motif: 'mesh' }], [{ motif: 'vstitch' }, { motif: 'mesh' }, { motif: 'arches' }], [{ motif: 'arches' }, { motif: 'shells', params: { gap: 1 } }, { motif: 'mesh' }]]
        : [[{ motif: 'spokes' }, { motif: 'mesh' }, { motif: 'arches' }], [{ motif: 'mesh' }, { motif: 'arches' }, { motif: 'mesh' }], [{ motif: 'vstitch' }, { motif: 'mesh' }, { motif: 'vstitch' }]],
    },
    {
      style: 'solid', label: 'Solid', why: 'closed bands with texture — a firm, dense ring',
      options: lace
        ? [[{ motif: 'filler' }, { motif: 'solid' }, { motif: 'accent', params: { kind: 'puff' } }], [{ motif: 'filler' }, { motif: 'accent', params: { kind: 'pc' } }, { motif: 'solid' }], [{ motif: 'shells', params: { gap: 0 } }, { motif: 'filler' }, { motif: 'solid' }]]
        : [[{ motif: 'solid' }, { motif: 'accent', params: { kind: 'pc' } }, { motif: 'solid' }], [{ motif: 'solid' }, { motif: 'solid' }, { motif: 'accent', params: { kind: 'puff' } }], [{ motif: 'accent', params: { kind: 'bobble' } }, { motif: 'solid' }, { motif: 'solid' }]],
    },
    {
      style: 'dramatic', label: 'Dramatic edge', why: 'big motifs and a bold finished rim',
      options: lace
        ? [[{ motif: 'petals', params: { base: 'tr' } }, { motif: 'mesh' }, { motif: 'fans', params: { form: 'scallop' } }], [{ motif: 'shells', params: { alt: 1 } }, { motif: 'mesh' }, { motif: 'fans', params: { form: 'scallop' } }], [{ motif: 'mesh' }, { motif: 'petals' }, { motif: 'picot' }]]
        : [[{ motif: 'spokes', params: { st: 'tr' } }, { motif: 'shells' }, { motif: 'fans', params: { form: 'scallop' } }], [{ motif: 'mesh' }, { motif: 'petals', params: { base: 'tr' } }, { motif: 'picot' }], [{ motif: 'shells', params: { alt: 1 } }, { motif: 'shells', params: { gap: 2 } }, { motif: 'fans', params: { form: 'shell' } }]],
    },
  ];
  const continuations: Suggestion[] = styles.map((st) => {
    let best: Suggestion | null = null;
    st.options.forEach((add, k) => {
      const ev = evaluate(spec, params, add, base, opts);
      const score = (ev.flat ? 0 : 10) + 2 * Math.abs(ev.e) + targetCost(ev.diameterMm, opts) + 0.05 * k + (ev.transition ? 0.3 : 0);
      const cand: Suggestion = {
        id: `cont-${st.style}-${k}`, kind: 'continuation', style: st.style, label: `${st.label}: ${add.map((r) => MOTIFS[r.motif].label.toLowerCase()).join(' → ')}`,
        add, transition: ev.transition, reason: `${st.why}; +${fmtCm(ev.growthMm)} across; ${order}`,
        flat: ev.flat, e: ev.e, growthMm: ev.growthMm, diameterMm: ev.diameterMm, overTarget: ev.overTarget, preview: ev.preview, score,
      };
      if (!best || cand.score < best.score) best = cand;
    });
    return best!;
  });

  return { motifs, finish, continuations, outer: outer.text };
}

/** Symmetry orders reachable from n without changing the design's character, in [3, MAX]. */
export function compatibleOrders(n: number, max = MAX_SYMMETRY): { divisors: number[]; multiples: number[] } {
  const divisors: number[] = [], multiples: number[] = [];
  for (let d = 3; d < n; d++) if (n % d === 0) divisors.push(d);
  for (let m = 2 * n; m <= max; m += n) multiples.push(m);
  return { divisors, multiples };
}

/** Where `double: true` is possible: the planned round before it splits into two equal halves. */
export { halveEntries } from './generate';
