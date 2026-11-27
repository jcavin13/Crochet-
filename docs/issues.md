# Open issues and decisions

A running list, kept by the build. Newest state as of 2026-11-27. Closed items move to the bottom.
See also `docs/review.md` (independent review of Phase 1), `docs/decisions.md` (decisions already
made) and `docs/roadmap.md` (planned phases).

## Decisions waiting for the owner

| # | Decision | Why it is yours | Where to read more |
|---|---|---|---|
| D1 | **Licence for the code.** There is no LICENSE file; the repository is public. Until one is added, others can read the code but not legally reuse it. | Choosing a licence is the owner's call. | `docs/decisions.md` 21 |
| D2 | **Change the general flatness rule?** It overstates the radius by 6–17 % when several stitches share one chain loop. Fixed only in the snowflake sizing so far. Changing it changes what the doily designer and the flatness band call "flat". | Affects every doily, the lab mirror and the golden reference files. | `docs/flatness_radius_note.md` |
| D3 | **Should a square with plain `2 sc in next st` corners count as a polygon?** The corner detector is conservative and rejects it, so such squares (including the studio's own mitred square in its last round) are judged, charted and simulated as circles. | Loosening the detector risks treating ordinary increases in doilies as corners. | `spec/flatness.md` v0.2, `app/src/core/flatness/corners.ts` |
| D4 | **Vintage public-domain corpus.** Not gathered: the build environment blocks gutenberg.org and archive.org. Needs those two hosts allowed for the environment. | Needs a network-settings change only the owner can make. | `data/README.md` section B |
| D5 | **Where `next st` starts after a join.** Today it is the stitch the join went into; many crocheters read "sl st in next st" as the one after. | A notation-semantics change that would alter existing patterns' graphs. | `docs/decisions.md` 15 |

## Known issues

### Snowflakes
- **S1** — 13 of 80 random designs over-stretch when pinned to their template (14–21 % in the loops under the arms; 7 are 5-pointers). Shown as "needs a look"; the template cannot predict them yet. The test threshold was lowered from 95 % to 80 % to match.
- **S2** — Variations gallery takes about 2 s for 12 designs (each solves for its body shape).
- **S3** — Valley chains pin with 15 % slack (an engineering margin), so they sag slightly instead of sitting taut.
- **S4** — Notation limits: arm branches are picots only, arms must be the last round (cannot return to a chain spine after a branch; a picot cannot be worked into).
- **S5** — Chart: on 5-point designs with valley anchors the valley chains read as two lobes; the one-arm view is tall and narrow for 12-point pieces.

### Yarn estimates
- **Y1** — The model is unvalidated against real yarn: nominal figures are about ±20 % until a swatch is weighed. The ±8 % / ±6 % calibrated bands are assumptions, not measured.
- **Y2** — dc throws come out about 18–20 % above the commonly quoted "about 2000 yd".
- **Y3** — Post-stitch factor (1.2) and popcorn closing are guesses; one tension is assumed for the whole piece; ball-break warnings assume the first ball was full.

### Blankets
- **B1** — Not expressible in the notation: corner-to-corner (C2C), crab stitch (reverse sc), motif joins (described in words only).
- **B2** — Colours are annotations beside the pattern, not part of the stitch graph.
- **B3** — Above 50 000 stitches only a swatch is compiled and charted (size, counts and yarn stay exact). The stitch-by-stitch counter is offered up to 20 000 stitches.
- **B4** — The studio's results panel does not list the 3D per-region verdict (body / sides / corners); the embedded 3D view shows it as one line. API: `regionShape()` / `SimView` `onStatus → status.regions`.
- **B5** — Preview polish: borders look thin at blanket scale; shell and picot edges are drawn straight; granny-square preview is plain nested bands.
- **B6** — The moss-stitch *swatch* puckers at its sides in 3D (the 6-row swatch's own edge fit is −12 %); the full blanket fits.

### Chart
- **C1** — Ripple rows are drawn flat rather than as zigzags.
- **C2** — Border-round labels bunch up at the start corner; a 3-sc corner reads as a short diagonal at small sizes.
- **C3** — Circle-to-square switches shape abruptly at the squaring round; rectangle-in-the-round is drawn as a stadium.
- **C4** — Closing rounds of spheres read poorly (long decrease legs).
- **C5** — "JIS" symbol style is unverified against the standard.

### 3D / physics
- **P1** — The 3D view is a tendency, not a verdict: weak bending resistance makes it over-sensitive; it disagrees with the count rule on 4 of 16 corpus patterns (`docs/sim_corpus_report.md`). `tau_flat` was tuned on the fixtures.
- **P2** — Circle-to-square still reads as cupping (A 0.37); the generated mitred square ruffles (see D3); a 22 cm hexagon can settle in a shallow fold.
- **P3** — No self-collision, gravity (except the optional "resting on a table" view) or stuffing: the sphere relaxes like an empty bag.
- **P4** — Cross-machine: shape numbers differ by a few 1e-3 between CPUs; sphere and hyperbolic-plane agreement between the two sims is fragile (several stable states).

### Flatness check and assistant
- **F1** — Lace check is lenient by construction: most lace rounds pass only as "flat (loose loops)".
- **F2** — Polygon and border rules exist in the app only; the Python lab's flatness mirror has not been updated.
- **F3** — Ovals and pointed rounds are still judged as circles.
- **F4** — The fix assistant inherits F1 and can suggest a shorter chain than a designer would choose.

### Data, docs, infrastructure
- **I1** — Stitch parameters are nominal; no real swatch measured; the swatch photo tool is validated on synthetic photos only.
- **I2** — Literature review: citations checked through search metadata; DOIs not resolved live. Unconfirmed items listed at the end of the review.
- **I3** — `docs/screenshots/` is about 46 MB; the per-preset snowflake matrix is git-ignored and regenerated on demand.
- **I4** — Counter: "< 1 min left" hint and reload-at-checkpoint prompt not done (review N7).
- **I5** — Stiffness fitting is a stub (needs load tests).

## Closed

- Snowflake 3D view was a tangle (user screenshot, `docs/feedback/`): arms modelled as two cords of different lengths → now one stiff cord; pinned to template; top-down view.
- Blocking template too large on three presets (15–26 % stretch) → all presets ≤ 11 %.
- Picots drawn as bowties → loops. Tab row showing through the phone top bar → opaque.
- Chart drew snowflake arms on a circle → radial spines, one-arm view.
- Flat squares and hexagons read as "ruffles" → polygon rule.
- `turn` at the start of a border round applied to the following round → fixed.
- Blanket without a border wrote "Fasten off" on a row-range line → final row split out.
- Corpus slip in `sunburst-dtr-doily-20` Rnd 8 (found by symmetry analysis) → corrected.
- Lab CI failed on GitHub's runner (CPU-dependent metrics, BLAS threads) → tolerant comparison, single-thread.
- Review findings R3, R5, R6, R10, R11, R13–R16, R19, R21, R23 → fixed (see `docs/review.md` and the README).
