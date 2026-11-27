"""Tolerant comparison of the committed reference files with freshly computed ones.

Exact byte equality of floating-point results is too strict across machines: OpenBLAS picks its
kernels per CPU and libm may differ in the last bit, so a value rounded to 4 (lab.json) or 6
(network.json) decimals can land on the other side of a rounding boundary (docs/review.md R11).
The writers still produce byte-identical files on one machine; only the *checks* are tolerant.
Strings, booleans and integers (classes, counts, node ids, kinds, hashes of integer data) are
compared exactly.
"""
from __future__ import annotations

import math

#: lab.json (values rounded to 4 decimals): two units of the last place, or 1e-3 relative
LAB_ABS = 2e-4
LAB_REL = 1e-3


def json_diff(a, b, rel: float = LAB_REL, abs_: float = LAB_ABS, path: str = "") -> list[str]:
    """Differences between two JSON values. Floats are equal within `abs_ + rel*|b|`; every other
    leaf (str, bool, int, None) must be equal exactly, and so must the structure."""
    out: list[str] = []
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            out.append(f"{path or '/'}: keys {sorted(set(a) ^ set(b))} differ")
        for k in a.keys() & b.keys():
            out += json_diff(a[k], b[k], rel, abs_, f"{path}/{k}")
        return out
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return [f"{path}: length {len(a)} != {len(b)}"]
        for n, (x, y) in enumerate(zip(a, b)):
            out += json_diff(x, y, rel, abs_, f"{path}/{n}")
        return out
    if isinstance(a, float) or isinstance(b, float):
        if isinstance(a, bool) or isinstance(b, bool) or not isinstance(a, (int, float)) \
                or not isinstance(b, (int, float)):
            return [f"{path}: {a!r} != {b!r}"]
        if not (math.isclose(a, b, rel_tol=rel, abs_tol=abs_) or (math.isnan(a) and math.isnan(b))):
            out.append(f"{path}: {a} != {b}")
        return out
    if type(a) is not type(b) or a != b:
        out.append(f"{path}: {a!r} != {b!r}")
    return out


def network_diff(cur: dict, ref: dict) -> list[str]:
    """Differences between two `*.network.json` records, with the tolerances the TypeScript parity
    test uses (`app/src/core/sim/network.test.ts`): spring rest length and stiffness within 1e-6
    relative plus the 5e-7 rounding of the file; summary sums within 5e-5 (sum_L, sum_k) and
    5e-3 (the index-weighted sums). Pairs, kinds, slack flags, counts and `pairs_hash` are exact.
    The summary `checksum` hashes the rounded text of L and k, so it is informational only."""
    out: list[str] = []
    skip = {"springs", "summary"}
    if set(cur) != set(ref):
        out.append(f"keys {sorted(set(cur) ^ set(ref))} differ")
    for k in (cur.keys() & ref.keys()) - skip:
        if cur[k] != ref[k]:
            out.append(f"{k}: {cur[k]!r} != {ref[k]!r}")
    if "springs" in cur and "springs" in ref:
        a, b = cur["springs"], ref["springs"]
        if len(a) != len(b):
            out.append(f"springs: {len(a)} != {len(b)}")
        for n, (r, e) in enumerate(zip(a, b)):
            same_ints = r[0] == e[0] and r[1] == e[1] and r[4] == e[4] and r[5] == e[5]
            ok_L = abs(r[2] - e[2]) <= 1e-6 * abs(e[2]) + 5.01e-7
            ok_k = abs(r[3] - e[3]) <= 1e-6 * abs(e[3]) + 5.01e-7
            if not (same_ints and ok_L and ok_k):
                out.append(f"springs[{n}]: {r} != {e}")
                if len(out) > 20:
                    out.append("...")
                    break
    if "summary" in cur and "summary" in ref:
        a, b = cur["summary"], ref["summary"]
        if a["pairs_hash"] != b["pairs_hash"]:
            out.append(f"summary.pairs_hash: {a['pairs_hash']} != {b['pairs_hash']}")
        for k, tol in (("sum_L", 5e-5), ("sum_k", 5e-5), ("sum_iL", 5e-3), ("sum_jk", 5e-3)):
            if abs(a[k] - b[k]) > tol:
                out.append(f"summary.{k}: {a[k]} != {b[k]}")
    return out


#: Cross-machine tolerances for the simulated shape metrics in lab.json. The energy landscape of
#: a spring network is multistable, so last-bit differences between CPUs / BLAS builds grow into
#: differences of a few 1e-3 in A and W (seen on GitHub's runners). These bounds are well inside
#: the cross-sim agreement tolerance (sim_config agree_abs = 0.12) and far from any class change.
METRIC_ABS = {"A": 0.03, "W": 0.03}
METRIC_REL = {"Rg": 0.02, "outer_radius": 0.02}


def lab_diff(cur: dict, ref: dict, path: str = "") -> list[str]:
    """Differences between two lab.json records that matter on any machine: structure, names,
    node counts and shape classes exactly; A, W within METRIC_ABS; Rg, outer_radius within
    METRIC_REL. `energy` is machine-dependent near a bifurcation and is not compared."""
    out: list[str] = []
    if set(cur) != set(ref):
        out.append(f"{path or '/'}: keys {sorted(set(cur) ^ set(ref))} differ")
    for k in cur.keys() & ref.keys():
        a, b, here = cur[k], ref[k], f"{path}/{k}"
        if k == "energy":
            continue
        if k in METRIC_ABS:
            if abs(a - b) > METRIC_ABS[k]:
                out.append(f"{here}: {a} != {b}")
        elif k in METRIC_REL:
            if abs(a - b) > METRIC_REL[k] * max(abs(b), 1e-9):
                out.append(f"{here}: {a} != {b}")
        elif isinstance(a, list) and isinstance(b, list):
            if len(a) != len(b):
                out.append(f"{here}: length {len(a)} != {len(b)}")
            for n, (x, y) in enumerate(zip(a, b)):
                out += lab_diff(x, y, f"{here}/{n}") if isinstance(x, dict) else json_diff(x, y, path=f"{here}/{n}")
        elif a != b:
            out.append(f"{here}: {a!r} != {b!r}")
    return out
