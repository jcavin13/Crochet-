# %% [markdown]
# # Parameter fitting scaffold (SYNTHETIC data)
#
# `crolab.fitting` fits stitch rest width and height per stitch type and (yarn, hook, state)
# from swatch measurements (`lab/README.md` documents the CSV). **The data below are synthetic**
# (`lab/data/example_swatches.csv`, generated with known truth) — they demonstrate recovery,
# not real yarn. Stiffness is not fitted (needs load tests).

# %%
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.rcParams["figure.dpi"] = 80
import numpy as np
from crolab import REPO_ROOT
from crolab.fitting import read_measurements, fit_sets, circle_checks, SYNTH_TRUTH

rows = read_measurements(REPO_ROOT / "lab" / "data" / "example_swatches.csv")
sets, diag = fit_sets(rows)
s = sets[0]
print(s["id"], s["status"])
print(f"{'stitch':6s} {'true w':>7s} {'fit w':>12s} {'true h':>7s} {'fit h':>12s}")
for t, (w, h) in SYNTH_TRUTH.items():
    st = s["stitches"][t]
    hs = f"{st['height']:.3f}±{st.get('height_sd', float('nan')):.3f}"
    print(f"{t:6s} {w:7.2f} {st['width']:.3f}±{st.get('width_sd', 0):.3f} {str(h):>7s} {hs:>12s}")

# %%
fig, axs = plt.subplots(1, 2, figsize=(11, 4))
for t in SYNTH_TRUTH:
    sub = [r for r in rows if r.stitch == t and r.width_mm is not None]
    n = np.array([r.n_stitches for r in sub]); y = np.array([r.width_mm for r in sub])
    f = diag[s["id"]]["widths"][t]
    axs[0].plot(n, y, "o", label=t); axs[0].plot(n, f.value * n + f.intercept, "-", color=axs[0].lines[-1].get_color())
    if t in diag[s["id"]]["heights"]:
        sub = [r for r in sub if r.height_mm is not None]
        m = np.array([r.n_rows for r in sub]); z = np.array([r.height_mm for r in sub])
        fh = diag[s["id"]]["heights"][t]
        axs[1].plot(m, z, "o", label=t); axs[1].plot(m, fh.value * m + fh.intercept, "-", color=axs[1].lines[-1].get_color())
axs[0].set_xlabel("stitches"); axs[0].set_ylabel("width (mm)"); axs[0].legend()
axs[1].set_xlabel("rows"); axs[1].set_ylabel("height (mm)"); axs[1].legend()
plt.tight_layout()
plt.show()

# %% [markdown]
# Circle tests recorded on the same CSV, checked against the analytic flatness prediction with
# the fitted parameters:

# %%
for c in circle_checks(sets, rows):
    print(c["counts"][:3], "observed", c["observed"], "predicted", c["predicted"], "agree" if c["agree"] else "DISAGREE")
