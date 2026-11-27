# Roadmap

Phase 1 (this repository as it stands) is described in the README. Each later phase below is
written so that a future prompt can say "do Phase N from docs/roadmap.md". Every phase keeps the
rules of Phase 1: the stitch graph is the single representation, `spec/` changes first, both sims
agree on fixtures in CI, data obeys `data/README.md` licensing.

## Phase 2 — Notation v0.2, full pattern editor, real corpus

**Scope**

1. *Notation v0.2* (driven by `data/corpus/NOTATION_FEEDBACK.md` and `app/src/core/notation/SPEC_NOTES.md`):
   working into earlier rounds (spike stitches, free loops left by a FLO/BLO round, overlay
   crochet); picots and individual chains of a ring as targets; stitches above dtr (trtr, quad
   treble) with heights generated structurally; beginning-cluster / beginning-V idioms;
   a closing slip stitch on spirals; a marker for how an ambiguous vintage "repeat N times" was
   resolved; revisit decision 15 (where `next st` starts after a join); colour changes and a
   second yarn (`yarn` attribute on nodes, multiple work orders); motif joins (join-as-you-go).
2. *Editor*: syntax highlighting and inline diagnostics in a real code editor component;
   chart ⇄ text two-way editing (click a symbol to select its notation item; insert/delete
   stitches on the chart and regenerate the text through the printer); autocomplete of round
   idioms; quick fixes for diagnostics ("change count to 18", "add `x6`"); undo history; diff view
   between versions; print/PDF export of pattern + chart + legend.
3. *Vintage corpus*: gather the 10+ public-domain patterns planned for Phase 1 (blocked there by
   network policy — see `data/README.md` section B for exact sources and the procedure), with
   verbatim source text and manifest rows.
4. *Chart*: JIS symbol set verified against the standard; layout quality pass for dense rounds and
   non-circular motifs (squares, hexagons, ovals); row-based chart layout beyond the simple grid.

**Dependencies**: Phase 1 parser/compiler/printer; network access to gutenberg.org / archive.org
for item 3.

**Open questions**: Can chart editing stay a pure function `edit(graph) → text` via the printer,
or does it need a concrete-syntax tree that preserves the author's phrasing? How should a graph
with two yarns define "work order" — one total order with yarn switches, or one order per yarn
plus synchronisation points? What is the right JIS reference (JIS L 0201 could not be confirmed to
cover crochet — see the literature review's unverified list)?

## Phase 3 — Calibrated physics

**Scope**

1. *Swatch campaign*: the user follows `lab/swatch/PROTOCOL.md` for 3–4 yarns × hooks; real-photo
   validation of `crolab.swatch.analyze` (currently validated on synthetic photos only); lens
   distortion handling; lace/mesh swatches.
2. *Fitted `stitch_params.json`*: width/height per stitch from swatches and flat-circle tests;
   stiffness from simple load tests (hang a weight, measure extension) — the fitting stub in
   `crolab/fitting.py`; uncertainty propagated into the flatness band ("flat within gauge error").
3. *Physics upgrades*: a true bending energy (discrete shells / hinge-based) on a triangulation
   where the fabric is solid; self-collision so strong ruffles stop interpenetrating; gravity and a
   table plane ("how it sits"); stuffing pressure for amigurumi; blocking with pins at user-chosen
   points; XPBD or projective dynamics in the app sim for stable real-time interaction.
4. *Curvature tools in the app*: per-stitch Gaussian curvature heat map; "fix it" suggestions
   (where to add or remove n stitches to make a round flat).
5. *ML stitch detection* trained on synthetic renders from the sim and chart renderer (the
   preferred data source), evaluated on the user's own photos.

**Dependencies**: real swatches (user time); Phase 1 lab sim, fitting scaffold, swatch tools.

**Open questions**: Is one (width, height, stiffness) triple per stitch type enough, or do
parameters depend on context (what the stitch is worked into, neighbours, tension drift over a
session)? How much does blocking change the rest lengths — is "blocked" a second parameter set
rather than a boundary condition? Does the network model's bias (waviness ∝ √mismatch, decision
14) survive a real bending energy, and can `tau_flat` then return to a physically meaningful value?

## Phase 4 — Amigurumi: 3D → pattern

**Scope**

1. Beyond surfaces of revolution: bent and branching shapes (limbs, heads with snouts) from a
   user-drawn skeleton + radii, or from an uploaded mesh; segmentation into crochetable pieces and
   join instructions; short rows for bends; increase/decrease placement that follows curvature
   rather than even spacing (cf. AmiGo, Edelstein et al. 2022; Igarashi et al. 2008 — see
   `docs/literature_review.md`).
2. Round-trip verification: every generated pattern is compiled and simulated, and the simulated
   surface is compared to the target (Hausdorff distance) before it is shown.
3. Stuffed-shape simulation (pressure + stretch) and gauge-aware sizing ("make it 12 cm tall in my
   yarn").
4. Assembly view: pieces, attachment rounds, safety-eye positions as graph annotations.

**Dependencies**: Phase 3 physics (pressure, collision) for trustworthy previews; Phase 2 notation
(short rows, multiple pieces).

**Open questions**: Which parameterisation generalises the Phase 1 "walk the profile by arc
length" rule to arbitrary genus-0 surfaces — geodesic distance fields from a seed (AmiGo) or a
skeleton-driven sweep? How to keep patterns *pleasant to follow* (regular repeats) while tracking
an irregular shape — what is the error budget crocheters accept?

## Phase 5 — Sizing, garments, sharing

**Scope**

1. *Sizing*: body measurements + ease + gauge → piece dimensions and stitch counts for simple
   garments worked flat or top-down (hats and rectangles exist in Phase 1's gauge calculator):
   raglan/yoke increases as curvature problems solved by the same flatness machinery; stitch
   pattern repeats as constraints; grading across sizes.
2. *Row-based fabrics*: drape rather than intrinsic curvature dominates, so this needs the Phase 3
   bending/gravity model and likely anisotropic stretch.
3. *Optional backend*: accounts, sync of the local library, sharing a pattern by link, community
   corpus with explicit licences, opt-in collection of swatch measurements to pool calibration
   data across users. Privacy-first: local remains the default; nothing leaves the device without
   an explicit action.
4. *Interoperability*: import/export of CrochetPARADE-style programs and common chart formats, so
   existing patterns and ML benchmarks can use these tools as a validation backend.

**Dependencies**: Phases 2–3; a hosting decision for item 3.

**Open questions**: What is the minimal garment model that is honest about fit? How should pooled
swatch data be normalised across crocheters with different tension? What licence and moderation
model makes a shared corpus safe with respect to pattern copyright?
