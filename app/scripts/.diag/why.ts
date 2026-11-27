import { generateSnowflake, SNOWFLAKE_PRESETS, randomSnowflake, snowflakePins } from '../../src/core/generate/snowflake/index';
import { paramSetById } from '../../src/core/params/index';
import { createSim, KIND_NAMES } from '../../src/core/sim/index';
const params = paramSetById('thread-10_1.5mm')!;
const id = process.argv[2];
const spec = id.startsWith('seed') ? randomSnowflake(Number(id.slice(4)), { params }) : SNOWFLAKE_PRESETS.find(p => p.id === id)!.spec;
console.log(JSON.stringify(spec));
const res = generateSnowflake(spec, params);
console.log(res.text.split('\n').filter(l => l.startsWith('Rnd')).join('\n'));
console.log('shape tipR', res.shape.tipR.toFixed(1), 'bodyR', res.shape.bodyR.toFixed(1), 'valleyR', res.shape.valleyR.toFixed(1));
const g = res.pattern!.graph;
const pins = snowflakePins(res);
const sim = createSim(g, params, { table: true, pins, blocked: true });
let st; do { st = sim.step(1000); } while (!st.done);
const X = sim.positions, n = sim.network.nNodes, net = sim.network;
let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += X[3*i]; cy += X[3*i+1]; } cx /= n; cy /= n;
const R = (i: number) => Math.hypot(X[3*i]-cx, X[3*i+1]-cy);
for (const p of pins.slice(0, 12)) console.log('pin', p.kind, p.node, g.nodes[p.node].type, 'target r', Math.hypot(p.x, p.y).toFixed(1), 'sim r', R(p.node).toFixed(1));
const sp = net.spines[0];
console.log('spine0 base r', R(sp.base).toFixed(1), 'stem s_q', sp.pos.get(sp.stem[sp.stem.length-1])![0].toFixed(1), 'tip loop', sp.tip.length);
const str = sim.strain();
const idx = Array.from(str.keys()).filter(q => !Number.isNaN(str[q]) && net.kind[q] < 3).sort((a, b) => str[b] - str[a]).slice(0, 12);
for (const q of idx) console.log((str[q]*100).toFixed(0)+'%', KIND_NAMES[net.kind[q]], net.I[q], g.nodes[net.I[q]]?.type, net.J[q], g.nodes[net.J[q]]?.type, 'L', net.L[q].toFixed(2), net.slack[q] ? 'slack':'');
import { block } from '../../src/core/sim/index';
{
  const sim2 = createSim(g, params, { table: true });
  let s2; do { s2 = sim2.step(1000); } while (!s2.done);
  const br = block(net, Float64Array.from(sim2.positions), undefined, 1e-8, pins);
  for (const a of br.pins!.slice(0, 6)) {
    const p = a.node, P = br.positions; const c = br.plane.c, u = br.plane.u, v = br.plane.v;
    const D = [P[3*p]-c[0], P[3*p+1]-c[1], P[3*p+2]-c[2]];
    console.log('aligned', p, a.x.toFixed(2), a.y.toFixed(2), 'got', (D[0]*u[0]+D[1]*u[1]+D[2]*u[2]).toFixed(2), (D[0]*v[0]+D[1]*v[1]+D[2]*v[2]).toFixed(2), 'r', Math.hypot(a.x,a.y).toFixed(1));
  }
}
import { Grower } from '../../src/core/sim/index';
import { simConfig } from '../../src/core/params/index';
{
  const gr = new Grower(net, simConfig, { table: true, gtolRound: 1e-6, gtolFinal: 1e-8 }); gr.advance();
  const br = block(net, gr.planar!, undefined, 1e-8, pins);
  console.log('planar-start conv', br.converged, br.message);
  for (const a of br.pins!.slice(0, 6)) {
    const p = a.node, P = br.positions; const c = br.plane.c, u = br.plane.u, v = br.plane.v;
    const D = [P[3*p]-c[0], P[3*p+1]-c[1], P[3*p+2]-c[2]];
    console.log('aligned2', p, a.x.toFixed(2), a.y.toFixed(2), 'got', (D[0]*u[0]+D[1]*u[1]+D[2]*u[2]).toFixed(2), (D[0]*v[0]+D[1]*v[1]+D[2]*v[2]).toFixed(2), 'r', Math.hypot(a.x,a.y).toFixed(1), 'c', c.map(x=>x.toFixed(1)).join(','));
  }
}
