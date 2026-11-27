/**
 * Corpus sim smoke test (review R1/R22): the app sim, with the fast tolerances the browser uses on
 * large pieces, runs on every data/corpus pattern, finishes within a generous time budget and
 * gives finite positions. It asserts nothing about the shape class: the count rule and the sim
 * disagree on a few patterns by design, documented with numbers in docs/sim_corpus_report.md
 * (npm run sim:corpus). Writes nothing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compilePattern } from '../notation';
import { surveyPattern } from './survey';

const dir = fileURLToPath(new URL('../../../../data/corpus/', import.meta.url));
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.cro')).sort() : [];
const BUDGET_MS = 60_000; // per pattern; ~6 s on an idle 4-core machine for the largest

describe('corpus sim smoke (fast tolerances)', () => {
  it('there is a corpus', () => expect(files.length).toBeGreaterThanOrEqual(16));
  const rows: string[] = [];
  for (const f of files) {
    it(f, () => {
      const c = compilePattern(readFileSync(dir + f, 'utf8'));
      expect(c.pattern, f).toBeDefined();
      const r = surveyPattern(c.pattern!);
      expect(r.finite).toBe(true);
      expect(r.ms).toBeLessThan(BUDGET_MS);
      expect(Number.isFinite(r.A) && Number.isFinite(r.W)).toBe(true);
      expect(['flat', 'cup', 'ruffle']).toContain(r.sim);
      rows.push(`${f.padEnd(34)} count rule ${String(r.analytic).padEnd(6)} sim ${r.sim.padEnd(6)} A ${r.A.toFixed(2)} W ${r.W.toFixed(2)} ${r.converged ? 'converged' : 'NOT converged'}`);
      if (rows.length === files.length) process.stderr.write(`\ncorpus sim (fast tolerances):\n${rows.join('\n')}\n`);
    }, BUDGET_MS * 2);
  }
});
