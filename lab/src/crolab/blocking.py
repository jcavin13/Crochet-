"""Blocked solve (`spec/physics.md` §6): same network, different boundary conditions.

All particles are constrained to the plane through the shape-metric centroid c normal to the
axis n; the nodes of the outermost round are pinned at `block_stretch` x their relaxed distance
from the axis (angles about the axis preserved); the rest relax in-plane (L-BFGS, 2 dof each).

Reported: mean and max |strain| of all springs (tension-only springs count only when stretched),
and the fraction of course springs compressed by more than `block_buckle_strain` (tension-only
chain springs excluded: a slack loop is not compressed fabric).
"""
from __future__ import annotations

import math

import numpy as np
from scipy.optimize import minimize

from .metrics import classify_result
from .params import load_sim_config
from .sim import SimResult, energy_and_grad, simulate


def align_pins(pins, cur) -> list[tuple[int, float, float]]:
    """Rigid 2D fit of pin targets [(node, x, y)] onto the current plane positions cur[node] (the
    TypeScript `alignPins`): reflect the targets when their winding in node order differs from the
    nodes' winding, then the best rotation + translation (no scaling)."""
    T = np.array([[x, y] for _, x, y in pins], float)
    P = np.array([cur[nd] for nd, _, _ in pins], float)
    tc, pc = T.mean(0), P.mean(0)
    order = np.argsort([nd for nd, _, _ in pins], kind="stable")
    To, Po = T[order] - tc, P[order] - pc
    wt = float(np.sum(To[:, 0] * np.roll(To[:, 1], -1) - To[:, 1] * np.roll(To[:, 0], -1)))
    wc = float(np.sum(Po[:, 0] * np.roll(Po[:, 1], -1) - Po[:, 1] * np.roll(Po[:, 0], -1)))
    refl = -1.0 if wt * wc < 0 else 1.0
    X, Y = T[:, 0] - tc[0], refl * (T[:, 1] - tc[1])
    a, b = P[:, 0] - pc[0], P[:, 1] - pc[1]
    A, B = float(np.sum(X * a + Y * b)), float(np.sum(X * b - Y * a))
    h = math.hypot(A, B) or 1.0
    co, si = A / h, B / h
    return [(nd, pc[0] + co * x - si * y, pc[1] + si * x + co * y) for (nd, _, _), x, y in zip(pins, X, Y)]


def block(res: SimResult, config: dict | None = None, gtol: float = 1e-8, pins=None) -> dict:
    """Blocked solve. Without `pins`: physics.md §6. With `pins` [(node, x, y)] (mm, any rigid
    frame): the plane is the PCA plane of the relaxed piece, the pin set is aligned to it
    (`align_pins`), the pinned nodes are fixed there and everything else relaxes in-plane; the
    result adds `pin_stretch` (largest stretch of course and wale springs per part: spines, slack
    chains, body)."""
    cfg = config or load_sim_config()
    net = res.network
    use_pins = pins is not None and len(pins) >= 2
    if use_pins:
        Xn = res.positions[: net.n_nodes]
        Xn = Xn[~np.isnan(Xn[:, 0])]
        c = Xn.mean(0)
        w, V = np.linalg.eigh(np.cov((Xn - c).T))
        n = V[:, 0]
    else:
        m = classify_result(res, cfg)
        c, n = m["centroid"], m["axis"]
    # orthonormal in-plane basis (deterministic)
    e = np.eye(3)[int(np.argmin(np.abs(n)))]
    u = np.cross(n, e)
    u /= np.linalg.norm(u)
    v = np.cross(n, u)
    X = res.positions
    P = np.stack([(X - c) @ u, (X - c) @ v], axis=1)       # projection to the plane
    last = max(int(r) for r in net.particle_round[: net.n_nodes])
    pinned = np.zeros(net.n_particles, bool)
    if use_pins:
        for nd, _, _ in pins:
            pinned[nd] = True
    else:
        pinned[: net.n_nodes] = net.particle_round[: net.n_nodes] == last
    # pinned targets: block_stretch * relaxed distance from the axis, angle preserved
    D = X - c
    radial = D - np.outer(D @ n, n)
    rdist = np.linalg.norm(radial, axis=1)
    ang = np.arctan2(P[:, 1], P[:, 0])
    s = cfg["block_stretch"]
    if use_pins:
        for nd, x, y in align_pins(pins, {nd: P[nd] for nd, _, _ in pins}):
            P[nd] = (x, y)
    else:
        P[pinned, 0] = s * rdist[pinned] * np.cos(ang[pinned])
        P[pinned, 1] = s * rdist[pinned] * np.sin(ang[pinned])
    free = ~pinned
    idx = np.nonzero(free)[0]
    N = net.n_particles
    kL = net.k / net.L

    def fun(x):
        Q = P.copy()
        Q[idx] = x.reshape(-1, 2)
        Y = np.zeros((N, 3))
        Y[:, :2] = Q
        E, g = energy_and_grad(Y.ravel(), net.i, net.j, net.L, kL, N, net.slack)
        return E, g.reshape(N, 3)[idx, :2].ravel()

    r = minimize(fun, P[idx].ravel(), jac=True, method="L-BFGS-B",
                 options={"maxiter": 50000, "gtol": gtol, "ftol": 1e-15, "maxfun": 100000})
    P[idx] = r.x.reshape(-1, 2)
    Y = c + np.outer(P[:, 0], u) + np.outer(P[:, 1], v)
    d = np.linalg.norm(Y[net.i] - Y[net.j], axis=1)
    strain = d / net.L - 1
    eff = np.where(net.slack & (strain < 0), 0.0, strain)
    course = (net.kind == 0) & ~net.slack
    thr = cfg["block_buckle_strain"]
    pin_stretch = None
    if use_pins:
        owner = {v: si for si, sp in enumerate(net.spines) for v in sp.pos}
        # N6 pointed loops count as arms; turning chains (N3) are left out (the TypeScript `block`)
        for li, pl in enumerate(net.pointed_loops):
            for v in pl.nodes:
                owner[v] = len(net.spines) + li
        g = net.graph

        def tch(i: int) -> bool:
            return i < net.n_nodes and g.nodes[i].get("role") == "tch" and not g.nodes[i].get("countsAs")
        pin_stretch = {"spines": 0.0, "chains": 0.0, "body": 0.0}
        for q in range(net.m):
            if strain[q] <= 0 or net.kind[q] not in (0, 1):
                continue
            a, b = int(net.i[q]), int(net.j[q])
            if tch(a) or tch(b):
                continue
            part = "spines" if a in owner and owner[a] == owner.get(b) else ("chains" if net.slack[q] else "body")
            pin_stretch[part] = max(pin_stretch[part], float(strain[q]))
    return {
        "pin_stretch": pin_stretch,
        "positions": Y, "plane_coords": P, "energy": float(r.fun), "converged": bool(r.success),
        "strain": strain,
        "mean_abs_strain": float(np.mean(np.abs(eff))), "max_abs_strain": float(np.max(np.abs(eff))),
        "max_compression": float(-np.min(eff)), "max_stretch": float(np.max(eff)),
        "buckle_fraction": float(np.mean(strain[course] < -thr)) if course.any() else 0.0,
        "pinned": pinned,
    }


def blocked(pattern: dict, params=None, config=None) -> tuple[SimResult, dict]:
    res = simulate(pattern, params=params, config=config)
    return res, block(res, config)
