"""Sleep staging algorithms ported from OpenStrap analytics (Dart) to Python.

Implements:
- zAngle computation from 3-axis accel
- Immobility mask from z-angle rolling median
- van Hees sleep window detection
- cardioStager: per-epoch feature extraction (motion, HR, HRV)
- classifyCardioEpochs: weighted robust-z decision layer
- segmentSleep: single entry point producing SleepSegmentation

Mirrors:
- analytics/lib/src/onehz/sleep/cardio_stager.dart
- analytics/lib/src/onehz/sleep/van_hees.dart
- analytics/lib/src/onehz/sleep/segment.dart
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from .models import (
    AccelSample,
    AdvancedSleepStager,
    CardioEpochFeatures,
    CardioStagerResult,
    ImmobilityMask,
    RrSeries,
    SleepNightObservation,
    SleepSegmentation,
    SleepSession,
    SleepUserProfile,
    SleepWindow,
    ZAngle,
)
from .util import (
    lomb_scargle,
    mad,
    median,
    percentile,
)

# ── Constants matching Dart implementation ────────────────────────────────────────

# Epoch duration in seconds
DEFAULT_EPOCH_SEC = 30

# van Hees sleep window detection
VAN_HEES_MIN_WINDOW_MIN = 30  # minimum sleep window (minutes)
VAN_HEES_MERGE_GAP_MIN = 30   # merge windows closer than this (minutes)

# Z-angle thresholds
Z_ANGLE_STILL_DEG = 5.0  # degrees

# ENMO thresholds (g)
STILL_CUT_G = 0.015  # "still" threshold
MOVE_CUT_G = 0.05    # "big move" threshold

# Robust z-score clipping
ROBUST_Z_CLIP = 3.0

# Decision layer weights (must sum to ~1.0)
WEIGHT_IMMOBILE = 0.25
WEIGHT_HR = 0.25
WEIGHT_HRV = 0.25
WEIGHT_RK = 0.25

# Minimum valid data fractions
MIN_VALID_HR_FRAC = 0.3
MIN_VALID_RR_FRAC = 0.3

# HRV frequency bands for Lomb-Scargle
LF_BAND = (0.04, 0.15)  # Hz
HF_BAND = (0.15, 0.40)  # Hz

# RMSSD computation window
RMSSD_WINDOW_S = 30  # seconds per epoch


# ── Helpers ───────────────────────────────────────────────────────────────────────


def _enmo_from_accel(accel: AccelSample) -> float:
    """ENMO = max(0, |accel| - 1g). Accel is gravity vector in g."""
    mag = math.sqrt(accel.x * accel.x + accel.y * accel.y + accel.z * accel.z)
    return max(0.0, mag - 1.0)


def _epoch_bounds(start_s: float, end_s: float, epoch_sec: int) -> list[tuple[float, float]]:
    """Generate epoch boundaries [start, end) aligned to epoch_sec grid."""
    epochs = []
    # Align to epoch grid
    first = math.floor(start_s / epoch_sec) * epoch_sec
    t = first
    while t < end_s:
        epochs.append((t, min(t + epoch_sec, end_s)))
        t += epoch_sec
    return epochs


def _filter_samples_in_epoch(
    samples: list[Any],
    epoch_start_s: float,
    epoch_end_s: float,
    ts_field: str = "ts_ms",
) -> list[Any]:
    """Filter samples that fall within epoch [start_s, end_s)."""
    start_ms = epoch_start_s * 1000
    end_ms = epoch_end_s * 1000
    result = []
    for s in samples:
        ts_val = getattr(s, ts_field)
        # Handle RrSeries which has ts_ms as a list
        if isinstance(ts_val, list):
            # Check if any timestamp in the list falls in the epoch
            if any(start_ms <= ts < end_ms for ts in ts_val):
                result.append(s)
        else:
            if start_ms <= ts_val < end_ms:
                result.append(s)
    return result


# ── zAngle computation ────────────────────────────────────────────────────────────


def compute_z_angle(accel_samples: list[AccelSample]) -> ZAngle:
    """Compute z-angle (tilt) from 1 Hz gravity vector samples.

    z-angle = arccos(|z| / |accel|) in degrees.
    When |accel| ≈ 0, z-angle = 90° (flat).
    """
    if not accel_samples:
        return ZAngle(z_angle_deg=[], ts_ms=[])

    z_angles = []
    ts_ms = []

    for sample in accel_samples:
        if not sample.valid:
            z_angles.append(float('nan'))
            ts_ms.append(sample.ts_ms)
            continue

        mag = math.sqrt(sample.x ** 2 + sample.y ** 2 + sample.z ** 2)
        if mag < 1e-6:
            z_angle = 90.0
        else:
            # z-component absolute value (tilt from vertical)
            cos_theta = abs(sample.z) / mag
            cos_theta = min(1.0, max(-1.0, cos_theta))
            z_angle = math.degrees(math.acos(cos_theta))

        z_angles.append(z_angle)
        ts_ms.append(sample.ts_ms)

    return ZAngle(z_angle_deg=z_angles, ts_ms=ts_ms)


# ── Rolling median ────────────────────────────────────────────────────────────────


def _rolling_median(values: list[float], window: int) -> list[float]:
    """Rolling median with window size (centered, edge-truncated).

    Mirrors Dart's _rollingMedian: symmetric window, truncates at edges.
    """
    n = len(values)
    if n == 0 or window <= 1:
        return values.copy()

    half = window // 2
    result = []

    for i in range(n):
        start = max(0, i - half)
        end = min(n, i + half + 1)
        window_vals = values[start:end]
        result.append(median(window_vals))

    return result


# ── Immobility mask ───────────────────────────────────────────────────────────────


def compute_immobility_mask(
    accel_samples: list[AccelSample],
    epoch_sec: int = DEFAULT_EPOCH_SEC,
    still_cut_g: float = STILL_CUT_G,
    move_cut_g: float = MOVE_CUT_G,
    z_angle_still_deg: float = Z_ANGLE_STILL_DEG,
) -> ImmobilityMask:
    """Compute per-second immobility mask from accel.

    Immobile = ENMO < still_cut AND z-angle < z_angle_still_deg.
    Uses rolling median of ENMO (5-second window) for robustness.
    """
    if not accel_samples:
        return ImmobilityMask(mask=[], ts_ms=[])

    # Compute ENMO per second
    enmo_vals = []
    ts_ms = []
    for sample in accel_samples:
        if sample.valid:
            enmo_vals.append(_enmo_from_accel(sample))
        else:
            enmo_vals.append(float('nan'))
        ts_ms.append(sample.ts_ms)

    # Rolling median of ENMO (5-second window = 5 samples at 1 Hz)
    enmo_median = _rolling_median(enmo_vals, 5)

    # Compute z-angle
    z_angle = compute_z_angle(accel_samples)
    z_angle_vals = z_angle.z_angle_deg

    # Immobility: ENMO median < still_cut AND z-angle < z_angle_still_deg
    mask = []
    for i in range(len(enmo_median)):
        if math.isnan(enmo_median[i]) or math.isnan(z_angle_vals[i]):
            mask.append(0)
        else:
            immobile = (enmo_median[i] < still_cut_g) and (z_angle_vals[i] < z_angle_still_deg)
            mask.append(1 if immobile else 0)

    return ImmobilityMask(mask=mask, ts_ms=ts_ms)


# ── van Hees sleep window detection ───────────────────────────────────────────────


def _find_immobile_bouts(
    immobility: ImmobilityMask,
    min_bout_sec: int = 300,  # 5 minutes
    max_gap_sec: int = 60,    # 1 minute
) -> list[tuple[float, float]]:
    """Find contiguous immobile bouts from mask.

    Returns list of (start_s, end_s) in seconds since epoch.
    """
    if immobility.is_empty:
        return []

    bouts = []
    in_bout = False
    bout_start = 0.0

    for i, (m, ts) in enumerate(zip(immobility.mask, immobility.ts_ms, strict=False)):
        t_s = ts / 1000.0
        if m == 1 and not in_bout:
            in_bout = True
            bout_start = t_s
        elif m == 0 and in_bout:
            # Check gap to next immobile
            gap = float('inf')  # Default: no next immobile = infinite gap
            for j in range(i + 1, len(immobility.mask)):
                if immobility.mask[j] == 1:
                    gap = (immobility.ts_ms[j] - ts) / 1000.0
                    break
            if gap > max_gap_sec:
                in_bout = False
                bout_end = t_s
                if bout_end - bout_start >= min_bout_sec:
                    bouts.append((bout_start, bout_end))

    # Handle bout extending to end
    if in_bout:
        bout_end = immobility.ts_ms[-1] / 1000.0
        if bout_end - bout_start >= min_bout_sec:
            bouts.append((bout_start, bout_end))

    return bouts


def _merge_windows(
    windows: list[SleepWindow],
    max_gap_min: int = VAN_HEES_MERGE_GAP_MIN,
) -> list[SleepWindow]:
    """Merge sleep windows separated by less than max_gap_min minutes."""
    if not windows:
        return []

    merged = [windows[0]]
    for w in windows[1:]:
        last = merged[-1]
        gap_min = (w.start_s - last.end_s) / 60.0
        if gap_min <= max_gap_min:
            merged[-1] = SleepWindow(start_s=last.start_s, end_s=w.end_s)
        else:
            merged.append(w)
    return merged


def van_hees_sleep_window(
    accel_samples: list[AccelSample],
    in_bed_start_s: float,
    in_bed_end_s: float,
    epoch_sec: int = DEFAULT_EPOCH_SEC,
    min_window_min: int = VAN_HEES_MIN_WINDOW_MIN,
    still_cut_g: float = STILL_CUT_G,
    move_cut_g: float = MOVE_CUT_G,
    z_angle_still_deg: float = Z_ANGLE_STILL_DEG,
) -> list[SleepWindow]:
    """van Hees sleep window detection from accel.

    1. Compute immobility mask
    2. Find immobile bouts ≥ 5 min
    3. Merge bouts with gaps ≤ 30 min
    4. Keep windows ≥ min_window_min minutes
    5. Intersect with in-bed window
    """
    if not accel_samples:
        return []

    # Compute immobility mask for full in-bed period
    immobility = compute_immobility_mask(
        accel_samples,
        epoch_sec=epoch_sec,
        still_cut_g=still_cut_g,
        move_cut_g=move_cut_g,
        z_angle_still_deg=z_angle_still_deg,
    )

    # Find immobile bouts
    bouts = _find_immobile_bouts(immobility, min_bout_sec=5 * 60, max_gap_sec=60)

    # Convert to SleepWindow and merge
    windows = [SleepWindow(start_s=s, end_s=e) for s, e in bouts]
    windows = _merge_windows(windows, max_gap_min=VAN_HEES_MERGE_GAP_MIN)

    # Filter by minimum duration and intersect with in-bed
    result = []
    for w in windows:
        # Intersect with in-bed
        start = max(w.start_s, in_bed_start_s)
        end = min(w.end_s, in_bed_end_s)
        if end - start >= min_window_min * 60:
            result.append(SleepWindow(start_s=start, end_s=end))

    return result


# ── HRV features per epoch ───────────────────────────────────────────────────────


def _compute_rmssd(rr_ms: list[float]) -> float | None:
    """Compute RMSSD from RR intervals (ms)."""
    if len(rr_ms) < 2:
        return None
    diffs = [rr_ms[i + 1] - rr_ms[i] for i in range(len(rr_ms) - 1)]
    sq_diffs = [d * d for d in diffs]
    return math.sqrt(sum(sq_diffs) / len(sq_diffs))


# Cached frequency grid for LF/HF computation
_LFHF_FREQS = np.arange(0.01, 0.51, 0.02)  # Coarser grid: 25 points instead of 49


def _compute_lfhf(rr_series: RrSeries) -> float | None:
    """Compute LF/HF ratio using Lomb-Scargle periodogram on RR series.

    Uses beat times (not 1 Hz interpolated) for accuracy with uneven sampling.
    Optimized with coarser frequency grid for speed.
    """
    if rr_series.length < 10:
        return None

    # Get beat times in seconds
    beat_times_s = [t / 1000.0 for t in rr_series.beat_times_ms(0.0)]

    # Quick check: if RR intervals are very regular (low variability), LF/HF is not meaningful
    rr_cv = np.std(rr_series.rr_ms) / np.mean(rr_series.rr_ms) if np.mean(rr_series.rr_ms) > 0 else 0
    if rr_cv < 0.01:  # Very regular RR (like test fixture)
        return None

    # Lomb-Scargle power with cached coarser frequency grid
    try:
        ls_result = lomb_scargle(beat_times_s, rr_series.rr_ms, _LFHF_FREQS)
        if ls_result is None:
            return None
        power = np.array([pt.psd for pt in ls_result.spectrum])
    except Exception:
        return None

    freqs = _LFHF_FREQS

    # Integrate power in LF and HF bands
    lf_mask = (freqs >= LF_BAND[0]) & (freqs < LF_BAND[1])
    hf_mask = (freqs >= HF_BAND[0]) & (freqs < HF_BAND[1])

    lf_power = np.trapz(power[lf_mask], freqs[lf_mask]) if np.any(lf_mask) else 0.0
    hf_power = np.trapz(power[hf_mask], freqs[hf_mask]) if np.any(hf_mask) else 0.0

    if hf_power <= 0:
        return None

    return float(lf_power / hf_power)


def _compute_rk(rr_ms: list[float]) -> float | None:
    """Compute RK = median |ΔIHR| (bpm) — instantaneous HR variability.

    IHR = 60000 / RR (bpm). ΔIHR = diff(IHR).
    """
    if len(rr_ms) < 3:
        return None

    ihr = [60000.0 / rr for rr in rr_ms if rr > 0]
    if len(ihr) < 2:
        return None

    diffs = [abs(ihr[i + 1] - ihr[i]) for i in range(len(ihr) - 1)]
    return median(diffs) if diffs else None


# ── cardioStager: per-epoch feature extraction ────────────────────────────────────


def cardio_stager(
    session: SleepSession,
    epoch_sec: int = DEFAULT_EPOCH_SEC,
    profile: SleepUserProfile | None = None,
) -> list[CardioEpochFeatures]:
    """Extract per-epoch cardio features for sleep staging.

    Computes motion (ENMO), HR, HRV (RMSSD, LF/HF, RK) per epoch.
    """
    if not session.accel:
        return []

    # Determine in-bed bounds
    in_bed_start = session.in_bed_start_s
    in_bed_end = session.in_bed_end_s

    # Generate epoch boundaries
    epochs = _epoch_bounds(in_bed_start, in_bed_end, epoch_sec)

    # Use profile if provided, else session profile
    effective_profile = profile or session.profile

    # Determine personal thresholds (with fallbacks to population defaults)
    still_cut = effective_profile.enmo_still_cut if effective_profile and effective_profile.enmo_still_cut else STILL_CUT_G

    # Compute z-angle once for all epochs
    z_angle = compute_z_angle(session.accel)

    results = []

    for epoch_start, epoch_end in epochs:
        # Filter accel samples in this epoch
        epoch_accel = _filter_samples_in_epoch(session.accel, epoch_start, epoch_end)
        epoch_hr = _filter_samples_in_epoch(session.hr, epoch_start, epoch_end)
        epoch_rr = _filter_samples_in_epoch(session.rr, epoch_start, epoch_end)

        # ---- Motion features ----
        enmo_vals = [_enmo_from_accel(a) for a in epoch_accel if a.valid]
        enmo_median = median(enmo_vals) if enmo_vals else 0.0
        enmo_p95 = percentile(enmo_vals, 95) if enmo_vals else 0.0

        # Still fraction using rolling median (5s window)
        if len(enmo_vals) >= 5:
            enmo_roll_med = _rolling_median(enmo_vals, 5)
            still_frac = sum(1 for v in enmo_roll_med if v < still_cut) / len(enmo_roll_med)
        else:
            still_frac = 1.0 if enmo_median < still_cut else 0.0

        # ---- HR features ----
        valid_hr = [h.hr for h in epoch_hr if h.valid]
        valid_hr_frac = len(valid_hr) / max(1, len(epoch_hr)) if epoch_hr else 0.0

        hr_median = median(valid_hr) if valid_hr else None
        hr_p5 = percentile(valid_hr, 5) if valid_hr else None
        hr_p25 = percentile(valid_hr, 25) if valid_hr else None

        # ---- HRV features ----
        # Collect all RR intervals in this epoch
        epoch_rr_ms = []
        for rr_series in epoch_rr:
            # Filter RR by timestamp (ts_ms is end of interval)
            for ts, rr in zip(rr_series.ts_ms, rr_series.rr_ms, strict=False):
                if epoch_start * 1000 <= ts < epoch_end * 1000:
                    epoch_rr_ms.append(rr)

        valid_rr_frac = len(epoch_rr_ms) / max(1, sum(r.length for r in epoch_rr)) if epoch_rr else 0.0

        rmssd = _compute_rmssd(epoch_rr_ms) if len(epoch_rr_ms) >= 2 else None

        # LF/HF from combined RR series in epoch
        if epoch_rr:
            combined_rr = RrSeries(
                ts_ms=[ts for r in epoch_rr for ts in r.ts_ms if epoch_start * 1000 <= ts < epoch_end * 1000],
                rr_ms=epoch_rr_ms,
            )
            lfhf = _compute_lfhf(combined_rr) if combined_rr.length >= 10 else None
        else:
            lfhf = None

        # RK (|ΔIHR| median)
        rk = _compute_rk(epoch_rr_ms) if len(epoch_rr_ms) >= 3 else None

        # ---- Immobility fraction ----
        # Use z-angle for this epoch
        epoch_z = _filter_samples_in_epoch(
            [type('Z', (), {'z_angle_deg': za, 'ts_ms': ts}) for za, ts in zip(z_angle.z_angle_deg, z_angle.ts_ms, strict=False)],
            epoch_start,
            epoch_end,
            ts_field='ts_ms',
        )
        z_vals = [z.z_angle_deg for z in epoch_z if not math.isnan(z.z_angle_deg)]
        enmo_vals_z = [_enmo_from_accel(a) for a in epoch_accel if a.valid]
        enmo_roll_med = _rolling_median(enmo_vals_z, 5) if len(enmo_vals_z) >= 5 else enmo_vals_z

        immobile_count = 0
        total = min(len(enmo_roll_med), len(z_vals))
        for i in range(total):
            if enmo_roll_med[i] < still_cut and z_vals[i] < Z_ANGLE_STILL_DEG:
                immobile_count += 1
        immobile_frac = immobile_count / total if total > 0 else 0.0

        results.append(CardioEpochFeatures(
            epoch_start_s=epoch_start,
            enmo_median=enmo_median,
            enmo_p95=enmo_p95,
            still_frac=still_frac,
            hr_median=hr_median,
            hr_p5=hr_p5,
            hr_p25=hr_p25,
            rmssd=rmssd,
            lfhf=lfhf,
            rk=rk,
            valid_hr_frac=valid_hr_frac,
            valid_rr_frac=valid_rr_frac,
            immobile_frac=immobile_frac,
        ))

    return results


# ── classifyCardioEpochs: decision layer ──────────────────────────────────────────


@dataclass
class _EpochScores:
    """Internal scores for one epoch."""
    immobile: float
    hr: float
    hrv: float
    rk: float
    valid: bool


def _collect_valid_features(
    features: list[CardioEpochFeatures],
    min_hr_frac: float = MIN_VALID_HR_FRAC,
    min_rr_frac: float = MIN_VALID_RR_FRAC,
) -> tuple[list[int], list[CardioEpochFeatures]]:
    """Return indices and features that have sufficient valid data."""
    valid_idx = []
    valid_feat = []
    for i, f in enumerate(features):
        if f.valid_hr_frac >= min_hr_frac and f.valid_rr_frac >= min_rr_frac:
            valid_idx.append(i)
            valid_feat.append(f)
    return valid_idx, valid_feat


def _robust_z_scores(values: list[float], clip: float = ROBUST_Z_CLIP) -> list[float]:
    """Compute robust z-scores (median/MAD) with clipping.

    Uses util.mad() which already returns scaled MAD (×1.4826).
    """
    if not values:
        return []

    med = median(values)
    mad_val = mad(values)  # Already scaled by 1.4826

    if mad_val == 0:
        return [0.0] * len(values)

    scores = [(v - med) / mad_val for v in values]
    # Clip
    return [max(-clip, min(clip, s)) for s in scores]


def _compute_epoch_scores(
    features: list[CardioEpochFeatures],
    profile: SleepUserProfile | None = None,
) -> list[_EpochScores]:
    """Compute robust z-scores for each feature dimension.

    Returns list aligned with input features (None for invalid epochs).
    """
    n = len(features)
    scores = [_EpochScores(0, 0, 0, 0, False)] * n

    # Get valid epochs for robust statistics
    valid_idx, valid_feat = _collect_valid_features(features)
    if not valid_feat:
        return scores

    # ---- Immobile score: higher = more immobile = more likely sleep ----
    immobile_vals = [f.immobile_frac for f in valid_feat]
    immobile_z = _robust_z_scores(immobile_vals)
    # Higher immobile_frac -> more positive z -> more sleep-like (keep as is)

    # ---- HR score: lower HR = more sleep-like ----
    hr_vals = [f.hr_median for f in valid_feat if f.hr_median is not None]
    hr_idx = [i for i, f in zip(valid_idx, valid_feat, strict=False) if f.hr_median is not None]
    if hr_vals:
        hr_z = _robust_z_scores(hr_vals)
        # Lower HR -> more negative z -> more sleep-like; negate
        hr_z = [-z for z in hr_z]
    else:
        hr_z = [0.0] * len(valid_idx)
        hr_idx = valid_idx

    # ---- HRV score: higher RMSSD = more sleep-like (parasympathetic) ----
    hrv_vals = [f.rmssd for f in valid_feat if f.rmssd is not None]
    hrv_idx = [i for i, f in zip(valid_idx, valid_feat, strict=False) if f.rmssd is not None]
    if hrv_vals:
        hrv_z = _robust_z_scores(hrv_vals)
        # Higher RMSSD -> more positive z -> more sleep-like (keep as is)
    else:
        hrv_z = [0.0] * len(valid_idx)
        hrv_idx = valid_idx

    # ---- RK score: lower |ΔIHR| = more stable = more sleep-like ----
    rk_vals = [f.rk for f in valid_feat if f.rk is not None]
    rk_idx = [i for i, f in zip(valid_idx, valid_feat, strict=False) if f.rk is not None]
    if rk_vals:
        rk_z = _robust_z_scores(rk_vals)
        # Lower RK -> more negative z -> more sleep-like; negate
        rk_z = [-z for z in rk_z]
    else:
        rk_z = [0.0] * len(valid_idx)
        rk_idx = valid_idx

    # Assign back to full array
    for idx, z in zip(hr_idx, hr_z, strict=False):
        scores[idx] = _EpochScores(
            immobile=scores[idx].immobile,
            hr=z,
            hrv=scores[idx].hrv,
            rk=scores[idx].rk,
            valid=True,
        )
    for idx, z in zip(hrv_idx, hrv_z, strict=False):
        scores[idx] = _EpochScores(
            immobile=scores[idx].immobile,
            hr=scores[idx].hr,
            hrv=z,
            rk=scores[idx].rk,
            valid=True,
        )
    for idx, z in zip(rk_idx, rk_z, strict=False):
        scores[idx] = _EpochScores(
            immobile=scores[idx].immobile,
            hr=scores[idx].hr,
            hrv=scores[idx].hrv,
            rk=z,
            valid=True,
        )
    for idx, z in zip(valid_idx, immobile_z, strict=False):
        scores[idx] = _EpochScores(
            immobile=z,
            hr=scores[idx].hr,
            hrv=scores[idx].hrv,
            rk=scores[idx].rk,
            valid=True,
        )

    return scores


def _composite_score(s: _EpochScores) -> float:
    """Weighted composite score from dimension z-scores."""
    return (
        WEIGHT_IMMOBILE * s.immobile +
        WEIGHT_HR * s.hr +
        WEIGHT_HRV * s.hrv +
        WEIGHT_RK * s.rk
    )


def _hmm_smooth(
    stages: list[int],
    scores: list[float],
    min_nrem_run: int = 3,
    min_rem_run: int = 2,
) -> list[int]:
    """Simple HMM-like smoothing: enforce minimum run lengths.

    This is a simplified version of the Dart implementation's HMM.
    """
    if not stages:
        return stages

    result = stages.copy()
    n = len(result)

    # Enforce minimum NREM run
    i = 0
    while i < n:
        if result[i] == 1:  # NREM
            run_start = i
            while i < n and result[i] == 1:
                i += 1
            run_len = i - run_start
            if run_len < min_nrem_run:
                # Too short: relabel to wake
                for j in range(run_start, i):
                    result[j] = 0
        else:
            i += 1

    # Enforce minimum REM run
    i = 0
    while i < n:
        if result[i] == 2:  # REM
            run_start = i
            while i < n and result[i] == 2:
                i += 1
            run_len = i - run_start
            if run_len < min_rem_run:
                # Too short: relabel to NREM (most likely)
                for j in range(run_start, i):
                    result[j] = 1
        else:
            i += 1

    return result


def classify_cardio_epochs(
    features: list[CardioEpochFeatures],
    sleep_windows: list[SleepWindow],
    profile: SleepUserProfile | None = None,
    epoch_sec: int = DEFAULT_EPOCH_SEC,
) -> tuple[list[int], list[bool], float]:
    """Classify each epoch as Wake/NREM/REM using weighted robust-z decision layer.

    Returns:
        stages: list of 0=Wake, 1=NREM, 2=REM
        deep_flag: list of bool (meaningful only for NREM epochs)
        confidence: overall confidence 0..1
    """
    if not features:
        return [], [], 0.0

    n = len(features)
    scores_list = _compute_epoch_scores(features, profile)

    # Compute composite scores
    composite = [_composite_score(s) for s in scores_list]

    # Thresholds based on population percentiles (robust)
    # Sleep vs Wake: composite > 0 favors sleep
    # NREM vs REM: HRV higher + RK lower favors NREM

    stages = []
    deep_flags = []

    for i in range(n):
        f = features[i]
        s = scores_list[i]
        c = composite[i]

        # Determine if epoch falls in a sleep window
        in_sleep_window = any(
            w.start_s <= f.epoch_start_s < w.end_s
            for w in sleep_windows
        )

        if not s.valid or not in_sleep_window:
            # Not enough data or outside sleep window -> Wake
            stages.append(0)
            deep_flags.append(False)
            continue

        # Initial classification
        if c > 0.5:
            # Strong sleep signal
            # NREM vs REM: high HRV (rmssd) + low RK -> NREM
            # REM: lower HRV, higher HR variability
            if f.rmssd is not None and f.rk is not None:
                # Use HRV and RK to discriminate
                # High HRV + low RK = NREM (deep)
                # Lower HRV + higher RK = REM
                hrv_z = s.hrv
                rk_z = s.rk

                if hrv_z > 0 and rk_z > 0:
                    stages.append(1)  # NREM
                    deep_flags.append(hrv_z > 1.0)  # Deep if very high HRV
                elif hrv_z < 0 and rk_z < 0:
                    stages.append(2)  # REM
                    deep_flags.append(False)
                else:
                    # Ambiguous: use composite
                    if c > 1.0:
                        stages.append(1)
                        deep_flags.append(False)
                    else:
                        stages.append(2)
                        deep_flags.append(False)
            else:
                # Fallback: composite only
                if c > 1.0:
                    stages.append(1)
                    deep_flags.append(False)
                else:
                    stages.append(2)
                    deep_flags.append(False)
        elif c > -0.5:
            # Weak sleep signal -> light sleep / NREM
            stages.append(1)
            deep_flags.append(False)
        else:
            # Wake
            stages.append(0)
            deep_flags.append(False)

    # Smooth with minimum run lengths
    stages = _hmm_smooth(stages, composite)

    # Ensure deep_flags only on NREM
    for i in range(n):
        if stages[i] != 1:
            deep_flags[i] = False

    # Confidence: fraction of epochs with valid data in sleep windows
    valid_in_window = sum(
        1 for i, f in enumerate(features)
        if scores_list[i].valid and any(w.start_s <= f.epoch_start_s < w.end_s for w in sleep_windows)
    )
    total_in_window = sum(
        1 for f in features
        if any(w.start_s <= f.epoch_start_s < w.end_s for w in sleep_windows)
    )
    confidence = valid_in_window / total_in_window if total_in_window > 0 else 0.0

    return stages, deep_flags, confidence


# ── segmentSleep: main entry point ────────────────────────────────────────────────


def segment_sleep(
    session: SleepSession,
    config: AdvancedSleepStager | None = None,
) -> SleepSegmentation:
    """Single entry point for sleep segmentation (mirrors Dart segmentSleep).

    Pipeline:
    1. van Hees sleep window detection from accel
    2. cardioStager: per-epoch feature extraction
    3. classifyCardioEpochs: weighted robust-z decision layer
    4. Build SleepSegmentation with accounting
    """
    cfg = config or AdvancedSleepStager()

    # 1. Sleep window detection
    sleep_windows = van_hees_sleep_window(
        session.accel,
        session.in_bed_start_s,
        session.in_bed_end_s,
        epoch_sec=cfg.epoch_sec,
        min_window_min=cfg.min_sleep_window_min,
        still_cut_g=cfg.still_cut_g,
        move_cut_g=cfg.move_cut_g,
        z_angle_still_deg=cfg.z_angle_still_deg,
    )

    # 2. Per-epoch features
    features = cardio_stager(
        session,
        epoch_sec=cfg.epoch_sec,
        profile=session.profile,
    )

    # 3. Classification
    stages, deep_flags, confidence = classify_cardio_epochs(
        features,
        sleep_windows,
        profile=session.profile,
        epoch_sec=cfg.epoch_sec,
    )

    # 4. Determine sleep onset/offset from staged epochs
    sleep_onset_s = None
    sleep_offset_s = None

    # Find first/last sleep epoch (NREM or REM)
    for _i, (stage, feat) in enumerate(zip(stages, features, strict=False)):
        if stage in (1, 2):  # NREM or REM
            if sleep_onset_s is None:
                sleep_onset_s = feat.epoch_start_s
            sleep_offset_s = feat.epoch_start_s + cfg.epoch_sec

    # 5. Count unobserved seconds (off-skin / no data)
    unobserved_sec = 0
    for feat in features:
        if feat.valid_hr_frac < MIN_VALID_HR_FRAC and feat.valid_rr_frac < MIN_VALID_RR_FRAC:
            unobserved_sec += cfg.epoch_sec

    return SleepSegmentation(
        stages=stages,
        deep_flag=deep_flags,
        epoch_sec=cfg.epoch_sec,
        in_bed_start_s=session.in_bed_start_s,
        in_bed_end_s=session.in_bed_end_s,
        sleep_onset_s=sleep_onset_s,
        sleep_offset_s=sleep_offset_s,
        unobserved_sec=unobserved_sec,
        confidence=confidence,
    )


# ── SleepNightObservation extraction for profile folding ─────────────────────────


def extract_nightly_observation(
    segmentation: SleepSegmentation,
    features: list[CardioEpochFeatures],
) -> SleepNightObservation | None:
    """Extract nightly features for SleepUserProfile folding.

    Only uses epochs classified as sleep (NREM/REM).
    """
    if not features or not segmentation.stages:
        return None

    # Collect sleep epochs
    sleep_hr = []
    sleep_rmssd = []
    sleep_enmo = []
    sleep_lfhf = []
    sleep_rk = []

    for stage, feat in zip(segmentation.stages, features, strict=False):
        if stage in (1, 2):  # NREM or REM
            if feat.hr_median is not None:
                sleep_hr.append(feat.hr_median)
            if feat.rmssd is not None:
                sleep_rmssd.append(feat.rmssd)
            if feat.enmo_median is not None:
                sleep_enmo.append(feat.enmo_median)
            if feat.lfhf is not None:
                sleep_lfhf.append(feat.lfhf)
            if feat.rk is not None:
                sleep_rk.append(feat.rk)

    if not sleep_hr:
        return None

    # Compute percentiles
    hr_sorted = sorted(sleep_hr)
    hr_floor_p5 = percentile(hr_sorted, 5)
    hr_floor_p25 = percentile(hr_sorted, 25)
    hr_sleep_median = median(hr_sorted)

    # Arousal threshold: 75th percentile of sleep HR
    hr_arousal = percentile(hr_sorted, 75) if len(hr_sorted) >= 4 else hr_sleep_median

    # RMSSD stats
    rmssd_med = median(sleep_rmssd) if sleep_rmssd else None
    rmssd_mad = mad(sleep_rmssd) if sleep_rmssd else None

    # ENMO cuts from sleep epochs
    enmo_still_cut = percentile(sleep_enmo, 10) if sleep_enmo else None
    enmo_move_cut = percentile(sleep_enmo, 90) if sleep_enmo else None

    # LF/HF and RK
    lfhf_med = median(sleep_lfhf) if sleep_lfhf else None
    rk_med = median(sleep_rk) if sleep_rk else None

    return SleepNightObservation(
        hr_floor_p5=hr_floor_p5,
        hr_floor_p25=hr_floor_p25,
        hr_sleep_median=hr_sleep_median,
        hr_arousal=hr_arousal,
        rmssd_med=rmssd_med,
        rmssd_mad=rmssd_mad,
        enmo_still_cut=enmo_still_cut,
        enmo_move_cut=enmo_move_cut,
        lfhf_med=lfhf_med,
        rk_med=rk_med,
        updated_at_ms=int(segmentation.in_bed_end_s * 1000),
    )


# ── High-level API ────────────────────────────────────────────────────────────────


def stage_sleep(
    session: SleepSession,
    config: AdvancedSleepStager | None = None,
) -> CardioStagerResult:
    """High-level sleep staging returning CardioStagerResult.

    Convenience wrapper: segment_sleep + to_cardio_result.
    """

    segmentation = segment_sleep(session, config)
    return segmentation.to_cardio_result()


# Export all public functions
__all__ = [
    # Types (re-exported from models)
    "SleepWindow",
    "ImmobilityMask",
    "ZAngle",
    "SleepSession",
    "CardioEpochFeatures",
    "SleepSegmentation",
    "AdvancedSleepStager",
    # Core functions
    "compute_z_angle",
    "compute_immobility_mask",
    "van_hees_sleep_window",
    "cardio_stager",
    "classify_cardio_epochs",
    "segment_sleep",
    "extract_nightly_observation",
    "stage_sleep",
    # Constants
    "DEFAULT_EPOCH_SEC",
    "STILL_CUT_G",
    "MOVE_CUT_G",
    "Z_ANGLE_STILL_DEG",
]
