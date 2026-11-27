/// <reference lib="webworker" />
// Web Worker: designs (and compiles) the blanket off the main thread — a throw is up to 50 000
// nodes to compile, and the closed-form counts of a king-size blanket walk 150 000 stitches.
import { designBlanket, type BlanketSpec } from '@/core/blanket';

export interface DesignRequest { id: number; spec: BlanketSpec }
export type DesignReply = { id: number; ok: true; design: ReturnType<typeof designBlanket> } | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<DesignRequest>) => {
  const { id, spec } = e.data;
  try {
    const design = designBlanket(spec);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: true, design } satisfies DesignReply);
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies DesignReply);
  }
};
