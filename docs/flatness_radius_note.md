# Where does a round hand on its radius? (snowflake template vs. the flatness rule)

*2026-11-27 — evidence and a proposal for the owner. Nothing in `core/flatness`, `crolab/flatness.py`,
the golden files or the doily designer was changed; the snowflake template no longer uses this rule
for its arm-base radius.*

## The rule

spec/flatness.md hands round k on at `r_k = ρ_k + rise_k`, `rise_k = ½·√(L² − d²)`: each chain loop
of the round, of chain length L over the arc gap d = (2πρ_k − Σ stitch widths)/(number of spaces),
stands out like a V pulled at its middle by one stitch. The next round's stitches stand at
`ρ_{k+1} = r_k + h̄`. Two things in it are only right in one case:

1. **The apex is a V with one stitch at its middle.** When several stitches share a loop
   (`(2 dc, ch 2, 2 dc, ch 2, sc) in each ch-7 sp`, five stitches), they spread along it and most of
   them sit low; a loop pulled out at m points takes a polygon whose mean height is well below the V
   apex (m = 5 on a ch-7 loop: 2.1 mm instead of 3.1 mm).
2. **The loop spans the arc gap, not the chord.** Its feet are two stitch tops at ρ_k; the straight
   line between them lies at ρ_k·cos(Δφ/2) (6 loops: 13 % inside ρ_k), and the chord is longer than
   the arc gap minus the stitch widths in some layouts and shorter in others.

For a doily (many loops, worked into by the next round all round) the two errors partly cancel and
the ±10 % flatness tolerance hides the rest. For a snowflake they set where the arms start, and
everything on the blocking template is measured from there.

## Measurements (before)

Thread 10, every preset; "taut R*" = largest radius the arm round's first sc can be pulled out to
(radially, at the template angles) before any body or chain spring passes 5 % stretch (bisection on
the blocked spring model, arms unpinned); stretch = largest thread stretch when pinned to the old
template (arms / chain loops / body).

| preset | template R0 (= r_last + h_sc) | relaxed on table | taut R* | stretch pinned to template |
|---|---|---|---|---|
| simple star | 13.2 | 12.5 (−6 %) | 13.7 (+4 %) | 10 / 9 / 5 % |
| fern | 18.0 | 16.9 (−6 %) | 19.4 (+8 %) | 5 / 1 / 1 % |
| trefoil | 14.9 | 13.6 (−8 %) | 15.0 (+1 %) | 8 / 7 / 4 % |
| lacy hexagon | 16.6 | 17.2 (+4 %) | 19.0 (+14 %) | 0 / 7 / 10 % |
| double-pointed | 22.3 | 19.3 (−14 %) | 21.0 (−6 %) | 14 / 26 / 16 % |
| tiny | 10.0 | 8.7 (−13 %) | 9.9 (−1 %) | 6 / 15 / 10 % |
| bold 8-point | 23.5 | 23.5 (±0 %) | 24.5 (+4 %) | 13 / 11 / 18 % |

Per round (mm): flatness ρ vs. the sim's stitch tops at R*:

| preset | flatness ρ per round | sim at R* |
|---|---|---|
| double-pointed | 7.8 / 11.8 / 19.0 | 7.7 / 10.9 / 16.6 (−14 % in Rnd 3: 5 sts per ch-7) |
| fern | 6.4 / 10.0 / 14.7 | 6.4 / 9.4 / 14.3 |
| s1 × 5 random | 7.5 / 14.4 / 18.0 | 7.3 / 11.9 / 15.2 (−17 %: 4 dc per ch-5) |

So the hypothesis was right for loop-heavy bodies (double-pointed and random designs with several
stitches per loop sit 6–17 % inside), but it was not the only problem and not the biggest one.
The "relaxed is 10–19 % inside" figure of the earlier report compares the template with the
*unblocked* piece, whose loops hang slack; the blocked body can reach further.

## What actually stretched the thread (all fixed now)

| cause | where | fix |
|---|---|---|
| tip pinned at the middle chain of the tip loop, template reach `P·w_ch/2` (picot) or `h_dc` (bobble) | 10–13 % in tip loops | the template places every pin from the arm's own reference layout (spine.ts, N5/N6): the tip is the tip-loop chain that reaches furthest (`armPinNodes`, shared by template and pins) |
| pointed-loop reach `L·w_ch` + `P·w_ch/2` | lacy: bases pulled 14 % out | N6 layout gives the apex |
| round start: the seam slip stitch took a share of the arm's loop | first arm off-centre (sc on chains 5 + 7 of 8 vs 3 + 6) | SPEC_NOTES N7 |
| pin snapping: branch picots pulled through the spine | seed 6 × 6: one arm 4 mm out | pin continuation (4 stages, warm-started) |
| **stiff arms pinned at block stretch** | 15–25 % in the loops under the arms | below |
| valley pins exactly taut, valley sc pinned as well | 15–25 % in the last body round | bridges pinned with 15 % thread to spare; a valley sc is marked, not pinned |

The fifth row is the principle the old template missed: an arm is a doubled cord (chains + return
row, k ≈ 1.35 vs a chain's 0.35). The template stretched *everything* by block_stretch (5 %), so a
pinned arm pulled on the body with four times the force that stretches a chain by 5 % — the chain
loops under it went to 20 %. A piece is pinned to one tension, set by its weakest thread.

## The rule the template uses now

`core/generate/snowflake/bodypull.ts` + `geometry.ts`:

* **Blocking tension** T = k_course · s_ch · (block_stretch − 1): the force that stretches a chain by
  5 %. Every part is drawn at its own stretch under T: chain loops and bridges 5 %, an arm's cord
  T/(k·(s_ch + s_back)) ≈ 1.3 %.
* **Body**: the spring network's own equilibrium. The pattern with a picot standing in for each arm
  is grown flat (table mode, loose tolerance, 5–50 ms), every arm pulls its two sc out with T (a
  valley sc with T), and where a loop would pass 5 % (several arms pulling through one loop) the pull
  is eased in proportion. The arm-base radius R0 and the angle of every arm come out of that.
* **Arms**: their reference layout × the cord stretch, radially from the first sc. **Bridges**: the V
  apex over the straight gap between their two sc, with 15 % of the thread to spare.

Closed forms tried first, all on the same 7 presets + 80 random designs (pass = pinned stretch ≤ 12 %
and arm bases within 6 % of the template):

| body model | pass |
|---|---|
| flatness `ρ + rise` (old template, other fixes in) | 25 / 87 |
| taut construction: chords, funicular polygon per loop (equal turning angles at the stitches worked into it) | 35 / 87 |
| … the two sc of an arm held within the arm's foot / within one sc width / at one point | 38 / 42 / 29 |
| … plus each round's course length as a limit | 24 / 87 |
| spring-model pull at the arm cord's force (5 % arm) | 13 / 87 |
| spring-model pull at the blocking tension, arms at their cord stretch | 44 / 87 |
| … bridges pinned with slack, valley sc not pinned | 71 / 87 |
| … pull eased to the weakest loop (adopted) | 73 / 87 |

## After

| preset | template R0 | blocked sim, arm bases | pinned stretch (arms / chains / body) |
|---|---|---|---|
| simple star | 13.5 | 13.2 (−2.1 %) | 3 / 4 / 3 % |
| fern | 19.7 | 19.3 (−2.1 %) | 9 / 10 / 6 % |
| trefoil | 14.3 | 14.5 (+1.5 %) | 1 / 2 / 1 % |
| lacy hexagon | 17.3 | 17.8 (+3.3 %) | 0 / 0 / 0 % |
| double-pointed* | 18.0 | 18.3 (+1.7 %) | 7 / 7 / 5 % |
| tiny | 9.6 | 9.4 (−2.0 %) | 7 / 11 / 7 % |
| bold 8-point | 22.2 | 22.4 (+0.9 %) | 1 / 0 / 1 % |

\* the double-pointed preset's body is now `ring of dc` + major/minor corners (was spoked + loop
hexagon + major/minor, 14–23 % stretch with any template tried).

80 random designs (20 each of 5, 6, 8, 12 points, `npx vitest run src/core/sim/snowflake.test.ts`):
**67 / 80 fit (84 %)**; every one of the 80 has its arm bases within 4 % of the template; the 13
misfits stretch 14–21 % in loops under the arms, 7 of them 5-pointed. The target was 95 %; the
designer folds the 3D verdict into the check, so a misfit shows "needs a look", never a green check
over a red badge.

## Proposal for the general rule (owner's decision)

For `core/flatness` (and its lab mirror, golden files, the doily solver):

1. Measure the gap on the **chord**: d = 2ρ_k·sin(π/nSp) − w̄_feet instead of the arc gap.
2. Make the rise depend on **m**, the number of next-round stitches in the loop (known to the solver
   from the next round's ops, and from the graph to the analyser): m = 1 keeps the V; m ≥ 2 uses the
   mean vertex height of the equal-turning polygon through the m attachment chains (closed form via
   one bisection, as in the snowflake construction that was tried); m = 0 (skipped loop) hands on ρ.
3. Hand on **per loop** (`r_k` as a mean over loops weighted by m), not the single mean-loop value.

On double-pointed this moves Rnd 3 from 19.0 to about 17.9 mm (sim at the taut limit: 16.6). It
changes the flatness of every chain-space round, so `simple_doily.flatness.json` and
`chain_space_motif.flatness.json` (and the designer's flat-rate statistics) would have to be
re-pinned; the spring model's N1 chain fraction uses ρ_k and r_k − ρ_k and would follow. Not done.
