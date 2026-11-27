"""Synthetic swatch photos with known ground truth.

A procedurally rendered crochet swatch (yarn strokes as shaded tubes on a height field, with
per-stitch jitter, row waviness and alternating front/back rows for turned flat work) is laid on
the rendered marker sheet (or next to the marker card), then photographed by a pinhole camera
with a chosen tilt, plus lighting gradient, vignetting, blur, sensor noise and JPEG compression.

Everything is in the sheet frame (mm, y down); see ``layout.py`` for the raster convention.
This is a *test generator*, not a physically faithful yarn model: it reproduces the things the
analyzer relies on (a periodic 2-D texture with harmonics, irregular edges, gaps showing the
background, shading) so that failures of the geometry / periodicity code show up.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import cv2
import numpy as np

from .layout import Layout, load_layouts, mm_to_px_matrix, render_layout


# ---------------------------------------------------------------------------------------------
# swatch texture
# ---------------------------------------------------------------------------------------------
@dataclass
class SwatchSpec:
    stitch: str = "sc"
    n_stitches: int = 20
    n_rows: int = 20
    pitch_x_mm: float = 6.5          # stitch width (course direction)
    pitch_y_mm: float = 6.2          # row height (wale direction)
    yarn_mm: float | None = None     # yarn diameter; default 0.42 * pitch_x
    color_bgr: tuple = (60, 80, 175)  # reddish yarn on white paper
    jitter: float = 0.04             # per-stitch position jitter, fraction of pitch
    row_wave_mm: float = 0.3         # amplitude of smooth row bowing
    turned: bool = True              # flat rows worked back and forth (alternate faces)
    seed: int = 0


def _stitch_strokes(stitch: str, front: bool, cx: float, cy: float, a: float, b: float, y_mm: float):
    """List of (x0, y0, x1, y1, radius, z, shade) strokes for one stitch (mm, y down).
    Cell spans [cx-a/2, cx+a/2] x [cy-b/2, cy+b/2]; the top loops sit at the top."""
    r = y_mm / 2
    S = []
    top = cy - 0.5 * b + 0.55 * r
    S.append((cx - 0.47 * a, top, cx + 0.47 * a, top, 0.85 * r, 0.45 * r, 1.08))  # top loops (braid)
    S.append((cx - 0.2 * a, top - 0.15 * r, cx + 0.05 * a, top + 0.25 * r, 0.55 * r, 0.6 * r, 1.15))
    bot = cy + 0.5 * b
    if stitch == "sc":
        if front:  # the "V" of the two legs
            S.append((cx - 0.07 * a, bot - 0.2 * r, cx - 0.27 * a, top + 0.6 * r, r, 0.0, 0.95))
            S.append((cx + 0.07 * a, bot - 0.2 * r, cx + 0.27 * a, top + 0.6 * r, r, 0.0, 0.9))
        else:      # back bump across the stitch
            S.append((cx - 0.15 * a, bot, cx - 0.15 * a, top, 0.8 * r, 0.0, 0.85))
            S.append((cx + 0.15 * a, bot, cx + 0.15 * a, top, 0.8 * r, 0.0, 0.85))
            mid = cy + 0.1 * b
            S.append((cx - 0.42 * a, mid, cx + 0.42 * a, mid, 1.05 * r, 0.3 * r, 1.0))
    else:
        wraps = {"hdc": 0, "dc": 1, "tr": 2, "dtr": 3}.get(stitch, 1)
        for s in (-1, 1):
            S.append((cx + s * 0.11 * a, bot, cx + s * 0.11 * a, top + 0.4 * r, 0.9 * r, 0.0, 0.92))
        span = (bot - top)
        for k in range(wraps):
            ym = top + span * (k + 1) / (wraps + 1)
            d = 0.12 * span / max(wraps, 1) * (1 if front else -1)
            S.append((cx - 0.3 * a, ym + d, cx + 0.3 * a, ym - d, 0.75 * r, 0.35 * r, 1.05))
        if stitch == "hdc" and not front:
            ym = top + 0.3 * span
            S.append((cx - 0.4 * a, ym, cx + 0.4 * a, ym, 0.85 * r, 0.3 * r, 1.0))
    return S


def render_swatch(spec: SwatchSpec, ppm: float):
    """Return (rgb float32 HxWx3 in [0,1], alpha float32, origin offset mm) in swatch frame."""
    rng = np.random.default_rng(spec.seed)
    a, b = spec.pitch_x_mm, spec.pitch_y_mm
    y_mm = spec.yarn_mm or 0.42 * a
    m = 1.2 * y_mm
    Wmm, Hmm = spec.n_stitches * a + 2 * m, spec.n_rows * b + 2 * m
    w, h = int(np.ceil(Wmm * ppm)), int(np.ceil(Hmm * ppm))
    Z = np.zeros((h, w), np.float32)
    F = np.ones((h, w), np.float32)
    phases = rng.uniform(0, 2 * np.pi, spec.n_rows)
    Lx = spec.n_stitches * a
    for row in range(spec.n_rows):
        front = (row % 2 == 0) or not spec.turned
        cy0 = m + (spec.n_rows - row - 0.5) * b
        for st in range(spec.n_stitches):
            cx = m + (st + 0.5) * a + rng.normal(0, spec.jitter * a)
            cy = cy0 + rng.normal(0, spec.jitter * b) + spec.row_wave_mm * np.sin(np.pi * cx / Lx + phases[row]) \
                * (1 if row % 3 else -1)
            for (x0, y0, x1, y1, r, z, sh) in _stitch_strokes(spec.stitch, front, cx, cy, a, b, y_mm):
                x0, y0, x1, y1 = (v + rng.normal(0, 0.025 * a) for v in (x0, y0, x1, y1))
                _tube(Z, F, x0, y0, x1, y1, r, z, sh * rng.uniform(0.92, 1.08), ppm)
    # shading
    gy, gx = np.gradient(Z, 1.0 / ppm)
    gx, gy = np.clip(gx, -4, 4), np.clip(gy, -4, 4)
    n = np.stack([-gx, -gy, np.ones_like(Z)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    L = np.array([-0.35, -0.45, 0.82])
    L /= np.linalg.norm(L)
    lam = np.clip(n @ L, 0, 1)
    ao = 0.55 + 0.45 * np.clip(Z / y_mm, 0, 1)
    fib = cv2.GaussianBlur(rng.normal(0, 1, Z.shape).astype(np.float32), (0, 0), 0.25 * ppm)
    fib /= fib.std() + 1e-6
    shade = (0.28 + 0.8 * lam) * ao * F * (1 + 0.07 * fib)
    base = np.array(spec.color_bgr, np.float32) / 255.0
    rgb = np.clip(shade[..., None] * base[None, None, :] * 1.25, 0, 1)
    alpha = cv2.GaussianBlur((Z > 0).astype(np.float32), (0, 0), 0.35)
    return rgb.astype(np.float32), alpha, (m, m)


def _tube(Z, F, x0, y0, x1, y1, r, z, shade, ppm):
    """Max-composite a cylinder of radius r (mm) lying on segment p0-p1 at base height z."""
    h, w = Z.shape
    pad = r + 0.1
    u0, u1 = int(max(0, np.floor((min(x0, x1) - pad) * ppm))), int(min(w, np.ceil((max(x0, x1) + pad) * ppm) + 1))
    v0, v1 = int(max(0, np.floor((min(y0, y1) - pad) * ppm))), int(min(h, np.ceil((max(y0, y1) + pad) * ppm) + 1))
    if u1 <= u0 or v1 <= v0:
        return
    xs = (np.arange(u0, u1) + 0.5) / ppm
    ys = (np.arange(v0, v1) + 0.5) / ppm
    X, Y = np.meshgrid(xs, ys)
    dx, dy = x1 - x0, y1 - y0
    L2 = dx * dx + dy * dy + 1e-12
    t = np.clip(((X - x0) * dx + (Y - y0) * dy) / L2, 0, 1)
    d2 = (X - x0 - t * dx) ** 2 + (Y - y0 - t * dy) ** 2
    hh = np.where(d2 < r * r, z + np.sqrt(np.maximum(r * r - d2, 0)), 0).astype(np.float32)
    zl, fl = Z[v0:v1, u0:u1], F[v0:v1, u0:u1]
    better = hh > zl
    zl[better] = hh[better]
    fl[better] = shade


# ---------------------------------------------------------------------------------------------
# scene (plane) and camera
# ---------------------------------------------------------------------------------------------
@dataclass
class PhotoSpec:
    layout: str = "A4"
    swatch_angle_deg: float = 0.0      # in-plane rotation of the swatch on the sheet
    swatch_offset_mm: tuple = (0.0, 0.0)
    tilt_deg: float = 15.0              # camera tilt from the sheet normal
    tilt_azimuth_deg: float = 30.0
    yaw_deg: float = 3.0               # camera roll about its optical axis
    img_wh: tuple = (1500, 2000)
    focal_factor: float = 0.85         # f_px = focal_factor * max(img_wh)
    fill: float = 0.9
    light_gradient: float = 0.35       # relative brightness change across the image
    vignette: float = 0.25
    blur_px: float = 0.8
    noise_sigma: float = 3.0           # 8-bit units
    jpeg_quality: int | None = 90
    occlude_markers: int = 0           # number of markers to cover with a "finger"
    window_fill: int | None = None     # dark window variant
    render_ppm: float = 8.0
    print_scale: float = 1.0           # printer scaled the sheet by this factor (e.g. 'fit to page')
    seed: int = 0


def _rot(axis, ang):
    axis = np.asarray(axis, float)
    axis /= np.linalg.norm(axis)
    return cv2.Rodrigues(axis * ang)[0]


def camera_homography(look_at, tilt_deg, tilt_az_deg, yaw_deg, f_px, img_wh, fit_pts, fill=0.9):
    """Homography mm(plane z=0) -> image px for a pinhole camera that sees fit_pts filling the frame."""
    W, H = img_wh
    K = np.array([[f_px, 0, (W - 1) / 2], [0, f_px, (H - 1) / 2], [0, 0, 1]])
    az = np.radians(tilt_az_deg)
    R = _rot([np.cos(az), np.sin(az), 0], np.radians(tilt_deg)) @ _rot([0, 0, 1], np.radians(yaw_deg))
    fwd = R.T @ np.array([0, 0, 1.0])
    L = np.array([look_at[0], look_at[1], 0.0])

    def H_of(D):
        C = L - D * fwd
        t = -R @ C
        Hm = K @ np.column_stack([R[:, 0], R[:, 1], t])
        return Hm / Hm[2, 2]

    def fits(D):
        p = np.c_[fit_pts, np.ones(len(fit_pts))] @ H_of(D).T
        if np.any(p[:, 2] <= 0):
            return False
        uv = p[:, :2] / p[:, 2:]
        return (np.all(np.abs(uv[:, 0] - (W - 1) / 2) <= fill * W / 2)
                and np.all(np.abs(uv[:, 1] - (H - 1) / 2) <= fill * H / 2))

    lo, hi = 20.0, 1e5
    for _ in range(60):
        mid = np.sqrt(lo * hi)
        lo, hi = (lo, mid) if fits(mid) else (mid, hi)
    return H_of(hi), K, R, hi


def _table(img_wh, rng):
    W, H = img_wh
    base = np.array([95, 120, 140], np.float32) / 255
    n = cv2.resize(rng.normal(0, 1, (H // 40 + 2, W // 40 + 2)).astype(np.float32), (W, H),
                   interpolation=cv2.INTER_CUBIC)
    grain = cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 2)
    return np.clip(base[None, None] * (1 + 0.08 * n[..., None] + 0.03 * grain[..., None]), 0, 1)


def compose_plane(layout: Layout, swatch: SwatchSpec, ps: PhotoSpec, rng):
    """Render the plane (sheet or card + table) at ps.render_ppm in the layout frame.

    Returns (rgb float32, origin_mm, swatch_mask uint8, swatch centre mm)."""
    ppm = ps.render_ppm
    paper = np.array([0.95, 0.96, 0.96], np.float32)
    lay = render_layout(layout, ppm, window_fill=ps.window_fill).astype(np.float32) / 255.0
    if layout.kind == "sheet":
        origin = (0.0, 0.0)
        canvas = lay[..., None] * paper[None, None]
        x0, y0, x1, y1 = layout.window_mm
        centre = np.array([(x0 + x1) / 2, (y0 + y1) / 2]) + np.asarray(ps.swatch_offset_mm)
    else:  # card on a table: plane canvas larger than the card
        sw = swatch.n_stitches * swatch.pitch_x_mm
        origin = (-60.0, -60.0)
        size = (layout.size_mm[0] + sw + 140.0, max(layout.size_mm[1], swatch.n_rows * swatch.pitch_y_mm) + 120.0)
        Wp, Hp = int(round(size[0] * ppm)), int(round(size[1] * ppm))
        canvas = _table((Wp, Hp), rng)
        u0, v0 = int(round(-origin[0] * ppm)), int(round(-origin[1] * ppm))
        canvas[v0:v0 + lay.shape[0], u0:u0 + lay.shape[1]] = lay[..., None] * paper[None, None]
        centre = np.array([layout.size_mm[0] + 15.0 + sw / 2, size[1] / 2 + origin[1]]) + np.asarray(ps.swatch_offset_mm)
    rgb, alpha, (mx, my) = render_swatch(swatch, ppm)
    sh, sw_ = alpha.shape
    # swatch raster px -> plane raster px: rotate about swatch centre, translate to `centre`
    c_sw = np.array([(sw_ - 1) / 2, (sh - 1) / 2])
    c_pl = (centre - np.asarray(origin)) * ppm - 0.5
    M = cv2.getRotationMatrix2D(tuple(c_sw), -ps.swatch_angle_deg, 1.0)
    M[:, 2] += c_pl - c_sw
    size = (canvas.shape[1], canvas.shape[0])
    a_w = cv2.warpAffine(alpha, M, size, flags=cv2.INTER_LINEAR)
    c_w = cv2.warpAffine(rgb * alpha[..., None], M, size, flags=cv2.INTER_LINEAR)
    # soft contact shadow, offset away from the light
    sdw = cv2.GaussianBlur(a_w, (0, 0), 1.2 * ppm)
    sdw = np.roll(np.roll(sdw, int(0.8 * ppm), 0), int(0.6 * ppm), 1)
    canvas = canvas * (1 - 0.3 * sdw[..., None])
    canvas = canvas * (1 - a_w[..., None]) + c_w
    mask = (a_w > 0.5).astype(np.uint8)
    return canvas.astype(np.float32), origin, mask, centre


def swatch_truth_dims(mask: np.ndarray, ppm: float, angle_deg: float) -> dict:
    """True width/height (mm) of the rendered swatch mask in its own (unrotated) axes."""
    ys, xs = np.nonzero(mask)
    pts = np.c_[xs, ys].astype(np.float64) / ppm
    th = np.radians(angle_deg)
    # undo the in-plane rotation (swatch drawn rotated by +angle visually clockwise)
    Rm = np.array([[np.cos(th), np.sin(th)], [-np.sin(th), np.cos(th)]])
    q = (pts - pts.mean(0)) @ Rm.T
    wext, hext = np.ptp(q[:, 0]) + 1 / ppm, np.ptp(q[:, 1]) + 1 / ppm
    return {"bbox_width_mm": float(wext), "bbox_height_mm": float(hext)}


def make_photo(swatch: SwatchSpec | None = None, photo: PhotoSpec | None = None, layouts=None):
    """Render a synthetic photo. Returns (bgr uint8 image, truth dict)."""
    swatch = swatch or SwatchSpec()
    ps = photo or PhotoSpec()
    rng = np.random.default_rng(ps.seed)
    layouts = layouts or load_layouts()
    layout = layouts[ps.layout]
    if ps.print_scale != 1.0:
        layout = layout.scaled(ps.print_scale)
    plane, origin, mask, centre = compose_plane(layout, swatch, ps, rng)
    ppm = ps.render_ppm
    # camera
    if layout.kind == "sheet":
        W, H = layout.size_mm
        fit = np.array([[0, 0], [W, 0], [W, H], [0, H]], float)
        look = np.array([W / 2, H / 2]) + rng.normal(0, 4, 2)
    else:
        ys, xs = np.nonzero(mask)
        cw, ch = layout.size_mm
        lo = np.minimum([0.0, 0.0], [xs.min() / ppm + origin[0], ys.min() / ppm + origin[1]]) - 12
        hi = np.maximum([cw, ch], [xs.max() / ppm + origin[0], ys.max() / ppm + origin[1]]) + 12
        fit = np.array([[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]])
        look = fit.mean(0)
    f_px = ps.focal_factor * max(ps.img_wh)
    Hmm, K, R, D = camera_homography(look, ps.tilt_deg, ps.tilt_azimuth_deg, ps.yaw_deg, f_px, ps.img_wh, fit, ps.fill)
    S = mm_to_px_matrix(ppm, origin)
    M = Hmm @ np.linalg.inv(S)
    # anti-alias: blur the plane raster if the camera samples it more coarsely than it was rendered
    Wi, Hi = ps.img_wh
    J = _jacobian_scale(Hmm, centre)
    ratio = ppm / max(J, 1e-6)
    src = plane
    if ratio > 1.2:
        src = cv2.GaussianBlur(plane, (0, 0), 0.45 * ratio)
    img = _table((Wi, Hi), rng)
    cv2.warpPerspective(src, M, (Wi, Hi), dst=img, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_TRANSPARENT)
    # occluders ("fingers") over random markers
    covered = []
    if ps.occlude_markers:
        ids = rng.choice(sorted(layout.markers), ps.occlude_markers, replace=False)
        for mid in ids:
            c = layout.markers[int(mid)].mean(0)
            p = cv2.perspectiveTransform(c[None, None], Hmm)[0, 0]
            rad = layout.marker_mm * 0.9 * J
            cv2.ellipse(img, (int(p[0]), int(p[1])), (int(rad * 1.6), int(rad * 0.9)),
                        float(rng.uniform(0, 180)), 0, 360, (0.55, 0.65, 0.85), -1, cv2.LINE_AA)
            covered.append(int(mid))
    # photometric: lighting gradient, vignette, blur, noise, jpeg
    yy, xx = np.mgrid[0:Hi, 0:Wi].astype(np.float32)
    xn, yn = xx / Wi - 0.5, yy / Hi - 0.5
    ang = rng.uniform(0, 2 * np.pi)
    gain = 1 + ps.light_gradient * (np.cos(ang) * xn + np.sin(ang) * yn)
    gain *= 1 - ps.vignette * (xn ** 2 + yn ** 2) * 2
    img = img * gain[..., None] * 0.97
    if ps.blur_px > 0:
        img = cv2.GaussianBlur(img, (0, 0), ps.blur_px)
    img = img * 255 + rng.normal(0, ps.noise_sigma, img.shape)
    img = np.clip(img, 0, 255).astype(np.uint8)
    if ps.jpeg_quality:
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, int(ps.jpeg_quality)])
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    dims = swatch_truth_dims(mask, ppm, ps.swatch_angle_deg)
    truth = {
        "H_mm_to_px": Hmm.tolist(), "focal_px": f_px, "camera_distance_mm": float(D),
        "tilt_deg": ps.tilt_deg, "layout": ps.layout, "occluded_ids": covered,
        "swatch": asdict(swatch), "photo": {k: v for k, v in asdict(ps).items()},
        "stitch_pitch_mm": swatch.pitch_x_mm, "row_pitch_mm": swatch.pitch_y_mm,
        "stitches_per_10cm": 100 / swatch.pitch_x_mm, "rows_per_10cm": 100 / swatch.pitch_y_mm,
        "swatch_centre_mm": centre.tolist(), **dims,
    }
    return img, truth


def _jacobian_scale(H, pt):
    """sqrt(|det J|) of the projective map at pt: local px per mm."""
    x, y = pt
    p = H @ np.array([x, y, 1.0])
    w = p[2]
    J = (H[:2, :2] * w - np.outer(p[:2], H[2, :2])) / w ** 2
    return float(np.sqrt(abs(np.linalg.det(J))))


# ---------------------------------------------------------------------------------------------
# sample set (committed under data/synthetic/swatches/)
# ---------------------------------------------------------------------------------------------
SAMPLES = {
    "synth_sc_worsted_tilt20": (SwatchSpec(stitch="sc", pitch_x_mm=6.5, pitch_y_mm=6.2, seed=101),
                                PhotoSpec(tilt_deg=20, tilt_azimuth_deg=40, swatch_angle_deg=3, seed=101)),
    "synth_dc_worsted_tilt15": (SwatchSpec(stitch="dc", pitch_x_mm=6.7, pitch_y_mm=12.6, n_stitches=18, n_rows=9,
                                           color_bgr=(150, 110, 50), seed=102),
                                PhotoSpec(tilt_deg=15, tilt_azimuth_deg=250, swatch_angle_deg=-4, seed=102)),
}


def main(argv=None):
    import argparse
    import json
    from pathlib import Path

    from crolab import REPO_ROOT
    ap = argparse.ArgumentParser(description="Write the synthetic sample photos (+ .truth.json).")
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "data" / "synthetic" / "swatches")
    ap.add_argument("--quality", type=int, default=82)
    a = ap.parse_args(argv)
    a.out.mkdir(parents=True, exist_ok=True)
    for name, (sw, ph) in SAMPLES.items():
        ph.jpeg_quality = None
        img, truth = make_photo(sw, ph)
        p = a.out / f"{name}.jpg"
        cv2.imwrite(str(p), img, [cv2.IMWRITE_JPEG_QUALITY, a.quality])
        truth = {k: v for k, v in truth.items() if k != "photo"} | {
            "generator": "python -m crolab.swatch.synth", "note": "SYNTHETIC image, not a real swatch"}
        (a.out / f"{name}.truth.json").write_text(json.dumps(truth, indent=1) + "\n")
        print(p, p.stat().st_size)


if __name__ == "__main__":
    main()
