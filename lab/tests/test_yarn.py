"""Yarn model (spec/yarn.md): hand-computed values, calibration, and the cross-language golden file."""
import json
import math

import pytest

from crolab import SPEC_DIR
from crolab import yarn as Y
from crolab.params import load_json

WORSTED = Y.param_set("worsted-4_5.0mm")
GOLDEN = load_json(Y.GOLDEN_PATH)


def L(node, pset=WORSTED, spec=None):
    return Y.node_length_mm(node, pset, Y.resolve_yarn(pset, spec))


def test_hand_computed_stitches():
    assert Y.resolve_yarn(WORSTED).diameter_mm == 2.5
    assert L({"type": "sc", "into": [{"node": 0}]}) == pytest.approx(2 * 6.5 + 2 * 6.175 + 3 * math.pi * 2.5, abs=1e-12)
    assert L({"type": "dc", "into": [{"node": 0}]}) == pytest.approx(2 * 6.5 + 3 * 12.35 + 5 * math.pi * 2.5, abs=1e-12)
    assert L({"type": "dc", "into": [{"node": 0}], "loop": "bp"}) == pytest.approx(1.2 * L({"type": "dc", "into": [{"node": 0}]}))


def test_monotonic_and_dc_sc_ratio():
    for s in load_json(SPEC_DIR / "stitch_params.json")["sets"]:
        xs = [L({"type": t, "into": [{"node": 0}]}, s) for t in ["slst", "sc", "hdc", "dc", "tr", "dtr"]]
        assert all(b > a for a, b in zip(xs, xs[1:]))
        assert 1.6 < xs[3] / xs[1] < 2.0


def test_tiny_example_total():
    e = Y.estimate(load_json(SPEC_DIR / "examples/tiny.graph.json"), WORSTED)
    assert e["net_m"] == pytest.approx((554.45 + 162.5 * math.pi) / 1000, abs=1e-12)
    assert sum(e["per_round_m"]) == pytest.approx(e["net_m"], abs=1e-12)
    assert e["total_m"] == pytest.approx(1.1 * e["net_m"])


def test_category_keys():
    assert Y.category_key("medium-4") == "medium-4"
    assert Y.category_key("thread-10") == "thread-10"
    assert Y.category_key("crochet cotton no. 20") == "thread-20"
    assert Y.category_key("dk-3") == "light-3"


def _synth(stitch, n, rows, kw, kh, d):
    lo, hi = Y.swatch_model(stitch, n, rows, WORSTED, d)
    return {"stitch": stitch, "stitches": n, "rows": rows, "grams": (kw * lo + kh * hi) * 100 / 180, "metersPer100g": 180}


def test_calibration_recovers_known_factors():
    d = Y.resolve_yarn(WORSTED).diameter_mm
    one = Y.calibrate([_synth("sc", 20, 20, 1.17, 1.17, d)], WORSTED, d)
    assert one["kind"] == "single" and one["factor"] == pytest.approx(1.17, abs=1e-12)
    two = Y.calibrate([_synth("sc", 20, 20, 0.9, 1.25, d), _synth("dc", 18, 10, 0.9, 1.25, d)], WORSTED, d)
    assert two["kind"] == "split"
    assert two["width"] == pytest.approx(0.9, abs=1e-9) and two["height"] == pytest.approx(1.25, abs=1e-9)


def test_fit_calibration_csv(tmp_path):
    d = Y.resolve_yarn(WORSTED).diameter_mm
    a, b = _synth("sc", 20, 20, 1.1, 1.3, d), _synth("dc", 20, 10, 1.1, 1.3, d)
    p = tmp_path / "cal.csv"
    p.write_text(
        "yarn,stitch,n_stitches,n_rows,grams,meters,m_per_100g,params\n"
        f"my-wool,sc,20,20,{a['grams']!r},,180,worsted-4_5.0mm\n"
        f"my-wool,dc,20,10,{b['grams']!r},,180,\n"
        "#skip,sc,1,1,1,,180,\n"
        "frogged,hdc,15,12,,14.2,,dk-3_4.0mm\n"
    )
    res = Y.fit_calibration(p)
    assert set(res) == {"my-wool", "frogged"}
    assert res["my-wool"]["kind"] == "split"
    assert res["my-wool"]["width"] == pytest.approx(1.1, abs=1e-9)
    assert res["my-wool"]["height"] == pytest.approx(1.3, abs=1e-9)
    assert res["frogged"]["kind"] == "single" and res["frogged"]["params"] == "dk-3_4.0mm"


def test_golden_file_is_current():
    """spec/yarn_golden.json must be what the code produces now (regenerate with --write-golden)."""
    fresh = json.loads(json.dumps(Y.golden()))
    assert fresh["nodes"] == GOLDEN["nodes"]
    for a, b in zip(fresh["node_cases"], GOLDEN["node_cases"], strict=True):
        assert a["params"] == b["params"] and a["yarn"] == b["yarn"]
        assert a["diameter_mm"] == pytest.approx(b["diameter_mm"], rel=1e-9, abs=1e-9)
        assert a["mm"] == pytest.approx(b["mm"], rel=1e-9, abs=1e-9)
    for a, b in zip(fresh["patterns"], GOLDEN["patterns"], strict=True):
        for k in ["net_m", "total_m", "low_m", "high_m", "net_g"]:
            assert a[k] == pytest.approx(b[k], rel=1e-9, abs=1e-9), (a["graph"], k)
        assert a["balls"] == b["balls"]
    for a, b in zip(fresh["swatch_cases"], GOLDEN["swatch_cases"], strict=True):
        assert a["result"]["kind"] == b["result"]["kind"]
        for k in ["factor", "width", "height"]:
            if k in b["result"]:
                assert a["result"][k] == pytest.approx(b["result"][k], rel=1e-9, abs=1e-9)
        for m, n in zip(a["model_loop_height_m"], b["model_loop_height_m"], strict=True):
            assert m == pytest.approx(n, rel=1e-9, abs=1e-9)


def test_golden_patterns_positive():
    assert len(GOLDEN["patterns"]) >= 15
    for c in GOLDEN["patterns"]:
        assert math.isfinite(c["net_m"]) and c["net_m"] > 0
        assert c["low_m"] < c["net_m"] < c["high_m"]
