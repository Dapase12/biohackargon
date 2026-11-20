"""1 Hz-native analytics family — pure math utilities.

Mirrors analytics/lib/src/onehz/util.dart.
All functions are pure. Where a statistic is undefined (empty input,
degenerate variance), they return None rather than a fabricated value.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Optional

import numpy as np
from scipy import stats


# ── Constants ────────────────────────────────────────────────────────────────

# The fastest cadence sample_cadence_seconds will vouch for (seconds).
# Above this the metrics that consume a cadence have no calibration and
# no validation data, so the helper abstains rather than picking a number.
MAX_SUPPORTED_CADENCE_SEC = 300.0

# Gaps within this factor of the median count as belonging to the same mode.
_CADENCE_MODE_TOLERANCE = 2.0

# The median must describe at least this share of the gaps.
_CADENCE_MIN_MODE_FRACTION = 0.5


# ── Basic Statistics ─────────────────────────────────────────────────────────


def mean(xs: list[float]) -> Optional[float]:
    """Mean, or None if empty."""
    if not xs:
        return None
    return sum(xs) / len(xs)


def stddev(xs: list[float]) -> Optional[float]:
    """Sample standard deviation (N-1), or None if <2 points."""
    if len(xs) < 2:
        return None
    m = mean(xs)
    assert m is not None
    s = sum((x - m) ** 2 for x in xs)
    return math.sqrt(s / (len(xs) - 1))


def stddev_pop(xs: list[float]) -> Optional[float]:
    """Population standard deviation (N), or None if empty."""
    if not xs:
        return None
    m = mean(xs)
    assert m is not None
    s = sum((x - m) ** 2 for x in xs)
    return math.sqrt(s / len(xs))


def percentile_sorted(sorted_xs: list[float], p: float) -> Optional[float]:
    """Linear-interpolated percentile (p in [0,100]) of an ALREADY-ASCENDING list.

    Returns None if empty. For when you hold a sorted list already, or want
    several percentiles of one window without re-sorting it each time.
    """
    if not sorted_xs:
        return None
    if len(sorted_xs) == 1:
        return sorted_xs[0]
    rank = (p / 100.0) * (len(sorted_xs) - 1)
    lo = int(math.floor(rank))
    hi = int(math.ceil(rank))
    if lo == hi:
        return sorted_xs[lo]
    frac = rank - lo
    return sorted_xs[lo] + (sorted_xs[hi] - sorted_xs[lo]) * frac


def percentile(values: list[float], p: float) -> Optional[float]:
    """Linear-interpolated percentile (p in [0,100]); None if empty."""
    if not values:
        return None
    return percentile_sorted(sorted(values), p)


def median(xs: list[float]) -> Optional[float]:
    """Median (linear-interpolated), or None if empty."""
    return percentile(xs, 50.0)


def mad(xs: list[float], *, scaled: bool = True) -> Optional[float]:
    """Median absolute deviation, scaled to be a consistent estimator of σ for
    normal data (× 1.4826). Returns None if empty.

    NOTE: on quantized data the raw MAD can be 0 — callers must guard division
    (see robust_z).
    """
    if not xs:
        return None
    m = median(xs)
    assert m is not None
    dev = [abs(x - m) for x in xs]
    raw = median(dev)
    if raw is None:
        return None
    return raw * 1.4826 if scaled else raw


# ── Cadence Measurement ──────────────────────────────────────────────────────


def sample_cadence_seconds(ts_sec: list[float]) -> Optional[float]:
    """Measured sampling cadence (seconds) of a time-ordered stream — or None.

    IT ABSTAINS INSTEAD OF FALLING BACK. Returns None when:
      * fewer than two samples, or no positive gap — nothing to measure;
      * the median gap exceeds MAX_SUPPORTED_CADENCE_SEC — a device we cannot
        yet score;
      * the median describes under _CADENCE_MIN_MODE_FRACTION of the gaps.

    There is deliberately NO floor at 1 s.
    """
    if len(ts_sec) < 2:
        return None
    gaps = []
    for i in range(1, len(ts_sec)):
        g = ts_sec[i] - ts_sec[i - 1]
        # Non-positive gaps are duplicate or unsorted timestamps, not a cadence.
        # Pathological LONG gaps are deliberately kept.
        if g > 0:
            gaps.append(g)
    m = median(gaps)
    if m is None or m > MAX_SUPPORTED_CADENCE_SEC:
        return None
    in_mode = 0
    for g in gaps:
        if g <= m * _CADENCE_MODE_TOLERANCE and g * _CADENCE_MODE_TOLERANCE >= m:
            in_mode += 1
    if in_mode < len(gaps) * _CADENCE_MIN_MODE_FRACTION:
        return None
    return m


# ── Z-Scores ─────────────────────────────────────────────────────────────────


def robust_z(x: float, sample: list[float]) -> Optional[float]:
    """Iglewicz–Hoaglin modified z-score of x against a sample, using median + MAD.

    Returns None if MAD is 0 (degenerate / fully-quantized) so the caller can
    fall back to a coarser test rather than divide by zero.
    """
    scale = RobustScale.of(sample)
    if scale is None:
        return None
    return scale.z(x)


@dataclass(frozen=True)
class RobustScale:
    """The median + MAD of a sample, computed once.

    Results are identical to robust_z, including its null semantics:
    absent for a sample under two values or a MAD of zero.
    """

    med: float
    scale: float

    @classmethod
    def of(cls, sample: list[float]) -> Optional["RobustScale"]:
        if len(sample) < 2:
            return None
        m = median(sample)
        if m is None:
            return None
        s = mad(sample)
        if s is None or s == 0:
            return None
        return cls(m, s)

    def z(self, x: float) -> float:
        return (x - self.med) / self.scale


def z_score(x: float, sample: list[float]) -> Optional[float]:
    """Ordinary z-score against a sample (mean+SD). None if SD undefined or 0."""
    m = mean(sample)
    sd = stddev(sample)
    if m is None or sd is None or sd == 0:
        return None
    return (x - m) / sd


# ── Regression ───────────────────────────────────────────────────────────────


def ols_slope(y: list[float], x: Optional[list[float]] = None) -> Optional[float]:
    """Ordinary-least-squares slope of y vs x (x defaults to 0..n-1). None if <2."""
    n = len(y)
    if n < 2:
        return None
    xs = x if x is not None else [float(i) for i in range(n)]
    mx = mean(xs)
    my = mean(y)
    assert mx is not None and my is not None
    num = 0.0
    den = 0.0
    for i in range(n):
        num += (xs[i] - mx) * (y[i] - my)
        den += (xs[i] - mx) * (xs[i] - mx)
    return None if den == 0 else num / den


@dataclass(frozen=True)
class LineFit:
    """OLS line fit (slope + intercept)."""

    slope: float
    intercept: float


def ols_fit(y: list[float], x: Optional[list[float]] = None) -> Optional[LineFit]:
    """OLS line fit (slope + intercept). None if degenerate."""
    n = len(y)
    if n < 2:
        return None
    xs = x if x is not None else [float(i) for i in range(n)]
    s = ols_slope(y, xs)
    if s is None:
        return None
    b = mean(y)
    mx = mean(xs)
    assert b is not None and mx is not None
    return LineFit(s, b - s * mx)


def theil_sen(y: list[float], x: Optional[list[float]] = None) -> Optional[float]:
    """Theil–Sen robust slope estimator: median of all pairwise slopes.

    Robust to outliers (breakdown ~29%). None if <2 points or all x identical.
    """
    n = len(y)
    if n < 2:
        return None
    xs = x if x is not None else [float(i) for i in range(n)]
    slopes = []
    for i in range(n):
        for j in range(i + 1, n):
            dx = xs[j] - xs[i]
            if dx == 0:
                continue
            slopes.append((y[j] - y[i]) / dx)
    return median(slopes) if slopes else None


# ── Rounding ─────────────────────────────────────────────────────────────────


def round6(x: float) -> Optional[float]:
    """6-dp rounding used for stable JSON output.

    Returns None for a non-finite input. NaN/Infinity is not a measurement.
    """
    if not math.isfinite(x):
        return None
    return round(x * 1_000_000) / 1_000_000


def round_to(x: float, decimals: int) -> float:
    f = 10**decimals
    return round(x * f) / f


# ── Lomb–Scargle Periodogram ─────────────────────────────────────────────────


@dataclass(frozen=True)
class LsPoint:
    """One spectral estimate: power spectral DENSITY at an ordinary frequency.

    UNITS — psd is in (unit of y)² per Hz. For an RR series in ms sampled on
    beat times in SECONDS, that is ms²/Hz. Integrating it over a band yields ms².
    """

    freq_hz: float
    psd: float


@dataclass(frozen=True)
class LombScargle:
    """Lomb–Scargle PSD for UNEVENLY-sampled data (Press & Rybicki 1989)."""

    spectrum: list[LsPoint]

    def band_power(self, lo_hz: float, hi_hz: float) -> float:
        """Band power = ∫ PSD(f)·df over [lo_hz, hi_hz), rectangular sum over the grid.

        Returns (unit of y)² — ms² for an RR series in ms.
        """
        p = 0.0
        for i, pt in enumerate(self.spectrum):
            f = pt.freq_hz
            if f < lo_hz or f >= hi_hz:
                continue
            # Bin width: step to previous grid point, or (for first point) to next.
            if i > 0:
                df = pt.freq_hz - self.spectrum[i - 1].freq_hz
            elif len(self.spectrum) > 1:
                df = self.spectrum[1].freq_hz - self.spectrum[0].freq_hz
            else:
                df = 0.0
            p += pt.psd * df
        return p

    def peak_freq(self, lo_hz: float, hi_hz: float) -> Optional[float]:
        """Peak frequency within [lo_hz, hi_hz], or None if no grid points there."""
        best: Optional[float] = None
        best_p = float("-inf")
        for pt in self.spectrum:
            if pt.freq_hz < lo_hz or pt.freq_hz > hi_hz:
                continue
            if pt.psd > best_p:
                best_p = pt.psd
                best = pt.freq_hz
        return best


def lomb_scargle(
    t: list[float], y: list[float], freqs_hz: list[float]
) -> Optional[LombScargle]:
    """Lomb–Scargle PSD for UNEVENLY-sampled data.

    [t] sample times — pass SECONDS, so the grid and the output are in Hz.
    [y] sample values. Computed on the supplied [freqs_hz] grid.
    The series is mean-subtracted; the τ phase-offset makes the estimate
    time-shift invariant. Returns None if <4 points, zero variance, or zero time span.

    UNITS: the returned LsPoint.psd is a PHYSICAL density in (unit of y)²/Hz —
    NOT the dimensionless Horne–Baliunas variance-normalised power.
    """
    n = len(t)
    if n < 4 or len(y) != n or not freqs_hz:
        return None

    my = mean(y)
    if my is None:
        return None

    yc = [v - my for v in y]

    variance = sum(v * v for v in yc) / (n - 1)
    if variance <= 0:
        return None

    t_min = min(t)
    t_max = max(t)
    span = t_max - t_min
    if span <= 0:
        return None

    # One-sided periodogram → density: 2·Δt, with Δt the MEAN sample interval.
    psd_scale = 2.0 * span / (n - 1)

    out: list[LsPoint] = []
    for f_hz in freqs_hz:
        w = 2.0 * math.pi * f_hz  # angular frequency (rad / time-unit)
        if w == 0:
            out.append(LsPoint(0.0, 0.0))
            continue

        # τ: phase reference for time-shift invariance.
        sin2 = 0.0
        cos2 = 0.0
        for ti in t:
            sin2 += math.sin(2.0 * w * ti)
            cos2 += math.cos(2.0 * w * ti)
        tau = math.atan2(sin2, cos2) / (2.0 * w)

        c_num = 0.0
        c_den = 0.0
        s_num = 0.0
        s_den = 0.0
        for i in range(n):
            arg = w * (t[i] - tau)
            c = math.cos(arg)
            s = math.sin(arg)
            c_num += yc[i] * c
            c_den += c * c
            s_num += yc[i] * s
            s_den += s * s

        term1 = 0.0 if c_den == 0 else (c_num * c_num) / c_den
        term2 = 0.0 if s_den == 0 else (s_num * s_num) / s_den
        out.append(LsPoint(f_hz, 0.5 * (term1 + term2) * psd_scale))

    return LombScargle(out)


def freq_grid(lo_hz: float, hi_hz: float, n: int) -> list[float]:
    """Build a linear frequency grid [lo_hz, hi_hz] with [n] points (inclusive)."""
    if n < 1:
        return []
    if n == 1:
        return [lo_hz]
    step = (hi_hz - lo_hz) / (n - 1)
    return [lo_hz + step * i for i in range(n)]


# ── Calendar Days ────────────────────────────────────────────────────────────


def calendar_days(dates: list[str]) -> list[int]:
    """Calendar-day index (days since epoch) for each yyyy-MM-dd label.

    An unparseable label falls back to its position.
    """
    from datetime import datetime, timezone

    out = []
    for i, d_str in enumerate(dates):
        try:
            d = datetime.strptime(d_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            out.append(int(d.timestamp() // 86400))
        except ValueError:
            out.append(i)
    return out


# ── Ranking ──────────────────────────────────────────────────────────────────


def average_ranks(xs: list[float]) -> list[float]:
    """Average ranks, 1-based, ties sharing their mean rank.

    Tie handling is not a detail wherever this is used.
    """
    n = len(xs)
    if n == 0:
        return []

    # Sort indices by value
    idx = sorted(range(n), key=lambda i: xs[i])
    ranks = [0.0] * n

    i = 0
    while i < n:
        j = i
        while j + 1 < n and xs[idx[j + 1]] == xs[idx[i]]:
            j += 1
        # Ranks are 1-based, so positions i..j map to ranks i+1..j+1.
        shared = (i + 1 + j + 1) / 2.0
        for k in range(i, j + 1):
            ranks[idx[k]] = shared
        i = j + 1
    return ranks


# ── P-Values ─────────────────────────────────────────────────────────────────


def normal_two_sided_p(z_score: float) -> float:
    """Two-sided p for a standard-normal z. 2·(1 − Φ(|z|)).

    Numerical Recipes' erfcc — a Chebyshev fit to erfc with fractional error
    under 1.2e-7 everywhere.
    """
    if not math.isfinite(z_score):
        return 1.0
    x = abs(z_score) / math.sqrt(2.0)
    t = 1.0 / (1.0 + 0.5 * x)
    ans = t * math.exp(
        -x * x
        - 1.26551223
        + t
        * (
            1.00002368
            + t
            * (
                0.37409196
                + t
                * (
                    0.09678418
                    + t
                    * (
                        -0.18628806
                        + t
                        * (
                            0.27886807
                            + t
                            * (
                                -1.13520398
                                + t
                                * (
                                    1.48851587
                                    + t
                                    * (-0.82215223 + t * 0.17087277)
                                )
                            )
                        )
                    )
                )
            )
        )
    )
    return max(0.0, min(1.0, ans))


def benjamini_hochberg(ps: list[Optional[float]]) -> list[Optional[float]]:
    """Benjamini-Hochberg (1995) step-up FDR adjustment over a family of p-values.

    Returns q-values POSITIONALLY ALIGNED to [ps]; a null p (a test that could
    not be run) stays null and does not enter the family size.
    """
    idx = [i for i, p in enumerate(ps) if p is not None]
    idx.sort(key=lambda i: ps[i] or 0.0)
    m = len(idx)
    out: list[Optional[float]] = [None] * len(ps)
    running = 1.0
    for k in range(m - 1, -1, -1):
        q = (ps[idx[k]] or 0.0) * m / (k + 1)
        running = min(running, q)
        out[idx[k]] = running
    return out


# ── Beat Cleaning (ported from cardio_stager.dart) ───────────────────────────

_RR_MIN = 300.0
_RR_MAX = 2000.0
_RR_MAX_STEP = 200.0


def clean_beats_in_window(
    rr_ms: list[float], rr_ts_ms: list[float], window_start_ms: float, window_end_ms: float
) -> tuple[list[float], list[float]]:
    """Filter RR intervals within a time window.

    Keeps beats with RR in [300, 2000] ms and successive jumps <= 200 ms.
    Returns (filtered_rr_ms, filtered_rr_ts_ms).
    """
    # Collect beats whose timestamp falls in the window
    window_beats = []
    for i in range(len(rr_ms)):
        if window_start_ms <= rr_ts_ms[i] <= window_end_ms:
            window_beats.append((rr_ts_ms[i], rr_ms[i]))

    if not window_beats:
        return [], []

    # Sort by timestamp
    window_beats.sort(key=lambda x: x[0])

    # Filter: apply physiologic gates to ALL beats (including first)
    filtered_ts = []
    filtered_rr = []

    for ts, rr in window_beats:
        if rr < _RR_MIN or rr > _RR_MAX:
            continue
        if filtered_rr and abs(rr - filtered_rr[-1]) > _RR_MAX_STEP:
            continue
        filtered_ts.append(ts)
        filtered_rr.append(rr)

    return filtered_rr, filtered_ts


# Exported constants for testing
RR_MIN = _RR_MIN
RR_MAX = _RR_MAX
RR_MAX_STEP = _RR_MAX_STEP