"""Marker-sheet geometry: one source of truth for the PDF, the raster previews, the synthetic
renderer and the analyzer.

Coordinates are millimetres in the *sheet frame*: origin at the top-left corner of the page
(or card), x to the right, y down (the same handedness as image coordinates). Marker corners are
listed in OpenCV ArUco order: top-left, top-right, bottom-right, bottom-left of the marker as
printed upright, at the *outer* edge of the black border.

Raster convention (used everywhere in this package): a raster at ``ppm`` pixels per mm has pixel
``i`` covering mm ``[i/ppm, (i+1)/ppm)``; pixel centres sit at integer coordinates, so the
continuous pixel coordinate of a point at ``x`` mm is ``u = ppm*x - 0.5`` (OpenCV convention).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from crolab import REPO_ROOT

SHEET_DIR = REPO_ROOT / "lab" / "swatch"
LAYOUT_JSON = SHEET_DIR / "sheet_layout.json"
LAYOUT_VERSION = "1"
DICTIONARY = "DICT_4X4_100"

PAGES_MM = {"A4": (210.0, 297.0), "letter": (215.9, 279.4)}
CARD_MM = (85.6, 54.0)  # ISO/IEC 7810 ID-1 (credit card)


def aruco_dictionary(name: str = DICTIONARY):
    return cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, name))


def marker_bits(marker_id: int, dictionary: str = DICTIONARY) -> np.ndarray:
    """(n+2)x(n+2) array, 1 = black cell, including the one-cell black border."""
    d = aruco_dictionary(dictionary)
    n = d.markerSize + 2
    img = cv2.aruco.generateImageMarker(d, int(marker_id), n, borderBits=1)
    return (img < 128).astype(np.uint8)


@dataclass
class Layout:
    name: str
    kind: str                      # "sheet" | "card"
    size_mm: tuple[float, float]   # (width, height) of the page or card
    marker_mm: float
    markers: dict[int, np.ndarray]  # id -> (4,2) corners in mm
    window_mm: tuple[float, float, float, float] | None  # x0, y0, x1, y1 (sheet only)
    ruler_mm: dict = field(default_factory=dict)          # {"x0","y","length"}
    check_mm: dict = field(default_factory=dict)          # printed cross-check distance
    dictionary: str = DICTIONARY

    # ---- helpers -------------------------------------------------------------------------
    def object_points(self, ids) -> tuple[np.ndarray, np.ndarray]:
        """Return (sheet_mm (N*4,2), mask of ids found in layout)."""
        pts, keep = [], []
        for i in ids:
            c = self.markers.get(int(i))
            keep.append(c is not None)
            if c is not None:
                pts.append(c)
        return (np.concatenate(pts, 0) if pts else np.zeros((0, 2))), np.array(keep, bool)

    def to_json(self) -> dict:
        return {
            "kind": self.kind,
            "size_mm": list(self.size_mm),
            "marker_mm": self.marker_mm,
            "dictionary": self.dictionary,
            "window_mm": list(self.window_mm) if self.window_mm else None,
            "ruler_mm": self.ruler_mm,
            "check_mm": self.check_mm,
            "markers": [{"id": int(k), "corners_mm": np.round(v, 4).tolist()}
                        for k, v in sorted(self.markers.items())],
        }

    @classmethod
    def from_json(cls, name: str, d: dict) -> "Layout":
        return cls(
            name=name, kind=d["kind"], size_mm=tuple(d["size_mm"]), marker_mm=d["marker_mm"],
            markers={int(m["id"]): np.asarray(m["corners_mm"], float) for m in d["markers"]},
            window_mm=tuple(d["window_mm"]) if d.get("window_mm") else None,
            ruler_mm=d.get("ruler_mm", {}), check_mm=d.get("check_mm", {}),
            dictionary=d.get("dictionary", DICTIONARY),
        )

    def scaled(self, k: float) -> "Layout":
        """Layout as actually printed when the printer scaled everything by ``k``."""
        return Layout(self.name, self.kind, (self.size_mm[0] * k, self.size_mm[1] * k),
                      self.marker_mm * k, {i: c * k for i, c in self.markers.items()},
                      tuple(np.asarray(self.window_mm) * k) if self.window_mm else None,
                      self.ruler_mm, self.check_mm, self.dictionary)


def _square(x: float, y: float, s: float) -> np.ndarray:
    return np.array([[x, y], [x + s, y], [x + s, y + s], [x, y + s]], float)


def sheet_layout(name: str, first_id: int, *, margin=10.0, header=36.0, marker=16.0,
                 pitch=24.0, gap=4.0) -> Layout:
    """A ring of markers around an empty central window."""
    W, H = PAGES_MM[name]
    x0, x1 = margin, W - margin
    y0, y1 = margin + header, H - margin
    nx = int((x1 - x0 - marker) // pitch) + 1
    ny = int((y1 - y0 - marker) // pitch) + 1
    xs = np.linspace(x0, x1 - marker, nx)
    ys = np.linspace(y0, y1 - marker, ny)
    pos = [(x, ys[0]) for x in xs]                        # top, left->right
    pos += [(xs[-1], y) for y in ys[1:-1]]                # right, top->bottom
    pos += [(x, ys[-1]) for x in xs[::-1]]                # bottom, right->left
    pos += [(xs[0], y) for y in ys[1:-1][::-1]]           # left, bottom->top
    markers = {first_id + k: _square(x, y, marker) for k, (x, y) in enumerate(pos)}
    win = (x0 + marker + gap, y0 + marker + gap, x1 - marker - gap, y1 - marker - gap)
    ruler = {"x0": round((W - 100.0) / 2, 3), "y": margin + 24.0, "length": 100.0}
    check = {"label": "outer edges of the left marker column", "mm": round(y1 - y0, 3)}
    return Layout(name, "sheet", (W, H), marker, markers, win, ruler, check)


def card_layout(first_id: int = 80, *, marker=13.0) -> Layout:
    W, H = CARD_MM
    xs = 4.0 + np.arange(5) * 16.4
    ys = [4.0, 21.0]
    markers, k = {}, first_id
    for y in ys:
        for x in xs:
            markers[k] = _square(float(x), y, marker)
            k += 1
    ruler = {"x0": 4.0, "y": 43.0, "length": 50.0}
    check = {"label": "outer edges of the outer marker columns", "mm": round(xs[-1] + marker - xs[0], 3)}
    return Layout("card", "card", (W, H), marker, markers, None, ruler, check)


def build_layouts() -> dict[str, Layout]:
    return {"A4": sheet_layout("A4", 0), "letter": sheet_layout("letter", 40), "card": card_layout(80)}


def save_layouts(path: Path = LAYOUT_JSON, layouts: dict[str, Layout] | None = None) -> Path:
    layouts = layouts or build_layouts()
    doc = {
        "$comment": "Generated by `python -m crolab.swatch.make_sheet`; read by crolab.swatch.analyze. "
                    "Units mm; sheet frame origin top-left, x right, y down; corners in ArUco order "
                    "TL,TR,BR,BL at the outer edge of the black border.",
        "version": LAYOUT_VERSION,
        "dictionary": DICTIONARY,
        "layouts": {k: v.to_json() for k, v in layouts.items()},
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=1) + "\n")
    return path


def load_layouts(path: Path | None = None) -> dict[str, Layout]:
    path = Path(path) if path else LAYOUT_JSON
    if not path.exists():
        return build_layouts()
    doc = json.loads(path.read_text())
    return {k: Layout.from_json(k, v) for k, v in doc["layouts"].items()}


# ---- raster rendering (previews, synthetic photos) -----------------------------------------
def mm_to_px_matrix(ppm: float, origin_mm=(0.0, 0.0)) -> np.ndarray:
    """3x3 matrix mapping mm (sheet frame) -> raster pixel coordinates."""
    ox, oy = origin_mm
    return np.array([[ppm, 0, -ppm * ox - 0.5], [0, ppm, -ppm * oy - 0.5], [0, 0, 1.0]])


def _fill_rect(img, x0, y0, x1, y1, ppm, value):
    """Exact area-coverage fill of an axis-aligned rectangle given in mm (pixel i covers
    [i/ppm, (i+1)/ppm)). OpenCV's LINE_AA polygon fill is biased by ~0.5 px, which matters for
    sub-pixel ground truth."""
    X0, X1, Y0, Y1 = x0 * ppm, x1 * ppm, y0 * ppm, y1 * ppm
    h, w = img.shape[:2]
    u0, u1 = max(0, int(np.floor(X0))), min(w, int(np.ceil(X1)))
    v0, v1 = max(0, int(np.floor(Y0))), min(h, int(np.ceil(Y1)))
    if u1 <= u0 or v1 <= v0:
        return
    iu, iv = np.arange(u0, u1), np.arange(v0, v1)
    cx = np.clip(np.minimum(X1, iu + 1) - np.maximum(X0, iu), 0, 1)
    cy = np.clip(np.minimum(Y1, iv + 1) - np.maximum(Y0, iv), 0, 1)
    c = cy[:, None] * cx[None, :]
    sub = img[v0:v1, u0:u1].astype(np.float32)
    img[v0:v1, u0:u1] = np.round(sub * (1 - c) + float(value) * c).astype(img.dtype)


def render_layout(layout: Layout, ppm: float, *, window_fill: int | None = None,
                  text: bool = True) -> np.ndarray:
    """Grayscale uint8 raster of the printed sheet/card (white paper = 255)."""
    W, H = layout.size_mm
    img = np.full((int(round(H * ppm)), int(round(W * ppm))), 255, np.uint8)
    if window_fill is not None and layout.window_mm:
        _fill_rect(img, *layout.window_mm, ppm, int(window_fill))
    for mid, c in layout.markers.items():
        bits = marker_bits(mid, layout.dictionary)
        n = bits.shape[0]
        cell = layout.marker_mm / n
        x0, y0 = c[0]
        for r in range(n):
            for col in range(n):
                if bits[r, col]:
                    _fill_rect(img, x0 + col * cell, y0 + r * cell, x0 + (col + 1) * cell,
                               y0 + (r + 1) * cell, ppm, 0)
    rl = layout.ruler_mm
    if rl:
        x0, y, L = rl["x0"], rl["y"], rl["length"]
        _fill_rect(img, x0, y, x0 + L, y + 1.5, ppm, 0)
        for t in range(int(L) + 1):
            h = 6.0 if t % 10 == 0 else 4.0 if t % 5 == 0 else 2.5
            _fill_rect(img, x0 + t - 0.1, y - h, x0 + t + 0.1, y, ppm, 0)
    if layout.window_mm:
        x0, y0, x1, y1 = layout.window_mm
        g = 160
        for (cx, cy, sx, sy) in [(x0, y0, 1, 1), (x1, y0, -1, 1), (x1, y1, -1, -1), (x0, y1, 1, -1)]:
            xa, xb = sorted([cx - sx * 1.5, cx + sx * 8])
            ya, yb = sorted([cy - sy * 1.5, cy - sy * 1.2])
            _fill_rect(img, xa, ya, xb, yb, ppm, g)
            xa, xb = sorted([cx - sx * 1.5, cx - sx * 1.2])
            ya, yb = sorted([cy - sy * 1.5, cy + sy * 8])
            _fill_rect(img, xa, ya, xb, yb, ppm, g)
    if text and layout.kind == "sheet":
        fs = 0.11 * ppm / 2.0
        cv2.putText(img, f"crolab swatch sheet {layout.name} v{LAYOUT_VERSION}", (int(10 * ppm), int(16 * ppm)),
                    cv2.FONT_HERSHEY_SIMPLEX, fs, 0, max(1, int(ppm / 4)), cv2.LINE_AA)
    return img
