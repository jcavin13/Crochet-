"""Spring network on spec/examples/tiny.graph.json, hand-computed (worsted-4_5.0mm set:
sc w 6.5 h 6.175 s 1; dc h 12.35 s 0.8; ch w 4.55 s 0.35; slst w 3.25 h 1.3)."""
import math

import pytest

from crolab import SPEC_DIR
from crolab import graph as G
from crolab.network import BEND_COURSE, BEND_WALE, COURSE, SHEAR, WALE, build_network

TINY = G.load(SPEC_DIR / "examples" / "tiny.graph.json")


@pytest.fixture(scope="module", params=["spec", "metric"])
def net(request):
    return build_network(TINY, variant=request.param)


def spring(net, a, b):
    return net.pairs()[(min(a, b), max(a, b))]


def test_particles(net):
    assert net.n_nodes == 26 and net.n_particles == 27       # one virtual magic-ring particle
    assert net.space_particle == {0: 26}
    assert net.anchor_particles[17] == [8] and net.anchor_particles[18] == [8]   # ch-1 sp -> its chain
    assert net.anchor_particles[0] == [26] and net.anchor_particles[7] == [0]


def test_ring_and_wales(net):
    # magic ring: max(h_sc, 4 * 6.5 / 2pi = 4.14) = 6.175
    for i in range(4):
        L, k, t = spring(net, i, 26)
        assert t == WALE and L == pytest.approx(6.175) and k == pytest.approx(1.0)
    L, k, t = spring(net, 7, 0)                # tch top counts as dc: h_dc, k_wale * s_dc
    assert t == WALE and L == pytest.approx(12.35) and k == pytest.approx(0.8)
    L, k, t = spring(net, 4, 0)                # join slip stitch
    assert t == WALE and L == pytest.approx(1.3)
    assert spring(net, 17, 8)[2] == WALE
    if net.slack.any():   # metric: reference cell, the two sc in one ch-1 sp lean apart
        assert spring(net, 17, 8)[0] == pytest.approx(spring(net, 18, 8)[0]) and spring(net, 17, 8)[0] > 6.175
    else:
        assert spring(net, 17, 8)[0] == pytest.approx(6.175)


def test_course_and_bends_spec():
    net = build_network(TINY, variant="spec")
    assert spring(net, 0, 1) == pytest.approx((6.5, 1.0, COURSE))
    assert spring(net, 3, 4) == pytest.approx((4.875, 1.0, COURSE))
    assert spring(net, 4, 5) == pytest.approx((3.9, 0.35, COURSE))
    assert spring(net, 6, 7) == pytest.approx((4.55, 0.35, COURSE))      # tch top: chain width
    assert spring(net, 0, 2) == pytest.approx((13.0, 0.05, BEND_COURSE))
    assert spring(net, 9, 0) == pytest.approx((math.hypot(12.35, 6.5), 0.12, SHEAR))
    assert spring(net, 9, 2) == pytest.approx((math.hypot(12.35, 6.5), 0.12, SHEAR))
    assert spring(net, 4, 1) == pytest.approx((math.hypot(1.3, 6.5), 0.15, SHEAR))
    assert spring(net, 15, 0) == pytest.approx((13.65, 0.05, BEND_WALE))   # slst -> tch top -> sc
    assert spring(net, 25, 8) == pytest.approx((7.475, 0.05, BEND_WALE))
    assert not net.slack.any()


def test_metric_variant_rules():
    net = build_network(TINY, variant="metric")
    # counts-as top occupies the course like a dc (N2)
    assert spring(net, 6, 7)[0] == pytest.approx((4.55 + 6.5) / 2)
    # chain-space chains: tension-only course springs (N4)
    idx = {(int(a), int(b)): q for q, (a, b) in enumerate(zip(net.i, net.j))}
    assert net.slack[idx[(7, 8)]] and net.slack[idx[(8, 9)]]
    assert not net.slack[idx[(0, 1)]]
    # slip stitches: no shear (N3); stitches into a slack loop: no shear (N4)
    assert (1, 4) not in net.pairs() or net.pairs()[(1, 4)][2] != SHEAR
    assert all(t != SHEAR for (a, b), (_, _, t) in net.pairs().items() if 17 in (a, b) and {a, b} & {10, 14})
    # dc 9 stands on sc 1: wale 12.35-ish, shear to sc 0 and sc 2 present
    assert spring(net, 9, 0)[2] == SHEAR and spring(net, 9, 2)[2] == SHEAR


def test_no_duplicates_and_positive(net):
    keys = list(zip(net.i.tolist(), net.j.tolist()))
    assert len(keys) == len(set(keys))
    assert (net.L > 0).all() and (net.k > 0).all() and (net.i < net.j).all()
