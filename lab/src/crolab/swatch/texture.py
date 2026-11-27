"""Gauge from fabric texture: periodicity of the rectified swatch image.

Model: after rotating the swatch so rows run horizontally, the fabric is (approximately) a 2-D
lattice with real-space vectors a1 = (p_x, 0) (one stitch along the row) and a2 = (s, p_y)
(one row up, with an arbitrary shear s). Its power spectrum has peaks on the reciprocal lattice:
every peak has k_x = m/p_x, and the k_x = 0 column holds k_y = n/p_y. Hence

* stitch pitch p_x: fundamental of the spectrum *marginalised over k_y* (shear-independent);
* row pitch p_y: fundamental of the narrow k_x ~ 0 strip (= spectrum of the row profile);
* residual tilt: angle of the strongest peak near the k_y axis.

Fundamentals are found with a harmonic-mean score on a whitened 1-D spectrum, then refined from
the interpolated harmonic peaks. A factor-of-2 ambiguity is intrinsic (turned flat work repeats
every *two* rows; the two legs of a "V" give a strong half-stitch harmonic): it is resolved with
the stitch-type prior (height/width ratio from ``spec/stitches.json``, width ~ 1.3 x hook) and
reported when the prior decided it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np
from scipy import ndimage, fft as sfft


# ---------------------------------------------------------------------------------------------
# image helpers
# ---------------------------------------------------------------------------------------------
def rotate(img: np.ndarray, angle_deg: float, interp=cv2.INTER_LINEAR, border=0):
    """Rotate counter-clockwise (visually, y down) by angle_deg about the centre with an expanded
    canvas. A feature whose direction in image coordinates is atan2(dy, dx) = angle_deg becomes
    horizontal. Returns (rotated, 2x3 matrix)."""
    h, w = img.shape[:2]
    c = ((w - 1) / 2, (h - 1) / 2)
    M = cv2.getRotationMatrix2D(c, angle_deg, 1.0)
    cos, sin = abs(M[0, 0]), abs(M[0, 1])
    nw, nh = int(np.ceil(w * cos + h * sin)), int(np.ceil(w * sin + h * cos))
    M[0, 2] += (nw - 1) / 2 - c[0]
    M[1, 2] += (nh - 1) / 2 - c[1]
    out = cv2.warpAffine(img, M, (nw, nh), flags=interp, borderMode=cv2.BORDER_CONSTANT, borderValue=border)
    return out, M


def masked_bandpass(gray: np.ndarray, mask: np.ndarray, ppm: float, hi_mm: float, lo_mm: float = 0.0):
    """High-pass (normalised convolution inside the mask), local contrast normalisation, optional
    light low-pass. Zero outside the mask."""
    g = gray.astype(np.float32)
    m = mask.astype(np.float32)
    s = hi_mm * ppm
    den = cv2.GaussianBlur(m, (0, 0), s) + 1e-6
    low = cv2.GaussianBlur(g * m, (0, 0), s) / den
    hp = (g - low) * m
    rms = np.sqrt(cv2.GaussianBlur(hp * hp, (0, 0), s) / den) + 1e-3
    out = hp / rms * m
    if lo_mm > 0:
        out = cv2.GaussianBlur(out, (0, 0), lo_mm * ppm)
    return out


def taper_window(mask: np.ndarray, ppm: float, edge_mm: float) -> np.ndarray:
    """Apodisation inside the swatch: erode by edge_mm, then smooth by edge_mm."""
    r = max(1, int(round(edge_mm * ppm)))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    er = cv2.erode(mask.astype(np.uint8), k).astype(np.float32)
    return cv2.GaussianBlur(er, (0, 0), 0.6 * r) * mask


# ---------------------------------------------------------------------------------------------
# spectra
# ---------------------------------------------------------------------------------------------
@dataclass
class Spectrum:
    P: np.ndarray          # fftshifted power, shape (N, M)
    ppm: float
    support_px: tuple      # (h, w) of the effective window, for the peak width

    @property
    def shape(self):
        return self.P.shape

    def kx(self):
        M = self.P.shape[1]
        return (np.arange(M) - M // 2) * self.ppm / M

    def ky(self):
        N = self.P.shape[0]
        return (np.arange(N) - N // 2) * self.ppm / N

    def peak_halfwidth_bins(self, axis):
        n = self.P.shape[axis]
        sup = self.support_px[axis]
        return max(1.5, n / max(sup, 1) * 1.0)

    def marginal_x(self):
        """Power summed over all k_y, for k_x > 0 -> (f, S)."""
        M = self.P.shape[1]
        c = M // 2
        S = self.P[:, c:].sum(0)
        f = np.arange(S.size) * self.ppm / M
        return f, S

    def strip_y(self, half_width_freq: float | None = None):
        """Power in a strip around k_x = 0, for k_y > 0 -> (f, S). A strip wider than the
        peak (up to ~0.4 x the stitch frequency) also collects the power of bowed rows, which
        spreads to small |k_x|, without reaching the lattice peaks at k_x = +-1/p_x."""
        N, M = self.P.shape
        cy, cx = N // 2, M // 2
        d = int(np.ceil(self.peak_halfwidth_bins(1)))
        if half_width_freq:
            d = max(d, int(half_width_freq * M / self.ppm))
        S = self.P[cy:, cx - d:cx + d + 1].sum(1)
        f = np.arange(S.size) * self.ppm / N
        return f, S


def power_spectrum(x: np.ndarray, ppm: float, support_px, pad=2.0) -> Spectrum:
    h, w = x.shape
    N = sfft.next_fast_len(int(max(64, pad * h)), real=False)
    M = sfft.next_fast_len(int(max(64, pad * w)), real=False)
    F = sfft.fft2(x - 0.0, s=(N, M), workers=-1)
    P = np.fft.fftshift(np.abs(F) ** 2)
    return Spectrum(P.astype(np.float64), ppm, support_px)


def _effective_support(win):
    ys, xs = np.nonzero(win > 0.25)
    if ys.size == 0:
        return (1, 1)
    return (np.ptp(ys) + 1, np.ptp(xs) + 1)


# ---------------------------------------------------------------------------------------------
# 1-D fundamental with harmonics
# ---------------------------------------------------------------------------------------------
@dataclass
class Fundamental:
    period_mm: float
    score: float
    peak_snr: float
    harmonics: list = field(default_factory=list)   # [(h, f_h, snr_h)]
    prior_used: bool = False
    candidates: dict = field(default_factory=dict)  # period -> score

    def to_dict(self):
        return {"period_mm": self.period_mm, "score": self.score, "peak_snr": self.peak_snr,
                "harmonics": [[int(h), float(f), float(s)] for h, f, s in self.harmonics],
                "prior_used": self.prior_used,
                "candidates": {f"{k:.3f}": float(v) for k, v in self.candidates.items()}}


def whiten(S: np.ndarray, width_bins: int) -> np.ndarray:
    k = int(width_bins) | 1
    base = ndimage.median_filter(S, size=max(5, k), mode="nearest")
    return S / (base + 1e-12 * S.max() + 1e-30)


def fundamental(f, S, period_range, hw_bins, prior_period=None, n_harm=4, f_max=None,
                min_alt_ratio=0.35, near_period=None, near_rel=0.12):
    """Fundamental period (mm) of a 1-D power spectrum with harmonics.

    With ``near_period`` no search is made: the harmonics are located within +-near_rel of the
    multiples of 1/near_period and combined (used for the split-window consistency check)."""
    df = f[1] - f[0]
    if near_period is not None:
        return _refine(f, S, 1.0 / near_period, hw_bins, n_harm, f_max or f[-1] * 0.9, near_rel)
    pmin, pmax = period_range
    f_lo, f_hi = 1.0 / pmax, 1.0 / pmin
    f_max = f_max or f[-1] * 0.9
    Sw = whiten(S, width_bins=int(max(9, 0.35 * f_lo / df * 4)))
    tol = max(1, int(np.ceil(hw_bins)))
    Smax = ndimage.maximum_filter1d(Sw, size=2 * tol + 1, mode="nearest")
    grid = f[(f >= f_lo) & (f <= f_hi)]
    if grid.size < 3:
        raise ValueError("period range outside spectrum resolution")

    def score_at(f0):
        f0 = np.atleast_1d(f0)
        H = np.clip(np.floor(f_max / f0), 1, n_harm).astype(int)
        tot = np.zeros_like(f0)
        for h in range(1, n_harm + 1):
            v = np.interp(h * f0, f, Smax, right=0.0)
            tot += np.where(h <= H, v, 0.0)
        return tot / H

    sc = score_at(grid)
    i = int(np.argmax(sc))
    f_best = grid[i]
    cands = {1 / f_best: float(sc[i])}
    best = (f_best, float(sc[i]))
    prior_used = False
    if prior_period:
        pen = lambda fr: abs(np.log((1.0 / fr) / prior_period))
        for fac in (0.5, 2.0, 1 / 3, 3.0):
            fa = f_best * fac
            if fa <= f[2] or fa >= f_max:
                continue
            # local max of the score near the alternative
            loc = np.linspace(fa * 0.97, fa * 1.03, 13)
            sa = score_at(loc)
            j = int(np.argmax(sa))
            cands[1 / loc[j]] = float(sa[j])
            if sa[j] >= min_alt_ratio * best[1] and pen(loc[j]) + np.log(1.5) < pen(best[0]):
                best = (loc[j], float(sa[j]))
                prior_used = True
    f0, score = best
    out = _refine(f, S, f0, hw_bins, n_harm, f_max, None, Sw)
    out.score, out.prior_used, out.candidates = score, prior_used, cands
    return out


def _refine(f, S, f0, hw_bins, n_harm, f_max, rel=None, Sw=None):
    """Interpolated harmonic peaks around h*f0 -> refined fundamental."""
    df = f[1] - f[0]
    if Sw is None:
        Sw = whiten(S, width_bins=int(max(9, 0.35 * f0 / df * 4)))
    tol = max(1, int(np.ceil(hw_bins)))
    harms, num, den = [], 0.0, 0.0
    logS = np.log(S + 1e-30)
    for h in range(1, n_harm + 1):
        fc = h * f0
        if fc >= f_max:
            break
        j0 = int(round(fc / df))
        t = tol if rel is None else max(tol, int(np.ceil(rel * fc / df)))
        lo, hi = max(1, j0 - t), min(S.size - 2, j0 + t)
        if hi <= lo:
            break
        j = lo + int(np.argmax(S[lo:hi + 1]))
        if j <= 0 or j >= S.size - 1:
            continue
        a, b, c = logS[j - 1], logS[j], logS[j + 1]
        dd = a - 2 * b + c
        off = 0.5 * (a - c) / dd if dd < 0 else 0.0
        fh = (j + np.clip(off, -0.5, 0.5)) * df
        snr = float(Sw[j])
        harms.append((h, fh, snr))
        if snr > 3.0:
            w = snr * h
            num += w * fh / h
            den += w
    if den > 0:
        f0 = num / den
    peak_snr = max([s for _, _, s in harms], default=0.0)
    return Fundamental(1.0 / f0, 0.0, peak_snr, harms)


# ---------------------------------------------------------------------------------------------
# tilt
# ---------------------------------------------------------------------------------------------
def row_tilt_deg(spec: Spectrum, f_range, cone_deg=15.0) -> tuple[float, float]:
    """Angle (deg, image coords) of the row lines, from the strongest spectral peak within
    cone_deg of the k_y axis. Returns (angle, peak strength relative to cone median)."""
    P = spec.P
    N, M = P.shape
    KX, KY = np.meshgrid(spec.kx(), spec.ky())
    R = np.hypot(KX, KY)
    ang = np.degrees(np.arctan2(np.abs(KX), np.abs(KY)))
    sel = (ang < cone_deg) & (R >= f_range[0]) & (R <= f_range[1]) & (KY > 0)
    if not sel.any():
        return 0.0, 0.0
    Ps = ndimage.gaussian_filter(P, 1.0)
    vals = np.where(sel, Ps, -np.inf)
    iy, ix = np.unravel_index(int(np.argmax(vals)), P.shape)
    # sub-bin centroid in a 5x5 neighbourhood
    y0, y1, x0, x1 = max(0, iy - 2), min(N, iy + 3), max(0, ix - 2), min(M, ix + 3)
    w = Ps[y0:y1, x0:x1]
    ky = (KY[y0:y1, x0:x1] * w).sum() / w.sum()
    kx = (KX[y0:y1, x0:x1] * w).sum() / w.sum()
    n = np.array([kx, ky]) / np.hypot(kx, ky)
    d = np.array([-n[1], n[0]])
    a = np.degrees(np.arctan2(d[1], d[0]))
    a = (a + 90) % 180 - 90
    strength = float(Ps[iy, ix] / (np.median(Ps[sel]) + 1e-30))
    return float(a), strength


# ---------------------------------------------------------------------------------------------
# gauge estimate
# ---------------------------------------------------------------------------------------------
@dataclass
class TextureGauge:
    stitch_pitch_mm: float
    row_pitch_mm: float
    confidence: float
    confidence_label: str
    tilt_correction_deg: float
    spread_x: float
    spread_y: float
    fx: Fundamental
    fy: Fundamental
    split_estimates: dict
    notes: list
    analysis_ppm: float
    rotated_gray: np.ndarray = None   # analysis frame (for the lattice), not serialised
    rotated_mask: np.ndarray = None
    rotated_work: np.ndarray = None

    def to_dict(self):
        return {
            "stitch_pitch_mm": round(self.stitch_pitch_mm, 4),
            "row_pitch_mm": round(self.row_pitch_mm, 4),
            "stitches_per_10cm": round(100 / self.stitch_pitch_mm, 3),
            "rows_per_10cm": round(100 / self.row_pitch_mm, 3),
            "confidence": round(self.confidence, 3),
            "confidence_label": self.confidence_label,
            "tilt_correction_deg": round(self.tilt_correction_deg, 3),
            "split_window_spread": {"stitch": round(self.spread_x, 4), "row": round(self.spread_y, 4)},
            "split_window_estimates": self.split_estimates,
            "stitch_fundamental": self.fx.to_dict(),
            "row_fundamental": self.fy.to_dict(),
            "analysis_px_per_mm": self.analysis_ppm,
            "notes": self.notes,
        }


def _snr_term(f: Fundamental):
    """0 at a whitened peak of 2 (noise), 1 at 20 and above."""
    return float(np.clip((np.log10(max(f.peak_snr, 1e-3)) - 0.3) / 1.0, 0, 1))


def estimate_gauge(gray: np.ndarray, mask: np.ndarray, ppm: float, *, prior_px: float | None = None,
                   prior_ratio: float | None = None, row_repeat: str = "auto") -> TextureGauge:
    """gray, mask: rectified swatch already rotated so rows are ~horizontal, at ppm px/mm."""
    notes = []
    pr = prior_px or 6.5
    pr_y = pr * (prior_ratio or 1.0)
    ppm_a = float(min(ppm, max(3.0, 10.0 / (0.5 * min(pr, pr_y)))))
    if ppm_a < ppm:
        s = ppm_a / ppm
        g = cv2.resize(gray.astype(np.float32), None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        m = cv2.resize(mask.astype(np.float32), (g.shape[1], g.shape[0]), interpolation=cv2.INTER_AREA) > 0.5
    else:
        g, m = gray.astype(np.float32), mask > 0
    hi = 2.0 * max(pr, pr_y)
    edge = 0.75 * max(pr, pr_y)
    pmin_x, pmax_x = 0.4 * pr, 2.6 * pr
    pmin_y, pmax_y = 0.4 * pr_y, 2.6 * pr_y
    f_rng = (1 / (3.5 * max(pr, pr_y)), 1 / (0.3 * min(pr, pr_y)))

    def prep(gi, mi):
        work = masked_bandpass(gi, mi, ppm_a, hi_mm=hi, lo_mm=0.08 * min(pr, pr_y))
        win = taper_window(mi, ppm_a, edge)
        return work, win

    work, win = prep(g, m)
    if win.sum() < (4 * pr * ppm_a) ** 2:
        raise ValueError("swatch region too small for texture analysis")
    spec = power_spectrum(work * win, ppm_a, _effective_support(win))
    tilt, strength = row_tilt_deg(spec, f_rng)
    total_tilt = 0.0
    if abs(tilt) > 0.15 and strength > 5:
        g, M = rotate(g, tilt)
        m = rotate(m.astype(np.uint8), tilt, interp=cv2.INTER_NEAREST)[0] > 0
        work, win = prep(g, m)
        spec = power_spectrum(work * win, ppm_a, _effective_support(win))
        total_tilt = tilt
    fxs, Sx = spec.marginal_x()
    fxs, Sx = spec.marginal_x()
    fx_pre = fundamental(fxs, Sx, (pmin_x, pmax_x), spec.peak_halfwidth_bins(1), prior_period=prior_px)
    fys, Sy = spec.strip_y(0.4 / fx_pre.period_mm)
    fx = fundamental(fxs, Sx, (pmin_x, pmax_x), spec.peak_halfwidth_bins(1), prior_period=prior_px)
    rr = 2 if row_repeat == "2" else 1   # rows per texture repeat, if the user knows it
    prior_y = fx.period_mm * prior_ratio * rr if prior_ratio else None
    if row_repeat in ("1", "2"):  # trust the user: no octave switching, narrower search
        prior_y, pmin_y, pmax_y = None, 0.6 * pr_y * rr, 1.6 * pr_y * rr
    fy = fundamental(fys, Sy, (pmin_y, pmax_y), spec.peak_halfwidth_bins(0), prior_period=prior_y)
    if rr == 2:
        fy.period_mm /= 2
        notes.append("row_repeat=2: texture period halved to give one row")
    if fx.prior_used:
        notes.append("stitch pitch: factor-of-2/3 ambiguity resolved with the hook-size prior")
    if fy.prior_used:
        notes.append("row pitch: factor-of-2 ambiguity (e.g. 2-row repeat of turned work) resolved with "
                     "the stitch-type height/width prior")
    # split-window consistency
    H, W = m.shape
    ys, xs = np.nonzero(m)
    cy, cx = np.median(ys), np.median(xs)
    yy, xx = np.mgrid[0:H, 0:W]
    t = 0.5 * edge * ppm_a
    halves = {"left": 1 / (1 + np.exp((xx - cx) / t)), "right": 1 / (1 + np.exp((cx - xx) / t)),
              "top": 1 / (1 + np.exp((yy - cy) / t)), "bottom": 1 / (1 + np.exp((cy - yy) / t))}
    est = {}
    for k, hw in halves.items():
        wk = win * hw.astype(np.float32)
        sp = power_spectrum(work * wk, ppm_a, _effective_support(wk))
        try:
            a = fundamental(*sp.marginal_x(), None, sp.peak_halfwidth_bins(1), near_period=fx.period_mm)
            b = fundamental(*sp.strip_y(0.4 / fx.period_mm), None, sp.peak_halfwidth_bins(0),
                            near_period=fy.period_mm * rr)
            if a.peak_snr < 2.5 or b.peak_snr < 2.5:  # no significant peak near the global estimate
                continue
            est[k] = {"stitch_pitch_mm": round(a.period_mm, 4), "row_pitch_mm": round(b.period_mm / rr, 4)}
        except ValueError:
            pass
    if len(est) >= 3:
        vx = np.array([e["stitch_pitch_mm"] for e in est.values()])
        vy = np.array([e["row_pitch_mm"] for e in est.values()])
        spread_x = float(np.std(vx, ddof=1) / np.mean(vx))
        spread_y = float(np.std(vy, ddof=1) / np.mean(vy))
    else:
        spread_x = spread_y = 1.0
        notes.append("split-window check failed: fewer than 3 of 4 half-swatches show the global period")
    conf = min(_snr_term(fx) * np.exp(-spread_x / 0.04), _snr_term(fy) * np.exp(-spread_y / 0.04))
    if fx.prior_used or fy.prior_used:
        conf *= 0.85
    conf = float(conf)
    label = "high" if conf >= 0.6 else "medium" if conf >= 0.35 else "low"
    if label == "low":
        notes.append("LOW CONFIDENCE: texture periodicity is weak or inconsistent across the swatch; "
                     "count stitches/rows by hand (PROTOCOL.md) or pass --n-stitches/--n-rows.")
    return TextureGauge(fx.period_mm, fy.period_mm, conf, label, total_tilt, spread_x, spread_y, fx, fy,
                        est, notes, ppm_a, g, m, work)


# ---------------------------------------------------------------------------------------------
# stitch-level lattice (experimental)
# ---------------------------------------------------------------------------------------------
def _phase_crossings(profile: np.ndarray, valid: np.ndarray, period_px: float):
    """Positions (px) where the local phase of `profile` at `period_px` crosses 0 mod 2*pi."""
    n = profile.size
    half = int(np.ceil(2.0 * period_px))
    t = np.arange(-half, half + 1)
    g = np.exp(-0.5 * (t / (0.8 * period_px)) ** 2) * np.exp(-2j * np.pi * t / period_px)
    z = np.convolve(profile, g[::-1], mode="same")
    ph = np.unwrap(np.angle(z))
    k0, k1 = np.ceil(ph.min() / (2 * np.pi)), np.floor(ph.max() / (2 * np.pi))
    out = []
    for k in np.arange(k0, k1 + 1):
        target = 2 * np.pi * k
        j = np.nonzero((ph[:-1] < target) & (ph[1:] >= target))[0]
        for jj in j:
            x = jj + (target - ph[jj]) / (ph[jj + 1] - ph[jj] + 1e-12)
            if valid[int(round(min(max(x, 0), n - 1)))]:
                out.append(x)
    return np.array(sorted(out))


def stitch_lattice(tg: TextureGauge) -> dict:
    """Row lines and per-row stitch points from local phase (EXPERIMENTAL).

    Points sit at a consistent *phase* of the texture, not necessarily at stitch centres."""
    ppm = tg.analysis_ppm
    work, m = tg.rotated_work, tg.rotated_mask.astype(np.float32)
    cov_y = m.mean(1) * m.shape[1] / max(m.sum(1).max(), 1)
    prof_y = (work * m).sum(1) / (m.sum(1) + 1e-6)
    py, px = tg.row_pitch_mm * ppm, tg.stitch_pitch_mm * ppm
    rows_y = _phase_crossings(prof_y, cov_y > 0.6, py)
    rows = []
    for y0, y1 in zip(rows_y[:-1], rows_y[1:]):
        if not (0.6 * py < y1 - y0 < 1.5 * py):
            continue
        a, b = int(np.floor(y0)), int(np.ceil(y1))
        strip, ms = work[a:b], m[a:b]
        cov = ms.mean(0)
        prof = (strip * ms).sum(0) / (ms.sum(0) + 1e-6)
        xs = _phase_crossings(prof, cov > 0.9, px)
        if xs.size < 3:
            continue
        d = np.diff(xs)
        d = d[(d > 0.5 * px) & (d < 1.6 * px)]
        if d.size < 2:
            continue
        rows.append({"y_mm": round(float((y0 + y1) / 2 / ppm), 3),
                     "x_mm": [round(float(x / ppm), 3) for x in xs],
                     "n_points": int(xs.size),
                     "pitch_median_mm": round(float(np.median(d) / ppm), 4),
                     "pitch_sd_mm": round(float(np.std(d, ddof=1) / ppm), 4)})
    rp = np.diff(rows_y) / ppm
    rp = rp[(rp > 0.6 * tg.row_pitch_mm) & (rp < 1.5 * tg.row_pitch_mm)]
    allp = np.array([r["pitch_median_mm"] for r in rows]) if rows else np.array([])
    return {
        "experimental": True,
        "note": "points mark a consistent texture phase per row, not verified stitch centres",
        "frame": "rotated rectified swatch at analysis_px_per_mm (rows horizontal)",
        "analysis_px_per_mm": ppm,
        "row_lines_mm": [round(float(y / ppm), 3) for y in rows_y],
        "row_pitch_median_mm": round(float(np.median(rp)), 4) if rp.size else None,
        "row_pitch_sd_mm": round(float(np.std(rp, ddof=1)), 4) if rp.size > 1 else None,
        "stitch_pitch_median_mm": round(float(np.median(allp)), 4) if allp.size else None,
        "stitch_pitch_between_row_sd_mm": round(float(np.std(allp, ddof=1)), 4) if allp.size > 1 else None,
        "rows": rows,
    }
