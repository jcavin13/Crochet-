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
