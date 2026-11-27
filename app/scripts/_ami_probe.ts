import { compilePattern } from '../src/core/notation';
import { revolve, PRESETS, presetProfile, circle, hat, gaugeFromParams, rectangle, tube } from '../src/core/amigurumi';
import { paramsFile } from '../src/core/params';
import { analyzeFlatness } from '../src/core/flatness';
for (const params of paramsFile.sets) for (const st of ['sc','hdc','dc'] as const) for (const p of PRESETS) {
  const r = revolve({ profile: presetProfile(p.id), params, stitch: st });
  const c = compilePattern(r.text);
  const bad = c.diagnostics.filter(d=>d.severity!=='info');
  console.log(params.id.slice(0,8), st, p.id.padEnd(9), bad.length? 'BAD '+bad[0].message : 'ok', 'R', r.rounds.length, 'maxDist/h', (r.maxDistance/r.h).toFixed(2), r.warnings.filter(w=>w.severity==='warning').map(w=>w.code).join(','));
}
const params = paramsFile.sets[0];
console.log(revolve({ profile: presetProfile('sphere'), params, repeat: 6 }).rounds.map(r=>r.count).join(','));
console.log(revolve({ profile: presetProfile('sphere'), params, repeat: 6, stagger:false }).text);
const ci = circle({ gauge: gaugeFromParams(params), diameterCm: 12 });
console.log(ci.counts.join(','));
const cp = compilePattern(ci.text).pattern!;
const fr = analyzeFlatness(cp.graph, params);
console.log(fr.final, fr.worst?.message);
const sp = compilePattern(revolve({ profile: presetProfile('sphere'), params }).text).pattern!;
const f2 = analyzeFlatness(sp.graph, params); console.log(f2.final, f2.rounds.map(r=>r.class).join(','));
const ht = hat({ gauge: gaugeFromParams(params, 'hdc'), headCm: 56, heightCm: 20 }); console.log(ht.text, compilePattern(ht.text).diagnostics);
console.log(rectangle({ gauge: {stitches:16, rows:18}, widthCm: 10, heightCm: 10, stitch:'dc' }).text);
