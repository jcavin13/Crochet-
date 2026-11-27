"""Every canonical fixture reproduces its expected shape class; builder and compiled graphs of
the same fixture agree; lab.json files are reproducible."""
import json

import pytest

from conftest import ALL, fixture_pattern
from crolab import FIXTURES_DIR
from crolab import graph as G
from crolab.builders import SOLID_FIXTURES
from crolab.compare import json_diff, lab_diff
from crolab.fixtures import dumps, lab_record
from crolab.metrics import classify_result
from crolab.params import load_sim_config

CFG = load_sim_config()
#: about 2x the largest total iteration count of a fixture (flat_dc_circle, 26.6k)
MAX_ITERATIONS = 60_000


@pytest.mark.parametrize("name", ALL)
def test_fixture_shape_class(name, sim_cache):
    _, src = fixture_pattern(name)
    pat, res = sim_cache(name, src)
    m = classify_result(res)
    # `converged` (gradient below gtol within the iteration cap) is machine-dependent for the
    # flattest fixtures, which creep along a near-zero-energy valley; the class must not be.
    if not res.converged:
        import warnings
        warnings.warn(f"{name}: solver stopped at the iteration cap ({res.iterations} iterations)")
    # Work budget instead of wall-clock time, which flaked on loaded machines (docs/review.md R5).
    # Total L-BFGS iterations are 3.8k-27k for the fixtures; the bound catches a solver that
    # stops converging. The wall-clock guard only catches hangs (typically 0.5-5 s per fixture).
    assert res.iterations <= MAX_ITERATIONS, res.iterations
    assert res.seconds < 900
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
    _, src = fixture_pattern(name)
    pat, res = sim_cache(name, src)
    rec, _ = lab_record(name, pat, src, res)
    # classes and counts exactly, metrics within the cross-machine tolerances of crolab.compare:
    # on another CPU the solver lands a few 1e-3 away in A and W (docs/review.md R11; seen in CI)
    diff = lab_diff(rec, json.loads(path.read_text()))
    assert not diff, f"{path.name} is stale (run `make lab-fixtures`): " + "; ".join(diff[:5])


def test_lab_diff_tolerance():
    ref = {"class": "flat", "A": 0.1, "Rg": 20.0, "energy": 1.0, "n_nodes": 10,
           "per_round": [{"round": 0, "class": "cup", "W": 0.5}]}
    assert lab_diff(dict(ref, A=0.12, Rg=20.3, energy=9.0), ref) == []
    assert lab_diff(dict(ref, A=0.14), ref)
    assert lab_diff(dict(ref, Rg=21.0), ref)
    assert lab_diff(dict(ref, n_nodes=11), ref)
    assert lab_diff(dict(ref, **{"class": "cup"}), ref)
    assert lab_diff(dict(ref, per_round=[{"round": 0, "class": "flat", "W": 0.5}]), ref)


def test_json_diff_tolerance():
    ref = {"class": "flat", "A": 0.1234, "n_nodes": 10, "per_round": [{"class": "cup", "W": 0.5}]}
    assert json_diff(dict(ref, A=0.1235), ref) == []
    assert json_diff(dict(ref, A=0.1250), ref)
    assert json_diff(dict(ref, n_nodes=11), ref)
    assert json_diff(dict(ref, per_round=[{"class": "flat", "W": 0.5}]), ref)
    assert json_diff(dict(ref, A=1), dict(ref, A=1.0)) == []


def test_determinism_two_runs():
    name = "sc_cone"
    pat, src = fixture_pattern(name)
    a, _ = lab_record(name, pat, src)
    b, _ = lab_record(name, pat, src)
    assert dumps(a) == dumps(b)


def test_solid_list():
    assert set(SOLID_FIXTURES) | {"simple_doily", "chain_space_motif"} == set(ALL)
