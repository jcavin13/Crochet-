import { revolve, PRESETS, presetProfile } from '../src/core/amigurumi';
import { paramsFile } from '../src/core/params';
let sum=0,n=0,mx=0;
for (const params of paramsFile.sets) for (const st of ['sc','hdc','dc'] as const) for (const p of PRESETS) {
  const r = revolve({ profile: presetProfile(p.id), params, stitch: st });
  const m = r.rounds.reduce((a,x)=>a+x.distance,0)/r.rounds.length/r.h; sum+=m; n++; mx=Math.max(mx,r.maxDistance/r.h);
}
console.log('mean dist/h', (sum/n).toFixed(3), 'max', mx.toFixed(2));
