"""Blocked solve (`spec/physics.md` §6): same network, different boundary conditions.

All particles are constrained to the plane through the shape-metric centroid c normal to the
axis n; the nodes of the outermost round are pinned at `block_stretch` x their relaxed distance
from the axis (angles about the axis preserved); the rest relax in-plane (L-BFGS, 2 dof each).

Reported: mean and max |strain| of all springs (tension-only springs count only when stretched),
and the fraction of course springs compressed by more than `block_buckle_strain` (tension-only
chain springs excluded: a slack loop is not compressed fabric).
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import minimize

from .metrics import classify_result
from .params import load_sim_config
from .sim import SimResult, energy_and_grad, simulate


def block(res: SimResult, config: dict | None = None, gtol: float = 1e-8) -> dict:
    cfg = config or load_sim_config()
    net = res.network
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
    pinned[: net.n_nodes] = net.particle_round[: net.n_nodes] == last
    # pinned targets: block_stretch * relaxed distance from the axis, angle preserved
    D = X - c
    radial = D - np.outer(D @ n, n)
    rdist = np.linalg.norm(radial, axis=1)
    ang = np.arctan2(P[:, 1], P[:, 0])
    s = cfg["block_stretch"]
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
    return {
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
