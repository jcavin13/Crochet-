import { compilePattern } from '../src/core/notation';
const base = `title: t\n\nRnd 1: mr, 6 sc in ring. (6)\nRnd 2: inc x6. (12)\n`;
const tests: Record<string,string> = {
  a: base + `Rnd 3: sc blo in each st around. (12)\n`,
  b: base + `Rnd 3: blo sc in each st around. (12)\n`,
  c: base + `Rnd 3: *2 inc, 2 sc* x3. (18)\n`,
  d: base + `Rnd 3: *inc x2, 2 sc* x3. (18)\n`,
  e: base + `Rnd 3: *sc, inc, sc* x4. (16)\n# stuff\nRnd 4: *2 dec, 4 sc* x2. (12)\nRnd 5: *dec x2, 2 sc* x3. (9)\n`,
  f: `title: t\n\nRnd 1: mr, 8 hdc in ring. (8)\nRnd 2: *2 hdc inc, 2 hdc* x2. (12)\nRnd 3: *hdc inc x2, hdc* x4. (20)\nRnd 4: 4 hdc2tog, 12 hdc. (16)\nRnd 5: hdc blo in each st around. (16)\nRnd 6: 16 hdc. (16)\n`,
  g: `title: t\n\nRnd 1: mr, 12 dc in ring. (12)\nRnd 2: 2 dc inc, 10 dc. (14)\nRnd 3: 2 dc2tog, 10 dc. (12)\nRnd 4: dc blo in each st around. (12)\n`,
  h: base + `Rnds 3-4: sc in blo of each st around. (12)\n`,
};
for (const [k, t] of Object.entries(tests)) {
  const r = compilePattern(t);
  const p = r.pattern;
  console.log(k, p ? 'OK' : 'FAIL', p?.graph.rounds.map(x=>x.stitchCount).join(','), p ? [...new Set(p.graph.nodes.map(n=>n.type+(n.loop?':'+n.loop:'')))].join(' ') : '', r.diagnostics.map(d=>`${d.severity} ${d.code} ${d.message}`).join(' | '));
}
