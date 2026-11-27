"""Reference quasi-static simulator (`spec/physics.md` §4): energy, analytic gradient, round-by-round
growth with deterministic initial placement, per-round L-BFGS relaxation, final global L-BFGS.

Initial placement (physics.md §4 step 1, made precise; see lab/SPEC_NOTES.md §"Initial placement"):

  P0  a magic ring's virtual particle starts at the centroid of the particles placed so far
      (the origin if none);
  P1  the chains of a chain ring (`ch N, join to form ring`) start on a circle of circumference
      N*w_ch in the xy-plane around the centroid of the particles placed so far (origin if none),
      chain k (0-based) at angle 2*pi*k/N;
  P2  a node whose anchor particles are exactly one magic ring starts on the circle of radius
      L_wale around the ring particle in the xy-plane, at angle 2*pi*(j-1)/m (j-th of the m nodes
      in the ring);
  P3  any other anchored node starts at  mean(anchor particles) + L_wale * u, where u is the unit
      sum over node-anchor particles a (that themselves have an anchor) of (x_a - x_first_anchor(a))
      ("continuation of the wale"); if that is zero: radial from the centroid of all particles
      placed so far, with its component along the anchor's course tangent removed
      (tangent = x_{a+1} - x_{a-1} over placed same-round yarn neighbours of the first anchor
      particle); if that is zero, z x tangent; if that is zero, +x;
  P4  an unanchored node (chain, picot) continues from the previous node:
      x_{i-1} + L_course(i-1,i) * unit(x_{i-1} - x_{i-2}) (fallback +x; node 0 at the origin);
  P5  spread: a maximal run of m >= 2 consecutive node ids of the round placed by P3 with the
      identical anchor-particle list is spread along the unit course tangent t of its first
      anchor particle: node k (1..m) moves by (k - (m+1)/2) * (wbar_run / 2) * t;
  P7  spines (chains with stitches worked back along them, crolab.spine): after P5, every node of
      a spine of this round is put at x_base + s*u + t*v from its reference layout (s, t), with
      u = unit(x_base - centroid before the round), v = unit(z x u) (SPEC_NOTES P7);
  P9  outline pieces (rows, border rounds, polygon rounds: crolab.outline, SPEC_NOTES N8-N10): a
      node of the foundation, a row or an outline round that has a reference position Q is put in
      the reference layout instead of P2-P4: x = c + e1 (Q_x - q_x) + e2 (Q_y - q_y), with (e1, e2)
      the orthonormal frame of the least-squares affine fit reference -> placed positions over every
      placed node with a reference position (c, q their centroids), when those references span a
      plane; otherwise relative to its base b (first anchor particle with Q, else the nearest
      earlier placed node with Q): x = x_b + e1 (Q - Q_b)_x + e2 (Q - Q_b)_y (collinear references:
      e1 along the fitted line, e2 = unit(z x e1)). P5 and P4' skip these nodes;
  P6  the perturbation  delta_i = perturb_eps * wbar_r * sin(2.399963*(i+1))  along +z is added to
      every node of round r (wbar_r = mean course width of the nodes of round r).

Then the whole piece placed so far is relaxed with L-BFGS (only springs whose two particles are
placed take part), and the next round is added. After the last round a tighter global L-BFGS runs.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import minimize

from .network import Network, build_network
from .params import StitchParams, load_sim_config

GOLDEN = 2.399963


# ------------------------------------------------------------------------------------------
# energy
# ------------------------------------------------------------------------------------------
def energy_and_grad(x: np.ndarray, I: np.ndarray, J: np.ndarray, L: np.ndarray, kL: np.ndarray,
                    n: int, slack: np.ndarray | None = None) -> tuple[float, np.ndarray]:
    """E = sum 1/2 (k/L)(|x_i - x_j| - L)^2 and its gradient. x is flat [3n]; kL = k / L.
    Springs flagged in `slack` are tension-only: (|x_i - x_j| - L) is replaced by max(0, .)."""
    X = x.reshape(n, 3)
    d = X[I] - X[J]
    r = np.sqrt(np.einsum("ij,ij->i", d, d))
    e = r - L
    if slack is not None:
        e = np.where(slack & (e < 0), 0.0, e)
    E = 0.5 * float(np.dot(kL, e * e))
    coef = kL * e / np.maximum(r, 1e-12)
    f = d * coef[:, None]
    g = np.empty((n, 3))
    for c in range(3):
        g[:, c] = np.bincount(I, f[:, c], minlength=n) - np.bincount(J, f[:, c], minlength=n)
    return E, g.ravel()


def network_energy(net: Network, X: np.ndarray) -> float:
    E, _ = energy_and_grad(np.asarray(X, float).ravel(), net.i, net.j, net.L, net.k / net.L, net.n_particles,
                           net.slack)
    return E


def spring_strain(net: Network, X: np.ndarray) -> np.ndarray:
    d = X[net.i] - X[net.j]
    return np.linalg.norm(d, axis=1) / net.L - 1.0


def relax(X0: np.ndarray, I, J, L, k, free: np.ndarray | None = None, gtol: float = 1e-6,
          maxiter: int = 20000, slack: np.ndarray | None = None) -> tuple[np.ndarray, float, bool, int]:
    """Minimise the spring energy over the particles flagged in `free` (default: all)."""
    n = len(X0)
    kL = k / L
    if free is None or free.all():
        def fun(x):
            return energy_and_grad(x, I, J, L, kL, n, slack)
        x0 = X0.ravel().copy()
        res = minimize(fun, x0, jac=True, method="L-BFGS-B",
                       options={"maxiter": maxiter, "maxcor": 20, "gtol": gtol, "ftol": 1e-15, "maxfun": maxiter * 2})
        return res.x.reshape(n, 3), float(res.fun), bool(res.success or _small_grad(res, gtol)), int(res.nit)
    idx = np.nonzero(free)[0]
    Xf = X0.copy()

    def fun(x):
        Xf[idx] = x.reshape(-1, 3)
        E, g = energy_and_grad(Xf.ravel(), I, J, L, kL, n, slack)
        return E, g.reshape(n, 3)[idx].ravel()
    res = minimize(fun, X0[idx].ravel(), jac=True, method="L-BFGS-B",
                   options={"maxiter": maxiter, "maxcor": 20, "gtol": gtol, "ftol": 1e-15, "maxfun": maxiter * 2})
    Xf[idx] = res.x.reshape(-1, 3)
    return Xf, float(res.fun), bool(res.success or _small_grad(res, gtol)), int(res.nit)


def _small_grad(res, gtol) -> bool:
    return res.jac is not None and float(np.max(np.abs(res.jac))) <= 10 * gtol


# ------------------------------------------------------------------------------------------
# growth
# ------------------------------------------------------------------------------------------
@dataclass
class SimResult:
    positions: np.ndarray             # [n_particles, 3] (virtual ring particles at the end)
    energy: float
    converged: bool
    strain: np.ndarray                # per spring (|d| / L - 1)
    network: Network = field(repr=False)
    snapshots: list[np.ndarray] = field(default_factory=list, repr=False)  # per round: [n_particles,3], NaN = not yet made
    rounds_done: int = 0
    seconds: float = 0.0
    iterations: int = 0

    @property
    def nodes(self) -> np.ndarray:
        """Positions of the real (node) particles, NaN rows for nodes not yet made."""
        return self.positions[: self.network.n_nodes]

    @property
    def placed(self) -> np.ndarray:
        return ~np.isnan(self.positions[:, 0])


def _unit(v: np.ndarray) -> tuple[np.ndarray, float]:
    nv = float(np.linalg.norm(v))
    return (v / nv if nv > 0 else v), nv


class _Placer:
    def __init__(self, net: Network, cfg: dict):
        self.net = net
        self.g = net.graph
        self.cfg = cfg
        self.X = np.full((net.n_particles, 3), np.nan)
        self.pairs = {}
        for a, b, L, t in zip(net.i, net.j, net.L, net.kind):
            if t == 1:  # wale
                self.pairs[(int(a), int(b))] = float(L)
                self.pairs[(int(b), int(a))] = float(L)
        self.ring_chain: dict[int, tuple[int, int, int]] = {}   # chain id -> (space, k, n)
        for s in self.g.spaces:
            if s["kind"] == "ring" and s["chains"]:
                for k, c in enumerate(s["chains"]):
                    self.ring_chain[c] = (s["id"], k, len(s["chains"]))
        self.ring_center: dict[int, np.ndarray] = {}
        self.ring_members = {s: self.g.nodes_in_space(s) for s in net.space_particle}

    def placed_mask(self) -> np.ndarray:
        return ~np.isnan(self.X[:, 0])

    def centroid(self) -> np.ndarray:
        m = self.placed_mask()
        return self.X[m].mean(axis=0) if m.any() else np.zeros(3)

    def tangent(self, a: int) -> np.ndarray:
        n = self.net.n_nodes
        if a >= n:
            return np.zeros(3)
        rr = self.net.particle_round
        lo = a - 1 if a - 1 >= 0 and rr[a - 1] == rr[a] and not np.isnan(self.X[a - 1, 0]) else a
        hi = a + 1 if a + 1 < n and rr[a + 1] == rr[a] and not np.isnan(self.X[a + 1, 0]) else a
        return _unit(self.X[hi] - self.X[lo])[0]

    def outline_base(self, i: int) -> int:
        """P9 base of node i: its first anchor particle with a reference position that is placed,
        else the nearest earlier placed node with one; -1 if none."""
        o, X, nn = self.net.outline, self.X, self.net.n_nodes
        for a in self.net.anchor_particles[i]:
            if a < nn and o.has[a] and not np.isnan(X[a, 0]):
                return a
        for j in range(i - 1, -1, -1):
            if o.has[j] and not np.isnan(X[j, 0]):
                return j
        return -1

    def _perp(self, e):
        v, nv = _unit(np.cross([0.0, 0.0, 1.0], e))
        if nv < 1e-9:
            v, _ = _unit(np.cross(e, [1.0, 0.0, 0.0]))
        return v

    def outline_frame(self):
        """P9 frame (TypeScript `Placer.outlineFrame`): (e1, e2, c, q, planar) — the orthonormal
        frame of the least-squares affine map reference -> placed positions over every placed node
        with a reference position, the centroids c (positions) and q (references), and whether the
        references span a plane."""
        o, X = self.net.outline, self.X
        ps = [p for p in range(self.net.n_nodes) if o.has[p] and not np.isnan(X[p, 0])]
        ex, ey = np.array([1.0, 0.0, 0.0]), np.array([0.0, 1.0, 0.0])
        if len(ps) < 2:
            return ex, ey, np.zeros(3), (0.0, 0.0), False
        qx = float(np.mean([o.qx[p] for p in ps]))
        qy = float(np.mean([o.qy[p] for p in ps]))
        xb = np.array([float(np.mean([X[p, d] for p in ps])) for d in range(3)])
        sxx = sxy = syy = 0.0
        cx, cy = np.zeros(3), np.zeros(3)
        for p in ps:
            ux, uy = o.qx[p] - qx, o.qy[p] - qy
            sxx += ux * ux
            sxy += ux * uy
            syy += uy * uy
            for d in range(3):
                v = X[p, d] - xb[d]
                cx[d] += v * ux
                cy[d] += v * uy
        tr = sxx + syy
        if not tr > 0:
            return ex, ey, xb, (qx, qy), False
        det = sxx * syy - sxy * sxy
        planar = det > 1e-9 * tr * tr
        if planar:
            m1 = (cx * syy + cy * (-sxy)) * (1 / det)
            m2 = (cy * sxx + cx * (-sxy)) * (1 / det)
            e1, nu = _unit(m1)
            if nu < 1e-12:
                e1 = ex
            e2, nu = _unit(m2 - e1 * float(np.dot(m2, e1)))
            if nu < 1e-12:
                e2 = self._perp(e1)
        else:
            qh = (sxx, sxy) if sxx >= syy else (sxy, syy)
            nq = math.sqrt(qh[0] * qh[0] + qh[1] * qh[1])
            qh = (qh[0] / nq, qh[1] / nq) if nq > 0 else (1.0, 0.0)
            eq, ne = _unit(cx * qh[0] + cy * qh[1])
            if ne < 1e-12:
                eq = ex
            ep = self._perp(eq)
            e1 = eq * qh[0] + ep * (-qh[1])
            e2 = eq * qh[1] + ep * qh[0]
        return e1, e2, xb, (qx, qy), planar

    def p9_placed(self, i: int) -> bool:
        o = self.net.outline
        return bool(o is not None and o.has[i] and o.round_kind[self.g.nodes[i]["round"]] in ("foundation", "row", "border", "polygon"))

    def wale_len(self, i: int, p: int) -> float:
        return self.pairs.get((i, p), float(self.net.height[i]))

    def place_round(self, r: int) -> list[int]:
        net, g, X = self.net, self.g, self.X
        nn = net.n_nodes
        new: list[int] = []
        self.round_centroid = self.centroid()
        # P0 virtual particles of magic rings created in this round
        for s, p in net.space_particle.items():
            if g.spaces[s]["round"] == r:
                X[p] = self.centroid()
                self.ring_center[s] = X[p].copy()
        ids = g.round_nodes(r)
        # P1 chain-ring chains
        for i in ids:
            if i in self.ring_chain:
                s, k, n = self.ring_chain[i]
                if s not in self.ring_center:
                    self.ring_center[s] = self.centroid()
                c = self.ring_center[s]
                R = n * net.width[i] / (2 * math.pi)
                th = 2 * math.pi * k / n
                X[i] = c + R * np.array([math.cos(th), math.sin(th), 0.0])
        by_p3: dict[int, tuple] = {}
        o = net.outline
        p9 = o is not None and o.round_kind[r] in ("foundation", "row", "border", "polygon")
        fr = self.outline_frame() if p9 else None
        for i in ids:
            if i in self.ring_chain:
                continue
            A = net.anchor_particles[i]
            b9 = self.outline_base(i) if (p9 and o.has[i]) else -1
            if b9 >= 0:
                # P9: in the reference layout, in the fitted plane of the piece when the fit is
                # planar, else relative to a placed reference particle (SPEC_NOTES P9)
                e1, e2, c, q, planar = fr
                if planar:
                    X[i] = c + e1 * (o.qx[i] - q[0]) + e2 * (o.qy[i] - q[1])
                else:
                    X[i] = X[b9] + e1 * (o.qx[i] - o.qx[b9]) + e2 * (o.qy[i] - o.qy[b9])
            elif A and len(A) == 1 and A[0] >= nn:
                # P2
                p = A[0]
                s = net.virtual_space[p]
                mem = self.ring_members[s]
                j = mem.index(i)
                th = 2 * math.pi * j / len(mem)
                X[i] = X[p] + self.wale_len(i, p) * np.array([math.cos(th), math.sin(th), 0.0])
            elif A:
                # P3
                base = X[A].mean(axis=0)
                v = np.zeros(3)
                for a in A:
                    if a < nn and net.anchor_particles[a]:
                        v += X[a] - X[net.anchor_particles[a][0]]
                u, nv = _unit(v)
                if nv < 1e-9:
                    t = self.tangent(A[0])
                    v = base - self.centroid()
                    v = v - np.dot(v, t) * t
                    u, nv = _unit(v)
                    if nv < 1e-6:
                        u, nv = _unit(np.cross([0.0, 0.0, 1.0], t))
                        if nv < 1e-9:
                            u = np.array([1.0, 0.0, 0.0])
                Lw = float(np.mean([self.wale_len(i, a) for a in A]))
                X[i] = base + Lw * u
                by_p3[i] = tuple(A)
            else:
                # P4
                if i == 0 or np.isnan(X[i - 1, 0]):
                    X[i] = np.zeros(3) if i == 0 else self.centroid()
                else:
                    d = np.array([1.0, 0.0, 0.0])
                    if i >= 2 and not np.isnan(X[i - 2, 0]):
                        dd, nd = _unit(X[i - 1] - X[i - 2])
                        if nd > 1e-9:
                            d = dd
                    X[i] = X[i - 1] + 0.5 * (net.width[i - 1] + net.width[i]) * d
            new.append(i)
        # P5 spread runs sharing the same anchors
        k = 0
        while k < len(ids):
            i = ids[k]
            if i not in by_p3:
                k += 1
                continue
            run = [i]
            while k + len(run) < len(ids):
                nxt = ids[k + len(run)]
                if by_p3.get(nxt) == by_p3[i]:
                    run.append(nxt)
                else:
                    break
            if len(run) >= 2:
                t = self.tangent(by_p3[i][0])
                wb = float(np.mean(net.width[run]))
                m = len(run)
                for q, nid in enumerate(run, start=1):
                    X[nid] = X[nid] + (q - (m + 1) / 2) * (wb / 2) * t
            k += len(run)
        # P7 spines: radially outward from their base, in their reference layout
        self.place_spines(r)
        # P8 pointed loops: likewise, a narrow outward loop with the picot at its apex
        self.place_pointed_loops(r)
        # P4' chain-space loops: on an outward arc between the nodes either side of the loop
        self.place_loops(r, ids)
        # P6 perturbation
        if ids:
            wbar = float(np.mean(net.width[ids]))
            eps = self.cfg["perturb_eps"]
            for i in ids:
                X[i, 2] += eps * wbar * math.sin(GOLDEN * (i + 1))
        return new


def _arc_angle(ratio: float) -> float:
    """theta in (0, 1.95 pi] with theta / (2 sin(theta/2)) = ratio (arc length / chord)."""
    lo, hi = 1e-9, 1.95 * math.pi
    f = lambda t: t / (2 * math.sin(t / 2)) - ratio  # noqa: E731
    if f(hi) < 0:
        return hi
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if f(mid) > 0:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


def _place_loops(self, r: int, ids: list[int]) -> None:
    net, g, X = self.net, self.g, self.X
    idset = set(ids)
    in_loop = {v for pl in net.pointed_loops for v in pl.nodes}
    for sp in g.spaces:
        if sp["kind"] != "chsp" or sp["round"] != r or not sp["chains"] or sp["chains"][0] in in_loop:
            continue
        if self.p9_placed(sp["chains"][0]):
            continue  # P9 placed them in the reference layout
        ch = sp["chains"]
        a, b = ch[0] - 1, ch[-1] + 1
        if a not in idset or b not in idset or np.isnan(X[a, 0]) or np.isnan(X[b, 0]):
            continue
        seq = [a] + ch + [b]
        rest = np.array([0.5 * (net.width[seq[k]] + net.width[seq[k + 1]]) for k in range(len(seq) - 1)])
        S = float(rest.sum())
        d = X[b] - X[a]
        D = float(np.linalg.norm(d))
        t = np.concatenate([[0.0], np.cumsum(rest)])[1:-1] / S
        if D < 1e-9:
            d_hat = self.tangent(a) if np.linalg.norm(self.tangent(a)) > 0 else np.array([1.0, 0.0, 0.0])
        else:
            d_hat = d / D
        mid = 0.5 * (X[a] + X[b])
        o = mid - self.round_centroid
        o = o - np.dot(o, d_hat) * d_hat
        o, no = _unit(o)
        if no < 1e-9:
            o, no = _unit(np.cross([0.0, 0.0, 1.0], d_hat))
        if S <= D * (1 + 1e-9) or D < 1e-9 and S <= 0:
            for k, c in enumerate(ch):
                X[c] = X[a] + t[k] * d
            continue
        th = _arc_angle(S / max(D, 1e-9 * S)) if D > 1e-9 else 1.95 * math.pi
        R = S / th
        C0 = mid - o * R * math.cos(th / 2)
        for k, c in enumerate(ch):
            ph = -th / 2 + t[k] * th
            X[c] = C0 + R * (math.sin(ph) * d_hat + math.cos(ph) * o)


_Placer.place_loops = _place_loops


def _place_spines(self, r: int) -> None:
    """P7: every spine of round r whose base is placed is laid out in its reference layout
    (crolab.spine), s along u = unit(x_base - centroid of the piece before this round) (fallback +x),
    t along unit(z x u) (fallback unit(u x x))."""
    X = self.X
    for sp in self.net.spines:
        if self.g.nodes[sp.stem[0]]["round"] != r or np.isnan(X[sp.base, 0]):
            continue
        o = X[sp.base].copy()
        u, nu = _unit(o - self.round_centroid)
        if nu < 1e-9:
            u = np.array([1.0, 0.0, 0.0])
        t, nt = _unit(np.cross([0.0, 0.0, 1.0], u))
        if nt < 1e-9:
            t, _ = _unit(np.cross(u, [1.0, 0.0, 0.0]))
        for v in sp.nodes:
            s_, t_ = sp.pos[v]
            X[v] = o + s_ * u + t_ * t


_Placer.place_spines = _place_spines


def _place_pointed_loops(self, r: int) -> None:
    """P8: every pointed loop (N6) of round r whose base and close are placed is laid out like a
    spine (P7), x = x_base + s u + sigma t v, with sigma = -1 when (x_close - x_base) . v < 0."""
    X = self.X
    for pl in self.net.pointed_loops:
        if self.g.nodes[pl.base]["round"] != r or np.isnan(X[pl.base, 0]) or np.isnan(X[pl.close, 0]):
            continue
        o = X[pl.base].copy()
        u, nu = _unit(o - self.round_centroid)
        if nu < 1e-9:
            u = np.array([1.0, 0.0, 0.0])
        t, nt = _unit(np.cross([0.0, 0.0, 1.0], u))
        if nt < 1e-9:
            t, _ = _unit(np.cross(u, [1.0, 0.0, 0.0]))
        sg = -1.0 if float(np.dot(X[pl.close] - o, t)) < 0 else 1.0
        for v in pl.nodes:
            s_, t_ = pl.pos[v]
            X[v] = o + s_ * u + sg * t_ * t


_Placer.place_pointed_loops = _place_pointed_loops


def simulate(pattern: dict, params: StitchParams | None = None, upto_round: int | None = None,
             config: dict | None = None, snapshots: bool = True, gtol_round: float = 1e-6,
             gtol_final: float = 1e-8, network: Network | None = None) -> SimResult:
    """Grow and relax the piece round by round (rounds 0..upto_round inclusive, 0-based index;
    default all), then a final global L-BFGS. Returns positions, energy, strains and snapshots."""
    t0 = time.perf_counter()
    cfg = config or load_sim_config()
    net = network or build_network(pattern, params, cfg)
    g = net.graph
    R = len(g.rounds) if upto_round is None else min(upto_round + 1, len(g.rounds))
    pl = _Placer(net, cfg)
    snaps: list[np.ndarray] = []
    converged = True
    iters = 0
    E = 0.0
    for r in range(R):
        pl.place_round(r)
        mask = pl.placed_mask()
        X, E, ok, it = _relax_placed(net, pl.X, mask, gtol_round)
        iters += it
        pl.X[mask] = X[mask]
        if snapshots:
            snaps.append(pl.X.copy())
    mask = pl.placed_mask()
    X, E, ok, it = _relax_placed(net, pl.X, mask, gtol_final)
    iters += it
    converged = ok
    pl.X[mask] = X[mask]
    Xf = pl.X
    strain = np.full(net.m, np.nan)
    both = mask[net.i] & mask[net.j]
    d = Xf[net.i[both]] - Xf[net.j[both]]
    strain[both] = np.linalg.norm(d, axis=1) / net.L[both] - 1.0
    return SimResult(positions=Xf, energy=E, converged=converged, strain=strain, network=net,
                     snapshots=snaps, rounds_done=R, seconds=time.perf_counter() - t0, iterations=iters)


def _relax_placed(net: Network, X: np.ndarray, mask: np.ndarray, gtol: float):
    idx = np.nonzero(mask)[0]
    remap = -np.ones(net.n_particles, dtype=np.int64)
    remap[idx] = np.arange(len(idx))
    both = mask[net.i] & mask[net.j]
    I, J = remap[net.i[both]], remap[net.j[both]]
    Xs, E, ok, it = relax(X[idx].copy(), I, J, net.L[both], net.k[both], gtol=gtol, slack=net.slack[both])
    out = X.copy()
    out[idx] = Xs
    return out, E, ok, it
