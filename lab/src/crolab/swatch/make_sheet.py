"""Generate the printable marker sheets.

    cd lab && uv run python -m crolab.swatch.make_sheet [--out lab/swatch] [--dark-window]

Writes ``marker_sheet_A4.pdf``, ``marker_sheet_letter.pdf``, ``marker_card.pdf`` (vector, via
reportlab), PNG previews of each and ``sheet_layout.json`` (the geometry the analyzer reads).
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

import cv2
from reportlab.lib.colors import Color, black
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from .layout import (LAYOUT_VERSION, SHEET_DIR, Layout, build_layouts, marker_bits, render_layout,
                     save_layouts)

GREY = Color(0.62, 0.62, 0.62)


class _Page:
    """Thin wrapper so drawing code can use the sheet frame (mm, y down)."""

    def __init__(self, c: canvas.Canvas, page_h_mm: float, ox=0.0, oy=0.0):
        self.c, self.H, self.ox, self.oy = c, page_h_mm, ox, oy

    def rect(self, x, y, w, h, fill=black, stroke=None, lw=0.2):
        c = self.c
        if fill is not None:
            c.setFillColor(fill)
        if stroke is not None:
            c.setStrokeColor(stroke)
            c.setLineWidth(lw * mm)
        c.rect((self.ox + x) * mm, (self.H - self.oy - y - h) * mm, w * mm, h * mm,
               fill=1 if fill is not None else 0, stroke=1 if stroke is not None else 0)

    def line(self, x0, y0, x1, y1, lw=0.2, color=black, dash=None):
        c = self.c
        c.setStrokeColor(color)
        c.setLineWidth(lw * mm)
        c.setDash(*(dash or ([], 0)))
        c.line((self.ox + x0) * mm, (self.H - self.oy - y0) * mm, (self.ox + x1) * mm, (self.H - self.oy - y1) * mm)
        c.setDash([], 0)

    def text(self, x, y, s, size=8, font="Helvetica", align="left", color=black):
        c = self.c
        c.setFillColor(color)
        c.setFont(font, size)
        X, Y = (self.ox + x) * mm, (self.H - self.oy - y) * mm
        {"left": c.drawString, "center": c.drawCentredString, "right": c.drawRightString}[align](X, Y, s)


def _draw_markers(p: _Page, layout: Layout):
    for mid, corners in layout.markers.items():
        bits = marker_bits(mid, layout.dictionary)
        n = bits.shape[0]
        cell = layout.marker_mm / n
        x0, y0 = corners[0]
        for r in range(n):
            col = 0
            while col < n:  # merge horizontal runs of black cells -> fewer, seamless rectangles
                if bits[r, col]:
                    start = col
                    while col < n and bits[r, col]:
                        col += 1
                    p.rect(x0 + start * cell, y0 + r * cell, (col - start) * cell, cell)
                else:
                    col += 1


def _draw_ruler(p: _Page, rl: dict, label_size=6):
    x0, y, L = rl["x0"], rl["y"], rl["length"]
    p.rect(x0, y, L, 1.5)
    for t in range(int(L) + 1):
        h = 6.0 if t % 10 == 0 else 4.0 if t % 5 == 0 else 2.5
        p.rect(x0 + t - 0.1, y - h, 0.2, h)
        if t % 10 == 0:
            p.text(x0 + t, y - 6.8, f"{t // 10}", size=label_size, align="center")
    p.text(x0 + L + 2.0, y + 1.2, f"{L:.0f} mm", size=label_size + 1, font="Helvetica-Bold")


def draw_sheet(c: canvas.Canvas, layout: Layout, dark_window: bool = False):
    W, H = layout.size_mm
    c.setPageSize((W * mm, H * mm))
    p = _Page(c, H)
    x0, y0, x1, y1 = layout.window_mm
    if dark_window:
        p.rect(x0, y0, x1 - x0, y1 - y0, fill=Color(0.12, 0.12, 0.12))
    _draw_markers(p, layout)
    _draw_ruler(p, layout.ruler_mm)
    ids = sorted(layout.markers)
    p.text(10, 15, f"crolab swatch sheet {layout.name}  v{LAYOUT_VERSION}", size=10, font="Helvetica-Bold")
    p.text(W - 10, 15, f"{layout.dictionary}  ids {ids[0]}-{ids[-1]}  marker {layout.marker_mm:g} mm",
           size=7, align="right")
    p.text(10, 20.5, "PRINT AT 100% / ACTUAL SIZE (no 'fit to page'). Check: the bar below must measure "
                     "exactly 100 mm.", size=7.5, font="Helvetica-Bold")
    p.text(10, 24.5, f"Also check: {layout.check_mm['label']} are {layout.check_mm['mm']:.1f} mm apart. "
                     "If not, pass --ruler-mm <measured bar length> to the analyzer.", size=6.5)
    p.text(W - 10, 44.0, "Lay the swatch flat inside the window, rows horizontal; do not stretch it.",
           size=6.5, align="right")
    # window corner ticks (outside the window; the analyzer samples background just inside it)
    for (cx, cy, sx, sy) in [(x0, y0, 1, 1), (x1, y0, -1, 1), (x1, y1, -1, -1), (x0, y1, 1, -1)]:
        p.line(cx - sx * 1.35, cy - sy * 1.35, cx + sx * 8, cy - sy * 1.35, lw=0.3, color=GREY)
        p.line(cx - sx * 1.35, cy - sy * 1.35, cx - sx * 1.35, cy + sy * 8, lw=0.3, color=GREY)
    c.showPage()


def draw_card_page(c: canvas.Canvas, layout: Layout, page="A4", copies=4):
    from .layout import PAGES_MM
    W, H = PAGES_MM[page]
    c.setPageSize((W * mm, H * mm))
    cw, ch = layout.size_mm
    top = _Page(c, H)
    top.text(15, 15, f"crolab marker card v{LAYOUT_VERSION}  ({layout.dictionary}, ids "
                     f"{min(layout.markers)}-{max(layout.markers)})", size=10, font="Helvetica-Bold")
    top.text(15, 21, "PRINT AT 100% / ACTUAL SIZE. Check each card's bar measures 50 mm. Cut along the grey "
                     "lines; glue to card stock to keep it flat.", size=7.5)
    top.text(15, 26, "Place the card flat, in the same plane as the swatch, close to it. Use for pieces "
                     "larger than the sheet window.", size=7.5)
    for k in range(copies):
        ox = 15 + (k % 2) * (cw + 15)
        oy = 40 + (k // 2) * (ch + 15)
        p = _Page(c, H, ox, oy)
        p.rect(0, 0, cw, ch, fill=None, stroke=GREY, lw=0.25)
        _draw_markers(p, layout)
        _draw_ruler(p, layout.ruler_mm, label_size=5)
        p.text(cw - 3, ch - 2.5, "crolab card", size=5, align="right", color=GREY)
    c.showPage()


def _png_preview(pdf: Path, png: Path, layout: Layout, dpi=60):
    if shutil.which("pdftoppm"):
        stem = png.with_suffix("")
        subprocess.run(["pdftoppm", "-r", str(dpi), "-png", "-singlefile", str(pdf), str(stem)], check=True)
        return
    img = render_layout(layout, dpi / 25.4)
    cv2.imwrite(str(png), img)


def make_all(out: Path = SHEET_DIR, dark_window: bool = False) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    layouts = build_layouts()
    written = [save_layouts(out / "sheet_layout.json", layouts)]
    suffix = "_dark" if dark_window else ""
    for name in ("A4", "letter"):
        pdf = out / f"marker_sheet_{name}{suffix}.pdf"
        c = canvas.Canvas(str(pdf), pageCompression=1)
        c.setTitle(f"crolab swatch marker sheet {name}")
        c.setAuthor("crolab")
        draw_sheet(c, layouts[name], dark_window)
        c.save()
        png = pdf.with_suffix(".png")
        _png_preview(pdf, png, layouts[name])
        written += [pdf, png]
    if not dark_window:
        pdf = out / "marker_card.pdf"
        c = canvas.Canvas(str(pdf), pageCompression=1)
        c.setTitle("crolab marker card")
        draw_card_page(c, layouts["card"])
        c.save()
        png = pdf.with_suffix(".png")
        _png_preview(pdf, png, layouts["card"])
        written += [pdf, png]
    return written


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=SHEET_DIR)
    ap.add_argument("--dark-window", action="store_true",
                    help="fill the window dark grey (for white/pale yarn); writes *_dark.pdf")
    a = ap.parse_args(argv)
    for p in make_all(a.out, a.dark_window):
        print(p)


if __name__ == "__main__":
    main()
