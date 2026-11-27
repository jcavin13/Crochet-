// Runs designBlanket in a Web Worker (latest request wins), with a synchronous fallback when
// workers are unavailable. The page never blocks on a big blanket.
import { useEffect, useRef, useState } from 'react';
import { designBlanket, type BlanketDesign, type BlanketSpec } from '@/core/blanket';
import type { DesignReply, DesignRequest } from './blanket.worker';

export function useDesign(spec: BlanketSpec): { design?: BlanketDesign; pending: boolean; error?: string } {
  const [state, setState] = useState<{ design?: BlanketDesign; pending: boolean; error?: string }>({ pending: true });
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify(spec);

  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    try {
      const w = new Worker(new URL('./blanket.worker.ts', import.meta.url), { type: 'module', name: 'blanket-design' });
      worker.current = w;
      w.onmessage = (e: MessageEvent<DesignReply>) => {
        if (e.data.id !== seq.current) return; // a newer request is on its way
        if (e.data.ok) setState({ design: e.data.design, pending: false });
        else setState((s) => ({ ...s, pending: false, error: (e.data as { error: string }).error }));
      };
      return () => { w.terminate(); worker.current = null; };
    } catch {
      worker.current = null;
      return undefined;
    }
  }, []);

  useEffect(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, pending: true }));
    const t = setTimeout(() => {
      const w = worker.current;
      if (w) {
        w.postMessage({ id, spec: JSON.parse(key) } satisfies DesignRequest);
      } else {
        try {
          const design = designBlanket(JSON.parse(key));
          if (id === seq.current) setState({ design, pending: false });
        } catch (err) {
          if (id === seq.current) setState((s) => ({ ...s, pending: false, error: err instanceof Error ? err.message : String(err) }));
        }
      }
    }, 120);
    return () => clearTimeout(t);
  }, [key]);

  return state;
}
