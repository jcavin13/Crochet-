import json
import warnings

import pytest

from crolab import REPO_ROOT
from crolab.fitting import (SYNTH_TRUTH, circle_checks, fit_sets, main, read_measurements, synthetic_rows,
                            write_csv)
from crolab.params import validate_params

SWATCH = REPO_ROOT / "lab" / "swatch"


def test_synthetic_recovery(tmp_path):
    csvp = tmp_path / "m.csv"
    write_csv(synthetic_rows(noise=0.005, seed=3), csvp, "SYNTHETIC")
    sets, diag = fit_sets(read_measurements(csvp))
    assert len(sets) == 1 and sets[0]["status"] == "fitted"
    st = sets[0]["stitches"]
    for t, (w, h) in SYNTH_TRUTH.items():
        assert st[t]["width"] == pytest.approx(w, abs=max(4 * st[t]["width_sd"], 0.02 * w))
        if h is not None:
            assert st[t]["height"] == pytest.approx(h, abs=max(4 * st[t]["height_sd"], 0.02 * h))
    # unmeasured types filled from the relative table
    assert st["tr"]["height"] == pytest.approx(2.8 * st["sc"]["width"], rel=1e-3)
    assert "ch.height" in diag[sets[0]["id"]]["filled"]


def test_cli_writes_schema_valid(tmp_path):
    out = tmp_path / "p.json"
    assert main([str(REPO_ROOT / "lab" / "data" / "example_swatches.csv"), "--out", str(out)]) == 0
    doc = json.loads(out.read_text())
    validate_params(doc)
    assert doc["sets"][0]["status"] == "fitted"
    out2 = tmp_path / "merged.json"
    assert main([str(REPO_ROOT / "lab" / "data" / "example_swatches.csv"), "--out", str(out2), "--merge"]) == 0
    assert len(json.loads(out2.read_text())["sets"]) == 5


def test_swatch_template_loads():
    assert read_measurements(SWATCH / "measurements_template.csv") == []


def test_swatch_style_rows(tmp_path):
    cols = ("yarn,hook_mm,stitch,n_stitches,n_rows,width_mm,height_mm,swatch_id,method,state,repeat,"
            "width_sd_mm,height_sd_mm,confidence,notes")
    lines = [cols,
             "w4,5.0,sc,20,20,130.5,124.0,A,ruler,unblocked,1,1.0,1.0,,",
             "w4,5.0,sc,10,10,66.0,63.0,B,ruler,unblocked,1,1.0,1.0,,",
             "w4,5.0,sc,20,20,134.0,126.0,A,ruler,blocked,1,,,,",
             "w4,5.0,ch,30,0,135.0,,C,chain-length,unblocked,1,,,,",
             "w4,5.0,mesh,10,4,80,40,D,mesh,unblocked,1,,,,dc ch1"]
    p = tmp_path / "s.csv"
    p.write_text("\n".join(lines) + "\n")
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        rows = read_measurements(p)
    assert any("mesh" in str(x.message) for x in w)
    assert len(rows) == 4
    sets, diag = fit_sets(rows)
    ids = sorted(s["id"] for s in sets)
    assert ids == ["w4_5mm", "w4_5mm_blocked"]
    un = next(s for s in sets if s["id"] == "w4_5mm")
    assert un["stitches"]["ch"]["width"] == pytest.approx(4.5)
    assert "ch" not in diag["w4_5mm"]["heights"]
    validate_params({"version": "0.1", "units": "mm", "default_set": ids[0], "sets": sets})


def test_circle_checks(tmp_path):
    csvp = tmp_path / "m.csv"
    write_csv(synthetic_rows(), csvp)
    rows = read_measurements(csvp)
    sets, _ = fit_sets(rows)
    circ = tmp_path / "c.csv"
    circ.write_text((SWATCH / "flat_circle_template.csv").read_text().splitlines()[0] + "\n"
                    "synthetic-worsted,5.0,sc,6,8,magic-ring,spiral,flat,,,unblocked,,,,\n"
                    "synthetic-worsted,5.0,sc,9,8,magic-ring,spiral,ruffles,,,unblocked,,,,\n")
    res = circle_checks(sets, rows, circ)
    assert [(c["observed"], c["predicted"]) for c in res] == [("flat", "flat"), ("ruffle", "ruffle")]
