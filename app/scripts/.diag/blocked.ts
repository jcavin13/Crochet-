import { generateSnowflake, SNOWFLAKE_PRESETS, randomSnowflake, snowflakePins } from '../../src/core/generate/snowflake/index';
import { paramSetById } from '../../src/core/params/index';
import { createSim } from '../../src/core/sim/index';
import { writeFileSync } from 'node:fs';
const params = paramSetById('thread-10_1.5mm')!;
const specs: [string, any][] = SNOWFLAKE_PRESETS.map(p => [p.id, p.spec]);
for (const s of [3, 17]) specs.push([`seed${s}`, randomSnowflake(s, { params })]);
for (const [id, spec] of specs) {
  if (process.argv[2] && id !== process.argv[2]) continue;
  const res = generateSnowflake(spec, params);
  const g = res.pattern!.graph;
  const pins = snowflakePins(res);
  const t0 = Date.now();
  const sim = createSim(g, params, { table: true, pins, blocked: true });
  let st; do { st = sim.step(1000); } while (!st.done);
  const b = sim.block()!;
  const X = sim.positions;
  // tip radii from centroid of pins
  let cx = 0, cy = 0, cz = 0; const n = sim.network.nNodes;
  for (let i = 0; i < n; i++) { cx += X[3*i]; cy += X[3*i+1]; cz += X[3*i+2]; } cx/=n; cy/=n; cz/=n;
  console.log(id, `${Date.now()-t0}ms pins ${pins.length} (tips ${pins.filter(p=>p.kind==='tip').length}) conv ${b.converged} ${b.verdict}: ${b.message} stretch`, JSON.stringify(b.pinStretch && Object.fromEntries(Object.entries(b.pinStretch).map(([k,v])=>[k, +(v*100).toFixed(1)]))), 'mean', (b.meanAbsStrain*100).toFixed(1));
  writeFileSync(`/tmp/claude-0/-home-user-Crochet-/415fd54c-32d7-5681-9fe8-235d84244e1c/scratchpad/${id}.json`, JSON.stringify({ X: Array.from(X.subarray(0,3*n)), type: g.nodes.map(n=>n.type), round: g.nodes.map(n=>n.round), I: Array.from(sim.network.I), J: Array.from(sim.network.J), kind: Array.from(sim.network.kind) }));
}
