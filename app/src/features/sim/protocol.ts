// Messages between the main thread and the sim worker (sim.worker.ts). The same driver also runs
// on the main thread when Workers are unavailable (client.ts).
import type { Graph } from '@/core/graph';
import type { ParamSet, SimConfig } from '@/core/params';
import type { BlockSummary, StepResult } from '@/core/sim';

export interface MetricSummary {
  class: 'flat' | 'cup' | 'ruffle';
  A: number; W: number; Rg: number; outer_radius: number;
  axis: [number, number, number];
  centroid: [number, number, number];
}

export type ToWorker =
  | { type: 'init'; job: number; graph: Graph; params: ParamSet; config?: SimConfig; uptoRound: number; blocked: boolean }
  | { type: 'upto'; job: number; round: number }
  | { type: 'blocked'; job: number; blocked: boolean }
  | { type: 'dispose'; job: number };

export interface SimFrame {
  job: number;
  /** [3 nParticles] positions of the shown state; NaN = not made yet. */
  positions: Float32Array;
  /** Per-spring strain of the shown state (sent when the state is solved). */
  strain?: Float32Array;
  step: StepResult;
  metric?: MetricSummary;
  block?: BlockSummary;
  /** ms spent in step() for this frame. */
  ms: number;
  /** Did the shown state settle to the solver tolerance (sent when solved)? */
  converged?: boolean;
  /** Solver tolerances in use (see core/sim createSim). */
  accuracy: 'reference' | 'fast';
}

export type FromWorker = ({ type: 'frame' } & SimFrame) | { type: 'error'; job: number; message: string };
