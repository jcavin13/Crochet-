"""Loading, validating and querying stitch-graph pattern JSON (`spec/pattern.schema.json`)."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Mapping

from . import FIXTURES_DIR, SPEC_DIR

SCHEMA_PATH = SPEC_DIR / "pattern.schema.json"

#: Node types that never count as a stitch (notation.md 3.3 / 3.8).
NON_COUNTING = frozenset({"ch", "slst", "picot"})


@lru_cache(maxsize=1)
def _schema() -> dict:
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        return json.load(f)


def validate(pattern: Mapping) -> None:
    """Raise jsonschema.ValidationError if the pattern is not schema-valid, ValueError on id inconsistencies."""
    import jsonschema

    jsonschema.validate(pattern, _schema())
    g = pattern["graph"]
    for i, n in enumerate(g["nodes"]):
        if n["id"] != i:
            raise ValueError(f"node at index {i} has id {n['id']}")
    for i, s in enumerate(g["spaces"]):
        if s["id"] != i:
            raise ValueError(f"space at index {i} has id {s['id']}")


def load(path: Path | str, check: bool = True) -> dict:
    with open(path, encoding="utf-8") as f:
        p = json.load(f)
    if check:
        validate(p)
    return p


def fixture_graph_path(name: str) -> Path:
    return FIXTURES_DIR / f"{name}.graph.json"


def load_expected(name: str) -> dict:
    with open(FIXTURES_DIR / f"{name}.expected.json", encoding="utf-8") as f:
        return json.load(f)


class Graph:
    """Convenience view over a pattern dict. Pure accessors; no physics."""

    def __init__(self, pattern: Mapping):
        self.pattern = pattern
        g = pattern["graph"]
        self.nodes: list[dict] = g["nodes"]
        self.spaces: list[dict] = g["spaces"]
        self.rounds: list[dict] = g["rounds"]
        self.n = len(self.nodes)
        # chain node id -> space id (chains of chain spaces and chain rings)
        self.chain_space: dict[int, int] = {}
        for s in self.spaces:
            for c in s["chains"]:
                self.chain_space[c] = s["id"]

    # ---- node classification ----------------------------------------------------------
    def counts_as_stitch(self, i: int) -> bool:
        n = self.nodes[i]
        if n.get("countsAs"):
            return True
        if n.get("role") == "tch":
            return False
        return n["type"] not in NON_COUNTING

    def effective_type(self, i: int) -> str:
        """Stitch type a node acts as for height (and flatness width): countsAs if present."""
        n = self.nodes[i]
        return n.get("countsAs") or n["type"]

    def is_magic_ring(self, s: int) -> bool:
        sp = self.spaces[s]
        return sp["kind"] == "ring" and len(sp["chains"]) == 0

    # ---- rounds -----------------------------------------------------------------------
    def round_nodes(self, r: int) -> list[int]:
        rd = self.rounds[r]
        if rd["first"] < 0:
            return []
        return list(range(rd["first"], rd["last"] + 1))

    def round_of(self, i: int) -> int:
        return self.nodes[i]["round"]

    def stitch_nodes(self, r: int) -> list[int]:
        return [i for i in self.round_nodes(r) if self.counts_as_stitch(i)]

    def stitch_count(self, r: int) -> int:
        return len(self.stitch_nodes(r))

    def round_spaces(self, r: int, kind: str | None = None) -> list[dict]:
        return [s for s in self.spaces if s["round"] == r and (kind is None or s["kind"] == kind)]

    def is_worked_in_round(self, r: int) -> bool:
        return self.rounds[r]["kind"] == "round"

    # ---- anchors ----------------------------------------------------------------------
    def anchors(self, i: int) -> list[dict]:
        return self.nodes[i]["into"]

    def nodes_in_space(self, s: int) -> list[int]:
        """Distinct nodes anchored in space s, in working order."""
        out = []
        seen = set()
        for n in self.nodes:
            for a in n["into"]:
                if a.get("space") == s and n["id"] not in seen:
                    seen.add(n["id"])
                    out.append(n["id"])
        return out

    def ring_spaces(self) -> list[int]:
        return [s["id"] for s in self.spaces if s["kind"] == "ring"]

    def magic_rings(self) -> list[int]:
        return [s["id"] for s in self.spaces if self.is_magic_ring(s["id"])]


def iter_fixture_names() -> Iterable[str]:
    for p in sorted(FIXTURES_DIR.glob("*.expected.json")):
        yield p.name[: -len(".expected.json")]


def dumps(obj: Any) -> str:
    return json.dumps(obj, indent=1, ensure_ascii=False) + "\n"
