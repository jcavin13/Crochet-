/**
 * Sim survey: run the app sim on one pattern with the *fast* tolerances (the ones the browser uses
 * for large pieces) and compare it with the analytic count rule. Used by the corpus sim smoke test
 * and by `npm run sim:corpus` (docs/sim_corpus_report.md). Review R1/R12/R22: the disagreement is
 * documented with numbers instead of hidden. Pure; writes nothing.
 */
import type { Pattern } from '../graph';
import { analyzeFlatness, type RoundClass } from '../flatness';
import { paramsFor, simConfig, type ParamSet } from '../params';
import { now } from './lbfgs';
import { shapeMetric } from './metrics';
import { FAST_TOLERANCES } from './sim';
import { simulate } from './solve';

export interface SurveyRow {
  /** analytic class of the last classifiable round */
  analytic: RoundClass;
  /** the last round is flat only with loose (or strained) loops */
  analyticSlackOnly: boolean;
  /** some round closes the shape (far under flat) */
  analyticClosing: boolean;
  /** nominal excess of the last classifiable round */
  analyticE: number;
  sim: 'flat' | 'cup' | 'ruffle';
  A: number;
  W: number;
  /** final pass reached its tolerance */
  converged: boolean;
  /** rounds whose relaxation hit the iteration cap / stalled */
  roundsUnsettled: number;
  nodes: number;
  iterations: number;
  ms: number;
  /** every position of the result is finite */
  finite: boolean;
}

export interface SurveyOptions {
  params?: ParamSet;
  /** default: the fast tolerances (FAST_TOLERANCES) */
  gtolRound?: number;
  gtolFinal?: number;
}

export function surveyPattern(pattern: Pattern, opts: SurveyOptions = {}): SurveyRow {
  const params = opts.params ?? paramsFor(pattern);
  const flat = analyzeFlatness(pattern.graph, params);
  const real = flat.rounds.filter((r) => r.class !== 'n/a');
  const lastA = real[real.length - 1];
  const t0 = now();
  const res = simulate(pattern, params, {
    gtolRound: opts.gtolRound ?? FAST_TOLERANCES.gtolRound,
    gtolFinal: opts.gtolFinal ?? FAST_TOLERANCES.gtolFinal,
  });
  const ms = now() - t0;
  const net = res.network;
  const X = res.positions;
  let finite = true;
  for (let q = 0; q < 3 * net.nNodes; q++) if (!Number.isFinite(X[q])) { finite = false; break; }
  const m = shapeMetric(X.subarray(0, 3 * net.nNodes), net.particleRound.subarray(0, net.nNodes), simConfig);
  return {
    analytic: flat.final,
    analyticSlackOnly: !!lastA?.slackOnly,
    analyticClosing: real.some((r) => r.closing),
    analyticE: lastA?.e ?? 0,
    sim: m.class, A: m.A, W: m.W,
    converged: res.converged,
    roundsUnsettled: res.roundsConverged.filter((c) => !c).length,
    nodes: net.nNodes, iterations: res.iterations, ms, finite,
  };
}
