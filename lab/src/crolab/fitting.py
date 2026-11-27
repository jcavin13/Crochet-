"""Fit stitch rest widths / heights from measured swatches and write a `stitch_params.json` set.

Usage::

    python -m crolab.fitting measurements.csv --out fitted_params.json \
        [--circles flat_circles.csv] [--base spec/stitch_params.json] [--merge] [--state unblocked]

Measurement CSV (one row per measured swatch; `#` in the yarn column comments a row out)
-----------------------------------------------------------------------------------------
Required (the contract with `crolab.swatch`):

  yarn        free text / CYC id, e.g. "worsted-4"; together with hook_mm it names the set
  hook_mm     hook size in mm
  stitch      stitch id from spec/stitches.json (sc, hdc, dc, tr, dtr, ch, slst, puff, ...)
  n_stitches  number of stitches spanned by width_mm (for stitch=ch: number of chains)
  n_rows      number of rows spanned by height_mm (0 or empty for chain-length rows)
  width_mm    measured length of n_stitches along the row (mm)
  height_mm   measured length of n_rows rows (mm); may be empty (then only width is fitted)

Optional, used when present (all others are ignored, e.g. the swatch tool's swatch_id, method,
repeat, confidence, yarn_brand, ...):

  state          fresh | unblocked | blocked — fitted separately; default "unblocked". Sets for
                 a state other than unblocked get the id suffix "_<state>".
  width_sd_mm, height_sd_mm   1-sd uncertainty of the row's measurement (weights 1/sd^2)
  rounds, counts, lies_flat   an optional in-the-round circle test on the same row:
                 rounds = number of rounds, counts = "6;12;18;..." stitch counts per round,
                 lies_flat = yes | no | cup | ruffle (checked against the fitted parameters).

Unknown stitch ids (e.g. stitch=mesh rows from the swatch tool) are skipped with a warning.
`--circles` reads the swatch tool's flat-circle CSV (lab/swatch/flat_circle_template.csv:
stitch, increases_per_round, rounds, result = cups|flat|ruffles, state, ...) and checks each
recorded result against the analytic flatness prediction with the fitted parameters.

Model
-----
Per (yarn, hook, state, stitch), with n the count and y the measured length:
  y = w * n + b   (weighted least squares; b = edge allowance) when there are >= 3 rows with
                  >= 2 distinct n; otherwise the ratio estimate y = w * n (b = 0).
The 1-sd uncertainty of w is from the weighted residual scatter (or the given sd's, whichever is
larger); with a single row it falls back to 3 % of w. Heights likewise with n_rows.
Stitch types that were not measured are filled in from the nominal relative table of
`spec/stitches.json` (`rel` x the fitted sc width, or the mean fitted width/rel ratio when sc
was not measured) and say so in `provenance`. Heights of ch come from that table too (a chain
row has no height).

**Stiffness is not fitted** (it needs load / stretch tests, which the swatch protocol does not
have yet): the fitted set copies the relative stiffness of the base parameter set. This is a
documented stub, see lab/README.md.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import SPEC_DIR
from .params import PARAMS_PATH, StitchParams, load_json, validate_params

STITCHES_PATH = SPEC_DIR / "stitches.json"
REQUIRED = ["yarn", "hook_mm", "stitch", "n_stitches", "n_rows", "width_mm", "height_mm"]


def _num(x) -> float | None:
    if x is None:
        return None
    x = str(x).strip()
    if x == "":
        return None
    try:
        return float(x)
    except ValueError:
        return None


@dataclass
class Row:
    yarn: str
    hook_mm: float
    stitch: str
    n_stitches: float | None
    n_rows: float | None
    width_mm: float | None
    height_mm: float | None
    state: str = "unblocked"
    width_sd: float | None = None
    height_sd: float | None = None
    circle: dict | None = None
    line: int = 0


def read_measurements(path: Path | str) -> list[Row]:
    vocab = {t["id"]: t for t in load_json(STITCHES_PATH)["types"]}
    rows: list[Row] = []
    with open(path, newline="", encoding="utf-8") as fh:
        rd = csv.DictReader(fh)
        missing = [c for c in REQUIRED if c not in (rd.fieldnames or [])]
        if missing:
            raise ValueError(f"{path}: missing required columns {missing}")
        for ln, r in enumerate(rd, start=2):
            yarn = (r.get("yarn") or "").strip()
            if not yarn or yarn.startswith("#"):
                continue
            st = (r.get("stitch") or "").strip()
            if st not in vocab:
                warnings.warn(f"{path}:{ln}: unknown stitch id {st!r} — row skipped")
                continue
            hook = _num(r.get("hook_mm"))
            if hook is None:
                warnings.warn(f"{path}:{ln}: no hook_mm — row skipped")
                continue
            circle = None
            if (r.get("counts") or "").strip():
                counts = [int(float(x)) for x in str(r["counts"]).replace(",", ";").split(";") if x.strip()]
                circle = {"counts": counts, "lies_flat": (r.get("lies_flat") or "").strip().lower()}
            rows.append(Row(
                yarn=yarn, hook_mm=hook, stitch=st, n_stitches=_num(r.get("n_stitches")),
                n_rows=_num(r.get("n_rows")), width_mm=_num(r.get("width_mm")), height_mm=_num(r.get("height_mm")),
                state=(r.get("state") or "").strip() or "unblocked",
                width_sd=_num(r.get("width_sd_mm")), height_sd=_num(r.get("height_sd_mm")), circle=circle, line=ln))
    return rows


@dataclass
class Fit:
    value: float
    sd: float
    intercept: float
    n_rows: int
    method: str


def fit_length(n: np.ndarray, y: np.ndarray, sd: np.ndarray | None = None) -> Fit:
    """Per-unit length from (count, length) pairs; see module doc."""
    n = np.asarray(n, float)
    y = np.asarray(y, float)
    wts = np.ones_like(y) if sd is None else 1.0 / np.maximum(np.asarray(sd, float), 1e-6) ** 2
    if len(n) >= 3 and len(np.unique(n)) >= 2:
        A = np.stack([n, np.ones_like(n)], axis=1)
        W = np.sqrt(wts)
        coef, *_ = np.linalg.lstsq(A * W[:, None], y * W, rcond=None)
        res = y - A @ coef
        dof = len(n) - 2
        s2 = float(np.sum(wts * res ** 2) / dof) if dof > 0 else 0.0
        cov = np.linalg.inv((A * wts[:, None]).T @ A)
        scale = max(s2, 1.0) if sd is not None else s2
        se = math.sqrt(max(cov[0, 0] * scale, 0.0))
        return Fit(float(coef[0]), se, float(coef[1]), len(n), "linear")
    w = float(np.sum(wts * n * y) / np.sum(wts * n * n))
    if len(n) >= 2:
        res = y - w * n
        s2 = float(np.sum(wts * res ** 2) / (len(n) - 1))
        se = math.sqrt(s2 / float(np.sum(wts * n * n))) if sd is None else math.sqrt(max(s2, 1.0) / float(np.sum(wts * n * n)))
    elif sd is not None:
        se = float(sd[0]) / n[0]
    else:
        se = 0.03 * w
    return Fit(w, se, 0.0, len(n), "ratio")


def _sd_or_none(vals):
    return None if any(v is None for v in vals) else np.array(vals, float)


def _set_id(yarn: str, hook: float, state: str) -> str:
    sid = f"{yarn}_{hook:g}mm"
    return sid if state == "unblocked" else f"{sid}_{state}"


def fit_sets(rows: list[Row], base: dict | None = None) -> tuple[list[dict], dict]:
    """Returns (list of schema-valid parameter sets, diagnostics dict keyed by set id)."""
    base = base or load_json(PARAMS_PATH)
    vocab = {t["id"]: t for t in load_json(STITCHES_PATH)["types"]}
    base_set = next(s for s in base["sets"] if s["id"] == base["default_set"])
    groups: dict[tuple, list[Row]] = {}
    for r in rows:
        groups.setdefault((r.yarn, r.hook_mm, r.state), []).append(r)
    sets, diag = [], {}
    for (yarn, hook, state), rs in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2])):
        widths: dict[str, Fit] = {}
        heights: dict[str, Fit] = {}
        for st in sorted({r.stitch for r in rs}):
            sub = [r for r in rs if r.stitch == st]
            wr = [r for r in sub if r.n_stitches and r.width_mm is not None]
            if wr:
                widths[st] = fit_length(np.array([r.n_stitches for r in wr]), np.array([r.width_mm for r in wr]),
                                        _sd_or_none([r.width_sd for r in wr]))
            hr = [r for r in sub if r.n_rows and r.height_mm is not None]
            if hr:
                heights[st] = fit_length(np.array([r.n_rows for r in hr]), np.array([r.height_mm for r in hr]),
                                         _sd_or_none([r.height_sd for r in hr]))
        if "sc" in widths:
            ref = widths["sc"].value
        elif widths:
            ref = float(np.mean([f.value / vocab[s]["rel"]["width"] for s, f in widths.items()]))
        else:
            warnings.warn(f"{yarn} {hook} mm {state}: no width measurements — set skipped")
            continue
        stitches = {}
        filled = []
        for t in vocab:
            rel = vocab[t]["rel"]
            ent = {}
            if t in widths:
                ent["width"], ent["width_sd"] = widths[t].value, widths[t].sd
            else:
                ent["width"] = rel["width"] * ref
                filled.append(f"{t}.width")
            if t in heights:
                ent["height"], ent["height_sd"] = heights[t].value, heights[t].sd
            else:
                ent["height"] = rel["height"] * ref
                filled.append(f"{t}.height")
            ent["stiffness"] = float(base_set["stitches"].get(t, {"stiffness": 1.0})["stiffness"])
            stitches[t] = {k: round(v, 4) for k, v in ent.items()}
        measured = sorted(set(widths) | set(heights))
        sid = _set_id(yarn, hook, state)
        sets.append({
            "id": sid, "label": f"{yarn}, {hook:g} mm hook ({state}, fitted)", "yarn_weight": yarn,
            "hook_mm": float(hook), "status": "fitted",
            "provenance": (f"Fitted by crolab.fitting from {len(rs)} swatch rows (state={state}); measured: "
                           f"{', '.join(measured)}. Filled from the nominal relative table of spec/stitches.json: "
                           f"{', '.join(filled) if filled else 'none'}. Stiffness NOT fitted (copied from "
                           f"{base_set['id']}; needs load tests)."),
            "stitches": stitches,
        })
        diag[sid] = {"widths": widths, "heights": heights, "rows": len(rs), "filled": filled}
    return sets, diag


def circle_checks(sets: list[dict], rows: list[Row], circles_csv: Path | str | None = None) -> list[dict]:
    """Predicted (analytic flatness) vs recorded result for circle tests."""
    from .builders import sc_rounds
    from .flatness import analyse

    by_id = {s["id"]: StitchParams(id=s["id"], stitches=s["stitches"], raw=s) for s in sets}
    tests = []
    for r in rows:
        if r.circle:
            tests.append((r.yarn, r.hook_mm, r.state, r.stitch, r.circle["counts"], r.circle["lies_flat"]))
    if circles_csv:
        with open(circles_csv, newline="", encoding="utf-8") as fh:
            for c in csv.DictReader(fh):
                if not (c.get("yarn") or "").strip() or c["yarn"].startswith("#"):
                    continue
                k = _num(c.get("increases_per_round"))
                nr = _num(c.get("rounds"))
                hook = _num(c.get("hook_mm"))
                if not k or not nr or hook is None:
                    continue
                counts = [int(k) * (i + 1) for i in range(int(nr))]
                tests.append((c["yarn"].strip(), hook, (c.get("state") or "").strip() or "unblocked",
                              (c.get("stitch") or "sc").strip(), counts, (c.get("result") or "").strip().lower()))
    out = []
    norm = {"yes": "flat", "flat": "flat", "no": "?", "cup": "cup", "cups": "cup", "ruffle": "ruffle", "ruffles": "ruffle"}
    for yarn, hook, state, st, counts, obs in tests:
        P = by_id.get(_set_id(yarn, hook, state))
        if P is None:
            continue
        pat = sc_rounds(counts, stitch=st)
        pred = analyse(pat, P)["final"]
        o = norm.get(obs, obs or "?")
        out.append({"set": P.id, "stitch": st, "counts": counts, "observed": o, "predicted": pred,
                    "agree": (o == pred) if o in ("flat", "cup", "ruffle") else (pred != "flat" if o == "?" else None)})
    return out


def write_params(sets: list[dict], out: Path | str, base: dict | None = None, merge: bool = False) -> dict:
    """Write a schema-valid stitch_params.json: the fitted sets (merged into `base` if merge)."""
    base = base or load_json(PARAMS_PATH)
    if merge:
        ids = {s["id"] for s in sets}
        doc = {**base, "sets": [s for s in base["sets"] if s["id"] not in ids] + sets}
    else:
        doc = {"version": "0.1", "units": "mm", "default_set": sets[0]["id"], "sets": sets}
    validate_params(doc)
    Path(out).write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return doc


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Fit stitch_params.json sets from swatch measurements.")
    ap.add_argument("csv")
    ap.add_argument("--out", required=True)
    ap.add_argument("--circles", default=None, help="flat-circle test CSV (lab/swatch/flat_circle_template.csv)")
    ap.add_argument("--base", default=str(PARAMS_PATH))
    ap.add_argument("--merge", action="store_true", help="keep the base file's other sets")
    a = ap.parse_args(argv)
    base = load_json(a.base)
    rows = read_measurements(a.csv)
    sets, diag = fit_sets(rows, base)
    if not sets:
        print("no parameter set could be fitted", file=sys.stderr)
        return 1
    write_params(sets, a.out, base, a.merge)
    for s in sets:
        d = diag[s["id"]]
        print(f"{s['id']}: {d['rows']} rows")
        for st, f in sorted(d["widths"].items()):
            print(f"  {st:6s} width  {f.value:7.3f} ± {f.sd:.3f} mm  ({f.method}, {f.n_rows} rows)")
        for st, f in sorted(d["heights"].items()):
            print(f"  {st:6s} height {f.value:7.3f} ± {f.sd:.3f} mm  ({f.method}, {f.n_rows} rows)")
    for c in circle_checks(sets, rows, a.circles):
        print(f"  circle {c['stitch']} {c['counts'][:3]}...: observed {c['observed']}, predicted {c['predicted']}"
              f" -> {'agree' if c['agree'] else 'DISAGREE'}")
    print(f"wrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())


# ------------------------------------------------------------------------------------------
# synthetic data (tests, example CSV)
# ------------------------------------------------------------------------------------------
SYNTH_TRUTH = {"sc": (6.2, 5.9), "hdc": (6.3, 8.6), "dc": (6.4, 12.8), "ch": (4.4, None)}


def synthetic_rows(truth: dict = SYNTH_TRUTH, yarn: str = "synthetic-worsted", hook: float = 5.0,
                   edge: float = 1.5, noise: float = 0.01, seed: int = 1) -> list[dict]:
    """Rows of a synthetic gauge study: swatches of several sizes per stitch, lengths
    n * w + edge with multiplicative Gaussian noise (1 sd = `noise`). Deterministic (seeded)."""
    rng = np.random.default_rng(seed)
    out = []
    for st, (w, h) in truth.items():
        for n, m in ((8, 6), (10, 8), (15, 12), (20, 16), (25, 20), (30, 24)):
            if h is None:
                y = (n * w) * (1 + noise * rng.standard_normal())
                out.append({"yarn": yarn, "hook_mm": hook, "stitch": st, "n_stitches": n, "n_rows": 0,
                            "width_mm": round(y, 2), "height_mm": "", "state": "unblocked",
                            "notes": "SYNTHETIC chain length"})
                continue
            y = (n * w + edge) * (1 + noise * rng.standard_normal())
            z = (m * h + edge) * (1 + noise * rng.standard_normal())
            out.append({"yarn": yarn, "hook_mm": hook, "stitch": st, "n_stitches": n, "n_rows": m,
                        "width_mm": round(y, 2), "height_mm": round(z, 2), "state": "unblocked",
                        "notes": "SYNTHETIC"})
    return out


def write_csv(rows: list[dict], path: Path | str, header_comment: str | None = None) -> None:
    cols = REQUIRED + ["state", "width_sd_mm", "height_sd_mm", "rounds", "counts", "lies_flat", "notes"]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        if header_comment:
            fh.write(f"# {header_comment}" + "," * (len(cols) - 1) + "\n")
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})
