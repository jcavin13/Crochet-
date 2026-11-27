/**
 * generateDoily(spec, params): the flatness-aware solver.
 *
 * Round by round: make sure the motif can be worked onto the current interface (otherwise insert
 * the transition round it needs: a centre into the ring, a chain-loop mesh to open solid fabric,
 * a straightening round to close lace), enumerate the motif's candidates, predict each one's
 * flatness from its sector entries (predict.ts), and keep the best:
 *
 *   score = shapeCost + 0.1 · styleCost
 *   shapeCost (aim flat)   = |e|                         if the round is flat, else 10 + distance
 *   shapeCost (aim ruffle) = |eMin − (tol + amount)|     (+10 unless it ruffles)
 *   shapeCost (aim cup)    = |eMax + (tol + amount)|     (+10 unless it cups)
 *
 * Then the text is compiled with the real compiler and checked with the real analyzeFlatness;
 * what the result reports (per-round e and class) comes from those, not from the predictor.
 */
import { compilePattern } from '../notation';
import { analyzeFlatness } from '../flatness';
import { simConfig, stitchParam, type ParamSet } from '../params';
import type { Pattern } from '../graph';
import { countAnnotation, picotCount, sectorEntries, writeRound } from './emit';
import { MOTIFS, spaceSlots, type Candidate, type MotifCtx } from './motifs';
import { predictRound, startState, type FlatState, type Prediction } from './predict';
import type {
  DoilySpec, Entry, GeneratedRound, GenerateResult, Height, Iface, MotifId, RoundParams, RoundSpec,
} from './types';

export const MIN_SYMMETRY = 3;
export const MAX_SYMMETRY = 24;
/** Candidates of a round re-scored by how well the next round can follow them. */
const LOOKAHEAD = 10;

interface Planned {
  motif: MotifId;
  params: RoundParams;
  auto: boolean;
  cand: Candidate;
  pred: Prediction;
  entries: Iface['entries'];
  iface: Iface;
  aim: GeneratedRound['aim'];
  prevLead: number;
  /** Index into spec.rounds of the user round this was made for (transitions: the round they serve). */
  source: number;
  autoReason?: GeneratedRound['autoReason'];
}

const NUMBER_WORDS = ['', '', '', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty', 'Twenty-one', 'Twenty-two', 'Twenty-three', 'Twenty-four'];

export function defaultTitle(spec: DoilySpec): string {
  const n = spec.symmetry;
  const word = NUMBER_WORDS[n] ?? String(n);
  const motifs = new Set(spec.rounds.map((r) => r.motif));
  const kind = motifs.has('petals') ? 'petal' : motifs.has('shells') ? 'shell' : motifs.has('clusters') ? 'cluster'
    : motifs.has('fans') ? 'scallop' : motifs.has('arches') || motifs.has('mesh') ? 'lace' : 'round';
  return `${word}-point ${kind} doily`;
}

function scoreOf(pred: Prediction, aim: GeneratedRound['aim'], amount: number): number {
  const tol = simConfig.flatness.tol;
  if (aim === 'ruffle') return Math.abs(pred.eMin - (tol + amount)) + (pred.cls === 'ruffle' ? 0 : 10);
  if (aim === 'cup') return Math.abs(pred.eMax + (tol + amount)) + (pred.cls === 'cup' ? 0 : 10);
  if (pred.cls === 'flat') return Math.abs(pred.e);
  return 10 + (pred.cls === 'cup' ? -tol - pred.eMax : pred.eMin - tol);
}

function ifaceOf(entries: Iface['entries']): Iface {
  return { kind: entries.some((e) => e.kind === 'sp') ? 'lace' : 'solid', entries };
}

/** The transition a motif needs on this interface, if any. */
function transitionFor(motif: MotifId, iface: Iface): MotifId | null {
  const m = MOTIFS[motif];
  if (m.accepts.includes(iface.kind)) return null;
  if (iface.kind === 'ring') return 'centre';
  if (iface.kind === 'solid') return 'mesh';
  return 'filler';
}

export interface SolveOptions {
  /** Restrict to the first k user rounds (used by the random sampler to grow designs). */
  maxRounds?: number;
}

export interface Plan { planned: Planned[]; warnings: string[]; ringChains: number; score: number; overrides: Map<number, number> }

const missed = (p: Planned) => p.pred.cls !== (p.aim === 'cup' ? 'cup' : p.aim);

/**
 * Plan all rounds (no compile). Greedy with one-step lookahead; when a round still misses its aim,
 * backtrack: re-plan with the 2nd…6th choice at the round before it (or at it, or two before) and
 * keep the plan with the fewest missed rounds. Exposed for the random sampler and tests.
 */
export function planDoily(spec: DoilySpec, params: ParamSet): Plan {
  let best = planOnce(spec, params, new Map());
  const bad = (pl: Plan) => pl.planned.filter(missed).length;
  const better = (a: Plan, b: Plan) => bad(a) < bad(b) || (bad(a) === bad(b) && a.score < b.score - 1e-9);
  for (let tries = 0; tries < 3 && bad(best) > 0; tries++) {
    const j = best.planned.findIndex(missed);
    let improved = false;
    for (const step of [j - 1, j, j - 2]) {
      if (step < 0) continue;
      for (let r = 1; r <= 5; r++) {
        const ov = new Map(best.overrides);
        ov.set(step, r);
        const cand = planOnce(spec, params, ov);
        if (better(cand, best)) { best = cand; improved = true; }
      }
      if (improved) break;
    }
    if (!improved) break;
  }
  return best;
}

function planOnce(spec: DoilySpec, params: ParamSet, overrides: Map<number, number>): Plan {
  const n = Math.round(Math.min(MAX_SYMMETRY, Math.max(MIN_SYMMETRY, spec.symmetry)));
  const warnings: string[] = [];
  if (n !== spec.symmetry) warnings.push(`Symmetry ${spec.symmetry} is outside ${MIN_SYMMETRY}–${MAX_SYMMETRY}; using ${n}.`);
  const heights: Height[] = spec.style?.heights?.length ? spec.style.heights : ['sc', 'hdc', 'dc', 'tr'];
  const lacy = spec.style?.lacy ?? 0.5;
  const target = spec.target ?? { shape: 'flat' };
  const offRounds = target.shape === 'flat' ? 0 : Math.max(1, target.rounds ?? 2);
  const amount = target.amount ?? 0.15;

  // expand: every user round, with transitions inserted where the interface demands one
  const user: RoundSpec[] = spec.rounds.length ? spec.rounds : [{ motif: 'centre' }];
  const planned: Planned[] = [];
  let iface: Iface = { kind: 'ring', entries: [] };
  let state: FlatState = startState(params, 0);
  let ringChains = 0;
  let score = 0;
  const total = user.length;

  type Scored = { c: Candidate; p: Prediction; s: number; entries: Entry[] };
  const aimFor = (userIndex: number, auto: boolean): GeneratedRound['aim'] =>
    offRounds && total - 1 - userIndex < offRounds && !auto ? (target.shape === 'ruffle' ? 'ruffle' : 'cup') : 'flat';

  /** Every candidate of a round, scored (lower is better). */
  const scoreAll = (rs: RoundSpec, aim: GeneratedRound['aim'], ifc: Iface, st: FlatState, index: number, prev?: { motif: MotifId; params: RoundParams }): Scored[] => {
    const ctx: MotifCtx = { prev: ifc, repeats: n, index, heights, lacy, prevMotif: prev?.motif, prevParams: prev?.params, params };
    const out: Scored[] = [];
    for (const c of MOTIFS[rs.motif].candidates(ctx, rs.params ?? {})) {
      const entries = sectorEntries(c.ops);
      if (!entries.some((e) => e.kind === 'st')) continue;
      const p = predictRound(entries, n, index === 0 ? startState(params, c.ringChains ?? 0) : st, params);
      let pref = 0;
      for (const [k, v] of Object.entries(rs.prefer ?? {})) if (k in c.params && c.params[k] !== v) pref += 1;
      out.push({ c, p, s: scoreOf(p, aim, amount) + 0.1 * (c.cost + pref), entries });
    }
    return out.sort((x, y) => x.s - y.s);
  };

  /** The round that will follow this one (for the one-step lookahead). */
  const following = (userIndex: number, auto: boolean): { rs: RoundSpec; aim: GeneratedRound['aim'] } | undefined => {
    for (let j = auto ? userIndex : userIndex + 1; j < total; j++) {
      const r = user[j];
      if (MOTIFS[r.motif] && r.motif !== 'centre') return { rs: r, aim: aimFor(j, false) };
    }
    return undefined;
  };

  const place = (rs: RoundSpec, auto: boolean, userIndex: number, autoReason?: GeneratedRound['autoReason']): boolean => {
    const aim = aimFor(userIndex, auto);
    const prev = planned[planned.length - 1];
    const list = scoreAll(rs, aim, iface, state, planned.length, prev);
    if (!list.length) return false;
    // one-step lookahead: among the best few distinct candidates, rank by own score plus the best
    // score the next round can reach on top of it
    const nxt = following(userIndex, auto);
    const ranked: { cand: Scored; comb: number }[] = [];
    const seen = new Set<string>();
    for (const cand of list) {
      if (seen.size >= LOOKAHEAD) break;
      const key = JSON.stringify(cand.entries) + cand.p.r.toFixed(3);
      if (seen.has(key)) continue;
      seen.add(key);
      let comb = cand.s;
      if (nxt) {
        const ifc = ifaceOf(cand.entries);
        const tr = transitionFor(nxt.rs.motif, ifc);
        const look = tr ? { motif: tr } : nxt.rs;
        const nl = scoreAll(look, tr ? 'flat' : nxt.aim, ifc, cand.p.next, planned.length + 1, { motif: rs.motif, params: cand.c.params });
        comb += nl.length ? nl[0].s : 100;
      }
      ranked.push({ cand, comb });
    }
    ranked.sort((a, b) => a.comb - b.comb);
    const pick = ranked[Math.min(ranked.length - 1, overrides.get(planned.length) ?? 0)];
    const best = pick.cand;
    score += best.s;
    if (planned.length === 0) ringChains = best.c.ringChains ?? 0;
    const lead = iface.kind === 'lace' ? spaceSlots(iface.entries).leading : 0;
    iface = ifaceOf(best.entries);
    state = best.p.next;
    planned.push({ motif: rs.motif, params: best.c.params, auto, cand: best.c, pred: best.p, entries: best.entries, iface, aim, prevLead: lead, source: userIndex, autoReason });
    return true;
  };

  const limit = spec.rounds.length ? total : 1;
  for (let i = 0; i < limit; i++) {
    const rs = user[i];
    if (!MOTIFS[rs.motif]) { warnings.push(`Round ${i + 1}: unknown motif "${rs.motif}" — skipped.`); continue; }
    if (i > 0 && rs.motif === 'centre') { warnings.push(`Round ${i + 1}: a centre can only start the doily — skipped.`); continue; }
    const tr = transitionFor(rs.motif, iface);
    if (tr) {
      place({ motif: tr }, true, i, tr === 'mesh' ? 'spaces' : tr === 'filler' ? 'stitches' : undefined);
      if (tr !== 'centre') warnings.push(`${MOTIFS[rs.motif].label} needs ${tr === 'mesh' ? 'chain spaces' : 'stitches'} to work into, so a ${tr === 'mesh' ? 'chain-loop mesh' : 'straightening'} round was added before it.`);
    }
    if (place(rs, false, i)) continue;
    // no candidate fits this interface (e.g. alternating motifs on an odd number of spaces):
    // open the fabric with a mesh round and try again
    if (place({ motif: 'mesh' }, true, i, 'fit') && place(rs, false, i)) {
      warnings.push(`${MOTIFS[rs.motif].label} did not fit the round below, so a chain-loop mesh round was added before it.`);
      continue;
    }
    warnings.push(`Round ${i + 1} (${MOTIFS[rs.motif].label}): no way to work it here with these settings — skipped.`);
  }
  return { planned, warnings, ringChains, score, overrides };
}

/** Rough yarn per node, mm: about 2 × (width + height) of the stitch it makes. */
function yarnOf(pattern: Pattern, params: ParamSet): number {
  let mm = 0;
  for (const nd of pattern.graph.nodes) {
    const sp = stitchParam(params, nd.type);
    let f = 2 * (sp.width + sp.height);
    if (nd.type === 'picot') { const ch = stitchParam(params, 'ch'); f = (nd.chains ?? 3) * 2 * (ch.width + ch.height); }
    if (nd.tag === 'cluster' || nd.into.length > 1) f *= 0.75 * Math.max(1, nd.into.length);
    if (nd.type === 'popcorn') f *= nd.legs ?? 5;
    if (nd.type === 'puff') f *= 0.8 * (nd.loops ?? 3);
    mm += f;
  }
  return mm / 1000;
}

export function generateDoily(spec: DoilySpec, params: ParamSet): GenerateResult {
  const terms = spec.terms ?? 'US';
  const { planned, warnings, ringChains } = planDoily(spec, params);
  const n = Math.round(Math.min(MAX_SYMMETRY, Math.max(MIN_SYMMETRY, spec.symmetry)));
  const title = spec.title?.trim() || defaultTitle({ ...spec, symmetry: n });

  const lines: string[] = [];
  lines.push('# Generated by the doily designer. Edit freely: it is ordinary notation.');
  lines.push(`title: ${title}`);
  lines.push(`terms: ${terms}`);
  lines.push(`hook: ${params.hook_mm}mm`);
  lines.push(`params: ${params.id}`);
  lines.push(`source: generated by the designer (${spec.seed !== undefined ? `seed ${spec.seed}` : 'guided'}, ${n}-fold)`);
  lines.push('license: CC0-1.0');
  const shapeNote = spec.target && spec.target.shape !== 'flat'
    ? ` Intended shape: ${spec.target.shape === 'ruffle' ? 'ruffled edge' : 'bowl'} (last ${Math.max(1, spec.target.rounds ?? 2)} rounds deliberately ${spec.target.shape === 'ruffle' ? 'over' : 'under'}).`
    : ' Intended shape: flat.';
  lines.push(`notes: ${spec.notes ? spec.notes + ' ' : ''}${planned.map((p) => MOTIFS[p.motif].label.toLowerCase()).join(', ')}.${shapeNote}`);
  lines.push('');

  const roundLines: string[] = [];
  planned.forEach((p, i) => {
    const body = writeRound({
      sector: p.cand.ops, repeats: n, terms, prevLead: p.prevLead,
      ring: i === 0 ? { chains: ringChains } : undefined, fastenOff: i === planned.length - 1,
    });
    const count = countAnnotation(p.entries, n, terms, picotCount(p.cand.ops));
    roundLines.push(`Rnd ${i + 1}: ${body}. ${count}`);
  });
  const text = [...lines, ...roundLines].join('\n') + '\n';

  const compiled = compilePattern(text);
  const diagnostics = compiled.diagnostics
    .filter((d) => d.severity !== 'info')
    .map((d) => ({ severity: d.severity, code: d.code, message: d.message }));
  for (const d of diagnostics) warnings.push(`Compiler ${d.severity}: ${d.message}`);
  const pattern = compiled.pattern;
  const flatness = pattern ? analyzeFlatness(pattern.graph, params) : undefined;

  const rounds: GeneratedRound[] = planned.map((p, i) => {
    const f = flatness?.rounds[i];
    const gr = pattern?.graph.rounds[i];
    return {
      number: i + 1, motif: p.motif, params: p.params, auto: p.auto || undefined, autoReason: p.autoReason, source: p.source,
      e: f?.e ?? p.pred.e, eMin: f?.eMin ?? p.pred.eMin, eMax: f?.eMax ?? p.pred.eMax,
      class: f?.class ?? p.pred.cls, aim: p.aim,
      stitches: gr?.stitchCount ?? p.entries.filter((e) => e.kind === 'st').length * n,
      spaces: p.entries.filter((e) => e.kind === 'sp').length * n,
      message: f?.message ?? '',
      text: roundLines[i],
    };
  });
  for (const r of rounds) {
    const want = r.aim === 'cup' ? 'cup' : r.aim;
    if (r.class !== want && r.class !== 'n/a') {
      warnings.push(r.aim === 'flat'
        ? `${r.message} (closest the ${MOTIFS[r.motif].label.toLowerCase()} motif gets with these settings).`
        : `Rnd ${r.number} was meant to ${r.aim === 'ruffle' ? 'ruffle' : 'cup'} but is ${r.class}.`);
    }
  }

  const last = flatness?.rounds[flatness.rounds.length - 1];
  const stats = {
    rounds: rounds.length,
    stitches: rounds.reduce((a, r) => a + r.stitches, 0),
    chains: pattern ? pattern.graph.nodes.filter((nd) => nd.type === 'ch').length : 0,
    diameterMm: 2 * (last?.r ?? planned[planned.length - 1]?.pred.r ?? 0),
    yarnM: pattern ? yarnOf(pattern, params) : 0,
  };
  return { text, pattern, flatness, rounds, warnings, stats, diagnostics };
}
