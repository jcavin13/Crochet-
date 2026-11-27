# core/yarn — how much yarn a pattern takes

Pure TypeScript (no DOM). The contract is [`spec/yarn.md`](../../../../spec/yarn.md); the numbers
live in [`spec/yarn_defaults.json`](../../../../spec/yarn_defaults.json); the Python mirror is
`lab/src/crolab/yarn.py`; both are pinned to `spec/yarn_golden.json` (agreement to 1e-9).

> **Blunt version:** every figure is a model estimate that has **not been checked against real
> yarn**. Until the user weighs a swatch it is ±20 %, and that band is an assumption, not a
> measured interval. Fibre, ply, twist and above all tension matter. Fuzzy, brushed, boucle,
> chenille, ribbon and other novelty yarns are out of scope.

## The model

    L(node) = post · [ k_w · (a·w + π·e·d) + k_h · (b·h) ]          mm of yarn per stitch

`w`, `h` — the stitch's rest width and height from the stitch-parameter set; `d` — yarn diameter
(category table, scaled by the yarn's m/100 g as `d_cat·sqrt(m_cat/m)`); `a` — strands across the
width (the top loop is 2); `b` — strands up the height; `e` — 180° turns of the yarn round another
strand or the hook (each yarn-over, insertion, pull-through), each costing about π·d; `post` — 1.2
for front/back post stitches (a guess); `k_w`, `k_h` — calibration (1 = nominal).

| stitch | a | b | e | worsted, 5 mm (d = 2.5) | thread no. 10, 1.5 mm (d = 0.85) |
|---|---|---|---|---|---|
| ch | 2 | 0 | 1 | 17 mm | 6.0 mm |
| sl st | 2 | 2 | 2 | 25 mm | 8.7 mm |
| sc | 2 | 2 | 3 | 49 mm | 17 mm |
| hdc | 2 | 3 | 4 | 70 mm | 25 mm |
| dc | 2 | 3 | 5 | 89 mm | 32 mm |
| tr | 2 | 10/3 | 7 | 129 mm | 46 mm |
| dtr | 2 | 3.5 | 9 | 168 mm | 60 mm |
| X N tog / N-X cl | a_X | N·b_X | N·(e_X − 1) + 1 | sc2tog 77, 3-dc cl 226 | 27, 81 |
| puff (L loops) | 2 | 3L | 3L + 1 | 176 (L = 3) | 63 |
| popcorn (N dc) | N full dc + closing (a = 1 on the popcorn width, e = 1) | | | 464 (N = 5) | 165 |
| picot (C ch) | C ch + sl st | | | 76 (C = 3) | 27 |

Derivation (spec/yarn.md §1.1): the last loop on the hook becomes the top V (a = 2); a loop pulled
up through the base is two strands of the height; each yarn-over wrapped before inserting (k of
them) becomes a bar round the post, two strands over h/(k+1): `b = 2 + 2k/(k+1)`. Turning chains,
chain spaces and joins are counted; the magic ring and tails are not (the 10 % allowance covers
them).

Sanity checks (rules of thumb, not measurements): dc / sc = 1.83 (rule: 1.6–2 ✓); sc = 7.5 × its
width, 3.9 × (w + h) — *not* the "3–4 × width" sometimes quoted (that is the knitting rule; area-based
crochet figures, ≈ 6–8 g per 10 × 10 cm sc swatch in worsted, give 6.5–9 × w); a worsted sc throw at
1300 m/m² sits inside the commonly quoted 2500–3000 yd for 50 × 60 in; a dc throw at 1125 m/m² is
≈ 20 % above "about 2000 yd". The old in-app estimates were half to two thirds of this model.

## API

```ts
estimateYarn(pattern, params, { yarn?, colorOfRound?, uptoRound? }): YarnEstimate
  // total (with allowance) and net: { meters, metersLow, metersHigh, grams, gramsLow, gramsHigh, balls }
  // perRound [{ round, label, meters, cumulative }], byStitch { key: m }, byColor?, notes, status,
  // yarn (resolved), ballBreaks [{ ball, nodeIndex, round, label }], stitches
estimateYarnFromCounts(counts, params, { yarn? })     // keys: 'sc', 'ch', 'turning ch', 'sc2tog', 'fpdc', '3-dc cl', …
remainingYarn(pattern, params, nodeIndex, opts)        // { net, total, doneMeters, fraction, nextBreak?, yarn }
remainingFromLengths(graph, nodeLengths(...), i, yarn) // same, with lengths precomputed (the counter)
resolveYarn(params, yarnSpec) / yarnDefaultsFor(params) / rescaleEstimate(est, params, yarnSpec)
calibrationFromSwatch(swatch, params, d) / calibrationFromSwatches(swatches, params, d) / swatchModel(...)
yarnKey(node) / nodeFromKey(key) / countsOf(graph) / nodeLengthMm(node, params, yarn)
metersToGrams, gramsToMeters, ballsNeeded (always rounds up), formatBalls ("3 balls (2.4)"),
metersToYards, yardsToMeters, gramsToOunces, ouncesToGrams, formatLength, formatMass, formatRange
```

`YarnSpec` (all optional): `metersPer100g`, `ballGrams`, `allowance` (default 0.10), `calibration`
(single factor) or `calibrationSplit: { width, height }`, `category` (`'medium-4'`, `'thread-10'` …),
`diameterMm`, `label`, `id`. Defaults come from the param set's `yarn_weight`.

## Calibrating

From a flat swatch in one stitch: foundation ch `n + t`, `r` rows of `n` stitches with a turning
chain of `t` (not a stitch), tails cut flush, weighed on a 0.1 g scale (or frogged and measured).
`k = measured / model`. Two swatches of different stitches (sc + dc) give separate `k_w`, `k_h`.
Calibrated estimates carry a ±8 % band (±6 % split). In the app: any Yarn panel → *Calibrate with
a swatch*, or *About & settings → My yarns*; the calibration is stored on the yarn (IndexedDB) and
only applied to patterns of the same weight category. Lab: `lab/swatch/PROTOCOL.md` §9,
`python -m crolab.yarn calibration.csv`.

## Limits

* Unvalidated: no coefficient has been fitted to measured yarn. The first weighed swatches may show
  the whole table is off by a constant — which is exactly what the calibration factor absorbs.
* One tension per piece; real tension drifts (and tightens on chains and loosens on tall stitches
  differently for different people — the split calibration catches only the average of that).
* Yarn diameter is a category typical (wraps per inch); a tightly twisted cotton and a lofty wool of
  the same m/100 g differ.
* Post stitches (+20 %), popcorn closing and the magic ring are guesses or ignored.
* Ball breaks assume a full first ball and no allowance consumed before that point.
