"""Swatch photo analyzer.

    cd lab && uv run python -m crolab.swatch.analyze photo.jpg --stitch sc --yarn worsted-4 --hook 5.0 \
        [--n-stitches 20 --n-rows 20] [--out dir] [--csv measurements.csv] [--ruler-mm 99.6]

Pipeline: ArUco detection -> RANSAC homography (sheet mm -> image px) over all marker corners ->
quality checks (reprojection error in mm, perspective, resolution) -> fronto-parallel rectified
image of the sheet window at a known px/mm -> swatch segmentation (robust background model +
Otsu, closing, largest component; GrabCut fallback when contrast is poor) -> size (min-area
rectangle and median chords) -> gauge from counts and/or from texture periodicity -> experimental
stitch lattice -> JSON + fitting-CSV row + diagnostic overlay PNG.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from crolab import SPEC_DIR

from . import records
from .layout import Layout, load_layouts
from .texture import TextureGauge, estimate_gauge, rotate, stitch_lattice

TOOL_VERSION = "0.1"


class SwatchAnalysisError(RuntimeError):
    pass


class MarkerDetectionError(SwatchAnalysisError):
    pass


# ---------------------------------------------------------------------------------------------
# priors
# ---------------------------------------------------------------------------------------------
def stitch_priors(stitch: str | None, hook_mm: float | None) -> dict:
    """Weak priors used only to resolve factor-of-2 ambiguities and set search ranges."""
    rel = {"width": 1.0, "height": 0.95}
    try:
        voc = json.loads((SPEC_DIR / "stitches.json").read_text())
        for t in voc["types"]:
            if stitch and t["id"] == stitch:
                rel = t["rel"]
    except (OSError, KeyError, ValueError):
        pass
    px = 1.3 * hook_mm * rel["width"] if hook_mm else None
    return {"stitch_pitch_mm": px, "height_width_ratio": rel["height"] / rel["width"] if stitch else None,
            "source": "spec/stitches.json rel table; sc width ~ 1.3 x hook mm"}


# ---------------------------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------------------------
def detect_markers(img: np.ndarray, layouts: dict[str, Layout], layout_name: str | None = None):
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    dicts = {lay.dictionary for lay in layouts.values()}
    found = {}
    for dname in dicts:
        p = cv2.aruco.DetectorParameters()
        p.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        p.cornerRefinementWinSize = 4
        det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, dname)), p)
        corners, ids, _ = det.detectMarkers(gray)
        if ids is not None:
            for c, i in zip(corners, ids.ravel()):
                found[(dname, int(i))] = c.reshape(4, 2).astype(np.float64)
    if not found:
        raise MarkerDetectionError(
            "No ArUco markers found. Is the printed marker sheet (or card) in the photo, in focus, "
            "not blown out by glare, and is the whole frame of markers visible?")
    cands = [layout_name] if layout_name else list(layouts)
    best, best_n = None, 0
    for name in cands:
        lay = layouts[name]
        n = sum(1 for (d, i) in found if d == lay.dictionary and i in lay.markers)
        if n > best_n:
            best, best_n = name, n
    if best is None:
        raise MarkerDetectionError(f"Markers found ({len(found)}) but none belong to layout(s) {cands}.")
    lay = layouts[best]
    corners = {i: c for (d, i), c in found.items() if d == lay.dictionary and i in lay.markers}
    return lay, corners, len(found)


def fit_homography(lay: Layout, corners: dict, ransac_px=3.0):
    ids = sorted(corners)
    obj = np.concatenate([lay.markers[i] for i in ids]).astype(np.float64)
    img = np.concatenate([corners[i] for i in ids]).astype(np.float64)
    H, inl = cv2.findHomography(obj, img, cv2.RANSAC, ransac_px, maxIters=5000, confidence=0.9999)
    if H is None:
        raise SwatchAnalysisError("Homography estimation failed (degenerate marker configuration).")
    inl = inl.ravel().astype(bool)
    # polish: least squares on inliers, then drop whole markers with any corner beyond
    # max(1 px, 4 robust sigma) (partly occluded markers give biased corners) and refit
    for _ in range(3):
        H2, _ = cv2.findHomography(obj[inl], img[inl], 0)
        if H2 is None:
            break
        H = H2
        e = np.linalg.norm(cv2.perspectiveTransform(obj[None], H)[0] - img, axis=1)
        sig = 1.4826 * np.median(np.abs(e[inl] - np.median(e[inl])))
        thr = max(1.0, 4 * sig + np.median(e[inl]))
        bad_marker = (e.reshape(-1, 4) > thr).any(1)
        new = np.repeat(~bad_marker, 4) & inl
        if new.sum() < 16 or (new == inl).all():
            break
        inl = new
    Hinv = np.linalg.inv(H)
    back = cv2.perspectiveTransform(img[None], Hinv)[0]
    err = np.linalg.norm(back - obj, axis=1)
    fwd = cv2.perspectiveTransform(obj[None], H)[0]
    err_px = np.linalg.norm(fwd - img, axis=1)
    return H / H[2, 2], {"ids": ids, "obj": obj, "img": img, "inliers": inl,
                         "err_mm": err, "err_px": err_px}


def local_px_per_mm(H, pts_mm) -> np.ndarray:
    out = []
    for x, y in pts_mm:
        p = H @ np.array([x, y, 1.0])
        w = p[2]
        J = (H[:2, :2] * w - np.outer(p[:2], H[2, :2])) / w ** 2
        out.append(np.sqrt(abs(np.linalg.det(J))))
    return np.array(out)


def camera_from_homography(H, img_wh, default_focal_factor=0.85) -> dict:
    """Focal length (if observable), tilt from the sheet normal, and camera-plane distance.

    Assumes square pixels, zero skew, principal point at the image centre."""
    W, Hh = img_wh
    T = np.array([[1, 0, -(W - 1) / 2], [0, 1, -(Hh - 1) / 2], [0, 0, 1.0]])
    G = T @ H
    h1, h2 = G[:, 0], G[:, 1]
    cands = []
    den1, num1 = h1[2] * h2[2], -(h1[0] * h2[0] + h1[1] * h2[1])
    den2, num2 = h1[2] ** 2 - h2[2] ** 2, -(h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2)
    scale = (h1[2] ** 2 + h2[2] ** 2) + 1e-30
    for num, den in ((num1, den1), (num2, den2)):
        if abs(den) / scale > 0.05 and num / den > 0:
            f = np.sqrt(num / den)
            if 0.3 * max(W, Hh) < f < 6 * max(W, Hh):
                cands.append((abs(den), f))
    if cands:
        f, observed = max(cands)[1], True
    else:
        f, observed = default_focal_factor * max(W, Hh), False
    Kinv = np.linalg.inv(np.array([[f, 0, 0], [0, f, 0], [0, 0, 1.0]]))
    a, b = Kinv @ h1, Kinv @ h2
    lam = 2.0 / (np.linalg.norm(a) + np.linalg.norm(b))
    r1, r2, t = lam * a, lam * b, lam * (Kinv @ G[:, 2])
    if t[2] < 0:
        r1, r2, t = -r1, -r2, -t
    R = np.column_stack([r1, r2, np.cross(r1, r2)])
    U, _, Vt = np.linalg.svd(R)
    R = U @ Vt
    tilt = float(np.degrees(np.arccos(min(1.0, abs(R[2, 2])))))
    C = -R.T @ t
    return {"focal_px": float(f), "focal_observed": observed, "tilt_deg": tilt,
            "camera_plane_distance_mm": float(abs(C[2]))}


def rectify(img, H, region_mm, ppm):
    x0, y0, x1, y1 = region_mm
    T = np.array([[1 / ppm, 0, x0 + 0.5 / ppm], [0, 1 / ppm, y0 + 0.5 / ppm], [0, 0, 1.0]])
    M = H @ T  # rectified px -> image px
    w, h = int(round((x1 - x0) * ppm)), int(round((y1 - y0) * ppm))
    native = float(np.median(local_px_per_mm(H, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)])))
    src = img
    if native > 1.5 * ppm:  # anti-alias before decimating
        src = cv2.GaussianBlur(img, (0, 0), 0.4 * native / ppm)
    flags = cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP
    rect = cv2.warpPerspective(src, M, (w, h), flags=flags, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    ones = np.full(img.shape[:2], 255, np.uint8)
    valid = cv2.warpPerspective(ones, M, (w, h), flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP) > 0
    return rect, valid, M


# ---------------------------------------------------------------------------------------------
# segmentation & measurement
# ---------------------------------------------------------------------------------------------
def _poly_design(xs, ys, w, h):
    x = xs / max(w, 1) - 0.5
    y = ys / max(h, 1) - 0.5
    return np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], 1)


def _otsu(v: np.ndarray):
    hist, edges = np.histogram(v, bins=256)
    p = hist.astype(float) / max(hist.sum(), 1)
    c = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(p)
    m0 = np.cumsum(p * c)
    mt = m0[-1]
    w1 = 1 - w0
    sb = np.where((w0 > 0) & (w1 > 0), (mt * w0 - m0) ** 2 / (w0 * w1 + 1e-12), 0)
    k = int(np.argmax(sb))
    var = float(np.sum(p * (c - mt) ** 2)) + 1e-12
    return float(c[k]), float(sb[k] / var)


def _fill_holes(mask):
    m = mask.astype(np.uint8)
    h, w = m.shape
    ff = np.pad(m, 1)
    cv2.floodFill(ff, np.zeros((h + 4, w + 4), np.uint8), (0, 0), 2)
    return (ff[1:-1, 1:-1] != 2).astype(np.uint8)


def _largest(mask):
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if n <= 1:
        return np.zeros_like(mask, np.uint8)
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return (lab == k).astype(np.uint8)


def _disk(r_px):
    r = max(1, int(round(r_px)))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def segment_swatch(rect, valid, ppm, bg_sample, exclude=None, close_mm=2.0, grabcut="auto"):
    """Return (mask uint8, info dict)."""
    h, w = valid.shape
    lab = cv2.cvtColor(rect, cv2.COLOR_BGR2LAB).astype(np.float32)
    use = valid & bg_sample
    if exclude is not None:
        use &= ~exclude
    ys, xs = np.nonzero(use)
    if ys.size < 200:
        raise SwatchAnalysisError("Not enough visible background around the swatch to model it.")
    rng = np.random.default_rng(0)
    if ys.size > 30000:
        k = rng.choice(ys.size, 30000, replace=False)
        ys, xs = ys[k], xs[k]
    A = _poly_design(xs.astype(float), ys.astype(float), w, h)
    vals = lab[ys, xs]
    wts = np.array([0.5, 1.0, 1.0], np.float32)
    inl = np.ones(len(ys), bool)
    for _ in range(4):
        coef, *_ = np.linalg.lstsq(A[inl], vals[inl], rcond=None)
        res = np.sqrt((((vals - A @ coef) ** 2) * wts).sum(1))
        mad = 1.4826 * np.median(np.abs(res[inl] - np.median(res[inl]))) + 0.5
        inl = res < np.median(res[inl]) + 3.5 * mad
    # smooth model: evaluate on a coarse grid, then resize
    hs, ws = max(2, h // 8), max(2, w // 8)
    YY, XX = np.mgrid[0:hs, 0:ws]
    Af = _poly_design((XX.ravel() + 0.5) * w / ws - 0.5, (YY.ravel() + 0.5) * h / hs - 0.5, w, h)
    bg = cv2.resize((Af @ coef).reshape(hs, ws, 3).astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)
    d = np.sqrt((((lab - bg) ** 2) * wts).sum(-1))
    d = cv2.GaussianBlur(d, (0, 0), max(0.5, 0.4 * ppm))
    region = valid if exclude is None else (valid & ~exclude)
    noise_floor = float(np.median(res[inl]) + 5 * mad)
    thr, sep = _otsu(d[region])
    thr = max(thr, noise_floor)
    m = ((d > thr) & region).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, _disk(close_mm * ppm))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, _disk(0.6 * ppm))
    m = _fill_holes(_largest(m))
    method = "threshold"
    if grabcut == "on" or (grabcut == "auto" and sep < 0.55):
        m = _grabcut_refine(rect, m, region, ppm, close_mm)
        method = "threshold+grabcut"
    info = {"method": method, "threshold": thr, "otsu_separability": sep,
            "background_lab": [float(v) for v in np.median(bg[region], 0)],
            "background_noise": float(mad)}
    if m.sum() == 0:
        raise SwatchAnalysisError("No swatch found inside the window (is it the same colour as the sheet?).")
    return m, info


def _grabcut_refine(rect, m, region, ppm, close_mm):
    s = min(1.0, 3.0 / ppm)
    small = cv2.resize(rect, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    ms = cv2.resize(m, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
    rs = cv2.resize(region.astype(np.uint8), (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
    r = 3.0 * ppm * s
    gc = np.full(ms.shape, cv2.GC_PR_BGD, np.uint8)
    gc[cv2.dilate(ms, _disk(r)) == 0] = cv2.GC_BGD
    gc[ms > 0] = cv2.GC_PR_FGD
    gc[cv2.erode(ms, _disk(r)) > 0] = cv2.GC_FGD
    gc[rs == 0] = cv2.GC_BGD
    if not (gc == cv2.GC_FGD).any():
        return m
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(small, gc, None, bgd, fgd, 3, cv2.GC_INIT_WITH_MASK)
    out = np.isin(gc, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.uint8)
    out = cv2.resize(out, (m.shape[1], m.shape[0]), interpolation=cv2.INTER_LINEAR)
    out = cv2.morphologyEx(out, cv2.MORPH_CLOSE, _disk(close_mm * ppm))
    return _fill_holes(_largest(out & region.astype(np.uint8)))


def measure_mask(mask, ppm) -> dict:
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cnts, key=cv2.contourArea)
    rect = cv2.minAreaRect(c)
    box = cv2.boxPoints(rect)
    e = [box[1] - box[0], box[2] - box[1]]
    ang = [np.degrees(np.arctan2(v[1], v[0])) for v in e]
    ang = [(a + 90) % 180 - 90 for a in ang]
    i = int(np.argmin([abs(a) for a in ang]))
    theta = float(ang[i])
    bw = float(np.linalg.norm(e[i])) / ppm + 1 / ppm
    bh = float(np.linalg.norm(e[1 - i])) / ppm + 1 / ppm
    rm, _ = rotate(mask.astype(np.uint8) * 255, theta, interp=cv2.INTER_LINEAR)
    rm = rm > 127
    rows = np.nonzero(rm.any(1))[0]
    cols = np.nonzero(rm.any(0))[0]

    def chords(mm, idx, axis):
        lo, hi = idx[0], idx[-1]
        a, b = int(lo + 0.2 * (hi - lo)), int(hi - 0.2 * (hi - lo))
        ext = []
        for k in range(a, b + 1):
            line = mm[k] if axis == 0 else mm[:, k]
            nz = np.nonzero(line)[0]
            if nz.size:
                ext.append((nz[-1] - nz[0] + 1) / ppm)
        ext = np.array(ext)
        return float(np.median(ext)), float(1.4826 * np.median(np.abs(ext - np.median(ext))))

    cw, cw_sd = chords(rm, rows, 0)
    ch, ch_sd = chords(rm, cols, 1)
    return {"width_mm": round(cw, 3), "height_mm": round(ch, 3),
            "width_chord_mad_mm": round(cw_sd, 3), "height_chord_mad_mm": round(ch_sd, 3),
            "bbox_width_mm": round(bw, 3), "bbox_height_mm": round(bh, 3),
            "angle_deg": round(theta, 3), "area_mm2": round(float(mask.sum()) / ppm ** 2, 1),
            "_box_px": box, "_contour": c}


# ---------------------------------------------------------------------------------------------
# main entry
# ---------------------------------------------------------------------------------------------
@dataclass
class Analysis:
    result: dict
    debug: dict = field(default_factory=dict)


def analyze_image(img: np.ndarray, *, stitch: str | None = None, yarn: str | None = None,
                  hook_mm: float | None = None, n_stitches: int | None = None, n_rows: int | None = None,
                  layout: str | None = None, layouts: dict | None = None, ppm: float = 8.0,
                  ruler_mm: float | None = None, row_repeat: str = "auto", lattice: bool = True,
                  thickness_mm: float = 0.0, grabcut: str = "auto", texture: bool = True,
                  source: str = "", state: str = "unblocked") -> Analysis:
    if img is None or img.size == 0:
        raise SwatchAnalysisError("empty image")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    layouts = layouts or load_layouts()
    warnings: list[str] = []
    lay, corners, n_any = detect_markers(img, layouts, layout)
    k_print = (ruler_mm / lay.ruler_mm.get("length", 100.0)) if ruler_mm else 1.0
    lay_p = lay.scaled(k_print) if k_print != 1.0 else lay
    if len(corners) < 4:
        raise MarkerDetectionError(
            f"Only {len(corners)} marker(s) of layout '{lay.name}' found (need >= 4, ideally all "
            f"{len(lay.markers)}). Keep the whole marker frame in view, in focus, without glare.")
    H, fit = fit_homography(lay_p, corners)
    inl = fit["inliers"]
    if inl.sum() < 12:
        raise SwatchAnalysisError("Too few consistent marker corners for a reliable homography.")
    rms_mm = float(np.sqrt(np.mean(fit["err_mm"][inl] ** 2)))
    max_mm = float(fit["err_mm"][inl].max())
    h_img, w_img = img.shape[:2]
    cam = camera_from_homography(H, (w_img, h_img))
    # coverage of the markers actually used (convex hull area vs. layout's)
    hull_used = cv2.contourArea(cv2.convexHull(fit["obj"][inl].astype(np.float32)))
    allc = np.concatenate(list(lay_p.markers.values())).astype(np.float32)
    coverage = float(hull_used / max(cv2.contourArea(cv2.convexHull(allc)), 1e-9))

    # region to rectify
    if lay_p.kind == "sheet":
        region = tuple(float(v) for v in lay_p.window_mm)
        exclude_mm = None
    else:
        corners_img = np.array([[0, 0], [w_img - 1, 0], [w_img - 1, h_img - 1], [0, h_img - 1]], float)
        pl = cv2.perspectiveTransform(corners_img[None], np.linalg.inv(H))[0]
        cx, cy = np.mean(allc, 0)
        lim = 350.0
        x0, y0 = np.clip(pl.min(0), [cx - lim, cy - lim], None)
        x1, y1 = np.clip(pl.max(0), None, [cx + lim, cy + lim])
        region = (float(x0), float(y0), float(x1), float(y1))
        cw_, ch_ = lay_p.size_mm
        exclude_mm = (-4.0, -4.0, cw_ + 4.0, ch_ + 4.0)
        area = (x1 - x0) * (y1 - y0)
        ppm = float(min(ppm, np.sqrt(6e6 / max(area, 1))))

    if lay_p.kind == "sheet" and coverage < 0.5:
        warnings.append(f"markers used span only {coverage:.0%} of the frame: the rectification "
                        "extrapolates; keep the whole sheet in view")
    if len(corners) < 0.5 * len(lay.markers):
        warnings.append(f"only {len(corners)}/{len(lay.markers)} markers detected")
    if rms_mm > 0.3 or max_mm > 1.0:
        warnings.append(f"marker reprojection error is high (rms {rms_mm:.2f} mm, max {max_mm:.2f} mm): "
                        "sheet not flat, curled or misprinted?")
    if not ruler_mm:
        warnings.append("print scale is not observable from the photo: check that the printed 100 mm bar "
                        "measures 100 mm (or pass --ruler-mm)")

    rect, valid, M_rect = rectify(img, H, region, ppm)
    hr, wr = valid.shape
    yy, xx = np.mgrid[0:hr, 0:wr]
    xm, ym = region[0] + (xx + 0.5) / ppm, region[1] + (yy + 0.5) / ppm
    if lay_p.kind == "sheet":
        dist_edge = np.minimum.reduce([xm - region[0], region[2] - xm, ym - region[1], region[3] - ym])
        bg_sample = (dist_edge > 1.5) & (dist_edge < 6.0)
        exclude = None
    else:
        ex = exclude_mm
        exclude = (xm > ex[0]) & (xm < ex[2]) & (ym > ex[1]) & (ym < ex[3])
        dcard = np.maximum.reduce([ex[0] - xm, xm - ex[2], ex[1] - ym, ym - ex[3]])
        vd = cv2.distanceTransform(valid.astype(np.uint8), cv2.DIST_L2, 5) / ppm
        bg_sample = ((dcard > 1) & (dcard < 15)) | ((vd > 1) & (vd < 12))
    pri = stitch_priors(stitch, hook_mm)
    close_mm = float(np.clip(0.35 * (pri["stitch_pitch_mm"] or 6.0), 1.0, 4.0))
    mask, seg = segment_swatch(rect, valid, ppm, bg_sample, exclude, close_mm=close_mm, grabcut=grabcut)
    meas = measure_mask(mask, ppm)
    # perspective / resolution where it matters: over the swatch footprint
    box_mm = np.c_[region[0] + (meas["_box_px"][:, 0] + 0.5) / ppm, region[1] + (meas["_box_px"][:, 1] + 0.5) / ppm]
    native = local_px_per_mm(H, box_mm)
    persp_ratio = float(native.max() / native.min())
    if cam["tilt_deg"] > 35 or persp_ratio > 1.5:
        warnings.append(f"strong perspective (tilt ~{cam['tilt_deg']:.0f} deg, image scale varies x{persp_ratio:.2f} "
                        "across the swatch): hold the camera more nearly parallel to the sheet")
    if native.min() < 4.0:
        warnings.append(f"low resolution: {native.min():.1f} px/mm at the worst swatch corner; move closer")
    if pri["stitch_pitch_mm"] and native.min() * pri["stitch_pitch_mm"] < 8:
        warnings.append("fewer than ~8 image pixels per expected stitch: texture gauge unreliable; move closer")
    # thickness/parallax correction (optional, approximate)
    corr = 1.0
    if thickness_mm > 0:
        Z = cam["camera_plane_distance_mm"]
        corr = (Z - thickness_mm) / Z
        for k in ("width_mm", "height_mm", "bbox_width_mm", "bbox_height_mm"):
            meas[k] = round(meas[k] * corr, 3)
    edge_band = cv2.erode(valid.astype(np.uint8), _disk(1)) == 0
    if lay_p.kind == "sheet":
        b = 2
        edge_band[:b] = edge_band[-b:] = True
        edge_band[:, :b] = edge_band[:, -b:] = True
    touches = bool((mask.astype(bool) & edge_band).any())
    if touches:
        warnings.append("swatch touches the edge of the analysed region: its size is a lower bound")

    result = {
        "tool": "crolab.swatch.analyze", "version": TOOL_VERSION, "source": source,
        "layout": lay.name, "print_scale_factor": k_print,
        "markers": {"detected_any": n_any, "detected_layout": len(corners), "of": len(lay.markers),
                    "ids": [int(i) for i in fit["ids"]], "corner_points": int(len(inl)),
                    "inlier_points": int(inl.sum()), "reproj_rms_mm": round(rms_mm, 4),
                    "reproj_max_mm": round(max_mm, 4),
                    "reproj_rms_px": round(float(np.sqrt(np.mean(fit["err_px"][inl] ** 2))), 3),
                    "coverage": round(coverage, 3)},
        "camera": {k: (round(v, 3) if isinstance(v, float) else v) for k, v in cam.items()}
        | {"swatch_px_per_mm_min": round(float(native.min()), 3),
           "swatch_px_per_mm_max": round(float(native.max()), 3), "perspective_ratio": round(persp_ratio, 4)},
        "homography_mm_to_px": np.round(H, 10).tolist(),
        "rectified": {"px_per_mm": ppm, "region_mm": [round(v, 3) for v in region], "size_px": [wr, hr]},
        "segmentation": seg,
        "swatch": {k: v for k, v in meas.items() if not k.startswith("_")}
        | {"touches_edge": touches, "thickness_correction_factor": round(corr, 5),
           "definition": "width/height: median chord through the central 60% of the swatch, rows "
                         "horizontal; bbox_*: minimum-area rectangle"},
        "inputs": {"stitch": stitch, "yarn": yarn, "hook_mm": hook_mm, "n_stitches": n_stitches,
                   "n_rows": n_rows, "row_repeat": row_repeat, "state": state},
        "priors": pri,
        "gauge_from_counts": None, "gauge_from_texture": None, "lattice": None,
        "warnings": warnings,
    }
    W_, H_ = meas["width_mm"], meas["height_mm"]
    if n_stitches or n_rows:
        g = {}
        if n_stitches:
            g |= {"stitch_pitch_mm": round(W_ / n_stitches, 4), "stitches_per_10cm": round(100 * n_stitches / W_, 3)}
        if n_rows:
            g |= {"row_pitch_mm": round(H_ / n_rows, 4), "rows_per_10cm": round(100 * n_rows / H_, 3)}
        g["note"] = "full-swatch extent / count: includes edge-stitch effects (see PROTOCOL.md)"
        result["gauge_from_counts"] = g

    debug = {"image": img, "H": H, "fit": fit, "layout": lay_p, "rect": rect, "valid": valid,
             "mask": mask, "meas": meas, "region": region, "ppm": ppm}
    tg = None
    if texture:
        gray = cv2.cvtColor(rect, cv2.COLOR_BGR2GRAY).astype(np.float32)
        rg, _ = rotate(gray, meas["angle_deg"])
        rmask, _ = rotate(mask * 255, meas["angle_deg"], interp=cv2.INTER_NEAREST)
        try:
            tg = estimate_gauge(rg, rmask > 127, ppm, prior_px=pri["stitch_pitch_mm"],
                                prior_ratio=pri["height_width_ratio"], row_repeat=row_repeat)
            if corr != 1.0:
                tg.stitch_pitch_mm *= corr
                tg.row_pitch_mm *= corr
            result["gauge_from_texture"] = tg.to_dict()
            if tg.confidence_label == "low":
                warnings.append("texture gauge confidence is LOW; do not use it without a hand count")
            if result["gauge_from_counts"] and "stitch_pitch_mm" in result["gauge_from_counts"]:
                rel = tg.stitch_pitch_mm / result["gauge_from_counts"]["stitch_pitch_mm"] - 1
                result["gauge_from_texture"]["stitch_pitch_vs_counts"] = round(rel, 4)
            if lattice:
                try:
                    result["lattice"] = stitch_lattice(tg)
                except Exception as exc:  # experimental: never fail the analysis
                    result["lattice"] = {"experimental": True, "error": str(exc)}
        except ValueError as exc:
            warnings.append(f"texture analysis skipped: {exc}")
    debug["texture"] = tg
    result["csv_row"] = csv_row(result, yarn=yarn, hook_mm=hook_mm, stitch=stitch, state=state, source=source)
    return Analysis(result, debug)


def csv_row(result: dict, *, yarn, hook_mm, stitch, state="unblocked", source="") -> dict:
    gc, gt = result.get("gauge_from_counts"), result.get("gauge_from_texture")
    sw = result["swatch"]
    n_st, n_r = result["inputs"]["n_stitches"], result["inputs"]["n_rows"]
    common = dict(yarn=yarn, hook_mm=hook_mm, stitch=stitch, state=state, source=source,
                  date=_dt.date.today().isoformat(), swatch_id=Path(source).stem if source else None)
    notes = []
    if gc:
        row = dict(n_stitches=n_st or 10, n_rows=n_r or 10, method="photo-counts",
                   width_mm=sw["width_mm"] if n_st else None, height_mm=sw["height_mm"] if n_r else None,
                   width_sd_mm=sw["width_chord_mad_mm"] if n_st else None,
                   height_sd_mm=sw["height_chord_mad_mm"] if n_r else None)
        if gt and not n_st:
            row |= dict(width_mm=round(10 * gt["stitch_pitch_mm"], 3)); notes.append("width from texture")
        if gt and not n_r:
            row |= dict(height_mm=round(10 * gt["row_pitch_mm"], 3)); notes.append("height from texture")
    elif gt:
        row = dict(n_stitches=10, n_rows=10, method="photo-texture",
                   width_mm=round(10 * gt["stitch_pitch_mm"], 3), height_mm=round(10 * gt["row_pitch_mm"], 3),
                   width_sd_mm=round(10 * gt["stitch_pitch_mm"] * gt["split_window_spread"]["stitch"], 3),
                   height_sd_mm=round(10 * gt["row_pitch_mm"] * gt["split_window_spread"]["row"], 3),
                   confidence=gt["confidence"])
        notes.append(f"texture confidence {gt['confidence_label']}")
    else:
        row = dict(method="photo-size-only", width_mm=sw["width_mm"], height_mm=sw["height_mm"])
        notes.append("no counts and no texture gauge: n_stitches/n_rows unknown")
    if result["warnings"]:
        notes.append(f"{len(result['warnings'])} warning(s), see JSON")
    return records.make_row(**common, **row, notes="; ".join(notes))


# ---------------------------------------------------------------------------------------------
# outputs
# ---------------------------------------------------------------------------------------------
def save_overlay(an: Analysis, path: Path, dpi=90):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    d, r = an.debug, an.result
    img, H, fit = d["image"], d["H"], d["fit"]
    fig, ax = plt.subplots(2, 2, figsize=(12, 11))
    a = ax[0, 0]
    a.imshow(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    pts, inl = fit["img"], fit["inliers"]
    a.scatter(pts[inl, 0], pts[inl, 1], s=6, c="lime", label="inlier corners")
    if (~inl).any():
        a.scatter(pts[~inl, 0], pts[~inl, 1], s=12, c="red", marker="x", label="outliers")
    x0, y0, x1, y1 = d["region"]
    win = cv2.perspectiveTransform(np.array([[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]], float), H)[0]
    a.plot(win[:, 0], win[:, 1], "c-", lw=1, label="analysed region")
    ppm = d["ppm"]
    box = d["meas"]["_box_px"]
    box_mm = np.c_[x0 + (box[:, 0] + 0.5) / ppm, y0 + (box[:, 1] + 0.5) / ppm]
    bi = cv2.perspectiveTransform(np.r_[box_mm, box_mm[:1]][None], H)[0]
    a.plot(bi[:, 0], bi[:, 1], "y-", lw=1.5, label="swatch box")
    m = r["markers"]
    a.set_title(f"{r['layout']}: {m['detected_layout']}/{m['of']} markers, reproj rms "
                f"{m['reproj_rms_mm']:.3f} mm, tilt~{r['camera']['tilt_deg']:.0f}°", fontsize=9)
    a.legend(fontsize=7, loc="lower right")
    a.axis("off")

    a = ax[0, 1]
    a.imshow(cv2.cvtColor(d["rect"], cv2.COLOR_BGR2RGB))
    c = d["meas"]["_contour"][:, 0]
    a.plot(c[:, 0], c[:, 1], "c-", lw=0.8)
    bb = np.r_[box, box[:1]]
    a.plot(bb[:, 0], bb[:, 1], "y-", lw=1.2)
    sw = r["swatch"]
    a.set_title(f"rectified {ppm:g} px/mm: swatch {sw['width_mm']:.1f} x {sw['height_mm']:.1f} mm "
                f"(box {sw['bbox_width_mm']:.1f} x {sw['bbox_height_mm']:.1f})", fontsize=9)
    a.axis("off")

    tg: TextureGauge | None = d.get("texture")
    a = ax[1, 0]
    if tg is not None:
        a.imshow(tg.rotated_gray, cmap="gray")
        ppa = tg.analysis_ppm
        lat = r.get("lattice") or {}
        for y in lat.get("row_lines_mm", []):
            a.axhline(y * ppa, color="orange", lw=0.5)
        for row in lat.get("rows", []):
            a.scatter(np.array(row["x_mm"]) * ppa, np.full(len(row["x_mm"]), row["y_mm"] * ppa), s=4, c="cyan")
        gt = r["gauge_from_texture"]
        a.set_title(f"texture: {gt['stitches_per_10cm']:.1f} sts x {gt['rows_per_10cm']:.1f} rows / 10 cm, "
                    f"conf {gt['confidence']:.2f} ({gt['confidence_label']}); lattice EXPERIMENTAL", fontsize=9)
    a.axis("off")

    a = ax[1, 1]
    if tg is not None:
        for fnd, lab, col in ((tg.fx, "stitch (marginal over k_y)", "C0"), (tg.fy, "row (k_x≈0 strip)", "C1")):
            hs = np.array([[h, f, s] for h, f, s in fnd.harmonics]) if fnd.harmonics else np.zeros((0, 3))
            a.axvline(1 / fnd.period_mm, color=col, ls="--", lw=0.8)
            if hs.size:
                a.scatter(hs[:, 1], hs[:, 2], color=col, s=15)
        _spectra_plot(a, tg)
        a.set_xlabel("spatial frequency (cycles/mm)")
        a.set_ylabel("whitened power")
        a.set_yscale("log")
        a.legend(fontsize=7)
    a.set_title("1-D spectra; dashed = fundamental, dots = harmonics", fontsize=9)
    wtxt = "\n".join("! " + w for w in r["warnings"][:5])
    fig.text(0.01, 0.005, wtxt, fontsize=7, va="bottom", color="darkred")
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(path, dpi=dpi)
    plt.close(fig)
    return path


def _spectra_plot(a, tg):
    from .texture import _effective_support, power_spectrum, taper_window, whiten
    win = taper_window(tg.rotated_mask, tg.analysis_ppm, 0.75 * max(tg.stitch_pitch_mm, tg.row_pitch_mm))
    sp = power_spectrum(tg.rotated_work * win, tg.analysis_ppm, _effective_support(win))
    for (f, S), lab, col in ((sp.marginal_x(), "stitch dir.", "C0"), (sp.strip_y(), "row dir.", "C1")):
        df = f[1] - f[0]
        Sw = whiten(S, int(max(9, 0.35 * 0.1 / df * 4)))
        sel = (f > 0.02) & (f < 1.2)
        a.plot(f[sel], Sw[sel], color=col, lw=0.7, label=lab)


def write_outputs(an: Analysis, out_dir: Path, stem: str, overlay=True, csv_path: Path | None = None):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {}
    p = out_dir / f"{stem}.json"
    p.write_text(json.dumps(an.result, indent=1, default=_json_default) + "\n")
    paths["json"] = p
    paths["row_csv"] = records.write_rows(out_dir / f"{stem}_row.csv", [an.result["csv_row"]], append=False)
    if csv_path:
        paths["csv"] = records.write_rows(Path(csv_path), [an.result["csv_row"]], append=True)
    cv2.imwrite(str(out_dir / f"{stem}_rectified.jpg"), an.debug["rect"], [cv2.IMWRITE_JPEG_QUALITY, 88])
    if overlay:
        paths["overlay"] = save_overlay(an, out_dir / f"{stem}_overlay.png")
    return paths


def _json_default(o):
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("photo", type=Path)
    ap.add_argument("--stitch", help="stitch id from spec/stitches.json (sc, hdc, dc, tr, ...)")
    ap.add_argument("--yarn", help="yarn label, e.g. worsted-4 (free text, used to group fits)")
    ap.add_argument("--hook", type=float, help="hook size in mm")
    ap.add_argument("--n-stitches", type=int, help="stitches across the whole swatch (if counted)")
    ap.add_argument("--n-rows", type=int, help="rows over the whole swatch height (if counted)")
    ap.add_argument("--out", type=Path, default=None, help="output directory (default: <photo dir>/swatch_out)")
    ap.add_argument("--csv", type=Path, help="append the result row to this measurements CSV")
    ap.add_argument("--layout", choices=["A4", "letter", "card"], help="force the layout (default: auto)")
    ap.add_argument("--layout-json", type=Path, help="sheet_layout.json (default: lab/swatch/sheet_layout.json)")
    ap.add_argument("--ppm", type=float, default=8.0, help="rectified resolution, px per mm (default 8)")
    ap.add_argument("--ruler-mm", type=float, help="measured length of the printed 100 mm bar (50 mm on the card)")
    ap.add_argument("--row-repeat", choices=["auto", "1", "2"], default="auto",
                    help="rows per texture repeat (2 for turned work whose faces alternate); auto = use prior")
    ap.add_argument("--thickness-mm", type=float, default=0.0,
                    help="swatch thickness: corrects the (small) parallax magnification, approximate")
    ap.add_argument("--state", default="unblocked", choices=["fresh", "unblocked", "blocked"],
                    help="fresh (<1 h off the hook), unblocked (>=24 h rest, never wetted), blocked")
    ap.add_argument("--grabcut", default="auto", choices=["auto", "on", "off"])
    ap.add_argument("--no-overlay", action="store_true")
    a = ap.parse_args(argv)
    img = cv2.imread(str(a.photo), cv2.IMREAD_COLOR)
    if img is None:
        ap.error(f"cannot read image {a.photo}")
    layouts = load_layouts(a.layout_json) if a.layout_json else None
    try:
        an = analyze_image(img, stitch=a.stitch, yarn=a.yarn, hook_mm=a.hook, n_stitches=a.n_stitches,
                           n_rows=a.n_rows, layout=a.layout, layouts=layouts, ppm=a.ppm, ruler_mm=a.ruler_mm,
                           row_repeat=a.row_repeat, thickness_mm=a.thickness_mm, grabcut=a.grabcut,
                           source=a.photo.name, state=a.state)
    except SwatchAnalysisError as exc:
        raise SystemExit(f"error: {exc}")
    out = a.out or a.photo.parent / "swatch_out"
    paths = write_outputs(an, out, a.photo.stem, overlay=not a.no_overlay, csv_path=a.csv)
    r = an.result
    sw = r["swatch"]
    print(f"layout {r['layout']}: {r['markers']['detected_layout']}/{r['markers']['of']} markers, "
          f"reprojection rms {r['markers']['reproj_rms_mm']:.3f} mm, tilt ~{r['camera']['tilt_deg']:.0f} deg")
    print(f"swatch: {sw['width_mm']:.1f} x {sw['height_mm']:.1f} mm (min-area box "
          f"{sw['bbox_width_mm']:.1f} x {sw['bbox_height_mm']:.1f} mm)")
    if r["gauge_from_counts"]:
        print("gauge from counts:", {k: v for k, v in r["gauge_from_counts"].items() if k != "note"})
    gt = r["gauge_from_texture"]
    if gt:
        print(f"gauge from texture: {gt['stitches_per_10cm']:.2f} sts / 10 cm, {gt['rows_per_10cm']:.2f} rows / 10 cm "
              f"(confidence {gt['confidence']:.2f}, {gt['confidence_label']})")
    for w in r["warnings"]:
        print("warning:", w)
    for k, p in paths.items():
        print(f"{k}: {p}")


if __name__ == "__main__":
    main()
