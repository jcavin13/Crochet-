"""Discrete curvature of crochet pieces.

(a) Intrinsic, from rest lengths only (Gauss–Bonnet on concentric rounds, flatness.md radii):
    a round of course length C at geodesic radius rho bounds a disc whose total Gaussian
    curvature is  K_enc = 2*pi - dC/drho  (the geodesic curvature of a circle of a surface of
    revolution integrates to dC/drho). Discretely, between rounds k-1 and k,
    K_enc(k-1/2) = 2*pi - (C_k - C_{k-1}) / (rho_k - rho_{k-1}) = -2*pi*g_k,
    and the curvature of the annulus around round k is K_enc(k+1/2) - K_enc(k-1/2).

(b) Extrinsic, on the simulated surface (solid fabric only): every round is a closed polygon of
    its stitch-counting nodes; consecutive rounds are joined by triangles following the anchor
    relations; the first round is fanned to the magic-ring particle. The angle deficit
    2*pi - sum(angles) at interior vertices, pi - sum(angles) at boundary vertices, satisfies the
    discrete Gauss–Bonnet theorem  sum = 2*pi*chi  exactly (chi = V - E + F). A closed shape
    (sphere) can be capped with one extra vertex at the centroid of its last round, chi = 2.

(c) Plots: curvature per round, 3D renders, cross-sections (matplotlib).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .graph import Graph


# ------------------------------------------------------------------------------------------
# (a) intrinsic
# ------------------------------------------------------------------------------------------
def intrinsic_curvature(pattern: dict, params=None, config=None) -> list[dict]:
    """Per round: K_enc (total curvature enclosed by the round, at the mid-radius between this
    round and the previous one), K_annulus, area estimate and K density. Uses flatness radii."""
    from .flatness import analyse

    fl = analyse(pattern, params, config)
    out = []
    prevC = 0.0
    prevK = 0.0
    for row in fl["rounds"]:
        if row["class"] == "n/a":
            continue
        C, rho = row["C"], row["rho"]
        r0 = row["rho_prev"]
        dr = rho - r0
        Kenc = 2 * math.pi - (C - prevC) / dr if dr > 0 else float("nan")
        area = 0.5 * (C + prevC) * dr
        out.append({"round": row["round"], "label": row["label"], "rho": rho, "C": C,
                    "K_enclosed": Kenc, "K_annulus": Kenc - prevK, "area": area,
                    "K_density": (Kenc - prevK) / area if area > 0 else float("nan")})
        prevC, prevK = C, Kenc
    return out


# ------------------------------------------------------------------------------------------
# (b) extrinsic
# ------------------------------------------------------------------------------------------
@dataclass
class Mesh:
    V: np.ndarray            # [nv, 3]
    F: np.ndarray            # [nf, 3] vertex indices
    vertex_particle: np.ndarray   # particle index of each vertex (-1 = cap vertex)
    vertex_round: np.ndarray      # round of each vertex (-1 ring particle, R = cap)
    boundary: np.ndarray     # bool per vertex
    closed: bool


def triangulate(res_or_net, X: np.ndarray | None = None, cap: bool = False) -> Mesh:
    """Triangulate a solid piece worked in the round (every round's anchors are stitch-counting
    nodes of the previous round, the first round is worked into a magic ring)."""
    if X is None:
        net, X = res_or_net.network, res_or_net.positions
    else:
        net = res_or_net
    g: Graph = net.graph
    rounds = [r for r in range(len(g.rounds)) if g.stitch_nodes(r)]
    cycles = [g.stitch_nodes(r) for r in rounds]
    vid: dict[int, int] = {}
    verts: list[int] = []
    vround: list[int] = []
    faces: list[tuple[int, int, int]] = []

    def v(p: int, r: int) -> int:
        if p not in vid:
            vid[p] = len(verts)
            verts.append(p)
            vround.append(r)
        return vid[p]

    ring = None
    first = cycles[0]
    A0 = net.anchor_particles[first[0]]
    if A0 and A0[0] >= net.n_nodes:
        ring = A0[0]
        rv = v(ring, -1)
        for k in range(len(first)):
            a, b = first[k], first[(k + 1) % len(first)]
            faces.append((v(a, rounds[0]), v(b, rounds[0]), rv))
    else:
        raise ValueError("triangulate: first round must be worked into a magic ring")
    for ci in range(1, len(cycles)):
        top, bot = cycles[ci], cycles[ci - 1]
        r = rounds[ci]
        pos = {p: k for k, p in enumerate(bot)}
        nb = len(bot)

        def anc(i):
            ks = [pos[p] for p in net.anchor_particles[i] if p in pos]
            if not ks:
                raise ValueError(f"node {i} has no anchor in the previous round")
            # order legs along the lower cycle starting from the first leg
            k0 = ks[0]
            return sorted(ks, key=lambda k: (k - k0) % nb)
        for i in top:
            ks = anc(i)
            for k1, k2 in zip(ks[:-1], ks[1:]):
                kk = k1
                while kk != k2:
                    faces.append((v(i, r), v(bot[kk], rounds[ci - 1]), v(bot[(kk + 1) % nb], rounds[ci - 1])))
                    kk = (kk + 1) % nb
        nt = len(top)
        for j in range(nt):
            i, i2 = top[j], top[(j + 1) % nt]
            a = anc(i)[-1]
            b = anc(i2)[0]
            gap = (b - a) % nb
            if gap > nb // 2:
                raise ValueError(f"non-monotone anchors between nodes {i} and {i2}")
            kk = a
            while kk != b:
                faces.append((v(i, r), v(bot[kk], rounds[ci - 1]), v(bot[(kk + 1) % nb], rounds[ci - 1])))
                kk = (kk + 1) % nb
            faces.append((v(i, r), v(bot[b], rounds[ci - 1]), v(i2, r)))
    V = X[np.array(verts)]
    vp = np.array(verts)
    vr = np.array(vround)
    boundary = np.zeros(len(verts), bool)
    for p in cycles[-1]:
        boundary[vid[p]] = True
    closed = False
    if cap:
        last = cycles[-1]
        c = X[np.array(last)].mean(axis=0)
        V = np.vstack([V, c])
        cv = len(V) - 1
        for k in range(len(last)):
            faces.append((vid[last[k]], vid[last[(k + 1) % len(last)]], cv))
        vp = np.append(vp, -1)
        vr = np.append(vr, rounds[-1] + 1)
        boundary = np.zeros(len(V), bool)
        closed = True
    return Mesh(V=V, F=np.array(faces, dtype=np.int64), vertex_particle=vp, vertex_round=vr,
                boundary=boundary, closed=closed)


def corner_angles(V: np.ndarray, F: np.ndarray) -> np.ndarray:
    """[nf, 3] interior angle of each triangle at each of its corners."""
    P = V[F]
    ang = np.zeros(F.shape)
    for c in range(3):
        a = P[:, (c + 1) % 3] - P[:, c]
        b = P[:, (c + 2) % 3] - P[:, c]
        na = np.linalg.norm(a, axis=1)
        nb = np.linalg.norm(b, axis=1)
        cosv = np.einsum("ij,ij->i", a, b) / np.maximum(na * nb, 1e-300)
        ang[:, c] = np.arccos(np.clip(cosv, -1.0, 1.0))
    return ang


def euler_characteristic(mesh: Mesh) -> int:
    F = mesh.F
    E = {tuple(sorted((int(F[f, a]), int(F[f, b])))) for f in range(len(F)) for a, b in ((0, 1), (1, 2), (2, 0))}
    return len(mesh.V) - len(E) + len(F)


def edge_manifold_ok(mesh: Mesh) -> bool:
    """Every edge in 1 (boundary) or 2 (interior) faces."""
    from collections import Counter

    F = mesh.F
    cnt = Counter(tuple(sorted((int(F[f, a]), int(F[f, b])))) for f in range(len(F)) for a, b in ((0, 1), (1, 2), (2, 0)))
    return all(c in (1, 2) for c in cnt.values())


def angle_deficits(mesh: Mesh) -> np.ndarray:
    """2*pi - sum(angles) at interior vertices, pi - sum(angles) at boundary vertices."""
    ang = corner_angles(mesh.V, mesh.F)
    s = np.zeros(len(mesh.V))
    np.add.at(s, mesh.F.ravel(), ang.ravel())
    return np.where(mesh.boundary, math.pi, 2 * math.pi) - s


def extrinsic_curvature(res, cap: bool = False, X: np.ndarray | None = None) -> dict:
    """Angle-deficit curvature of the simulated surface: totals and per round."""
    mesh = triangulate(res.network, res.positions if X is None else X, cap=cap)
    d = angle_deficits(mesh)
    chi = euler_characteristic(mesh)
    interior = ~mesh.boundary
    per_round = {}
    for r in sorted(set(int(x) for x in mesh.vertex_round)):
        sel = mesh.vertex_round == r
        per_round[r] = float(d[sel & interior].sum())
    return {
        "K_interior": float(d[interior].sum()),
        "boundary_turning": float(d[mesh.boundary].sum()),
        "total": float(d.sum()),
        "chi": chi, "gauss_bonnet": 2 * math.pi * chi,
        "per_round": per_round, "deficits": d, "mesh": mesh,
        "manifold": edge_manifold_ok(mesh),
    }


# ------------------------------------------------------------------------------------------
# (c) plots
# ------------------------------------------------------------------------------------------
def plot_curvature_per_round(ax, intrinsic: list[dict], extrinsic: dict | None = None, title: str = ""):
    rs = [row["round"] + 1 for row in intrinsic]
    ax.axhline(0, color="0.6", lw=0.8)
    ax.plot(rs, [row["K_annulus"] for row in intrinsic], "o-", label="intrinsic (rest lengths)")
    if extrinsic is not None:
        pr = extrinsic["per_round"]
        xs = [r + 1 for r in sorted(pr) if r >= 0]
        ax.plot(xs, [pr[r - 1] for r in xs], "s--", label="extrinsic (sim, angle deficit)")
    ax.set_xlabel("round")
    ax.set_ylabel("integrated Gaussian curvature per round")
    ax.set_title(title)
    ax.legend(fontsize=8)


def plot_surface(ax, res, color_by_round: bool = True, wire: bool = True, title: str = ""):
    """3D scatter + wireframe (course and wale springs) of a SimResult on a mplot3d axis."""
    net = res.network
    X = res.positions
    placed = ~np.isnan(X[:, 0])
    kinds = (0, 1)
    if wire:
        from matplotlib.collections import LineCollection  # noqa: F401
        segs = []
        for t in kinds:
            sel = (net.kind == t) & placed[net.i] & placed[net.j]
            segs.append(np.stack([X[net.i[sel]], X[net.j[sel]]], axis=1))
        from mpl_toolkits.mplot3d.art3d import Line3DCollection
        ax.add_collection3d(Line3DCollection(np.concatenate(segs), colors="0.55", linewidths=0.4))
    nn = net.n_nodes
    P = X[:nn][placed[:nn]]
    c = net.particle_round[:nn][placed[:nn]] if color_by_round else "C0"
    ax.scatter(P[:, 0], P[:, 1], P[:, 2], c=c, cmap="viridis", s=6, depthshade=False)
    lo, hi = np.nanmin(P, axis=0), np.nanmax(P, axis=0)
    mid, rad = (lo + hi) / 2, float(np.max(hi - lo)) / 2
    ax.set_xlim(mid[0] - rad, mid[0] + rad)
    ax.set_ylim(mid[1] - rad, mid[1] + rad)
    ax.set_zlim(mid[2] - rad, mid[2] + rad)
    ax.set_box_aspect((1, 1, 1))
    ax.set_title(title, fontsize=9)
    ax.set_axis_off()


def cross_section(res, metric: dict | None = None):
    """(r, z) of every real particle in the frame of the shape metric axis (for side views)."""
    from .metrics import classify_result

    m = metric or classify_result(res)
    net = res.network
    X = res.positions[: net.n_nodes]
    D = X - m["centroid"]
    z = D @ m["axis"]
    rad = np.linalg.norm(D - np.outer(z, m["axis"]), axis=1)
    return rad, z, net.particle_round[: net.n_nodes]


def plot_cross_section(ax, res, metric=None, title: str = ""):
    r, z, rr = cross_section(res, metric)
    ax.scatter(r, z, c=rr, s=5, cmap="viridis")
    ax.set_aspect("equal")
    ax.set_xlabel("distance from axis (mm)")
    ax.set_ylabel("height along axis (mm)")
    ax.set_title(title, fontsize=9)
