"""`make lab` is reproducible: rendering a notebook twice gives byte-identical HTML with no
random cell ids or timings (docs/review.md R10). `make lab-check` compares every report with the
committed one; this test checks idempotence only, so it cannot fail on another machine."""
import re

import pytest

from crolab import reports as R


@pytest.mark.slow
def test_report_render_is_byte_identical(tmp_path):
    R.deterministic_env()
    src = R.NB_DIR / "04_parameter_fitting.py"
    out = []
    for d in ("a", "b"):
        (tmp_path / d).mkdir()
        ok, err, _ = R.render(src, tmp_path / d)
        assert ok, err
        out.append((tmp_path / d / f"{src.stem}.html").read_bytes())
    assert out[0] == out[1]
    html = out[0].decode("utf-8")
    ids = re.findall(r'id="cell-id=([^"]+)"', html)
    assert ids and all(re.fullmatch(r"cell-\d+", i) for i in ids)
    assert '"execution"' not in html and "iopub." not in html


def test_index_has_no_timings(tmp_path):
    R.write_index([("b_nb", True, "", 12.3), ("a_nb", False, "boom", 4.0)], tmp_path)
    page = (tmp_path / "index.html").read_text()
    assert "12" not in page and " s<" not in page
    assert page.index("a_nb") < page.index("b_nb") and "FAILED" in page
