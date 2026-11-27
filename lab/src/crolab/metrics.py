"""Shape metric and flat / cup / ruffle classifier (`spec/physics.md` §5)."""
from __future__ import annotations

import numpy as np

from .params import load_sim_config


def shape_metric(X: np.ndarray, node_rounds: np.ndarray, config: dict | None = None,
                 mask: np.ndarray | None = None, pca: bool = False) -> dict:
    """X: [n_nodes, 3] real-particle positions; node_rounds: round index per node.
    `mask` selects the particles that exist (default: non-NaN rows). `pca`: always use the PCA axis
    (pieces made in rows: their first and last rows lie side by side, SPEC_NOTES "Shape metric").
    Returns {class, A, W, Rg, outer_radius} (+ axis and centroid for plotting)."""
    cfg = config or load_sim_config()
    X = np.asarray(X, float)
    node_rounds = np.asarray(node_rounds)
    if mask is None:
        mask = ~np.isnan(X[:, 0])
    P = X[mask]
    rr = node_rounds[mask]
    c = P.mean(axis=0)
    D = P - c
    Rg = float(np.sqrt(np.mean(np.einsum("ij,ij->i", D, D))))
    rounds = sorted(set(int(r) for r in rr))
    first, last = rounds[0], rounds[-1]
    a = P[rr == last].mean(axis=0) - P[rr == first].mean(axis=0)
    na = float(np.linalg.norm(a))
    if not pca and Rg > 0 and na > cfg["axis_min"] * Rg:
        n = a / na
        axis_kind = "rounds"
    else:
        # direction of least variance; sign fixed so that the result is deterministic
        cov = D.T @ D / len(D)
        w, V = np.linalg.eigh(cov)
        n = V[:, 0]
        k = int(np.argmax(np.abs(n)))
        if n[k] < 0:
            n = -n
        axis_kind = "pca"
    z = D @ n
    zbar, sig = [], []
    for r in rounds:
        sel = rr == r
        if sel.sum() >= 3:
            zbar.append(float(z[sel].mean()))
            sig.append(float(z[sel].std()))
    if Rg <= 0 or not zbar:
        A = W = 0.0
    else:
        A = (max(zbar) - min(zbar)) / Rg
        W = max(sig) / Rg
    tau = cfg["tau_flat"]
    if A < tau and W < tau:
        cls = "flat"
    elif W > A:
        cls = "ruffle"
    else:
        cls = "cup"
    Ql = D[rr == last]
    radial = Ql - np.outer(Ql @ n, n)
    outer = float(np.mean(np.linalg.norm(radial, axis=1))) if len(Ql) else 0.0
    return {"class": cls, "A": float(A), "W": float(W), "Rg": Rg, "outer_radius": outer,
            "axis": n, "centroid": c, "axis_kind": axis_kind}


def classify_result(res, config: dict | None = None, upto: int | None = None) -> dict:
    """Metric of a SimResult (final) or of its snapshot `upto` (round index)."""
    net = res.network
    nr = net.particle_round[: net.n_nodes]
    X = res.positions if upto is None else res.snapshots[upto]
    return shape_metric(X[: net.n_nodes], nr, config, pca=uses_pca_axis(net.graph))


def uses_pca_axis(g) -> bool:
    """A piece made in rows has no axis its rounds march along: the PCA axis (the normal of a flat
    piece) instead of the round-centroid axis (TypeScript `usesPcaAxis`)."""
    return any(r["kind"] == "row" for r in g.rounds)


def public(m: dict) -> dict:
    return {k: m[k] for k in ("class", "A", "W", "Rg", "outer_radius")}
