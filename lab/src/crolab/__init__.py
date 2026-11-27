"""crolab — research side of the crochet tools. See docs/architecture.md."""
import os
from pathlib import Path

# The lab's linear algebra works on small vectors (a few thousand unknowns), where multi-threaded
# BLAS/OpenMP is pure overhead and, on a loaded machine, oversubscription makes a 5 s sim take
# 90 s (docs/review.md R5). One thread also keeps floating-point reductions in a fixed order.
# These must be set before numpy is first imported; `setdefault` lets a user override them.
for _var in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

REPO_ROOT = Path(__file__).resolve().parents[3]
SPEC_DIR = REPO_ROOT / "spec"
FIXTURES_DIR = SPEC_DIR / "fixtures"
