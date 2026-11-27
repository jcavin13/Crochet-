import { readFileSync } from 'node:fs';
import { paramsFor } from '../../src/core/params/index';
import { simulate, shapeMetric } from '../../src/core/sim/index';
for (const name of ['hyperbolic_plane', 'sc_cone', 'sc_sphere', 'flat_dc_circle', 'simple_doily']) {
  const pat = JSON.parse(readFileSync(`../spec/fixtures/${name}.graph.json`, 'utf8'));
  const params = paramsFor(pat);
  for (const table of [false, true]) {
    const sim = simulate(pat, params, { table, gtolRound: 1e-5, gtolFinal: 1e-6 });
    const n = sim.network.nNodes;
    const m = shapeMetric(sim.positions.subarray(0, 3*n), sim.network.particleRound.subarray(0, n));
    let zmin = Infinity, zmax = -Infinity; for (let i = 0; i < n; i++) { zmin = Math.min(zmin, sim.positions[3*i+2]); zmax = Math.max(zmax, sim.positions[3*i+2]); }
    console.log(name, table, m.class, m.A.toFixed(2), m.W.toFixed(2), 'Rg', m.Rg.toFixed(1), 'z range', (zmax - zmin).toFixed(2));
  }
}
