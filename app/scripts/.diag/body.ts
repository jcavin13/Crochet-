import { generateSnowflake, SNOWFLAKE_PRESETS } from '../../src/core/generate/snowflake/index';
import { paramSetById } from '../../src/core/params/index';
import { simulate, shapeMetric } from '../../src/core/sim/index';
import { analyzeFlatness } from '../../src/core/flatness/index';
const params = paramSetById('thread-10_1.5mm')!;
for (const id of ['simple-star', 'fern', 'trefoil']) {
  const res = generateSnowflake(SNOWFLAKE_PRESETS.find(p=>p.id===id)!.spec, params);
  const g = res.pattern!.graph;
  console.log(id, res.text.split('\n').filter(l=>l.startsWith('Rnd')).slice(0,-1).join('\n'));
  const fl = analyzeFlatness(g, params);
  console.log(fl.rounds.map(r => `${r.class} e=${r.e.toFixed(3)} [${r.eMin.toFixed(2)},${r.eMax.toFixed(2)}]`).join(' | '));
  for (let r = 0; r < g.rounds.length - 1; r++) {
    for (const table of [false, true]) {
      const sim = simulate(g, params, { uptoRound: r, table });
      const nn = g.nodes.filter(n => n.round <= r).length;
      const m = shapeMetric(sim.positions.subarray(0, 3*nn), sim.network.particleRound.subarray(0, nn));
      console.log(`  upto ${r} table=${table}: ${m.class} A ${m.A.toFixed(2)} W ${m.W.toFixed(2)} E ${sim.energy.toExponential(2)}`);
    }
  }
}
