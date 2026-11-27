# %% [markdown]
# # Analytic flatness vs. simulation — the cup → flat → ruffle transition
#
# Flat-circle tests: spiral sc discs, `k` stitches into the magic ring and `k` increases per
# round, 7 rounds. The analytic check (`spec/flatness.md`) predicts flat near k = 2πh/w ≈ 6
# for sc; fewer increases cup, more ruffle. The sim reports depth A and waviness W.

# %%
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.rcParams["figure.dpi"] = 80
from crolab.builders import sc_rounds
from crolab.flatness import analyse
from crolab.sim import simulate
from crolab.metrics import classify_result
from crolab.curvature import plot_cross_section
from crolab.params import load_sim_config

cfg = load_sim_config()
ks = [3, 4, 5, 6, 7, 8, 9, 10]
rows = []
for k in ks:
    pat = sc_rounds([k * r for r in range(1, 8)])
    fl = analyse(pat)
    res = simulate(pat)
    m = classify_result(res)
    rows.append((k, fl, res, m))
    print(f"k={k:2d}  analytic last-round e={fl['rounds'][-1]['e']:+.3f} -> {fl['final']:6s}   "
          f"sim A={m['A']:.3f} W={m['W']:.3f} -> {m['class']}")

# %%
fig, ax = plt.subplots(figsize=(7, 4))
ax.plot(ks, [m["A"] for *_, m in rows], "o-", label="sim depth A")
ax.plot(ks, [m["W"] for *_, m in rows], "s-", label="sim waviness W")
ax2 = ax.twinx()
ax2.plot(ks, [fl["rounds"][-1]["e"] for _, fl, _, _ in rows], "k--", label="analytic excess e (last round)")
ax2.axhspan(-cfg["flatness"]["tol"], cfg["flatness"]["tol"], color="0.9", zorder=-1)
ax.axhline(cfg["tau_flat"], color="C3", ls=":", lw=1)
ax.set_xlabel("increases per round k"); ax.set_ylabel("A, W"); ax2.set_ylabel("e")
ax.legend(loc="upper left", fontsize=8); ax2.legend(loc="upper right", fontsize=8)
plt.show()

# %%
fig, axs = plt.subplots(1, len(rows), figsize=(2.6 * len(rows), 3))
for ax, (k, fl, res, m) in zip(axs, rows):
    plot_cross_section(ax, res, m, title=f"k={k}: {m['class']}")
    ax.set_xlabel(""); ax.set_ylabel("")
plt.tight_layout()
plt.show()

# %% [markdown]
# ## Per round: analytic class vs. sim metric for an increase-rate sweep inside one piece
# Hyperbolic-type pieces: increase factor per round from 1.0 (tube) to 1.6.

# %%
from crolab.builders import hyperbolic
fig, ax = plt.subplots(figsize=(7, 4))
for rate in (1.0, 1.15, 1.3, 1.45, 1.6):
    pat = hyperbolic(12, rate, 6, lead=(1,))
    res = simulate(pat)
    ms = [classify_result(res, upto=r) for r in range(len(res.snapshots))]
    fl = analyse(pat)
    ax.plot([r["e"] for r in fl["rounds"]], [max(x["A"], x["W"]) for x in ms], "o-", label=f"x{rate}")
ax.axvspan(-0.1, 0.1, color="0.9"); ax.axhline(cfg["tau_flat"], color="C3", ls=":")
ax.set_xlabel("analytic excess e of the round"); ax.set_ylabel("sim max(A, W) up to that round")
ax.legend(fontsize=8)
plt.show()
