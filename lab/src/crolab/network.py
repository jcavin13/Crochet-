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

    @property
    def m(self) -> int:
        return len(self.L)

    def pairs(self) -> dict[tuple[int, int], tuple[float, float, int]]:
        return {(int(a), int(b)): (float(L), float(k), int(t))
                for a, b, L, k, t in zip(self.i, self.j, self.L, self.k, self.kind)}

    def springs_of_kind(self, kind: int) -> np.ndarray:
        return np.nonzero(self.kind == kind)[0]


def resolve_anchor_particles(g: Graph, space_particle: dict[int, int]) -> list[list[int]]:
    """Per node: distinct anchor particles (physics.md 'Anchor -> particle'), in leg order."""
    # position j (1-based) of each node among the distinct nodes anchored in each space
    order_in_space: dict[int, dict[int, int]] = {}
    for s in g.spaces:
        order_in_space[s["id"]] = {nid: idx + 1 for idx, nid in enumerate(g.nodes_in_space(s["id"]))}
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
                jj = order_in_space[s][nd["id"]]
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
    """Every node particle lies on one *course*: the chains of a chain ring form their own closed
    course; every other node lies on the course of its round (closed iff the round is worked in
    the round). Each node has a nominal course contribution c_j (flatness.md: w_X for
    stitch-counting nodes, chain_nominal * w_ch for chain-space chains of its round, w_ch for
    ring chains, 0 otherwise), a course coordinate u_j in [0, 1) (centre of its contribution) and
    every course a nominal length C_g."""

    group: list[tuple[str, int]]
    u: np.ndarray
    C: dict[tuple[str, int], float]
    closed: dict[tuple[str, int], bool]
    R: np.ndarray            # reference radius of every node (closed courses), see local_radii
    spiral: list[bool]       # per round: worked in the round and not joined


def course_groups(g: Graph, w: np.ndarray, w_eff: np.ndarray, cfg: dict) -> CourseGroups:
    cn = cfg.get("flatness", {}).get("chain_nominal", 0.85)
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
            c[i] = cn * w[i]
    C: dict[tuple[str, int], float] = {}
    cum: dict[tuple[str, int], float] = {}
    u = np.zeros(g.n)
    for i in range(g.n):
        k = groups[i]
        s0 = cum.get(k, 0.0)
        u[i] = s0 + 0.5 * c[i]
        cum[k] = s0 + c[i]
    for k, tot in cum.items():
        C[k] = tot
    for i in range(g.n):
        u[i] = u[i] / C[groups[i]] if C[groups[i]] > 0 else 0.0
    closed = {k: (k[0] == "ring" or g.rounds[k[1]]["kind"] == "round") for k in C}
    spiral = [rd["kind"] == "round" and not rd.get("joined", False) for rd in g.rounds]
    R = local_radii(g, groups, u, C, spiral)
    return CourseGroups(groups, u, C, closed, R, spiral)


def local_radii(g: Graph, groups, u, C, spiral) -> np.ndarray:
    """Reference radius R_j = C(T_j) / (2 pi) of every node. T_j = r + u_j for a node of a spiral
    round r, r + 1/2 for joined rounds; C(T) interpolates the round lengths C_r placed at
    T = r + 1/2 linearly (rounds worked in the round with C_r > 0), constant before the first
    point, linear extrapolation of the last segment after the last one. A chain ring has the
    constant radius C_ring/(2 pi). A spiral is thus a spiral: the last stitch of round r sits at
    about the radius of the first stitch of round r+1."""
    Ts = [r + 0.5 for r, rd in enumerate(g.rounds) if rd["kind"] == "round" and C.get(("round", r), 0) > 0]
    Cs = [C[("round", int(t - 0.5))] for t in Ts]
    out = np.zeros(g.n)
    for j in range(g.n):
        k = groups[j]
        if k[0] == "ring":
            out[j] = C[k] / (2 * math.pi)
            continue
        r = k[1]
        T = r + (u[j] if spiral[r] else 0.5)
        if not Ts:
            out[j] = C.get(k, 0.0) / (2 * math.pi)
            continue
        if T <= Ts[0] or len(Ts) == 1:
            c = Cs[0] if T <= Ts[0] else Cs[-1]
        elif T >= Ts[-1]:
            c = Cs[-1] + (T - Ts[-1]) * (Cs[-1] - Cs[-2]) / (Ts[-1] - Ts[-2])
        else:
            c = float(np.interp(T, Ts, Cs))
        out[j] = max(c, 0.0) / (2 * math.pi)
    return out


def _wrap(x: float) -> float:
    return x - math.floor(x + 0.5)


class Reference:
    """Reference geometry of the fabric (SPEC_NOTES.md §N1): for every pair of courses
    (course of node i, course of its anchor a) an alignment, and rest distances between a node of
    the upper course and any particle of the lower course taken from the locally rotationally
    symmetric shape the two course lengths and the stitch height imply."""

    def __init__(self, g: Graph, anchors: list[list[int]], cg: CourseGroups, n: int):
        self.cg = cg
        G = cg.group
        pairs: dict[tuple, list[tuple[int, int]]] = {}
        for i in range(n):
            for a in anchors[i]:
                if a < n and G[a] != G[i]:
                    pairs.setdefault((G[i], G[a]), []).append((i, a))
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
            sig = -1.0 if tot < 0 else 1.0
            self.sigma[(gi, ga)] = sig
            self.shift[(gi, ga)] = 0.0
            if gi[0] == "round" and cg.spiral[gi[1]]:
                # a spiral is continuous: round r+1 starts where round r ends, no re-alignment
                continue
            Ds = [self._raw(i, a, gi, ga) for i, a in lst]
            self.shift[(gi, ga)] = float(np.mean(Ds))

    def has(self, i: int, p: int) -> bool:
        return (self.cg.group[i], self.cg.group[p]) in self.sigma

    def _raw(self, i: int, p: int, gi, ga) -> float:
        cg = self.cg
        v = cg.u[i] if self.sigma[(gi, ga)] > 0 else 1.0 - cg.u[i]
        if cg.closed[ga]:
            return _wrap(v - cg.u[p])
        return v * cg.C[gi] - cg.u[p] * cg.C[ga]

    def offset(self, i: int, p: int) -> float:
        """Aligned course offset of i relative to p: a fraction of a turn (closed lower course) or
        mm (open lower course)."""
        gi, ga = self.cg.group[i], self.cg.group[p]
        x = self._raw(i, p, gi, ga) - self.shift[(gi, ga)]
        return _wrap(x) if self.cg.closed[ga] else x

    def cell(self, i: int, p: int, h: float) -> tuple[float, float]:
        """(rest distance, axial rise dz or nan) between node i and particle p of the course below.

        Closed courses of lengths C_t (i's) and C_b (p's), radii R = C/(2 pi), turn offset du:
        * |R_t - R_b| <= h ("surface of revolution"): dz = sqrt(h^2 - (R_t - R_b)^2),
          d^2 = dz^2 + R_t^2 + R_b^2 - 2 R_t R_b cos(2 pi du);
        * otherwise (the two courses cannot be circles h apart: intrinsically hyperbolic):
          the flat fan cell lam = C_t/C_b, rho_b = h/|lam - 1|, rho_t = lam rho_b,
          d^2 = h^2 + 4 rho_t rho_b sin^2(pi du C_b/(2 pi rho_b))  [dz = nan];
        Open courses: d = sqrt(h^2 + x^2), x = offset in mm [dz = nan]."""
        cg = self.cg
        gi, ga = cg.group[i], cg.group[p]
        x = self.offset(i, p)
        if not cg.closed[ga] or not cg.closed[gi]:
            return math.hypot(h, x), float("nan")
        Rt, Rb = float(cg.R[i]), float(cg.R[p])
        if Rt <= 0 or Rb <= 0:
            return math.hypot(h, x * cg.C[gi]), float("nan")
        Ct, Cb = 2 * math.pi * Rt, 2 * math.pi * Rb
        th = 2 * math.pi * x
        if abs(Rt - Rb) <= h:
            dz = math.sqrt(max(0.0, h * h - (Rt - Rb) ** 2))
            d2 = dz * dz + Rt * Rt + Rb * Rb - 2 * Rt * Rb * math.cos(th)
            return math.sqrt(max(d2, 0.0)), dz
        lam = Ct / Cb
        rb = h / abs(lam - 1.0)
        rt = lam * rb
        alpha = Cb / rb
        return math.sqrt(h * h + 4 * rt * rb * math.sin(0.5 * alpha * x) ** 2), float("nan")

    def lateral_mm(self, i: int, p: int) -> float:
        cg = self.cg
        x = self.offset(i, p)
        return x * cg.C[cg.group[i]] if cg.closed[cg.group[p]] else x


def circle_chord(arc: float, C: float) -> float:
    """Chord of an arc of length `arc` on a circle of circumference C (C <= 0: straight)."""
    if C <= 0:
        return arc
    R = C / (2 * math.pi)
    x = min(arc / (2 * R), math.pi / 2)
    return 2 * R * math.sin(x)


def _continuous(cg: CourseGroups, G, a: int, b: int) -> bool:
    """Consecutive nodes a, b lie on one closed course (same course, or the step from a spiral
    round into the next round)."""
    ga, gb = G[a], G[b]
    if ga == gb:
        return cg.closed[ga]
    return (ga[0] == gb[0] == "round" and gb[1] == ga[1] + 1 and cg.spiral[ga[1]] and cg.closed[gb])


def _wale_bend_rest(ref: Reference, i: int, a: int, b: int, hi: float, ha: float) -> float:
    """Rest distance i -> b (two courses down, through a). Both cells surfaces of revolution:
    3D distance on that surface, d^2 = (dz1+dz2)^2 + R_i^2 + R_b^2 - 2 R_i R_b cos(2 pi (du1+du2));
    otherwise sqrt((h_i + h_a)^2 + (lateral_i,a + lateral_a,b)^2) with laterals in mm."""
    cg = ref.cg
    _, dz1 = ref.cell(i, a, hi)
    _, dz2 = ref.cell(a, b, ha)
    if not (math.isnan(dz1) or math.isnan(dz2)):
        Ri, Rb = float(cg.R[i]), float(cg.R[b])
        th = 2 * math.pi * (ref.offset(i, a) + ref.offset(a, b))
        d2 = (dz1 + dz2) ** 2 + Ri * Ri + Rb * Rb - 2 * Ri * Rb * math.cos(th)
        return math.sqrt(max(d2, 0.0))
    return math.hypot(hi + ha, ref.lateral_mm(i, a) + ref.lateral_mm(a, b))


#: "spec" = physics.md v0.1 verbatim; "metric" (default) = rest lengths of wale, shear and bend
#: springs taken from the fabric's reference geometry (SPEC_NOTES.md §N1).
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
    w = np.array([params.width(t) for t in types])            # course width
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
    anchors = resolve_anchor_particles(g, space_particle)

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
    cg = course_groups(g, w, w_eff, cfg)
    ref = Reference(g, anchors, cg, n) if metric else None
    G = cg.group

    gen: list[tuple[int, int, float, float, int]] = []
    kc, kw, ks, kb = cfg["k_course"], cfg["k_wale"], cfg["k_shear"], cfg["k_bend"]
    for i in range(1, n):
        L = Lc(i - 1, i)
        if metric and _continuous(cg, G, i - 1, i):
            L = circle_chord(L, math.pi * (cg.R[i - 1] + cg.R[i]))
        gen.append((i - 1, i, L, kc * min(s_course[i - 1], s_course[i]), COURSE))
    for i in range(n):
        for p in anchors[i]:
            if p in virtual_space:
                L = max(h[i], ring_len.get(p, 0.0))
            else:
                L = ref.cell(i, p, h[i])[0] if (metric and ref.has(i, p)) else h[i]
            gen.append((i, p, L, kw * s_wale[i], WALE))
    for i in range(n):
        for a in anchors[i]:
            if a >= n:
                continue
            for nb in (a - 1, a + 1):
                if 0 <= nb < n and prounds[nb] == prounds[a] and nb != i:
                    if metric and ref.has(i, a) and G[nb] == G[a]:
                        L = ref.cell(i, nb, h[i])[0]
                    else:
                        L = math.hypot(h[i], Lc(a, nb))
                    gen.append((i, nb, L, ks * s_wale[i], SHEAR))
    for i in range(2, n):
        arc = Lc(i - 2, i - 1) + Lc(i - 1, i)
        cont = metric and _continuous(cg, G, i - 2, i - 1) and _continuous(cg, G, i - 1, i)
        L = circle_chord(arc, 2 * math.pi * cg.R[i - 1]) if cont else arc
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
            L = _wale_bend_rest(ref, i, a, b, h[i], h[a])
        gen.append((i, b, L, kb, BEND_WALE))

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
    I = np.array([min(a[0], a[1]) for a in arr], dtype=np.int64)
    J = np.array([max(a[0], a[1]) for a in arr], dtype=np.int64)
    return Network(
        n_nodes=n, n_particles=n_particles, i=I, j=J,
        L=np.array([a[2] for a in arr], dtype=float), k=np.array([a[3] for a in arr], dtype=float),
        kind=np.array([a[4] for a in arr], dtype=np.int64),
        particle_round=np.array(prounds, dtype=np.int64), virtual_space=virtual_space,
        space_particle=space_particle, anchor_particles=anchors, width=w, height=h, graph=g,
        params=params,
    )
