"""Planar reference layouts for pieces with corners (SPEC_NOTES.md N8-N10, P9): rows, the border
rounds worked around them (notation.md 3.9), and polygons worked from the centre with their
increases at the corners. `app/src/core/sim/outline.ts` is a line-by-line port of this module; see
its header (and SPEC_NOTES) for the rules. Only pieces with rows, `part` anchors or a run of polygon
rounds get a layout: every canonical fixture, snowflake and corpus doily has none (`build_outline`
returns None), so their networks are unchanged.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .borders import anchor_key, border_lists, entry_key
from .graph import Graph

POLY_MIN_RUN = 2


def _mod(x: float, P: float) -> float:
    return x - P * math.floor(x / P)


def _wrapc(x: float, P: float) -> float:
    return x - P * math.floor(x / P + 0.5)


@dataclass
class Poly:
    V: list
    L: list
    cum: list
    P: float
    t: list
    n: list


def make_poly(V: list) -> Poly:
    K = len(V)
    A2 = 0.0
    for j in range(K):
        a, b = V[j], V[(j + 1) % K]
        A2 += a[0] * b[1] - a[1] * b[0]
    L, cum, t, nn = [], [], [], []
    s = 0.0
    for j in range(K):
        a, b = V[j], V[(j + 1) % K]
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.sqrt(dx * dx + dy * dy)
        L.append(ln)
        cum.append(s)
        s += ln
        tj = (dx / ln, dy / ln) if ln > 0 else (1.0, 0.0)
        t.append(tj)
        nn.append((tj[1], -tj[0]) if A2 > 0 else (-tj[1], tj[0]))
    return Poly(V, L, cum, s, t, nn)


def _norm(poly: Poly, S: float) -> float:
    s = _mod(S, poly.P)
    if not s < poly.P:
        s = 0.0
    if s < 0:
        s = 0.0
    return s


def _edge_at(poly: Poly, S: float) -> int:
    s = _norm(poly, S)
    j = len(poly.V) - 1
    for q in range(len(poly.V)):
        if s < poly.cum[q] + poly.L[q]:
            j = q
            break
    return j


def point_at(poly: Poly, S: float) -> tuple[float, float]:
    s = _norm(poly, S)
    j = _edge_at(poly, s)
    u = min(max(s - poly.cum[j], 0.0), poly.L[j])
    return (poly.V[j][0] + poly.t[j][0] * u, poly.V[j][1] + poly.t[j][1] * u)


def _normal_at(poly: Poly, S: float):
    return poly.n[_edge_at(poly, S)]


def locate(poly: Poly, p) -> float:
    best, S = math.inf, 0.0
    for j in range(len(poly.V)):
        v = poly.V[j]
        u = (p[0] - v[0]) * poly.t[j][0] + (p[1] - v[1]) * poly.t[j][1]
        u = min(max(u, 0.0), poly.L[j])
        d = math.sqrt((p[0] - v[0] - poly.t[j][0] * u) ** 2 + (p[1] - v[1] - poly.t[j][1] * u) ** 2)
        if d < best - 1e-12:
            best, S = d, poly.cum[j] + u
    return S


def _extensions(poly: Poly, h: float) -> list:
    K = len(poly.V)
    e = []
    for j in range(K):
        a, b = poly.t[(j + K - 1) % K], poly.t[j]
        cr = abs(a[0] * b[1] - a[1] * b[0])
        dt = a[0] * b[0] + a[1] * b[1]
        e.append(h * cr / (1 + dt) if 1 + dt > 1e-12 else 0.0)
    return e


def offset_poly(poly: Poly, h: float):
    K = len(poly.V)
    V = []
    for j in range(K):
        a, b = poly.n[(j + K - 1) % K], poly.n[j]
        d = 1 + a[0] * b[0] + a[1] * b[1]
        V.append((poly.V[j][0] + h * (a[0] + b[0]) / d, poly.V[j][1] + h * (a[1] + b[1]) / d))
    return make_poly(V), _extensions(poly, h)


def _project(old: Poly, neu: Poly, e: list, S: float, end: bool) -> float:
    K = len(old.V)
    s = _norm(old, S)
    j = _edge_at(old, s)
    u = s - old.cum[j]
    if end and u < 1e-9 * max(1.0, old.P):
        j = (j + K - 1) % K
        u = old.L[j]
    return neu.cum[j] + e[j] + u


def _counts(g: Graph, i: int) -> bool:
    return g.counts_as_stitch(i)


def _round_ids(g: Graph, r: int) -> list[int]:
    return g.round_nodes(r)


def _cyclic_arc(pos: list[int], m: int) -> tuple[int, int]:
    if len(pos) == 1:
        return pos[0], pos[0]
    gap_at, gap = len(pos) - 1, pos[0] + m - pos[-1]
    for q in range(len(pos) - 1):
        d = pos[q + 1] - pos[q]
        if d > gap:
            gap, gap_at = d, q
    return pos[(gap_at + 1) % len(pos)], pos[gap_at]


def _entry_share(g: Graph, key: str, sh: dict, P: float):
    if key.startswith("s"):
        xs = [sh[ch] for ch in g.spaces[int(key[1:])]["chains"] if ch in sh]
        if not xs:
            return None
        ref = xs[0][0]
        lo, hi = ref, xs[0][1]
        for x in xs[1:]:
            a = ref + _wrapc(x[0] - ref, P)
            lo = min(lo, a)
            hi = max(hi, a + (x[1] - x[0]))
        return (lo, hi)
    return sh.get(int(key[1:].split(":")[0]))


@dataclass
class OutlineCourse:
    round: int
    kind: str
    poly: Poly
    dir: int
    h: float
    corners: list
    order: list
    segments: list


@dataclass
class Outline:
    qx: np.ndarray
    qy: np.ndarray
    has: np.ndarray
    c: np.ndarray
    S: np.ndarray
    round_kind: list
    courses: dict = field(default_factory=dict)
    region: np.ndarray = None
    region_index: np.ndarray = None
    body: Poly | None = None
    base: Poly | None = None
    K: int = 0
    span: list = field(default_factory=list)
    col_scale: np.ndarray = None
    lam: np.ndarray = None


def build_outline(g: Graph, w_eff, w, h, chain_nominal: float, tol: float) -> Outline | None:
    out = _build_layout(g, w_eff, w, h, chain_nominal, tol)
    if out is not None:
        _tch_columns(g, out, w, h)
    return out


def _tch_columns(g: Graph, out: Outline, w, h) -> None:
    n = g.n
    for i in range(n):
        nd = g.nodes[i]
        k = out.round_kind[nd["round"]]
        if nd["type"] != "slst" or out.has[i] or k not in ("border", "polygon") or len(nd["into"]) != 1:
            continue
        a = nd["into"][0]
        if "node" not in a or a.get("part") or not out.has[a["node"]] or g.nodes[a["node"]]["round"] != nd["round"]:
            continue
        p = a["node"]
        ux = uy = 0.0
        if i > 0 and out.has[i - 1]:
            dx, dy = out.qx[i - 1] - out.qx[p], out.qy[i - 1] - out.qy[p]
            dd = math.sqrt(dx * dx + dy * dy)
            if dd > 0:
                f = min(float(h[i]), dd) / dd
                ux, uy = f * dx, f * dy
        out.qx[i] = out.qx[p] + ux
        out.qy[i] = out.qy[p] + uy
        out.has[i] = 1

    def tch(i):
        nd = g.nodes[i]
        return nd["type"] == "ch" and nd.get("role") == "tch" and not nd.get("countsAs")
    i = 0
    while i < n:
        if not tch(i):
            i += 1
            continue
        j = i
        while j + 1 < n and tch(j + 1):
            j += 1
        a, b = i - 1, j + 1
        if (a >= 0 and b < n and out.has[a] and out.has[b] and not out.has[i]
                and g.nodes[a]["round"] <= g.nodes[b]["round"] <= g.nodes[a]["round"] + 1):
            D = math.sqrt((out.qx[b] - out.qx[a]) ** 2 + (out.qy[b] - out.qy[a]) ** 2)
            S = 0.0
            for q in range(a, b):
                S += 0.5 * (w[q] + w[q + 1])
            if S > 0:
                f = D / S
                cum = 0.0
                for q in range(i, j + 1):
                    cum += 0.5 * (w[q - 1] + w[q])
                    t = cum / S
                    out.qx[q] = out.qx[a] + t * (out.qx[b] - out.qx[a])
                    out.qy[q] = out.qy[a] + t * (out.qy[b] - out.qy[a])
                    out.has[q] = 1
                    out.col_scale[q] = f
                    out.region[q] = 1 if (out.region[a] == 1 or out.region[b] == 1) else 0
        i = j + 1


def _build_layout(g: Graph, w_eff, w, h, chain_nominal: float, tol: float) -> Outline | None:
    n, nR = g.n, len(g.rounds)
    out = Outline(qx=np.full(n, np.nan), qy=np.full(n, np.nan), has=np.zeros(n, np.uint8), c=np.zeros(n),
                  S=np.full(n, np.nan), round_kind=[None] * nR, region=np.zeros(n, np.uint8),
                  region_index=np.full(n, -1, np.int16), col_scale=np.zeros(n), lam=np.ones(n))
    chsp = {}
    for s in g.spaces:
        if s["kind"] == "chsp":
            for ch in s["chains"]:
                chsp[ch] = s["round"]
    for i in range(n):
        if _counts(g, i):
            out.c[i] = w_eff[i]
        elif chsp.get(i) == g.nodes[i]["round"]:
            out.c[i] = chain_nominal * w[i]

    def setq(i, x, y):
        out.qx[i], out.qy[i], out.has[i] = x, y, 1

    def hbar(r):
        st = [i for i in _round_ids(g, r) if _counts(g, i)]
        return float(np.mean([float(h[i]) for i in st])) if st else 0.0

    acc: dict = {}
    # ---------------- rows (N8) ----------------
    row_piece = nR >= 2 and g.rounds[0]["kind"] == "foundation" and g.rounds[1]["kind"] == "row"
    if row_piece:
        last = 1
        while last + 1 < nR and g.rounds[last + 1]["kind"] == "row":
            last += 1
        worked = []
        for i in _round_ids(g, 1):
            nd = g.nodes[i]
            if nd["type"] == "ch" and not nd.get("countsAs"):
                continue
            for a in nd["into"]:
                if ("node" in a and not a.get("part") and g.nodes[a["node"]]["round"] == 0
                        and g.nodes[a["node"]]["type"] == "ch" and not g.nodes[a["node"]].get("countsAs")):
                    worked.append(a["node"])
        if not worked:
            return None
        # a chain space in a row sits over the stitches it skips: each of its chains takes the
        # row's mean stitch width (the blanket library's convention)
        for r in range(1, last + 1):
            ids = _round_ids(g, r)
            st = [i for i in ids if _counts(g, i)]
            if not st:
                continue
            wr = float(np.mean([float(w_eff[i]) for i in st]))
            for i in ids:
                if not _counts(g, i) and chsp.get(i) == r:
                    out.c[i] = wr
        lo, hi = min(worked), max(worked)
        span = [i for i in range(lo, hi + 1) if g.nodes[i]["type"] == "ch"]
        C1 = 0.0
        for i in _round_ids(g, 1):
            C1 += out.c[i]
        if not C1 > 0:
            return None
        cs = C1 / len(span)
        for k, i in enumerate(span):
            out.c[i] = cs
            setq(i, cs * (k + 0.5), 0.0)
        out.span = span
        out.round_kind[0] = "foundation"
        course = set(span)
        f, ybase = 1.0, 0.0
        for r in range(1, last + 1):
            ids = _round_ids(g, r)
            s = {}
            cum = 0.0
            for i in ids:
                s[i] = cum + 0.5 * out.c[i]
                cum += out.c[i]
            pairs = []
            for i in ids:
                if not _counts(g, i):
                    continue
                seen = set()
                for a in g.nodes[i]["into"]:
                    if "node" in a and not a.get("part") and a["node"] in course and a["node"] not in seen:
                        seen.add(a["node"])
                        pairs.append((i, a["node"]))
            if not pairs:
                return None
            tot, prev_a = 0, None
            for i in ids:
                if not _counts(g, i):
                    continue
                a0 = next((a for a in g.nodes[i]["into"] if "node" in a and not a.get("part") and a["node"] in course), None)
                if a0 is None:
                    continue
                if prev_a is not None and prev_a != a0["node"]:
                    tot += 1 if a0["node"] > prev_a else -1
                prev_a = a0["node"]
            f = f * (-1.0 if tot < 0 else 1.0)
            x0 = float(np.mean([out.qx[p] - f * s[i] for i, p in pairs]))
            hb = hbar(r)
            for i in ids:
                if not out.c[i] > 0:
                    continue
                setq(i, x0 + f * s[i], ybase + (float(h[i]) if _counts(g, i) else hb))
                out.region[i] = 1
            out.round_kind[r] = "row"
            ybase += hb
            course = {i for i in ids if out.c[i] > 0}
        for i in span:
            out.region[i] = 1
        xL, xR = math.inf, -math.inf
        for i in range(n):
            if out.has[i]:
                xL = min(xL, out.qx[i] - 0.5 * out.c[i])
                xR = max(xR, out.qx[i] + 0.5 * out.c[i])
        lists = border_lists(g)
        lst = lists.get(last + 1)
        if not lst or last + 1 >= nR or g.rounds[last + 1]["kind"] != "round":
            return out
        corners_e = [e for e in lst if e.get("corner")]
        if len(corners_e) != 4:
            return out
        V = []
        for e in corners_e:
            i = e["node"]
            y = 0.0 if e["kind"] == "base" else ybase
            V.append((xL if abs(out.qx[i] - xL) <= abs(out.qx[i] - xR) else xR, y))
        if len(set(V)) != 4 or not xR > xL or not ybase > 0:
            return out
        O0 = make_poly(V)
        out.body = O0
        shares = {}
        for e in corners_e:
            i = e["node"]
            y = 0.0 if e["kind"] == "base" else ybase
            a = locate(O0, (out.qx[i] - 0.5 * out.c[i], y))
            b = locate(O0, (out.qx[i] + 0.5 * out.c[i], y))
            lo2, hi2 = a, a + _wrapc(b - a, O0.P)
            shares[i] = (min(lo2, hi2), max(lo2, hi2))
        prev = O0
        r0 = last + 1
        K = 4
        corner_keys = {r0: [entry_key(e) for e in corners_e]}
        r = r0 + 1
        while r < nR and r in lists:
            corner_keys[r] = [entry_key(e) for e in lists[r] if e.get("corner")]
            r += 1
        r = r0
        while r < nR and r in corner_keys:
            res = _outline_round(g, out, r, "border", corner_keys[r], prev, shares, K, h, hbar(r), tol, acc)
            if res is None:
                break
            prev, shares = res
            r += 1
        out.K = K
        return out

    # ---------------- polygons from the centre (N10) ----------------
    runs = polygon_runs(g, out.c, h)
    if runs is None:
        return None
    first, last_r, nc, corners = runs
    base = first - 1
    ids = _round_ids(g, base)
    s = {}
    C = 0.0
    for i in ids:
        s[i] = C + 0.5 * out.c[i]
        C += out.c[i]
    if not C > 0:
        return None
    keys0 = corners[first]

    def centre(key):
        if key.startswith("s"):
            ch = g.spaces[int(key[1:])]["chains"]
            return 0.5 * (s[ch[0]] - 0.5 * out.c[ch[0]] + s[ch[-1]] + 0.5 * out.c[ch[-1]])
        return s[int(key[1:])]
    cs0 = [centre(k) for k in keys0]
    Rc = C / (2 * nc * math.sin(math.pi / nc))
    V = []
    for j in range(nc):
        th = 2 * math.pi * j / nc
        V.append((Rc * math.cos(th), Rc * math.sin(th)))
    O = make_poly(V)
    out.base = O
    side = O.P / nc

    def map_base(x):
        xm = _mod(x - cs0[0], C)
        for q in range(nc):
            a = _mod(cs0[q] - cs0[0], C)
            b = _mod(cs0[q + 1] - cs0[0], C) if q + 1 < nc else C
            if xm >= a and (xm < b or q == nc - 1):
                return _mod(O.cum[q] + (xm - a) / max(b - a, 1e-12) * side, O.P)
        return 0.0
    shares = {}
    for i in ids:
        if not out.c[i] > 0:
            continue
        Si = map_base(s[i])
        a = map_base(s[i] - 0.5 * out.c[i])
        b = map_base(s[i] + 0.5 * out.c[i])
        lo2, hi2 = Si + _wrapc(a - Si, O.P), Si + _wrapc(b - Si, O.P)
        shares[i] = (min(lo2, hi2), max(lo2, hi2))
        p = point_at(O, Si)
        setq(i, p[0], p[1])
        out.S[i] = _norm(O, Si)
        out.region[i] = 1
    out.round_kind[base] = "polybase"
    for r in range(base):
        for i in _round_ids(g, r):
            out.region[i] = 1
    prev = O
    for r in range(first, last_r + 1):
        res = _outline_round(g, out, r, "polygon", corners[r], prev, shares, nc, h, hbar(r), tol, acc)
        if res is None:
            break
        prev, shares = res
    if not out.courses:
        return None
    out.K = nc
    return out


def _outline_round(g: Graph, out: Outline, r: int, kind: str, keys: list, prev: Poly, shares: dict, K: int,
                   h, hb: float, tol: float, acc: dict):
    if len(keys) != K or not hb > 0:
        return None
    ids = _round_ids(g, r)
    m = len(ids)
    if not m:
        return None
    sh = []
    for k in keys:
        x = _entry_share(g, k, shares, prev.P)
        if x is None:
            return None
        sh.append(x)
    vtx = []
    for lo, hi in sh:
        mid = 0.5 * (lo + hi)
        best, bd = 0, math.inf
        for j in range(K):
            d = abs(_wrapc(mid - prev.cum[j], prev.P))
            if d < bd - 1e-12:
                bd, best = d, j
        vtx.append(best)
    d = -1 if K >= 2 and vtx[1] == (vtx[0] + K - 1) % K else 1
    for q in range(K):
        if vtx[(q + 1) % K] != (vtx[q] + d) % K:
            return None
    groups = []
    for k in keys:
        ps = [q for q, i in enumerate(ids) if any(anchor_key(a) == k for a in g.nodes[i]["into"])]
        if not ps:
            return None
        groups.append(_cyclic_arc(ps, m))
    start = groups[0][0]
    G = [((a - start) % m, (b - start) % m) for a, b in groups]
    for q in range(K):
        if G[q][1] < G[q][0]:
            return None
        if q + 1 < K and G[q + 1][0] <= G[q][1]:
            return None
    order = [ids[(start + k) % m] for k in range(m)]
    cum_at = [0.0]
    for i in order:
        cum_at.append(cum_at[-1] + out.c[i])
    C = cum_at[m]
    if not C > 0:
        return None
    poly, e = offset_poly(prev, hb)
    P = poly.P
    secA, secB = [], []
    for q in range(K):
        v = vtx[q]
        cv = poly.cum[v]
        a = cv + _wrapc(_project(prev, poly, e, sh[q][0], False) - cv, P)
        b = cv + _wrapc(_project(prev, poly, e, sh[q][1], True) - cv, P)
        secA.append(min(cv - e[v], a, b))
        secB.append(max(cv + e[v], a, b))
    k_in = {i: k for k, i in enumerate(order)}
    core = []
    for q in range(K):
        g0, g1 = cum_at[G[q][0]], cum_at[G[q][1] + 1]
        lo, hi = order[G[q][0]], order[G[q][1]]
        inside = [sp for sp in g.spaces if sp["kind"] == "chsp" and sp["round"] == r and sp["chains"]
                  and sp["chains"][0] in k_in and k_in[sp["chains"][0]] > k_in[lo] and k_in[sp["chains"][-1]] < k_in[hi]]
        need = secB[q] - secA[q]
        if inside and g1 - g0 > need:
            sp = inside[(len(inside) - 1) // 2]
            k0, k1 = k_in[sp["chains"][0]], k_in[sp["chains"][-1]]
            cen = 0.5 * (cum_at[k0] + cum_at[k1 + 1])
            c0 = min(max(cen - 0.5 * need, g0), g1 - need)
            core.append((c0, c0 + need))
        else:
            core.append((g0, g1))
    segs = []
    total = 0.0
    base0 = core[0][0]
    for q in range(K):
        cl = secB[q] - secA[q]
        segs.append({"s0": core[q][0], "s1": core[q][1], "len": cl, "region": 3, "index": vtx[q]})
        nq = (q + 1) % K
        sl = _mod(secA[nq] - secB[q], P) if d > 0 else _mod(secA[q] - secB[nq], P)
        s1 = core[nq][0] if q + 1 < K else base0 + C
        if s1 < core[q][1] - 1e-9:
            return None
        segs.append({"s0": core[q][1], "s1": s1, "len": sl, "region": 2, "index": vtx[q] if d > 0 else vtx[nq]})
        total += cl + sl
    if abs(total - P) > 1e-6 * P:
        return None
    T0 = secA[0] if d > 0 else secB[0]
    seg_start = []
    T = T0
    for sg in segs:
        seg_start.append(T)
        T += d * sg["len"]

    def seg_idx(x0):
        x = x0 + C if x0 < base0 - 1e-12 else x0
        for q, sg in enumerate(segs):
            if x < sg["s1"] - 1e-12:
                return q
        return len(segs) - 1

    def map_s(x0, q=None):
        if q is None:
            q = seg_idx(x0)
        x = x0 + C if x0 < base0 - 1e-12 else x0
        sg = segs[q]
        f = (x - sg["s0"]) / (sg["s1"] - sg["s0"]) if sg["s1"] > sg["s0"] else 0.5
        return seg_start[q] + d * f * sg["len"]

    seg_lam = []
    for sg in segs:
        own = sg["s1"] - sg["s0"]
        key = f"{sg['region']}:{sg['index']}"
        st = acc.get(key) or {"A": 0.0, "B": 0.0, "R": 0.0}
        st["A"] += own - sg["len"]
        st["B"] += tol * own
        Rn = math.copysign(1.0, st["A"]) * max(0.0, abs(st["A"]) - st["B"]) if st["A"] != 0 else 0.0
        eff = sg["len"] + Rn - st["R"]
        st["R"] = Rn
        acc[key] = st
        seg_lam.append(min(2.0, max(0.5, eff / own)) if own > 0 else 1.0)
    new_shares = {}
    for k, i in enumerate(order):
        if not out.c[i] > 0:
            continue
        sc = 0.5 * (cum_at[k] + cum_at[k + 1])
        qs = seg_idx(sc)
        Si = map_s(sc, qs)
        a, b = map_s(cum_at[k]), map_s(cum_at[k + 1] - 1e-9 * C)
        new_shares[i] = (min(a, b), max(a, b))
        p, nn = point_at(poly, Si), _normal_at(poly, Si)
        dh = float(h[i]) - hb if _counts(g, i) else 0.0
        out.qx[i], out.qy[i], out.has[i] = p[0] + dh * nn[0], p[1] + dh * nn[1], 1
        out.S[i] = _norm(poly, Si)
        out.region[i] = segs[qs]["region"]
        out.region_index[i] = segs[qs]["index"]
        out.lam[i] = seg_lam[qs]
    out.round_kind[r] = kind
    k0 = 0
    while k0 < m and 0.5 * (cum_at[k0] + cum_at[k0 + 1]) < base0 - 1e-12:
        k0 += 1
    order2 = order[k0:] + order[:k0]
    out.courses[r] = OutlineCourse(
        round=r, kind=kind, poly=poly, dir=d, h=hb, order=order2,
        segments=[{"region": sg["region"], "index": sg["index"], "own": sg["s1"] - sg["s0"], "len": sg["len"]} for sg in segs],
        corners=[{"key": key, "vertex": vtx[q], "nodes": order[G[q][0]:G[q][1] + 1]} for q, key in enumerate(keys)])
    return poly, new_shares


# ------------------------------------------------------------------------------------------
# polygon detection (N10): a port of app/src/core/flatness/corners.ts (`cornerGroups`,
# `detectPolygon`, `detectStadium`) — the one corner detector the chart and the corner rule use —
# plus the sim's carry rule and run (TypeScript `polygonRuns`)
# ------------------------------------------------------------------------------------------
def _sole_anchor(n: dict):
    if not n["into"]:
        return None
    k = anchor_key(n["into"][0])
    for a in n["into"]:
        if anchor_key(a) != k:
            return None
    return n["into"][0]


def _node_counts(n: dict) -> bool:
    from .borders import node_counts
    return node_counts(n)


def _groups_of(g: Graph, k: int):
    R = g.rounds[k] if 0 <= k < len(g.rounds) else None
    if R is None or R["first"] < 0:
        return []
    by: dict = {}
    order: list = []
    for i in range(R["first"], R["last"] + 1):
        n = g.nodes[i]
        if not _node_counts(n) or n["type"] in ("slst", "ch"):
            continue
        a = _sole_anchor(n)
        if a is None:
            continue
        if "space" in a:
            if g.spaces[a["space"]]["kind"] == "ring":
                continue
        elif g.nodes[a["node"]]["round"] == k:
            continue
        key = anchor_key(a)
        if key not in by:
            by[key] = []
            order.append(key)
        by[key].append(i)
    spaces = [s for s in g.spaces if s["round"] == k and s["kind"] == "chsp" and s["chains"]]
    out = []
    for key in order:
        ids = by[key]
        lo, hi = ids[0], ids[-1]
        inside = len(ids) >= 2 and any(s["chains"][0] > lo and s["chains"][-1] < hi for s in spaces)
        out.append((key, ids, inside))
    return out


def corner_groups(g: Graph, k: int) -> list:
    gs = _groups_of(g, k)
    A = [x for x in gs if x[2]]
    if A:
        return [x[1] for x in A]
    mx = max((len(x[1]) for x in gs), default=0)
    if mx < 3:
        return []
    return [x[1] for x in gs if len(x[1]) == mx]


def _even_with_sides(g: Graph, k: int, groups: list) -> bool:
    n = len(groups)
    R = g.rounds[k]
    counting = [i for i in range(R["first"], R["last"] + 1)
                if _node_counts(g.nodes[i]) and g.nodes[i]["type"] not in ("slst", "ch")]
    total = len(counting)
    if not total:
        return False
    in_group = {i for ids in groups for i in ids}
    if total - len(in_group) < n:
        return False
    at = {i: q for q, i in enumerate(counting)}
    mid = sorted((at.get(ids[0], 0) + at.get(ids[-1], 0)) / 2 for ids in groups)
    want = total / n
    for j in range(n):
        gap = mid[j + 1] - mid[j] if j + 1 < n else mid[0] + total - mid[n - 1]
        if abs(gap - want) > max(1.5, 0.3 * want):
            return False
    return True


def detect_stadium(g: Graph) -> bool:
    if len(g.rounds) < 2:
        return False
    R0, R1 = g.rounds[0], g.rounds[1]
    if R0["first"] < 0 or R1["first"] < 0:
        return False
    if any(r["kind"] == "row" for r in g.rounds):
        return False
    if any(g.nodes[i]["type"] != "ch" for i in range(R0["first"], R0["last"] + 1)):
        return False
    if any(s["kind"] == "ring" for s in g.spaces):
        return False
    for i in range(R1["first"], R1["last"] + 1):
        for a in g.nodes[i]["into"]:
            if "node" in a and a.get("part") == "base" and g.nodes[a["node"]]["round"] == 0:
                return True
    return False


def detect_polygon(g: Graph):
    """(n, from, groups) of a polygon worked from the centre, or None (corners.ts `detectPolygon`)."""
    rounds = g.rounds
    if len(rounds) < 3 or any(r["kind"] == "row" for r in rounds):
        return None
    if detect_stadium(g):
        return None
    per = []
    for k, R in enumerate(rounds):
        if k == 0 or R["first"] < 0 or R["kind"] != "round":
            per.append(None)
            continue
        cg = corner_groups(g, k)
        per.append(cg if 3 <= len(cg) <= 8 and _even_with_sides(g, k, cg) else None)
    last = len(rounds) - 1
    n = len(per[last]) if per[last] else 0
    if not n:
        return None
    ks = [k for k, c in enumerate(per) if c and len(c) == n]
    if len(ks) < 2:
        return None
    frm = ks[0]
    span = last - frm + 1
    if len(ks) < 0.6 * span:
        return None
    for k in range(frm, last):
        if k not in ks and k + 1 not in ks:
            return None

    def all_corners(k):
        return k >= 1 and rounds[k]["kind"] == "round" and len(corner_groups(g, k)) == n
    while frm - 1 >= 1 and all_corners(frm - 1):
        frm -= 1
        ks.insert(0, frm)
    groups = {k: (per[k] if per[k] else corner_groups(g, k)) for k in ks}
    return n, frm, groups


def even_heights(g: Graph, r: int, h) -> bool:
    lo, hi = math.inf, 0.0
    for i in _round_ids(g, r):
        if _counts(g, i):
            lo = min(lo, float(h[i]))
            hi = max(hi, float(h[i]))
    return not hi > 1.5 * lo


def polygon_runs(g: Graph, c=None, h=None):
    """The polygon rounds (first, last, n, corner keys per round) of a piece the shared corner
    detector calls a polygon, or None (TypeScript `polygonRuns`)."""
    info = detect_polygon(g)
    if info is None:
        return None
    n, frm, dgroups = info
    nR = len(g.rounds)
    cache: dict = {}

    def groups_of(k):
        if k in cache:
            return cache[k]
        gs = dgroups.get(k) or corner_groups(g, k)
        if len(gs) != n:
            gs = None
            prev = groups_of(k - 1) if k > 0 and k - 1 >= frm else None
            R = g.rounds[k]
            if prev and R["first"] >= 0:
                out = []
                for ids in prev:
                    lo, hi = ids[0], ids[-1]
                    inside = [sp for sp in g.spaces if sp["round"] == k - 1 and sp["kind"] == "chsp" and sp["chains"]
                              and sp["chains"][0] > lo and sp["chains"][-1] < hi]
                    key = f"s{inside[(len(inside) - 1) // 2]['id']}" if inside else f"n{ids[len(ids) // 2]}"
                    mine = [i for i in range(R["first"], R["last"] + 1)
                            if _counts(g, i) and any(anchor_key(a) == key for a in g.nodes[i]["into"])]
                    if not mine:
                        out = []
                        break
                    out.append(mine)
                if len(out) == n:
                    gs = out
        if gs:
            cache[k] = gs
        return gs

    def keys_of(k):
        gs = groups_of(k)
        return [anchor_key(g.nodes[ids[0]]["into"][0]) for ids in gs] if gs else None
    first = frm
    while first < nR and (first < 1 or (h is not None and not even_heights(g, first, h)) or not keys_of(first)):
        first += 1
    corners = {}
    last = first - 1
    for k in range(first, nR):
        if h is not None and not even_heights(g, k, h):
            break
        ks = keys_of(k)
        if not ks:
            break
        corners[k] = ks
        last = k
    if last - first + 1 < POLY_MIN_RUN:
        return None
    return first, last, n, corners


def apply_outline(o: Outline, rounds, counting, chsp, Lc, gen: list, n: int) -> None:
    """SPEC_NOTES N8-N10: rest lengths from the outline layout (TypeScript `applyOutline`).
    `gen` entries (a, b, L, k, kind) are rewritten in place."""
    from .network import BEND_COURSE, BEND_WALE, COURSE, SHEAR, WALE  # noqa: F401

    def has(p):
        return p < n and o.has[p] == 1

    def dist(a, b):
        return math.sqrt((o.qx[a] - o.qx[b]) ** 2 + (o.qy[a] - o.qy[b]) ** 2)
    span = set(o.span)

    def ocourse(i):
        return o.round_kind[rounds[i]] in ("border", "polygon", "polybase")
    for idx, (a, b, L, k, t) in enumerate(gen):
        if t in (WALE, SHEAR, BEND_WALE):
            if counting[a] and has(a) and has(b) and not o.col_scale[b] > 0:
                L = dist(a, b)
            elif t == WALE and b >= n and counting[a] and has(a) and o.round_kind[rounds[a]] == "polybase":
                L = math.sqrt(o.qx[a] ** 2 + o.qy[a] ** 2)
            gen[idx] = (a, b, L, k, t)
            continue
        lo, hi = min(a, b), max(a, b)
        if t == COURSE and (o.col_scale[lo] > 0 or o.col_scale[hi] > 0):
            L = Lc(lo, hi) * (o.col_scale[lo] if o.col_scale[lo] > 0 else o.col_scale[hi])
            gen[idx] = (a, b, L, k, t)
            continue
        if not has(lo) or not has(hi):
            continue
        if lo in span and hi in span and (hi - lo == 1 or lo + 1 in span):
            L = 0.5 * (o.c[lo] + o.c[hi])
            if hi - lo == 2:
                L += o.c[lo + 1]
        elif rounds[lo] == rounds[hi] and o.round_kind[rounds[lo]] == "row":
            if any(chsp[q] for q in range(lo, hi + 1)):
                L = dist(lo, hi)
        elif rounds[lo] != rounds[hi]:
            if counting[lo] and counting[hi]:
                L = dist(lo, hi)
        elif ocourse(lo):
            if any(chsp[q] for q in range(lo, hi + 1)):
                continue
            crs = o.courses.get(rounds[lo])
            poly = crs.poly if crs is not None else (o.base if o.round_kind[rounds[lo]] == "polybase" else None)
            if poly is None:
                continue
            Sa, Sb = o.S[lo], o.S[hi]
            if not (math.isfinite(Sa) and math.isfinite(Sb)):
                continue
            path = Sb - Sa
            path -= poly.P * math.floor(path / poly.P + 0.5)
            path = abs(path)
            if path < 1e-9:
                continue
            arc = 0.0
            for q in range(lo, hi):
                arc += 0.5 * (Lc(q, q) * o.lam[q] + Lc(q + 1, q + 1) * o.lam[q + 1])
            L = dist(lo, hi) * arc / path
        else:
            continue
        gen[idx] = (a, b, L, k, t)
