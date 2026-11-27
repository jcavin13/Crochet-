"""crolab — research side of the crochet tools. See docs/architecture.md."""
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SPEC_DIR = REPO_ROOT / "spec"
FIXTURES_DIR = SPEC_DIR / "fixtures"
