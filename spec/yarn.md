# Yarn requirement model (v0.1)

How much yarn a pattern takes: metres, grams and balls, with an honest range. Implemented twice
and pinned together: `app/src/core/yarn` (TypeScript) and `lab/src/crolab/yarn.py` (Python), both
reading **`spec/yarn_defaults.json`** (coefficients, yarn categories, bands, allowance) and
**`spec/stitch_params.json`** (stitch sizes). `spec/yarn_golden.json` holds test cases that both
test suites evaluate and must agree on to 1e-9.

> **Status: nominal, unvalidated.** No coefficient here has been checked against measured yarn.
> The structure is derived from how stitches are built; the numbers are a first guess. A weighed
> swatch (§4) calibrates the model for one yarn and one crocheter, and only then should the
> figure be trusted to better than ±20 %.

## 1. Per-stitch length

Every node of the stitch graph (`spec/pattern.schema.json`) is made with a length of yarn

    L(node) = post · [ k_w · (a·w + π·e·d) + k_h · (b·h) ]          (mm)

| symbol | meaning | source |
|---|---|---|
| `w`, `h` | the stitch's rest width and height | `stitch_params.json`, by node type (a turning-chain top that *counts as* a dc is still a chain) |
| `d` | yarn diameter | category table (§3), scaled by the yarn's m/100 g |
| `a` | strands across the stitch's width (the top loop is 2) | structural, `yarn_defaults.json` |
| `b` | strands up the stitch's height | structural |
| `e` | "events": 180° turns of the yarn round another strand or the hook shaft (each yarn-over, insertion, pull-through) | structural |
| `π·d` | extra length of one such turn: a half turn whose centreline has radius ≈ d | geometry |
| `k_w`, `k_h` | calibration of the loop terms and the height terms (1 = nominal) | swatch (§4) |
| `post` | 1.2 for front/back post stitches, else 1 | `post_factor`, a guess |

Front/back-loop-only does not change the length (the hook passes under one strand instead of two).

### 1.1 Deriving (a, b, e) from the construction

Read a stitch as the loops it makes. The final loop on the hook becomes the stitch's top "V":
two strands across the width, `a = 2`. A loop pulled up through the base from the bottom of the
stitch to the hook is two strands up the height. Each yarn-over wrapped round the hook *before*
inserting (k of them: hdc and dc 1, tr 2, dtr 3) ends up as a bar wrapped round the post: two
strands over the part of the height between two pull-throughs, i.e. over h/(k+1) per wrap — so
`b = 2 + 2k/(k+1)`. Every yarn-over, insertion and pull-through bends the yarn 180° round a strand:
one event each.

| stitch | construction | a | b | e | L for worsted (5 mm) | for thread no. 10 (1.5 mm) |
|---|---|---|---|---|---|---|
| ch | pull a loop through the loop on the hook | 2 | 0 | 1 | 17 mm | 6 mm |
| sl st | insert, yo, pull through base and loop | 2 | 2 | 2 | 25 mm | 9 mm |
| sc | insert, yo + pull up, yo + pull through 2 | 2 | 2 | 3 | 49 mm | 17 mm |
| hdc | yo, insert, yo + pull up, yo + pull through 3 | 2 | 3 | 4 | 70 mm | 25 mm |
| dc | yo, insert, pull up, 2 × (yo + pull through 2) | 2 | 3 | 5 | 89 mm | 32 mm |
| tr | 2 yo, insert, pull up, 3 × pull through 2 | 2 | 10/3 | 7 | 129 mm | 46 mm |
| dtr | 3 yo, insert, pull up, 4 × pull through 2 | 2 | 3.5 | 9 | 168 mm | 60 mm |

(General k: `e = 3 + 2k` for the tall stitches; hdc has one fewer because it finishes with a
single pull-through of 3.)

### 1.2 Compound stitches

* **Decrease / cluster** (`X N tog`, `N-X cl`, a node with N legs): each leg is X without its
  final pull-through, then one closing pull-through and one top loop:
  `a = a_X, b = N·b_X, e = N·(e_X − 1) + 1`. A bobble is a 5-dc cluster.
* **Puff** (L loops, default 3, own size from the param set): per loop an hdc leg without its
  finishing pull-through (3 height strands, 3 events), then one closing event: `a = 2, b = 3L, e = 3L + 1`.
* **Popcorn** (N dc, default 5): N complete dc *of the dc's size* + closing: the dropped loop
  pulled across the popcorn's width once (`a = 1` on the popcorn width, one event).
* **Picot** (C chains, default 3): C chains + the slip stitch that closes it.
* **Turning chains, chain spaces, joins** are nodes like any other: counted. A turning chain that
  counts as a stitch is just chains.
* **Not counted:** the magic ring itself, yarn tails, sewing up, stuffing closure — the allowance
  (§5) covers them.

### 1.3 Sanity checks against rules of thumb (not measurements)

* **dc ≈ 1.6–2 × sc:** the model gives 1.83 for every param set (worsted, thread). ✓
* **"sc uses about 3–4 × its width":** the model gives ≈ 7.5 × w (≈ 3.9 × (w + h)). The rule as
  stated is the *knitting* rule for a stockinette loop; area-based figures for crochet disagree with
  it: a 10 × 10 cm sc swatch in worsted (≈ 250 sc) weighs about 6–8 g, i.e. 11–14 m, i.e. 43–58 mm
  per sc, which is 6.5–9 × w. The model's 49 mm sits inside that. Treat this as a disagreement the
  user's calibration settles, not as validation.
* **"Crochet uses about a third more yarn than knitting for the same area":** stockinette at
  18 × 24 / 10 cm with ≈ 3.3 w per loop is ≈ 8 m / 100 cm²; the model's sc fabric is 12 m / 100 cm²
  (+50 %, high side), dc fabric 11 m / 100 cm².
* **Blanket rule (worsted dc throw, 50 × 60 in, "about 2000 yd")** → 0.67 yd per in²; the model's
  100 × 120 dc rectangle (65 × 148 cm) needs 1080 m net = 0.79 yd per in² (+18 %, high side).
* The old in-app figures (designer: `2(w + h)` per stitch; amigurumi: `2.6 (w + h)` per sc) were
  about half to two thirds of this model.

## 2. Totals

* `net` = Σ L over the nodes (optionally up to a round). Reported per round (with cumulative), by
  stitch key (`ch`, `turning ch`, `sl st`, `sc`, `dc2tog`, `fpdc`, `3-dc cl`, `puff`, `pc`,
  `picot`, with non-default sizes spelled out: `puff 4-loop`, `pc 6-dc`, `picot ch-5`), and by
  colour when the caller assigns colours to rounds.
* `total` = net × (1 + allowance). Allowance default **10 %** (tails, the gauge swatch, tension
  drift), always shown separately.
* `grams = metres × 100 / (m per 100 g)`; balls = grams / ball size, **always rounded up** for
  buying ("3 balls (2.4)").
* Ball breaks: where the cumulative net yarn passes a multiple of one ball, assuming a full
  first ball ("you'll need a second ball around Rnd 9").
* Counts-only estimate (`estimateYarnFromCounts`): the same per-node formula on stitch counts by
  key; for a graph it gives exactly the graph-based total.

## 3. Yarn defaults

`categories` in `yarn_defaults.json`: CYC weight 0–7 and crochet cotton no. 10 / 20 / 30, each with
a typical m/100 g (and range), wraps per inch, diameter and ball size. **The CYC standard defines
the categories, recommended gauges and hooks (literature review §6.3), not m/100 g or diameters;
those are typical retail values.** Diameters are the wrapped width (≈ 25.4 mm / WPI), which is
what a loop has to go round. For the user's own yarn, `d = d_cat · sqrt(m_cat / m_yarn)` (same
effective density as the category's typical yarn). A param set maps to a category through its
`yarn_weight` (`medium-4`, `thread-10`, …).

## 4. Calibration

From a weighed swatch, worked flat in one stitch X: foundation chain of `n + t`, then `r` rows of
`n` X, each row after the first starting with a turning chain of `t` that does not count as a
stitch (t = 1 sc, 2 hdc, 3 dc, 4 tr, 5 dtr). Tails trimmed. The user enters X, n, r and the weight
in grams with the ball band's m/100 g (or the metres frogged from it). With the model length of
that swatch split into `loop = Σ(a·w + π·e·d)` and `height = Σ b·h`:

* **one stitch type** (one or more swatches): `k = Σ measured / Σ model`, `k_w = k_h = k`.
* **two or more stitch types** (e.g. sc and dc): least squares on relative error,
  `measured_i ≈ k_w·loop_i + k_h·height_i`, minimising Σ((y − k_w A − k_h B)/y)². Falls back to the
  single factor when the swatches cannot separate the terms (normalised determinant ≤ 0.01) or a
  factor lands outside 0.3–3.

Calibration is stored per yarn ("my yarns") with the param set it was made against. Procedure
for the lab and the data sheet: `lab/swatch/PROTOCOL.md` §9; lab function
`crolab.yarn.fit_calibration(csv)`.

## 5. Uncertainty

Reported as `metersLow`/`metersHigh` = net (or total) × band:

| status | band | basis |
|---|---|---|
| nominal | 0.80–1.20 | gauge spread between crocheters on the same yarn and hook (CYC gauge ranges are ≈ ±12 % in stitch size, and yarn per stitch scales with loop size) combined with coefficients nobody has measured |
| calibrated (one stitch) | 0.92–1.08 | scale resolution (0.1 g on a 5–10 g swatch ≈ 1–2 %), tension drift through a project, a stitch mix unlike the swatch |
| calibrated (split) | 0.94–1.06 | as above, loop and height terms fixed separately |

These are stated assumptions, not fitted intervals. The allowance is separate from the band.

## 6. Out of scope

Fuzzy, brushed, boucle, ribbon, chenille and other novelty yarns (their diameter and loop
geometry are not those of a smooth yarn); beads; seaming; tension that changes over a piece;
blocking stretch (the length of yarn does not change, the size does).
