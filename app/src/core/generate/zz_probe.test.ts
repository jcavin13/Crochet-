import { it } from 'vitest';
import { analyzeFlatness } from '../flatness';
import { paramsFor } from '../params';
import { compilePattern } from '../notation';
const T = (s: string) => {
  const r = compilePattern(s);
  console.log(s.split('\n').slice(-2).join(' | '), '\n  =>', r.diagnostics.map(d => d.severity+' '+d.code+' '+d.message).join('\n     ') || 'OK', r.pattern?.graph.rounds.map(x=>x.stitchCount).join(','));
  return r;
};
it('probe', () => {
  T(`title: t\nRnd 1: mr, ch 3 (counts as dc), 11 dc in ring, join. (12)\nRnd 2: ch 3 (counts as dc), dc in same st, ch 2, *2 dc in next st, ch 2* x11, join. (24 dc, 12 ch-2 sps)\nRnd 3: sl st in next st, sl st in next ch-2 sp, ch 1, sc in same sp, ch 4, *sc in next ch-2 sp, ch 4* x11, join. (12 sc, 12 ch-4 sps)`);
  T(`title: t\nRnd 1: mr, ch 3 (counts as dc), 11 dc in ring, join. (12)\nRnd 2: ch 3 (counts as dc), dc in same st, ch 2, *2 dc in next st, ch 2* x11, join. (24 dc, 12 ch-2 sps)\nRnd 3: sl st in next ch-2 sp, ch 2, 2-dc cl in same sp, ch 3, *3-dc cl in next ch-2 sp, ch 3* x11, join. (12 cl, 12 ch-3 sps)`);
  T(`title: t\nRnd 1: mr, ch 3 (counts as dc), 11 dc in ring, join. (12)\nRnd 2: ch 3 (counts as dc), dc in same st, ch 2, *2 dc in next st, ch 2* x11, join. (24 dc, 12 ch-2 sps)\nRnd 3: sl st in next ch-2 sp, ch 3 (counts as dc), 4 dc in same sp, *5 dc in next ch-2 sp* x11, sk 2 sts, join. (60 dc)`);
  T(`title: t\nRnd 1: mr, ch 3 (counts as dc), 11 dc in ring, join. (12)\nRnd 2: ch 3 (counts as dc), dc in same st, ch 2, *2 dc in next st, ch 2* x11, join. (24 dc, 12 ch-2 sps)\nRnd 3: sl st in next ch-2 sp, ch 3 (counts as dc), 4 dc in same sp, *5 dc in next ch-2 sp* x11, join. (60 dc)`);
  T(`title: t\nRnd 1: mr, ch 3 (counts as dc), 11 dc in ring, join. (12)\nRnd 2: ch 2, puff in same st, ch 1, *puff in next st, ch 1* x11, join. (12 puff, 12 ch-1 sps)\nRnd 3: ch 3, pc in same st, ch 2, *pc in next st, ch 2* x11, join. (12 pc, 12 ch-2 sps)\nRnd 4: ch 1, sc in same st, (2 sc, picot, 2 sc) in next ch-2 sp, *sc in next st, (2 sc, picot, 2 sc) in next ch-2 sp* x11, join, fasten off. (60 sc, 12 picot)`);
  const big = ['title: t', 'Rnd 1: mr, ch 3 (counts as dc), 11 dc in ring, join. (12)'];
  for (let i = 2; i < 16; i++) big.push(`Rnd ${i}: sl st in next ch-5 sp, ch 1, sc in same sp, ch 5, *sc in next ch-5 sp, ch 5* x95, join. (96 sc, 96 ch-5 sps)`);
  big[2] = 'Rnd 2: ch 1, sc in same st, ch 5, *sc in next st, ch 5* x11, join. (12 sc, 12 ch-5 sps)';
  const t0 = performance.now(); for (let i = 0; i < 20; i++) compilePattern(big.join('\n')); console.log('ms/compile', (performance.now() - t0) / 20);
});
