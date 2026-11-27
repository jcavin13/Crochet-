import { it } from 'vitest';
import { paramSetById } from '../params';
import { generateDoily, randomSpec } from './index';
it('probe', () => {
  for (const [seed, n, s] of [[18010, 18, 10], [24010, 24, 10]]) {
    const P = paramSetById(s % 2 ? 'thread-10_1.5mm' : 'worsted-4_5.0mm')!;
    const spec = randomSpec(seed, { symmetry: n, rounds: (s % 3 === 0 ? [4, 7] : s % 3 === 1 ? [7, 11] : [10, 14]) as any, lacy: (s % 5) / 4, heights: s % 4 === 3 ? ['sc','dc'] : undefined }, { raw: true });
    const r = generateDoily(spec, P);
    console.log(JSON.stringify(spec.rounds));
    console.log(r.rounds.map(x => x.text + '   ' + x.class + ' ' + x.e.toFixed(2) + ' [' + x.eMin.toFixed(2) + ',' + x.eMax.toFixed(2) + ']').join('\n'));
  }
});
