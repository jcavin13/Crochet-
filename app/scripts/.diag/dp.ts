import { generateSnowflake, SNOWFLAKE_PRESETS } from '../../src/core/generate/snowflake/index';
import { paramSetById } from '../../src/core/params/index';
import { analyzeFlatness } from '../../src/core/flatness/index';
const params = paramSetById('thread-10_1.5mm')!;
const res = generateSnowflake(SNOWFLAKE_PRESETS.find(p=>p.id==='double-pointed')!.spec, params);
console.log(res.text.split('\n').filter(l => l.startsWith('Rnd')).join('\n'));
for (const r of analyzeFlatness(res.pattern!.graph, params).rounds) console.log(JSON.stringify(r).slice(0, 400));
