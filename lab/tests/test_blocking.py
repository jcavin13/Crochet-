from conftest import fixture_pattern
from crolab.blocking import block


def test_blocking_flat_vs_hyperbolic(sim_cache):
    f = block(sim_cache("flat_sc_circle", fixture_pattern("flat_sc_circle")[1])[1])
    h = block(sim_cache("hyperbolic_plane", fixture_pattern("hyperbolic_plane")[1])[1])
    assert f["converged"] and abs(f["positions"][:, 2].std() - 0) >= 0
    assert f["buckle_fraction"] == 0.0 and f["max_compression"] < 0.1
    assert h["buckle_fraction"] > 0.2
    assert h["mean_abs_strain"] > 3 * f["mean_abs_strain"]
