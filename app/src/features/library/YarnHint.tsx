// "≈ 30 m · 5 g" on a library row: compiled and estimated lazily (when the row scrolls into view,
// off the first paint), cached per text + stitch-parameter set. Uses the yarn chosen for that
// weight in any yarn panel (my yarns / ball band), else the typical yarn of the weight.
import { useEffect, useRef, useState } from 'react';
import { compilePattern, type Pattern } from '@/app/coreApi';
import { paramSetById, paramsFor, type ParamSet } from '@/core/params';
import { categoryKey, estimateYarn, formatLength, formatMass, type YarnEstimate } from '@/core/yarn';
import { choiceKey, getPersistent, loadPersistent, useSettings, yarnStore, type YarnChoice } from '@/store';
import { specFromChoice } from '@/features/yarn/useYarn';

const cache = new Map<string, YarnEstimate | null>();

async function estimateFor(text: string, graph: Pattern | undefined, setting: string): Promise<YarnEstimate | null> {
  const pattern = graph ?? compilePattern(text).pattern;
  if (!pattern) return null;
  const params: ParamSet = (setting !== 'auto' && paramSetById(setting)) || paramsFor(pattern);
  const cat = categoryKey(params.yarn_weight);
  await Promise.all([loadPersistent(choiceKey(cat), {}), yarnStore.load()]);
  const { spec } = specFromChoice(getPersistent<YarnChoice>(choiceKey(cat), {}) ?? {}, yarnStore.get() ?? [], cat);
  return estimateYarn(pattern, params, { yarn: spec });
}

export function YarnHint({ text, graph }: { text: string; graph?: Pattern }) {
  const setting = useSettings((s) => s.paramsSet);
  const units = useSettings((s) => s.yarnUnits ?? 'metric');
  const key = `${setting}\n${graph ? JSON.stringify(graph.graph.rounds) + graph.graph.nodes.length : text}`;
  const [est, setEst] = useState<YarnEstimate | null | undefined>(() => cache.get(key));
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (cache.has(key)) { setEst(cache.get(key)); return; }
    const el = ref.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      timer = setTimeout(() => {
        estimateFor(text, graph, setting).then((e) => { cache.set(key, e); if (!cancelled) setEst(e); }, () => { cache.set(key, null); });
      }, 30);
    };
    if (!el || typeof IntersectionObserver === 'undefined') { run(); return () => { cancelled = true; clearTimeout(timer); }; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) { io.disconnect(); run(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => { cancelled = true; io.disconnect(); clearTimeout(timer); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span ref={ref} className="lib-yarn" title={est ? `Yarn estimate (${est.status}; likely ${formatLength(est.net.metersLow, units)}–${formatLength(est.net.metersHigh, units)}), without the ${Math.round((est.yarn?.allowance ?? 0.1) * 100)} % allowance` : undefined}>
      {est ? `≈ ${formatLength(est.net.meters, units)} · ${formatMass(est.net.grams!, units)}` : est === null ? '' : ' '}
    </span>
  );
}
