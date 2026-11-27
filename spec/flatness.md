# Analytic flatness check, v0.2

A fast, closed-form prediction per round — no simulation — of whether a piece worked in the
round lies flat, cups (too few stitches: positive curvature) or ruffles (too many: negative
curvature), and by how many stitches. Implemented in `app/src/core/flatness` and mirrored in
`lab/` for the reports. Constants are in `sim_config.json → flatness`.

Three rules, chosen per round from the graph alone (`RoundFlatness.shape`):

| shape | rounds | rule |
|---|---|---|
| `circle` | rounds worked round a centre (the default) | the circle rule below |
| `polygon` | squares, hexagons, octagons… worked from the centre, from their first cornered round on | the polygon rule ("Polygons") |
| `border` | rounds worked round a piece made in rows (notation.md 3.9) | edge fit per side + corner rule per corner ("Borders") |
| `rows` | rows, foundation chains | none (`n/a`: no centre) |

**TypeScript only for now.** The polygon and border rules are implemented in `app/src/core/flatness`
(`index.ts`, `corners.ts`, `polygon.ts`) only; the lab's Python mirror (`lab/src/crolab/flatness.py`)
implements the circle rule and is pinned on the 7 fixtures, none of which has corners or rows —
so for them every round is `circle` (or `rows`) and their golden files are unchanged. The lab
mirror of the polygon and border rules is pending.

## Idea

A flat disc has circumference 2πr at geodesic radius r. Round k sits at radius
ρ_k (sum of the heights of the rounds so far) and offers a course length C_k (sum of the widths
of its stitches). By Gauss–Bonnet, C_k < 2πρ_k means positive total curvature inside round k
(cup); C_k > 2πρ_k means negative (ruffle).

## Definitions

For round k (index from 1; only rounds worked around a centre — for rows the result is `n/a`):

* **Course elements**: stitch-counting nodes (notation.md 3.8) contribute their width w (a turning
  chain that counts as X contributes the width of X); chain
  nodes that belong to a chain space of this round contribute between `chain_slack_min`·w_ch
  (a sagging loop) and w_ch (taut). Turning chains, slip stitches and picots contribute nothing.
  This gives C_k^min, C_k^max, and a nominal C_k using `chain_nominal`·w_ch.
* **h̄_k**: mean height of the stitch-counting nodes of the round (if the round has none — a round
  of chains and slip stitches only — h̄_k = 0).
* **Start radius r_0**: magic ring: 0. Chain ring of n chains: n·w_ch/(2π). (No ring: 0.)
* **Stitch-top radius** ρ_k = r_{k−1} + h̄_k. Exception, round 1 into a magic ring:
  ρ_1 = max(h̄_1, C_1/(2π)) (same rule as physics.md), so round 1 is flat by construction.
* **Arc rise**: if the round has chain spaces, the chord available to each is
  d = max(0, 2πρ_k − Σ stitch widths) / (number of spaces); the mean space has chain length
  L = (mean chains per space)·w_ch. If L > d the loops stand outward by
  rise_k = ½·sqrt(L² − d²); otherwise rise_k = 0.
* **Radius handed to the next round** r_k = ρ_k + rise_k.

## Classification

```
e_max = C_k^max / (2πρ_k) − 1        e_min = C_k^min / (2πρ_k) − 1
cup     if e_max < −tol     → short by  (2πρ_k − C_k^max) / w̄   stitches
ruffle  if e_min > +tol     → over by   (C_k^min − 2πρ_k) / w̄   stitches
flat    otherwise
```

w̄ = mean width of the round's stitch-counting nodes (or of its chains if it has none). For solid
fabric C^min = C^max = Σw and this reduces to "N_k versus 2πρ_k / w" — about +6 per round for sc,
+8 for hdc, +12 for dc. Also reported: the incremental ratio
g_k = (C_k − C_{k−1}) / (2π·(ρ_k − ρ_{k−1})) − 1, which says whether *this round's increases* are
right for flat regardless of earlier rounds (g = −1: a tube; g = −0.5: a 60° cone).

### Flags and messages

The classification and the numeric fields above (`class`, `eMin`, `eMax`, `e`, `rho`, `r`,
`stitchesOff`, `g`, …) are what the lab mirror and `expected.json` compare. Two extra per-round
flags, and one extra number, only change how a round is *described*:

* `stitchesNominal` = (C_k − 2πρ_k) / w̄ at the nominal course length, signed, for every
  classified round (`stitchesOff` stays 0 for flat rounds).
* `slackOnly` — the round is classified **flat only thanks to chain compliance**: its nominal
  excess e is outside ±tol, but the chain-slack band [e_min, e_max] reaches back inside it. Such a
  round lies flat only if its loops sag (e > tol) or are pulled taut (e < −tol). The chart band
  draws it hatched over the flat tint, labelled **flat (loose loops)**, and the designer's solver
  ranks such candidates after every truly flat one.
* `closing` — a cupping round that is far beyond "add a few stitches": its stitch count is lower
  than the previous round's (the shape is closing, as in a ball) or e_max < −50 % (`CLOSING_E`;
  a tube, cone or deep bowl). The absolute deficit is meaningless to a crocheter there.

Messages the UI uses (one per round, the first that applies):

| case | message |
|---|---|
| flat, \|e\| ≤ tol | `Rnd 7 lies flat.` or, when round(stitchesNominal) ≠ 0, `Rnd 7 lies flat (+3 sts, within tolerance).` |
| flat, slackOnly, e > 50 % | `Rnd 4 lies flat only if its chain loops take up the slack (+123% at nominal loop length) — expect long, floppy loops.` |
| flat, slackOnly, tol < e ≤ 50 % | `Rnd 4 lies flat only if its chain loops sag a little (+14% at nominal loop length).` |
| flat, slackOnly, e < −tol | `Rnd 6 lies flat only if its chain loops are pulled taut (−22% at nominal loop length) — expect tight, strained loops.` |
| cup, closing, decreasing | `Rnd 14 closes the shape (far under flat) — this is a 3D form, not a flat piece.` |
| cup, closing, e_max < −50 % | `Rnd 20 is far under flat (−60%) — this is a 3D form (tube, cone or deep bowl), not a flat piece.` |
| cup | `Rnd 7 will cup: about 4 stitches under flat (−11%).` |
| ruffle | `Rnd 7 will ruffle: about 4 stitches over flat (+11%).` |

`tol` is 10 %, so an sc circle that is +3 at round 7 is flat — the message shows the +3 so the
crocheter can still see it.

### Golden file

`npm run fixtures` (app) writes `spec/fixtures/<name>.flatness.json` — every round's `class`,
`e_min`, `e_max`, `e`, `rho`, `r` (6 decimals) from this implementation; the lab's
`test_flatness_matches_typescript_golden` pins the Python mirror to it.

## Polygons (TypeScript only)

A flat n-gon of apothem a (inradius) has perimeter **2·n·a·tan(π/n)** — a square 8a against the
circle's 2πa (+27 %), a hexagon 6.93a (+10 %), an octagon 6.63a (+5.5 %). The circle rule would
call every flat square a ruffle; squares, hexagons and octagons worked from the centre are judged
by this rule instead: each round adds **2·n·Δa·tan(π/n)** of perimeter, all of it at the corners
(Gauss–Bonnet: a flat polygon's corners carry all its turning; the sides only move outward).

**Detection** (`detectPolygon`, `app/src/core/flatness/corners.ts` — the one detector, also used by
the chart to draw polygons): the corner groups of a round are the stitches worked into one place
around a chain space ("(3 dc, ch 2, 3 dc) in next ch-2 sp", "(cl, ch 3, cl)") or, when a round has
none, its largest groups of three or more stitches in one place ("3 sc in next st") when every
other group is smaller; two stitches in one place (an increase) never make a corner; groups worked
into the ring do not count. A piece is a polygon when n corner groups (3 ≤ n ≤ 8), evenly spaced
round the round (gap within max(1.5, 30 %) stitches of 1/n of the round) with side stitches between
them, appear in the last round, in at least two rounds and in most rounds (≥ 60 %, never two
missing in a row) from the first cornered one on; earlier rounds made of corner groups only start
the polygon (a granny square's round 2). Pieces worked in rows and stadiums are never polygons.
Circles (increases spread, two per place), doilies (no sides between the groups) and snowflakes
(the last round is arms) are not detected: none of the 7 fixtures and no corpus pattern except
`granny-square-motif` and `hexagon-motif-6` is (asserted in `polygon.test.ts`). A rectangle
worked round both sides of a foundation chain with four corner groups in its rounds
(`detectStadiumRectangle`, sides of unequal length) is judged by the same rule with n = 4.

**Need.** From the polygon's first round `from` on (the circle rule before it):

* *apothem* a_k = a_{k−1} + h_side, h_side = mean height of the round's stitches outside its corner
  groups (the apothem runs through the middle of a side); a_{from−1} = ρ_{from−1}, the stitch tops
  of the round below (its loops are where the corners are made, not a rise of the edge);
* *perimeter needed* P_k = P_{k−1} + 2·n·(a_k − a_{k−1})·tan(π/n), accumulated, starting from what
  the round below actually made, P_{from−1} = C_{from−1} (nominal);
* **squaring round** (circle-to-square: the first polygon round after two or more circle rounds):
  judged against the polygon it makes, P = 2·n·a·tan(π/n) with a = r_{k−1} + the *shortest* side
  stitch (the side's middle, where a graded squaring round has its sc); the rounds after it grow
  from what it actually made (as the blanket studio does);
* **base round**: round 1 worked into a chain ring with exactly n chain spaces (a granny square's
  "(3 dc, ch 2) ×4 in ring") is judged against the n-gon from the centre, P = 2·n·ρ_1·tan(π/n);
* loops: the chain spaces along the sides stand out like the circle rule's arc rise (chord
  d = max(0, P − Σ stitch widths − corner chains) / side spaces); the chain spaces inside the
  corner groups are the corners themselves and add no rise.

**Classification**: e_min, e_max, e = C^min / P − 1, C^max / P − 1, C / P − 1 (the circle rule's chain
compliance band), against **tol_k = max(tol, n·w̄ / P)** — ±10 %, or ±1 stitch per corner,
whichever is larger (the blanket studio's corner tolerance). cup if e_max < −tol_k, ruffle if
e_min > tol_k, else flat (`slackOnly` as below, with tol_k). The numeric fields (`e`, `eMin`, `eMax`,
`stitchesOff`, `stitchesNominal`, `g`) are relative to P; `rho` and `r` stay the circle rule's
(the chart's radii and the sim read them); the polygon's own numbers are in `polygon`
(`n`, `apothem`, `need`, `perCorner` (signed stitches per corner, nominal), `sideIncrease` (side
stitches minus the stitches of the round below they use, per side), `transition`, `corner`).

Messages (corner terms; the corner edit is the round's own share, the stitches-per-corner count
the accumulated one):

| case | message |
|---|---|
| flat | `Rnd 6 lies flat (square).` / `Rnd 6 lies flat (square; +3 sts, within tolerance).` / `… (squaring round, judged against the square).` |
| cup | `Rnd 6: corners are about 2 stitches short — the corners will cup (−14%); use (2 dc, ch 2, 2 dc) in each corner (now (2 dc, ch 2, dc)).` |
| ruffle, extra stitches in the corners | `Rnd 6: corners are about 3 stitches over — the corners will ruffle (+18%); use (2 dc, ch 2, 2 dc) in each corner (now (3 dc, ch 2, 2 dc)).` |
| ruffle, sideIncrease ≥ 1 | `Rnd 8: the sides will wave — about 4 stitches per side over flat (+31%); work one stitch in each stitch along the sides and keep the increases in the corners.` |

The corner edit (`cornerEdit`): the typical corner group as written ("(3 dc, ch 2, 3 dc)", "3 sc",
"(2 sc, picot, 2 sc)") with Δ stitches per group, split round its chain; a cluster corner changes
its chain instead; mixed groups get no rewrite ("use a bigger / smaller corner group").

## Borders (TypeScript only)

A round that follows rows is worked round the piece (notation.md 3.9); so is every later round
worked into a list with corners (`borderLists`). Such rounds are `border`; the rows stay `n/a`.
The rules are the blanket studio's, now in one place (`app/src/core/flatness/polygon.ts`:
`edgeFit`, `polygonCheck`, `polygonCornerGrowth`, the row-end rules; `core/blanket` re-exports and
calls them):

* **Course** (mm): stitch widths plus each chain space's width = max(chains · w_ch, the width it
  bridges): the entries of the round below passed over between the stitches either side of it,
  less how far those stitches' groups fan out beyond their base ((group width − target width)/2 per
  side) — the studio engine's measure.
* **Edge fit** (the first border round, per side): stitches placed along the side (corner
  columns once) × their widths against the side's length — top: the last row's entries (a chain
  of a chain space = one column of the row's mean stitch width); bottom: one column of the first
  row per foundation chain; row-end sides: the sum of the row heights (mean stitch height of the
  row, bobbles / clusters / puffs / popcorns left out). Over by more than tol → the side **waves**
  (class ruffle), under → it **puckers** (cup); the message gives the rule used ("3 sc per row
  end") and, for sc on row ends, the one that fits (`fitRowEnds`: "use 2 sc per row end").
* **Corner rule** (every border round, accumulated over the border rounds): per corner, the corner
  group's growth = its course (stitches + the chains inside it) − the width of what it was worked
  into, against 2·h·tan(π/n) (n = corners, h = the round's mean height): `polygonCheck`, i.e.
  cumulative per corner in stitches, tolerance ±1 stitch per corner or ±tol of the growth so far.
  Short → the corners **cup**; over → they **ruffle**. A later round's sides are judged by their own
  growth (course − course below − corner growth): more than tol of their length and ≥ 1 stitch per
  side → the sides **wave / pull in**.
* The round's class is the worse of its sides and its corners. `border` holds `edge`, `sides`
  (per side: side, class, placed, lengthMm, coverMm, off, rule, fix, message), `corners` (per
  corner: nodes, growth, need, off this round), `perCorner`, `perSide`, `cornerClass`,
  `cornerMessage` and the corner edit. For border rounds `rho = r = 0` and `cMin = cMax = c` (no
  circle band); `e` is the worse component's relative deviation.

Messages: `Rnd 1 lies flat: every side fits its edge and the corners lie flat.`;
`Rnd 1 — First side (row ends): 3 sc per row end gives 24 sts over 9.9 cm — about 9 too many, the
edge will wave; use 2 sc per row end.`; `Rnd 2: corners will cup — about 1.8 stitches per corner
short of flat; use 3 sc in each corner (now sc).`

The flatness assistant (`core/assist`) fixes polygon and border rounds only in their corner
groups (stitches-per-place edits that keep the corner groups and leave the side stitches as they
are — never a circle-style rewrite), and says what the rule implies (`cornerAdvice`:
"Cornered round: adjust the corner group — use (2 dc, ch 2, 2 dc) in each corner instead of
(2 dc, ch 2, dc)."). The "what should this round be" calculator is for circle rounds only.

## Known approximations

Polygon and border rounds are judged by the rules above (TypeScript only); other non-circular
rounds (ovals worked round a chain, pointed rounds) are treated as circles; scalloped rounds use a mean height;
tall stitches are assumed upright; blocking tolerance is not modelled beyond `tol`. Chain slack
down to `chain_slack_min` plus the arc rise make lace rounds hard to fail; `slackOnly` says so
instead of hiding it. The physics sim is a second model with a different sensitivity (it reacts to
mismatches of a few percent and has no stuffing, gravity or collision) — a tendency, not a verdict;
`docs/sim_corpus_report.md` lists where the two disagree.
