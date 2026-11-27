import { generateSnowflake, SNOWFLAKE_PRESETS, randomSnowflake } from '../../src/core/generate/snowflake/index';
import { paramSetById, stitchParam } from '../../src/core/params/index';
import { simulate } from '../../src/core/sim/index';
import { analyzeFlatness } from '../../src/core/flatness/index';
const params = paramSetById('thread-10_1.5mm')!;
const specs: [string, any][] = SNOWFLAKE_PRESETS.map(p => [p.id, p.spec]);
for (const s of [3, 17]) specs.push([`seed${s}`, randomSnowflake(s, { params })]);
for (const [id, spec] of specs) {
  const res = generateSnowflake(spec, params);
  const g = res.pattern!.graph;
  const sim = simulate(g, params, { table: true, gtolRound: 1e-5, gtolFinal: 1e-6 });
  const X = sim.positions, n = sim.network.nNodes;
  const last = g.rounds.length - 1;
  let cx = 0, cy = 0, k = 0; for (let i = 0; i < n; i++) if (g.nodes[i].round < last) { cx += X[3*i]; cy += X[3*i+1]; k++; } cx /= k; cy /= k;
  const r = (i: number) => Math.hypot(X[3*i]-cx, X[3*i+1]-cy);
  const bases = sim.network.spines.map(s => r(s.base));
  // per body round: mean radius of stitch nodes in the sim vs analytic r
  const fl = analyzeFlatness(g, params);
  const rows = [];
  for (let q = 0; q < last; q++) {
    const st = g.nodes.filter(nd => nd.round === q && nd.type !== 'ch' && nd.type !== 'slst');
    const m = st.reduce((a, nd) => a + r(nd.id), 0) / st.length;
    rows.push(`R${q+1} sim ${m.toFixed(1)} / analytic ${fl.rounds[q].r.toFixed(1)}`);
  }
  const R0 = res.shape.bodyR + stitchParam(params, 'sc').height;
  const mb = bases.reduce((a, b) => a + b, 0) / Math.max(1, bases.length);
  console.log(id.padEnd(15), 'R0 tpl', R0.toFixed(1), 'sim arm bases', mb.toFixed(1), `(${((mb/R0-1)*100).toFixed(0)}%)`, '|', rows.join(' | '));
}
