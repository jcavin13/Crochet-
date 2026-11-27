# ---
# jupyter:
#   jupytext:
#     formats: py:percent
#     text_representation:
#       extension: .py
#       format_name: percent
#   kernelspec:
#     display_name: Python 3
#     language: python
#     name: python3
# ---

# %% [markdown]
# # Swatch photo analysis — accuracy on synthetic photos
#
# The analyzer (`crolab.swatch.analyze`) turns a photo of a swatch lying on the printed ArUco
# marker sheet into a metrically scaled, fronto-parallel image, measures the swatch and estimates
# gauge (stitches and rows per 10 cm) from the periodicity of the fabric texture.
#
# **Everything here is synthetic.** Photos come from `crolab.swatch.synth`: a procedurally
# rendered swatch (yarn strokes as shaded tubes, per-stitch jitter, row bowing, alternating faces
# of turned rows) on the rendered sheet, photographed by a pinhole camera with tilt, lighting
# gradient, vignetting, blur, noise and JPEG compression. The ground truth (homography, swatch
# size, stitch and row pitch) is known exactly. **No real photograph has been validated yet**:
# these numbers bound the geometry and signal-processing error, not the error on real yarn.

# %%
import tempfile
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
import numpy as np
from IPython.display import Image, display

from crolab.swatch.analyze import analyze_image, save_overlay
from crolab.swatch.layout import load_layouts
from crolab.swatch.synth import PhotoSpec, SwatchSpec, make_photo

LAYOUTS = load_layouts()
plt.rcParams.update({"figure.dpi": 80, "font.size": 9})

# %% [markdown]
# ## One photo, end to end
# A 20 × 20 single-crochet swatch (stitch pitch 6.5 mm, row pitch 6.2 mm — about 15.4 sts and
# 16.1 rows per 10 cm), camera tilted 20° from the sheet normal.

# %%
img, truth = make_photo(SwatchSpec(seed=101), PhotoSpec(tilt_deg=20, tilt_azimuth_deg=40, swatch_angle_deg=3, seed=101),
                        LAYOUTS)
an = analyze_image(img, stitch="sc", hook_mm=5.0, yarn="synthetic", layouts=LAYOUTS)
r = an.result
g = r["gauge_from_texture"]
print(f"markers {r['markers']['detected_layout']}/{r['markers']['of']}, reprojection rms {r['markers']['reproj_rms_mm']:.3f} mm")
print(f"estimated tilt {r['camera']['tilt_deg']:.1f}° (true {truth['tilt_deg']}°), focal {r['camera']['focal_px']:.0f} px "
      f"(true {truth['focal_px']:.0f})")
print(f"swatch box {r['swatch']['bbox_width_mm']:.2f} × {r['swatch']['bbox_height_mm']:.2f} mm "
      f"(true {truth['bbox_width_mm']:.2f} × {truth['bbox_height_mm']:.2f})")
print(f"texture gauge {g['stitches_per_10cm']:.2f} sts, {g['rows_per_10cm']:.2f} rows / 10 cm "
      f"(true {truth['stitches_per_10cm']:.2f}, {truth['rows_per_10cm']:.2f}); confidence {g['confidence']:.2f}")
for w in r["warnings"]:
    print("warning:", w)

# %%
ov = Path(tempfile.gettempdir()) / "swatch_overlay_demo.png"
save_overlay(an, ov, dpi=55)
display(Image(str(ov)))

# %% [markdown]
# Top left: detected marker corners (all used in a RANSAC homography) and the analysed window.
# Top right: the rectified window at 8 px/mm with the segmented swatch and its minimum-area box.
# Bottom left: the swatch rotated to its principal axes, with the **experimental** lattice (row
# lines and per-row points at a constant texture phase). Bottom right: the two 1-D spectra the
# gauge comes from — the stitch spectrum is the 2-D power summed over $k_y$ (insensitive to row
# shear), the row spectrum is the narrow $k_x \approx 0$ strip. Turned single crochet repeats
# every *two* rows (alternating faces), so the row spectrum has a peak at half the row frequency;
# the stitch-type prior (height/width ≈ 0.95 for sc) selects the one-row period.

# %% [markdown]
# ## Sweep: camera tilt × noise
# Single crochet with varying pitch, and double crochet; tilt 0–40°, noise σ 2–15 (8-bit),
# with blur and JPEG growing with the noise level. Each photo is independent (new texture seed,
# camera azimuth, swatch rotation).

# %%
rows = []
rng = np.random.default_rng(0)
configs = []
for tilt in (0, 10, 20, 30, 40):
    for noise in (2, 8, 15):
        configs.append(("sc", tilt, noise))
for tilt in (0, 20, 35):
    configs.append(("dc", tilt, 6))
for k, (st, tilt, noise) in enumerate(configs):
    if st == "sc":
        px = float(rng.uniform(5.0, 7.5)); py = px * float(rng.uniform(0.88, 1.0)); n_st, n_r = int(min(20, 125 // px)), 20
    else:
        px = float(rng.uniform(6.0, 7.2)); py = px * float(rng.uniform(1.8, 2.0)); n_st, n_r = int(min(18, 125 // px)), 9
    sw = SwatchSpec(stitch=st, pitch_x_mm=px, pitch_y_mm=py, n_stitches=n_st, n_rows=n_r, seed=200 + k)
    ph = PhotoSpec(tilt_deg=tilt, tilt_azimuth_deg=float(rng.uniform(0, 360)), swatch_angle_deg=float(rng.uniform(-6, 6)),
                   noise_sigma=noise, blur_px=0.6 + noise / 12, jpeg_quality=int(95 - 1.5 * noise), seed=200 + k)
    img, tr = make_photo(sw, ph, LAYOUTS)
    a = analyze_image(img, stitch=st, hook_mm=5.0, layouts=LAYOUTS, lattice=False).result
    gt = a["gauge_from_texture"]
    H_est, H_true = np.array(a["homography_mm_to_px"]), np.array(tr["H_mm_to_px"])
    x0, y0, x1, y1 = LAYOUTS["A4"].window_mm
    grid = np.array([[x, y] for x in np.linspace(x0, x1, 5) for y in np.linspace(y0, y1, 5)], float)
    back = cv2.perspectiveTransform(cv2.perspectiveTransform(grid[None], H_true), np.linalg.inv(H_est))[0]
    rows.append(dict(stitch=st, tilt=tilt, noise=noise,
                     win_err_mm=float(np.linalg.norm(back - grid, axis=1).max()),
                     reproj_rms_mm=a["markers"]["reproj_rms_mm"],
                     tilt_est=a["camera"]["tilt_deg"],
                     w_err=a["swatch"]["bbox_width_mm"] / tr["bbox_width_mm"] - 1,
                     h_err=a["swatch"]["bbox_height_mm"] / tr["bbox_height_mm"] - 1,
                     px_err=gt["stitch_pitch_mm"] / px - 1, py_err=gt["row_pitch_mm"] / py - 1,
                     conf=gt["confidence"], label=gt["confidence_label"]))
print(f"{len(rows)} photos analysed")

# %%
hdr = f"{'st':3s} {'tilt':>4s} {'noise':>5s} {'win err mm':>10s} {'rms mm':>7s} {'tilt est':>8s} " \
      f"{'width %':>8s} {'height %':>8s} {'stitch %':>8s} {'row %':>7s} {'conf':>5s}"
print(hdr)
print("-" * len(hdr))
for q in rows:
    print(f"{q['stitch']:3s} {q['tilt']:4d} {q['noise']:5d} {q['win_err_mm']:10.3f} {q['reproj_rms_mm']:7.3f} "
          f"{q['tilt_est']:8.1f} {100 * q['w_err']:8.2f} {100 * q['h_err']:8.2f} {100 * q['px_err']:8.2f} "
          f"{100 * q['py_err']:7.2f} {q['conf']:5.2f} {q['label']}")
A = lambda k: np.array([q[k] for q in rows])
print()
print(f"max |window error|      {A('win_err_mm').max():.3f} mm")
print(f"max |width/height err|  {100 * max(np.abs(A('w_err')).max(), np.abs(A('h_err')).max()):.2f} %")
print(f"max |stitch pitch err|  {100 * np.abs(A('px_err')).max():.2f} %   median {100 * np.median(np.abs(A('px_err'))):.2f} %")
print(f"max |row pitch err|     {100 * np.abs(A('py_err')).max():.2f} %   median {100 * np.median(np.abs(A('py_err'))):.2f} %")

# %%
fig, ax = plt.subplots(1, 3, figsize=(12, 3.4))
sc = [q for q in rows if q["stitch"] == "sc"]
for noise, m in zip((2, 8, 15), "os^"):
    s = [q for q in sc if q["noise"] == noise]
    t = [q["tilt"] for q in s]
    ax[0].plot(t, [q["win_err_mm"] for q in s], m + "-", label=f"noise σ={noise}")
    ax[1].plot(t, [100 * abs(q["w_err"]) for q in s], m + "-", label=f"width, σ={noise}")
    ax[2].plot(t, [100 * abs(q["px_err"]) for q in s], m + "-", label=f"stitch, σ={noise}")
    ax[2].plot(t, [100 * abs(q["py_err"]) for q in s], m + ":", color=ax[2].lines[-1].get_color(), label=f"row, σ={noise}")
ax[0].set(xlabel="camera tilt (deg)", ylabel="max rectification error (mm)", title="metric rectification")
ax[1].set(xlabel="camera tilt (deg)", ylabel="|error| (%)", title="swatch size (min-area box)")
ax[2].set(xlabel="camera tilt (deg)", ylabel="|error| (%)", title="texture gauge (no counts)")
ax[1].axhline(1.5, color="grey", lw=0.6, ls="--")
ax[2].axhline(5, color="grey", lw=0.6, ls="--")
for a_ in ax:
    a_.legend(fontsize=7)
fig.tight_layout()

# %% [markdown]
# The sweep above uses fairly regular fabric (stitch jitter 4 % of the pitch, 0.3 mm row bowing),
# so it mostly measures the geometry. Real fabric is less regular. Next: how the texture gauge
# and its confidence degrade as per-stitch jitter and row bowing grow (tilt 15°, two seeds each).

# %%
stress = []
for j, rw in [(0.04, 0.3), (0.08, 0.6), (0.12, 1.0), (0.18, 1.4), (0.25, 1.8), (0.35, 2.0)]:
    for seed in (1, 2, 3):
        img, tr = make_photo(SwatchSpec(seed=300 + seed, jitter=j, row_wave_mm=rw),
                             PhotoSpec(tilt_deg=15, seed=300 + seed, img_wh=(1200, 1600), render_ppm=6), LAYOUTS)
        g = analyze_image(img, stitch="sc", hook_mm=5.0, layouts=LAYOUTS, lattice=False).result["gauge_from_texture"]
        stress.append(dict(jitter=j, bow=rw, px_err=g["stitch_pitch_mm"] / 6.5 - 1, py_err=g["row_pitch_mm"] / 6.2 - 1,
                           conf=g["confidence"], label=g["confidence_label"]))
print(f"{'jitter':>6s} {'bow mm':>6s} {'stitch %':>8s} {'row %':>8s} {'conf':>5s}")
for q in stress:
    print(f"{q['jitter']:6.2f} {q['bow']:6.1f} {100 * q['px_err']:8.2f} {100 * q['py_err']:8.2f} {q['conf']:5.2f} {q['label']}")
fig, ax = plt.subplots(figsize=(5.5, 3.4))
err = np.array([100 * max(abs(q["px_err"]), abs(q["py_err"])) for q in stress])
conf = np.array([q["conf"] for q in stress])
ax.scatter(conf, np.clip(err, 0.01, 200), c=[q["jitter"] for q in stress], cmap="viridis")
ax.set(yscale="log", xlabel="reported confidence", ylabel="worst gauge error (%)",
       title="confidence vs. actual error (colour = jitter)")
ax.axhline(5, color="grey", ls="--", lw=0.6)
ax.axvline(0.35, color="grey", ls=":", lw=0.6)
fig.tight_layout()
good = conf >= 0.35
print(f"confidence >= 0.35 (medium/high): {good.sum()} photos, worst error {err[good].max() if good.any() else float('nan'):.2f} %")
print(f"confidence <  0.35 (low):         {(~good).sum()} photos, worst error {err[~good].max():.1f} %")

# %% [markdown]
# ## Failure modes
# **Irregular fabric.** With stitch jitter of 35 % of the pitch and 2 mm row bowing the texture is
# no longer periodic enough; the analyzer must say so rather than return a confident number.

# %%
img, tr = make_photo(SwatchSpec(seed=10, jitter=0.35, row_wave_mm=2.0), PhotoSpec(tilt_deg=10, seed=10), LAYOUTS)
a = analyze_image(img, stitch="sc", hook_mm=5.0, layouts=LAYOUTS, lattice=False).result
g = a["gauge_from_texture"]
print(f"estimate {g['stitch_pitch_mm']:.2f} / {g['row_pitch_mm']:.2f} mm (true 6.5 / 6.2), "
      f"confidence {g['confidence']:.2f} -> {g['confidence_label']}")
print("split-window spread:", g["split_window_spread"])
print([w for w in a["warnings"] if "LOW" in w or "low" in w])

# %% [markdown]
# **Print scale.** A sheet printed at 97 % ("fit to page") shrinks every marker coordinate by the
# same factor; a homography absorbs that exactly, so it **cannot be detected from the photo**.
# Sizes come out 3 % too large unless the measured length of the printed 100 mm bar is supplied.

# %%
img, tr = make_photo(SwatchSpec(seed=11), PhotoSpec(tilt_deg=10, print_scale=0.97, seed=11), LAYOUTS)
for ruler in (None, 97.0):
    a = analyze_image(img, stitch="sc", hook_mm=5.0, layouts=LAYOUTS, lattice=False, ruler_mm=ruler).result
    print(f"--ruler-mm {ruler}: width error {100 * (a['swatch']['bbox_width_mm'] / tr['bbox_width_mm'] - 1):+.2f} %, "
          f"stitch pitch error {100 * (a['gauge_from_texture']['stitch_pitch_mm'] / 6.5 - 1):+.2f} %")

# %% [markdown]
# ## What this does not show
# * Real yarn: fuzz (mohair), variegated colour, dark yarn texture, real stitch anatomy, edge
#   stitches and turning chains, swatches that curl.
# * Swatch thickness: the top of a 3 mm swatch is above the sheet plane, which magnifies it by
#   about thickness / camera distance (~1 % at 30 cm); `--thickness-mm` corrects this
#   approximately and is not applied here (synthetic swatches are flat).
# * Lens distortion (phone cameras mostly correct it; not modelled).
# * Lace / thread / mesh swatches with large holes (segmentation closes holes; gauge on open
#   lace is untested).
