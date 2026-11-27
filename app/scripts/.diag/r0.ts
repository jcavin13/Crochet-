import { generateSnowflake, SNOWFLAKE_PRESETS } from '../../src/core/generate/snowflake/index';
import { paramSetById } from '../../src/core/params/index';
import { buildNetwork, KIND_NAMES } from '../../src/core/sim/index';
const params = paramSetById('thread-10_1.5mm')!;
const res = generateSnowflake(SNOWFLAKE_PRESETS[0].spec, params);
const g = res.pattern!.graph; const net = buildNetwork(g, params);
for (const nd of g.nodes.filter(n=>n.round===0)) console.log(nd.id, nd.type, nd.role??'', nd.countsAs??'', JSON.stringify(nd.into), net.springs.filter(s=>s.i===nd.id||s.j===nd.id).map(s=>`${KIND_NAMES[s.kind]}:${s.i===nd.id?s.j:s.i}/${s.L.toFixed(2)}/${s.k.toFixed(2)}${s.slack?'*':''}`).join(' '));
console.log(g.spaces.filter(s=>s.round===0));
