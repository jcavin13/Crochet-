import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { simulate } from './solve';
import { shapeMetric } from './metrics';
import { paramsFor } from '../params';
it('x', () => {
  for (const n of ['flat_sc_circle','flat_dc_circle','sc_cone','sc_sphere','hyperbolic_plane','simple_doily','chain_space_motif']) {
    const pat = JSON.parse(readFileSync(`/home/user/Crochet-/spec/fixtures/${n}.graph.json`,'utf8'));
    const lab = JSON.parse(readFileSync(`/home/user/Crochet-/spec/fixtures/${n}.lab.json`,'utf8'));
    const r = simulate(pat, paramsFor(pat));
    const m = shapeMetric(r.positions, r.network.particleRound.subarray(0, r.network.nNodes));
    const f = (x:number)=>x.toFixed(4);
    console.log(n.padEnd(18), 'lab', lab.class, lab.A, lab.W, lab.Rg, lab.energy, '| ts', m.class, f(m.A), f(m.W), f(m.Rg), r.energy.toExponential(3), r.converged, r.iterations, Math.round(r.ms)+'ms');
  }
}, 600000);
