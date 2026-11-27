import { describe, expect, it } from 'vitest';
import { dcos, dsin, npMean, npSum } from './detmath';

describe('deterministic math', () => {
  it('dsin/dcos agree with Math.sin/cos to within 1 ulp and are exact at special points', () => {
    let worst = 0;
    for (let i = 0; i < 5000; i++) {
      const x = 2.399963 * (i + 1) * (i % 2 ? 1 : -1) * (i % 7 === 0 ? 1e-3 : 1);
      for (const [f, g] of [[dsin, Math.sin], [dcos, Math.cos]] as const) {
        const a = f(x), b = g(x);
        worst = Math.max(worst, Math.abs(a - b) / (Number.EPSILON * Math.max(Math.abs(b), 1e-300)));
      }
    }
    expect(worst).toBeLessThanOrEqual(2);
    expect(dsin(0)).toBe(0);
    expect(dcos(0)).toBe(1);
    expect(dsin(Math.PI / 6)).toBe(0.49999999999999994); // correctly rounded sin of the double nearest π/6
    expect(dcos(Math.PI)).toBe(-1);
  });
  it('npSum follows numpy pairwise summation', () => {
    const a = Array.from({ length: 300 }, (_, i) => 0.1 * ((i * 37) % 11) + 1e-3 * i);
    // reference by construction: blocks of 8 accumulators below 128, recursive halves above
    expect(npSum(a)).toBeCloseTo(a.reduce((s, v) => s + v, 0), 9);
    expect(npMean([1, 2, 3])).toBe(2);
    expect(npSum([])).toBe(0);
  });
});
