"""Spines (SPEC_NOTES N5/P7): chains with stitches worked back along them are stiff doubled cords.
They only exist in hook-addressed chains, which no canonical fixture has — so the fixtures'
networks are untouched — and the snowflake reference (spec/fixtures/extra/snowflake_fern) pins the
rules against the TypeScript sim through its .network.json (test_export_network)."""
import math

import numpy as np
import pytest

from crolab import FIXTURES_DIR
from crolab import graph as G
from crolab.blocking import align_pins, block
from crolab.network import build_network
from crolab.sim import simulate

FERN = FIXTURES_DIR / "extra" / "snowflake_fern.graph.json"


@pytest.fixture(scope="module")
def fern():
    return G.load(FERN)


@pytest.fixture(scope="module")
def fern_sim(fern):
    return simulate(fern, gtol_round=1e-5, gtol_final=1e-6, snapshots=False)


@pytest.mark.parametrize("name", list(G.iter_fixture_names()))
def test_fixtures_have_no_spines(name):
    assert build_network(G.load(G.fixture_graph_path(name))).spines == []


def test_fern_spines(fern):
    net = build_network(fern)
    assert len(net.spines) == 6
    for sp in net.spines:
        assert len(sp.stem) == 13 and len(sp.tip) == 3 and len(sp.picots) == 6
        s = [sp.pos[c][0] for c in sp.stem]
        assert all(b > a for a, b in zip(s, s[1:]))               # the stem runs straight out
        assert max(sp.pos[v][0] for v in sp.tip) > s[-1]           # the tip loop beyond it
        # every spring inside a spine has its layout length (no frustration)
        pairs = net.pairs()
        for (a, b), (L, k, t) in pairs.items():
            if a in sp.pos and b in sp.pos:
                pa, pb = sp.pos[a], sp.pos[b]
                assert L == pytest.approx(math.hypot(pa[0] - pb[0], pa[1] - pb[1]), abs=1e-9)


def test_spine_stays_straight_in_the_relaxed_sim(fern, fern_sim):
    X = fern_sim.positions
    for sp in fern_sim.network.spines:
        a, b = sp.stem[0], sp.stem[-1]
        rest = sp.pos[b][0] - sp.pos[a][0]
        assert np.linalg.norm(X[b] - X[a]) >= 0.85 * rest


def test_block_with_pins(fern_sim):
    net = fern_sim.network
    X = fern_sim.positions
    c = X[: net.n_nodes].mean(0)
    pins = []
    R0 = float(np.mean([np.linalg.norm((X[sp.base] - c)[:2]) for sp in net.spines]))
    for k, sp in enumerate(net.spines):
        tip = sp.tip[len(sp.tip) // 2]
        R = R0 + 1.05 * sp.pos[tip][0]
        th = 2 * math.pi * k / 6
        pins.append((tip, R * math.sin(th), -R * math.cos(th)))
    b = block(fern_sim, pins=pins, gtol=1e-6)
    P = b["plane_coords"]
    al = align_pins(pins, {nd: P[nd] for nd, _, _ in pins})
    for nd, x, y in al:
        assert P[nd] == pytest.approx([x, y], abs=1e-9)
    radii = [math.hypot(x - np.mean([q[1] for q in al]), y - np.mean([q[2] for q in al])) for _, x, y in al]
    assert max(radii) - min(radii) < 1e-6 * max(radii) + 1e-6
    assert set(b["pin_stretch"]) == {"spines", "chains", "body"}
    assert b["pin_stretch"]["spines"] < 0.15


def test_align_pins_handles_rotation_and_mirror():
    pts = [(i, math.cos(2 * math.pi * i / 5) * 10, math.sin(2 * math.pi * i / 5) * 10 + (i == 0)) for i in range(5)]
    # current positions: mirrored and rotated by 30 deg, shifted
    co, si = math.cos(0.5), math.sin(0.5)
    cur = {i: np.array([co * x + si * y + 3, si * x - co * y - 1]) for i, x, y in pts}
    for nd, x, y in align_pins(pts, cur):
        assert [x, y] == pytest.approx(list(cur[nd]), abs=1e-9)
