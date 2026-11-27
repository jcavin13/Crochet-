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

describe('honest messages (review R4, R7)', () => {
  const rep = (text: string) => {
    const { pattern, diagnostics } = compilePattern(text);
    if (!pattern) throw new Error(diagnostics.map((d) => d.message).join('\n'));
    return analyzeFlatness(pattern.graph, paramsFor(pattern));
  };
  const fixture = (name: string) => rep(readFileSync(dir + name + '.cro', 'utf8'));

  it('R4: a round flat only by chain compliance is flagged slackOnly and says so', () => {
    // review adv/c04_longloops: 8 sc + ch-12 loops, then ch-20 loops
    const r = rep('Rnd 1: mr, 8 sc in ring. (8)\nRnd 2: *sc in next st, ch 12* x8, join. (8)\nRnd 3: sl st in next ch-12 sp, ch 1, sc in same sp, *ch 20, sc in next ch-12 sp* x7, ch 20, join. (8)');
    const r3 = r.rounds[2];
    expect(r3.class).toBe('flat'); // unchanged classification (the lab mirror agrees on it)
    expect(r3.e).toBeGreaterThan(0.5);
    expect(r3.slackOnly).toBe(true);
    expect(r3.message).toMatch(/^Rnd 3 lies flat only if its chain loops take up the slack \(\+\d+% at nominal loop length\) — expect long, floppy loops\.$/);
  });

  it('solid flat rounds are never slackOnly', () => {
    for (const r of fixture('flat_sc_circle').rounds) expect(r.slackOnly).toBe(false);
    for (const r of fixture('flat_dc_circle').rounds) expect(r.slackOnly).toBe(false);
  });

  it('R7: the closing rounds of a sphere say it is a 3D form, not "78 stitches under flat"', () => {
    const s = fixture('sc_sphere');
    const last = s.rounds[s.rounds.length - 1];
    expect(last.class).toBe('cup');
    expect(last.closing).toBe(true);
    expect(last.message).toBe(`${last.label} closes the shape (far under flat) — this is a 3D form, not a flat piece.`);
    expect(last.stitchesOff).toBeLessThan(-50); // the number itself is unchanged
    expect(s.worst!.message).not.toMatch(/stitches under flat/);
  });

  it('a modest cup still gives the stitch count; a far-under tube says 3D form', () => {
    const cone = fixture('sc_cone');
    const last = cone.rounds[cone.rounds.length - 1];
    expect(last.closing).toBe(false);
    expect(last.message).toMatch(/will cup: about 21 stitches under flat \(−4[34]%\)/);
    const tube = rep('Rnd 1: mr, 6 sc in ring. (6)\nRnd 2: inc x6. (12)\nRnds 3-12: sc in each st around. (12)');
    const t = tube.rounds[tube.rounds.length - 1];
    expect(t.closing).toBe(true);
    expect(t.message).toMatch(/is far under flat \(−\d+%\) — this is a 3D form \(tube, cone or deep bowl\), not a flat piece\./);
  });

  it('R4c: a flat round within tolerance shows its signed stitch difference', () => {
    // review c02_plus3: an sc circle that is +3 at round 7 (tol is 10%, so it reads flat)
    const lines = ['Rnd 1: mr, 6 sc in ring. (6)', 'Rnd 2: inc x6. (12)'];
    for (let k = 3; k <= 6; k++) lines.push(`Rnd ${k}: *${k > 3 ? `sc in next ${k - 2} sts` : 'sc'}, inc* x6. (${6 * k})`);
    lines.push('Rnd 7: *sc in next 3 sts, inc* x9. (45)');
    const r7 = rep(lines.join('\n')).rounds[6];
    expect(r7.class).toBe('flat');
    expect(r7.stitchesOff).toBe(0);
    expect(Math.round(r7.stitchesNominal)).toBe(3);
    expect(r7.message).toBe('Rnd 7 lies flat (+3 sts, within tolerance).');
  });
});
