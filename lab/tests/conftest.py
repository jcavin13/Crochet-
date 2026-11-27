"""Shared fixtures: simulated canonical fixtures, cached per session (each sim takes seconds)."""
from functools import lru_cache

import pytest

from crolab import graph as G
from crolab.builders import LACE_FIXTURES, builder_for_fixture
from crolab.sim import simulate

ALL = sorted(G.iter_fixture_names())


def fixture_pattern(name):
    """Compiled graph when present, else builder (solid fixtures); lace without graph -> skip."""
    p = G.fixture_graph_path(name)
    if p.exists():
        return G.load(p), "compiled"
    if name in LACE_FIXTURES:
        pytest.skip(f"{name}: no compiled graph yet (spec/fixtures/{name}.graph.json)")
    return builder_for_fixture(name), "builder"


@lru_cache(maxsize=None)
def _sim(name, source):
    if source == "compiled":
        pat = G.load(G.fixture_graph_path(name))
    else:
        pat = builder_for_fixture(name, include_lace=True)
    return pat, simulate(pat)


@pytest.fixture(scope="session")
def sim_cache():
    return _sim
