# Analytic flatness check, v0.1

A fast, closed-form prediction per round — no simulation — of whether a piece worked in the
round lies flat, cups (too few stitches: positive curvature) or ruffles (too many: negative
curvature), and by how many stitches. Implemented in `app/src/core/flatness` and mirrored in
`lab/` for the reports. Constants are in `sim_config.json → flatness`.

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

## Known approximations

Rounds are treated as circles (square and polygonal motifs read as "over" at corners — the UI
says so when a round has a 4- or 6-fold corner structure); scalloped rounds use a mean height;
tall stitches are assumed upright; blocking tolerance is not modelled beyond `tol`. Chain slack
down to `chain_slack_min` plus the arc rise make lace rounds hard to fail; `slackOnly` says so
instead of hiding it. The physics sim is a second model with a different sensitivity (it reacts to
mismatches of a few percent and has no stuffing, gravity or collision) — a tendency, not a verdict;
`docs/sim_corpus_report.md` lists where the two disagree.
