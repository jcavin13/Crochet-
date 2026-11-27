"""Rows, borders and polygons (SPEC_NOTES N8-N10, P9, "Per-region shape"): only pieces with rows,
`part` anchors or a run of polygon rounds get an outline layout (every canonical fixture and
snowflake reference keeps its network); the extra reference `blanket_border` has a frustration-
free flat layout, comes out flat in every region, and agrees with its committed lab.json (which
the app's outline.test.ts also checks its own result against)."""
import json
import math

import numpy as np
import pytest

from crolab import FIXTURES_DIR
from crolab import graph as G
from crolab.borders import border_lists
from crolab.compare import lab_diff
from crolab.export_network import extra_sources, sources
from crolab.fixtures import lab_record, regions_record
from crolab.metrics import classify_result
from crolab.network import build_network
from crolab.outline import POLY_MIN_RUN, make_poly, offset_poly, point_at
from crolab.regions import region_shape
from crolab.sim import network_energy, simulate

EXTRA = FIXTURES_DIR / "extra"


def _bb():
    return G.load(EXTRA / "blanket_border.graph.json")


def test_no_reference_but_blanket_border_has_an_outline():
    for name, p in sources() + extra_sources():
        net = build_network(G.load(p))
        if name == "blanket_border":
            assert net.outline is not None and net.outline.K == 4
        else:
            assert net.outline is None, name


def test_border_lists_match_the_compiler():
    """Corners of every border round (ported from app/src/core/graph/targets.ts)."""
    g = G.Graph(_bb())
    lists = border_lists(g)
    assert sorted(lists) == [6, 7, 8]
    corners = {r: [e["node"] for e in lst if e.get("corner")] for r, lst in lists.items()}
    # the corners the app compiler's borderLists gives (top corners of the last row, base chains)
    assert corners == {6: [76, 66, 10, 0], 7: [79, 91, 103, 115], 8: [130, 144, 158, 172]}


def test_rows_layout_is_a_rectangle_and_the_foundation_stretches():
    net = build_network(_bb())
    o = net.outline
    assert o.round_kind[:6] == ["foundation", "row", "row", "row", "row", "row"]
    dc = net.params.width("dc"), net.params.height("dc")
    assert len(o.span) == 11 and o.c[o.span[0]] == pytest.approx(dc[0])
    xs = [(o.qx[i] - o.c[i] / 2, o.qx[i] + o.c[i] / 2) for i in range(net.n_nodes) if o.has[i] and o.region[i] == 1 and o.c[i] > 0]
    assert max(b for _, b in xs) - min(a for a, _ in xs) == pytest.approx(11 * dc[0])
    assert o.body.V[0][1] == pytest.approx(5 * dc[1])


def test_reference_layout_is_flat_and_frustration_free_except_the_joins():
    net = build_network(_bb())
    o = net.outline
    X = np.full((net.n_particles, 3), np.nan)
    for i in range(net.n_nodes):
        if o.has[i]:
            X[i] = (o.qx[i], o.qy[i], 0.0)
    # every spring between two laid-out stitches is at rest; the only strained ones touch a joining
    # slip stitch (it bridges the stitch skipped before the join in the shell round)
    for a, b, L in zip(net.i, net.j, net.L):
        if a < net.n_nodes and b < net.n_nodes and o.has[a] and o.has[b]:
            if net.graph.nodes[a]["type"] == "slst" or net.graph.nodes[b]["type"] == "slst":
                continue
            assert math.dist(X[a], X[b]) == pytest.approx(L, rel=0.02, abs=1e-6), (a, b)
    assert network_energy(net, X) < 1.0


def test_mitred_offset_grows_a_square_by_8h():
    sq = make_poly([(0, 0), (10, 0), (10, 10), (0, 10)])
    big, e = offset_poly(sq, 2.0)
    assert big.P == pytest.approx(sq.P + 8 * 2.0)
    assert e == pytest.approx([2.0] * 4)
    assert point_at(big, 0.0) == pytest.approx((-2.0, -2.0))
    assert POLY_MIN_RUN == 2


@pytest.fixture(scope="module")
def bb_result():
    return simulate(_bb())


def test_blanket_border_lies_flat_in_every_region(bb_result):
    m = classify_result(bb_result)
    assert m["axis_kind"] == "pca" and m["class"] == "flat"
    rep = region_shape(bb_result.network, bb_result.positions)
    assert rep["kind"] == "rows" and rep["overall"] == "flat"
    assert [s["label"] for s in rep["sides"]] == ["Top edge", "Left side", "Bottom edge", "Right side"]
    assert all(abs(s["excess"]) < 0.02 for s in rep["sides"])


def test_blanket_border_lab_json_current(bb_result):
    rec, _ = lab_record("blanket_border", _bb(), "compiled", res=bb_result)
    rec["regions"] = regions_record(bb_result)
    ref = json.loads((EXTRA / "blanket_border.lab.json").read_text(encoding="utf-8"))
    assert not lab_diff(rec, ref)


def test_region_shape_is_none_without_an_outline():
    pat = G.load(G.fixture_graph_path("flat_sc_circle"))
    res = simulate(pat, gtol_round=1e-4, gtol_final=1e-5)
    assert region_shape(res.network, res.positions) is None
    assert classify_result(res)["axis_kind"] == "rounds" or classify_result(res)["class"] == "flat"
