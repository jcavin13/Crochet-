import { readdirSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { compilePattern } from '../notation';
import { analyzeSymmetry } from './index';
it('probe', () => {
  const out: string[] = [];
  for (const dir of ['../spec/fixtures/', '../data/corpus/']) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.cro')).sort()) {
      const r = compilePattern(readFileSync(dir + f, 'utf8'));
      if (!r.pattern) { out.push(`${f}: ERR`); continue; }
      const t0 = performance.now();
      const s = analyzeSymmetry(r.pattern.graph);
      const dt = performance.now() - t0;
      out.push(`${f}: ${s.group} (${dt.toFixed(1)}ms) own=[${s.rounds.map((x) => `${x.order}${x.mirror ? 'm' : ''}/${x.cumulative}${x.cumulativeMirror ? 'M' : ''}`).join(' ')}]`);
      for (const l of s.summary) out.push('   ' + l);
    }
  }
  process.stderr.write(out.join('\n') + '\n');
});
