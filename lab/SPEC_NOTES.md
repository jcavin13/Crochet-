# Lab notes on the shared spec (physics.md v0.1, flatness.md, sim_config.json)

The lab simulator is the reference. Where `spec/physics.md` was ambiguous or, taken literally,
did not classify the canonical fixtures correctly, the lab made the decisions below. The
TypeScript sim must copy them so both sims build the same network. `crolab.network` has two
variants: `variant="spec"` is physics.md v0.1 to the letter (kept for comparison and tests), and
`variant="metric"` (the default, used for every result and `*.lab.json`) adds N1–N4.

## Clarifications (C), no change in substance

* **C1 — counts-as tops.** A turning-chain top with `countsAs: X` uses `h_X`, and `s_X`, for its
  wale, shear and wale-bend springs. Its course width is covered by N2.
* **C2 — magic-ring rest length.** `L = max(h_j, m*wbar/(2*pi))`. `wbar` is the mean width of the
  stitches the m ring nodes *count as* (`w_X` for a counts-as top). This is exactly flatness.md's
  `rho_1 = max(hbar_1, C_1/(2*pi))`.
* **C3 — "node anchor particle"** (shear) means an anchor particle that is a real node. That
  includes the chain a chain-space anchor resolves to. Virtual ring particles get no shear springs.
* **C4 — duplicates.** For a duplicate pair the largest k wins. On a tie, the first spring
  generated wins. Generation order: course (i ascending), wale, shear, bend_course, bend_wale
  (each by node ascending, then leg order, then a−1 before a+1).
* **C5 — particle order.** Node particles come first (index = node id), then one virtual
  particle per magic ring in increasing space id.
* **C6 — growth placement** (physics.md §4.1 made exact; `crolab/sim.py` docstring):
  * P0. A new ring particle goes at the centroid of the particles placed so far.
  * P1. Chain-ring chains go on a circle of circumference `N*w_ch` in the xy-plane.
  * P2. A node whose only anchor is a magic ring goes on the circle of radius `L_wale`, at angle
    `2*pi*(j-1)/m`.
  * P3. Any other anchored node goes at the mean of its anchors plus `L_wale*u`. `u` is the summed
    wale continuation `x_a - x_firstanchor(a)`. Fallbacks, in order: the radial direction from the
    centroid with its component along the anchor's course tangent removed; then `z x tangent`;
    then +x.
  * P4. An unanchored node continues from `x_{i-1}` along `x_{i-1} - x_{i-2}`.
  * **P4′ (new).** The chains of a chain space are re-placed on the circular arc of their rest
    length between the nodes either side of the loop. The arc lies in the plane of the chord and
    the outward direction. Outward is radial from the centroid of the piece before this round,
    with its component along the chord removed. If the chord is degenerate, `z x chord` is used.
  * P5. Runs of m ≥ 2 consecutive P3 nodes with identical anchors are spread along the anchor's
    course tangent by `(k-(m+1)/2)*wbar/2`.
  * **P7 (new).** Spines (N5) are placed after P5, before P4′: every node of a spine of this round
    goes to `x_base + s*u + t*v` from its reference layout (s, t), with
    `u = unit(x_base − centroid of the piece before this round)` (fallback +x) and
    `v = unit(z × u)` (fallback `unit(u × x)`). So a snowflake arm starts straight and radial, its
    return stitches on its chains and its picots as side stubs, instead of continuing the yarn's
    last direction (P4) or wherever P3 put the return stitches. Implemented in `crolab.sim` and
    `app/src/core/sim/solve.ts`; `spec/fixtures/extra/snowflake_fern.network.json` stores one
    placement (`placement`) that the app test reproduces within 1e-6.
  * P6. Perturbation `delta_i = perturb_eps * wbar_r * sin(2.399963*(i+1))` along +z, where
    `wbar_r` is the mean course width of round r.
  * Each round is relaxed with L-BFGS (gtol 1e-6) over all particles placed so far. A final
    L-BFGS run with gtol 1e-8 follows. The per-round metrics in `lab.json` are the round
    snapshots.

## Changes to the network (N), with reasons

The springs in physics.md §3 assume every stitch stands straight above its anchor in a
rectangular cell. That cannot hold in a disc, where an increase puts two stitches on one anchor
and every round is longer than the one below. Taken literally, the spec's shear and bend rest
lengths conflict with the flat state. Because the network has almost no stiffness against
isometric bending, that in-plane residual stress buckles the disc:

| fixture | spec variant | lab (metric) variant |
|---|---|---|
| flat_sc_circle | **cup**, A 0.55, W 0.49 | flat, A 0.003, W 0.07 |
| flat_dc_circle | **cup**, A 0.75, W 0.27 | flat, A 0.18, W 0.14 |
| simple_doily / chain_space_motif | **ruffle** (W 0.39 / 0.55) | flat |

**N1 — rest lengths of wale, shear, course and bend springs from the fabric's intrinsic
reference geometry ("prescribed metric").**

* *Courses.* Each node lies on one course. The chains of a chain ring form their own closed
  course. Every other node lies on its round's course, which is closed iff the round has
  `kind = "round"`. Node j contributes `c_j` to the course:
  * `w_X` for stitch-counting nodes;
  * `f_r*w_ch` for the chains of a chain space of its own round, where
    `f_r = clamp((2*pi*rho_r - sum of stitch widths)/(sum of chain widths), chain_slack_min, 1)`
    and `rho_r` comes from flatness.md (chains take up the length the round needs, within their
    compliance band);
  * `w_ch` for ring chains;
  * 0 for everything else (turning chains, slip stitches, picots).

  Each node also gets a course coordinate `u_j` in [0, 1): the centre of its contribution
  divided by the course length `C = sum of c`.
  `Cnode_j = C`, except for the chains of a round with arc rise (flatness.md):
  `Cnode_j = C + 2*pi*rise_r`.
* *Alignment.* Take each pair of courses (course of node i, course of its anchor). Set
  `sigma = -1` if the sum of `sign(a' - a)` over consecutive first anchors is negative, else +1.
  Then `v_i = u_i`, or `1 - u_i` when `sigma = -1`. Set `D = wrap(v_i - u_a)` (no wrap for open
  courses, in mm) and `Dbar = mean D over the pair's wale pairs`. The offset of i relative to any
  particle p of the lower course is `x = wrap(v_i - u_p - Dbar)`. Only *stitch-counting* nodes i
  get reference cells. Slip stitches and turning-chain chains keep the spec rules.
* *Cell.* With `Ct = Cnode_i`, `Cb = Cnode_p`, `dC = |Ct - Cb|` and height h:
  * if `dC ≈ 0`: `d = sqrt(h^2 + (x*C)^2)`;
  * otherwise: `rho_b = h*Cb/dC`, `rho_t = h*Ct/dC`, `alpha = dC/h`, and
    `d^2 = h^2 + 4*rho_t*rho_b*sin^2(alpha*x/2)`. This is the flat annular sector whose two arcs
    have the two course lengths, h apart.
  * Open courses use `d = sqrt(h^2 + x^2)` with x in mm.
* *Which springs use it.* The wale rest length is `cell(i, a, h_i)`. The shear rest length to
  `nb = a±1` is `cell(i, nb, h_i)`, provided nb is on a's course. Otherwise the spec formula
  applies. The magic-ring wale keeps C2. Every lean the stitches have (increase pairs, decreases,
  the spiral's steady drift) follows from u, so no special cases are needed.
* *Wale bend* (i → a → b): `sqrt((h_i + h_a)^2 + ((x_ia + x_ab)*sqrt(Cnode_i*Cnode_b))^2)`.
  Meridians are straight in the developed fabric. Open courses use mm.
* *Course and course bend.* When all nodes are on one closed solid (non-lace) course, the rest
  length is the chord of the arc (`Lc`, or `Lc1 + Lc2` for a bend) on a circle of radius
  `rho_g = C_r/(dC/drho)`. Here `dC/drho = (C_{r+1} - C_{r-1})/(hbar_{r+1} + hbar_r)` (central
  difference over rounds worked in the round, one-sided at the ends). For a round worked into a
  magic ring, and for a chain ring, `rho_g = C/(2*pi)`. If `|dC/drho| < 1e-9`, the spring is
  straight. This is what gives the bend springs real bending stiffness against cupping. A cone's
  rounds are 3D circles of radius `C/2*pi`, which is shorter than their geodesic radius, so the
  cone compresses the bend springs. The spec's straight rest length instead made every small
  round push outward.
* *Spiral jog.* A course spring or course bend from the last stitch of one round to a stitch of
  the next round has rest length `cell(next, last, h_next)`, applied when both nodes are
  stitch-counting and the second round is worked into the first.
* With N1 the flat sc circle's course+wale network is exactly realisable in the plane: its 2D
  energy is 1e-15.

**N2 — counts-as tops occupy the course like X.** The course width of a `countsAs: X` top is
`w_X`, not `w_ch`. This matches flatness.md as updated. With `w_ch`, every joined dc round was
1.3 mm short (−1.7 % in round 1) and the dc circle cupped.

**N3 — turning chains and slip stitches are not fabric columns.** Turning-chain chains other
than a counts-as top take part in no course-bend spring and are never a shear neighbour. Nodes
that are not stitch-counting (slip stitches) get no shear springs. The spec's rectangle rest
lengths for these columns were frustrated by up to ±30 %.

**N4 — chain-space chains are slack yarn.**
* Course and course-bend springs that touch a chain of a `chsp` are **tension-only**: the
  energy uses `max(0, |d| - L)`. `Network.slack` flags them.
* No shear springs go to a chain-space chain. A node anchored into a chain space has no shear
  springs on that anchor.
* Without N4, compressed loops buckled the whole motif.

**N5 — spines: chains with stitches worked back along them are doubled cords.** (Only constructs
that no canonical fixture contains are affected: every fixture network is unchanged, checked by
`export_network --check` and the app's parity test, which also asserts that no fixture has a spine.)
A snowflake arm, `ch 16, sl st in 4th ch from hook, sl st in next 3 ch, picot, picot, …`, was
modelled as a run of chains (course springs 1.68 mm, k 0.35) with a row of slip stitches lying on
it whose own course springs had the slip-stitch rest length (1.2 mm, k 1.0): the stiffer return row
was 29 % shorter than the chains it is worked into, tied to them by 0.48 mm wales, so the only way
to satisfy both was to curl — a radius of about 1.2 mm. Simple-star spines came out folded to 4 %
of their length; that, plus P4 sending the chains off along the course, was the "tangled blob" of
the user report (2026-11-27).

* *Definitions* (`crolab/spine.py`, `app/src/core/sim/spine.ts`, identical): a *free chain* is a
  `ch` that is not a turning chain, not a counts-as top and not a chain of any space. A *return
  stitch* of chain c is a later node of the same round with a `{node: c}` leg. A *spine* is a
  maximal run of consecutive free chains of one round with at least one return stitch; its *stem*
  runs to the last chain with a return stitch, the chains after it (skipped at the hook end) are
  the *tip loop*, its *picots* are the picots among / straight after the return stitches, its
  *base* is the node before the first chain.
* *Reference layout* (s outward along the stem from the base, t sideways): stem chains on the s
  axis at the cumulative course rest lengths; the tip loop and its closing return stitch on a circle
  of the loop's circumference through the last stem chain, on the outer side; return stitches at
  (s of their chain, h_i) — on their chain, at the wale height, which is 0.48 mm for a slip stitch
  (the return row lies on the chains; an sc row is a real 2.3 mm strip); the k-th picot of a run at
  ±50° (alternating, + first) from +s, ±60° straight after the tip (trefoil), reach n_p·w_ch/2 —
  the angles `blockedShape()` assumes.
* *Springs*: every spring between two nodes of one spine takes its rest length from the layout
  (course, wale, shear, bends: so the cord is unstrained when straight), and course-bend springs
  whose three nodes are all stem chains or all return stitches get stiffness `k_course·min(s)`
  instead of `k_bend` (a doubled cord resists bending). No spring is added or removed; slack flags
  are unchanged (spine chains are not chain-space chains).
* Result (fast tolerances, free relaxation): stem end-to-end distance / rest length, worst spine
  per preset, before → after: simple star 0.04 → 1.00, fern 0.92 → 1.00, trefoil 0.93 → 0.92,
  double-pointed 0.46 → 0.99, tiny 0.87 → 1.00, bold star 0.76 → 0.92.

**N6 — pointed loops are starched open loops.** (Like N5, only constructs no canonical fixture or
corpus pattern contains: the app's parity test asserts no fixture has one, the corpus test that no
corpus pattern has one; `spec/fixtures/extra/snowflake_lacy` pins the rule, lab vs app.)
The "Lacy hexagon" arm, `(sc, ch 10, ch-4 picot, ch 10, sc) in next sp`, is not a spine (nothing is
worked back along it): its chains are two chain spaces, tension-only (N4), so before blocking the
loop lay anywhere and folded sideways.
* *Definition* (`find_pointed_loops` / `findPointedLoops`, identical; the chart's "pointed loop"):
  a chain space of ≥ 4 chains (`POINTED_LOOP_MIN`), straight away one or more picots, straight away
  a second chain space of ≥ 4 chains of the same round; nothing is worked into either space or any
  of their chains (no member, no `{node}` leg, no turning chain); `base` = the node before the first
  run, `close` = the node after the second, both in the round and not chains.
* *Layout* (s outward from `base`, t towards `close`): feet `base` (0, 0) and `close` (0, d),
  d = (w_base + w_close)/2; the path base → chains → picots → chains → close (course rest lengths,
  total S) folded into the isosceles triangle with legs S/2: a node at path length l ≤ S/2 lies at
  (l/(S/2))·(H, d/2), beyond it at ((S−l)/(S/2))·(H, −d/2) + (0, d), H = √((S/2)² − (d/2)²).
* *Springs*: every spring between two nodes of one loop's set {base, chains, picots, close} takes
  its rest length from the layout and is two-sided (not tension-only); course bends among them get
  k_course·min(s). No spring is added or removed.

**N7 — the seam slip stitch of an arm's space.** A chain space that carries an arm (a member is the
base of a spine, N5, or of a pointed loop, N6 — `arm_bases`) and whose first member is a slip stitch
with only slip stitches before it in its round (`sl st in next ch-2 sp, ch 1, (sc, <arm>, sc) in same
sp`): the slip stitch takes no share of the chains — the other members are distributed by the usual
rule as if it were not there — and it attaches to the chain of the first of them. Before, the first
arm of every snowflake sat off-centre in its loop (its sc on chains 5 and 7 of a ch-8 loop, the
others' on 3 and 6) and blocked differently from the other arms. In real crochet the stitches worked
into a space slide along it, so the arm sits where it sits in every repeat; the yarn from the slip
stitch to the first sc (the `ch 1`) is then stretched in the model — the blocking report leaves a
round's travel stitches (leading slip stitches, turning chains: not fabric, N3) out of its stretch
figures. Restricted to arm spaces so that no fixture network changes (simple_doily and
chain_space_motif start rounds the same way); the owner may extend it to all seams.

* **P8 (new, after P7, before P4′).** Every pointed loop of the round whose `base` and `close` are
  placed is laid out like a spine: x = x_base + s·u + σ·t·v with u, v as in P7 and σ = −1 when
  (x_close − x_base)·v < 0, else +1. P4′ skips the loop's two chain spaces.
  `spec/fixtures/extra/snowflake_lacy.network.json` stores one placement the app test reproduces.

## Viewer-only options (app; not part of the shared model)

* **Resting on a table** (`createSim({table: true})`, `app/src/core/sim/table.ts`): grow the piece
  strictly in the xy-plane (z = 0, P3's radial fallback from the centroid before the round), then
  let it go on a table under a weak weight (0.002 per particle) with a one-sided penalty. The free
  3D solve of a snowflake still crumples its *body* (fern Rnd 1–3: "ruffle" A 0.31 / W 0.47, while
  the count rule and the same body grown flat say flat — review R1); on the table every preset lies
  flat with its arms radial. Cups and ruffles still lift off the table but less than in the free
  solve (hyperbolic fixture: z range 13 mm vs 53 mm), so this is a view for pieces meant to lie flat
  and is never used by `simulate()` defaults, the shape metric or the lab agreement.
* **Blocking with explicit pins** (`createSim({pins})`, `block(..., pins)`, `crolab.blocking.block(res,
  pins=...)`): pins `{node, x, y}` in any rigid frame are aligned to the piece (handedness from the
  winding of the pins in node order, then best rotation + translation — never scaled); the plane is
  the PCA plane; pinned nodes fixed, everything else relaxes in-plane; reported in addition: the
  largest stretch of course and wale springs per part (spines and pointed loops / slack chain loops
  / body). Springs touching a round's travel stitches (its leading slip stitches and turning chains)
  are left out, and a spring shorter than a chain counts its stretch relative to a chain width
  (a slip stitch's 0.48 mm wale pulled 0.08 mm is not "17 %" of visible thread). The app solves it
  with pin continuation (the pins move from where their nodes lie to the template in 4 stages,
  warm-started; snapping them in one go let branch picots flip through the spine); the solve method
  is free (physics.md §4), the lab uses one L-BFGS run.

## Shape metric and config

* **`sim_config.tau_flat`: 0.10 → 0.25.** The network has no bending stiffness against isometric
  modes, so its out-of-plane response to a metric error e grows like sqrt(|e|). Sweeping the sc
  width of the flat sc circle by e gave:

  | e | −10 % | −5 % | −2 % | 0 | +2 % | +5 % | +10 % |
  |---|---|---|---|---|---|---|---|
  | A | 0.54 | 0.36 | 0.20 | 0.00 | 0.03 | 0.05 | 0.06 |
  | W | 0.01 | 0.01 | 0.00 | 0.07 | 0.17 | 0.24 | 0.33 |

  The canonical flat fixtures carry analytic excesses of +0.3–0.5 %. They come out at
  max(A, W) up to 0.18. The nearest non-flat fixture is at 0.60 (hyperbolic W), and the cone and
  sphere are at A ≥ 1.5. With 0.25 the sim's flat band corresponds to |e| of about 2–4 %, still
  tighter than the analytic `tol` of 10 %. Nothing else in `sim_config.json` changed.
* The classifier itself (physics.md §5) is unchanged. It uses all real particles, chains included.
  The axis choice also worked on the sphere: `|a| > axis_min*Rg` selects the round-centroid axis.
* PCA axis sign (only matters for reproducibility): flip the eigenvector so that its
  largest-magnitude component is positive.

## Flatness (analytic)

`crolab/flatness.py` mirrors `app/src/core/flatness/index.ts` exactly:
* Counts-as tops contribute `w_X` and `h_X`.
* Only `chsp` chains are course chains.
* `r_0` comes from the first ring space.
* Rounds with neither stitch-counting nodes nor space chains are n/a.
* `g` is NaN for round 1.
* `stitches_off` is 0 for flat rounds. Note that the `expected.json` files list small nonzero
  values for flat rounds; the tests compare `stitches_off` only for cup and ruffle rounds.

Analytic per-round bands for the lace fixtures (all flat):

* `simple_doily`, e_min/e_max: −0.01/−0.01, −0.31/−0.03, −0.12/+0.08, −0.38/+0.28, −0.36/−0.00,
  −0.37/+0.07.
* `chain_space_motif`, e_min/e_max: 0/0, −0.07/+0.78, −0.37/+0.38, −0.27/+0.50.

## Notation / compiled-graph observation

In `simple_doily` Rnd 4, `sl st in next dc` right after the Rnd 3 join is compiled to node 64.
That is the counts-as-dc top, the same stitch the join went into, so two slip stitches sit in one
stitch. A crocheter would read "next dc" as the dc after it (node 65).

The lab builder follows the compiler, so builder and compiled graphs are identical. The two slip
stitches into one stitch, with a 1.2 mm course spring between them, are a small local frustration
in the sim: about half the doily's residual energy. The doily still classifies flat.
