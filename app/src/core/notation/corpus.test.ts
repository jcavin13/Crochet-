/**
 * Corpus report: compiles every data/corpus/*.cro. Corpus errors do NOT fail the suite (the
 * corpus is transcribed by hand and may be mid-edit); a summary is printed instead. The suite
 * fails only if the compiler throws, or a file that compiles produces an invalid graph or fails
 * the printer round trip — those would be compiler bugs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile, stripSrc, validateGraph } from '../graph/index';
import { compilePattern, formatDiagnostic, parse, print } from './index';

const dir = fileURLToPath(new URL('../../../../data/corpus/', import.meta.url));
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.cro')).sort() : [];

describe('data/corpus', () => {
  it('compiles every corpus file (report only)', () => {
    const lines: string[] = [];
    let okCount = 0;
    for (const f of files) {
      const text = readFileSync(dir + f, 'utf8');
      const r = compilePattern(text);
      const errs = r.diagnostics.filter((d) => d.severity === 'error');
      const warns = r.diagnostics.filter((d) => d.severity === 'warning');
      if (r.pattern) {
        okCount++;
        expect(validateGraph(r.pattern.graph).filter((i) => i.severity === 'error'), f).toEqual([]);
        const again = compile(parse(print(r.ast!, { terms: 'UK' })).ast);
        expect(stripSrc(again.pattern!).graph, f).toEqual(stripSrc(r.pattern).graph);
      }
      lines.push(`${errs.length ? 'FAIL' : 'ok  '} ${f} — ${errs.length} error(s), ${warns.length} warning(s)`);
      for (const d of [...errs, ...warns]) lines.push(`     ${formatDiagnostic(d, f)}`);
    }
    // written straight to stderr so the summary shows even when vitest hides console output of passing tests
    process.stderr.write(`\ncorpus: ${okCount}/${files.length} compile\n${lines.join('\n')}\n`);
  });
});
