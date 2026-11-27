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
    return CourseGroups(groups, u, C, closed)


def _wrap(x: float) -> float:
    return x - math.floor(x + 0.5)


def reference_offsets(g: Graph, anchors: list[list[int]], cg: CourseGroups, n: int
                      ) -> tuple[dict[tuple[int, int], float], dict[tuple[int, int], float]]:
    """For every wale pair (node i, node anchor particle a) on different courses:
    lam(i, a) = C_course(i) / C_course(a) and the signed lateral offset delta(i, a) of the top of i
    relative to a, measured on the course of i (mm), positive towards a+1:

      sigma = -1 if the course of i runs against the course of a (sum over consecutive anchored
              nodes of i's course with first anchors a != a' on a's course of sign(a' - a) < 0),
              else +1;
      v_i   = u_i (sigma = +1) or 1 - u_i (sigma = -1);
      D     = v_i - u_a, wrapped into [-1/2, 1/2) when a's course is closed;
      Dbar  = mean of D over all wale pairs between the two courses;
      delta = wrap(D - Dbar) * C_course(i)   (no wrap for open courses).

    Pairs on the same course (join slip stitches) and pairs with a virtual particle get none
    (lam = 1, delta = 0)."""
    G = cg.group
    pairs: dict[tuple, list[tuple[int, int]]] = {}
    for i in range(n):
        for a in anchors[i]:
            if a < n and G[a] != G[i]:
                pairs.setdefault((G[i], G[a]), []).append((i, a))
    lam: dict[tuple[int, int], float] = {}
    delta: dict[tuple[int, int], float] = {}
    for (gi, ga), lst in pairs.items():
        tot = 0
        prev = None
        for i, a in sorted(lst):
            if anchors[i][0] != a:
                continue
            if prev is not None and prev != a:
                tot += 1 if a > prev else -1
            prev = a
        sigma = -1.0 if tot < 0 else 1.0
        closed = cg.closed[ga]
        Ds = []
        for i, a in lst:
            v = cg.u[i] if sigma > 0 else 1.0 - cg.u[i]
            D = v - cg.u[a]
            Ds.append(_wrap(D) if closed else D)
        Dbar = float(np.mean(Ds))
        Ci, Ca = cg.C[gi], cg.C[ga]
        for (i, a), D in zip(lst, Ds):
            x = D - Dbar
            if closed:
                x = _wrap(x)
            delta[(i, a)] = x * Ci
            lam[(i, a)] = Ci / Ca if Ci > 0 and Ca > 0 else 1.0
    return lam, delta


def fan_chord(h: float, lam: float, x_top: float, x_bot: float) -> float:
    """Rest distance between a point at height h, lateral offset x_top (mm, along the upper course)
    and a point at lateral offset x_bot (mm, along the lower course) in a cell whose upper course
    is `lam` times as long as its lower one: an annulus sector of radii rho_b = h/|lam-1|,
    rho_t = lam*rho_b, d^2 = h^2 + 4 rho_t rho_b sin^2((x_top/rho_t - x_bot/rho_b)/2).
    lam = 1 is the rectangle: d = sqrt(h^2 + (x_top - x_bot)^2)."""
    if abs(lam - 1.0) < 1e-9:
        return math.hypot(h, x_top - x_bot)
    rb = h / abs(lam - 1.0)
    rt = lam * rb
    dth = x_top / rt - x_bot / rb
    return math.sqrt(h * h + 4.0 * rt * rb * math.sin(0.5 * dth) ** 2)


def circle_chord(arc: float, C: float) -> float:
    """Chord of an arc of length `arc` on a circle of circumference C (C <= 0: straight)."""
    if C <= 0:
        return arc
    R = C / (2 * math.pi)
    x = min(arc / (2 * R), math.pi / 2)
    return 2 * R * math.sin(x)


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
            ring_len[p] = (wb / (2 * math.sin(math.pi / m)) if (metric and m >= 2) else m * wb / (2 * math.pi))

    def Lc(a: int, b: int) -> float:
        return 0.5 * (w[a] + w[b])

    metric = variant == "metric"
    cg = course_groups(g, w, w_eff, cfg)
    lam, delta = reference_offsets(g, anchors, cg, n) if metric else ({}, {})

    gen: list[tuple[int, int, float, float, int]] = []
    kc, kw, ks, kb = cfg["k_course"], cfg["k_wale"], cfg["k_shear"], cfg["k_bend"]
    for i in range(1, n):
        gen.append((i - 1, i, Lc(i - 1, i), kc * min(s_course[i - 1], s_course[i]), COURSE))
    for i in range(n):
        for p in anchors[i]:
            if p in virtual_space:
                L = max(h[i], ring_len.get(p, 0.0))
            else:
                L = fan_chord(h[i], lam.get((i, p), 1.0), delta.get((i, p), 0.0), 0.0)
            gen.append((i, p, L, kw * s_wale[i], WALE))
    for i in range(n):
        for a in anchors[i]:
            if a >= n:
                continue
            for nb in (a - 1, a + 1):
                if 0 <= nb < n and prounds[nb] == prounds[a] and nb != i:
                    x_bot = Lc(a, nb) * (1.0 if nb > a else -1.0)
                    L = fan_chord(h[i], lam.get((i, a), 1.0), delta.get((i, a), 0.0), x_bot)
                    gen.append((i, nb, L, ks * s_wale[i], SHEAR))
    for i in range(2, n):
        arc = Lc(i - 2, i - 1) + Lc(i - 1, i)
        k1 = cg.group[i - 1]
        L = circle_chord(arc, cg.C[k1]) if metric and cg.closed[k1] else arc
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
        x = delta.get((i, a), 0.0) + lam.get((i, a), 1.0) * delta.get((a, b), 0.0)
        gen.append((i, b, math.hypot(h[i] + h[a], x), kb, BEND_WALE))

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
