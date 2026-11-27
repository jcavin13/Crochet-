# Independent review of the Phase 1 build

Reviewer: a fresh agent that built none of this. Date: 2026-11-27. Commit reviewed: `4d11c67`
(branch `claude/new-session-1jt15o`). Scratch artefacts (screenshots, adversarial inputs, scripts)
are in the session scratchpad, `…/scratchpad/review/` (not committed). Paths below are relative
to it: `shots/…`, `adv/…`, `ts/…`.

## 1. Verdict

The build is real and much more solid than a typical first draft. All test suites pass on a clean
clone. The app works on desktop and phone with no console errors, and the notation diagnostics
are good. The lab↔app contract is genuinely enforced: spring networks are compared at 1e‑6 and a
deliberate mutation of either sim fails CI. The docs are mostly honest about what is missing.

The weak point is the *physics as a second opinion*. On the 16 corpus patterns, the TS sim
disagrees with the analytic check on 5 of the 14 "flat" designs. It calls the deliberate *ruffle*
teaching example a **cup**, and on that page the UI tells the user to trust the simulation for the
overall shape. It also rates designer output aimed at "flat" as a cup. The lace flatness check
is close to unfalsifiable, because chain compliance plus arc rise make a ch‑20 loop round "flat".
CI's lab job has a load-dependent failure; I found the cause (BLAS thread oversubscription plus a
wall-clock assertion). No blockers. 6 majors, 18 minors, 12 nits.

## 2. Deliverables against the brief

| Brief item | Status | Evidence |
|---|---|---|
| Repo layout spec/ lab/ app/ data/ docs/ | present | `ls` |
| spec: JSON Schema, vocabulary, grammar, fixtures with expected results | present | `spec/pattern.schema.json`, `stitches.json`, `notation.md`, 7 fixtures × {cro, expected, graph, lab, network} |
| 7 canonical fixtures (sc circle, sphere, cone, hyperbolic, dc circle, doily, chain-space motif) | present | `spec/fixtures/`; counts and classes re-derived by me (§5) |
| Both sims agree on fixtures in CI | present, real | `app/src/core/sim/{network,sim}.test.ts`, `lab/tests/test_fixtures.py`, `test_export_network.py`; mutation test §5 |
| `stitch_params.json` produced by lab, consumed by app | present (nominal values only) | `spec/stitch_params.json`, `crolab.fitting` |
| Chain spaces first-class; full stitch list; repeats; count annotations | present | `notation.md` §3, adversarial tests §4 |
| US default / UK toggle | present | `adv/a14_uk`, `shots/editor_uk.png` |
| Validation: count mismatch, impossible target, unclosed repeat, with line/col | present | `shots/editor_*.png`, §R3/R6 for gaps |
| CYC symbols, JIS differences noted | present; JIS unverified | `app/src/core/chart/SYMBOLS.md`; see R19 |
| app 1 parser + validator | present | 796 vitest tests |
| app 2 radial chart, SVG, exportable | present | `dl/*.svg`, `dl/*.png` exported via UI |
| app 3 flatness checker + colour band | present; weak for lace (R4) | `shots/desk_chart.png` |
| app 4 TS sim + 3D view + relaxed/blocked, consuming stitch_params | present; credibility issues (R1, R2) | `shots/sim_*.png` |
| app 5 generative designer | present | 162 seeded designs, all compile, all hit their analytic aim (`ts/designer.ts`) |
| app 6 phone row counter, local persistence | present | `shots/counter_*.png`; reload persists |
| app 7 local-only storage | present | IndexedDB; import/export round-trip OK |
| lab 1 research sim reproducing fixtures | present | 119 pytest pass |
| lab 2 discrete curvature + plots | present | `crolab.curvature`, `reports/02_curvature.html` |
| lab 3 parameter-fitting scaffold | present (stiffness stubbed, documented) | `crolab/fitting.py` |
| lab 4 swatch photo analysis + printable marker sheet | present; synthetic validation only (documented) | `lab/swatch/*.pdf`, `reports/swatch_analysis.html` |
| lab 5 swatch measurement protocol | present, followable | `lab/swatch/PROTOCOL.md` (289 lines: equipment, swatch sizes, flat-circle tests, CSV) |
| lab 6 notebooks + pre-rendered HTML reports | present; not reproducible byte-for-byte (R10) | `lab/reports/*.html` |
| Stretch: amigurumi surfaces of revolution + sim preview | present | `shots/ami_*.png` |
| Stretch: gauge → stitch counts | present | hand-checked §R-gauge (all correct) |
| Literature review | present, 54 entries, good quality, a few errors | §6 |
| Data: public-domain vintage corpus 10+ | **missing (honestly declared)** | `README.md`, `data/README.md` §B, decision 16 |
| MANIFEST.csv, one row per file | present, exact | §7 |
| `npm run dev`, `make lab` one-command start | present, both work | §3 |
| GitHub Pages workflow | present; not verified live; deploys only from `main` (R21) | `.github/workflows/pages.yml` |
| Demo gallery page | present | `#/` |
| Screenshots in docs/screenshots referenced from README | present, all referenced files exist | `grep` check |
| docs: architecture, decisions, roadmap, README | present; some drift (R17) | §R17 |
| Independent review `docs/review.md` | this file | |

## 3. What I ran

Environment: Linux, 4 cores. Node 22.23.5, npm 10.9.9, uv 0.11.32, Python 3.13.18,
numpy using scipy-openblas 0.3.34 (DYNAMIC_ARCH, Haswell kernel), Chromium via global Playwright.

| Command | Result | Time |
|---|---|---|
| `cd app && npx tsc --noEmit` | clean | 7 s |
| `npx vitest run` | 21 files, **796 passed** | 31 s |
| `npm run build` | OK. Warning: `Scene3D` chunk 943 kB (248 kB gz); PWA precache 48 entries / 1.8 MB | 9 s |
| `npm run fixtures -- --check` | exit 0 (fixture graphs current; tiny matches hand-made graph) | 2 s |
| `cd lab && uv run pytest -q` (idle machine) | **119 passed in 100.7 s**. CPU time 5 m 10 s for 1 m 41 s wall, so BLAS uses multiple threads | 101 s |
| same, with 6 busy-loop processes (load ≈ 8) | **1 failed**: `test_fixture_shape_class[chain_space_motif]`, `assert 91.6 < 60` (`res.seconds`) | 92 s |
| same under the same load with `OPENBLAS_NUM_THREADS=1` | 7/7 shape-class tests pass, 35 s | 35 s |
| `OPENBLAS_NUM_THREADS=1 uv run python -m crolab.fixtures` | all 7 fixtures, tree stays clean | **20 s** |
| `uv run python -m crolab.export_network --check` | OK | 0.7 s |
| `make lab` (root) | works end to end: tests pass, 5 notebooks executed, `lab/reports` regenerated. **Leaves the tree dirty**: all 6 report HTML files modified (R10) | 10 m 32 s (machine loaded by my parallel runs) |
| Clean room: `git clone` → `npm ci` → typecheck → vitest → `npm run fixtures` + `git diff --exit-code spec/fixtures` → build; `uv sync` → pytest | all pass. Fixtures clean, dist built, 119 passed in 100 s | 49 s + 104 s |
| Clean room: root `npm install && npm run dev` | Vite dev server up on :5173. Leaves an untracked root `package-lock.json` (N4) | |
| Playwright tour, desktop 1280×800 + phone 390×844, every route incl. 404 | no console errors or page errors, no horizontal overflow at 390 px | |

After `make lab` I restored the six report files with `git show HEAD:<path> > <path>`. That changes
no git state, and the working tree is as I found it.

**The earlier "1 failed, 118 passed in 307 s" is load-dependent, not a real failure.** It is the
wall-clock assertion `assert res.seconds < 60` in `lab/tests/test_fixtures.py:24`. The physics
result is identical under load (A/W/class unchanged in the regenerated reports). What breaks is
the time: OpenBLAS spawns threads for tiny L-BFGS vectors, and under contention a 5 s sim takes
90 s. See R5.

CI workflows read against the above:
* `ci.yml` app job: `npm ci`, typecheck, test, `npm run fixtures && git diff --exit-code -- ../spec/fixtures`, build. `package-lock.json` is committed and `npm ci` works on a clean clone. **Should pass.**
* `ci.yml` lab job: `uv sync` (lock present but not `--locked`), `uv run pytest -q`. Passes on an idle 4-vCPU runner. Exposed to R5 (timing) and R11 (exact float equality across CPU microarchitectures).
* `pages.yml`: builds `app/dist` with `base: './'` and hash routing, so a project-site path works. It only triggers on `main`, and this work is on `claude/new-session-1jt15o` (R21). Pages must be enabled once in Settings; the README says so.
* Nothing in CI depends on local state that I could find. There are no absolute paths in tracked files.

## 4. Findings

Severity: **blocker** = broken or misleading for the user; **major**; **minor**; **nit**.

### Blockers

None.

### Majors

**R1 — The 3D "second opinion" contradicts the deliberate teaching examples and many corpus
designs, and the UI tells users to trust it (major).**
Evidence: `ts/sim.ts` (core `simulate` + `shapeMetric` + `block`) on every corpus file:

| pattern (analytic says) | TS sim | converged | blocking |
|---|---|---|---|
| teaching-ruffle-shell-doily (**ruffle**, +207 %) | **cup**, A 0.61 W 0.27 | yes | impossible |
| popcorn-ridge-mat-8 (flat) | **cup**, A 0.42 | yes | impossible |
| rep-from-star-rosette-8 (flat) | **cup**, A 0.85 | yes | impossible |
| hexagon-motif-6 (flat) | **ruffle**, W 0.29 | **no** | impossible |
| puff-star-coaster-5 (flat) | **ruffle**, W 0.28 | **no** | impossible |
| petal-doily-12 (flat) | flat | yes | **impossible** |
| bobble-flower, spiderweb, sunburst | flat | **no** | easy/firm |

The browser shows the same thing (`shots/sim_corpus_teaching-ruffle-shell-doily.png`): "Simulation:
**Cups** · Count rule: Ruffles … *Trust the count rule for which round to fix, and the simulation
for the overall shape.*" That advice is wrong for the one corpus file designed to ruffle. In that
screenshot the piece is visibly ruffled, but the classifier calls it a cup: physics.md §5 picks
`cup` when A ≥ W, and a strong ruffle on a short piece has a large A. The designer shows the same
problem. Seed 1, 8-fold, target "flat" comes out analytic flat but sim **cup** (A 0.39, W 0.37,
not converged). Target "bowl" comes out analytic cup but sim **ruffle**. No test runs the sim on
anything except the 7 fixtures, so none of this is caught.
Fix: (a) add the corpus and a few designer seeds to a sim regression test with *expected* classes;
(b) make the classifier robust for strong ruffles, e.g. W relative to local radius, or count
sign changes of z around the outer round; (c) remove the "trust the simulation for the overall
shape" sentence until (a) passes; (d) show "did not converge" in the UI (R12).

**R2 — `tau_flat` and the agreement tolerances are tuned to the fixtures and leave little margin
(major).**
Decision 14 raised `tau_flat` from 0.10 to 0.25 because flat fixtures reached 0.18. `flat_dc_circle`
sits at A = 0.175 against a threshold of 0.25. `agree_abs` = 0.12 is half the class band. In my
mutation test, loosening the TS per-round `gtol` from 1e‑6 to 1e‑2 still passed the metric-agreement
test for 6 of 7 fixtures; only `sc_sphere` failed. The network parity test, not the metric
tolerance, is what really pins the sims together (§5). The analytic band (tol 10 %) and the sim's
effective band (|e| ≈ 2–4 %, `lab/SPEC_NOTES.md`) also differ by design. Every pattern between
4 % and 10 % will show "count rule: flat / simulation: cup or ruffle", and R1 shows this happening.
Fix: tighten `agree_abs` per fixture (e.g. 0.03 for solid fixtures; keep it loose only for the
multistable hyperbolic plane), and derive `tau_flat` and `flatness.tol` from one stated metric error
instead of tuning them independently.

**R3 — "Fasten off." on its own line, a very common way to end a pattern, gives a wrong and
misleading error (major).**
`adv/b11_spiralfo.cro`:
```
Rnd 2: inc x6. (12)
fasten off
```
→ `2:16 E_SYNTAX empty group "()" — expected stitches inside.` and `2:19 expected a stitch name after "12" but found ")"`.
The UI shows the same (`shots/editor_fasten_line.png`, "Fasten off." line). The text after the
count is treated as a continuation of Rnd 2, so the count annotation stops being "last" and is
re-parsed as a group. The message points at the user's *correct* count.
Fix: accept `fasten off` / `finish off` / `fo` as a stand-alone line (a pseudo-round terminator).
Failing that, detect "count annotation followed by more items" and say so.

**R4 — The analytic lace check is close to unfalsifiable, so the colour band is green for
absurd lace (major).**
`adv/c04_longloops.cro` (8 sc + ch‑12 loops, then ch‑20 loops) → Rnd 3 nominal excess
**+123 %** but `e_min = −0.10`, class **flat** ("Rnd 3 lies flat"). This happens because chain
slack goes down to 30 % and the "arc rise" from Rnd 2 inflates the radius. The spiderweb corpus
doily shows "Count rule **Flat** · +28.4 % length" in the 3D panel. The bands in
`lab/SPEC_NOTES.md` are as wide as −0.37…+0.50 for the chain-space fixture. The README admits
"will accept very long loops as flat". For a lace-first product this is the headline diagnostic,
and as built it cannot fail on lace.
Fix: cap the arc-rise contribution (a loop cannot both sag to 30 % *and* stand outward at full
length). Report "flat only if loops sag by X %" as a separate *lace-tension* warning rather than
plain "flat". Add a negative lace fixture that must classify ruffle.

**R5 — Lab CI is flaky under load: wall-clock assertion plus BLAS thread oversubscription
(major).**
`lab/tests/test_fixtures.py:24` `assert res.seconds < 60`. Reproduced (§3):
`chain_space_motif` took 91.6 s under load and failed. With `OPENBLAS_NUM_THREADS=1` the same
tests passed in 35 s under the same load, and all fixtures run in 20 s instead of ~100 s. Idle
pytest uses 5 min of CPU for 1 min 41 s of wall time, so the threads are pure overhead for these
problem sizes.
Fix: set `OPENBLAS_NUM_THREADS=1` / `OMP_NUM_THREADS=1` in `conftest.py`, `crolab/__init__.py`
or the Makefile/CI env. Drop the wall-clock assertion, or measure iterations instead.

**R6 — The validator silently accepts a round that skips most of the previous round (major).**
`adv/b02_spaceskip.cro`: Rnd 1 makes 8 sc and 8 ch‑3 sps. Rnd 2 works into only 2 of the 8
spaces and joins. Result: **0 errors, 0 warnings**. Two rules combine here: `next ch-3 sp` silently
passes over stitches (SPEC_NOTES 1), and a chain arc before the join "covers" every remaining
target (SPEC_NOTES 2). `W_UNWORKED` only counts stitch targets, never spaces. A transcription error
that drops six repeats is therefore invisible unless the user wrote a count that happens to
disagree.
Fix: warn when a closing arc covers more than one repeat's worth of targets, or when chain spaces
of the previous round are left unworked. Keep the current leniency for the usual case of 1–2
targets.

### Minors

**R7 — Flatness messages are absurd for closed shapes.** The sphere fixture's last round has 6
stitches and reads "Rnd 14 will cup: about **78** stitches under flat (−93 %)". The chart
legend's "Worst:" shows this too (`docs/screenshots/chart-sphere-desktop.png`). It is correct
under Gauss–Bonnet with accumulated geodesic radius, but useless to a crocheter. Fix: for rounds
whose count decreases, or when g ≈ −1, report the incremental ratio g ("closing: decreasing as for
a sphere/cone") instead of the absolute deficit.

**R8 — The flatness formula is implemented three times, plus a fourth time in amigurumi.**
`core/flatness/index.ts`, `lab/src/crolab/flatness.py`, `core/generate/predict.ts`, and
`amigurumi` (`rate = 2πh/w`). The predictor has a parity test against the TS analyzer. The Python
mirror is only checked on the fixtures, and the lace fixtures have no per-round expected values
(`expected.json` says "per-round values are produced by the implementation"). Fix: add a
cross-language golden file over the corpus (per-round e/eMin/eMax) generated by TS and asserted in
pytest.

**R9 — The expected analytic values are not independent of the code.** For the solid fixtures
my independent script reproduced every `excess` and class exactly (§5), which is good. But the
lace fixtures' "expected" analytic behaviour is just "every round flat", which R4 shows is almost
guaranteed. Fix: hand-derive per-round expectations for `simple_doily`, at least the stitch-only
rounds.

**R10 — `make lab` is not reproducible and dirties the tree.** It modifies all six
`lab/reports/*.html`: random notebook cell ids (`cell-id=1a235ceb` → `671e433e`), wall times in
outputs and in `index.html`. It took 10.5 min here. Fix: strip or fix cell ids (nbconvert
`--ClearMetadataPreprocessor`, or seed the ids), remove timings from committed outputs, and apply
the R5 thread fix.

**R11 — `test_lab_json_up_to_date` needs exact float equality (4 decimals) across machines.**
The hyperbolic plane is documented as multistable at the level of floating-point rounding
(`sim.test.ts` header comment). OpenBLAS picks kernels per CPU (DYNAMIC_ARCH), so a GitHub runner
with AVX‑512 may land elsewhere and fail. I could not test another CPU. Fix: compare `lab.json`
within a tolerance, or exclude multistable fixtures from exact comparison.

**R12 — Non-convergence is hidden in the UI.** `SimResult.converged` is never shown
(`grep converged app/src/features/sim` finds nothing). 5 of 16 corpus patterns do not converge
in Node within the iteration caps. The browser gave spiderweb A 0.01 / W 0.15 after 8.7 s, against
A 0.049 / W 0.205 (not converged) in Node, and still printed "Both checks agree." Fix: show "still
settling / not converged" and never print an agreement verdict on an unconverged state.

**R13 — Offline on the first visit.** On the first visit the service worker does not control
the page (`navigator.serviceWorker.controller === false` after 4 s). The app nevertheless toasts
"Ready to work offline". Going offline and then opening `#/sim` crashes the route ("Failed to
fetch dynamically imported module … sim-*.js" / "Unable to preload CSS SimView-*.css"). After a
reload it works offline (`tour8.cjs`). Fix: `clientsClaim: true` in the workbox config, or only
toast once `controller` is set.

**R14 — Typing or pasting into a built-in example keeps the built-in's title.**
`features/editor/index.tsx:64` calls `create({ text, title: rec.title })`. Pasting a whole new
pattern with `title: Review roundtrip ×` into the simple-doily example produced a "Mine" record
titled "Simple doily (16-fold, no pineapples)". The exported file was named
`simple-doily-16-fold-no-pineapples.cro` but contained the new pattern (`lib.cjs`). Fix: use
`extractTitle(text, rec.title)`.

**R15 — Empty or degenerate rounds are accepted.** `Rnd 2: .` produces only `W_UNWORKED`, then
Rnd 3 errors with "Rnd 2 has none left" (`adv/a07_empty`). `ch 200000` compiles to 200 013 nodes
with no warning (`adv/b03_bigchain`), which would freeze the chart and 3D view. Fix: `E_SYNTAX`
for a round with no items, and a sanity cap or warning for very large chain or repeat counts.

**R16 — The spec contradicts itself in places.**
(a) The EBNF comment for `reptail` says vintage "repeat from * 5 times" means *5 more*, while §3.7
and the implementation say *N total* (`adv/b04_repN`: `*inc; rep from * 5 times` → 10 sts).
(b) §3.3 says a different-length next space is `E_SPACE_LENGTH`, and its own example in §4
("the next space is a ch-5 sp") contradicts §4a, where the cursor skips past other lengths.
(c) `notation/SPEC_NOTES.md` item 4 is titled "cursor starts *before* the join stitch" while §4a
says "starts *at*". These describe the same behaviour in conflicting words.
Fix: fold `SPEC_NOTES.md` into `notation.md` and delete the superseded sentences (notation.md asks
for this itself).

**R17 — Documentation drift.**
`docs/architecture.md:38` says `data/` holds a "public-domain corpus transcribed into the
notation", which is false: it is 16 original CC0 patterns. `spec/physics.md:72` says "The app sim
uses a fixed budget of damped iterations per frame", but it uses L-BFGS with time-budgeted steps
(`core/sim/lbfgs.ts`, `solve.ts`). `spec/README.md:17` points to `make fixtures` in `lab/`, but
the target is `make lab-fixtures` at the root. The architecture components table omits amigurumi.

**R18 — The literature review's design recommendations are not reconciled with the code.** The
review's synthesis says: use XPBD for the interactive solver, add a discrete-shell bending energy,
have the flatness checker compute angle deficit from rest lengths, and implement CrochetPARADE
import. The code uses L-BFGS on springs only, an N_k vs 2πρ flatness rule, and no interop. Those
are defensible choices, but `docs/decisions.md` never records why the review's advice was not
followed. A future agent reading both will get conflicting guidance. Fix: add 2–3 decision rows
that cite the review sections.

**R19 — The "JIS" chart style is shown in the UI without the "unverified" caveat.** The README
says "the chart's 'JIS' symbol set is marked unverified". That is true only in
`core/chart/SYMBOLS.md`. The toggle in `features/chart/index.tsx:147` says "JIS — Japanese chart
conventions" with no caveat. Fix: label it "Japanese style (unverified)".

**R20 — No licence for the code.** There is no LICENSE file at the root. The corpus is CC0, and
the lit review (§5.3) says the licence should be decided, but nothing was decided. A public
Pages deploy of unlicensed code is legally ambiguous for reuse. Fix: pick a licence and record
it in `decisions.md`.

**R21 — CI and deploy hygiene.** The lab job uses `uv sync` without `--locked`, so it could
silently re-resolve if the lock drifts. Pages deploys only from `main`, but the reviewed work is
on `claude/new-session-1jt15o`, so "every push publishes the app" (README) is not yet true. The
`Scene3D` chunk (943 kB) triggers the Vite size warning. Fix: `uv sync --locked`; merge to
`main`, or add the branch.

**R22 — Corpus simulations are slow.** In Node, with the machine partly loaded:
spiderweb 110 s, wheel-mesh 74 s, petal 60 s, sunburst 44 s. Several hit the iteration cap. The
browser view uses a time budget, so the UI stays responsive, but the result shown is then
whatever state the solver reached (R12).

**R23 — Chart glyph ambiguity.** sc symbols are rotated radially, so in the same round the "×"
glyph appears as "+" at 45° (`dl/chain-space-lace-motif-8-fold-loops-chart.png`, round 3). The UI
also offers an "sc × / sc +" toggle as if they were distinct conventions. Fix: do not rotate sc
crosses, or rotate by the stitch lean only.

**R24 — 3D closed shapes look wrong.** The sphere fixture relaxes to a flat-topped bucket or bell
(`shots/sim_fixture_sc_sphere.png`). The amigurumi physics preview of a lemon-shaped profile is a
dome with a flat wide base (`shots/ami_sim.png`). The README does say "no stuffing" and "read the
3D view as which way will this go", but the amigurumi page presents it as a preview of the drawn
shape. Fix: label the amigurumi preview "unstuffed"; add internal pressure in Phase 3 as already
planned.

### Nits

* **N1** — Cascading errors. After `fasten off` mid-pattern, the next round also reports
  `E_COUNT_MISMATCH … makes 0 stitches` (`adv/a10`). A backwards range `Rnds 3-2` reports a second,
  confusing "found Rnds 3 (a gap)" (`adv/a17`).
* **N2** — `E_NO_SPACE` says "Rnd 1 has none **left**" when Rnd 1 never had any ch‑3 sp
  (`adv/a12`).
* **N3** — A count annotation placed mid-round, `mr, (6) 6 sc in ring.`, gives "empty group ()"
  rather than "count annotation must come last" (`adv/b07`). A duplicate `title:` header is
  silently accepted (`adv/b12`).
* **N4** — Root `npm install` (the README's one-command start) leaves an untracked root
  `package-lock.json`.
* **N5** — `scripts/fixtures.ts` creates a new `/tmp/crochet-tiny-*` directory on every run and
  never removes it.
* **N6** — Every designer "Open in…" click saves a new copy to My patterns (4 clicks = 4 records).
* **N7** — Counter: "< 1 min left in round" shows before any timing data exists. "repeat 1 of 6"
  shows on the round-done checkpoint. Reloading at a checkpoint silently skips the "count your
  stitches" prompt.
* **N8** — Accessibility: the 3D `<canvas>` has no accessible name. The counter note
  `<textarea class="ctr-notearea">` has no label. The tap area is `tabIndex=-1` (a global
  Space/Enter handler compensates). Otherwise every route has one `h1`, labelled controls and
  `lang="en"`.
* **N9** — `granny-square-motif.cro` is a generic traditional construction, not an original
  design. That is fine legally, but describe it as "traditional construction, written out for
  this project".
* **N10** — Lit review: "Sethapakdi" should be "Sethapakadi" (KnitPicking). Yuksel et al. 2012
  is listed as TOG 31(**3**); SIGGRAPH 2012 papers are TOG 31(4), Article 37.
* **N11** — `rectangle()` applies ease to the height (row count) as well as the width, while
  `tube()` applies it only to the circumference.
* **N12** — The `UV_NATIVE_TLS` deprecation warning on every `uv` call comes from the environment,
  not the repo. It is listed only so nobody chases it.

### What works well (for calibration)

The parser's messages are specific and positioned. UK hints work in both directions
(`htr` in a US file, `sc` in a UK file), and so does "did you mean" (`scc` → `sc`). Tabs, CRLF,
`×`, case, wrapped lines and range labels all work. US⇄UK conversion is correct and keeps
comments. Chart SVG and PNG export work and embed the legend. Counter persistence works across
reloads. Library `.cro` and `.crochet.json` round-trip work. The designer produced 162 of 162
compiling designs over orders 3–24 × 6 seeds × {flat, ruffle, bowl}, all on their analytic aim.
Gauge calculators are arithmetically right (below). Dark mode renders on every page.

Gauge spot checks by hand (gauge 18 sts × 20 rows / 10 cm):
* Rectangle 50 × 30 cm → 90 sts × 60 rows, foundation ch 91 ✓.
* Circle Ø 20 cm: rate 2πh/w = 2π·5/5.556 = 5.65 per round, radius 100 mm = 20 rounds, final
  114 sts against 2π·100/5.556 = 113.1 ✓.
* Tube 56 cm at −10 % ease: 50.4 cm × 1.8 = 90.7 → 91 sts ✓.
* Hat, 56 cm head, 8 % negative ease, 14 sts × 10 rows: 560·0.92/7.14 = 72.1 → 72 sts, crown
  increase 9 per round ✓.

## 5. Cross-sim agreement

**Is the contract real?** Yes. Two layers:
1. *Network parity* (`app/src/core/sim/network.test.ts` against `spec/fixtures/*.network.json`
   exported by `crolab.export_network`). Every spring's rest length and stiffness is compared at
   1e‑6 relative, for all fixtures plus `tiny`. I multiplied the TS `k_bend` by 1.5 in a scratch
   clone. **All 8 parity tests failed**, plus the hyperbolic agreement test. Staleness of the
   reference files is itself tested in pytest (`test_export_network.py`).
2. *Metric agreement* (`sim.test.ts`). Class must match, Rg within 10 %, and A and W within 0.12
   absolute. Loosening the TS round tolerance (`gtolRound` 1e‑6 → 1e‑2) failed `sc_sphere`, the
   determinism test, the per-round cone test and the blocking test. The other six fixtures still
   passed agreement.

So drift in the *network* is caught at once. Drift in the *solver* is caught mainly by the
auxiliary determinism and per-round tests, not by the 0.12 tolerance, which is loose (R2).
The hyperbolic plane is honestly documented as landing at W 0.52 against the lab's 0.60.

**Is anything tuned to pass?** `tau_flat` = 0.25 was explicitly tuned on the fixtures
(decision 14, `lab/SPEC_NOTES.md`). The sweep table there is a fair justification, but the margin
is thin: `flat_dc_circle` A = 0.175. The "metric" network variant (N1–N4) is a substantive change
that makes flat discs exactly realisable. That is physically motivated and well documented, and
the literal spec variant is kept for comparison. This is good practice, not cheating.

**Independent re-derivation.** I wrote my own script, using no project code, with
w_sc = w_dc = 6.5 mm, h_sc = 6.175, h_dc = 12.35 and the magic-ring rule
ρ₁ = max(h, C₁/2π). For four fixtures it matched the counts and every per-round analytic class,
with max |Δexcess| = 0.000:

| fixture | counts | final round (mine) | expected class |
|---|---|---|---|
| flat_sc_circle | 6,12,…,48 ✓ | 48 sts, e = +0.005, flat | flat ✓ |
| sc_cone | 6,9,…,27 ✓ | 27 vs 47.8 needed, e = −0.435, −20.8 sts | cup ✓ |
| hyperbolic_plane | 6,12,24,36,54,81 ✓ | e = +1.26, +45.2 sts | ruffle ✓ |
| flat_dc_circle | 12,…,60 ✓ | e = +0.004 | flat ✓ |

Brief's example, by hand: an sc circle that is +4 at round 7 (`adv/c01_ruffle7.cro`, 46 sts).
Flat needs 2π·43.3/6.5 = 41.8, so the excess is +4.2. The app says "Rnd 7 will ruffle: about 4
stitches over flat (+10%)" ✓. Note it is *exactly* at `tol` = 10 %: +3 (`c02_plus3`) reads flat.
The sim says flat for both (A 0.21 and 0.16, close to `tau_flat`).

## 6. Literature-review verification (WebSearch, 18 entries)

| § | Citation as given | Verified? | Notes |
|---|---|---|---|
| 1.1 | Edelstein, Peleg, Itzhaky, Ben-Chen, *AmiGo*, SCF '22, DOI 10.1145/3559400.3562005, arXiv 2211.01178 | ✓ | authors, venue, DOI, arXiv all match |
| 1.5 | Guo, Lin, Narayanan, McCann, *Representing Crochet with Stitch Meshes*, SCF '20, DOI 10.1145/3424630.3425409 | partly | Authors ✓ (Michelle Guo). The SCF DOI **could not be found**. The indexed record is a SIGGRAPH 2020 *poster*, DOI 10.1145/3388770.3407448. The review flags this in its unverified list but still presents the SCF DOI in the main text. |
| 1.6/1.7 | Seitz, Rein, Lincke, Hirschfeld, *Digital Crochet*, Onward! '22, DOI 10.1145/3563835.3567657 | ✓ | pp. 48–62 |
| 1.8 | Çapunaman, Bingöl, Gürsoy, CAAD Futures 2017, CCIS 724, pp. 289–305, DOI 10.1007/978-981-10-5197-5_16 | ✓ | |
| 1.9 | Greer, Mould, *Force-directed Graph Layout*, 2025, DOI 10.2312/exw.20251057 | ✓ | Expressive 2025 (EG DL), CC BY 4.0 |
| 1.10 | Li, Huang, (Hua), Chawla, *CrochetBench*, arXiv 2511.09483, ACL 2026 long 604 | ✓ | the author-version note is accurate |
| 2.1 | Henderson, Taimina, *Crocheting the Hyperbolic Plane*, Math. Intelligencer 23(2) 2001, 17–28 | ✓ | |
| 2.3 | Osinga, Krauskopf, *Crocheting the Lorenz Manifold*, MI 26(4) 2004, 25–37; 25,511 stitches | ✓ | |
| 3.3 | Yuksel, Kaldor, James, Marschner, *Stitch Meshes*, TOG 31(3) 2012 | partly | Title and authors ✓. Issue should be **31(4)**, Art. 37 (SIGGRAPH 2012); some sources say 31(3) (N10) |
| 3.9 | Leaf, Wu, Schweickart, James, Marschner, 2018, DOI 10.1145/3272127.3275105 | ✓ | TOG 37(6), Art. 202 |
| 3.10 | Hofmann, Albaugh, **Sethapakdi**, …, *KnitPicking Textures*, UIST '19 pp. 5–16, DOI 10.1145/3332165.3347886 | ✓ | spelling is "Sethapakadi" (N10) |
| 3.16 | Gray, Bell, Sieper, Kobourov, Schreiber, Klein, Hong, *Wooly Graphs*, arXiv 2407.00511 | ✓ | 7 authors ✓ |
| 4.1 | Meyer, Desbrun, Schröder, Barr, DOI 10.1007/978-3-662-05105-4_2 (2002/2003) | ✓ | VisMath 2002, book 2003; the review's "2002/2003" is right |
| 4.3 | Grinspun, Hirani, Desbrun, Schröder, *Discrete Shells*, SCA 2003, DOI 10.2312/SCA03/062-067 | ✓ | |
| 4.4 | Klein, Efrati, Sharon, Science 2007, DOI 10.1126/science.1135994 | ✓ | 315(5815):1116–1120 |
| 4.6 | Sharon, Roman, Marder, Shin, Swinney, *Buckling cascades*, Nature 419:579 (2002) | ✓ | DOI 10.1038/419579a found; the review lists it as unconfirmed, which is conservative |
| 4.7 | Provot, GI '95 pp. 147–154, DOI 10.20380/GI1995.17 | partly | Paper and pages ✓. The DOI did not appear in search results; its format matches the GI DOI scheme, so it is plausible but unconfirmed |
| 6.4 | JIS L 0201 *Letter Symbols for Knitting Stitch* (1995) | ✓ title/date | Crochet coverage is unconfirmed, and the review says so honestly |

Overall the review is careful and its "Unverified" section is honest. I found no invented
citations. The errors are small: one issue number, one spelling, and one DOI the review already
doubts but still prints in the main text. Its "what it means for this project" paragraphs
recommend things the code does not do (XPBD, shell bending, angle-deficit flatness, CrochetPARADE
import, user-defined stitches). Those are recommendations, not claims about the code, but see R18.
A few paragraphs read as statements about the project's design ("Use **XPBD** for the interactive
visualizer") and are now contradicted by `docs/decisions.md` 7–8.

## 7. Data and licensing audit

* **MANIFEST vs. contents.** `git ls-files data`, `find data -type f` and the manifest's `path`
  column are identical sets: 23 files, one row each, no duplicates. Every row has a licence
  (CC0-1.0), a date (2026-11-27) and a purpose. The source URL is "n/a (original)" for patterns
  and empty for synthetic swatches and docs. The synthetic swatch JPGs are marked "SYNTHETIC, not
  a real swatch" ✓.
* **Licensing rules.** No scraped or third-party content found. Every pattern says
  `source: original (written for this project, 2026)` and `license: CC0-1.0`. I read
  `granny-square-motif`, `spiderweb-doily-10` and several others. None reproduces a recognisable
  published design. The granny square is the generic traditional construction (N9). The
  spiderweb, sunburst and petal designs are generic motif families, not specific published doilies.
  I cannot rule out accidental resemblance to some published pattern; nothing looked like a
  verbatim reproduction.
* **Honesty about the vintage corpus.** README "Not done", `data/README.md` §B and decision 16 all
  clearly say the vintage public-domain corpus was **not** gathered because gutenberg.org and
  archive.org were blocked, and that nothing was reconstructed from memory ✓. The roadmap carries it
  into Phase 2 with a procedure ✓. The "before 1929" rule is conservative (works from 1930 and
  earlier are US public domain as of 2026), which is fine.
* **Whole-repo scan.** No secrets (grep for key/secret/password/token assignments). No absolute
  local paths in tracked files. No bundled fonts (system font stacks). Images: app icons in
  `app/public` (self-made SVG/PNG), synthetic swatches, and ArUco marker sheets generated by
  OpenCV (`lab/swatch/*.png|pdf`). These are generated artefacts with no third-party licence
  issue. Largest tracked files are the screenshots (≤ 0.87 MB each, ~25 MB total) and
  `lab/reports/swatch_analysis.html` (0.77 MB), which is acceptable. **There is no LICENSE for the
  code** (R20).

## 8. What I could not check, and why

* **GitHub Actions and the live Pages site.** I did not push and cannot trigger runs (read-only
  rule). CI behaviour is inferred from a clean-clone replay of the same steps. Exact-float
  `lab.json` reproducibility on a different CPU (R11) is untested.
* **DOIs resolving.** I did not fetch publisher pages (blocked). Verification is from search
  metadata only, the same limitation the review itself declares.
* **Real phones.** I used Playwright mobile emulation (390×844, touch). I did not test iOS Safari
  PWA install, wake lock, or swipe gestures on hardware.
* **Real swatch photos.** None exist. The swatch analyzer was exercised only by its own tests and
  report on synthetic images.
* **JIS L 0201 content.** I did not read the standard. Whether it covers crochet remains unknown.
* **Whether gutenberg.org / archive.org are blocked.** I did not try to fetch them (no network
  changes requested). I relied on the build's statement.
* **Profile drag precision and every designer motif visually.** I spot-checked one drag (the counts
  changed as expected) and a handful of designs. I did not review all 14 motifs × orders by eye.
