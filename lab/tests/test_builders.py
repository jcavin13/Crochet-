import pytest

from crolab import builders as B
from crolab import graph as G
from crolab.graph import Graph

SOLID = list(B.SOLID_FIXTURES)


@pytest.mark.parametrize("name", SOLID + list(B.LACE_FIXTURES))
def test_builder_schema_and_counts(name):
    p = B.builder_for_fixture(name, include_lace=True)
    G.validate(p)
    assert B.round_counts(p) == [r["stitches"] for r in G.load_expected(name)["rounds"]]


@pytest.mark.parametrize("name", sorted(G.iter_fixture_names()))
def test_compiled_graph_counts(name):
    path = G.fixture_graph_path(name)
    if not path.exists():
        pytest.skip("no compiled graph")
    p = G.load(path)
    gr = Graph(p)
    counts = [gr.stitch_count(r) for r in range(len(gr.rounds))]
    assert counts == [r["stitches"] for r in G.load_expected(name)["rounds"]]
    assert counts == [r["stitchCount"] for r in p["graph"]["rounds"]]


def _strip(p):
    g = p["graph"]
    nodes = [{k: v for k, v in n.items() if k not in ("src", "group")} for n in g["nodes"]]
    rounds = [{k: v for k, v in r.items() if k not in ("src", "label")} for r in g["rounds"]]
    return nodes, g["spaces"], rounds


@pytest.mark.parametrize("name", sorted(G.iter_fixture_names()))
def test_builder_matches_compiled_structure(name):
    path = G.fixture_graph_path(name)
    if not path.exists():
        pytest.skip("no compiled graph")
    a, b = _strip(G.load(path)), _strip(B.builder_for_fixture(name, include_lace=True))
    assert a == b


def test_other_builders_valid():
    for p in (B.hyperbolic(6, 1.5, 5), B.hyperbolic(6, 1.2, 6, lead=(1,)), B.rect_rows("sc", 8, 5),
              B.rect_rows("dc", 6, 4), B.dc_rounds_joined([12, 24]), B.sc_rounds([8, 16, 24], stitch="hdc")):
        G.validate(p)
    assert B.hyperbolic_counts() == [6, 12, 24, 36, 54, 81]
    r = B.rect_rows("dc", 6, 4)
    assert B.round_counts(r) == [0, 6, 6, 6, 6]
    assert [x["kind"] for x in r["graph"]["rounds"]] == ["foundation", "row", "row", "row", "row"]
