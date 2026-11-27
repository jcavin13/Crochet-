import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyzeFlatness } from './index';
import { paramsFor } from '../params';
import { compilePattern } from '../notation';

const dir = fileURLToPath(new URL('../../../../spec/fixtures/', import.meta.url));
const names = readdirSync(dir).filter((f) => f.endsWith('.cro')).map((f) => f.slice(0, -4));

describe('analytic flatness on fixtures', () => {
  for (const name of names) {
    it(name, () => {
      const { pattern } = compilePattern(readFileSync(dir + name + '.cro', 'utf8'));
      const expected = JSON.parse(readFileSync(dir + name + '.expected.json', 'utf8'));
      const rep = analyzeFlatness(pattern!.graph, paramsFor(pattern));
      expect(rep.final).toBe(expected.analytic.final);
      if (expected.analytic.rounds) {
        rep.rounds.forEach((r, i) => {
          expect(r.class, r.label).toBe(expected.analytic.rounds[i].class);
          expect(r.e).toBeCloseTo(expected.analytic.rounds[i].excess, 2);
        });
      } else {
        for (const r of rep.rounds) expect(r.class, r.message + JSON.stringify(r)).toBe('flat');
      }
    });
  }
  it('says how many stitches off', () => {
    const { pattern } = compilePattern('Rnd 1: mr, 6 sc in ring. (6)\nRnd 2: inc x6. (12)\nRnd 3: inc x12. (24)\n');
    const rep = analyzeFlatness(pattern!.graph, paramsFor(pattern));
    expect(rep.rounds[2].class).toBe('ruffle');
    expect(rep.rounds[2].message).toMatch(/Rnd 3 will ruffle: about 6 stitches over flat/);
  });
});
