"""Shape per region of a piece with an outline (rows + border, polygons from the centre): body
flat / curling, each side flat / waves / puckers, each corner flat / cup / ruffle (SPEC_NOTES
"Per-region shape"). `app/src/core/sim/regions.ts` (`regionShape`) is a line-by-line port; see its
header for the definitions. physics.md §5's cup/ruffle metric assumes rounds round an axis; a
blanket has none, so `simulate()` keeps that metric (with the PCA axis for row pieces) and this
report says where a bordered piece is not flat.
"""
from __future__ import annotations

import math

import numpy as np

from .params import load_sim_config

REGION_TAU = {"body": 0.1, "wave": 0.3, "pull": 0.04, "lift": 0.3, "excess": 0.02}
RECT_SIDE_LABELS = ["Top edge", "Left side", "Bottom edge", "Right side"]
RECT_CORNER_LABELS = ["Top right", "Top left", "Bottom left", "Bottom right"]


def _mean(xs) -> float:
    return float(np.mean(np.asarray(xs, dtype=float)))


def _fit_frame(ps, qx, qy, X):
    if len(ps) < 3:
        return None
    mx, my = _mean([qx[p] for p in ps]), _mean([qy[p] for p in ps])
    c = np.array([_mean([X[p, d] for p in ps]) for d in range(3)])
    sxx = sxy = syy = 0.0
    cx, cy = np.zeros(3), np.zeros(3)
    for p in ps:
        ux, uy = qx[p] - mx, qy[p] - my
        sxx += ux * ux
        sxy += ux * uy
        syy += uy * uy
        for d in range(3):
            v = X[p, d] - c[d]
            cx[d] += v * ux
            cy[d] += v * uy
    det = sxx * syy - sxy * sxy
    if not det > 1e-9 * (sxx + syy) * (sxx + syy):
        return None
    m1 = np.array([(cx[d] * syy - cy[d] * sxy) / det for d in range(3)])
    m2 = np.array([(cy[d] * sxx - cx[d] * sxy) / det for d in range(3)])
    n1 = math.sqrt(m1[0] ** 2 + m1[1] ** 2 + m1[2] ** 2)
    if not n1 > 0:
        return None
    e1 = m1 / n1
    k = m2[0] * e1[0] + m2[1] * e1[1] + m2[2] * e1[2]
    u = m2 - k * e1
    n2 = math.sqrt(u[0] ** 2 + u[1] ** 2 + u[2] ** 2)
    if not n2 > 0:
        return None
    e2 = u / n2
    nrm = np.array([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]])
    return c, (mx, my), e1, e2, nrm


def _rms(xs) -> float:
    return math.sqrt(sum(v * v for v in xs) / len(xs)) if len(xs) else 0.0


def _detrend(t, xs):
    mt, mz = _mean(t), _mean(xs)
    stt = stz = 0.0
    for q, v in enumerate(t):
        stt += (v - mt) * (v - mt)
        stz += (v - mt) * (xs[q] - mz)
    b = stz / stt if stt > 0 else 0.0
    return [v - mz - b * (t[q] - mt) for q, v in enumerate(xs)]


def region_shape(net, X, config: dict | None = None) -> dict | None:
    """Per-region shape of the relaxed positions X ([n_particles, 3]) of a network with an outline,
    or None. Returns {kind, body: {class, curl}, sides: [...], corners: [...], overall}."""
    o = net.outline
    if o is None:
        return None
    cfg = config or load_sim_config()
    tol = cfg.get("flatness", {}).get("tol", 0.1)
    X = np.asarray(X, float)
    n = net.n_nodes
    g = net.graph

    def ok(i):
        return o.has[i] == 1 and o.c[i] > 0 and math.isfinite(X[i, 0])

    def counting(i):
        nd = g.nodes[i]
        return bool(nd.get("countsAs")) or (nd.get("role") != "tch" and nd["type"] not in ("ch", "slst", "picot"))
    rounds = sorted(o.courses)
    last_r = rounds[-1] if rounds else math.inf
    prow = net.particle_round
    body = [i for i in range(n) if ok(i) and (o.region[i] == 1 if o.body is not None else prow[i] < last_r)]
    F = _fit_frame(body, o.qx, o.qy, X)
    if F is None:
        return None
    c, q0, e1, e2, nrm = F

    def z(i):
        return (X[i, 0] - c[0]) * nrm[0] + (X[i, 1] - c[1]) * nrm[1] + (X[i, 2] - c[2]) * nrm[2]

    def in_plane(i):
        d = X[i] - c
        return (d[0] * e1[0] + d[1] * e1[1] + d[2] * e1[2], d[0] * e2[0] + d[1] * e2[1] + d[2] * e2[2])
    rg = math.sqrt(_mean([(o.qx[i] - q0[0]) ** 2 + (o.qy[i] - q0[1]) ** 2 for i in body]))
    curl = _rms([z(i) for i in body]) / rg if rg > 0 else 0.0
    body_cls = "curling" if curl > REGION_TAU["body"] else "flat"
    sides, corners = [], []
    kind = "rows" if o.body is not None else "polygon"
    K = o.K
    if rounds and K >= 3:
        last = o.courses[rounds[-1]]
        outer = [i for i in last.order if ok(i)]
        wbar = _mean([o.c[i] for i in outer if o.c[i] > 0])
        B = sum(o.courses[r].h for r in rounds)

        def d3(a, b):
            return math.sqrt((X[b, 0] - X[a, 0]) ** 2 + (X[b, 1] - X[a, 1]) ** 2 + (X[b, 2] - X[a, 2]) ** 2)

        def d2(a, b):
            return math.sqrt((o.qx[b] - o.qx[a]) ** 2 + (o.qy[b] - o.qy[a]) ** 2)

        def along(ns):
            path = ref = 0.0
            for k in range(1, len(ns)):
                if ns[k] == ns[k - 1] + 1:
                    path += d3(ns[k - 1], ns[k])
                    ref += d2(ns[k - 1], ns[k])
            return path, ref
        side_z = {}
        for q in range(K):
            excess = 0.0
            for r in rounds:
                ns = [i for i in o.courses[r].order if ok(i) and counting(i) and o.region[i] == 2 and o.region_index[i] == q]
                path, ref = along(ns)
                x = path / ref - 1 if ref > 0 else 0.0
                if abs(x) > abs(excess):
                    excess = x
            sn = [i for i in outer if o.region[i] == 2 and o.region_index[i] == q]
            if len(sn) < 2:
                continue
            t = [0.0]
            for k in range(1, len(sn)):
                t.append(t[k - 1] + d2(sn[k - 1], sn[k]))
            zs = [z(i) for i in sn]
            side_z[q] = _mean(zs)
            wave = _rms(_detrend(t, zs)) / wbar
            a, b = sn[0], sn[-1]
            pa, pb = in_plane(a), in_plane(b)
            ref = d2(a, b)
            pull = 1 - math.sqrt((pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2) / ref if ref > 0 else 0.0
            if excess > REGION_TAU["excess"] and wave > REGION_TAU["wave"]:
                cls = "waves"
            elif excess < -REGION_TAU["excess"] and (pull > REGION_TAU["pull"] or wave > REGION_TAU["wave"]):
                cls = "puckers"
            else:
                cls = "flat"
            sides.append({"index": q, "label": RECT_SIDE_LABELS[q] if kind == "rows" and K == 4 else f"Side {q + 1}",
                          "class": cls, "wave": wave, "pull": pull, "excess": excess, "nodes": len(sn)})
        for q in range(K):
            E = grown = 0.0
            cn_last: list = []
            for r in rounds:
                C = o.courses[r]
                ordl = [i for i in C.order if ok(i) and counting(i)]
                idx = [k for k, i in enumerate(ordl) if o.region[i] == 3 and o.region_index[i] == q]
                if not idx:
                    continue
                m = len(ordl)
                run = [ordl[(idx[0] + m - 1) % m]] + [ordl[k] for k in idx] + [ordl[(idx[-1] + 1) % m]]
                path, ref = along(run)
                E += path - ref
                tp, tn = C.poly.t[(q + K - 1) % K], C.poly.t[q]
                cr = abs(tp[0] * tn[1] - tp[1] * tn[0])
                dt = tp[0] * tn[0] + tp[1] * tn[1]
                grown += 2 * C.h * cr / (1 + dt) if 1 + dt > 1e-12 else 0.0
                if r == rounds[-1]:
                    cn_last = [ordl[k] for k in idx]
            if not cn_last:
                continue
            per_corner = E / wbar
            tol_st = max(1.0, tol * grown / wbar)
            zs = [z(i) for i in cn_last]
            mz = _mean(zs)
            nb = [side_z[x] for x in (q, (q + K - 1) % K) if x in side_z]
            lift = abs(mz - (_mean(nb) if nb else 0.0)) / B if B > 0 else 0.0
            wave = _rms([v - mz for v in zs]) / wbar
            if per_corner < -tol_st and lift > REGION_TAU["lift"]:
                cls = "cup"
            elif per_corner > tol_st and (wave > REGION_TAU["wave"] or lift > REGION_TAU["lift"]):
                cls = "ruffle"
            else:
                cls = "flat"
            corners.append({"index": q, "label": RECT_CORNER_LABELS[q] if kind == "rows" and K == 4 else f"Corner {q + 1}",
                            "class": cls, "lift": lift, "wave": wave, "perCorner": per_corner, "nodes": len(cn_last)})
    overall = "flat" if body_cls == "flat" and all(s["class"] == "flat" for s in sides) and all(c_["class"] == "flat" for c_ in corners) else "not flat"
    return {"kind": kind, "body": {"class": body_cls, "curl": curl}, "sides": sides, "corners": corners, "overall": overall}
