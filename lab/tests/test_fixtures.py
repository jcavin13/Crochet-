"""Every canonical fixture reproduces its expected shape class; builder and compiled graphs of
the same fixture agree; lab.json files are reproducible."""
import json

import pytest

from conftest import ALL, fixture_pattern
from crolab import FIXTURES_DIR
from crolab import graph as G
from crolab.builders import SOLID_FIXTURES
from crolab.fixtures import dumps, lab_record
from crolab.metrics import classify_result
from crolab.params import load_sim_config

CFG = load_sim_config()


@pytest.mark.parametrize("name", ALL)
def test_fixture_shape_class(name, sim_cache):
    _, src = fixture_pattern(name)
    pat, res = sim_cache(name, src)
    m = classify_result(res)
    assert res.converged
    assert res.seconds < 60   # typically <= 7 s; generous for loaded CI machines
    assert m["class"] == G.load_expected(name)["shape"], m


@pytest.mark.parametrize("name", ALL)
def test_builder_and_compiled_agree(name, sim_cache):
    if not G.fixture_graph_path(name).exists():
        pytest.skip("no compiled graph")
    mc = classify_result(sim_cache(name, "compiled")[1])
    mb = classify_result(sim_cache(name, "builder")[1])
    assert mc["class"] == mb["class"]
    assert abs(mc["A"] - mb["A"]) <= CFG["agree_abs"] and abs(mc["W"] - mb["W"]) <= CFG["agree_abs"]
    assert abs(mc["Rg"] - mb["Rg"]) <= CFG["agree_rg_rel"] * mc["Rg"]


@pytest.mark.parametrize("name", ALL)
def test_lab_json_up_to_date(name, sim_cache):
    """The committed lab.json equals what the current code produces (run `make lab-fixtures`)."""
    path = FIXTURES_DIR / f"{name}.lab.json"
    if not path.exists():
        pytest.skip("no lab.json yet")
    pat, src = fixture_pattern(name)
    rec, _ = lab_record(name, pat, src)
    assert json.loads(path.read_text()) == rec


def test_determinism_two_runs():
    name = "sc_cone"
    pat, src = fixture_pattern(name)
    a, _ = lab_record(name, pat, src)
    b, _ = lab_record(name, pat, src)
    assert dumps(a) == dumps(b)


def test_solid_list():
    assert set(SOLID_FIXTURES) | {"simple_doily", "chain_space_motif"} == set(ALL)
