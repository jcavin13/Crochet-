"""The committed reference networks `spec/fixtures/<name>.network.json` are current (run
`python -m crolab.export_network` after changing `crolab.network`): the TypeScript sim is tested
against these files, so a stale file would let the two sims drift apart silently."""
import json

import pytest

from crolab.compare import network_diff
from crolab.export_network import all_records, dumps, fnv1a, path_for, summary

RECORDS = all_records()


@pytest.mark.parametrize("name", sorted(RECORDS))
def test_network_reference_current(name):
    p = path_for(name)
    assert p.exists(), f"missing {p}; run python -m crolab.export_network"
    # numeric comparison with the TypeScript parity tolerances, not bytes: a last-bit libm
    # difference on another machine must not fail CI (docs/review.md R11)
    diff = network_diff(RECORDS[name], json.loads(p.read_text(encoding="utf-8")))
    assert not diff, f"{p.name} is stale: " + "; ".join(diff[:5])


def test_network_diff_tolerance():
    ref = {"name": "x", "n_springs": 1, "springs": [[0, 1, 6.5, 0.35, 0, 0]]}
    near = {"name": "x", "n_springs": 1, "springs": [[0, 1, 6.500001, 0.35, 0, 0]]}
    far = {"name": "x", "n_springs": 1, "springs": [[0, 1, 6.50002, 0.35, 0, 0]]}
    kind = {"name": "x", "n_springs": 1, "springs": [[0, 1, 6.5, 0.35, 1, 0]]}
    assert network_diff(near, ref) == []
    assert network_diff(far, ref) and network_diff(kind, ref)
    s = {"sum_L": 10.0, "sum_k": 2.0, "sum_iL": 100.0, "sum_jk": 50.0, "pairs_hash": 7, "checksum": 1}
    assert network_diff({"summary": dict(s, sum_L=10.00001, checksum=2)}, {"summary": s}) == []
    assert network_diff({"summary": dict(s, pairs_hash=8)}, {"summary": s})
    assert network_diff({"summary": dict(s, sum_L=10.001)}, {"summary": s})


def test_reference_covers_tiny_and_fixtures():
    assert "tiny" in RECORDS and "springs" in RECORDS["tiny"]
    assert sum("springs" in r for r in RECORDS.values()) >= 4
    for rec in RECORDS.values():
        assert rec["n_springs"] == sum(rec["counts"].values())
        if "springs" in rec:
            rows = rec["springs"]
            assert rows == sorted(rows, key=lambda r: (r[0], r[1]))
            assert all(r[0] < r[1] for r in rows)
            assert json.loads(dumps(rec)) == rec


def test_summary_checksum_stable():
    rows = [[0, 1, 1.5, 0.35, 0, 1], [0, 2, 2.0, 1.0, 1, 0]]
    s = summary(rows)
    assert s["checksum"] == fnv1a("0,1,1.500000,0.350000,0,1;0,2,2.000000,1.000000,1,0;")
    assert fnv1a("") == 0x811C9DC5
