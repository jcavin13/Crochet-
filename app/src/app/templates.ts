// Starting points for "New pattern".
export type Template = { id: string; title: string; description: string; text: string };

export const templates: Template[] = [
  {
    id: 'blank',
    title: 'Blank',
    description: 'Just the header lines.',
    text: `title: Untitled pattern
terms: US
yarn: crochet cotton no. 10
hook: 1.5mm

Rnd 1: mr, 6 sc in ring. (6)
`,
  },
  {
    id: 'flat-circle',
    title: 'Flat circle',
    description: 'The textbook sc circle: +6 per round.',
    text: `title: My flat circle
terms: US
yarn: worsted-4
hook: 5.0mm

Rnd 1: mr, 6 sc in ring. (6)
Rnd 2: inc x6. (12)
Rnd 3: *sc, inc* x6. (18)
Rnd 4: *2 sc, inc* x6. (24)
Rnd 5: *3 sc, inc* x6. (30)
Rnd 6: *4 sc, inc* x6. (36)
`,
  },
  {
    id: 'simple-doily',
    title: 'Simple doily',
    description: 'Sixteen-fold lace start: a chain ring, dc and chain spaces.',
    text: `title: My first doily
terms: US
yarn: crochet cotton no. 10
hook: 1.5mm
params: thread-10_1.5mm

Rnd 1: ch 6, join to form ring, ch 3 (counts as dc), 15 dc in ring, join. (16)
Rnd 2: ch 4 (counts as dc, ch 1), *dc in next st, ch 1* x15, join. (16 dc, 16 ch-1 sps)
Rnd 3: sl st in next ch-1 sp, ch 3 (counts as dc), dc in same sp, ch 1, *2 dc in next ch-1 sp, ch 1* x15, join. (32 dc, 16 ch-1 sps)
Rnd 4: sl st in next dc, sl st in next ch-1 sp, ch 1, sc in same sp, ch 4, *sc in next ch-1 sp, ch 4* x15, join. (16 sc, 16 ch-4 sps)
`,
  },
];
