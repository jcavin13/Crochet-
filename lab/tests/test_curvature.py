import math

import pytest

from conftest import fixture_pattern
from crolab.curvature import extrinsic_curvature, intrinsic_curvature


@pytest.mark.parametrize("name", ["flat_sc_circle", "flat_dc_circle", "sc_sphere", "sc_cone", "hyperbolic_plane"])
def test_gauss_bonnet_and_signs(name, sim_cache):
    pat, src = fixture_pattern(name)
    _, res = sim_cache(name, src)
    ex = extrinsic_curvature(res)
    assert ex["manifold"] and ex["chi"] == 1
    assert ex["total"] == pytest.approx(2 * math.pi, abs=1e-8)             # disc: interior + boundary
    cap = extrinsic_curvature(res, cap=True)
    assert cap["chi"] == 2 and cap["total"] == pytest.approx(4 * math.pi, abs=1e-8)
    ki = intrinsic_curvature(pat)[-1]["K_enclosed"]
    K = ex["K_interior"]
    if name.startswith("flat"):
        assert abs(K) < 0.3 and abs(ki) < 0.3
    elif name == "sc_sphere":
        assert K == pytest.approx(4 * math.pi, rel=0.05) and ki == pytest.approx(4 * math.pi, rel=0.05)
    elif name == "sc_cone":
        assert 0.5 * math.pi < K < 1.5 * math.pi and K == pytest.approx(ki, rel=0.1)
    else:
        assert K < -4 * math.pi and ki < -4 * math.pi
    # intrinsic (rest lengths) and extrinsic (simulated surface) agree
    assert K == pytest.approx(ki, abs=0.1 * max(1.0, abs(ki)))
