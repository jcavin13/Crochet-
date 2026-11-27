# Swatch measurement protocol

This protocol produces the calibration data behind `spec/stitch_params.json`: for each
**(stitch type × yarn × hook)**, the rest **width** `w` and **height** `h` of one stitch in mm,
with uncertainties. The definitions match `spec/stitch_params.schema.json`:

* **width** `w`: rest length of one stitch along the row (the course). For `ch`, the length of one
  chain.
* **height** `h`: rest length along the wale, from the top of the stitch below to the top of this
  stitch, i.e. the row pitch of flat work in that stitch.

Two routes give the same CSV rows: **by hand** (ruler, §4) and **photo** (printed marker sheet +
`crolab.swatch.analyze`, §7). The by-hand route is the reference. The photo route has so far been
validated **only on synthetic images** (see `README.md`).

Contents: 1 equipment · 2 which swatches · 3 making and conditioning · 4 measuring by hand ·
5 uncertainty · 6 recording (CSV) · 7 photo procedure · 8 printable data sheet ·
9 yarn consumption (weighing a swatch to calibrate yarn estimates).

---

## 1. Equipment

* Yarn with its label kept: brand, line, colour and dye lot, fibre content, CYC weight category,
  metres per 100 g.
* Hooks: record the size **in mm** as stamped. If unmarked, check with a needle gauge. Note the
  brand and material, since in-line and tapered hooks and aluminium versus bamboo change tension.
* A steel rule with mm divisions (preferred over a tape measure; tapes stretch). Optional:
  calipers for thread swatches, and a magnifier.
* Rust-proof pins and a blocking mat or towel, if blocked measurements are taken.
* Removable stitch markers or contrasting thread to mark measurement spans.
* For the photo route: the printed marker sheet (`marker_sheet_A4.pdf` or
  `marker_sheet_letter.pdf`), a phone camera and even lighting.
* Swatch tags (paper tag on a thread) carrying the `swatch_id`.

## 2. Which swatches

Make **one set per (yarn, hook) combination** you want calibrated. Work with the tension you use
for real projects. A calibration made with "careful swatch tension" will not match your work.

### 2.1 Flat rows: one swatch per stitch type (the core data)

Work back and forth in rows. Start from a chain (or foundation stitches; record which) and use
the usual turning chain. The measured region is the **interior**. Leave at least 2 stitches at
each side edge, and skip the foundation row, the first row and the last row.

| stitch | foundation sts | rows | interior measured | why this many rows |
|---|---|---|---|---|
| sc  | 24 | 24 | ≥ 20 sts × ≥ 20 rows | short rows; need many for 10 cm |
| hdc | 24 | 18 | ≥ 20 sts × ≥ 14 rows | |
| dc  | 24 | 12 | ≥ 20 sts × ≥ 8 rows  | tall rows, 10 cm reached in ~8 rows |
| tr  | 24 | 10 | ≥ 20 sts × ≥ 6 rows  | |

Record whether the turning chain counts as a stitch (`notes`). Also make the sc swatch **in the
round** (spiral or joined, unturned) if you mostly work amigurumi. The right side then always
faces you, and the stitch looks and measures differently from turned rows.

### 2.2 Chain-length test (`ch`)

* Chain **100** (thread: 150) without stretching. Lay it straight but relaxed on the table and
  measure the length of the middle 80 chains (mark with removable markers). → `stitch=ch`,
  `n_stitches=80`, `width_mm=<length>`, `n_rows=0`, `height_mm` empty, `method=chain-length`.
* Do it twice: once as a free chain, and once as the foundation chain of a sc swatch measured
  *after* the swatch is made (foundation chains get pulled to the stitch width; record
  `notes=foundation`).

### 2.3 Flat-circle tests (directly measure `h / w`)

A disc worked in concentric rounds lies flat when each round adds about `k = 2π h / w`
stitches. Round *r* then has about `k·r` stitches, and its circumference `k·r·w` equals
`2π·(r·h)`. Fewer increases make the disc **cup** (positive curvature). More make it **ruffle**.
Finding the flat `k` measures the ratio `h/w` without any ruler. This is the strongest single
check of the model, because it is exactly what the app's flatness checker predicts. (The
derivation is the project's own; see `docs/literature_review.md`, *Synthesis*.)

| stitch | predicted `k` from nominal `rel` ratios | work circles with k = |
|---|---|---|
| sc  | 2π × 0.95 ≈ 6.0  | 5, 6, 7 (and 8) |
| hdc | 2π × 1.30 ≈ 8.2  | 7, 8, 9, 10 |
| dc  | 2π × 1.90 ≈ 11.9 | 10, 11, 12, 13, 14 |
| tr  | 2π × 2.80 ≈ 17.6 | 15, 16, 17, 18, 19 |

Procedure for each `k`:

1. Magic ring (record `start=magic-ring`, or `ch-ring`). Round 1: `k` stitches into the ring.
2. Rounds 2 to 8: increase evenly, `k` increases per round, staggering the increase positions from
   round to round (otherwise the disc becomes a polygon). Record `construction=spiral` or
   `joined` (slst + turning chain; record whether you turn).
3. Rest the disc for 24 h, then lay it on a flat table without pressing. Classify the result:
   * **cups**: the edge lifts or the centre domes. If you press the centre down, the edge is too
     short to lie flat;
   * **flat**: lies flat with no waves, and the edge is neither tight nor loose;
   * **ruffles**: the edge waves. Count the waves (`edge_wave_count`).
4. Measure the diameter across two perpendicular directions (`diameter_mm`, mean).

The flat value `k*` lies between the largest "cups" and the smallest "ruffles". Estimate
`h/w = k*/(2π)` and give an interval from the bracketing values. Use
`lab/swatch/flat_circle_template.csv` (one row per disc). The first 1–2 rounds are dominated by
the ring, so judge flatness on the outer rounds. If no k is clearly flat, write both
neighbours' results in `notes`.

### 2.4 Chain-space / mesh swatch (lace)

Doilies are mostly stitches worked into chain spaces, and a chain inside a mesh is shorter than a
free chain. Make at least:

* **Filet mesh** `dc, ch 1, sk 1` and `dc, ch 2, sk 2` (24 repeats wide is ideal; at least 12),
  8–10 rows.
* **Chain-loop mesh** `ch 5, sc in next loop`, 10 rows.

Record in the main CSV with `stitch=mesh`, `method=mesh`, `pattern="dc, ch2, sk2"`,
`n_stitches=<number of repeats>`, `width_mm=<length of those repeats>`, and `n_rows` and
`height_mm` as usual. The chain length inside a mesh is then derived as
`(repeat width − w_dc) / k` during fitting.

### 2.5 Thread and steel-hook variants (doilies)

Repeat 2.1 (sc and dc at least), 2.2, 2.3 (dc circles) and 2.4 with crochet cotton (e.g. size 10
with 1.5 / 1.75 mm; size 20 or 30 with 1.0–1.25 mm). Stitches are about 2–3 mm, so make swatches
**40 sts × 40 rows** (sc) or **40 × 16** (dc), so that the interior spans at least 5 cm. Count
with a magnifier or from a photo. Thread swatches especially need blocking (§3), because doilies
are always blocked.

## 3. Making and conditioning

* Note anything unusual: a new hook, a different yarn hold, tired hands, a different session.
  Tension drifts. If you can, make the swatch in one sitting.
* Weave in or tie off the ends. Do not trim them so short that the edge unravels.
* Tag every swatch with its `swatch_id` (e.g. `W4-5.0-dc-01`).

Measure each swatch in up to three **states** (the `state` column):

| state | what | when to measure |
|---|---|---|
| `fresh` | straight off the hook | optional; within 1 h of finishing |
| `unblocked` | relaxed, never wetted or steamed | **always**; after ≥ 24 h lying flat at room conditions |
| `blocked` | after blocking, dried, unpinned | for anything that will be blocked (lace, doilies, garments) |

**Blocking method** (record it in `notes`):

* *Wet block* (wool, cotton, most natural fibres): soak 20 min in lukewarm water with a drop of
  wool wash, then press out (do not wring) in a towel. Lay flat and pat to the **unblocked
  dimensions**. For calibration, do *not* stretch to a target size. Pin only if the edges curl.
  Dry fully, unpin, rest 1 h, measure.
* *Steam block* (acrylic and blends): hold the iron 2–3 cm above the swatch. Never touch it,
  because acrylic "kills" (permanently relaxes) under heat and pressure. Let it cool and dry flat
  for 1 h, then measure.
* *Lace / doily blocking* stretches the work on purpose. Record such measurements as `blocked`
  with `notes="blocked open: pinned to <dimensions>"`. They describe the pinned shape, not the
  rest state.

## 4. Measuring by hand

Lay the swatch on a hard, smooth surface. Smooth it with a flat hand from the centre outwards,
then **lift and drop it once** so it settles at rest. Do not pull it square.

**Stitch width (along a row).** Pick a row in the interior. Count the largest whole number `N`
of stitches that fits in the interior (≥ 2 stitches from each edge, ideally `N ≥ 15`). Mark the
start and end with removable markers at *corresponding points* of the first and the
(N+1)-th stitch, for example the left leg of each "V". Measure the distance between the markers to
0.5 mm. That is `width_mm` for `n_stitches = N`. This "length of a whole count" is more precise
than counting stitches over a fixed 10 cm, where you must estimate fractions of a stitch.

**Row height (along the wale).** In the interior, mark the top of one row and the top of the row
`M` rows above (skip the foundation, first and last rows). Measure the distance → `height_mm` for
`n_rows = M`. Turned rows look different on alternate rows. Count **every** row, not only the
ridges.

**Repeat three times** in different places: stitches near the bottom, middle and top; rows near
the left, centre and right. Record each as its own CSV row with `repeat = 1, 2, 3`. Measure
**both directions** each time. Optionally record the whole-swatch width and height in `notes`.

Gauge per 10 cm follows from the rows: stitches per 10 cm = `100 · n_stitches / width_mm`.

## 5. Uncertainty

For one measurement of length `L` (mm) over `N` stitches, with ruler-reading uncertainty
`σ_L ≈ 0.5 mm` at each end (so `≈ 0.7 mm` for the length) and a marker-placement uncertainty of
about `σ_N ≈ 0.1` stitch at each end:

    σ_w / w ≈ sqrt( (0.7 / L)² + (0.14 / N)² )

For `L = 100 mm, N = 15` this gives about 1.2 %. In practice **the spread between the three repeats
is larger** (variation across the swatch, handling stretch) and is the number to report. Put
the standard deviation of the repeats in `width_sd_mm` / `height_sd_mm`, or the formula
value if you measured only once. Typical magnitudes:

| source | size | how to reduce |
|---|---|---|
| ruler reading | ≈ 0.7 % over 10 cm | steel rule, measure a longer span |
| counting/marker placement | 1 % at N = 15 | larger N, corresponding points |
| variation across the swatch | 1–4 % | 3 repeats, interior only |
| handling stretch | systematic, up to 5 %+ | lift-and-drop before measuring |
| tension drift between sessions | 2–5 % | one sitting per swatch; record date |
| photo route: print scale | as printed | check the 100 mm bar, `--ruler-mm` |
| photo route: swatch thickness parallax | ≈ thickness / camera distance (~1 % for 3 mm at 30 cm) | shoot from ≥ 30 cm; `--thickness-mm` |

## 6. Recording: the CSV

Copy `lab/swatch/measurements_template.csv` and add one row per measurement. The first seven
columns are the input contract of `crolab/fitting.py`. The rest are optional but strongly
recommended.

| column | meaning |
|---|---|
| `yarn` | your label for the yarn, used to group fits, e.g. `worsted-4`, `cotton-10` |
| `hook_mm` | hook size in mm |
| `stitch` | stitch id from `spec/stitches.json` (`sc`, `hdc`, `dc`, `tr`, `ch`, …), or `mesh` |
| `n_stitches` | number of stitches (or mesh repeats, or chains) spanned by `width_mm` |
| `n_rows` | number of rows spanned by `height_mm` (0 for a chain) |
| `width_mm` | measured length of `n_stitches` along the row |
| `height_mm` | measured length of `n_rows` rows (empty for a chain) |
| `swatch_id` | id on the swatch tag; the same for all repeats and states of one swatch |
| `method` | `ruler`, `photo-counts`, `photo-texture`, `chain-length`, `mesh` |
| `state` | `fresh`, `unblocked`, `blocked` (§3) |
| `repeat` | 1, 2, 3… for repeated measurements of the same swatch and state |
| `width_sd_mm`, `height_sd_mm` | 1-sd uncertainty of the lengths, if known (§5) |
| `confidence` | `photo-texture` only: the analyzer's 0–1 confidence |
| `yarn_brand`, `yarn_fibre`, `yarn_cyc`, `yarn_m_per_100g` | from the label, e.g. `100% wool`, `4` |
| `pattern` | mesh only: the repeat, e.g. `dc, ch2, sk2` |
| `date`, `measurer` | ISO date; initials |
| `source` | photo file name, or empty |
| `notes` | tension notes, turning-chain convention, blocking method, anything odd |

Illustrative row (made-up numbers, **not data**):

    yarn,hook_mm,stitch,n_stitches,n_rows,width_mm,height_mm,swatch_id,method,state,repeat,width_sd_mm,height_sd_mm,confidence,yarn_brand,yarn_fibre,yarn_cyc,yarn_m_per_100g,pattern,date,measurer,source,notes
    worsted-4,5.0,sc,16,17,104.0,103.5,W4-5.0-sc-01,ruler,unblocked,1,0.7,0.7,,BrandX Worsted,100% wool,4,180,,2026-12-01,AB,,tch not counted

Flat circles go in `lab/swatch/flat_circle_template.csv`: `yarn, hook_mm, stitch,
increases_per_round, rounds, start (magic-ring|ch-ring), construction (spiral|joined|joined-turned),
result (cups|flat|ruffles), diameter_mm, edge_wave_count, state, swatch_id, date, measurer, notes`.

## 7. Photo procedure (optional route)

1. **Print** `lab/swatch/marker_sheet_A4.pdf` (or `_letter`) at **100 % / "actual size"**, never
   "fit to page", on matte paper. **Measure the printed 100 mm bar.** If it is not 100.0 mm,
   pass the measured value as `--ruler-mm`. Also check the second printed distance. A 1 % print
   error is a 1 % error in every result, and **it cannot be detected from the photo**. For
   white or pale yarn, regenerate with `python -m crolab.swatch.make_sheet --dark-window` or lay
   dark matte paper inside the window.
2. **Lay the sheet flat** on a hard table and tape the corners if it curls. A bent sheet shows up
   as a high "reprojection error" warning.
3. **Place the swatch** in the central window: rows horizontal, foundation at the bottom, not
   touching the markers. Lift and drop it to relax it. Do **not** stretch or pat it square.
   (For pieces larger than the window, use the marker card `marker_card.pdf`. Glue it to card
   stock and place it flat beside the piece on a plain, contrasting surface. Use one card per
   photo.)
4. **Light**: diffuse daylight or two lamps at about 45° on opposite sides. Avoid glare on the
   markers (they must stay black) and avoid hard shadows of the camera or your hand.
5. **Camera**: the main (1×) lens, not the ultra-wide (more distortion). Hold it roughly parallel
   to the sheet (a tilt under about 20° is fine; the analyzer corrects perspective but resolution
   drops). Use a distance of ≥ 30 cm so that the whole marker frame is in view and fills most of
   the picture. Focus on the swatch, no digital zoom, no flash. Take **3 photos**, moving the
   camera between them; they count as repeats.
6. **Run**
   `uv run python -m crolab.swatch.analyze photo.jpg --stitch sc --yarn worsted-4 --hook 5.0 --csv my_measurements.csv`
   adding `--n-stitches/--n-rows` if you counted the whole swatch (that is the most reliable
   photo measurement), and `--state blocked` when applicable.
7. **Check** `<photo>_overlay.png`: all markers found, the swatch outline hugs the swatch, the
   lattice looks plausible, and no warnings. Treat a texture gauge with confidence **low** as
   missing data. Cross-check at least one swatch per yarn by hand (§4).

## 8. Printable data sheet

Print this page (or copy it into a notebook) and fill one block per swatch.

```
Swatch id: ______________   Date: __________   Measurer: ____
Yarn: brand/line ______________________  colour/lot ___________
      fibre ____________  CYC weight ___  m/100 g ______  label ____________
Hook: ______ mm   brand/material ______________
Stitch: sc / hdc / dc / tr / ch / mesh: __________   worked: rows turned / in the round
Foundation: chain / foundation sts     Turning chain counts as stitch: yes / no
Tension notes: ________________________________________________

State: fresh / unblocked (rested ____ h) / blocked (method: __________________)

                    repeat 1        repeat 2        repeat 3
Stitches  N        ________        ________        ________
          length   ______ mm       ______ mm       ______ mm
Rows      M        ________        ________        ________
          length   ______ mm       ______ mm       ______ mm
Whole swatch: ______ × ______ mm     Photos: _____________________

Flat circle (k incs/round):  k=___ cups/flat/ruffles  diam ___ mm  waves ___
                             k=___ cups/flat/ruffles  diam ___ mm  waves ___
                             k=___ cups/flat/ruffles  diam ___ mm  waves ___
Notes: __________________________________________________________
```

## 9. Yarn consumption: weighing a swatch (calibrates the yarn estimates)

The app's yarn estimates (`spec/yarn.md`) are **nominal** until calibrated: their coefficients are
derived from how stitches are built, not measured, and tension varies between crocheters by
10–20 %. One weighed swatch fixes that for one yarn, one hook and one pair of hands.

### 9.1 Equipment

* A scale reading **0.1 g** (a jewellery / pocket scale). A 1 g kitchen scale is too coarse for a
  10 g swatch (±5 % from rounding alone); if that is all you have, make the swatch 4× bigger.
* The ball band: **metres (or yards) per ball and grams per ball** → m/100 g = metres ÷ grams × 100.
* Sharp scissors. Optional: a tape measure for the frog-and-measure check.

### 9.2 Making the swatch

1. Work flat, in one stitch, with the yarn and hook of the project, at your usual tension:
   foundation chain of `n + t`, then `r` rows of `n` stitches, each row after the first starting
   with a turning chain of `t` that does **not** count as a stitch (t = 1 sc, 2 hdc, 3 dc, 4 tr).
   Suggested: 20 sc × 20 rows, or 20 dc × 12 rows (about 10 × 10 cm in worsted).
2. Fasten off. **Cut both tails flush** with the fabric (the model does not count tails).
3. Weigh it (§9.3). Do not block or wash it first: yarn mass does not change with blocking, but a
   damp swatch weighs more.
4. Optional, for a split calibration: a second swatch in a stitch of a different height (sc and
   dc are a good pair). Two stitches let the fit separate how big your loops are from how far you
   pull them up (`k_w`, `k_h` in `spec/yarn.md` §4).

### 9.3 Weighing

* Tare the scale, weigh the swatch three times (lift it off between readings), record the mean.
* Yarn absorbs moisture: weigh it in the room where the ball has been kept, not straight after a
  steam iron.
* Optional cross-check: unravel ("frog") the swatch and measure the yarn with a tape (stretch it
  just straight, not taut). This avoids any error in the ball band's m/100 g and is the better
  number when you have it; enter it as `meters`.

### 9.4 Recording and fitting

In the app: Yarn panel → *Calibrate with a swatch*, or *About & settings → My yarns*. In the lab,
one row per swatch in a CSV:

    yarn,stitch,n_stitches,n_rows,grams,meters,m_per_100g,params
    merino-worsted,sc,20,20,10.4,,180,worsted-4_5.0mm
    merino-worsted,dc,20,12,12.0,,180,
    cotton-10,sc,30,30,,15.1,,thread-10_1.5mm

    cd lab && uv run python -m crolab.yarn calibration.csv

`crolab.yarn.fit_calibration(csv)` computes, per yarn, the same numbers as the app
(`calibrationFromSwatches`): the single factor `k = Σ measured / Σ model`, and with two or more
stitch types the split factors from a least-squares fit on relative error. `params` is the
stitch-parameter set the model is compared against (default: the file's default set); the factor
then also absorbs the difference between your gauge and that set's. Both implementations are pinned
to `spec/yarn_golden.json` (regenerate with `uv run python -m crolab.yarn --write-golden` only after
a deliberate model change).

**Reading the factor:** 1.00 = the nominal model matched you; 1.15 = you use 15 % more yarn
(looser loops, or a smaller gauge than the set); below 0.85 or above 1.3, re-check the counts, the
ball band figure and whether the tails were cut.
