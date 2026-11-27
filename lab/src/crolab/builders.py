"""Programmatic stitch-graph builders producing schema-valid pattern dicts.

These are the lab's own way of making graphs (the TypeScript compiler is the only *notation*
parser, see docs/decisions.md #6). They follow the compilation rules of `spec/notation.md`
(turning chains, counts-as bases, chain spaces, joins) so that a builder graph and the compiled
graph of the same pattern are structurally the same.

Public builders:

* `sc_rounds(counts)` — spiral single-crochet rounds from a magic ring, increases / decreases
  evenly distributed (reproduces flat_sc_circle, sc_sphere, sc_cone, hyperbolic_plane).
* `dc_rounds_joined(counts)` — joined dc rounds, `ch 3 (counts as dc)` (flat_dc_circle).
* `hyperbolic(n0, rate, rounds)` — sc rounds multiplying the count by `rate` per round.
* `rect_rows(stitch, width, rows)` — flat rows on a foundation chain, for swatch / gauge work.
* `simple_doily()`, `chain_space_motif()` — hand-transcriptions of the two lace fixtures (used
  only for development and flatness tests; fixture tests use the compiled graphs for lace).
* `builder_for_fixture(name)` — the builder graph of a canonical fixture (or None).
"""
from __future__ import annotations

import json
from typing import Iterable, Sequence

STITCH_TCH = {"sc": 1, "hdc": 2, "dc": 3, "tr": 4, "dtr": 5, "slst": 0}


class PatternBuilder:
    """Low-level helper: append nodes in working order, track rounds and spaces."""

    def __init__(self, title: str, params: str | None = None, **meta):
        self.meta = {"title": title, "terms": "US", **meta}
        if params:
            self.meta["params"] = params
        self.nodes: list[dict] = []
        self.spaces: list[dict] = []
        self.rounds: list[dict] = []
        self._round: dict | None = None
        self._ring_chain_ids: set[int] = set()
        self._group = 0

    # ---- rounds ------------------------------------------------------------------------
    def begin(self, label: str, kind: str = "round", turned: bool = False) -> int:
        assert self._round is None
        idx = len(self.rounds)
        self._round = {"index": idx, "label": label, "kind": kind, "turned": turned, "_first": len(self.nodes)}
        return idx

    @property
    def r(self) -> int:
        assert self._round is not None
        return self._round["index"]

    def end(self, joined: bool = False, declared: int | None = None) -> int:
        rd = self._round
        assert rd is not None
        first = rd.pop("_first")
        last = len(self.nodes) - 1
        ids = list(range(first, last + 1))
        # chain spaces: maximal runs of consecutive plain chains (not tch, not ring chains)
        run: list[int] = []

        def flush():
            if run:
                self.spaces.append({"id": len(self.spaces), "kind": "chsp", "round": rd["index"], "chains": list(run)})
                run.clear()

        for i in ids:
            n = self.nodes[i]
            if n["type"] == "ch" and n.get("role") != "tch" and i not in self._ring_chain_ids:
                run.append(i)
            else:
                flush()
        flush()
        sc = sum(1 for i in ids if counts(self.nodes[i]))
        out = {
            "index": rd["index"], "label": rd["label"], "kind": rd["kind"], "joined": joined,
            "turned": rd["turned"], "first": first if ids else -1, "last": last if ids else -1,
            "stitchCount": sc,
        }
        if declared is not None:
            out["declaredCount"] = declared
        self.rounds.append(out)
        self._round = None
        return rd["index"]

    # ---- nodes -------------------------------------------------------------------------
    def node(self, type_: str, into: Sequence[dict] = (), **extra) -> int:
        i = len(self.nodes)
        n = {"id": i, "type": type_, "round": self.r, "into": [dict(a) for a in into]}
        n.update({k: v for k, v in extra.items() if v is not None})
        self.nodes.append(n)
        return i

    def st(self, type_: str, *anchors: dict, group: dict | None = None) -> int:
        return self.node(type_, anchors, group=group)

    def ch(self, n: int = 1) -> list[int]:
        return [self.node("ch") for _ in range(n)]

    def tch(self, n: int, counts_as: str | None = None, base: dict | None = None) -> int | None:
        """Turning chain of `n` chains. With counts_as, the first h(counts_as) chains are the turning
        chain whose top counts as that stitch standing on `base`; the remaining chains are ordinary
        chains (they become a chain space). Returns the top chain id (or None)."""
        if counts_as is None:
            for _ in range(n):
                self.node("ch", role="tch")
            return None
        h = STITCH_TCH[counts_as]
        assert n >= h
        for _ in range(h - 1):
            self.node("ch", role="tch")
        top = self.node("ch", [base] if base is not None else [], role="tch", countsAs=counts_as)
        self.ch(n - h)
        return top

    def picot(self, chains: int = 3) -> int:
        return self.node("picot", chains=chains)

    def new_group(self, kind: str) -> dict:
        g = {"kind": kind, "id": self._group}
        self._group += 1
        return g

    def magic_ring(self) -> int:
        s = len(self.spaces)
        self.spaces.append({"id": s, "kind": "ring", "round": self.r, "chains": []})
        return s

    def chain_ring(self, n: int) -> int:
        chains = self.ch(n)
        self._ring_chain_ids.update(chains)
        self.node("slst", [N(chains[0])])
        s = len(self.spaces)
        self.spaces.append({"id": s, "kind": "ring", "round": self.r, "chains": chains})
        return s

    def build(self) -> dict:
        assert self._round is None, "unfinished round"
        return {
            "format": "crochet-pattern", "version": "0.1", "meta": dict(self.meta),
            "graph": {"nodes": self.nodes, "spaces": self.spaces, "rounds": self.rounds},
        }

    # ---- helpers for the next round --------------------------------------------------------
    def targets(self, r: int) -> list[int]:
        """Stitch targets of round r in working order."""
        rd = self.rounds[r]
        return [i for i in range(rd["first"], rd["last"] + 1) if counts(self.nodes[i])]

    def chsps(self, r: int, length: int | None = None) -> list[int]:
        return [s["id"] for s in self.spaces
                if s["round"] == r and s["kind"] == "chsp" and (length is None or len(s["chains"]) == length)]


def N(i: int) -> dict:
    return {"node": int(i)}


def S(s: int) -> dict:
    return {"space": int(s)}


def counts(n: dict) -> bool:
    if n.get("countsAs"):
        return True
    if n.get("role") == "tch":
        return False
    return n["type"] not in ("ch", "slst", "picot")


# ------------------------------------------------------------------------------------------
# distribution of increases / decreases
# ------------------------------------------------------------------------------------------
def _flag(k: int, d: int, n: int) -> bool:
    """True if slot k (0-based) of n is one of d evenly spaced special slots (last slot of each block)."""
    return (((k + 1) * d) // n) - ((k * d) // n) == 1


def _work_round(b: PatternBuilder, prev: list[int], m: int, stitch: str = "sc",
                inc_group: bool = True) -> None:
    """Work `m` stitches over the targets `prev` (n of them), increases/decreases evenly spread."""
    n = len(prev)
    if m >= n:
        d = m - n
        assert d <= n, f"cannot go from {n} to {m} with single increases"
        for j, t in enumerate(prev):
            if d and _flag(j, d, n):
                g = b.new_group("inc") if inc_group else None
                b.st(stitch, N(t), group=g)
                b.st(stitch, N(t), group=g)
            else:
                b.st(stitch, N(t))
    else:
        d = n - m
        assert d <= m, f"cannot go from {n} to {m} with 2-together decreases"
        pos = 0
        for k in range(m):
            if _flag(k, d, m):
                b.st(stitch, N(prev[pos]), N(prev[pos + 1]))
                pos += 2
            else:
                b.st(stitch, N(prev[pos]))
                pos += 1
        assert pos == n


def sc_rounds(counts: Sequence[int], title: str | None = None, params: str | None = None) -> dict:
    """Spiral sc rounds from a magic ring: round 1 = counts[0] sc in ring, then each round works
    evenly distributed `inc` / `dec` (sc2tog) to reach the next count. Not joined."""
    b = PatternBuilder(title or f"sc rounds {list(counts)}", params=params)
    b.begin("Rnd 1")
    ring = b.magic_ring()
    for _ in range(counts[0]):
        b.st("sc", S(ring))
    b.end(declared=counts[0])
    for k, m in enumerate(counts[1:], start=2):
        prev = b.targets(len(b.rounds) - 1)
        b.begin(f"Rnd {k}")
        _work_round(b, prev, m, "sc")
        b.end(declared=m)
    return b.build()


def dc_rounds_joined(counts: Sequence[int], title: str | None = None, params: str | None = None,
                     stitch: str = "dc") -> dict:
    """Joined rounds of `stitch` (default dc): Rnd 1 `mr, ch 3 (counts as dc), N-1 dc in ring, join`;
    later rounds `ch 3 (counts as dc)` standing on the first target, evenly spread `2 dc in next st`,
    `join` (sl st in the top of the turning chain)."""
    h = STITCH_TCH[stitch]
    b = PatternBuilder(title or f"joined {stitch} rounds {list(counts)}", params=params)
    b.begin("Rnd 1")
    ring = b.magic_ring()
    top = b.tch(h, counts_as=stitch, base=S(ring))
    for _ in range(counts[0] - 1):
        b.st(stitch, S(ring))
    b.node("slst", [N(top)])
    b.end(joined=True, declared=counts[0])
    for k, m in enumerate(counts[1:], start=2):
        prev = b.targets(len(b.rounds) - 1)
        n = len(prev)
        d = m - n
        assert 0 <= d <= n
        b.begin(f"Rnd {k}")
        top = b.tch(h, counts_as=stitch, base=N(prev[0]))
        if d and _flag(0, d, n):
            b.st(stitch, N(prev[0]))
        for j in range(1, n):
            b.st(stitch, N(prev[j]))
            if d and _flag(j, d, n):
                b.st(stitch, N(prev[j]))
        b.node("slst", [N(top)])
        b.end(joined=True, declared=m)
    return b.build()


def hyperbolic_counts(n0: int = 6, rate: float = 1.5, rounds: int = 6,
                      lead: Sequence[int] = (1, 2, 4)) -> list[int]:
    """Counts for `hyperbolic`: the first len(lead) rounds are n0*lead (a flat start that then
    doubles), after which every round multiplies by `rate` (rounded half up)."""
    c = [n0 * f for f in lead][:rounds]
    while len(c) < rounds:
        c.append(int(c[-1] * rate + 0.5))
    return c


def hyperbolic(n0: int = 6, rate: float = 1.5, rounds: int = 6, lead: Sequence[int] = (1, 2, 4),
               params: str | None = None) -> dict:
    """Hyperbolic plane in sc. Defaults reproduce the hyperbolic_plane fixture (6,12,24,36,54,81).
    With `lead=(1,)` the multiplication starts from round 2."""
    c = hyperbolic_counts(n0, rate, rounds, lead)
    return sc_rounds(c, title=f"Hyperbolic plane (sc, x{rate} per round)", params=params)


def rect_rows(stitch: str = "sc", width: int = 10, rows: int = 10, params: str | None = None) -> dict:
    """Flat rectangle: Foundation `ch width+t` (t = turning chain height of `stitch`), Row 1
    `stitch in (t+1)th ch from hook, stitch in each ch across`, then `ch t, turn, stitch in each st
    across`. The turning chain never counts (so every row has exactly `width` stitches)."""
    t = max(1, STITCH_TCH[stitch])
    b = PatternBuilder(f"{stitch} swatch {width} x {rows}", params=params)
    b.begin("Foundation", kind="foundation")
    base = b.ch(width)
    for _ in range(t):
        b.node("ch", role="tch")
    b.end()
    b.begin("Row 1", kind="row")
    for c in reversed(base):
        b.st(stitch, N(c))
    b.end(declared=width)
    for k in range(2, rows + 1):
        prev = b.targets(len(b.rounds) - 1)
        b.begin(f"Row {k}", kind="row", turned=True)
        b.tch(t)
        for p in reversed(prev):
            b.st(stitch, N(p))
        b.end(declared=width)
    return b.build()


# ------------------------------------------------------------------------------------------
# the two lace fixtures, transcribed by hand from spec/fixtures/*.cro
# ------------------------------------------------------------------------------------------
def simple_doily() -> dict:
    b = PatternBuilder("Simple doily (16-fold, no pineapples)", params="thread-10_1.5mm")
    # Rnd 1: ch 6, join to form ring, ch 3 (counts as dc), 15 dc in ring, join. (16)
    b.begin("Rnd 1")
    ring = b.chain_ring(6)
    top = b.tch(3, "dc", S(ring))
    for _ in range(15):
        b.st("dc", S(ring))
    b.node("slst", [N(top)])
    b.end(joined=True, declared=16)
    # Rnd 2: ch 4 (counts as dc, ch 1), *dc in next st, ch 1* x15, join.
    prev = b.targets(0)
    b.begin("Rnd 2")
    top = b.tch(4, "dc", N(prev[0]))
    for t in prev[1:]:
        b.st("dc", N(t))
        b.ch(1)
    b.node("slst", [N(top)])
    b.end(joined=True, declared=16)
    # Rnd 3: sl st in next ch-1 sp, ch 3 (counts as dc), dc in same sp, ch 1, *2 dc in next ch-1 sp, ch 1* x15, join.
    sps = b.chsps(1)
    b.begin("Rnd 3")
    b.node("slst", [S(sps[0])])
    top = b.tch(3, "dc", S(sps[0]))
    b.st("dc", S(sps[0]))
    b.ch(1)
    for s in sps[1:]:
        b.st("dc", S(s))
        b.st("dc", S(s))
        b.ch(1)
    b.node("slst", [N(top)])
    b.end(joined=True, declared=32)
    # Rnd 4: sl st in next dc, sl st in next ch-1 sp, ch 1, sc in same sp, ch 4, *sc in next ch-1 sp, ch 4* x15, join.
    tg = b.targets(2)
    sps = b.chsps(2)
    b.begin("Rnd 4")
    b.node("slst", [N(tg[1])])
    b.node("slst", [S(sps[0])])
    b.tch(1)
    first = b.st("sc", S(sps[0]))
    b.ch(4)
    for s in sps[1:]:
        b.st("sc", S(s))
        b.ch(4)
    b.node("slst", [N(first)])
    b.end(joined=True, declared=16)
    # Rnd 5: sl st in next ch-4 sp, ch 5 (counts as dc, ch 2), dc in same sp, ch 1,
    #        *(dc, ch 2, dc) in next ch-4 sp, ch 1* x15, join.
    sps = b.chsps(3)
    b.begin("Rnd 5")
    b.node("slst", [S(sps[0])])
    top = b.tch(5, "dc", S(sps[0]))
    b.st("dc", S(sps[0]))
    b.ch(1)
    for s in sps[1:]:
        b.st("dc", S(s))
        b.ch(2)
        b.st("dc", S(s))
        b.ch(1)
    b.node("slst", [N(top)])
    b.end(joined=True, declared=32)
    # Rnd 6: sl st in next ch-2 sp, ch 1, (sc, picot, sc) in same sp, ch 4, *(sc, picot, sc) in next ch-2 sp, ch 4* x15, join.
    sps = b.chsps(4, length=2)
    b.begin("Rnd 6")
    b.node("slst", [S(sps[0])])
    b.tch(1)
    first = None
    for s in sps:
        a = b.st("sc", S(s))
        first = a if first is None else first
        b.picot(3)
        b.st("sc", S(s))
        b.ch(4)
    b.node("slst", [N(first)])
    b.end(joined=True, declared=32)
    return b.build()


def chain_space_motif() -> dict:
    b = PatternBuilder("Chain-space lace motif (8-fold loops)", params="thread-10_1.5mm")
    # Rnd 1: mr, ch 1, 8 sc in ring, join. (8)
    b.begin("Rnd 1")
    ring = b.magic_ring()
    b.tch(1)
    first = None
    for _ in range(8):
        a = b.st("sc", S(ring))
        first = a if first is None else first
    b.node("slst", [N(first)])
    b.end(joined=True, declared=8)
    # Rnd 2: ch 1, sc in same st, ch 3, *sc in next st, ch 3* x7, join.
    prev = b.targets(0)
    b.begin("Rnd 2")
    b.tch(1)
    first = None
    for t in prev:
        a = b.st("sc", N(t))
        first = a if first is None else first
        b.ch(3)
    b.node("slst", [N(first)])
    b.end(joined=True, declared=8)
    # Rnd 3: sl st in next ch-3 sp, ch 1, sc in same sp, ch 5, *sc in next ch-3 sp, ch 5* x7, join.
    sps = b.chsps(1)
    b.begin("Rnd 3")
    b.node("slst", [S(sps[0])])
    b.tch(1)
    first = None
    for s in sps:
        a = b.st("sc", S(s))
        first = a if first is None else first
        b.ch(5)
    b.node("slst", [N(first)])
    b.end(joined=True, declared=8)
    # Rnd 4: sl st in next ch-5 sp, ch 1, (sc, ch 3, sc) in same sp, ch 5, *(...) in next ch-5 sp, ch 5* x7, join.
    sps = b.chsps(2)
    b.begin("Rnd 4")
    b.node("slst", [S(sps[0])])
    b.tch(1)
    first = None
    for s in sps:
        a = b.st("sc", S(s))
        first = a if first is None else first
        b.ch(3)
        b.st("sc", S(s))
        b.ch(5)
    b.node("slst", [N(first)])
    b.end(joined=True, declared=16)
    return b.build()


FIXTURE_COUNTS = {
    "flat_sc_circle": [6, 12, 18, 24, 30, 36, 42, 48],
    "sc_sphere": [6, 12, 18, 24, 30, 30, 30, 30, 30, 30, 24, 18, 12, 6],
    "sc_cone": [6, 9, 12, 15, 18, 21, 24, 27],
    "hyperbolic_plane": [6, 12, 24, 36, 54, 81],
    "flat_dc_circle": [12, 24, 36, 48, 60],
}

SOLID_FIXTURES = tuple(FIXTURE_COUNTS)
LACE_FIXTURES = ("simple_doily", "chain_space_motif")


def builder_for_fixture(name: str, include_lace: bool = False) -> dict | None:
    """Builder graph for a canonical fixture; lace fixtures only with include_lace=True."""
    titles = {
        "flat_sc_circle": "Flat sc circle", "sc_sphere": "Sc sphere", "sc_cone": "Sc cone",
        "hyperbolic_plane": "Hyperbolic plane (sc, increasing 3/2 per round)",
        "flat_dc_circle": "Flat dc circle (joined rounds)",
    }
    if name == "flat_dc_circle":
        return dc_rounds_joined(FIXTURE_COUNTS[name], title=titles[name])
    if name in FIXTURE_COUNTS:
        return sc_rounds(FIXTURE_COUNTS[name], title=titles[name])
    if include_lace and name == "simple_doily":
        return simple_doily()
    if include_lace and name == "chain_space_motif":
        return chain_space_motif()
    return None


def round_counts(pattern: dict) -> list[int]:
    return [r["stitchCount"] for r in pattern["graph"]["rounds"]]


if __name__ == "__main__":  # pragma: no cover
    import sys

    print(json.dumps(builder_for_fixture(sys.argv[1], include_lace=True), indent=1))
