# %% [markdown]
# # Fixtures gallery — the lab reference simulator
#
# Every canonical fixture (`spec/fixtures/*.cro`, compiled by the app to `*.graph.json`) is
# grown round by round and relaxed with L-BFGS (`crolab.sim`, network per `spec/physics.md` with
# the lab clarifications in `lab/SPEC_NOTES.md`). Shape metric and class per physics.md §5.

# %%
import time
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.rcParams["figure.dpi"] = 80
from crolab import graph as G
from crolab.fixtures import fixture_pattern
from crolab.sim import simulate
from crolab.metrics import classify_result
from crolab.curvature import plot_surface, plot_cross_section

names = list(G.iter_fixture_names())
results = {}
for name in names:
    pat, src = fixture_pattern(name)
    t = time.perf_counter()
    res = simulate(pat)
    results[name] = (pat, src, res, classify_result(res), time.perf_counter() - t)

# %%
print(f"{'fixture':20s} {'graph':9s} {'expected':8s} {'sim':8s} {'A':>6s} {'W':>6s} {'Rg mm':>7s} {'nodes':>5s} {'time':>6s}")
for name, (pat, src, res, m, dt) in results.items():
    print(f"{name:20s} {src:9s} {G.load_expected(name)['shape']:8s} {m['class']:8s} {m['A']:6.3f} {m['W']:6.3f} "
          f"{m['Rg']:7.2f} {res.network.n_nodes:5d} {dt:5.1f}s")

# %% [markdown]
# ## 3D renders (course and wale springs; colour = round)

# %%
fig = plt.figure(figsize=(14, 7))
for k, (name, (pat, src, res, m, dt)) in enumerate(results.items()):
    ax = fig.add_subplot(2, 4, k + 1, projection="3d")
    ax.view_init(elev=25, azim=-60)
    plot_surface(ax, res, title=f"{name}\n{m['class']}  A={m['A']:.2f} W={m['W']:.2f}")
plt.tight_layout()
plt.show()

# %% [markdown]
# ## Cross-sections (distance from the metric axis vs height along it)

# %%
fig, axs = plt.subplots(2, 4, figsize=(14, 6))
for ax, (name, (pat, src, res, m, dt)) in zip(axs.ravel(), results.items()):
    plot_cross_section(ax, res, m, title=name)
axs.ravel()[-1].axis("off")
plt.tight_layout()
plt.show()

# %% [markdown]
# ## Shape metric round by round (piece as worked up to each round)

# %%
fig, axs = plt.subplots(1, 2, figsize=(12, 4))
for name, (pat, src, res, m, dt) in results.items():
    ms = [classify_result(res, upto=r) for r in range(len(res.snapshots))]
    rr = range(1, len(ms) + 1)
    axs[0].plot(rr, [x["A"] for x in ms], "o-", label=name)
    axs[1].plot(rr, [x["W"] for x in ms], "o-", label=name)
for ax, t in zip(axs, ("depth A", "waviness W")):
    ax.axhline(0.25, color="k", ls=":", lw=0.8)
    ax.set_xlabel("round"); ax.set_ylabel(t); ax.set_yscale("symlog", linthresh=0.1)
axs[1].legend(fontsize=7)
plt.tight_layout()
plt.show()
