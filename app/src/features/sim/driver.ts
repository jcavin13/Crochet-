// Drives a core SimHandle in slices and reports frames. Used inside the worker and, as a fallback,
// on the main thread. No React, no DOM beyond timers.
import { createSim, type SimHandle } from '@/core/sim';
import type { MetricSummary, SimFrame, ToWorker } from './protocol';

export interface DriverOptions {
  /** ms of work per slice. */
  budget: number;
  /** schedule the next slice (setTimeout in a worker, requestAnimationFrame on the main thread). */
  schedule: (fn: () => void) => void;
  emit: (f: SimFrame) => void;
  error: (job: number, message: string) => void;
}

export function createDriver(o: DriverOptions) {
  let sim: SimHandle | null = null;
  let job = -1;
  let running = false;
  let lastSent = 0;

  const metricOf = (s: SimHandle): MetricSummary | undefined => {
    const m = s.metric();
    return m && { class: m.class, A: m.A, W: m.W, Rg: m.Rg, outer_radius: m.outer_radius, axis: m.axis, centroid: m.centroid };
  };

  function pump() {
    if (!sim) { running = false; return; }
    const t0 = performance.now();
    let st;
    try {
      st = sim.step(o.budget);
    } catch (e) {
      running = false;
      o.error(job, e instanceof Error ? e.message : String(e));
      return;
    }
    const ms = performance.now() - t0;
    const t = performance.now();
    // throttle intermediate frames to ~30/s; always send the finished state
    if (st.done || t - lastSent > 30) {
      lastSent = t;
      o.emit({
        job, positions: Float32Array.from(sim.positions), step: st, ms,
        strain: st.done ? sim.strain() : undefined,
        metric: st.done ? metricOf(sim) : undefined,
        block: st.done ? sim.block() : undefined,
      });
    }
    if (st.done) { running = false; return; }
    o.schedule(pump);
  }
  function kick() { if (!running && sim) { running = true; o.schedule(pump); } }

  return {
    handle(msg: ToWorker) {
      if (msg.type === 'init') {
        sim?.dispose();
        job = msg.job;
        try {
          sim = createSim(msg.graph, msg.params, { config: msg.config, uptoRound: msg.uptoRound, blocked: msg.blocked });
        } catch (e) {
          sim = null;
          o.error(job, e instanceof Error ? e.message : String(e));
          return;
        }
        kick();
        return;
      }
      if (msg.job !== job || !sim) return;
      if (msg.type === 'upto') { sim.setUptoRound(msg.round); kick(); }
      else if (msg.type === 'blocked') { sim.setBlocked(msg.blocked); kick(); }
      else if (msg.type === 'dispose') { sim.dispose(); sim = null; }
    },
  };
}
