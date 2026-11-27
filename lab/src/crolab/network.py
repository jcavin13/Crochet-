"""The spring network of `spec/physics.md` §1–3, built from a stitch graph and a parameter set.

Particle indexing: particle i (0 <= i < n_nodes) is node i (the *top* of the stitch);
particles n_nodes.. are the virtual particles of the magic rings (ring spaces without chains),
in increasing space id.

Spring kinds (integer codes in `Network.kind`):
  0 course, 1 wale, 2 shear, 3 bend_course, 4 bend_wale.

Clarifications of physics.md that this module implements (see lab/SPEC_NOTES.md):
* Turning-chain top with countsAs X: height h_X and stiffness s_X for its wale / shear / wale-bend
  springs; its own chain width w_ch (and s_ch) for course springs and course bends.
* Magic-ring rest length L = max(h_j, m * wbar / (2 pi)) where wbar uses the width of the stitch
  each node *counts as* (w_X for a counts-as turning-chain top), i.e. exactly the C_1 of flatness.md.
* "node anchor particle" (shear) = an anchor particle that is a real node particle (this includes
  the chain a chain-space anchor resolves to); virtual ring particles get no shear springs.
* Duplicate pairs keep the spring with the largest k; on a tie the first generated wins, in the
  generation order course (i ascending), wale, shear, bend_course, bend_wale (each by node i
  ascending, then leg order, then a-1 before a+1).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .graph import Graph
from .params import StitchParams, load_sim_config, select_set
from .spine import arm_bases, find_pointed_loops, find_spines

COURSE, WALE, SHEAR, BEND_COURSE, BEND_WALE = range(5)
KIND_NAMES = ("course", "wale", "shear", "bend_course", "bend_wale")


@dataclass
class Network:
    n_nodes: int
    n_particles: int
    i: np.ndarray          # int [m]
    j: np.ndarray          # int [m]
    L: np.ndarray          # float [m] rest length (mm)
    k: np.ndarray          # float [m] stiffness (EA-type: energy 1/2 k/L (d-L)^2)
    kind: np.ndarray       # int [m]
    particle_round: np.ndarray            # int [n_particles]
    virtual_space: dict[int, int]         # particle index -> magic ring space id
    space_particle: dict[int, int]        # magic ring space id -> particle index
    anchor_particles: list[list[int]]     # per node: distinct anchor particles in leg order
    width: np.ndarray      # course width per node
    height: np.ndarray     # (effective) height per node
    graph: Graph = field(repr=False)
    params: StitchParams = field(repr=False)
    slack: np.ndarray = None  # bool [m]: tension-only springs (chain-space chains, SPEC_NOTES N4)
    spines: list = field(default_factory=list)  # crolab.spine.Spine per spine (SPEC_NOTES N5)
    pointed_loops: list = field(default_factory=list)  # crolab.spine.PointedLoop (SPEC_NOTES N6)
    outline: object = None  # crolab.outline.Outline: rows / borders / polygons (SPEC_NOTES N8-N10)

    @property
    def m(self) -> int:
        return len(self.L)

    def pairs(self) -> dict[tuple[int, int], tuple[float, float, int]]:
        return {(int(a), int(b)): (float(L), float(k), int(t))
                for a, b, L, k, t in zip(self.i, self.j, self.L, self.k, self.kind)}

    def springs_of_kind(self, kind: int) -> np.ndarray:
        return np.nonzero(self.kind == kind)[0]


def seam_slip_stitches(g: Graph, bases: set[int]) -> dict[int, int]:
    """SPEC_NOTES N7 (TypeScript `seamSlipStitches`): space id -> its seam slip stitch, for chain
    spaces that carry an arm (a member is in `bases`) and whose first member is a slip stitch with
    only slip stitches before it in its round."""
    out: dict[int, int] = {}
    for s in g.spaces:
        if s["kind"] != "chsp":
            continue
        mem = g.nodes_in_space(s["id"])
        if len(mem) < 2 or not any(v in bases for v in mem):
            continue
        f = mem[0]
        nd = g.nodes[f]
        if nd["type"] != "slst":
            continue
        rd = g.rounds[nd["round"]]
        if all(g.nodes[i]["type"] == "slst" for i in range(rd["first"], f)):
            out[s["id"]] = f
    return out


def resolve_anchor_particles(g: Graph, space_particle: dict[int, int], seam: dict[int, int] | None = None) -> list[list[int]]:
    """Per node: distinct anchor particles (physics.md 'Anchor -> particle'), in leg order. N7: the
    seam slip stitch of an arm space (`seam`) takes no share and attaches where the first other
    member of the space does."""
    seam = seam or {}
    # position j (1-based) of each node among the distinct nodes anchored in each space
    order_in_space: dict[int, dict[int, int]] = {}
    for s in g.spaces:
        sl = seam.get(s["id"])
        mem = [v for v in g.nodes_in_space(s["id"]) if v != sl]
        order_in_space[s["id"]] = {nid: idx + 1 for idx, nid in enumerate(mem)}
    out: list[list[int]] = []
    for nd in g.nodes:
        ps: list[int] = []
        for a in nd["into"]:
            if "node" in a:
                p = a["node"]
            else:
                s = a["space"]
                sp = g.spaces[s]
                chains = sp["chains"]
                m = len(order_in_space[s])
                jj = order_in_space[s].get(nd["id"], 1)  # N7: the seam slip stitch goes with the first other member
                if sp["kind"] == "ring" and not chains:
                    p = space_particle[s]
                elif sp["kind"] == "ring":
                    n = len(chains)
                    q = (jj - 1) * n // m + 1
                    p = chains[q - 1]
                else:
                    n = len(chains)
                    q = int(math.floor(jj * (n + 1) / (m + 1) + 0.5))
                    q = min(max(q, 1), n)
                    p = chains[q - 1]
            if p not in ps:
                ps.append(p)
        out.append(ps)
    return out


# ------------------------------------------------------------------------------------------
# reference ("prescribed metric") geometry of the fabric — SPEC_NOTES.md §N1
# ------------------------------------------------------------------------------------------
@dataclass
class CourseGroups:
    """Every node lies on one *course*: the chains of a chain ring form their own closed course;
    every other node lies on the course of its round (closed iff the round is worked in the
    round). Each node j has a nominal course contribution c_j (flatness.md: w_X for
    stitch-counting nodes, chain_nominal*w_ch for chains of a chain space of its round, w_ch for
    ring chains, 0 otherwise) and a course coordinate u_j in [0, 1) (centre of its contribution);
    every course g a nominal length C_g, and closed courses a geodesic radius rho_g (radius of
    the circle the course would be if the fabric were developed flat around it)."""

    group: list[tuple[str, int]]
    u: np.ndarray
    C: dict[tuple[str, int], float]
    closed: dict[tuple[str, int], bool]
    rho_g: dict[tuple[str, int], float]
    Cnode: np.ndarray = None   # per node: length of the reference circle it lies on


def course_groups(g: Graph, w: np.ndarray, w_eff: np.ndarray, h: np.ndarray, cfg: dict,
                  params: StitchParams | None = None) -> CourseGroups:
    cn = cfg.get("flatness", {}).get("chain_nominal", 0.85)
    # lace rounds: chain spaces take up the length the round needs, within their compliance band
    # [chain_slack_min, 1] (flatness.md); chains of a round with a loop rise sit further out.
    fl_round: dict[int, dict] = {}
    if params is not None and any(sp["kind"] == "chsp" for sp in g.spaces):
        from .flatness import analyse
        for row in analyse(g.pattern, params, cfg)["rounds"]:
            fl_round[row["round"]] = row
    smin = cfg.get("flatness", {}).get("chain_slack_min", 0.3)
    chain_frac: dict[int, float] = {}
    for r, row in fl_round.items():
        if row["class"] == "n/a" or row["C_max"] <= row["C_min"]:
            continue
        sum_st = row["C_min"] - smin * (row["C_max"] - row["C_min"]) / (1 - smin)
        sum_ch = (row["C_max"] - row["C_min"]) / (1 - smin)
        f = (2 * math.pi * row["rho"] - sum_st) / sum_ch
        chain_frac[r] = min(1.0, max(smin, f))
    ring_chain: dict[int, int] = {}
    for s in g.spaces:
        if s["kind"] == "ring":
            for ch in s["chains"]:
                ring_chain[ch] = s["id"]
    groups: list[tuple[str, int]] = []
    c = np.zeros(g.n)
    for i, nd in enumerate(g.nodes):
        if i in ring_chain:
            groups.append(("ring", ring_chain[i]))
            c[i] = w[i]
            continue
        r = nd["round"]
        groups.append(("round", r))
        if g.counts_as_stitch(i):
            c[i] = w_eff[i]
        elif i in g.chain_space and g.spaces[g.chain_space[i]]["kind"] == "chsp" \
                and g.spaces[g.chain_space[i]]["round"] == r:
            c[i] = chain_frac.get(r, cn) * w[i]
    cum: dict[tuple[str, int], float] = {}
    u = np.zeros(g.n)
    for i in range(g.n):
        k = groups[i]
        s0 = cum.get(k, 0.0)
        u[i] = s0 + 0.5 * c[i]
        cum[k] = s0 + c[i]
    C = dict(cum)
    for i in range(g.n):
        u[i] = u[i] / C[groups[i]] if C[groups[i]] > 0 else 0.0
    closed = {k: (k[0] == "ring" or g.rounds[k[1]]["kind"] == "round") for k in C}
    rho_g = geodesic_radii(g, groups, C, h, closed)
    # length of the circle each node lies on: its course length; chains of chain spaces of a
    # round whose loops stand outward (flatness.md arc rise) lie on a circle 2 pi rise longer
    Cn = np.array([C[groups[i]] for i in range(g.n)])
    for i in range(g.n):
        r = g.nodes[i]["round"]
        if c[i] > 0 and not g.counts_as_stitch(i) and groups[i][0] == "round" and r in fl_round:
            row = fl_round[r]
            Cn[i] += 2 * math.pi * (row["r"] - row["rho"])
    return CourseGroups(groups, u, C, closed, rho_g, Cn)


def geodesic_radii(g: Graph, groups, C, h, closed) -> dict:
    """rho_g = C_r / (dC/drho) for closed round courses, with dC/drho = (C_{r+1} - C_{r-1}) /
    (hbar_{r+1} + hbar_r) (central difference over the rounds worked in the round; one-sided at
    the ends: (C_{r+1} - C_r)/hbar_{r+1}, (C_r - C_{r-1})/hbar_r). A round worked into a magic
    ring, and a chain ring, use C/(2 pi). |dC/drho| < 1e-9: infinite (straight). A closed course
    of total length 0 (a round of only slip stitches) gets no entry; callers treat a missing
    radius as straight, like the TypeScript sim."""
    hb: dict[int, float] = {}
    for r in range(len(g.rounds)):
        st = g.stitch_nodes(r)
        hb[r] = float(np.mean(h[st])) if st else 0.0
    rr = [r for r in range(len(g.rounds)) if closed.get(("round", r)) and C.get(("round", r), 0) > 0]
    out: dict = {}
    for k in C:
        if k[0] == "ring":
            out[k] = C[k] / (2 * math.pi)
    for idx, r in enumerate(rr):
        Cr = C[("round", r)]
        into_ring = any(a.get("space") is not None and g.is_magic_ring(a["space"])
                        for i in g.stitch_nodes(r) for a in g.nodes[i]["into"])
        if into_ring or len(rr) == 1:
            out[("round", r)] = Cr / (2 * math.pi)
            continue
        lo = rr[idx - 1] if idx > 0 else r
        hi = rr[idx + 1] if idx + 1 < len(rr) else r
        dC = C[("round", hi)] - C[("round", lo)]
        dr = (hb[hi] if hi != r else 0.0) + (hb[r] if lo != r else 0.0)
        if lo != r and hi != r:
            dr = hb[hi] + hb[r]
        slope = dC / dr if dr > 0 else 0.0
        out[("round", r)] = abs(Cr / slope) if abs(slope) > 1e-9 else math.inf
    return out


def _wrap(x: float) -> float:
    return x - math.floor(x + 0.5)


class Reference:
    """Intrinsic reference geometry for the springs between a node i and particles of the course
    of its anchor (SPEC_NOTES.md §N1)."""

    def __init__(self, g: Graph, anchors: list[list[int]], cg: CourseGroups, n: int):
        self.cg = cg
        G = cg.group
        pairs: dict[tuple, list[tuple[int, int]]] = {}
        lace = {G[c] for s in g.spaces if s["kind"] == "chsp" for c in s["chains"]}
        for i in range(n):
            for a in anchors[i]:
                if a < n and G[a] != G[i] and g.counts_as_stitch(i):
                    pairs.setdefault((G[i], G[a]), []).append((i, a))
        self.lace = lace
        self.counting = [g.counts_as_stitch(i) for i in range(n)]
        self.sigma: dict[tuple, float] = {}
        self.shift: dict[tuple, float] = {}
        for (gi, ga), lst in pairs.items():
            tot = 0
            prev = None
            for i, a in sorted(lst):
                if anchors[i][0] != a:
                    continue
                if prev is not None and prev != a:
                    tot += 1 if a > prev else -1
                prev = a
            self.sigma[(gi, ga)] = -1.0 if tot < 0 else 1.0
            self.shift[(gi, ga)] = 0.0
            Ds = [self._raw(i, a, gi, ga) for i, a in lst]
            self.shift[(gi, ga)] = float(np.mean(Ds))

    def has(self, i: int, p: int) -> bool:
        return self.counting[i] and (self.cg.group[i], self.cg.group[p]) in self.sigma

    def _raw(self, i: int, p: int, gi, ga) -> float:
        cg = self.cg
        v = cg.u[i] if self.sigma[(gi, ga)] > 0 else 1.0 - cg.u[i]
        if cg.closed[ga]:
            return _wrap(v - cg.u[p])
        return v * cg.C[gi] - cg.u[p] * cg.C[ga]

    def offset(self, i: int, p: int) -> float:
        """Aligned course offset x of i relative to p: a fraction of a turn when p's course is
        closed, mm when it is open."""
        gi, ga = self.cg.group[i], self.cg.group[p]
        x = self._raw(i, p, gi, ga) - self.shift[(gi, ga)]
        return _wrap(x) if self.cg.closed[ga] else x

    def closed_pair(self, i: int, p: int) -> bool:
        cg = self.cg
        return cg.closed[cg.group[i]] and cg.closed[cg.group[p]]

    def cell(self, i: int, p: int, h: float) -> float:
        """Rest distance between node i and particle p of the course below, height h apart, in
        the flat annular cell spanned by the two courses (lengths C_t, C_b, turn offset x):
          C_t == C_b:  d^2 = h^2 + (x C)^2
          otherwise:   rho_b = h C_b/|C_t - C_b|, rho_t = h C_t/|C_t - C_b|, alpha = |C_t - C_b|/h,
                       d^2 = h^2 + 4 rho_t rho_b sin^2(alpha x / 2).
        Open courses: d^2 = h^2 + x^2 (x in mm)."""
        cg = self.cg
        x = self.offset(i, p)
        if not self.closed_pair(i, p):
            return math.hypot(h, x)
        Ct, Cb = float(cg.Cnode[i]), float(cg.Cnode[p])
        dC = abs(Ct - Cb)
        if dC < 1e-9 * max(Ct, Cb):
            return math.hypot(h, x * Ct)
        rb, rt, alpha = h * Cb / dC, h * Ct / dC, dC / h
        return math.sqrt(h * h + 4 * rt * rb * math.sin(0.5 * alpha * x) ** 2)

    def wale_bend(self, i: int, a: int, b: int, hi: float, ha: float) -> float:
        """Rest distance i -> b through a (meridians are geodesics: straight in the developed
        fabric): d^2 = (h_i + h_a)^2 + lat^2, lat = (x_ia + x_ab) sqrt(C_i C_b) for closed
        courses, x_ia + x_ab (mm) for open ones."""
        cg = self.cg
        x = self.offset(i, a) + self.offset(a, b)
        if self.closed_pair(i, a) and self.closed_pair(a, b):
            lat = x * math.sqrt(cg.Cnode[i] * cg.Cnode[b])
        else:
            lat = x
        return math.hypot(hi + ha, lat)


def _seam(g: Graph, ref: Reference, a: int, b: int) -> bool:
    """Course step a -> b (a < b) from one round's course into the next round's course, both
    stitch-counting nodes, b's course worked into a's (the jog of a spiral)."""
    return (g.counts_as_stitch(a) and g.counts_as_stitch(b) and ref.cg.group[a] != ref.cg.group[b]
            and ref.has(b, a))


def circle_chord(arc: float, R: float) -> float:
    """Chord of an arc of length `arc` on a circle of radius R (R infinite or <= 0: straight)."""
    if not (0 < R < math.inf):
        return arc
    x = min(arc / (2 * R), math.pi / 2)
    return 2 * R * math.sin(x)


#: "spec" = physics.md v0.1 verbatim; "metric" (default) = rest lengths of wale, shear, course
#: and bend springs from the fabric's intrinsic reference geometry (SPEC_NOTES.md §N1).
VARIANTS = ("spec", "metric")
DEFAULT_VARIANT = "metric"


def build_network(pattern: dict, params: StitchParams | None = None, config: dict | None = None,
                  variant: str = DEFAULT_VARIANT) -> Network:
    assert variant in VARIANTS, variant
    g = Graph(pattern)
    params = params or select_set(pattern)
    cfg = config or load_sim_config()
    n = g.n
    types = [nd["type"] for nd in g.nodes]
    eff = [g.effective_type(i) for i in range(n)]
    # course width: a counts-as turning-chain top occupies the course like the stitch it counts
    # as (metric variant; SPEC_NOTES N2) — physics.md v0.1 ("spec") uses the chain width
    w = np.array([params.width(e if variant == "metric" else t) for t, e in zip(types, eff)])
    w_eff = np.array([params.width(t) for t in eff])          # width of the stitch it counts as
    h = np.array([params.height(t) for t in eff])
    s_course = np.array([params.stiffness(t) for t in types])
    s_wale = np.array([params.stiffness(t) for t in eff])

    space_particle: dict[int, int] = {}
    virtual_space: dict[int, int] = {}
    prounds = [nd["round"] for nd in g.nodes]
    for s in g.magic_rings():
        p = n + len(space_particle)
        space_particle[s] = p
        virtual_space[p] = s
        prounds.append(g.spaces[s]["round"])
    n_particles = n + len(space_particle)
    metric0 = variant == "metric"
    pointed = find_pointed_loops(g, w) if metric0 else []
    anchors = resolve_anchor_particles(g, space_particle, seam_slip_stitches(g, arm_bases(g, pointed)) if metric0 else None)

    metric = variant == "metric"
    # magic-ring rest lengths
    ring_len: dict[int, float] = {}
    for s, p in space_particle.items():
        members = g.nodes_in_space(s)
        m = len(members)
        if m:
            wb = float(np.mean(w_eff[members]))
            ring_len[p] = m * wb / (2 * math.pi)

    def Lc(a: int, b: int) -> float:
        return 0.5 * (w[a] + w[b])

    metric = variant == "metric"
    # chains of a turning chain other than a counts-as top: a column climbing to the next round,
    # not part of the fabric's course (SPEC_NOTES N3)
    tch_chain = [nd.get("role") == "tch" and not nd.get("countsAs") for nd in g.nodes]
    # chains of chain spaces: slack yarn loops (tension-only course springs, no shear to them)
    chsp_chain = np.zeros(n, bool)
    for sp in g.spaces:
        if sp["kind"] == "chsp":
            chsp_chain[sp["chains"]] = True
    cg = course_groups(g, w, w_eff, h, cfg, params)
    ref = Reference(g, anchors, cg, n) if metric else None
    G = cg.group

    gen: list[tuple[int, int, float, float, int]] = []
    kc, kw, ks, kb = cfg["k_course"], cfg["k_wale"], cfg["k_shear"], cfg["k_bend"]
    for i in range(1, n):
        L = Lc(i - 1, i)
        if metric and G[i - 1] == G[i] and cg.closed[G[i]] and G[i] not in ref.lace:
            L = circle_chord(L, cg.rho_g.get(G[i], math.inf))   # C = 0 course (e.g. only sl sts): straight
        elif metric and _seam(g, ref, i - 1, i):
            L = ref.cell(i, i - 1, h[i])
        gen.append((i - 1, i, L, kc * min(s_course[i - 1], s_course[i]), COURSE))
    for i in range(n):
        for p in anchors[i]:
            if p in virtual_space:
                L = max(h[i], ring_len.get(p, 0.0))
            else:
                L = ref.cell(i, p, h[i]) if (metric and ref.has(i, p)) else h[i]
            gen.append((i, p, L, kw * s_wale[i], WALE))
    for i in range(n):
        if metric and not g.counts_as_stitch(i):
            continue  # slip stitches lie flat in the fabric: no column, no shear (N3)
        for a in anchors[i]:
            if a >= n or (metric and chsp_chain[a]):
                continue  # a stitch worked into a slack loop does not shear against it (N4)
            for nb in (a - 1, a + 1):
                if 0 <= nb < n and prounds[nb] == prounds[a] and nb != i and not (metric and (tch_chain[nb] or chsp_chain[nb])):
                    if metric and ref.has(i, a) and G[nb] == G[a]:
                        L = ref.cell(i, nb, h[i])
                    else:
                        L = math.hypot(h[i], Lc(a, nb))
                    gen.append((i, nb, L, ks * s_wale[i], SHEAR))
    for i in range(2, n):
        if metric and (tch_chain[i - 2] or tch_chain[i - 1] or tch_chain[i]):
            continue
        arc = Lc(i - 2, i - 1) + Lc(i - 1, i)
        k1 = G[i - 1]
        cont = metric and G[i - 2] == k1 == G[i] and cg.closed[k1] and k1 not in ref.lace
        L = circle_chord(arc, cg.rho_g.get(k1, math.inf)) if cont else arc
        if metric and not cont and _seam(g, ref, i - 2, i):
            L = ref.cell(i, i - 2, h[i])
        gen.append((i - 2, i, L, kb, BEND_COURSE))
    for i in range(n):
        if not anchors[i]:
            continue
        a = anchors[i][0]
        if a >= n or not anchors[a]:
            continue
        b = anchors[a][0]
        if b >= n or b == i:
            continue
        L = h[i] + h[a]
        if metric and ref.has(i, a) and ref.has(a, b):
            L = ref.wale_bend(i, a, b, h[i], h[a])
        gen.append((i, b, L, kb, BEND_WALE))

    # N8-N10: rows, border rounds and polygon rounds take their reference cells from the planar
    # layout (crolab.outline): wale, shear and wale-bend rest lengths are layout distances; course
    # springs keep the stitch widths, bent by the chord/arc ratio of the reference curve; the
    # foundation span takes the first row's length
    outline = None
    if metric:
        from .outline import apply_outline, build_outline
        fl = cfg.get("flatness", {})
        outline = build_outline(g, w_eff, w, h, fl.get("chain_nominal", 0.85), fl.get("tol", 0.1))
        if outline is not None:
            counting = [g.counts_as_stitch(i) for i in range(n)]
            apply_outline(outline, [nd["round"] for nd in g.nodes], counting, chsp_chain, Lc, gen, n)

    # N5: spines (chains with stitches worked back along them) are doubled cords: every spring
    # between two nodes of one spine takes its rest length from the spine's flat reference layout,
    # and the course bends along the stem and along the return row get course stiffness
    spines = find_spines(g, w, h, params.width("ch")) if metric else []
    if spines:
        owner: dict[int, int] = {}
        stem: set[int] = set()
        ret: set[int] = set()
        for si, sp in enumerate(spines):
            for v in sp.pos:
                owner[v] = si
            stem.update(sp.stem)
            ret.update(sp.ret)
        for idx, (a, b, L, k, t) in enumerate(gen):
            sa, sb = owner.get(a), owner.get(b)
            if sa is None or sa != sb:
                continue
            pa, pb = spines[sa].pos[a], spines[sa].pos[b]
            L = math.hypot(pa[0] - pb[0], pa[1] - pb[1])
            if t == BEND_COURSE:
                lo = min(a, b)
                trip = (lo, lo + 1, lo + 2)
                if all(v in stem for v in trip) or all(v in ret for v in trip):
                    k = kc * min(s_course[v] for v in trip)
            gen[idx] = (a, b, L, k, t)

    # N6: pointed loops are starched open loops: every spring between two nodes of one loop (feet
    # included) takes its rest length from the loop's layout and is two-sided; course bends along
    # the loop get course stiffness
    loop_owner: dict[int, int] = {}
    for li, pl in enumerate(pointed):
        for v in pl.pos:
            loop_owner[v] = li
    if pointed:
        for idx, (a, b, L, k, t) in enumerate(gen):
            la, lb = loop_owner.get(a), loop_owner.get(b)
            if la is None or la != lb:
                continue
            pa, pb = pointed[la].pos[a], pointed[la].pos[b]
            L = math.hypot(pa[0] - pb[0], pa[1] - pb[1])
            if t == BEND_COURSE:
                lo = min(a, b)
                k = kc * min(s_course[v] for v in (lo, lo + 1, lo + 2))
            gen[idx] = (a, b, L, k, t)

    best: dict[tuple[int, int], int] = {}
    for idx, (a, b, L, k, t) in enumerate(gen):
        if a == b:
            continue
        key = (min(a, b), max(a, b))
        cur = best.get(key)
        if cur is None or k > gen[cur][3]:
            best[key] = idx
    keep = sorted(best.values())
    arr = [gen[x] for x in keep]

    def is_slack(a, b, t):
        if not metric or t not in (COURSE, BEND_COURSE):
            return False
        la = loop_owner.get(a)
        if la is not None and la == loop_owner.get(b):
            return False
        lo, hi = min(a, b), max(a, b)
        return bool(chsp_chain[lo:hi + 1].any())
    I = np.array([min(a[0], a[1]) for a in arr], dtype=np.int64)
    J = np.array([max(a[0], a[1]) for a in arr], dtype=np.int64)
    return Network(
        n_nodes=n, n_particles=n_particles, i=I, j=J,
        L=np.array([a[2] for a in arr], dtype=float), k=np.array([a[3] for a in arr], dtype=float),
        kind=np.array([a[4] for a in arr], dtype=np.int64),
        particle_round=np.array(prounds, dtype=np.int64), virtual_space=virtual_space,
        space_particle=space_particle, anchor_particles=anchors, width=w, height=h, graph=g,
        params=params, slack=np.array([is_slack(a[0], a[1], a[4]) for a in arr], dtype=bool),
        spines=spines, pointed_loops=pointed, outline=outline,
    )
