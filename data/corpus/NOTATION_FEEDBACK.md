# Notation v0.1: feedback from writing real lace

Gathered on 2026-11-27 while writing the 16 original patterns in `data/corpus/`. Each item has a
concrete example. Items are **ranked by how much they would matter when transcribing pre-1929
doilies**, the next planned use of the notation (see `data/README.md`, section B). Items marked
*(seeded)* had already been identified before this pass.

Every example was checked against the checker at `app/scripts/check.ts` on 2026-11-27.

## 1. Working into a stitch or space of an earlier round *(seeded)*

Vintage doilies anchor stitches in earlier rounds all the time: "1 dc into the picot of the
previous petal", "1 sc over the loop of the 3rd round, enclosing both", "work in the free back
loops of round 7". v0.1 can only address the target list of the round just finished
(notation.md 3.3, 5).

* `popcorn-ridge-mat-8.cro` Rnd 7 is worked `sc flo`, which leaves the back loops free. A
  surface round in those back loops is normal practice and cannot be written down, so it was
  left out.
* Overlay or "spike" picots and petals tacked to the round two rounds below have no form at all.

Suggested shape: a round qualifier such as `sc in blo of next st of Rnd 6`, or `in next ch-5 sp
of Rnd 3`, giving the cursor its own target list for that round.

## 2. A picot cannot be a target

Picots are not stitch targets (3.3), so "sc in next picot", which is everywhere in vintage edges
and in "join to the corresponding picot", cannot be expressed. The diagnostic also says the wrong
thing: `picot` *is* a stitch name in `stitches.json`.

```
Rnd 2: ch 1, *sc in next st, picot* x8, join. (8 sc, 8 picot)
Rnd 3: ch 1, *sc in next picot, ch 3* x8, join. (8 sc)
→ error E_SYNTAX expected "st", "sp" or a stitch name but found "picot".
```

`uk-terms-wheel-16.cro` Rnd 6 works into the petal stitches next to the picots for this reason.
Suggestion: make a picot expose a space-like target (`next picot`, `next ch-5 picot`), but keep it
out of the stitch count.

## 3. No record of how an ambiguous "repeat from * N times" was resolved *(seeded)*

Rule 3.7 fixes `rep from * N times` to mean N in total, and the transcriber checks it against the
stitch count. But the file never records whether the source meant N or N+1 and which one was
chosen. `rep-from-star-rosette-8.cro` Rnd 7 uses `rep from * 8 times` (8 in total, which the count
of 64 confirms). A vintage source saying "repeat from * 7 times" for the same round would have
to be silently rewritten as `8 times` or `7 more times`. Suggestion: an inline annotation such as
`rep from * 7 times {source: 7, read as 7 more}`, or a per-round `#!resolved:` comment the
compiler keeps in `meta`.

## 4. After a join, "next st" means the joined stitch itself

At the start of a joined round, the cursor stands *before* the stitch the join went into, so
`next st` and `same st` both mean that stitch. That suits "ch 1, sc in same st". But "sl st in next
2 dc" to travel to a corner, as written in almost every vintage and modern pattern, means the two
stitches *after* the one you are on. In `granny-square-motif.cro`
(`Rnd 2: sl st in next 2 sts, sl st in next ch-2 sp, …`) the slip stitches therefore land on dc 1
and dc 2 instead of dc 2 and dc 3. The structure and counts are unaffected, but the chart and sim
anchor them one stitch early. The same happens with `sl st in next dc` in the canonical fixture
`spec/fixtures/simple_doily.cro` Rnd 4. Transcriptions will meet this in nearly every round that
starts with slip-stitch travel, so the rule needs to be settled (and documented) before vintage
work starts.

## 5. No stitch above dtr *(seeded)*

There is no triple treble (US trtr, UK quadruple treble) or longer. Vintage wheels and star
medallions often use "long treble", "triple treble" or "treble of 4/5 overs" for their spokes.
`sunburst-dtr-doily-20.cro` stops at dtr. With `terms: UK`, `trtr` translates to US dtr, so no
UK pattern can use its own triple treble either. Suggestion: a general `trN`/"N-over treble" form,
with height from a formula (≈ 0.9 × N + 1.0 sc heights) rather than a table row.

## 6. Count units cannot tell picot sizes apart *(seeded)*

`(10 picot)` counts ch-3 and ch-5 picots alike. `puff-star-coaster-5.cro` Rnd 4 has five plain
and five ch-5 picots, and `spiderweb-doily-10.cro` Rnd 12 mixes 90 plain picots with ch-5 picots at the points. The count
`(5 ch-5 picot)` is not available, by analogy with `ch-5 sps`. Vintage patterns specify picot
length precisely ("picot of 5", "long picot of 7") because it decides whether a border lies flat.

## 7. Beginning stitches have no proper form (beginning cluster, beginning dec, beginning V)

A crocheter writes "ch 2, dc in next st (counts as beg dc2tog)", "ch 3, 2-dc cl in same sp (beg
cluster)" or "ch 4 (counts as dc, ch 1), dc in same st (beg V)". In v0.1:

* `spiderweb-doily-10.cro` Rnd 5 and `wheel-mesh-centrepiece-8.cro` Rnds 7-9 had to be
  written `ch 2, *dc2tog, …`, with a non-counting ch 2 followed by a full dc2tog, so the beginning
  chain is not part of the decrease.
* `hexagon-motif-6.cro` (`ch 2, 2-dc cl in same sp`) gets a 2-leg cluster node plus a separate,
  non-counting ch 2, so the graph never learns that the chain is the cluster's first leg.
  `bobble-flower-coaster-6.cro` (`ch 3, bobble in same st`) is written as a full 5-leg bobble
  after the ch 3. There is no "ch counts as one leg of the cluster" form.
* `solid-centre-lace-border-24.cro` Rnd 8 begins `ch 4 (counts as dc, ch 1), dc in same st`, so
  only 23 of the 24 Vs are `v-st` groups and the count has to say `(23 v-sts)`.
  `teaching-ruffle-shell-doily.cro` and `sunburst-dtr-doily-20.cro` avoid this with
  `ch 3 (does not count as st), shell in same st`, which is less usual wording.

Suggestion: `(counts as beg cl)` / `(counts as first leg)` / `(counts as v-st)` notes.

## 8. No smoothing slip stitch at the end of a spiral

The common "sl st in next st" that ends a spiral before a joined edging works into the *first
stitch of the current round*, which is not in the previous round's target list:

```
Rnd 5: *sc in next 3 sts, 2 sc in next st* x6, sl st in next st. (30)
→ error E_NO_TARGET Rnd 5: needs a stitch to work into but Rnd 4 has none left.
```

`spiral-sc-mat-fan-edge.cro` Rnd 8 uses `join` instead, which turns that spiral round into a
joined round.

## 9. Count units for tog stitches

`(20 tr3tog)` gives info `I_COUNT_UNVERIFIED` ("the compiler does not count that unit"), even though
3.8 says a stitch name counts nodes of that type. `sunburst-dtr-doily-20.cro` Rnd 5 writes
`(20 tr, 20 sc)` instead, which passes because a tog node has its base type. Then a cluster
(`3-tr cl` = tr3tog with `tag: cluster`) and an ordinary tr2tog over stitches cannot be told
apart in a count, except by the `cl` unit. Suggestion: accept `dec`, `tog`, and `<st>Ntog` as count
units.

## 10. Strict space lengths need explicit skips

`next ch-1 sp` is an error if the next space is a ch-2 (3.3), so a round that alternates space
lengths has to name every skipped space (`petal-doily-12.cro` Rnd 8: `ch 2, sk next ch-2 sp,
3-tr cl in next ch-1 sp, …`). This is good as a check, but vintage text says "into the next loop
of 1 ch" and leaves the reader to pass over the other loops. A transcriber will either add skips
(an editorial change) or fall back to plain `next sp`, losing the check. A
`next ch-1 sp, passing others` style form, or an info rather than an error when spaces are passed,
would help.

## 11. Smaller points

* **Count annotations with a repeated unit** are each checked against the whole round, not
  added together. `(64 sts, 16 tr, 8 ch-3 sps, 8 ch-3 sps)` fails twice. That is reasonable, but
  vintage counts are often phrased per kind ("8 loops of 3 ch between the petals and 8 at the
  points"). A way to qualify a unit by position would help.
* **Range labels need an identical count**: `Rnds 10-11:` in `wheel-mesh-centrepiece-8.cro`
  works because the mesh does not grow. "Repeat the last round 3 times, adding 1 ch to each loop
  each time" (common in vintage mesh) needs one line per round.
* **Joining motifs** (granny and hexagon join-as-you-go) are out of scope (5) and keep
  `granny-square-motif.cro` and `hexagon-motif-6.cro` single motifs. Vintage "wheel" tablecloths are
  mostly joined motifs.
* **Flatness of cornered motifs**: as flatness.md says, rounds are circles. For the granny square
  and hexagon here, the chain-space corners keep the analytic numbers inside tolerance anyway. A
  solid-dc square (no corner spaces) would read as "over".
