"""Analytic per-round flatness check (`spec/flatness.md`), mirroring the TypeScript reference
`app/src/core/flatness/index.ts` line for line (same course elements, same radii, same rounding
free floats). Pure function of (graph, params, config)."""
from __future__ import annotations

import math

from .graph import Graph
from .params import StitchParams, load_sim_config, select_set

TAU = 2 * math.pi


def analyse(pattern: dict, params: StitchParams | None = None, config: dict | None = None,
            tol: float | None = None) -> dict:
    """Returns {rounds: [...], final, worst, applicable}. Each round:
    {round, label, class, e_min, e_max, e, stitches_off, rho, rho_prev, r, g, C_min, C_max, C, message}."""
    g = Graph(pattern)
    params = params or select_set(pattern)
    cfg = (config or load_sim_config())["flatness"]
    tol = cfg["tol"] if tol is None else tol
    slack, nominal = cfg["chain_slack_min"], cfg["chain_nominal"]
    wch = params.width("ch")
    chsp_of = {c: s["id"] for s in g.spaces if s["kind"] == "chsp" for c in s["chains"]}
    first_ring = next((s for s in g.spaces if s["kind"] == "ring"), None)
    in_round = any(r["kind"] == "round" for r in g.rounds) and not any(r["kind"] == "row" for r in g.rounds)

    out = []
    r_prev = len(first_ring["chains"]) * wch / TAU if first_ring else 0.0
    rho_prev, c_prev, k = r_prev, 0.0, 0
    for rd in g.rounds:
        nodes = g.round_nodes(rd["index"])
        st = [i for i in nodes if g.counts_as_stitch(i)]
        sum_w = sum(params.width(g.effective_type(i)) for i in st)
        space_ids = set()
        n_ch = 0
        for i in nodes:
            if g.nodes[i]["type"] == "ch" and i in chsp_of:
                n_ch += 1
                space_ids.add(chsp_of[i])
        base = {"round": rd["index"], "label": rd["label"], "class": "n/a", "e_min": 0.0, "e_max": 0.0,
                "e": 0.0, "stitches_off": 0.0, "rho": rho_prev, "rho_prev": rho_prev, "r": r_prev,
                "g": math.nan, "C_min": 0.0, "C_max": 0.0, "C": 0.0,
                "message": f"{rd['label']}: not worked in the round — flatness does not apply."}
        if not in_round or rd["kind"] != "round" or (not st and n_ch == 0):
            out.append(base)
            continue
        k += 1
        hbar = sum(params.height(g.effective_type(i)) for i in st) / len(st) if st else 0.0
        cmax, cmin, c = sum_w + n_ch * wch, sum_w + n_ch * wch * slack, sum_w + n_ch * wch * nominal
        magic_start = k == 1 and r_prev == 0
        rho = max(hbar, c / TAU) if magic_start else r_prev + hbar
        rise = 0.0
        if space_ids:
            d = max(0.0, TAU * rho - sum_w) / len(space_ids)
            L = (n_ch / len(space_ids)) * wch
            if L > d:
                rise = 0.5 * math.sqrt(L * L - d * d)
        need = TAU * rho
        e_max, e_min, e = cmax / need - 1, cmin / need - 1, c / need - 1
        wbar = sum_w / len(st) if st else wch
        cls, off = "flat", 0.0
        if e_max < -tol:
            cls, off = "cup", (cmax - need) / wbar
        elif e_min > tol:
            cls, off = "ruffle", (cmin - need) / wbar
        gk = math.nan if (k == 1 or rho == rho_prev) else (c - c_prev) / (TAU * (rho - rho_prev)) - 1
        n_off = max(1, round(abs(off)))
        pl = "" if n_off == 1 else "es"
        if cls == "flat":
            msg = f"{rd['label']} lies flat."
        elif cls == "cup":
            msg = f"{rd['label']} will cup: about {n_off} stitch{pl} under flat ({_pct(e_max)})."
        else:
            msg = f"{rd['label']} will ruffle: about {n_off} stitch{pl} over flat ({_pct(e_min)})."
        out.append({"round": rd["index"], "label": rd["label"], "class": cls, "e_min": e_min, "e_max": e_max,
                    "e": e, "stitches_off": off, "rho": rho, "rho_prev": rho_prev if k > 1 else (0.0 if magic_start else r_prev),
                    "r": rho + rise, "g": gk, "C_min": cmin, "C_max": cmax, "C": c, "message": msg})
        r_prev, rho_prev, c_prev = rho + rise, rho, c
    real = [r for r in out if r["class"] != "n/a"]

    def dev(r):
        return -r["e_max"] if r["class"] == "cup" else r["e_min"] if r["class"] == "ruffle" else 0.0
    bad = sorted([r for r in real if r["class"] != "flat"], key=dev, reverse=True)
    return {"rounds": out, "final": real[-1]["class"] if real else "n/a",
            "worst": bad[0] if bad else None, "applicable": bool(real)}


def _pct(x: float) -> str:
    return f"{'+' if x >= 0 else '−'}{round(abs(x) * 100)}%"


def table(pattern: dict, **kw) -> list[dict]:
    """Compact per-round rows {round, class, e_min, e_max, stitches_off, rho, r, g}."""
    return [{k: row[k] for k in ("round", "label", "class", "e_min", "e_max", "e", "stitches_off", "rho", "r", "g")}
            for row in analyse(pattern, **kw)["rounds"]]
