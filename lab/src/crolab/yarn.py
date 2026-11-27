"""Yarn requirement model — Python mirror of app/src/core/yarn (spec/yarn.md).

    L(node) = post * [ k_w * (a*w + pi*e*d) + k_h * (b*h) ]      (mm)

Coefficients, yarn categories, bands and the allowance come from spec/yarn_defaults.json; stitch
sizes from spec/stitch_params.json. ``spec/yarn_golden.json`` holds cases both implementations
evaluate (lab/tests/test_yarn.py, app/src/core/yarn/yarn.test.ts) and must agree on to 1e-9.

Calibration from weighed swatches::

    python -m crolab.yarn calibration.csv [--params worsted-4_5.0mm]
    python -m crolab.yarn --write-golden        # regenerate spec/yarn_golden.json

Calibration CSV (one row per swatch; ``#`` in the yarn column comments a row out):

  yarn            your label; swatches are grouped by it (one fit per yarn)
  stitch          sc | hdc | dc | tr | dtr — worked flat in rows (spec/yarn.md §4)
  n_stitches      stitches per row
  n_rows          rows
  grams           weight with tails trimmed (0.1 g scale), or empty when meters is given
  meters          yarn frogged from the swatch, optional (wins over grams)
  m_per_100g      ball band metres per 100 g (needed with grams)
  params          optional stitch_params set id (default: the file's default set)
  category        optional yarn category key (default: the param set's)
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from . import FIXTURES_DIR, SPEC_DIR
from .params import PARAMS_PATH, load_json

DEFAULTS_PATH = SPEC_DIR / "yarn_defaults.json"
GOLDEN_PATH = SPEC_DIR / "yarn_golden.json"

SIMPLE = {"ch", "slst", "sc", "hdc", "dc", "tr", "dtr"}
TOGGABLE = {"sc", "hdc", "dc", "tr", "dtr"}
TCH = {"slst": 1, "sc": 1, "hdc": 2, "dc": 3, "tr": 4, "dtr": 5, "puff": 2, "popcorn": 3}


def load_defaults(path: Path | str | None = None) -> dict:
    return load_json(path or DEFAULTS_PATH)


def param_set(set_id: str | None = None, params_file: Mapping | None = None) -> dict:
    doc = params_file or load_json(PARAMS_PATH)
    sid = set_id or doc["default_set"]
    for s in doc["sets"]:
        if s["id"] == sid:
            return s
    raise KeyError(f"no stitch_params set {sid!r}")


def _wh(pset: Mapping, t: str) -> tuple[float, float]:
    p = pset["stitches"].get(t)
    return (p["width"], p["height"]) if p else (1.0, 1.0)


def coefficients(t: str, legs: int = 1, defaults: Mapping | None = None) -> tuple[float, float, float]:
    """(a, b, events) of a simple stitch, or of an N-leg decrease / cluster of it."""
    d = (defaults or load_defaults())["stitches"][t]
    a, b, e = d.get("a", 0), d.get("b", 0), d.get("events", 0)
    if legs >= 2 and t in TOGGABLE:
        return a, legs * b, legs * (e - 1) + 1
    return a, b, e


def _simple(pset, t, d, legs, D) -> tuple[float, float]:
    a, b, e = coefficients(t, legs, D)
    w, h = _wh(pset, t)
    return a * w + math.pi * e * d, b * h


def node_parts(node: Mapping, pset: Mapping, d: float, defaults: Mapping | None = None) -> tuple[float, float, float]:
    """(loop, height, post) of one node in mm, before calibration."""
    D = defaults or load_defaults()
    post = D["post_factor"].get(node.get("loop") or "", 1.0)
    t = node["type"]
    if t in SIMPLE:
        legs = 1 if t in ("ch", "slst") else max(1, len(node.get("into", [])))
        lo, hi = _simple(pset, t, d, legs, D)
        return lo, hi, post
    sd = D["stitches"][t]
    if t == "puff":
        k = node.get("loops") or sd.get("per_default", 3)
        w, h = _wh(pset, "puff")
        return sd.get("a", 0) * w + math.pi * (sd.get("events", 0) + sd.get("events_per", 0) * k) * d, sd.get("b_per", 0) * k * h, post
    if t == "popcorn":
        k = node.get("legs") or sd.get("per_default", 5)
        lo, hi = _simple(pset, sd.get("compose", "dc"), d, 1, D)
        w, h = _wh(pset, "popcorn")
        return k * lo + sd.get("a", 0) * w + math.pi * sd.get("events", 0) * d, k * hi + sd.get("b", 0) * h, post
    if t == "picot":
        k = node.get("chains") or sd.get("per_default", 3)
        clo, chi = _simple(pset, sd.get("compose", "ch"), d, 1, D)
        slo, shi = _simple(pset, sd.get("then", "slst"), d, 1, D)
        return k * clo + slo, k * chi + shi, post
    raise ValueError(f"no yarn model for stitch type {t}")


def category_key(yarn_weight: str | None, defaults: Mapping | None = None) -> str:
    """Category of a param set's yarn_weight: exact key, 'thread'/'cotton' + number, CYC digit, or a name."""
    D = defaults or load_defaults()
    cats = D["categories"]
    if yarn_weight and yarn_weight in cats:
        return yarn_weight
    import re
    w = (yarn_weight or "").lower()
    if re.search(r"thread|cotton", w):
        m = re.search(r"(\d+)", w)
        k = f"thread-{m.group(1)}" if m else "thread-10"
        return k if k in cats else "thread-10"
    m = re.search(r"(\d)\s*$", w) or re.search(r"cyc\s*(\d)", w)
    if m:
        for k in cats:
            if k.endswith(f"-{m.group(1)}") and not k.startswith("thread"):
                return k
    for k, pat in [("lace-0", r"lace"), ("superfine-1", r"fingering|sock|super\s*fine"), ("fine-2", r"sport|baby"),
                   ("light-3", r"dk|light"), ("medium-4", r"worsted|aran|medium"), ("superbulky-6", r"super\s*bulky"),
                   ("bulky-5", r"bulky|chunky"), ("jumbo-7", r"jumbo")]:
        if re.search(pat, w):
            return k
    return D["default_category"]


def diameter_for(category: str, m_per_100g: float | None = None, defaults: Mapping | None = None) -> float:
    D = defaults or load_defaults()
    c = D["categories"].get(category) or D["categories"][D["default_category"]]
    if not m_per_100g or m_per_100g <= 0:
        return c["diameter_mm"]
    return c["diameter_mm"] * math.sqrt(c["m_per_100g"] / m_per_100g)


@dataclass
class Yarn:
    """A yarn with every default resolved (mirror of ResolvedYarn)."""
    category: str
    m_per_100g: float
    ball_g: float
    diameter_mm: float
    allowance: float
    k_w: float = 1.0
    k_h: float = 1.0
    status: str = "nominal"
    band: dict = field(default_factory=dict)


def resolve_yarn(pset: Mapping, spec: Mapping | None = None, defaults: Mapping | None = None) -> Yarn:
    D = defaults or load_defaults()
    spec = spec or {}
    cat = spec.get("category") if spec.get("category") in D["categories"] else category_key(pset.get("yarn_weight"), D)
    c = D["categories"][cat]
    pos = lambda x: isinstance(x, (int, float)) and math.isfinite(x) and x > 0  # noqa: E731
    m100 = spec["metersPer100g"] if pos(spec.get("metersPer100g")) else c["m_per_100g"]
    ball = spec["ballGrams"] if pos(spec.get("ballGrams")) else c["ball_g"]
    split = spec.get("calibrationSplit")
    split = split if split and pos(split.get("width")) and pos(split.get("height")) else None
    single = spec["calibration"] if pos(spec.get("calibration")) else None
    kw = split["width"] if split else (single if single is not None else 1.0)
    kh = split["height"] if split else (single if single is not None else 1.0)
    status = "calibrated" if (split or single is not None) else "nominal"
    band = D["band"]["calibrated_split"] if split else D["band"]["calibrated"] if status == "calibrated" else D["band"]["nominal"]
    allow = spec["allowance"] if isinstance(spec.get("allowance"), (int, float)) and spec["allowance"] >= 0 else D["allowance"]
    d = spec["diameterMm"] if pos(spec.get("diameterMm")) else diameter_for(cat, spec.get("metersPer100g") if pos(spec.get("metersPer100g")) else None, D)
    return Yarn(cat, m100, ball, d, allow, kw, kh, status, band)


def node_length_mm(node: Mapping, pset: Mapping, yarn: Yarn, defaults: Mapping | None = None) -> float:
    lo, hi, post = node_parts(node, pset, yarn.diameter_mm, defaults)
    return post * (yarn.k_w * lo + yarn.k_h * hi)


def estimate(pattern: Mapping, pset: Mapping | None = None, yarn: Mapping | None = None, defaults: Mapping | None = None) -> dict:
    """Net / total metres, grams and per-round metres of a graph JSON pattern."""
    D = defaults or load_defaults()
    pset = pset or param_set(pattern.get("meta", {}).get("params"))
    y = resolve_yarn(pset, yarn, D)
    g = pattern["graph"]
    per_round = [0.0] * len(g["rounds"])
    net = 0.0
    for n in g["nodes"]:
        L = node_length_mm(n, pset, y, D) / 1000
        per_round[n["round"]] += L
        net += L
    grams = net * 100 / y.m_per_100g
    total = net * (1 + y.allowance)
    return {"net_m": net, "total_m": total, "net_g": grams, "total_g": total * 100 / y.m_per_100g,
            "low_m": net * y.band["low"], "high_m": net * y.band["high"], "per_round_m": per_round,
            "balls": math.ceil(total * 100 / y.m_per_100g / y.ball_g - 1e-9), "status": y.status}


# ------------------------------------------------------------------ calibration

def swatch_model(stitch: str, n: int, rows: int, pset: Mapping, d: float, defaults: Mapping | None = None) -> tuple[float, float]:
    """(loop, height) model metres of a flat swatch (spec/yarn.md §4), k = 1."""
    D = defaults or load_defaults()
    t = TCH.get(stitch, 1)
    items = [({"type": "ch", "into": []}, n + t),
             ({"type": stitch, "into": [{"node": 0}]}, n * rows),
             ({"type": "ch", "into": [], "role": "tch"}, max(0, rows - 1) * t)]
    loop = height = 0.0
    for node, k in items:
        lo, hi, post = node_parts(node, pset, d, D)
        loop += k * post * lo
        height += k * post * hi
    return loop / 1000, height / 1000


def measured_meters(sw: Mapping) -> float:
    m = sw.get("meters")
    if m is not None and m > 0:
        return float(m)
    g, m100 = sw.get("grams"), sw.get("metersPer100g")
    if g is not None and g > 0 and m100 and m100 > 0:
        return g * m100 / 100
    return math.nan


def calibrate(swatches: list[Mapping], pset: Mapping, d: float, defaults: Mapping | None = None) -> dict:
    """Mirror of calibrationFromSwatches: single factor, and a loop/height split when possible."""
    rows = []
    for sw in swatches:
        loop, height = swatch_model(sw["stitch"], sw["stitches"], sw["rows"], pset, d, defaults)
        y = measured_meters(sw)
        if math.isfinite(y) and y > 0 and loop + height > 0 and sw["stitches"] > 0 and sw["rows"] > 0:
            rows.append((sw["stitch"], loop, height, y))
    if not rows:
        return {"kind": "invalid", "factor": math.nan}
    factor = sum(r[3] for r in rows) / sum(r[1] + r[2] for r in rows)
    if len({r[0] for r in rows}) < 2:
        return {"kind": "single", "factor": factor}
    saa = sab = sbb = say = sby = 0.0
    for _, lo, hi, y in rows:
        A, B = lo / y, hi / y
        saa += A * A; sab += A * B; sbb += B * B; say += A; sby += B  # noqa: E702
    det = saa * sbb - sab * sab
    if not det / (saa * sbb) > 0.01:
        return {"kind": "single", "factor": factor}
    width = (say * sbb - sby * sab) / det
    height = (sby * saa - say * sab) / det
    if not (0.3 < width < 3 and 0.3 < height < 3):
        return {"kind": "single", "factor": factor}
    return {"kind": "split", "factor": factor, "width": width, "height": height}


def _num(x) -> float | None:
    x = (x or "").strip() if isinstance(x, str) else x
    if x in (None, ""):
        return None
    try:
        return float(x)
    except ValueError:
        return None


def fit_calibration(path: Path | str, params_file: Mapping | None = None, defaults: Mapping | None = None) -> dict[str, dict]:
    """Calibration per yarn from a swatch-weight CSV (see module docstring). Returns
    {yarn: {"kind", "factor", ["width", "height"], "params", "category", "diameter_mm", "n_swatches"}}."""
    D = defaults or load_defaults()
    groups: dict[str, list[dict]] = {}
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            yarn = (r.get("yarn") or "").strip()
            if not yarn or yarn.startswith("#"):
                continue
            groups.setdefault(yarn, []).append(r)
    out: dict[str, dict] = {}
    for yarn, rs in groups.items():
        sid = next(((r.get("params") or "").strip() for r in rs if (r.get("params") or "").strip()), None)
        pset = param_set(sid, params_file)
        cat = next(((r.get("category") or "").strip() for r in rs if (r.get("category") or "").strip()), None) or category_key(pset.get("yarn_weight"), D)
        m100 = next((_num(r.get("m_per_100g")) for r in rs if _num(r.get("m_per_100g"))), None)
        d = diameter_for(cat, m100, D)
        sws = [{"stitch": r["stitch"].strip(), "stitches": int(float(r["n_stitches"])), "rows": int(float(r["n_rows"])),
                "grams": _num(r.get("grams")), "meters": _num(r.get("meters")), "metersPer100g": _num(r.get("m_per_100g"))} for r in rs]
        res = calibrate(sws, pset, d, D)
        res.update({"params": pset["id"], "category": cat, "diameter_mm": d, "n_swatches": len(sws)})
        out[yarn] = res
    return out


# ------------------------------------------------------------------ golden cases

GOLDEN_GRAPHS = ["examples/tiny.graph.json", "fixtures/flat_sc_circle.graph.json", "fixtures/sc_sphere.graph.json",
                 "fixtures/simple_doily.graph.json", "fixtures/chain_space_motif.graph.json", "fixtures/hyperbolic_plane.graph.json",
                 "fixtures/extra/snowflake_fern.graph.json"]
GOLDEN_NODES = [
    {"type": "ch", "into": []}, {"type": "ch", "into": [], "role": "tch"}, {"type": "slst", "into": [{"node": 0}]},
    {"type": "sc", "into": [{"node": 0}]}, {"type": "hdc", "into": [{"node": 0}]}, {"type": "dc", "into": [{"node": 0}]},
    {"type": "tr", "into": [{"node": 0}]}, {"type": "dtr", "into": [{"node": 0}]},
    {"type": "sc", "into": [{"node": 0}, {"node": 1}]}, {"type": "dc", "into": [{"node": 0}] * 3, "tag": "cluster"},
    {"type": "dc", "into": [{"node": 0}], "loop": "fp"}, {"type": "sc", "into": [{"node": 0}], "loop": "blo"},
    {"type": "puff", "into": [{"node": 0}]}, {"type": "puff", "into": [{"node": 0}], "loops": 5},
    {"type": "popcorn", "into": [{"node": 0}]}, {"type": "popcorn", "into": [{"node": 0}], "legs": 4},
    {"type": "picot", "into": []}, {"type": "picot", "into": [], "chains": 5},
]
GOLDEN_YARNS = [None, {"metersPer100g": 220, "ballGrams": 50}, {"calibration": 1.15}, {"calibrationSplit": {"width": 0.9, "height": 1.2}, "allowance": 0.05}]
GOLDEN_SWATCHES = [
    [{"stitch": "sc", "stitches": 20, "rows": 20, "grams": 9.6, "metersPer100g": 180}],
    [{"stitch": "sc", "stitches": 20, "rows": 20, "grams": 9.6, "metersPer100g": 180},
     {"stitch": "dc", "stitches": 20, "rows": 10, "grams": 9.1, "metersPer100g": 180}],
    [{"stitch": "hdc", "stitches": 15, "rows": 12, "meters": 14.2}, {"stitch": "tr", "stitches": 15, "rows": 6, "meters": 13.0}],
]


def golden(params_file: Mapping | None = None, defaults: Mapping | None = None) -> dict:
    D = defaults or load_defaults()
    P = params_file or load_json(PARAMS_PATH)
    nodes = []
    for sid in [s["id"] for s in P["sets"]]:
        pset = param_set(sid, P)
        for spec in GOLDEN_YARNS:
            y = resolve_yarn(pset, spec, D)
            nodes.append({"params": sid, "yarn": spec, "diameter_mm": y.diameter_mm,
                          "mm": [node_length_mm(n, pset, y, D) for n in GOLDEN_NODES]})
    patterns = []
    for rel in GOLDEN_GRAPHS:
        pat = load_json(SPEC_DIR / rel)
        pset = param_set(pat["meta"].get("params"), P)
        for spec in GOLDEN_YARNS[:3]:
            e = estimate(pat, pset, spec, D)
            patterns.append({"graph": rel, "params": pset["id"], "yarn": spec, "net_m": e["net_m"], "total_m": e["total_m"],
                             "low_m": e["low_m"], "high_m": e["high_m"], "net_g": e["net_g"], "balls": e["balls"]})
    swatches = []
    for sid in ["worsted-4_5.0mm", "dk-3_4.0mm"]:
        pset = param_set(sid, P)
        d = diameter_for(category_key(pset["yarn_weight"], D), None, D)
        for sws in GOLDEN_SWATCHES:
            res = calibrate(sws, pset, d, D)
            models = [list(swatch_model(s["stitch"], s["stitches"], s["rows"], pset, d, D)) for s in sws]
            swatches.append({"params": sid, "diameter_mm": d, "swatches": sws, "model_loop_height_m": models, "result": res})
    return {"$comment": "Generated by `python -m crolab.yarn --write-golden` (lab/src/crolab/yarn.py). Both lab/tests/test_yarn.py and app/src/core/yarn/yarn.test.ts recompute every number here and must agree to 1e-9. Regenerate only after a deliberate model change (spec/yarn.md).",
            "nodes": GOLDEN_NODES, "node_cases": nodes, "patterns": patterns, "swatch_cases": swatches}


def write_golden(path: Path | str = GOLDEN_PATH) -> None:
    Path(path).write_text(json.dumps(golden(), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m crolab.yarn", description=__doc__.split("\n\n")[0])
    ap.add_argument("csv", nargs="?", help="swatch weights CSV")
    ap.add_argument("--write-golden", action="store_true", help="regenerate spec/yarn_golden.json")
    a = ap.parse_args(argv)
    if a.write_golden:
        write_golden()
        print(f"wrote {GOLDEN_PATH}")
        return 0
    if not a.csv:
        ap.print_help()
        return 2
    for yarn, res in fit_calibration(a.csv).items():
        extra = f", loops x{res['width']:.3f}, height x{res['height']:.3f}" if res.get("kind") == "split" else ""
        print(f"{yarn}: factor {res['factor']:.3f} ({res['kind']}, {res['n_swatches']} swatch(es), params {res['params']}){extra}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
