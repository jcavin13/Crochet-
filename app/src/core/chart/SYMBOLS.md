# Chart symbols

The chart draws every symbol **structurally** from the stitch graph (`symbols.ts`); there is no
table of hand-drawn glyphs. The default set follows the Craft Yarn Council (CYC) chart symbols
(`docs/literature_review.md` §6.2). Glyphs are generated, not copied, so no CYC artwork is bundled.
Publications that use the symbols should credit "Source: Craft Yarn Council www.YarnStandards.com".

## How a symbol is built

| Part | Rule | Source of the rule |
|---|---|---|
| Stem | a line from the **anchor point** (the top of the stitch below, the chain the stitch is worked into, or the ring) to the stitch's **top**; it is as long as the stitch is tall in the layout, so it points outward | CYC: hdc/dc/tr/dtr are a "T" |
| Top bar | a short bar across the top, for hdc and taller | CYC "T" |
| Hatches | **one slash across the stem per yarn-over** drawn: `hatches = tch − 2` from `spec/stitches.json` (hdc 0, dc 1, tr 2, dtr 3) | CYC: "T with one / two / three slashes"; literature review §6.2 "one hatch per yarn-over" |
| sc | `×` (default) or `+` (option `sc: 'plus'`), centred between anchor and top | CYC lists both |
| Decrease (`dc2tog`, `sc3tog`, …) | one leg per anchor, each with its own hatches (sc legs get a small ×), **joined at the top** under one bar | CYC "legs joined at top" |
| Cluster / bobble (`3-dc cl`, `bobble`) | the legs start at one place, bow out and **rejoin at the top** (a lens), hatches on each leg, one bar | CYC cluster |
| Puff (`N-loop puff`) | N curved strokes forming a closed lens from base to top, short bar on top | stitches.json `cyc`: "closed oval of hdc legs joined top and bottom" |
| Popcorn (`N-dc pc`) | N straight legs fanned from one point, closed by an arc on top | stitches.json `cyc`: "5 dc fanned from one point, closed by an oval/arc on top" |
| Chain | open oval along the course (tangent to the arc it lies on; tangential when stacked as a turning chain) | CYC |
| Slip stitch | filled dot | CYC |
| Picot | small loop sitting on top of the previous stitch, closed by a dot at its base; its size grows with the chain count (`ch-5 picot` is larger) | CYC: "small loop of 3 chains closed with a dot" |
| Picot on an arm | on a snowflake / pointed-doily arm (a chain spine worked back along): a pointed loop leaving the spine at about 50°, alternating sides (pairs read as fern fronds), closed by a dot at its base; beside a tip loop at about 90° (trefoil leaves) | drawn the way the picot blocks; leaflet charts draw the same thing as a loop of chain ovals |
| FLO / BLO | a small arc under the stem: FLO `⌣` (opening outward), BLO `⌢` (opening inward) | CYC front-/back-loop marks |
| FP / BP | a hook at the foot of the stem, curling to one side for FP and to the other for BP | CYC post-stitch hooks (the side the hook curls to is a drawing convention; **unverified** against the CYC artwork) |
| Magic ring | a circle with a short tail at the centre | CYC "adjustable ring" |
| Chain ring | its chains as ovals on a circle, the joining slip stitch as a dot | — |

Shells, V-stitches and increases are **not separate symbols**: their stitches fan out from the
shared anchor because the layout spreads stitches worked into one place symmetrically round it.
A turning chain is drawn as its chains stacked from the base to the top of the round (ch 3 = three
ovals); it does not use the stitch symbol it counts as.

### Why `×` for sc by default

The CYC chart page shows sc as either `+` or `×`. We default to `×` because (1) it is the form in
Japanese charts and in most current international pattern books, so a chart reads the same in both
symbol sets; (2) at small sizes a `+` is easily confused with the `T` of an hdc whose bar sits near
its top, while a `×` has no vertical stroke; (3) inc/dec fans of `×` stay legible when rotated.
Users who learned on `+` can switch (Display → `sc +`).

## Symbol sets: `cyc` (default) and `jis`

`symbolSet: 'jis'` follows Japanese chart conventions where they are known to differ. The
literature review (§6.4, unverified §3) could **not confirm** that JIS L 0201 defines crochet
symbols at all, nor obtain an authoritative CYC-vs-Japanese comparison. Every difference below is
therefore marked **unverified**: it reflects common practice in Japanese-published charts and the
notes in `spec/stitches.json` (`jis` field), not the text of the standard.

| Symbol | CYC (default) | JIS set | Status |
|---|---|---|---|
| Slip stitch | filled round dot | filled flattened oval along the course (stitches.json: "filled oval or dot") | unverified |
| Puff | open lens of N strokes | **filled** lens of N strokes (stitches.json: "drawn as a filled lens of 3 strokes") | unverified |
| Popcorn | fan closed by an arc | fan closed by a **filled** cap | unverified |
| Picot | one small loop + dot | a ring of N tiny chain ovals + dot (the picot's chains drawn individually) | unverified |
| BLO | `⌢` arc under the stem | a straight bar under the stem (as for すじ編み in Japanese charts) | unverified |
| FLO | `⌣` arc | same as CYC (no Japanese equivalent found) | unverified |
| sc | `×` / `+` option | `×` (the option still applies) | — |
| ch, hdc, dc, tr, dtr, decreases, clusters | as CYC | same (stitches.json: "same") | stitches.json says "same"; unverified against JIS |

Not implemented (no source found): JIS variants for increases drawn as joined V-shapes with a
short base bar, and the Japanese "reverse sc" (crab stitch), which the notation does not have yet.

## Legend names

The legend and tooltips use the app's US/UK setting. Abbreviations come from `stitches.json`
(`nameOf`); full names: US sc *single crochet*, hdc *half double crochet*, dc *double crochet*,
tr *treble crochet*, dtr *double treble crochet*; UK dc *double crochet*, htr *half treble crochet*,
tr *treble crochet*, dtr *double treble crochet*, trtr *triple treble crochet*.
