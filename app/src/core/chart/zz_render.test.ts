import { it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compilePattern } from '../notation';
import { paramsFor, paramSetById } from '../params';
import { generateSnowflake, SNOWFLAKE_PRESETS } from '../generate/snowflake';
import * as C from './index';
import { analyzeSymmetry } from '../symmetry';
const OUT = process.env.R_OUT ?? '/tmp/claude-0/-home-user-Crochet-/415fd54c-32d7-5681-9fe8-235d84244e1c/scratchpad/r';
const fix = (p: string) => fileURLToPath(new URL('../../../../' + p, import.meta.url));
it('render', () => {
  mkdirSync(OUT, { recursive: true });
  const T = paramSetById('thread-10_1.5mm')!;
  const jobs: [string, any, any][] = [];
  const pre = (id: string, pts?: number) => { const p = SNOWFLAKE_PRESETS.find((q) => q.id === id)!; const r = generateSnowflake(pts ? { ...p.spec, points: pts } : p.spec, T); jobs.push([`snow-${id}${pts ? '-' + pts : ''}`, r.pattern!.graph, T]); };
  pre('fern'); pre('trefoil'); pre('lacy-hexagon'); pre('bold-star'); pre('double-pointed', 12); pre('trefoil', 5); pre('simple-star'); pre('tiny');
  for (const f of ['spec/fixtures/simple_doily.cro', 'spec/fixtures/chain_space_motif.cro', 'data/corpus/petal-doily-12.cro', 'data/corpus/spiderweb-doily-10.cro', 'spec/fixtures/flat_dc_circle.cro']) {
    const r = compilePattern(readFileSync(fix(f), 'utf8'));
    jobs.push([f.split('/').pop()!.replace('.cro', ''), r.pattern!.graph, paramsFor(r.pattern!)]);
  }
  const filt = process.env.R_FILT;
  for (const [name, g, P] of jobs) {
    if (filt && !name.includes(filt)) continue;
    const L = C.layoutChart(g, P);
    writeFileSync(`${OUT}/${name}.svg`, C.chartToSvg(L, { legend: false, showFlatness: true }));
    const W = C.wedgeView(L, analyzeSymmetry(g).order);
    if (W) writeFileSync(`${OUT}/${name}-arm.svg`, C.chartToSvg(L, { legend: false, wedge: W, title: name }));
  }
});
