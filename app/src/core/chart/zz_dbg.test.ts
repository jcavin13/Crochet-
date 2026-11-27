import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { paramSetById } from '../params';
import { generateSnowflake, SNOWFLAKE_PRESETS } from '../generate/snowflake';
import { layoutChart } from './index';
it('dbg', () => {
  const T = paramSetById('thread-10_1.5mm')!;
  const p = SNOWFLAKE_PRESETS.find((q) => q.id === 'trefoil')!;
  const g = generateSnowflake({ ...p.spec, points: 5 }, T).pattern!.graph;
  const L = layoutChart(g, T);
  writeFileSync('/tmp/claude-0/-home-user-Crochet-/415fd54c-32d7-5681-9fe8-235d84244e1c/scratchpad/t5.txt', (generateSnowflake({ ...p.spec, points: 5 }, T) as any).text);
  const R = L.rounds[2];
  let out = '';
  for (let id = R.first; id <= R.last; id++) {
    const m = L.nodes[id]; if (m.arm && m.arm !== 'spine') continue; if (m.arm === 'spine' && id !== R.arms!.find((a) => a.spine[0] === id)?.spine[0]) continue;
    const nd = g.nodes[id];
    out += `${id} ${nd.type} ${m.kind} course=${m.course} s=${(m.s * 180 / Math.PI).toFixed(1)} ang=${(Math.atan2(-m.y, m.x) * 180 / Math.PI).toFixed(1)} r=${m.r.toFixed(2)} into=${JSON.stringify(nd.into)}\n`;
  }
  const R2 = L.rounds[1];
  for (let id = R2.first; id <= R2.last; id++) { const m = L.nodes[id]; out += `R2 ${id} ${g.nodes[id].type} s=${(m.s * 180 / Math.PI).toFixed(1)} ang=${(Math.atan2(-m.y, m.x) * 180 / Math.PI).toFixed(1)}\n`; }
  writeFileSync('/tmp/claude-0/-home-user-Crochet-/415fd54c-32d7-5681-9fe8-235d84244e1c/scratchpad/dbg.txt', out);
});
