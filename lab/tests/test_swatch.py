"""Swatch tools: marker sheet geometry, synthetic-photo recovery of scale and gauge, failure modes.

All photos are synthetic (crolab.swatch.synth) with known ground truth; nothing here validates
real photographs.
"""
import csv
import json
from functools import lru_cache

import cv2
import numpy as np
import pytest

from crolab.swatch import records
from crolab.swatch.analyze import (MarkerDetectionError, analyze_image, detect_markers, fit_homography,
                                   main as analyze_main)
from crolab.swatch.layout import LAYOUT_JSON, build_layouts, load_layouts, render_layout
from crolab.swatch.synth import PhotoSpec, SwatchSpec, make_photo

LAYOUTS = load_layouts()
SMALL = dict(img_wh=(1200, 1600), render_ppm=6.0)  # keeps the suite fast


@lru_cache(maxsize=None)
def photo(key):
    sw, ph = CASES[key]
    return make_photo(sw, ph, LAYOUTS)


@lru_cache(maxsize=None)
def analysed(key, **kw):
    img, truth = photo(key)
    sw = CASES[key][0]
    hook = 5.0 if sw.pitch_x_mm > 4 else 1.75
    return analyze_image(img, stitch=sw.stitch, hook_mm=hook, yarn="synthetic", n_stitches=sw.n_stitches,
                         n_rows=sw.n_rows, layouts=LAYOUTS, **kw), truth


CASES = {
    # sweep: tilt, azimuth, in-plane angle, stitch type, pitch, noise
    "sc_fronto": (SwatchSpec(seed=1), PhotoSpec(tilt_deg=0, yaw_deg=1, seed=1, **SMALL)),
    "sc_t15": (SwatchSpec(seed=2, pitch_x_mm=5.6, pitch_y_mm=5.2, n_stitches=22, n_rows=22),
               PhotoSpec(tilt_deg=15, tilt_azimuth_deg=200, swatch_angle_deg=5, seed=2, **SMALL)),
    "sc_t30_noisy": (SwatchSpec(seed=3, pitch_x_mm=7.2, pitch_y_mm=6.9, n_stitches=16, n_rows=18),
                     PhotoSpec(tilt_deg=30, tilt_azimuth_deg=80, swatch_angle_deg=-4, noise_sigma=8,
                               blur_px=1.3, jpeg_quality=75, seed=3, **SMALL)),
    "hdc_t20": (SwatchSpec(stitch="hdc", pitch_x_mm=6.3, pitch_y_mm=8.4, n_stitches=18, n_rows=14, seed=4),
                PhotoSpec(tilt_deg=20, swatch_angle_deg=7, seed=4, **SMALL)),
    "dc_t25": (SwatchSpec(stitch="dc", pitch_x_mm=6.6, pitch_y_mm=12.6, n_stitches=17, n_rows=9, seed=5),
               PhotoSpec(tilt_deg=25, tilt_azimuth_deg=300, swatch_angle_deg=-2, seed=5, **SMALL)),
    "tr_t10": (SwatchSpec(stitch="tr", pitch_x_mm=6.0, pitch_y_mm=17.0, n_stitches=18, n_rows=7, seed=6),
               PhotoSpec(tilt_deg=10, seed=6, **SMALL)),
    "letter_t20": (SwatchSpec(seed=7), PhotoSpec(layout="letter", tilt_deg=20, tilt_azimuth_deg=120, seed=7, **SMALL)),
    # robustness / failure modes
    "occluded": (SwatchSpec(seed=8), PhotoSpec(tilt_deg=15, occlude_markers=8, seed=8, **SMALL)),
    "pale_on_dark": (SwatchSpec(seed=9, color_bgr=(225, 228, 230)),
                     PhotoSpec(tilt_deg=10, window_fill=40, seed=9, **SMALL)),
    "irregular": (SwatchSpec(seed=10, jitter=0.35, row_wave_mm=2.0), PhotoSpec(tilt_deg=10, seed=10, **SMALL)),
    "print97": (SwatchSpec(seed=11), PhotoSpec(tilt_deg=10, print_scale=0.97, seed=11, **SMALL)),
    "card": (SwatchSpec(seed=12, n_stitches=18, n_rows=18), PhotoSpec(layout="card", tilt_deg=12, seed=12, **SMALL)),
}
SWEEP = ["sc_fronto", "sc_t15", "sc_t30_noisy", "hdc_t20", "dc_t25", "tr_t10", "letter_t20", "occluded",
         "pale_on_dark"]


# ---------------------------------------------------------------------------------------------
# sheet geometry
# ---------------------------------------------------------------------------------------------
def test_committed_layout_json_matches_generator():
    assert LAYOUT_JSON.exists(), "run python -m crolab.swatch.make_sheet"
    built = build_layouts()
    for name, lay in built.items():
        got = LAYOUTS[name]
        assert sorted(got.markers) == sorted(lay.markers)
        for i in lay.markers:
            np.testing.assert_allclose(got.markers[i], lay.markers[i], atol=1e-3)


def test_layout_sanity():
    ids = [i for lay in LAYOUTS.values() for i in lay.markers]
    assert len(ids) == len(set(ids)), "marker ids must be unique across layouts (auto-detection)"
    for lay in LAYOUTS.values():
        W, H = lay.size_mm
        allc = np.concatenate(list(lay.markers.values()))
        assert allc.min() >= 3 and allc[:, 0].max() <= W - 3 and allc[:, 1].max() <= H - 3
        if lay.window_mm:
            x0, y0, x1, y1 = lay.window_mm
            assert x1 - x0 > 140 and y1 - y0 > 180
            for c in lay.markers.values():  # window clear of markers
                assert c[:, 0].max() < x0 or c[:, 0].min() > x1 or c[:, 1].max() < y0 or c[:, 1].min() > y1


def test_make_sheet_writes_vector_pdfs(tmp_path):
    from crolab.swatch.make_sheet import make_all
    paths = make_all(tmp_path)
    names = {p.name for p in paths}
    assert {"marker_sheet_A4.pdf", "marker_sheet_letter.pdf", "marker_card.pdf", "sheet_layout.json"} <= names
    for p in paths:
        if p.suffix == ".pdf":
            assert p.read_bytes()[:4] == b"%PDF" and p.stat().st_size < 200_000
    assert json.loads((tmp_path / "sheet_layout.json").read_text())["layouts"]["A4"]["window_mm"]


def test_rendered_sheet_detects_exactly():
    lay = LAYOUTS["A4"]
    ppm = 4.0
    img = render_layout(lay, ppm)
    lay2, corners, _ = detect_markers(img, LAYOUTS)
    assert lay2.name == "A4" and len(corners) == len(lay.markers)
    H, fit = fit_homography(lay, corners)
    g = np.concatenate(list(lay.markers.values()))
    px = cv2.perspectiveTransform(g[None], H)[0]
    assert np.abs(px - (g * ppm - 0.5)).max() < 0.1  # px, i.e. < 0.025 mm
    assert np.sqrt(np.mean(fit["err_mm"] ** 2)) < 0.05


# ---------------------------------------------------------------------------------------------
# accuracy on synthetic photos
# ---------------------------------------------------------------------------------------------
def _window_error_mm(an, truth):
    """Max distance (mm) between where the estimated and the true homography send points of the
    window back onto the sheet."""
    lay = an.debug["layout"]
    x0, y0, x1, y1 = lay.window_mm
    g = np.array([[x, y] for x in np.linspace(x0, x1, 5) for y in np.linspace(y0, y1, 5)], float)
    px = cv2.perspectiveTransform(g[None], np.array(truth["H_mm_to_px"]))[0]
    back = cv2.perspectiveTransform(px[None], np.linalg.inv(an.debug["H"]))[0]
    return float(np.linalg.norm(back - g, axis=1).max())


@pytest.mark.parametrize("key", SWEEP)
def test_scale_and_gauge_recovered(key):
    an, truth = analysed(key)
    r = an.result
    # metric rectification: < 0.3 mm anywhere in the window (~0.2 % of its size)
    assert _window_error_mm(an, truth) < 0.3
    assert r["markers"]["reproj_rms_mm"] < 0.15
    # swatch size (min-area box) within 1.5 %
    sw = r["swatch"]
    assert sw["bbox_width_mm"] == pytest.approx(truth["bbox_width_mm"], rel=0.015)
    assert sw["bbox_height_mm"] == pytest.approx(truth["bbox_height_mm"], rel=0.015)
    # automatic gauge (no counts used) within 5 %
    g = r["gauge_from_texture"]
    assert g["stitch_pitch_mm"] == pytest.approx(truth["stitch_pitch_mm"], rel=0.05)
    assert g["row_pitch_mm"] == pytest.approx(truth["row_pitch_mm"], rel=0.05)
    assert g["confidence_label"] in ("medium", "high")
    # camera tilt estimate
    assert r["camera"]["tilt_deg"] == pytest.approx(truth["tilt_deg"], abs=3.0)


def test_gauge_from_counts_and_csv_row():
    an, truth = analysed("sc_t15")
    r = an.result
    gc = r["gauge_from_counts"]
    # full-extent / count includes ~one yarn diameter of edge -> a few % above the pitch
    assert gc["stitch_pitch_mm"] == pytest.approx(truth["stitch_pitch_mm"], rel=0.06)
    assert gc["row_pitch_mm"] == pytest.approx(truth["row_pitch_mm"], rel=0.06)
    row = r["csv_row"]
    assert list(row)[:7] == records.FITTING_COLUMNS
    assert row["method"] == "photo-counts" and row["n_stitches"] == 22 and row["stitch"] == "sc"
    assert row["width_mm"] == r["swatch"]["width_mm"]


def test_texture_only_csv_row():
    img, truth = photo("hdc_t20")
    an = analyze_image(img, stitch="hdc", hook_mm=5.0, yarn="x", layouts=LAYOUTS, lattice=False)
    row = an.result["csv_row"]
    assert row["method"] == "photo-texture" and row["n_stitches"] == 10 and row["n_rows"] == 10
    assert row["width_mm"] == pytest.approx(10 * truth["stitch_pitch_mm"], rel=0.05)
    assert row["height_mm"] == pytest.approx(10 * truth["row_pitch_mm"], rel=0.05)


def test_lattice_experimental_matches_pitch():
    an, truth = analysed("sc_fronto")
    lat = an.result["lattice"]
    assert lat["experimental"] is True
    assert lat["stitch_pitch_median_mm"] == pytest.approx(truth["stitch_pitch_mm"], rel=0.05)
    assert lat["row_pitch_median_mm"] == pytest.approx(truth["row_pitch_mm"], rel=0.05)
    n_rows_found = len(lat["rows"])
    assert CASES["sc_fronto"][0].n_rows - 4 <= n_rows_found <= CASES["sc_fronto"][0].n_rows + 1


# ---------------------------------------------------------------------------------------------
# failure modes and robustness
# ---------------------------------------------------------------------------------------------
def test_partial_occlusion_still_works():
    an, truth = analysed("occluded")
    assert len(truth["occluded_ids"]) == 8
    assert an.result["markers"]["detected_layout"] <= 32 - 6
    assert _window_error_mm(an, truth) < 0.3


def test_no_markers_is_a_clear_error():
    img = np.full((800, 600, 3), 200, np.uint8)
    with pytest.raises(MarkerDetectionError, match="No ArUco markers"):
        analyze_image(img, layouts=LAYOUTS)


def test_too_few_markers_is_a_clear_error():
    img, truth = photo("sc_fronto")
    H = np.array(truth["H_mm_to_px"])
    lay = LAYOUTS["A4"]
    keep = [0, 1, 2]
    img = img.copy()
    for mid, c in lay.markers.items():  # paint over every marker but three
        if mid in keep:
            continue
        q = cv2.perspectiveTransform(((c - c.mean(0)) * 1.3 + c.mean(0))[None], H)[0]
        cv2.fillConvexPoly(img, np.round(q).astype(np.int32), (235, 235, 235))
    with pytest.raises(MarkerDetectionError, match="Only 3 marker"):
        analyze_image(img, layouts=LAYOUTS)


def test_irregular_texture_reports_low_confidence():
    an, _ = analysed("irregular")
    g = an.result["gauge_from_texture"]
    assert g["confidence_label"] == "low"
    assert any("LOW" in w or "low" in w.lower() for w in an.result["warnings"])


def test_print_scale_needs_ruler():
    """A sheet printed at 97 % biases sizes by -3 % and cannot be detected from the photo;
    --ruler-mm fixes it."""
    an_raw, truth = analysed("print97")
    assert an_raw.result["swatch"]["bbox_width_mm"] / truth["bbox_width_mm"] == pytest.approx(1 / 0.97, rel=0.01)
    assert any("print scale" in w for w in an_raw.result["warnings"])
    an, _ = analysed("print97", ruler_mm=97.0)
    assert an.result["swatch"]["bbox_width_mm"] == pytest.approx(truth["bbox_width_mm"], rel=0.015)
    assert an.result["gauge_from_texture"]["stitch_pitch_mm"] == pytest.approx(truth["stitch_pitch_mm"], rel=0.05)


def test_card_layout():
    an, truth = analysed("card")
    r = an.result
    assert r["layout"] == "card"
    # textured table background + contact shadow: looser size tolerance than on the sheet
    assert r["swatch"]["bbox_width_mm"] == pytest.approx(truth["bbox_width_mm"], rel=0.03)
    assert r["swatch"]["bbox_height_mm"] == pytest.approx(truth["bbox_height_mm"], rel=0.03)
    assert r["gauge_from_texture"]["stitch_pitch_mm"] == pytest.approx(truth["stitch_pitch_mm"], rel=0.05)


def test_cli_writes_outputs(tmp_path):
    img, _ = photo("sc_fronto")
    p = tmp_path / "swatch.jpg"
    cv2.imwrite(str(p), img)
    csv_path = tmp_path / "all.csv"
    analyze_main([str(p), "--stitch", "sc", "--yarn", "worsted-4", "--hook", "5.0", "--out", str(tmp_path / "o"),
                  "--csv", str(csv_path), "--no-overlay"])
    res = json.loads((tmp_path / "o" / "swatch.json").read_text())
    assert res["gauge_from_texture"]["confidence"] > 0
    rows = list(csv.DictReader(csv_path.open()))
    assert rows[0]["yarn"] == "worsted-4" and rows[0]["method"] == "photo-texture"
    assert (tmp_path / "o" / "swatch_row.csv").exists() and (tmp_path / "o" / "swatch_rectified.jpg").exists()


def test_overlay_png(tmp_path):
    from crolab.swatch.analyze import save_overlay
    an, _ = analysed("dc_t25")
    p = save_overlay(an, tmp_path / "ov.png", dpi=40)
    assert cv2.imread(str(p)) is not None


def test_template_csv_has_fitting_columns():
    rows = list(csv.reader(records.TEMPLATE.open()))
    assert rows[0][:7] == records.FITTING_COLUMNS
    assert rows[0] == records.COLUMNS
