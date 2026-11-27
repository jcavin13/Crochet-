# core/assist — flatness assistant

Proposes small edits **to the notation** that make a round lie flat, ranks them and can apply
them; plus the inverse "what should this round be" calculator. Pure TS; the editor UI calls it.

## API

* `suggestRoundFixes(text, round, params, { max? })` → `FixSuggestion[]` for one round (graph
  index), best first. Empty when the round already lies flat.
* `suggestFixes(text, params)` → `RoundFixes[]` for every round that cups, ruffles or is flat only
  with loose loops (`needsFix`).
* `fixAll(text, params)` → `{ text, steps, remaining }`: best fix round by round from the centre
  outward, re-analysing after each (every fix moves the later rounds' radii).
* `applyFix(text, suggestion)` → the suggestion's text (throws if `text` changed meanwhile).
* `suggestCounts({ stitch, order, params, rPrev | rho })`, `suggestCountsForRound(graph, round, params)`
  → `CountSuggestion`: course length 2πρ, "≈ 96 dc-widths", a solid option per repeat and lace
  options (k stitches + ch c per repeat) with their nominal excess.
* `updateCountAnnotations(text)` → rewrites `(N …)` count numbers to what the rounds make.

A `FixSuggestion` has `label` ("Rnd 5: skip 3 instead of 1 (and Rnd 6: ×24 → ×12) → lies flat
(+0%)"), the full new `text`, a `diff` (`from`/`to`/`insert` on the old text plus the affected
lines before/after for a preview), the target round's new flatness `result`, `adjusted` later
rounds, `attention` (later rounds that still need work), `compiles`, `order` and `score`.

## Moves (each applied to every matching item of the round, so all repeats change together)

| move | example |
|---|---|
| chain length (incl. `ch 5 (counts as dc, ch 2)`) — `ch-N sp` references in the count and the next round follow | `ch 5` → `ch 3` |
| leave out a ch 1 / ch 2 | `…, ch 1,` → `…` |
| stitches worked into one place (also inside `(…) in sp` groups, beginning repeats via deltas) | `3 dc in next sp` → `2 dc` |
| shell size | `shell` → `3-dc shell` |
| one more / one fewer increase per repeat | `sc in next 2 sts` → `sc in next st, 2 sc in next st` |
| skip length, with the repeat count re-balanced so the round still goes round | `sk 1 st … x23` → `sk 3 sts … x11` |
| skip + shell size together | |
| rewrite a solid round (one plain stitch in every stitch below) with n·m evenly spread increases, n a multiple of the piece's order, keeping a counting turning chain and loop modifiers | `sc blo in each st around` → `*sc blo in next 5 sts, 2 sc blo in next st* x6` |

Edits inside a range label (`Rnds 8-12`) split the label so only that round changes.

## Checks (every candidate)

1. Recompiles (counts ignored) with **no errors at or before the round**. A later round that no
   longer fits is re-balanced automatically when its main repeat can be (`Rnd 6: ×24 → ×12`, by
   the change below it or so it uses every stitch now there) **and** the new count keeps the
   symmetry order; otherwise the suggestion carries `attention` and is ranked after clean ones
   (errors: far after; leftover-stitch warnings: a little after).
2. Count annotations rewritten (`updateCountAnnotations`); the final text is compiled again.
3. No round's cumulative symmetry order may drop (`core/symmetry`).
4. The round must improve; ranked by: truly flat < flat only with loose loops < still off, then
   |e| at nominal loop length, then edit size, then knock-on adjustments.

## Limits

* The flatness model is the analytic count rule (`spec/flatness.md`); its blind spots (scallops'
  mean height) are inherited.
* **Cornered rounds** (shape `polygon` — squares, hexagons… from the centre — or `border` — rounds
  round rows): only stitches-per-place edits are tried, and a candidate is kept only if the round
  still has as many corner groups and exactly the same side stitches (only the corner groups
  changed). `cornerAdvice(round)` / `RoundFixes.advice` says what the corner rule implies ("Cornered
  round: adjust the corner group — use (2 dc, ch 2, 2 dc) in each corner instead of (2 dc, ch 2,
  dc)."); the circle calculator (`suggestCountsForRound`) returns null for these rounds. A lace round can be "fixed" toward a shorter
  chain than a designer would choose, because the rule treats chain slack generously.
* Moves are local to one round (plus repeat re-balancing and `ch-N sp` renames downstream). No
  stitch-height changes, no inserted chains between groups, no restructured repeats.
* Picot rims and other non-solid rounds without spare plain runs have few moves.
* Fix-all can leave a later round only "within tolerance" (±10 %). It never accepts a step that
  leaves an error; it does accept one that leaves a later round with unworked stitches (a
  warning) and re-balances that round as soon as the counts allow a symmetric repeat — whatever
  is left is listed in `warnings`.
