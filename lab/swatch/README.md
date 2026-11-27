# Swatch calibration tools

These tools turn your own swatches into the per-(stitch × yarn × hook) rest width and height that
`spec/stitch_params.json` needs. There are two routes, and both write rows to the same CSV, which
is the input of `crolab/fitting.py`:

1. **By hand**: follow [`PROTOCOL.md`](PROTOCOL.md) (what to make, how to condition and measure,
   uncertainties, CSV template, printable data sheet). This is the reference route.
2. **Photo** (prototype): photograph the swatch on a printed ArUco marker sheet, and the
   analyzer measures it in mm.

> **Validation status: synthetic only.** The photo analyzer has been tested only on procedurally
> rendered photos with known ground truth (`crolab/swatch/synth.py`). **No real photograph of a
> real swatch has been validated yet.** Real yarn (fuzz, variegation, irregular stitches, curling
> edges) will be harder than the synthetic renders. Until a real-photo comparison exists, use the
> photo route alongside hand measurements, not instead of them.

## Quick start (photo route)

```sh
cd lab
uv run python -m crolab.swatch.make_sheet        # (re)generates the PDFs below; already committed
```

1. Print `marker_sheet_A4.pdf` or `marker_sheet_letter.pdf` at **100 % / actual size**. Check
   that the printed bar measures 100 mm. If not, pass `--ruler-mm <measured>`. For white or pale
   yarn, use `marker_sheet_*_dark.pdf`.
2. Lay the sheet flat. Put the swatch in the window with rows horizontal, without stretching it.
   Take a photo from about 30–40 cm, roughly parallel to the sheet, with the whole marker frame in
   view (details: PROTOCOL.md §7).
3. Run the analyzer:

```sh
uv run python -m crolab.swatch.analyze photo.jpg --stitch sc --yarn worsted-4 --hook 5.0 \
    [--n-stitches 20 --n-rows 20] [--state blocked] [--csv my_measurements.csv] [--out outdir]
```

Outputs go to `--out` (default `<photo dir>/swatch_out/`):

* `<photo>.json`: everything. Marker detection and reprojection error (mm), the estimated
  camera tilt and focal length, swatch size, gauge from counts and/or texture with a confidence
  score, the experimental lattice, and warnings.
* `<photo>_row.csv`: one row in the fitting format. It is appended to `--csv` if that is given.
* `<photo>_overlay.png`: a diagnostic figure with the detected markers, rectified swatch,
  measured box, lattice and spectra.
* `<photo>_rectified.jpg`: the fronto-parallel window at a known px/mm (default 8).

Try it on the committed synthetic samples:

```sh
uv run python -m crolab.swatch.analyze ../data/synthetic/swatches/synth_sc_worsted_tilt20.jpg \
    --stitch sc --yarn worsted-4 --hook 5.0 --out /tmp/swatch_demo
```

## Files

| file | what |
|---|---|
| `marker_sheet_A4.pdf`, `marker_sheet_letter.pdf` (+ `.png` previews) | vector marker sheets: a ring of 32 / 30 ArUco markers (DICT_4X4_100, 16 mm) around a 150 × 201 mm (A4) window, a 100 mm scale bar and print-check instructions |
| `marker_sheet_*_dark.pdf` | the same with a dark window, for pale yarn |
| `marker_card.pdf` | a credit-card-sized cluster of 10 markers (13 mm) with a 50 mm bar, 4 copies per page, for pieces larger than the window |
| `sheet_layout.json` | the geometry the analyzer reads: dictionary, ids, every marker corner in mm, window, ruler |
| `PROTOCOL.md` | by-hand protocol, uncertainty, photo procedure, printable data sheet |
| `measurements_template.csv` | CSV header: the fitting columns plus documented optional columns |
| `flat_circle_template.csv` | flat-circle test results (PROTOCOL.md §2.3) |

Each layout uses its own marker ids (A4 0–31, Letter 40–69, card 80–89), so the analyzer
recognises the sheet automatically.

## How the analyzer works

1. **Markers → homography.** ArUco detection with sub-pixel corner refinement. RANSAC homography
   (sheet mm → image px) over all marker corners (128 points on A4). It is polished by least
   squares after dropping any marker that has a corner beyond max(1 px, 4σ), because partly
   occluded markers give biased corners. The reprojection error is reported in mm. Focal length
   and tilt come from the homography (square pixels, centred principal point), and a warning is
   given above 35° tilt or when the image scale varies more than 1.5× across the swatch.
2. **Rectify** the window to a fronto-parallel image at a known px/mm, anti-aliased when the
   photo is sharper than the output.
3. **Segment.** A robust quadratic background model (Lab) is fitted to a strip just inside the
   window. The Lab distance is thresholded with Otsu and a noise floor, then closed, and the
   largest component is kept with its holes filled. GrabCut refinement runs only when the
   contrast is poor.
4. **Measure.** `width_mm`/`height_mm` are the median chords through the central 60 % of the
   swatch, rows horizontal. `bbox_*` is the minimum-area rectangle. With `--n-stitches/--n-rows`
   the gauge is computed directly from these. This full-extent / count includes edge-stitch
   effects of about one yarn diameter (PROTOCOL.md explains how to measure interior spans by
   hand).
5. **Texture gauge (no counts needed).** The rectified swatch is rotated to its principal axes,
   band-passed and contrast-normalised inside the mask, apodised, and Fourier transformed. The
   **stitch pitch** is the fundamental of the 2-D power summed over k_y, which does not depend
   on how rows are offset. The **row pitch** is the fundamental of a strip around k_x = 0, wide
   enough to collect bowed rows. Residual tilt is removed from the strongest near-vertical peak.
   Fundamentals come from a harmonic score on a whitened spectrum and are refined from the
   interpolated harmonics. **Factor-of-2 ambiguities** are real: turned rows repeat every two
   rows, and the two legs of a "V" give a strong half-stitch harmonic. They are resolved by the
   stitch-type prior (h/w from `spec/stitches.json`; w ≈ 1.3 × hook), and the JSON says when
   the prior decided. `--row-repeat 1|2` overrides this.
6. **Confidence** (0–1) combines the peak strength with a split-window check: the pitch is
   re-estimated in the left, right, top and bottom halves. A half without a significant peak
   counts as a failure, and the spread of the four estimates matters. *high* ≥ 0.6, *medium* ≥
   0.35, otherwise *low*. A low result comes with a warning saying to count by hand.
7. **Stitch lattice (EXPERIMENTAL).** Row lines and per-row points come from the local phase
   (Gabor demodulation) of the row and stitch profiles. The output is per-row pitch statistics
   and an overlay. The points mark a consistent texture phase, not verified stitch centres.

## Validated so far (synthetic photos only)

From `tests/test_swatch.py` and `notebooks/swatch_analysis.py` (HTML in
`lab/reports/swatch_analysis.html`). There are 18 photos with camera tilt 0–40°, noise σ 2–15
(8-bit) plus blur and JPEG, sc and dc, and stitch pitch 5–7.5 mm:

| quantity | worst error observed |
|---|---|
| rectification (any point of the window, vs. true homography) | 0.04 mm |
| marker reprojection rms | 0.04–0.21 mm |
| swatch size (min-area box) | 0.4 % |
| stitch pitch from texture (no counts) | 0.12 % |
| row pitch from texture (no counts) | 0.39 % |
| camera tilt estimate | < 0.1° |

The tests also pass these robustness checks:

* 8 of 32 markers covered by "fingers": still works.
* Pale yarn on the dark-window sheet: works.
* Letter layout: works.
* Card layout (textured table, contact shadow): size within 3 %, gauge within 0.1 %.
* No markers, or only 3 markers: a clear `MarkerDetectionError`.
* Sheet printed at 97 %: sizes come out +3 % (undetectable), and `--ruler-mm 97` fixes it.

**The texture gauge degrades as the fabric gets less regular.** With per-stitch jitter of
8 % or less of the pitch and row bowing of 0.6 mm or less, errors stay below 0.5 % at medium or
high confidence. From about 12 % jitter / 1 mm bowing the confidence drops to *low*, often before
the estimate actually fails. From about 18 % jitter, estimates can be off by 2–100 %, always at
confidence 0.00. In the notebook sweep, every result at confidence ≥ 0.35 was within 0.5 % (7 photos), and the
worst low-confidence result was off by 120 %. These
numbers say the geometry and signal processing are sound. They say nothing about how regular real
fabric is.

## Limitations

* **Synthetic validation only** (see above). The synthetic yarn is a set of shaded tubes and is
  much more regular and higher-contrast than real fibre.
* **Print scale is not observable from the photo.** A homography absorbs any uniform or
  anisotropic print scaling. Measure the bar.
* **Swatch thickness**: the top of the fabric is above the sheet plane, which magnifies it by
  about t/Z (≈1 % for 3 mm at 30 cm). `--thickness-mm` corrects this approximately, using the
  camera distance estimated from the homography.
* **Lens distortion is not modelled.** Phones mostly correct it; avoid the ultra-wide lens.
* Segmentation assumes the yarn contrasts with the sheet. Variegated yarn that matches the paper
  in places, very fuzzy yarn, and open lace (holes larger than ~4 mm get closed) are untested.
  On the card route a textured table and contact shadows cost up to a few % of size.
* The texture gauge assumes a single stitch type in flat rows. Mixed stitch patterns, shells and
  lace give several periodicities, and the reported one may be a pattern repeat.
* The lattice is experimental and not validated against stitch centres.

## Next steps

1. **Real photos**: photograph the PROTOCOL swatches, measure them by hand as well, and report
   the photo − hand differences per stitch type and yarn. This is the missing validation.
2. **Lace / thread / mesh**: render chain-space meshes and thread swatches in `synth.py`, and
   detect hole lattices directly (the holes are the most visible feature of lace).
3. **ML stitch detection** trained on synthetic renders (domain-randomised `synth.py`: yarn
   shading, fuzz, colours, stitch anatomy), predicting stitch centres / row lines and so
   validating the experimental lattice; fine-tune on a small hand-labelled real set.
4. ChArUco corners (chessboard-precise) if real photos show the marker corners to be the
   limiting error; currently the ArUco frame gives ~0.05 mm rms on synthetic photos.
5. A browser version (OpenCV.js) for the app, using the same `sheet_layout.json`.
