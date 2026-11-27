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
        for i in ids:
            if i in self.ring_chain:
                continue
            A = net.anchor_particles[i]
            if A and len(A) == 1 and A[0] >= nn:
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
    for sp in g.spaces:
        if sp["kind"] != "chsp" or sp["round"] != r or not sp["chains"]:
            continue
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
