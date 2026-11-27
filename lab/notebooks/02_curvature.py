# %% [markdown]
# # Discrete curvature
#
# * **Intrinsic** (rest lengths only): Gauss–Bonnet on concentric rounds,
#   $K_{enc} = 2\pi - dC/d\rho$, per annulus differences (`crolab.curvature.intrinsic_curvature`).
# * **Extrinsic** (simulated surface): angle deficits on a triangulation that follows the anchor
#   relations between consecutive rounds (solid fabric only).
# * Gauss–Bonnet check: interior deficit + boundary turning $= 2\pi\chi$ exactly ($\chi = 1$ for an
#   open piece, 2 for the sphere capped at its last round). The *interior* total is the geometric
#   statement: ≈ 0 flat, ≈ 4π sphere, ≈ π for this cone, strongly negative hyperbolic.

# %%
import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.rcParams["figure.dpi"] = 80
from crolab.fixtures import fixture_pattern
from crolab.sim import simulate
from crolab.curvature import intrinsic_curvature, extrinsic_curvature, plot_curvature_per_round

solid = ["flat_sc_circle", "flat_dc_circle", "sc_cone", "sc_sphere", "hyperbolic_plane"]
data = {}
for name in solid:
    pat, _ = fixture_pattern(name)
    res = simulate(pat)
    data[name] = (pat, res, intrinsic_curvature(pat), extrinsic_curvature(res), extrinsic_curvature(res, cap=True))

# %%
print(f"{'fixture':18s} {'interior K (sim)':>17s} {'/pi':>6s} {'intrinsic K_enc':>16s} {'/pi':>6s} {'GB open':>9s} {'GB capped/pi':>13s}")
for name, (pat, res, ic, ex, cap) in data.items():
    print(f"{name:18s} {ex['K_interior']:17.3f} {ex['K_interior']/math.pi:6.2f} {ic[-1]['K_enclosed']:16.3f} "
          f"{ic[-1]['K_enclosed']/math.pi:6.2f} {ex['total']-2*math.pi:9.1e} {cap['total']/math.pi:13.6f}")

# %%
fig, axs = plt.subplots(1, 5, figsize=(18, 3.6))
for ax, (name, (pat, res, ic, ex, cap)) in zip(axs, data.items()):
    plot_curvature_per_round(ax, ic, ex, title=name)
plt.tight_layout()
plt.show()

# %% [markdown]
# Cumulative curvature enclosed by each round: intrinsic (rest lengths) vs extrinsic (simulated).

# %%
import numpy as np
fig, ax = plt.subplots(figsize=(7, 4))
for name, (pat, res, ic, ex, cap) in data.items():
    rs = [row["round"] for row in ic]
    ax.plot(np.array(rs) + 1, [row["K_enclosed"] / math.pi for row in ic], "-", label=f"{name} intrinsic")
    pr = ex["per_round"]
    cum = np.cumsum([pr[r] for r in sorted(pr)])
    ax.plot(np.array(sorted(pr)) + 1.5, cum / math.pi, "o", ms=3)
ax.axhline(4, ls=":", color="k", lw=0.7); ax.axhline(0, color="k", lw=0.5)
ax.set_xlabel("round"); ax.set_ylabel("enclosed curvature / π"); ax.legend(fontsize=7)
plt.show()
