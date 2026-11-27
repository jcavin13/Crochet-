import { generateSnowflake, SNOWFLAKE_PRESETS } from '../../src/core/generate/snowflake/index';
import { paramSetById } from '../../src/core/params/index';
import { buildNetwork, KIND_NAMES } from '../../src/core/sim/index';
const params = paramSetById('thread-10_1.5mm')!;
const res = generateSnowflake(SNOWFLAKE_PRESETS[1].spec, params);
console.log(res.text);
const g = res.pattern!.graph;
const last = g.rounds[g.rounds.length-1];
const net = buildNetwork(g, params);
for (let i = last.first; i < last.first + 50; i++) {
  const n = g.nodes[i];
  const sp = net.springs.filter(s => s.i===i||s.j===i).map(s=>`${KIND_NAMES[s.kind][0]}${s.kind===3?'b':s.kind===4?'w':''}:${s.i===i?s.j:s.i}/${s.L.toFixed(2)}${s.slack?'*':''}`);
  console.log(i, n.type, JSON.stringify(n.into), n.chains??'', sp.join(' '));
}
console.log(g.spaces.filter(s=>s.round===last.index||true).slice(-5));
