# lab/ — research side (Python)

This folder holds the reference stitch-network simulator, the analytic flatness check, discrete
curvature, parameter fitting and the reports. The app (`app/`, TypeScript) contains the
real-time simulator. Both read the contracts in `spec/`; see `docs/architecture.md`.
The swatch photo tool lives in `crolab/swatch` and `lab/swatch/`, with its own README.

## Run

```
make lab            # uv sync, pytest, execute notebooks -> lab/reports/*.html
make lab-fixtures   # re-simulate the canonical fixtures -> spec/fixtures/<name>.lab.json
cd lab && uv run pytest -q
cd lab && uv run python -m crolab.fitting data/example_swatches.csv --out /tmp/params.json
```

## What is here

| module | what |
|---|---|
| `crolab/graph.py` | Loads and validates pattern JSON (`spec/pattern.schema.json`). Accessors for rounds, anchors, spaces and stitch-counting nodes. |
| `crolab/builders.py` | Programmatic graph builders: `sc_rounds`, `dc_rounds_joined`, `hyperbolic`, `rect_rows`, plus hand transcriptions of the two lace fixtures. They produce the same graphs as the app compiler (this is tested). |
| `crolab/params.py` | Loads `stitch_params.json`, picks the set given by `meta.params` (or the default), and loads `sim_config.json`. |
| `crolab/network.py` | The spring network of `spec/physics.md` §3. It has two variants: `spec` (the spec text, literally) and `metric` (the default, with the lab corrections in `SPEC_NOTES.md`). |
| `crolab/sim.py` | Energy and analytic gradient (numpy), round-by-round growth with deterministic placement and perturbation, per-round and final L-BFGS (scipy). `simulate(pattern, params, upto_round, config) -> SimResult`. |
| `crolab/metrics.py` | Shape metric and classifier, physics.md §5: `{class, A, W, Rg, outer_radius}`. |
| `crolab/blocking.py` | Blocked solve, physics.md §6: in-plane, outer round pinned at `block_stretch`. Reports strains and the buckle fraction. |
| `crolab/flatness.py` | Analytic per-round flatness (`spec/flatness.md`), mirroring `app/src/core/flatness`. |
| `crolab/curvature.py` | Intrinsic Gauss–Bonnet curvature per round from rest lengths, and extrinsic angle deficits on a triangulation of the simulated surface (with exact discrete Gauss–Bonnet). Also plots. |
| `crolab/fitting.py` | Fits stitch width and height from swatch CSVs and writes a schema-valid `stitch_params.json` with `status: "fitted"`. |
| `crolab/fixtures.py` | `python -m crolab.fixtures` writes `spec/fixtures/*.lab.json`. Exits non-zero on a class mismatch. |
| `crolab/reports.py` | `python -m crolab.reports` executes `notebooks/*.py` (jupytext) into `reports/*.html` and writes `index.html`. |
| `notebooks/` | `01_fixtures_gallery`, `02_curvature`, `03_flatness_vs_sim` (cup → flat → ruffle), `04_parameter_fitting`. |
| `data/example_swatches.csv` | **SYNTHETIC** example measurements, generated with known truth. These are not real yarn. |
| `SPEC_NOTES.md` | Every decision where the lab deviates from or clarifies the spec. The TS sim must follow it. |

The `*.lab.json` reference files are reproducible: two runs give identical bytes (values are
rounded to 4 decimals). The tests check that the committed files are up to date.

## Fitting CSV format

There is one row per measured swatch. Header names matter; column order does not. A `#` at the
start of the `yarn` field comments the row out.

| column | required | meaning |
|---|---|---|
| `yarn` | yes | Yarn id, e.g. `worsted-4` (with `hook_mm` it names the parameter set) |
| `hook_mm` | yes | Hook size in mm |
| `stitch` | yes | Stitch id from `spec/stitches.json`. Unknown ids (e.g. `mesh`) are skipped with a warning. |
| `n_stitches` | yes | Number of stitches spanned by `width_mm` (for `ch`: number of chains) |
| `n_rows` | yes | Number of rows spanned by `height_mm` (`0` or empty for chain-length rows) |
| `width_mm` | yes | Measured length of `n_stitches` along the row |
| `height_mm` | yes (may be empty) | Measured length of `n_rows` rows. Empty means only the width is fitted. |
| `state` | no | `fresh` / `unblocked` (default) / `blocked`. Each state is fitted separately; set ids get the suffix `_<state>` (no suffix for unblocked). |
| `width_sd_mm`, `height_sd_mm` | no | 1-sd measurement uncertainty, used as weights |
| `rounds`, `counts`, `lies_flat` | no | Optional circle test on the row: `counts` = `6;12;18;…`, `lies_flat` = `yes`/`no`/`cup`/`ruffle`. It is checked against the analytic prediction made with the fitted parameters. |

Any other column is ignored. That covers the swatch tool's `swatch_id, method, repeat,
confidence, yarn_*`, notes and so on. `--circles file.csv` additionally checks flat-circle results
in the format of `lab/swatch/flat_circle_template.csv`.

**Model.** The model is `length = w·n + b` (weighted least squares; `b` is the edge allowance)
when there are at least 3 rows with at least 2 distinct n. Otherwise it is the ratio `length =
w·n`. The reported sd comes from the residual scatter, or from the given sd's if those are larger.
Stitch types that were not measured are filled in from the relative table in
`spec/stitches.json`, and the `provenance` field says which. Running
`python -m crolab.fitting m.csv --out p.json [--merge]` writes only the fitted sets, or (with
`--merge`) the base file with the fitted sets added or replaced. It does **not** touch
`spec/stitch_params.json` unless you pass that path as `--out`.

## Honest limitations

* **Nominal parameters.** All stitch sizes are unfitted nominal values, and the example CSV is
  synthetic.
* **Stiffness is not fitted.** Fitting it needs load or stretch tests. `fitting.py` copies the
  relative stiffness of the base set; this is a stub.
* **No gravity, friction or self-collision.** Strong ruffles can interpenetrate. Lace has no
  gravity to flatten slack loops: chain-space chains are tension-only, so their shape is set by
  the deterministic growth placement.
* **Almost no bending stiffness.** The network has essentially none against isometric bending,
  so tiny metric errors show up as finite waviness (amplitude ∝ sqrt(error)). The flat threshold
  `tau_flat` was raised to 0.25 for this reason. The number and size of ruffle waves are not
  predictive (see the literature review §4.6).
* **Shape is a local minimum** reached by deterministic round-by-round growth. Other minima exist
  for ruffles.
* **The extrinsic curvature triangulation needs solid fabric** worked in the round from a magic
  ring, with monotone anchors.
* **The intrinsic curvature** treats rounds as concentric circles, like flatness.md.
