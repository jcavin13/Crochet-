"""Border rounds worked around rows (notation.md 3.9): the perimeter target list of the first
border round and the corners of every border round — a port of `borderLists` and its helpers in
`app/src/core/graph/targets.ts` (the TypeScript compiler is the only notation parser; corners are
not stored in the graph, they are derived from its structure, the same rule on both sides).

An entry is a dict {"kind": "stitch"|"space"|"rowEnd"|"base", "node"|"space": id, "row"?: r,
"side"?: 0..3, "corner"?: True}.
"""
from __future__ import annotations

from .graph import Graph


def node_counts(n: dict) -> bool:
    """Does this node count as a stitch (target for the next round)? (notation.md 3.3 / 3.8)"""
    if n["type"] == "ch":
        return bool(n.get("countsAs"))
    return n["type"] not in ("slst", "picot")


def build_targets(nodes: list, spaces: list, r: int, first: int, last: int) -> list[dict]:
    items: list[tuple[int, dict]] = []
    if first >= 0:
        for i in range(first, last + 1):
            if node_counts(nodes[i]):
                items.append((i, {"kind": "stitch", "node": i}))
    for s in spaces:
        if s["round"] == r and s["kind"] == "chsp" and s["chains"]:
            items.append((s["chains"][0], {"kind": "space", "space": s["id"]}))
    items.sort(key=lambda x: x[0])
    return [e for _, e in items]


def entry_key(e: dict) -> str:
    """Identity of the anchor a stitch worked into entry e gets ("n12", "n12:side", "s3")."""
    if e["kind"] == "space":
        return f"s{e['space']}"
    if e["kind"] == "rowEnd":
        return f"n{e['node']}:side"
    if e["kind"] == "base":
        return f"n{e['node']}:base"
    return f"n{e['node']}"


def anchor_key(a: dict) -> str:
    if "space" in a:
        return f"s{a['space']}"
    return f"n{a['node']}:{a['part']}" if a.get("part") else f"n{a['node']}"


def _entry_anchor(e: dict) -> dict:
    if e["kind"] == "space":
        return {"space": e["space"]}
    if e["kind"] == "rowEnd":
        return {"node": e["node"], "part": "side"}
    if e["kind"] == "base":
        return {"node": e["node"], "part": "base"}
    return {"node": e["node"]}


def _edges(nodes: list, R: dict):
    if R["first"] < 0:
        return None
    start = end = -1
    for i in range(R["first"], R["last"] + 1):
        if node_counts(nodes[i]):
            if start < 0:
                start = i
            end = i
    return None if start < 0 else (start, end)


def perimeter_targets(nodes: list, spaces: list, rounds: list, last_row: int) -> list[dict]:
    first_row = last_row
    while first_row - 1 >= 0 and rounds[first_row - 1]["kind"] == "row":
        first_row -= 1
    R = rounds[last_row]
    top = [dict(e, side=0) for e in reversed(build_targets(nodes, spaces, last_row, R["first"], R["last"]))]
    side_a, side_b = [], []
    for k in range(last_row, first_row - 1, -1):
        ed = _edges(nodes, rounds[k])
        if ed:
            side_a.append({"kind": "rowEnd", "node": ed[0] if (last_row - k) % 2 == 0 else ed[1], "row": k, "side": 1})
    for k in range(first_row, last_row + 1):
        ed = _edges(nodes, rounds[k])
        if ed:
            side_b.append({"kind": "rowEnd", "node": ed[1] if (last_row - k) % 2 == 0 else ed[0], "row": k, "side": 3})
    bottom: list[dict] = []
    R1 = rounds[first_row]
    if R1["first"] >= 0:
        worked: list[int] = []
        for i in range(R1["first"], R1["last"] + 1):
            n = nodes[i]
            if n["type"] == "ch" and not n.get("countsAs"):
                continue
            for a in n["into"]:
                if "node" in a and not a.get("part") and nodes[a["node"]]["type"] == "ch" and not nodes[a["node"]].get("countsAs"):
                    worked.append(a["node"])
        if worked:
            lo, hi = min(worked), max(worked)
            ids = [i for i in range(lo, hi + 1) if nodes[i]["type"] == "ch"]
            row_order = list(reversed(ids)) if worked[0] > worked[-1] else ids
            ed = _edges(nodes, R1)
            a_has_start = (last_row - first_row) % 2 == 0
            order = row_order if (ed and a_has_start) else list(reversed(row_order))
            bottom = [{"kind": "base", "node": i, "side": 2} for i in order]

    def mark_ends(xs: list[dict], ok) -> None:
        idx = [i for i, e in enumerate(xs) if ok(e)]
        if idx:
            xs[idx[0]]["corner"] = True
            xs[idx[-1]]["corner"] = True

    mark_ends(top, lambda e: e["kind"] == "stitch")
    mark_ends(bottom, lambda e: True)
    return top + side_a + bottom + side_b


def corner_targets(nodes: list, spaces: list, r: int, R: dict, input_corners: list[dict]) -> list[dict]:
    lst = build_targets(nodes, spaces, r, R["first"], R["last"])
    if R["first"] < 0:
        return lst
    pos = {(f"s{e['space']}" if e["kind"] == "space" else f"n{e['node']}"): i for i, e in enumerate(lst)}
    for c in input_corners:
        key = anchor_key(c)
        group = [i for i in range(R["first"], R["last"] + 1)
                 if node_counts(nodes[i]) and any(anchor_key(a) == key for a in nodes[i]["into"])]
        if not group:
            continue
        lo, hi = group[0], group[-1]
        inside = [s for s in spaces if s["round"] == r and s["kind"] == "chsp" and s["chains"]
                  and s["chains"][0] > lo and s["chains"][-1] < hi]
        k = pos.get(f"s{inside[(len(inside) - 1) // 2]['id']}") if inside else pos.get(f"n{group[len(group) // 2]}")
        if k is not None:
            lst[k] = dict(lst[k], corner=True)
    return lst


def border_lists(g: Graph) -> dict[int, list[dict]]:
    """For every border round (a round worked into a list with corners), that list in the order
    the round walked it (targets.ts `borderLists`)."""
    out: dict[int, list[dict]] = {}
    rounds = g.rounds
    for r in range(1, len(rounds)):
        prev, R = rounds[r - 1], rounds[r]
        lst = None
        if prev["kind"] == "row" and R["kind"] == "round":
            lst = perimeter_targets(g.nodes, g.spaces, rounds, r - 1)
        elif r - 1 in out:
            in_corners = [_entry_anchor(e) for e in out[r - 1] if e.get("corner")]
            lst = corner_targets(g.nodes, g.spaces, r - 1, prev, in_corners)
            if R.get("turned"):
                lst = list(reversed(lst))
        if lst and any(e.get("corner") for e in lst):
            out[r] = lst
    return out
