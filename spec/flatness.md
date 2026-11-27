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

* **Course elements**: stitch-counting nodes (notation.md 3.8) contribute their width w; chain
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

The message format the UI uses: `Rnd 7 will ruffle: about 4 stitches over flat (+11%).`

## Known approximations

Rounds are treated as circles (square and polygonal motifs read as "over" at corners — the UI
says so when a round has a 4- or 6-fold corner structure); scalloped rounds use a mean height;
tall stitches are assumed upright; blocking tolerance is not modelled beyond `tol`. The physics
sim is the second opinion.
