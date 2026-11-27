"""`python -m crolab.export_network`: write the reference spring network of every canonical fixture
(and `spec/examples/tiny.graph.json`) to `spec/fixtures/<name>.network.json`.

This is the anti-drift contract between the lab network builder (`crolab.network`, metric
variant) and the TypeScript one (`app/src/core/sim/network.ts`): the app's vitest suite rebuilds
every network and compares it with these files; `tests/test_export_network.py` checks that the
committed files are current.

Format (compact, one spring per array):
  {"name", "params", "n_nodes", "n_particles", "n_springs", "counts": {kind: n},
   "springs": [[i, j, L, k, kind, slack], ...]}      # full list (tiny + the smallest fixtures)
or, for the larger fixtures, a deterministic summary instead of "springs":
   "summary": {"sum_L", "sum_k", "sum_iL", "sum_jk", "pairs_hash", "checksum"}
Springs are sorted by (i, j) with i < j; L and k are rounded to 1e-6 (`round(x, 6)`), slack is
0/1. `checksum` is an FNV-1a-32 hash over the text "i,j,L,k,kind,slack;" of every spring with
L and k printed with exactly 6 decimals; `pairs_hash` the same over "i,j,kind,slack;" only.

Options: --check (compare only, numerically with the tolerances of the TypeScript parity test;
exit 1 if a file is stale), --debug NAME (write lab growth dumps for NAME to stdout as JSON:
initial positions per round, per-round energies and the final metric; used when comparing the two
simulators' growth).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from . import FIXTURES_DIR, SPEC_DIR
from . import graph as G
from .compare import network_diff
from .network import KIND_NAMES, build_network

#: fixtures (besides tiny) whose full spring lists are stored; the rest get a summary
FULL_LIMIT_BYTES = 1_500_000
TINY = SPEC_DIR / "examples" / "tiny.graph.json"


def sources() -> list[tuple[str, Path]]:
    out = [("tiny", TINY)]
    for name in G.iter_fixture_names():
        p = G.fixture_graph_path(name)
        if p.exists():
            out.append((name, p))
    return out


def _r6(x: float) -> float:
    v = round(float(x), 6)
    return 0.0 if v == 0 else v


def fnv1a(text: str) -> int:
    h = 0x811C9DC5
    for b in text.encode("ascii"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def spring_rows(net) -> list[list]:
    rows = [[int(a), int(b), _r6(L), _r6(k), int(t), int(bool(s))]
            for a, b, L, k, t, s in zip(net.i, net.j, net.L, net.k, net.kind, net.slack)]
    rows.sort(key=lambda r: (r[0], r[1]))
    return rows


def summary(rows: list[list]) -> dict:
    full = "".join(f"{i},{j},{L:.6f},{k:.6f},{t},{s};" for i, j, L, k, t, s in rows)
    pairs = "".join(f"{i},{j},{t},{s};" for i, j, _, _, t, s in rows)
    return {
        "sum_L": _r6(sum(r[2] for r in rows)), "sum_k": _r6(sum(r[3] for r in rows)),
        "sum_iL": _r6(sum(r[0] * r[2] for r in rows)), "sum_jk": _r6(sum(r[1] * r[3] for r in rows)),
        "pairs_hash": fnv1a(pairs), "checksum": fnv1a(full),
    }


def record(name: str, pattern: dict, full: bool) -> dict:
    net = build_network(pattern)
    rows = spring_rows(net)
    counts = {KIND_NAMES[t]: int(np.sum(net.kind == t)) for t in range(len(KIND_NAMES))}
    rec = {"name": name, "params": net.params.id, "n_nodes": net.n_nodes, "n_particles": net.n_particles,
           "n_springs": len(rows), "counts": counts, "n_slack": int(net.slack.sum())}
    if full:
        rec["springs"] = rows
    else:
        rec["summary"] = summary(rows)
    return rec


def dumps(rec: dict) -> str:
    """Compact but diff-friendly: one top-level key per line, one spring per line."""
    lines = ["{"]
    keys = list(rec)
    for n, k in enumerate(keys):
        comma = "," if n + 1 < len(keys) else ""
        v = rec[k]
        if k == "springs":
            body = ",\n".join("  " + json.dumps(r, separators=(",", ":")) for r in v)
            lines.append(f' "springs": [\n{body}\n ]{comma}')
        else:
            lines.append(f" {json.dumps(k)}: {json.dumps(v, separators=(',', ':'))}{comma}")
    lines.append("}")
    return "\n".join(lines) + "\n"


def all_records() -> dict[str, dict]:
    """Full lists for tiny and the smallest fixtures while the total stays under FULL_LIMIT_BYTES;
    the order of decision is by node count (deterministic)."""
    srcs = sources()
    pats = {name: G.load(p) for name, p in srcs}
    order = sorted(srcs, key=lambda s: (0 if s[0] == "tiny" else 1, len(pats[s[0]]["graph"]["nodes"]), s[0]))
    out: dict[str, dict] = {}
    total = 0
    n_full = 0
    for name, _ in order:
        rec = record(name, pats[name], full=True)
        size = len(dumps(rec))
        # tiny + the three smallest fixtures always full; the rest only if the budget allows
        if name == "tiny" or n_full < 3 or total + size <= FULL_LIMIT_BYTES:
            if name != "tiny":
                n_full += 1
            total += size
        else:
            rec = record(name, pats[name], full=False)
            total += len(dumps(rec))
        out[name] = rec
    return out


def path_for(name: str) -> Path:
    return FIXTURES_DIR / f"{name}.network.json"


def debug_dump(name: str) -> dict:
    """Lab growth trace: positions right after placement of each round (before relaxation), the
    relaxed energy per round and the final metric."""
    from .metrics import classify_result, public
    from .params import load_sim_config
    from .sim import SimResult, _Placer, _relax_placed
    pat = G.load(TINY if name == "tiny" else G.fixture_graph_path(name))
    cfg = load_sim_config()
    net = build_network(pat, None, cfg)
    pl = _Placer(net, cfg)
    rounds = []
    for r in range(len(net.graph.rounds)):
        pl.place_round(r)
        mask = pl.placed_mask()
        X0 = pl.X.copy()
        X, E, ok, it = _relax_placed(net, pl.X, mask, 1e-6)
        pl.X[mask] = X[mask]
        rounds.append({"round": r, "placed": np.where(mask, 1, 0).tolist(),
                       "initial": [[round(float(v), 9) for v in row] if not np.isnan(row[0]) else None for row in X0],
                       "energy": float(E), "iterations": it})
    mask = pl.placed_mask()
    X, E, ok, it = _relax_placed(net, pl.X, mask, 1e-8)
    res = SimResult(positions=X, energy=E, converged=ok, strain=np.zeros(net.m), network=net, snapshots=[])
    return {"name": name, "rounds": rounds, "final_energy": float(E),
            "final_positions": [[round(float(v), 9) for v in row] for row in X],
            "metric": public(classify_result(res))}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="compare only, do not write")
    ap.add_argument("--debug", default="", help="print the lab growth trace of this fixture as JSON")
    a = ap.parse_args(argv)
    if a.debug:
        json.dump(debug_dump(a.debug), sys.stdout)
        return 0
    bad = 0
    total = 0
    for name, rec in all_records().items():
        text = dumps(rec)
        total += len(text)
        p = path_for(name)
        kind = "full" if "springs" in rec else "summary"
        if a.check:
            # numeric comparison (TypeScript parity tolerances), not bytes: docs/review.md R11
            cur = p.read_text(encoding="utf-8") if p.exists() else None
            diff = network_diff(rec, json.loads(cur)) if cur is not None else ["missing"]
            ok = not diff
            bad += not ok
            state = ("ok" if cur == text else "ok (within tolerance)") if ok else "STALE: " + "; ".join(diff[:3])
            print(f"{name:20s} {kind:8s} {rec['n_springs']:6d} springs  {state}")
        else:
            p.write_text(text, encoding="utf-8")
            print(f"{name:20s} {kind:8s} {rec['n_springs']:6d} springs  {len(text):8d} B")
    print(f"total {total} B")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
