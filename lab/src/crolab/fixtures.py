"""`python -m crolab.fixtures`: simulate every canonical fixture and write the lab reference
metrics `spec/fixtures/<name>.lab.json` (physics.md §5). Uses the compiled graph
`<name>.graph.json` when present, else the lab builder (solid fixtures only; lace fixtures
without a compiled graph are skipped). Exits non-zero if a class differs from expected.json.

Options: --check (do not write; also compare with the committed lab.json, floats within the
tolerance of `crolab.compare`, and exit non-zero if one is stale), --only NAME[,NAME].
"""
from __future__ import annotations

import argparse
import json
import sys
import time

from . import FIXTURES_DIR
from . import graph as G
from .compare import lab_diff
from .builders import builder_for_fixture
from .metrics import classify_result, public
from .sim import simulate


def r4(x: float) -> float:
    v = round(float(x), 4)
    return 0.0 if v == 0 else v


def fixture_pattern(name: str, allow_lace_builder: bool = False) -> tuple[dict | None, str]:
    p = G.fixture_graph_path(name)
    if p.exists():
        return G.load(p), "compiled"
    b = builder_for_fixture(name, include_lace=allow_lace_builder)
    return b, "builder"


def lab_record(name: str, pattern: dict, source: str, res=None) -> tuple[dict, object]:
    """The lab.json record of a fixture; `res` reuses an existing `simulate(pattern)` result."""
    res = simulate(pattern) if res is None else res
    m = public(classify_result(res))
    per_round = []
    for r in range(len(res.snapshots)):
        mr = classify_result(res, upto=r)
        per_round.append({"round": r, "class": mr["class"], "A": r4(mr["A"]), "W": r4(mr["W"]), "Rg": r4(mr["Rg"])})
    rec = {
        "name": name, "source": source, "class": m["class"], "A": r4(m["A"]), "W": r4(m["W"]),
        "Rg": r4(m["Rg"]), "outer_radius": r4(m["outer_radius"]), "n_nodes": res.network.n_nodes,
        "energy": r4(res.energy), "per_round": per_round,
    }
    return rec, res


def dumps(rec: dict) -> str:
    return json.dumps(rec, indent=1, ensure_ascii=False) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="compare only, do not write")
    ap.add_argument("--only", default="")
    a = ap.parse_args(argv)
    names = [n for n in G.iter_fixture_names() if not a.only or n in a.only.split(",")]
    bad = 0
    print(f"{'fixture':20s} {'source':9s} {'expected':8s} {'got':8s} {'A':>7s} {'W':>7s} {'Rg':>7s} {'time':>6s}")
    for name in names:
        exp = G.load_expected(name)
        pat, src = fixture_pattern(name)
        if pat is None:
            print(f"{name:20s} skipped (no compiled graph; lace fixtures need the app compiler)")
            continue
        t0 = time.perf_counter()
        rec, _ = lab_record(name, pat, src)
        dt = time.perf_counter() - t0
        ok = rec["class"] == exp["shape"]
        bad += not ok
        note = "" if ok else "   <-- MISMATCH"
        if a.check:
            path = FIXTURES_DIR / f"{name}.lab.json"
            diff = lab_diff(rec, json.loads(path.read_text(encoding="utf-8"))) if path.exists() else ["missing"]
            if diff:
                bad += 1
                note += "   <-- STALE " + "; ".join(diff[:3])
        print(f"{name:20s} {src:9s} {exp['shape']:8s} {rec['class']:8s} {rec['A']:7.4f} {rec['W']:7.4f} {rec['Rg']:7.2f} {dt:5.1f}s"
              + note)
        if not a.check:
            (FIXTURES_DIR / f"{name}.lab.json").write_text(dumps(rec), encoding="utf-8")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
