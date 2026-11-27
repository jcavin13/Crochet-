"""Rows for the swatch-measurement CSV consumed by ``crolab.fitting``.

Required columns (the fitting contract): ``yarn, hook_mm, stitch, n_stitches, n_rows, width_mm,
height_mm`` -- ``width_mm`` is the length spanned by ``n_stitches`` stitches along the row and
``height_mm`` the length spanned by ``n_rows`` rows. Everything after those is optional and
documented in ``lab/swatch/PROTOCOL.md``; ``crolab.fitting`` may ignore it.
"""
from __future__ import annotations

import csv
from pathlib import Path

from crolab import REPO_ROOT

FITTING_COLUMNS = ["yarn", "hook_mm", "stitch", "n_stitches", "n_rows", "width_mm", "height_mm"]
EXTRA_COLUMNS = [
    "swatch_id",     # free id, same for repeats of one swatch
    "method",        # ruler | photo-counts | photo-texture | chain-length | mesh
    "state",         # fresh | unblocked | blocked (see PROTOCOL.md)
    "repeat",        # 1, 2, 3 ... repeated measurement of the same swatch/state
    "width_sd_mm",   # uncertainty of width_mm (1 sd), if known
    "height_sd_mm",
    "confidence",    # photo-texture only: 0-1 (see swatch/README.md)
    "yarn_brand", "yarn_fibre", "yarn_cyc", "yarn_m_per_100g",
    "pattern",       # for method=mesh: e.g. "dc, ch1" repeat
    "date", "measurer", "source", "notes",
]
COLUMNS = FITTING_COLUMNS + EXTRA_COLUMNS
TEMPLATE = REPO_ROOT / "lab" / "swatch" / "measurements_template.csv"


def make_row(**kw) -> dict:
    unknown = set(kw) - set(COLUMNS)
    if unknown:
        raise KeyError(f"unknown CSV columns: {sorted(unknown)}")
    return {c: ("" if kw.get(c) is None else kw.get(c)) for c in COLUMNS}


def write_rows(path: Path, rows: list[dict], append: bool = True) -> Path:
    path = Path(path)
    new = not path.exists() or not append or path.stat().st_size == 0
    with path.open("a" if append and not new else "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, extrasaction="ignore")
        if new:
            w.writeheader()
        for r in rows:
            w.writerow(r)
    return path


def read_rows(path: Path) -> list[dict]:
    with Path(path).open(newline="") as fh:
        return [r for r in csv.DictReader(fh) if not (r.get("yarn") or "").startswith("#")]
