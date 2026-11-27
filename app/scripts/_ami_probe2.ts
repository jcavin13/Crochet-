import { revolve, PRESETS, presetProfile } from '../src/core/amigurumi';
import { paramsFile } from '../src/core/params';
for (const params of paramsFile.sets) for (const st of ['sc','dc'] as const) for (const p of PRESETS) for (const stagger of [true,false]) {
  const r = revolve({ profile: presetProfile(p.id), params, stitch: st, stagger });
  for (const x of r.rounds.slice(1)) {
    if (x.clamped || x.exact === 0) continue;
    if (r.closedEnd && x.n === r.rounds.length) continue;
    if (Math.abs(x.count - x.exact) > 0.5) console.log(params.id, st, p.id, x.n, x.prev, x.count, x.exact.toFixed(2), r.rounds.length);
  }
}
