import { generateSnowflake, SNOWFLAKE_PRESETS } from '../../src/core/generate/snowflake/index';
import { paramSetById } from '../../src/core/params/index';
import { simulate } from '../../src/core/sim/index';
import { writeFileSync } from 'node:fs';
const params = paramSetById('thread-10_1.5mm')!;
const id = process.argv[2], r = Number(process.argv[3]);
const res = generateSnowflake(SNOWFLAKE_PRESETS.find(p=>p.id===id)!.spec, params);
const g = res.pattern!.graph;
for (const table of [false, true]) {
  const sim = simulate(g, params, { uptoRound: r, table });
  const nn = g.nodes.filter(n => n.round <= r).length;
  writeFileSync(`/tmp/claude-0/-home-user-Crochet-/415fd54c-32d7-5681-9fe8-235d84244e1c/scratchpad/${id}_${r}_${table}.json`, JSON.stringify({ X: Array.from(sim.positions.subarray(0,3*nn)), type: g.nodes.slice(0,nn).map(n=>n.type), round: g.nodes.slice(0,nn).map(n=>n.round), I: Array.from(sim.network.I), J: Array.from(sim.network.J), kind: Array.from(sim.network.kind) }));
}
