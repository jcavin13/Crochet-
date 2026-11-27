"""`python -m crolab.reports`: execute every notebook script in lab/notebooks (jupytext
py:percent) and render it to self-contained HTML in lab/reports/, plus an index.html.

Notebooks are run in their own directory with a fresh kernel. A notebook that fails is still
rendered (with the error in the output) and listed in the index as failed; the command exits
non-zero only if one of the lab's own notebooks (not `swatch_*`) fails.

The HTML is reproducible: running twice gives identical bytes (docs/review.md R10). Cell ids are
numbered instead of random, no execution timings or kernel/session metadata are recorded, the
kernel runs with single-threaded BLAS and a fixed hash seed, matplotlib writes PNGs at a fixed
dpi without date metadata, and the notebooks seed their random generators and print no wall
times. `--check` renders into a temporary directory and compares with the committed reports.
"""
from __future__ import annotations

import argparse
import html
import os
import sys
import tempfile
import time
from pathlib import Path

from . import REPO_ROOT

NB_DIR = REPO_ROOT / "lab" / "notebooks"
OUT_DIR = REPO_ROOT / "lab" / "reports"
TITLES = {
    "01_fixtures_gallery": "the 7 canonical fixtures in the reference sim: class, metrics, 3D renders",
    "02_curvature": "intrinsic (Gauss-Bonnet) and extrinsic (angle-deficit) curvature per round",
    "03_flatness_vs_sim": "analytic flatness against the sim, cup -> flat -> ruffle",
    "04_parameter_fitting": "stitch width/height fitted from the SYNTHETIC example swatch CSV",
    "swatch_analysis": "swatch photo analyzer on SYNTHETIC photos with known truth",
}


def render(src: Path, out_dir: Path, timeout: int = 900) -> tuple[bool, str, float]:
    import jupytext
    import nbformat
    from nbclient import NotebookClient
    from nbclient.exceptions import CellExecutionError
    from nbconvert import HTMLExporter

    t0 = time.perf_counter()
    nb = jupytext.read(src)
    nb.metadata = {"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"}}
    for k, cell in enumerate(nb.cells):
        cell.id = f"cell-{k}"
        cell.metadata = {}
    err = ""
    ok = True
    try:
        NotebookClient(nb, timeout=timeout, kernel_name="python3", record_timing=False,
                       resources={"metadata": {"path": str(src.parent)}}).execute()
    except CellExecutionError as e:  # keep partial outputs
        ok, err = False, str(e).splitlines()[0] if str(e) else "cell error"
    except Exception as e:  # kernel problems etc.
        ok, err = False, f"{type(e).__name__}: {e}"
    nb.metadata = {k: v for k, v in nb.metadata.items() if k in ("kernelspec", "language_info")}
    for cell in nb.cells:
        cell.metadata = {}
        for out in cell.get("outputs", []):
            out.get("metadata", {}).pop("execution", None)
    body, _ = HTMLExporter(template_name="lab").from_notebook_node(nbformat.from_dict(nb))
    (out_dir / f"{src.stem}.html").write_text(body, encoding="utf-8")
    return ok, err, time.perf_counter() - t0


def write_index(entries: list[tuple[str, bool, str, float]], out_dir: Path) -> None:
    """Index page. Run times are printed on the console only, so the page is reproducible."""
    rows = []
    for name, ok, err, _dt in sorted(entries):
        status = "ok" if ok else f"FAILED — {html.escape(err)}"
        title = TITLES.get(name, "")
        rows.append(f'<tr><td><a href="{name}.html">{name}</a></td><td>{html.escape(title)}</td><td>{status}</td></tr>')
    page = f"""<!doctype html><html><head><meta charset="utf-8"><title>crolab reports</title>
<style>body{{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem}}
td,th{{padding:.3rem .8rem;border-bottom:1px solid #ddd;text-align:left}}</style></head><body>
<h1>crolab reports</h1>
<p>Executed notebooks from <code>lab/notebooks/</code> (regenerate with <code>make lab</code>).
Physics: <code>spec/physics.md</code> with the lab clarifications in <code>lab/SPEC_NOTES.md</code>.</p>
<table><tr><th>report</th><th>what</th><th>status</th></tr>{''.join(rows)}</table>
</body></html>
"""
    (out_dir / "index.html").write_text(page, encoding="utf-8")


def deterministic_env() -> None:
    """Environment inherited by the notebook kernels (set before they start)."""
    for var in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
        os.environ.setdefault(var, "1")
    os.environ["PYTHONHASHSEED"] = "0"
    os.environ["SOURCE_DATE_EPOCH"] = "0"         # matplotlib: no creation date in PDF/SVG output


def check(names: list[str] | None = None) -> int:
    """Render notebooks into a temporary directory and compare bytes with lab/reports/."""
    srcs = [s for s in sorted(NB_DIR.glob("*.py")) if not names or s.stem in names]
    bad = 0
    with tempfile.TemporaryDirectory() as tmp:
        for src in srcs:
            render(src, Path(tmp))
            new = (Path(tmp) / f"{src.stem}.html").read_bytes()
            old_p = OUT_DIR / f"{src.stem}.html"
            same = old_p.exists() and old_p.read_bytes() == new
            bad += not same
            print(f"{src.stem:24s} {'identical' if same else 'DIFFERS (run make lab and commit)'}")
    return 1 if bad else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", default="", help="comma-separated notebook stems")
    ap.add_argument("--check", action="store_true",
                    help="render into a temp dir and compare with the committed reports")
    a = ap.parse_args(argv)
    deterministic_env()
    if a.check:
        return check(a.only.split(",") if a.only else None)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    srcs = sorted(NB_DIR.glob("*.py"))
    if a.only:
        srcs = [s for s in srcs if s.stem in a.only.split(",")]
    entries = []
    own_failed = False
    for src in srcs:
        print(f"executing {src.name} ...", flush=True)
        ok, err, dt = render(src, OUT_DIR)
        print(f"  {'ok' if ok else 'FAILED: ' + err} ({dt:.0f} s)")
        if not ok and src.stem.startswith("swatch_"):
            print("  (swatch notebook belongs to the swatch tool; report rendered with the error)")
        own_failed |= (not ok and not src.stem.startswith("swatch_"))
        entries.append((src.stem, ok, err, dt))
    if not a.only:
        write_index(entries, OUT_DIR)
    else:  # keep the index complete
        existing = sorted(p.stem for p in OUT_DIR.glob("*.html") if p.stem != "index")
        done = {e[0] for e in entries}
        write_index(entries + [(s, True, "", 0.0) for s in existing if s not in done], OUT_DIR)
    return 1 if own_failed else 0


if __name__ == "__main__":
    sys.exit(main())
