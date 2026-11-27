import math

import pytest

from conftest import ALL, fixture_pattern
from crolab import builders as B
from crolab import graph as G
from crolab.flatness import analyse


@pytest.mark.parametrize("name", ALL)
@pytest.mark.parametrize("source", ["fixture", "builder"])
def test_analytic_flatness(name, source):
    p = fixture_pattern(name)[0] if source == "fixture" else B.builder_for_fixture(name, include_lace=True)
    exp = G.load_expected(name)["analytic"]
    fl = analyse(p)
    rows = [r for r in fl["rounds"] if r["class"] != "n/a"]
    assert fl["final"] == exp["final"]
    if "rounds" in exp:
        assert len(rows) == len(exp["rounds"])
        for got, want in zip(rows, exp["rounds"]):
            assert got["class"] == want["class"], (got["label"], got, want)
            assert got["e"] == pytest.approx(want["excess"], abs=0.01)
            if want["class"] != "flat":
                assert got["stitches_off"] == pytest.approx(want["stitches_off"], abs=0.15)
    else:  # lace: every round flat
        assert all(r["class"] == "flat" for r in rows), [(r["label"], r["e_min"], r["e_max"]) for r in rows]


def test_rows_not_applicable():
    fl = analyse(B.rect_rows("sc", 10, 5))
    assert not fl["applicable"] and all(r["class"] == "n/a" for r in fl["rounds"])


def test_messages_and_g():
    fl = analyse(B.builder_for_fixture("hyperbolic_plane"))
    r3 = fl["rounds"][2]
    assert r3["message"].startswith("Rnd 3 will ruffle: about 6 stitches over flat (+")
    assert math.isnan(fl["rounds"][0]["g"])
    tube = analyse(B.sc_rounds([6, 12, 18, 18, 18]))["rounds"]
    assert tube[3]["g"] == pytest.approx(-1.0)
