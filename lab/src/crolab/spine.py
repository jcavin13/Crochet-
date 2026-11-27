"""Spines: chains with stitches worked back along them (SPEC_NOTES.md N5, P7).

A snowflake arm is written `ch 16, sl st in 4th ch from hook, sl st in next 3 ch, picot, picot, ...`:
a run of chains (the *stem*) with stitches worked back into its individual chains. Physically that
is a doubled cord, not a slack chain loop. This module finds such runs in a stitch graph and lays
each one out flat in its own frame (s outward along the stem from the stitch it starts at, t
sideways); the network takes the rest lengths of every spring between two nodes of one spine from
that layout, and growth places the spine radially outward in that shape.

Definitions (exact; the TypeScript port `app/src/core/sim/spine.ts` must match):

* A *free chain* is a node of type `ch` that is not a turning chain (`role`), not a counts-as top
  and not one of the chains of any space.
* A *return stitch* of chain c is a node i > c of the same round with a `{node: c}` leg.
* A *spine* is a maximal run of consecutive free chains of one round (ids c_1..c_n) where at
  least one chain has a return stitch. Its *stem* is c_1..c_q, q the last chain with a return
  stitch; c_{q+1}..c_n (the chains skipped at the hook end) form the *tip loop*. Its return
  stitches are all nodes with a leg into a stem chain. Its *picots* are the picot nodes with ids
  between the first return stitch and the last one, plus the picots straight after the last one.
* The *base* is node c_1 - 1 (the stitch the spine is worked from), at s = t = 0.

Layout (mm, rest lengths from the network's course widths w and heights h):

* stem chain c_k: s = Lc(c_1 - 1, c_1) + ... + Lc(c_{k-1}, c_k), t = 0 (Lc(a, b) = (w_a + w_b)/2);
* tip loop: the vertices c_q, c_{q+1}, ..., c_n, r_1 (r_1 = c_n + 1, which must be a return
  stitch into c_q; otherwise the tip chains continue straight along the stem) lie on a circle of
  circumference P = sum Lc over the path c_q..c_n, r_1 plus h_{r_1} (radius R = P / 2 pi), at arc
  positions given by those lengths; the circle is turned so that c_q is at (s_q, 0), the chord
  c_q -> r_1 points along +t and the circle lies on the outer side (s > s_q): with
  half = h_{r_1} / 2R, centre (s_q + R cos(half), R sin(half)), the vertex at arc length x from c_q
  is centre - R (cos(half + x/R), sin(half + x/R));
* return stitch i: s = mean s of its stem-chain anchors, t = h_i (its wale height); r_1 of a tip
  loop sits at (s_q, 2 R sin(h_{r_1} / 2R)), the chord;
* picot p (n_p chains, default 3): base = the last non-picot spine node before it; the k-th picot
  (0-based) of a run of consecutive picots points at angle +a (k even) or -a (k odd) from +s,
  reach n_p * w_ch / 2, where a = 60 deg for picots straight after r_1 when the spine has a tip
  loop (trefoil side picots) and 50 deg otherwise (branch pairs) — the angles `blockedShape()` uses.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

BRANCH_ANGLE = 50.0 * math.pi / 180.0
TIP_PICOT_ANGLE = 60.0 * math.pi / 180.0


@dataclass
class Spine:
    base: int
    stem: list[int]
    tip: list[int]
    ret: list[int]
    picots: list[int]
    #: node -> (s, t) reference position in the spine frame (base at the origin)
    pos: dict[int, tuple[float, float]] = field(default_factory=dict)

    @property
    def nodes(self) -> list[int]:
        return sorted(self.pos)


def _free_chain(g, i: int) -> bool:
    nd = g.nodes[i]
    return nd["type"] == "ch" and nd.get("role") != "tch" and not nd.get("countsAs") and i not in g.chain_space


def find_spines(g, w, h, w_ch: float) -> list[Spine]:
    """Spines of graph g (see module docstring). w, h: per-node course width and height (the
    network's); w_ch: the chain width of the parameter set (picot reach)."""
    n = g.n
    recv: dict[int, list[int]] = {}
    for nd in g.nodes:
        i = nd["id"]
        for a in nd["into"]:
            c = a.get("node")
            if c is None or c >= i or not _free_chain(g, c) or g.nodes[c]["round"] != nd["round"]:
                continue
            lst = recv.setdefault(c, [])
            if i not in lst:
                lst.append(i)

    def Lc(a: int, b: int) -> float:
        return 0.5 * (w[a] + w[b])

    out: list[Spine] = []
    i = 0
    while i < n:
        if not _free_chain(g, i):
            i += 1
            continue
        j = i
        while j + 1 < n and _free_chain(g, j + 1) and g.nodes[j + 1]["round"] == g.nodes[i]["round"]:
            j += 1
        run = list(range(i, j + 1))
        got = [c for c in run if c in recv]
        if got and i >= 1:
            q = got[-1]
            stem = list(range(i, q + 1))
            tip = list(range(q + 1, j + 1))
            ret = sorted({r for c in stem for r in recv.get(c, [])})
            sp = Spine(base=i - 1, stem=stem, tip=tip, ret=ret, picots=[])
            _layout(g, sp, w, h, w_ch, Lc)
            out.append(sp)
        i = j + 1
    return out


def _layout(g, sp: Spine, w, h, w_ch: float, Lc) -> None:
    pos = sp.pos
    s = 0.0
    prev = sp.base
    for c in sp.stem:
        s += Lc(prev, c)
        pos[c] = (s, 0.0)
        prev = c
    sq = pos[sp.stem[-1]][0]
    retset = set(sp.ret)
    q = sp.stem[-1]
    r1 = sp.tip[-1] + 1 if sp.tip else None
    closes = (r1 is not None and r1 in retset and any(a.get("node") == q for a in g.nodes[r1]["into"]))
    if sp.tip and closes:
        path = [q] + sp.tip + [r1]
        seg = [Lc(path[k], path[k + 1]) for k in range(len(path) - 1)]
        P = sum(seg) + float(h[r1])
        R = P / (2 * math.pi)
        # circle centre C; vertex at arc position x has angle phi = phi0 + x / R, phi0 chosen so the
        # closing chord (arc from P - h_r1 to P, i.e. from r_1 back to c_q) is centred on angle pi
        # (pointing to -s): c_q at angle pi - h/(2R), r_1 at angle pi + h/(2R) (going clockwise
        # in (s, t) means t increases from c_q to r_1)
        half = float(h[r1]) / (2 * R)
        cs = sq + R * math.cos(half)      # centre s; c_q sits at s_q
        ct = R * math.sin(half)           # centre t: c_q at t = 0, r_1 at t = 2 R sin(half)
        x = 0.0
        for k, node in enumerate(path):
            ang = half + x / R            # angle measured from the -s direction, turning to -t first
            if k == 0:
                pos[node] = (sq, 0.0)
            else:
                pos[node] = (cs - R * math.cos(ang), ct - R * math.sin(ang))
            if k < len(seg):
                x += seg[k]
        # r_1 ends at angle half + (P - h)/R = 2 pi - half: exactly (s_q, 2 R sin(half))
        pos[r1] = (sq, 2 * ct)
    else:
        s2 = sq
        prev = q
        for c in sp.tip:
            s2 += Lc(prev, c)
            pos[c] = (s2, 0.0)
            prev = c
    for r in sp.ret:
        if r in pos:
            continue
        ss = [pos[a["node"]][0] for a in g.nodes[r]["into"] if a.get("node") in pos and a["node"] in sp.stem]
        pos[r] = (sum(ss) / len(ss), float(h[r]))
    # picots between the first and last return stitch, and straight after the last one
    lo, hi = sp.ret[0], sp.ret[-1]
    k = hi + 1
    while k < g.n and g.nodes[k]["type"] == "picot":
        k += 1
    picots = [p for p in range(lo + 1, k) if g.nodes[p]["type"] == "picot" and p not in pos]
    sp.picots = picots
    run = 0
    base = None
    for p in range(lo, k):
        nd = g.nodes[p]
        if nd["type"] != "picot":
            if p in pos:
                base = p
            run = 0
            continue
        if base is None or p not in picots:
            continue
        a = TIP_PICOT_ANGLE if (closes and base == r1) else BRANCH_ANGLE
        sign = 1.0 if run % 2 == 0 else -1.0
        reach = float(nd.get("chains", 3)) * w_ch / 2
        bs, bt = pos[base]
        pos[p] = (bs + reach * math.cos(a), bt + sign * reach * math.sin(a))
        run += 1
