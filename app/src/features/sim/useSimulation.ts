// React hook: runs the incremental spring sim in a Web Worker (main-thread fallback) and exposes
// the latest frame. The worker keeps per-round snapshots, so scrubbing rounds is instant once grown.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pattern } from '@/core/graph';
import { simConfig, type ParamSet } from '@/core/params';
import { buildNetwork, type BlockPin, type Network } from '@/core/sim';
import { createDriver } from './driver';
import type { FromWorker, SimFrame, ToWorker } from './protocol';

export type SimMode = 'worker' | 'main';

export interface SimulationState {
  network: Network | null;
  error: string | null;
  frame: SimFrame | null;
  /** Where the sim runs. */
  mode: SimMode;
}

interface Client {
  send(m: ToWorker): void;
  dispose(): void;
  mode: SimMode;
}

let jobSeq = 0;

function mainThreadClient(onMsg: (m: FromWorker) => void): Client {
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: () => void) => setTimeout(fn, 16);
  let alive = true;
  const driver = createDriver({
    budget: 8,
    schedule: (fn) => raf(() => { if (alive) fn(); }),
    emit: (f) => onMsg({ type: 'frame', ...f }),
    error: (job, message) => onMsg({ type: 'error', job, message }),
  });
  return { send: (m) => driver.handle(m), dispose: () => { alive = false; }, mode: 'main' };
}

function workerClient(onMsg: (m: FromWorker) => void, onFail: () => void): Client | null {
  if (typeof Worker === 'undefined') return null;
  try {
    const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module', name: 'spring-sim' });
    w.onmessage = (e: MessageEvent<FromWorker>) => onMsg(e.data);
    w.onerror = (e) => { e.preventDefault?.(); onFail(); };
    return { send: (m) => w.postMessage(m), dispose: () => w.terminate(), mode: 'worker' };
  } catch {
    return null;
  }
}

export interface SimulationOptions {
  /** Grow flat and rest on a table (viewer option, see core/sim/table.ts). */
  table?: boolean;
  /** Explicit pins for the blocked state (see core/sim BlockPin). */
  pins?: BlockPin[];
}

export function useSimulation(pattern: Pattern, params: ParamSet, uptoRound: number | undefined, blocked: boolean, opts: SimulationOptions = {}): SimulationState {
  const graph = pattern.graph;
  const { network, error: buildError } = useMemo(() => {
    try {
      return { network: buildNetwork(graph, params, simConfig), error: null };
    } catch (e) {
      return { network: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [graph, params]);
  const [frame, setFrame] = useState<SimFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SimMode>('worker');
  const clientRef = useRef<Client | null>(null);
  const jobRef = useRef(-1);
  const nRounds = graph.rounds.length;
  const upto = Math.max(0, Math.min(nRounds - 1, uptoRound ?? nRounds - 1));
  const latest = useRef({ upto, blocked });
  latest.current = { upto, blocked };
  const table = !!opts.table;
  const pinsKey = opts.pins?.length ? JSON.stringify(opts.pins) : '';
  const extra = useRef(opts);
  extra.current = opts;

  useEffect(() => {
    if (!network) return;
    const job = ++jobSeq;
    jobRef.current = job;
    setFrame(null);
    setError(null);
    const onMsg = (m: FromWorker) => {
      if (m.job !== jobRef.current) return;
      if (m.type === 'error') { setError(m.message); return; }
      const { type: _t, ...f } = m;
      setFrame(f);
    };
    const init = (): ToWorker => ({
      type: 'init', job, graph, params, config: simConfig, uptoRound: latest.current.upto, blocked: latest.current.blocked,
      table, pins: extra.current.pins?.length ? extra.current.pins : undefined,
    });
    let client: Client | null = null;
    const fallback = () => {
      client?.dispose();
      client = mainThreadClient(onMsg);
      clientRef.current = client;
      setMode('main');
      client.send(init());
    };
    client = workerClient(onMsg, fallback);
    if (!client) { fallback(); }
    else { clientRef.current = client; setMode('worker'); client.send(init()); }
    return () => {
      client?.send({ type: 'dispose', job });
      client?.dispose();
      clientRef.current = null;
    };
  }, [network, graph, params, table, pinsKey]);

  useEffect(() => { clientRef.current?.send({ type: 'upto', job: jobRef.current, round: upto }); }, [upto]);
  useEffect(() => { clientRef.current?.send({ type: 'blocked', job: jobRef.current, blocked }); }, [blocked]);

  return { network, error: buildError ?? error, frame, mode };
}
