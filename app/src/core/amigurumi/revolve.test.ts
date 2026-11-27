import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compilePattern } from '../notation';
import { analyzeFlatness } from '../flatness';
import { paramsFile, paramSetById } from '../params';
import {
  PRESETS, presetProfile, revolve, spreadEvenly, specialGaps, specialAngles, compressUnits, sampleProfile, pointAt,
  AMI_STITCHES, type Unit,
} from './index';

const worsted = paramSetById('worsted-4_5.0mm')!;
const circDist = (a: number, b: number) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };

function compileClean(text: string) {
  const c = compilePattern(text);
  const bad = c.diagnostics.filter((d) => d.severity !== 'info');
  expect(bad.map((d) => `${d.code} ${d.message}`), text).toEqual([]);
  expect(c.pattern).toBeDefined();
  return c.pattern!;
}

describe('profile sampling', () => {
  it('a 7-point spline sphere is within 0.5% of the circle and meets the axis square', () => {
    const sp = sampleProfile(presetProfile('sphere', 62));
    for (const p of sp.pts) expect(Math.abs(Math.hypot(p.r, p.z - 31) - 31)).toBeLessThan(0.16);
    expect(sp.length).toBeCloseTo(Math.PI * 31, 0);
    const t = pointAt(sp, 0.01);
    expect(Math.abs(t.tz)).toBeLessThan(0.02); // tangent along +r at the pole
  });
  it('corners are reported with their turning angle', () => {
    const sp = sampleProfile(presetProfile('cylinder'));
    expect(sp.corners).toHaveLength(1);
    expect(sp.corners[0].angle).toBeCloseTo(Math.PI / 2, 2);
  });
});

describe('spreadEvenly', () => {
  it('textbook spacing when stacked', () => {
    const r = spreadEvenly(18, 24);
    expect(compressUnits(r.units, 'sc')).toBe('*2 sc, inc* x6');
    expect(compressUnits(spreadEvenly(30, 24).units, 'sc')).toBe('*3 sc, dec* x6');
    expect(compressUnits(spreadEvenly(6, 12).units, 'sc')).toBe('inc x6');
    expect(compressUnits(spreadEvenly(12, 6).units, 'hdc')).toBe('hdc2tog x6');
  });
  it('gaps differ by at most one for every (prev, next) pair', () => {
    for (let prev = 3; prev <= 80; prev++) {
      for (let next = Math.ceil(prev / 2); next <= 2 * prev; next++) {
        for (const stagger of [false, true]) {
          const r = spreadEvenly(prev, next, { stagger, history: [[0.1, 0.4, 0.7]] });
          const consumed = r.units.reduce((a, u) => a + (u === 'dec' ? 2 : 1), 0);
          const made = r.units.reduce((a, u) => a + (u === 'inc' ? 2 : 1), 0);
          expect(consumed).toBe(prev);
          expect(made).toBe(next);
          const g = specialGaps(r.units);
          if (g.length) expect(Math.max(...g) - Math.min(...g)).toBeLessThanOrEqual(1);
        }
      }
    }
  });
  it('refuses more than doubling or halving', () => {
    expect(() => spreadEvenly(6, 13)).toThrow();
    expect(() => spreadEvenly(13, 6)).toThrow();
  });
  it('staggering puts increases midway between the previous round\'s', () => {
    const a = spreadEvenly(18, 24);
    const b = spreadEvenly(24, 30, { stagger: true, history: [a.angles] });
    const minD = Math.min(...b.angles.flatMap((x) => a.angles.map((y) => circDist(x, y))));
    expect(minD).toBeGreaterThan(0.06); // ≈ half of the 1/6 spacing; stacked would be ≈ 0.01
    const stacked = spreadEvenly(24, 30);
    const minS = Math.min(...stacked.angles.flatMap((x) => a.angles.map((y) => circDist(x, y))));
    expect(minS).toBeLessThan(0.03);
  });
});

describe('compressUnits', () => {
  const U = (s: string) => s.split('').map((c) => (c === 'i' ? 'inc' : c === 'd' ? 'dec' : 'st')) as Unit[];
  it('round-trips through the compiler for odd sequences', () => {
    for (const seq of ['ssisssisssis', 'sisisissi', 'sssssssssssssssssi', 'iisii', 'sdsdssdsssd']) {
      const units = U(seq);
      const prev = units.reduce((a, u) => a + (u === 'dec' ? 2 : 1), 0);
      const next = units.reduce((a, u) => a + (u === 'inc' ? 2 : 1), 0);
      const text = `title: t\n\nRnd 1: mr, ${prev} sc in ring. (${prev})\nRnd 2: ${compressUnits(units, 'sc')}. (${next})\n`;
      compileClean(text);
    }
  });
  it('prefers whole runs to split ones', () => {
    expect(compressUnits(U('sssisssssssisssssssiss'), 'sc')).not.toMatch(/\d sc, \*\d sc/);
  });
});

describe('revolve: every preset × gauge × stitch compiles cleanly', () => {
  for (const params of paramsFile.sets) {
    for (const stitch of AMI_STITCHES) {
      it(`${params.id} ${stitch}`, () => {
        for (const p of PRESETS) {
          for (const stagger of [true, false]) {
            const r = revolve({ profile: presetProfile(p.id), params, stitch, stagger, title: p.label });
            const pat = compileClean(r.text);
            const rounds = pat.graph.rounds.filter((x) => x.kind === 'round' && x.stitchCount > 0);
            expect(rounds.map((x) => x.stitchCount)).toEqual(r.rounds.map((x) => x.count));
            expect(pat.meta.source).toBe('generated (surface of revolution)');
            // counts follow N_k = round(2πr/w) except where a limit is reported
            for (const x of r.rounds.slice(1)) {
              if (x.clamped || x.exact === 0) continue;
              const lastClosing = r.closedEnd && x.n === r.rounds.length;
              if (!lastClosing) expect(Math.abs(x.count - x.exact)).toBeLessThanOrEqual(0.5 + 1e-9);
            }
            // even spacing every round
            for (const x of r.rounds) {
              const g = specialGaps(x.units);
              if (g.length) expect(Math.max(...g) - Math.min(...g)).toBeLessThanOrEqual(1);
            }
            if (r.closedEnd) {
              expect(r.rounds[r.rounds.length - 1].count).toBeLessThanOrEqual(8);
              expect(r.text).toMatch(/Stuff firmly/);
            }
          }
        }
      });
    }
  }
});

describe('revolve: shape', () => {
  it('realised profile stays within one round height of gentle targets (worsted sc)', () => {
    for (const id of ['sphere', 'egg', 'bowl', 'bead', 'pear', 'cone', 'mushroom']) {
      const r = revolve({ profile: presetProfile(id), params: worsted });
      expect(r.maxDistance, id).toBeLessThan(r.h);
      expect(r.dims.heightMm / r.targetDims.heightMm, id).toBeGreaterThan(0.85);
      expect(r.dims.heightMm / r.targetDims.heightMm, id).toBeLessThan(1.15);
      expect(r.dims.diameterMm / r.targetDims.diameterMm, id).toBeCloseTo(1, 1);
    }
  });

  it('stagger: consecutive increase rounds do not stack (sphere, symmetric repeats)', () => {
    const big = presetProfile('sphere', 120);
    const st = revolve({ profile: big, params: worsted, repeat: 6 });
    const sk = revolve({ profile: big, params: worsted, repeat: 6, stagger: false });
    const minDist = (r: typeof st) => {
      const inc = r.rounds.filter((x) => x.kind === 'inc' && x.prev >= 12);
      const ds: number[] = [];
      for (let i = 1; i < inc.length; i++) {
        if (inc[i].n !== inc[i - 1].n + 1) continue;
        const a = specialAngles(inc[i - 1].units, inc[i - 1].count), b = specialAngles(inc[i].units, inc[i].count);
        ds.push(Math.min(...b.flatMap((x) => a.map((y) => circDist(x, y)))));
      }
      return ds;
    };
    const dSt = minDist(st), dSk = minDist(sk);
    expect(dSt.length).toBeGreaterThan(3);
    for (const d of dSt) expect(d).toBeGreaterThan(1 / 6 / 4); // at least a quarter repeat apart
    expect(Math.min(...dSk)).toBeLessThan(1 / 6 / 4);       // stacked: on top of each other
    expect(st.rounds.some((x) => x.offset > 0)).toBe(true);
    expect(sk.rounds.every((x) => x.offset === 0)).toBe(true);
  });

  it('flat disc base is flat, sphere cups (analyzeFlatness)', () => {
    const disc = revolve({ profile: { points: [{ r: 0, z: 0 }, { r: 60, z: 0 }], smooth: false }, params: worsted });
    expect(disc.rounds.map((x) => x.count)).toEqual([6, 12, 18, 24, 30, 36, 42, 48, 54, 58]);
    const f = analyzeFlatness(compileClean(disc.text).graph, worsted);
    expect(f.rounds.every((x) => x.class === 'flat')).toBe(true);
    const base = revolve({ profile: presetProfile('cylinder'), params: worsted });
    const fb = analyzeFlatness(compileClean(base.text).graph, worsted);
    expect(fb.rounds.slice(0, 4).every((x) => x.class === 'flat')).toBe(true);
    expect(fb.final).toBe('cup'); // the walls
    const sph = revolve({ profile: presetProfile('sphere'), params: worsted });
    const fs = analyzeFlatness(compileClean(sph.text).graph, worsted);
    expect(fs.final).toBe('cup');
    expect(fs.rounds.filter((x) => x.class === 'cup').length).toBeGreaterThan(fs.rounds.length / 2);
  });

  it('open start begins with a chain ring; open end has no stuffing note', () => {
    const tubeProfile = { points: [{ r: 20, z: 0 }, { r: 20, z: 60 }], smooth: false };
    const r = revolve({ profile: tubeProfile, params: worsted });
    expect(r.start).toEqual({ kind: 'chain', count: 19 });
    expect(r.text).toMatch(/Foundation: ch 19, join with sl st in first ch\./);
    expect(r.text).toMatch(/Rnd 1: sc in each ch around\. \(19\)/);
    expect(r.text).toMatch(/Rnds 2-9: sc in each st around\. \(19\)/);
    expect(r.text).not.toMatch(/Stuff/);
    compileClean(r.text);
  });

  it('cylinder: back-loop round at the base corner', () => {
    const r = revolve({ profile: presetProfile('cylinder'), params: worsted });
    expect(r.rounds.filter((x) => x.blo)).toHaveLength(1);
    expect(r.text).toMatch(/sc blo in each st around/);
    const off = revolve({ profile: presetProfile('cylinder'), params: worsted, crispCorners: false });
    expect(off.text).not.toMatch(/blo/);
  });

  it('re-entrant profile (mushroom underside) works with arc-length stepping', () => {
    const r = revolve({ profile: presetProfile('mushroom'), params: worsted });
    expect(r.warnings.find((w) => w.code === 'overhang')).toBeUndefined();
    const peak = Math.max(...r.rounds.map((x) => x.count));
    expect(r.rounds[r.rounds.length - 1].count).toBeLessThan(peak * 0.5); // turned back inward
  });
});

describe('revolve: warnings', () => {
  it('equal-height stepping cannot follow a flat base (steep) or an overhang', () => {
    const r = revolve({ profile: presetProfile('cylinder'), params: worsted, stepping: 'height' });
    expect(r.warnings.map((w) => w.code)).toContain('steep');
    expect(r.rounds.some((x) => x.clamped === 'rate')).toBe(true);
    compileClean(r.text);
    const m = revolve({ profile: presetProfile('mushroom'), params: worsted, stepping: 'height' });
    expect(m.warnings.map((w) => w.code)).toContain('overhang');
    // arc length handles both
    const a = revolve({ profile: presetProfile('cylinder'), params: worsted });
    expect(a.warnings.filter((w) => w.severity === 'warning')).toEqual([]);
  });
  it('a too-small magic ring hits the doubling limit', () => {
    const r = revolve({ profile: { points: [{ r: 0, z: 0 }, { r: 50, z: 0 }], smooth: false }, params: worsted, startCount: 3 });
    expect(r.warnings.map((w) => w.code)).toContain('double');
    expect(r.rounds[1].count).toBe(6);
    compileClean(r.text);
  });
  it('a dc closed end gets one more round of decreases to close', () => {
    const r = revolve({ profile: presetProfile('sphere'), params: worsted, stitch: 'dc' });
    expect(r.warnings.find((w) => w.code === 'end')?.severity).toBe('info');
    expect(r.rounds[r.rounds.length - 1].count).toBe(6);
    compileClean(r.text);
  });
});

describe('revolve: sphere vs. the textbook sphere (spec/fixtures/sc_sphere.cro)', () => {
  const fixture = readFileSync(fileURLToPath(new URL('../../../../spec/fixtures/sc_sphere.cro', import.meta.url)), 'utf8');
  const textbook = compileClean(fixture).graph.rounds.map((r) => r.stitchCount);

  it('textbook: 6-12-18-24-30, 5 even, back down (14 rounds, 300 sts)', () => {
    expect(textbook).toEqual([6, 12, 18, 24, 30, 30, 30, 30, 30, 30, 24, 18, 12, 6]);
  });

  it('a true sphere of the same equator (30 sc ≈ 6.2 cm) has the same size and stitch budget', () => {
    const r = revolve({ profile: presetProfile('sphere', 62), params: worsted });
    const counts = r.rounds.map((x) => x.count);
    expect(counts[0]).toBe(6);
    expect(Math.abs(counts[1] - 12)).toBeLessThanOrEqual(1);
    expect(Math.max(...counts)).toBe(30);
    expect(counts.length).toBeGreaterThanOrEqual(14);
    expect(counts.length).toBeLessThanOrEqual(16);
    expect(counts).toEqual([...counts].reverse()); // symmetric
    const total = textbook.reduce((a, b) => a + b, 0);
    expect(Math.abs(r.totalStitches - total) / total).toBeLessThan(0.1);
    // the difference: the true sphere widens like a sine, the textbook at the flat-disc rate
    // (+6 a round) then stays at 30 — a disc, a cylinder and a disc that stuffing rounds out.
    expect(counts[2]).toBeLessThan(18);
  });

  it('with symmetric repeats (multiples of 6, stacked) it is the textbook pattern in shape', () => {
    const r = revolve({ profile: presetProfile('sphere', 62), params: worsted, repeat: 6, stagger: false });
    const counts = r.rounds.map((x) => x.count);
    expect(counts.slice(0, 4)).toEqual([6, 12, 18, 24]);
    expect(Math.max(...counts)).toBe(30);
    expect(counts.slice(-4)).toEqual([24, 18, 12, 6]);
    expect(r.text).toMatch(/Rnd 3: \*sc, inc\* x6\. \(18\)/);
    expect(r.text).toMatch(/Rnd 4: \*2 sc, inc\* x6\. \(24\)/);
    expect(r.text).toMatch(/\*3 sc, inc\* x6\. \(30\)/);
    expect(r.text).toMatch(/\*3 sc, dec\* x6\. \(24\)/);
    expect(r.text).toMatch(/dec x6, fasten off\. \(6\)/);
  });
});
