import numpy as np
import pytest

from crolab import builders as B
from crolab.network import build_network
from crolab.sim import energy_and_grad, simulate


@pytest.mark.parametrize("slack", [False, True])
def test_gradient_matches_finite_differences(slack):
    p = B.chain_space_motif()
    net = build_network(p)
    rng = np.random.default_rng(0)
    x = rng.normal(scale=5.0, size=3 * net.n_particles)
    sl = net.slack if slack else None
    kL = net.k / net.L
    E, g = energy_and_grad(x, net.i, net.j, net.L, kL, net.n_particles, sl)
    h = 1e-6
    for q in rng.choice(len(x), 40, replace=False):
        xp, xm = x.copy(), x.copy()
        xp[q] += h
        xm[q] -= h
        fd = (energy_and_grad(xp, net.i, net.j, net.L, kL, net.n_particles, sl)[0]
              - energy_and_grad(xm, net.i, net.j, net.L, kL, net.n_particles, sl)[0]) / (2 * h)
        assert fd == pytest.approx(g[q], rel=1e-5, abs=1e-7)


def test_energy_of_single_spring():
    E, g = energy_and_grad(np.array([0, 0, 0, 3.0, 4.0, 0]), np.array([0]), np.array([1]),
                           np.array([4.0]), np.array([2.0 / 4.0]), 2)
    assert E == pytest.approx(0.5 * 0.5 * 1.0)
    assert g[3:] == pytest.approx(0.5 * 1.0 * np.array([0.6, 0.8, 0]))


def test_simulate_small_and_deterministic():
    p = B.sc_rounds([6, 12, 18])
    a, b = simulate(p), simulate(p)
    assert a.converged and np.array_equal(a.positions, b.positions)
    assert len(a.snapshots) == 3
    assert np.isnan(a.snapshots[0][6:18]).all() and not np.isnan(a.snapshots[0][:6]).any()
    c = simulate(p, upto_round=1)
    assert c.rounds_done == 2 and np.isnan(c.positions[18:36, 0]).all() and not np.isnan(c.positions[36]).any()
