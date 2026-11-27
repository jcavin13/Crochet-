/// <reference lib="webworker" />
// Web Worker running the spring sim off the main thread (see driver.ts / protocol.ts).
import { createDriver } from './driver';
import type { FromWorker, ToWorker } from './protocol';

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

const driver = createDriver({
  budget: 24,
  schedule: (fn) => setTimeout(fn, 0),
  emit: (f) => post({ type: 'frame', ...f }, [f.positions.buffer, ...(f.strain ? [f.strain.buffer] : [])]),
  error: (job, message) => post({ type: 'error', job, message }),
});

self.onmessage = (e: MessageEvent<ToWorker>) => driver.handle(e.data);
