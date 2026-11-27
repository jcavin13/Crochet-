# Physical model shared by both simulators, v0.1

> **Amended by `lab/SPEC_NOTES.md` (normative).** Section 3 below gives the spring *topology*.
> Taken literally, its rectangular-cell rest lengths are frustrated in a disc and buckle flat
> pieces, so the reference implementation (`lab/src/crolab/network.py`, `variant="metric"`)
> derives rest lengths from the fabric's intrinsic geometry (N1), treats counts-as tops as full
> stitches (N2), excludes turning chains and slip stitches from shear/bend (N3) and makes
> chain-space chains tension-only (N4), and lays out spines — chains with stitches worked back along
> them, e.g. snowflake arms — as straight doubled cords (N5, growth placement P7), lays out pointed
> chain loops (`ch ≥ 4, picot, ch ≥ 4`, nothing worked into them) as starched open loops (N6, P8)
> and lets the seam slip stitch of an arm's space take no share of its chains (N7). Placement rules
> P0–P8 are made exact there. Rows, the border rounds worked round them and polygons worked from
> the centre take their rest lengths from a planar reference layout (N8–N10, placement P9), and
> are reported per region (body / sides / corners) besides the §5 metric (pieces with rows use the
> PCA axis).
> Both sims implement the amended model; `tau_flat` is 0.25.

Two simulators exist: the research one in `lab/` (Python, reference) and the real-time one in
`app/src/core/sim` (TypeScript). They may use different solvers, but they **must build the same
spring network from the same graph and parameters, and classify shapes with the same metric**.
Everything numeric in this document is in `sim_config.json`; both sims read that file.

## 1. Particles

* One particle per graph node, located at the **top** of the stitch (the loops later stitches are
  worked into). For a chain: the chain itself.
* One *virtual* particle per magic ring (a `ring` space with no chains), at the ring centre.

## 2. Parameters

From `stitch_params.json`, set chosen by `meta.params` or `default_set`: for each stitch type
`width` w, `height` h, `stiffness` s. A turning-chain top with `countsAs: X` uses the *height* of
X for its wale spring but its own (chain) width for course springs.

## 3. Springs

Energy of a spring between particles a, b with rest length L and stiffness k:
`E = ½ · (k / L) · (|x_a − x_b| − L)²` (so k is an "EA"-type stiffness; long springs are softer).

| Kind | Between | Rest length L | k |
|---|---|---|---|
| **course** | consecutive nodes i−1, i (yarn order) | (w_{i−1} + w_i)/2 | `k_course` · min(s_{i−1}, s_i) |
| **wale** | node i and the particle of each anchor leg (see below) | h_i (magic ring: see below) | `k_wale` · s_i |
| **shear** | node i and the yarn-neighbours a−1, a+1 of each *node* anchor particle a, when that neighbour exists, is in the same round as a, and is not i | sqrt(h_i² + L_course(a, a±1)²) | `k_shear` · s_i |
| **bend (course)** | nodes i−2, i | L_course(i−2,i−1) + L_course(i−1,i) | `k_bend` |
| **bend (wale)** | node i and the first anchor particle of its first anchor particle (when both are node particles) | h_i + h_anchor | `k_bend` |

Duplicate pairs keep the stiffest spring. Repeated legs into the same anchor (clusters) give one spring.

**Anchor → particle.**

* `{node: a}` → particle a.
* `{space: s}`, chain space with chains c_1..c_n: let the distinct nodes anchored in s, in working
  order, be j = 1..m. Node j attaches to chain `c_q`, q = clamp(floor(j·(n+1)/(m+1) + 0.5), 1, n).
* `{space: s}`, ring with n ≥ 1 chains: node j of m attaches to chain `c_q`, q = floor((j−1)·n/m) + 1.
* `{space: s}`, magic ring: the virtual particle, with rest length
  L = max(h_j, m·w̄/(2π)), w̄ = mean width of the m nodes worked into the ring (so their tops sit
  on a circle they fit around).

No gravity, no self-collision, no friction in v0.1 (known limitation: strong ruffles interpenetrate).

## 4. Solving

Any method that finds a local minimum of the total energy is acceptable. Both sims use
**round-by-round growth**, which mirrors how the piece is made, gives the shape at every round
for free, and avoids the crumpled local minima a flat start falls into:

1. Add the particles of round r. Initial position of node i: mean of its anchor particles plus
   h_i along the local outward direction (continuation of the wale: anchor minus the anchor's
   anchor; fallback: radial from the centroid of the piece so far; first round: on a circle in
   the xy-plane). Nodes without anchors (chains, picots) continue from the previous node along
   the course direction.
2. Add the deterministic symmetry-breaking perturbation
   `δ_i = perturb_eps · w̄ · sin(2.399963 · (i + 1))` along +z (no random numbers, so both sims
   and every run agree).
3. Relax to tolerance. Repeat for the next round.

The lab sim finishes with a global L-BFGS minimisation and is the reference. The app sim uses a
port of the same L-BFGS (time-budgeted steps in a Web Worker); for pieces over 600 nodes the
interactive view uses looser tolerances and says so.

## 5. Shape metric and classification

Computed on the relaxed, un-blocked piece, real particles only.

1. c = centroid; R_g = RMS distance of particles from c.
2. Axis n: let a = (centroid of last round) − (centroid of first round). If |a| > `axis_min` · R_g,
   n = a/|a| (cups, cones, spheres: the round centroids march along the axis). Otherwise n = the
   direction of least variance (PCA) of all particles.
3. z_i = (x_i − c)·n. For each round r with at least 3 nodes: mean z̄_r and standard deviation σ_r.
4. **Depth** A = (max_r z̄_r − min_r z̄_r) / R_g. **Waviness** W = max_r σ_r / R_g.
5. Class: `flat` if A < `tau_flat` and W < `tau_flat`; otherwise `ruffle` if W > A; otherwise `cup`.

Both sims report `{class, A, W, Rg, outer_radius}` (`outer_radius` = mean distance of last-round
nodes from the axis through c). Cross-sim agreement (CI): identical class on every fixture, and
R_g within `agree_rg_rel`, A and W within `agree_abs` (absolute) of the lab reference stored in
`spec/fixtures/<name>.lab.json`.

## 6. Blocking (lace)

"Blocked" is a different set of boundary conditions on the same network, not different physics:
all particles are constrained to the plane through c normal to n, the nodes of the outermost
round are pinned at `block_stretch` × their relaxed distance from the axis (angles preserved),
and the rest relax in-plane. Reported: mean and maximum spring strain, and the fraction of course
springs compressed by more than `block_buckle_strain` — fabric that would have to be compressed
that much cannot be blocked flat.

Extension (both sims, SPEC_NOTES "Viewer-only options"): blocking may instead take explicit pins
`{node, x, y}` (e.g. a snowflake's blocking template), aligned to the piece by a rigid motion; the
pinned nodes are fixed and the rest relaxes in-plane. Without pins the rule above applies unchanged.
