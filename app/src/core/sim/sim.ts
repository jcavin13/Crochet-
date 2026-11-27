/**
 * Incremental (interactive) sim: the same growth + relaxation as `simulate`, spread over many
 * short `step(budgetMs)` calls so a UI (or a Web Worker driving one) never blocks. Per-round
 * snapshots are kept, so once a round has been grown, showing it again is instant; blocked
 * solves are cached per round too.
 */
import type { Graph, Pattern } from '../graph';
import { simConfig as defaultConfig, type ParamSet, type SimConfig } from '../params';
import { now } from './lbfgs';
import { setupBlock, type BlockResult, type BlockSetup } from './blocking';
import { shapeMetric, type ShapeMetric } from './metrics';
import { buildNetwork, type Network } from './network';
import { Grower } from './solve';

export interface CreateSimOptions {
  config?: SimConfig;
  /** Initial round to show (0-based). Default: the last. */
  uptoRound?: number;
  blocked?: boolean;
  gtolRound?: number;
  gtolFinal?: number;
  network?: Network;
}

export type SimPhase = 'growing' | 'relaxing' | 'blocking' | 'ready';

export interface BlockSummary {
  verdict: BlockResult['verdict'];
  message: string;
  meanAbsStrain: number;
  maxAbsStrain: number;
  buckleFraction: number;
  converged: boolean;
}

export interface StepResult {
  /** True when the requested state (round, relaxed/blocked) is fully solved. */
  done: boolean;
  energy: number;
  phase: SimPhase;
  /** Rounds relaxed so far (growth progress), and the round being shown. */
  roundsGrown: number;
  shownRound: number;
}

export interface SimHandle {
  readonly network: Network;
  readonly nRounds: number;
  /** [3 nParticles] positions of the shown state (NaN: particle not made yet). Updated by step(). */
  readonly positions: Float32Array;
  step(budgetMs: number): StepResult;
  setUptoRound(r: number): void;
  setBlocked(b: boolean): void;
  /** Shape metric of the shown relaxed state (undefined until solved). */
  metric(): ShapeMetric | undefined;
  /** Blocking summary of the shown round (undefined unless blocked and solved). */
  block(): BlockSummary | undefined;
  /** Per-spring strain |d|/L − 1 of the shown state (NaN where not made). */
  strain(): Float32Array;
  dispose(): void;
}

export function createSim(input: Pattern | Graph, params: ParamSet, opts: CreateSimOptions = {}): SimHandle {
  const cfg = opts.config ?? defaultConfig;
  const net = opts.network ?? buildNetwork(input, params, cfg);
  const nRounds = net.graph.rounds.length;
  const grower = new Grower(net, cfg, { gtolRound: opts.gtolRound, gtolFinal: opts.gtolFinal });
  const positions = new Float32Array(3 * net.nParticles).fill(NaN);
  let target = clampRound(opts.uptoRound ?? nRounds - 1);
  let blocked = !!opts.blocked;
  const blockCache = new Map<number, BlockResult>();
  const metricCache = new Map<number, ShapeMetric>();
  let blockJob: { round: number; setup: BlockSetup } | null = null;
  let shown: Float64Array | null = null;
  let lastEnergy = 0;
  let disposed = false;

  function clampRound(r: number) { return Math.max(0, Math.min(nRounds - 1, Math.floor(r))); }

  /** Relaxed state of round r if available: snapshot (r < last) or final (r = last, after the final pass). */
  function relaxedState(r: number): Float64Array | null {
    if (r === nRounds - 1) return grower.phase === 'done' ? grower.X : null;
    return grower.snapshots[r] ?? null;
  }

  function show(X: Float64Array) {
    shown = X;
    for (let q = 0; q < positions.length; q++) positions[q] = X[q];
  }

  function step(budgetMs: number): StepResult {
    const deadline = now() + Math.max(1, budgetMs);
    const res = (done: boolean, phase: SimPhase): StepResult =>
      ({ done, energy: lastEnergy, phase, roundsGrown: grower.snapshots.length, shownRound: target });
    if (disposed || nRounds === 0) return res(true, 'ready');
    // 1. grow until the target round's relaxed state exists
    let X = relaxedState(target);
    if (!X) {
      grower.advance(deadline);
      lastEnergy = grower.energy;
      X = relaxedState(target);
      if (!X) {
        show(grower.X);
        return res(false, grower.phase === 'final' ? 'relaxing' : 'growing');
      }
    }
    if (!blocked) {
      show(X);
      return res(true, 'ready');
    }
    // 2. blocked state of the target round
    const cached = blockCache.get(target);
    if (cached) { show(cached.positions); lastEnergy = cached.energy; return res(true, 'ready'); }
    if (!blockJob || blockJob.round !== target) blockJob = { round: target, setup: setupBlock(net, X, cfg) };
    const st = blockJob.setup.opt.run(deadline);
    const br = blockJob.setup.finish();
    lastEnergy = br.energy;
    show(br.positions);
    if (st === 'running') return res(false, 'blocking');
    blockCache.set(target, br);
    blockJob = null;
    return res(true, 'ready');
  }

  return {
    network: net,
    nRounds,
    positions,
    step,
    setUptoRound(r: number) { target = clampRound(r); },
    setBlocked(b: boolean) { blocked = b; },
    metric() {
      const X = relaxedState(target);
      if (!X) return undefined;
      let m = metricCache.get(target);
      if (!m) {
        m = shapeMetric(X.subarray(0, 3 * net.nNodes), net.particleRound.subarray(0, net.nNodes), cfg);
        metricCache.set(target, m);
      }
      return m;
    },
    block() {
      if (!blocked) return undefined;
      const b = blockCache.get(target);
      return b && {
        verdict: b.verdict, message: b.message, meanAbsStrain: b.meanAbsStrain, maxAbsStrain: b.maxAbsStrain,
        buckleFraction: b.buckleFraction, converged: b.converged,
      };
    },
    strain() {
      const out = new Float32Array(net.m).fill(NaN);
      const X = shown;
      if (!X) return out;
      for (let s = 0; s < net.m; s++) {
        const a = 3 * net.I[s], b = 3 * net.J[s];
        const d = Math.hypot(X[a] - X[b], X[a + 1] - X[b + 1], X[a + 2] - X[b + 2]);
        out[s] = d / net.L[s] - 1;
      }
      return out;
    },
    dispose() { disposed = true; blockCache.clear(); blockJob = null; },
  };
}
