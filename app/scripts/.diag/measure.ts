import { generateSnowflake, SNOWFLAKE_PRESETS, randomSnowflake } from '../../src/core/generate/snowflake/index';
import { paramSetById } from '../../src/core/params/index';
import { simulate, shapeMetric } from '../../src/core/sim/index';
import { writeFileSync } from 'node:fs';
const params = paramSetById('thread-10_1.5mm')!;
const specs: [string, any][] = SNOWFLAKE_PRESETS.map(p => [p.id, p.spec]);
for (const s of [3, 17]) specs.push([`seed${s}`, randomSnowflake(s, { params })]);
const only = process.argv[2];
for (const [id, spec] of specs) {
  if (only && id !== only) continue;
  const res = generateSnowflake(spec, params);
  const g = res.pattern!.graph;
  const t0 = Date.now();
  const sim = simulate(g, params, { gtolRound: 1e-4, gtolFinal: 1e-5, table: !!process.env.TABLE });
  const t1 = Date.now();
  const X = sim.positions;
  // spines: chain runs with same-round node anchors
  const n = g.nodes.length;
  const recv = new Set<number>();
  for (const nd of g.nodes) for (const a of nd.into) if ('node' in a && g.nodes[a.node].type === 'ch' && g.nodes[a.node].round === nd.round) recv.add(a.node);
  const ratios: number[] = [];
  let i = 0;
  while (i < n) {
    if (g.nodes[i].type !== 'ch') { i++; continue; }
    let j = i; while (j + 1 < n && g.nodes[j + 1].type === 'ch') j++;
    let q = -1; for (let k = i; k <= j; k++) if (recv.has(k)) q = k;
    if (q > i) {
      const d = Math.hypot(X[3*q]-X[3*i], X[3*q+1]-X[3*i+1], X[3*q+2]-X[3*i+2]);
      ratios.push(d / ((q - i) * 1.68));
    }
    i = j + 1;
  }
  // body metric (rounds before last)
  const lastR = g.rounds.length - 1;
  const bodyIdx = g.nodes.filter(nd => nd.round < lastR).map(nd => nd.id);
  const Xb = new Float64Array(bodyIdx.length * 3); const rb = new Int32Array(bodyIdx.length);
  bodyIdx.forEach((id, k) => { Xb.set(X.subarray(3*id, 3*id+3), 3*k); rb[k] = g.nodes[id].round; });
  const mb = shapeMetric(Xb, rb);
  const mAll = shapeMetric(X.subarray(0, 3*n), sim.network.particleRound.subarray(0, n));
  ratios.sort((a,b)=>a-b);
  console.log(id, `nodes ${n} ${Date.now()-t0}ms`, 'spine e2e/rest min', ratios[0]?.toFixed(2), 'median', ratios[ratios.length>>1]?.toFixed(2), '| body', mb.class, mb.A.toFixed(2), mb.W.toFixed(2), '| all', mAll.class, mAll.A.toFixed(2), mAll.W.toFixed(2));
  writeFileSync(`/tmp/claude-0/-home-user-Crochet-/415fd54c-32d7-5681-9fe8-235d84244e1c/scratchpad/${id}.json`, JSON.stringify({ X: Array.from(X.subarray(0,3*n)), type: g.nodes.map(n=>n.type), round: g.nodes.map(n=>n.round), I: Array.from(sim.network.I), J: Array.from(sim.network.J), kind: Array.from(sim.network.kind) }));
}
