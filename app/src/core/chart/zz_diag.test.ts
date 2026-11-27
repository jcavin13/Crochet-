import { it } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compilePattern } from '../notation';
import { paramsFor, paramSetById } from '../params';
import { analyzeSymmetry } from '../symmetry';
import { generateSnowflake, SNOWFLAKE_PRESETS } from '../generate/snowflake';
import { layoutChart } from './index';
import type { Graph } from '../graph';
const fixDir = fileURLToPath(new URL('../../../../spec/fixtures/', import.meta.url));
const corpusDir = fileURLToPath(new URL('../../../../data/corpus/', import.meta.url));
const list = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.cro')).sort().map((f) => dir + f) : []);
function diag(name: string, g: Graph, params: any) {
  const sym = analyzeSymmetry(g);
  const L = layoutChart(g, params);
  let line = `${name} order=${sym.order}`;
  if (sym.order < 2 || L.mode !== 'radial') return line + ' (skip)';
  const n = sym.order; const rot = 2 * Math.PI / n, cs = Math.cos(rot), sn = Math.sin(rot);
  const errs: string[] = [];
  let worstAll = 0;
  for (const R of L.rounds) {
    if (R.first < 0) continue;
    if (R.spiral) { errs.push('sp'); continue; }
    const ns: { a: number; k: string; r: number }[] = [];
    for (let id = R.first; id <= R.last; id++) {
      const m = L.nodes[id]; const nd = g.nodes[id];
      if (m.arm) continue;
      let k = '';
      if (m.kind === 'stitch') k = m.symbol.key;
      else if (false) k = '';
      else continue;
      ns.push({ a: Math.atan2(-m.y, m.x), k, r: Math.hypot(m.x, m.y) });
    }
    const keys = new Set(ns.map((q) => q.k));
    // tch may count as a different key; merge tch keys with stitch keys
    let worst = 0;
    for (const m of ns) {
      let best = Infinity;
      for (const q of ns) { if (q.k !== m.k && !(keys.size > 1 && (/^[a-z]+$/.test(q.k) && /^[a-z]+$/.test(m.k)))) continue; const d = Math.abs(Math.atan2(Math.sin(q.a - m.a - rot), Math.cos(q.a - m.a - rot))); best = Math.min(best, d); }
      worst = Math.max(worst, best);
    }
    worstAll = Math.max(worstAll, worst);
    errs.push(worst.toFixed(4));
  }
  const P = L.rounds.find((r) => r.arms);
  let armErr = '';
  if (P) { const s = P.arms!.map((a) => a.s); const d = s.map((v, i) => { const e = v - s[0] - P.dir * i * 2 * Math.PI / s.length; return Math.atan2(Math.sin(e), Math.cos(e)); }); armErr = ' arms=' + Math.max(...d.map(Math.abs)).toFixed(4); }
  return `${line} worst=${worstAll.toFixed(4)} per-round=[${errs.join(' ')}]${armErr}`;
}
it('diag', () => {
  const out: string[] = [];
  for (const f of [...list(fixDir), ...list(corpusDir)]) {
    const r = compilePattern(readFileSync(f, 'utf8'));
    if (!r.pattern) continue;
    out.push(diag(f.split('/').pop()!, r.pattern.graph, paramsFor(r.pattern)));
  }
  const T = paramSetById('thread-10_1.5mm')!;
  for (const p of SNOWFLAKE_PRESETS) {
    for (const pts of [5, 6, 8, 12]) {
      const r = generateSnowflake({ ...p.spec, points: pts }, T);
      if (r.pattern) out.push(diag(`snow ${p.id} ${pts}`, r.pattern.graph, T));
    }
  }
  writeFileSync(process.env.DIAG_OUT ?? '/tmp/claude-0/-home-user-Crochet-/415fd54c-32d7-5681-9fe8-235d84244e1c/scratchpad/diag.txt', out.join('\n'));
});
