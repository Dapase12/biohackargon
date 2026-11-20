"""Tests for sleep_stager module.

Mirrors Dart test coverage for:
- zAngle computation
- Immobility mask
- van Hees sleep window detection
- cardioStager feature extraction
- classifyCardioEpochs decision layer
- segmentSleep end-to-end
"""

from __future__ import annotations

import math
import time
from typing import Any

import pytest

from argon_algorithms.models import (
    AccelSample,
    AdvancedSleepStager,
    CardioEpochFeatures,
    HrSample,
    RrSeries,
    SleepSession,
    SleepStage,
    SleepUserProfile,
    SleepWindow,
)
from argon_algorithms.sleep_stager import (
    DEFAULT_EPOCH_SEC,
    STILL_CUT_G,
    MOVE_CUT_G,
    Z_ANGLE_STILL_DEG,
    _compute_epoch_scores,
    _compute_lfhf,
    _compute_rmssd,
    _compute_rk,
    _enmo_from_accel,
    _epoch_bounds,
    _filter_samples_in_epoch,
    _hmm_smooth,
    _robust_z_scores,
    _rolling_median,
    cardio_stager,
    classify_cardio_epochs,
    compute_immobility_mask,
    compute_z_angle,
    extract_nightly_observation,
    segment_sleep,
    stage_sleep,
    van_hees_sleep_window,
)
from argon_algorithms.util import median, percentile, round6


# ── Test fixtures ─────────────────────────────────────────────────────────────────


def _make_accel_sample(ts_s: float, x: float, y: float, z: float, valid: bool = True) -> AccelSample:
    return AccelSample(ts_ms=ts_s * 1000, x=x, y=y, z=z, valid=valid)


def _make_hr_sample(ts_s: float, hr: float) -> HrSample:
    return HrSample(ts_ms=ts_s * 1000, hr=hr)


def _make_rr_series(start_s: float, rr_ms: list[float]) -> RrSeries:
    ts_ms = []
    t = start_s * 1000
    for rr in rr_ms:
        t += rr
        ts_ms.append(t)
    return RrSeries(ts_ms=ts_ms, rr_ms=rr_ms)


def _make_sleep_session(
    duration_hours: float = 8.0,
    hr: float = 55,
    accel_noise: float = 0.0,
    include_rr: bool = True,
    epoch_sec: int = DEFAULT_EPOCH_SEC,
) -> SleepSession:
    """Create a synthetic sleep session for testing."""
    now = time.time()
    # Align in_bed_start to epoch grid to avoid extra epochs
    in_bed_start = (int(now - duration_hours * 3600) // epoch_sec) * epoch_sec
    in_bed_end = in_bed_start + int(duration_hours * 3600)

    accel = []
    hr_samples = []
    rr_series = []

    # Generate 1 Hz data
    for i in range(int(duration_hours * 3600)):
        ts = in_bed_start + i

        # Accel: mostly still (gravity vector ~ [0, 0, 1]) with small noise
        if accel_noise > 0:
            import random
            x = random.uniform(-accel_noise, accel_noise)
            y = random.uniform(-accel_noise, accel_noise)
            z = 1.0 + random.uniform(-accel_noise, accel_noise)
        else:
            x, y, z = 0.0, 0.0, 1.0

        accel.append(_make_accel_sample(ts, x, y, z))

        # HR: stable during sleep
        hr_samples.append(_make_hr_sample(ts, hr))

        # RR: ~1000ms intervals (60 bpm)
        if include_rr and i % 2 == 0:  # ~0.5 Hz RR
            rr_series.append(_make_rr_series(ts, [1000.0, 1010.0, 990.0, 1005.0]))

    return SleepSession(
        accel=accel,
        hr=hr_samples,
        rr=rr_series,
        in_bed_start_s=in_bed_start,
        in_bed_end_s=in_bed_end,
    )


# ── Tests for zAngle ──────────────────────────────────────────────────────────────


def test_z_angle_flat():
    """Flat position (z=1) -> z-angle = 0°."""
    samples = [_make_accel_sample(0, 0, 0, 1)]
    result = compute_z_angle(samples)
    assert len(result.z_angle_deg) == 1
    assert abs(result.z_angle_deg[0] - 0.0) < 1e-6


def test_z_angle_vertical():
    """Vertical position (x=1) -> z-angle = 90°."""
    samples = [_make_accel_sample(0, 1, 0, 0)]
    result = compute_z_angle(samples)
    assert abs(result.z_angle_deg[0] - 90.0) < 1e-6


def test_z_angle_45_degrees():
    """45° tilt -> z-angle = 45°."""
    samples = [_make_accel_sample(0, 0.7071, 0, 0.7071)]
    result = compute_z_angle(samples)
    assert abs(result.z_angle_deg[0] - 45.0) < 1.0


def test_z_angle_invalid_sample():
    """Invalid samples produce NaN."""
    samples = [_make_accel_sample(0, 0, 0, 1, valid=False)]
    result = compute_z_angle(samples)
    assert math.isnan(result.z_angle_deg[0])


def test_z_angle_empty():
    """Empty input returns empty result."""
    result = compute_z_angle([])
    assert result.length == 0


def test_z_angle_multiple():
    """Multiple samples."""
    samples = [
        _make_accel_sample(0, 0, 0, 1),    # 0°
        _make_accel_sample(1, 1, 0, 0),    # 90°
        _make_accel_sample(2, 0, 1, 0),    # 90°
    ]
    result = compute_z_angle(samples)
    assert len(result.z_angle_deg) == 3
    assert abs(result.z_angle_deg[0] - 0.0) < 1e-6
    assert abs(result.z_angle_deg[1] - 90.0) < 1e-6
    assert abs(result.z_angle_deg[2] - 90.0) < 1e-6


# ── Tests for rolling median ─────────────────────────────────────────────────────


def test_rolling_median_basic():
    """Rolling median with window=3."""
    values = [1, 2, 3, 4, 5]
    result = _rolling_median(values, 3)
    # At edges: [1,2] -> 1.5, [1,2,3] -> 2, [2,3,4] -> 3, [3,4,5] -> 4, [4,5] -> 4.5
    expected = [1.5, 2.0, 3.0, 4.0, 4.5]
    for r, e in zip(result, expected):
        assert abs(r - e) < 1e-6


def test_rolling_median_window_1():
    """Window=1 returns original values."""
    values = [1, 5, 3, 7]
    result = _rolling_median(values, 1)
    assert result == values


def test_rolling_median_empty():
    """Empty input returns empty."""
    result = _rolling_median([], 3)
    assert result == []


def test_rolling_median_nan():
    """NaN handling."""
    values = [1.0, float('nan'), 3.0]
    result = _rolling_median(values, 3)
    # NaN propagates through median
    assert math.isnan(result[0]) or math.isnan(result[1])


# ── Tests for ENMO ───────────────────────────────────────────────────────────────


def test_enmo_static():
    """Static gravity vector -> ENMO = 0."""
    sample = _make_accel_sample(0, 0, 0, 1)
    enmo = _enmo_from_accel(sample)
    assert enmo == 0.0


def test_enmo_movement():
    """Movement -> ENMO > 0."""
    sample = _make_accel_sample(0, 0.1, 0.1, 1.0)
    enmo = _enmo_from_accel(sample)
    # |accel| = sqrt(0.01 + 0.01 + 1) ≈ 1.01, ENMO ≈ 0.01
    assert enmo > 0.0


def test_enmo_off_skin():
    """Off-skin (zero accel) -> ENMO = 0 (|accel|=0, max(0, -1) = 0)."""
    sample = _make_accel_sample(0, 0, 0, 0)
    enmo = _enmo_from_accel(sample)
    assert enmo == 0.0


# ── Tests for epoch bounds ───────────────────────────────────────────────────────


def test_epoch_bounds_basic():
    """Basic epoch boundary generation."""
    epochs = _epoch_bounds(0, 90, 30)
    assert len(epochs) == 3
    assert epochs[0] == (0, 30)
    assert epochs[1] == (30, 60)
    assert epochs[2] == (60, 90)


def test_epoch_bounds_unaligned():
    """Unaligned start/end."""
    epochs = _epoch_bounds(10, 100, 30)
    # First epoch aligned to 0
    assert epochs[0] == (0, 30)
    assert epochs[-1][1] <= 100


# ── Tests for sample filtering ───────────────────────────────────────────────────


def test_filter_samples_in_epoch():
    """Filter samples within epoch bounds."""
    samples = [
        _make_hr_sample(0, 60),
        _make_hr_sample(15, 65),
        _make_hr_sample(30, 70),
        _make_hr_sample(45, 75),
    ]
    filtered = _filter_samples_in_epoch(samples, 10, 40)
    assert len(filtered) == 2
    assert filtered[0].hr == 65
    assert filtered[1].hr == 70


# ── Tests for immobility mask ────────────────────────────────────────────────────


def test_immobility_mask_still():
    """Completely still -> all immobile."""
    # 10 seconds of perfectly still accel
    accel = [_make_accel_sample(i, 0, 0, 1) for i in range(10)]
    mask = compute_immobility_mask(accel)
    assert all(m == 1 for m in mask.mask)


def test_immobility_mask_movement():
    """Continuous movement -> none immobile."""
    accel = [_make_accel_sample(i, 0.2, 0.2, 1.0) for i in range(10)]
    mask = compute_immobility_mask(accel)
    assert all(m == 0 for m in mask.mask)


def test_immobility_mask_mixed():
    """Mixed still and movement."""
    accel = []
    for i in range(20):
        if i < 10:
            accel.append(_make_accel_sample(i, 0, 0, 1))  # still
        else:
            accel.append(_make_accel_sample(i, 0.2, 0.2, 1.0))  # movement
    mask = compute_immobility_mask(accel)
    assert sum(mask.mask[:10]) == 10  # first 10 immobile
    assert sum(mask.mask[10:]) == 0   # last 10 mobile


def test_immobility_mask_empty():
    """Empty input."""
    mask = compute_immobility_mask([])
    assert mask.is_empty


# ── Tests for van Hees sleep window ──────────────────────────────────────────────


def test_van_hees_sleep_window_basic():
    """Basic sleep window detection."""
    # 8 hours in bed, 6 hours of immobility
    now = time.time()
    in_bed_start = now - 8 * 3600
    in_bed_end = now

    # Create accel: first 1h awake (movement), then 6h sleep (still), then 1h awake
    accel = []
    for i in range(int(8 * 3600)):
        ts = in_bed_start + i
        if i < 3600 or i > 7 * 3600:
            # Awake: movement
            accel.append(_make_accel_sample(ts, 0.2, 0.2, 1.0))
        else:
            # Sleep: still
            accel.append(_make_accel_sample(ts, 0, 0, 1))

    windows = van_hees_sleep_window(accel, in_bed_start, in_bed_end)
    assert len(windows) >= 1
    # Should detect ~6 hour window
    total_sleep = sum(w.duration_s for w in windows)
    assert total_sleep > 5 * 3600  # at least 5 hours
    assert total_sleep < 7 * 3600  # less than 7 hours


def test_van_hees_short_window_rejected():
    """Windows shorter than min duration are rejected."""
    now = time.time()
    in_bed_start = now - 3600
    in_bed_end = now

    # Only 20 minutes of immobility (less than 30 min default)
    accel = []
    for i in range(3600):
        ts = in_bed_start + i
        if i < 1200:  # 20 min
            accel.append(_make_accel_sample(ts, 0, 0, 1))
        else:
            accel.append(_make_accel_sample(ts, 0.2, 0.2, 1.0))

    windows = van_hees_sleep_window(accel, in_bed_start, in_bed_end, min_window_min=30)
    assert len(windows) == 0


def test_van_hees_merge_gaps():
    """Windows separated by small gaps are merged."""
    now = time.time()
    in_bed_start = now - 7200
    in_bed_end = now

    # Two 20-min sleep bouts with 15-min gap (should merge with default 30-min merge)
    accel = []
    for i in range(7200):
        ts = in_bed_start + i
        if (600 <= i < 1800) or (2700 <= i < 3900):  # Two 20-min bouts, 15-min gap
            accel.append(_make_accel_sample(ts, 0, 0, 1))
        else:
            accel.append(_make_accel_sample(ts, 0.2, 0.2, 1.0))

    windows = van_hees_sleep_window(accel, in_bed_start, in_bed_end, min_window_min=15)
    assert len(windows) == 1
    assert windows[0].duration_s > 35 * 60  # merged ~40 min


# ── Tests for HRV features ───────────────────────────────────────────────────────


def test_compute_rmssd():
    """RMSSD computation."""
    rr = [1000.0, 1010.0, 990.0, 1005.0, 995.0]
    rmssd = _compute_rmssd(rr)
    # diffs: 10, -20, 15, -10
    # sq: 100, 400, 225, 100
    # mean: 206.25, sqrt: ~14.36
    assert rmssd is not None
    assert 13 < rmssd < 16


def test_compute_rmssd_insufficient():
    """RMSSD with insufficient data."""
    assert _compute_rmssd([1000.0]) is None
    assert _compute_rmssd([]) is None


def test_compute_rk():
    """RK = median |ΔIHR|."""
    rr = [1000.0, 1010.0, 990.0, 1005.0, 995.0]
    rk = _compute_rk(rr)
    # IHR: 60, 59.4, 60.6, 59.7, 60.3
    # diffs: -0.6, 1.2, -0.9, 0.6
    # abs: 0.6, 1.2, 0.9, 0.6
    # median: 0.75
    assert rk is not None
    assert 0.5 < rk < 1.5


def test_compute_rk_insufficient():
    """RK with insufficient data."""
    assert _compute_rk([1000.0, 1000.0]) is None
    assert _compute_rk([]) is None


# ── Tests for cardioStager ───────────────────────────────────────────────────────


def test_cardio_stager_basic():
    """Basic feature extraction."""
    session = _make_sleep_session(duration_hours=1.0, hr=55)
    features = cardio_stager(session, epoch_sec=30)

    assert len(features) == 120  # 3600s / 30s = 120 epochs

    for f in features:
        assert f.epoch_start_s >= session.in_bed_start_s
        assert f.epoch_start_s < session.in_bed_end_s
        assert f.enmo_median >= 0
        assert f.enmo_p95 >= f.enmo_median
        assert 0 <= f.still_frac <= 1
        assert 0 <= f.immobile_frac <= 1
        # With stable HR
        assert f.hr_median is not None
        assert 50 < f.hr_median < 60
        assert f.valid_hr_frac > 0.9


def test_cardio_stager_with_movement():
    """Feature extraction with movement periods."""
    session = _make_sleep_session(duration_hours=1.0, hr=60, accel_noise=0.1)
    features = cardio_stager(session, epoch_sec=30)

    assert len(features) == 120
    # Some epochs should have higher ENMO
    max_enmo = max(f.enmo_median for f in features)
    assert max_enmo > 0.03  # With 0.1 noise, ENMO median ~0.045


def test_cardio_stager_no_rr():
    """Feature extraction without RR data."""
    session = _make_sleep_session(duration_hours=1.0, hr=55, include_rr=False)
    features = cardio_stager(session, epoch_sec=30)

    for f in features:
        assert f.rmssd is None
        assert f.lfhf is None
        assert f.rk is None
        assert f.valid_rr_frac == 0.0


# ── Tests for robust z-scores ────────────────────────────────────────────────────


def test_robust_z_scores_basic():
    """Robust z-score computation."""
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    scores = _robust_z_scores(values)
    # median=3, mad=1.4826*1=1.4826
    # z = (x-3)/1.4826
    assert abs(scores[2]) < 0.1  # median -> 0
    assert scores[0] < -1.0
    assert scores[4] > 1.0


def test_robust_z_scores_clip():
    """Clipping at ROBUST_Z_CLIP."""
    values = [1.0] * 10 + [100.0]  # one huge outlier
    scores = _robust_z_scores(values, clip=3.0)
    assert all(abs(s) <= 3.0 for s in scores)


def test_robust_z_scores_constant():
    """Constant values -> all zeros."""
    values = [5.0] * 10
    scores = _robust_z_scores(values)
    assert all(s == 0.0 for s in scores)


def test_robust_z_scores_empty():
    """Empty input."""
    assert _robust_z_scores([]) == []


# ── Tests for epoch scoring ──────────────────────────────────────────────────────


def test_compute_epoch_scores():
    """Epoch score computation."""
    features = [
        CardioEpochFeatures(
            epoch_start_s=0,
            enmo_median=0.01,
            enmo_p95=0.02,
            still_frac=0.9,
            hr_median=55,
            hr_p5=50,
            hr_p25=53,
            rmssd=40,
            lfhf=1.5,
            rk=1.0,
            valid_hr_frac=1.0,
            valid_rr_frac=1.0,
            immobile_frac=0.85,
        ),
        CardioEpochFeatures(
            epoch_start_s=30,
            enmo_median=0.05,
            enmo_p95=0.1,
            still_frac=0.3,
            hr_median=75,
            hr_p5=70,
            hr_p25=72,
            rmssd=20,
            lfhf=3.0,
            rk=3.0,
            valid_hr_frac=1.0,
            valid_rr_frac=1.0,
            immobile_frac=0.2,
        ),
    ]
    scores = _compute_epoch_scores(features)

    assert len(scores) == 2
    # First epoch: more immobile, lower HR, higher RMSSD, lower RK -> positive scores
    assert scores[0].immobile > 0
    assert scores[0].hr > 0
    assert scores[0].hrv > 0
    assert scores[0].rk > 0
    assert scores[0].valid

    # Second epoch: less immobile, higher HR, lower RMSSD, higher RK -> negative scores
    assert scores[1].immobile < 0
    assert scores[1].hr < 0
    assert scores[1].hrv < 0
    assert scores[1].rk < 0
    assert scores[1].valid


def test_compute_epoch_scores_invalid():
    """Epochs with insufficient data marked invalid."""
    features = [
        CardioEpochFeatures(
            epoch_start_s=0,
            enmo_median=0.01,
            enmo_p95=0.02,
            still_frac=0.9,
            hr_median=None,  # No HR
            valid_hr_frac=0.0,
            valid_rr_frac=0.0,
            immobile_frac=0.85,
        ),
    ]
    scores = _compute_epoch_scores(features)
    assert not scores[0].valid


# ── Tests for HMM smoothing ──────────────────────────────────────────────────────


def test_hmm_smooth_short_nrem():
    """Short NREM runs relabeled to Wake."""
    stages = [0, 1, 1, 0, 1, 1, 1, 1, 0]  # Two NREM runs: 2 and 4 epochs
    scores = [0] * 9
    result = _hmm_smooth(stages, scores, min_nrem_run=3)
    # First run (2 epochs) -> Wake
    # Second run (4 epochs) -> stays NREM
    assert result == [0, 0, 0, 0, 1, 1, 1, 1, 0]


def test_hmm_smooth_short_rem():
    """Short REM runs relabeled to NREM."""
    stages = [1, 1, 2, 2, 1, 1, 1, 2, 2, 2, 1]
    scores = [0] * 11
    # Disable NREM smoothing (min_nrem_run=1) to test only REM smoothing
    result = _hmm_smooth(stages, scores, min_nrem_run=1, min_rem_run=3)
    # First REM run (2 epochs) -> NREM
    # Second REM run (3 epochs) -> stays REM
    # First NREM run (2 epochs) stays NREM because min_nrem_run=1
    assert result == [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 1]


# ── Tests for classifyCardioEpochs ───────────────────────────────────────────────


def test_classify_cardio_epochs_basic():
    """Basic classification."""
    # Create features for 2 hours: 1h wake, 1h sleep
    features = []
    for i in range(240):  # 240 * 30s = 2h
        if i < 120:
            # Wake: higher ENMO, higher HR, lower HRV
            f = CardioEpochFeatures(
                epoch_start_s=i * 30,
                enmo_median=0.05,
                enmo_p95=0.1,
                still_frac=0.3,
                hr_median=75,
                hr_p5=70,
                hr_p25=72,
                rmssd=20,
                lfhf=3.0,
                rk=3.0,
                valid_hr_frac=1.0,
                valid_rr_frac=1.0,
                immobile_frac=0.2,
            )
        else:
            # Sleep: lower ENMO, lower HR, higher HRV
            f = CardioEpochFeatures(
                epoch_start_s=i * 30,
                enmo_median=0.01,
                enmo_p95=0.02,
                still_frac=0.9,
                hr_median=55,
                hr_p5=50,
                hr_p25=53,
                rmssd=45,
                lfhf=1.5,
                rk=1.0,
                valid_hr_frac=1.0,
                valid_rr_frac=1.0,
                immobile_frac=0.85,
            )
        features.append(f)

    sleep_windows = [SleepWindow(start_s=120 * 30, end_s=240 * 30)]
    stages, deep_flags, confidence = classify_cardio_epochs(
        features, sleep_windows, epoch_sec=30
    )

    assert len(stages) == 240
    assert len(deep_flags) == 240
    # First half should be wake (0)
    assert all(s == 0 for s in stages[:120])
    # Second half should be sleep (1 or 2)
    assert all(s in (1, 2) for s in stages[120:])
    assert confidence > 0.5


def test_classify_cardio_epochs_outside_window():
    """Epochs outside sleep window classified as wake."""
    features = [
        CardioEpochFeatures(
            epoch_start_s=0,
            enmo_median=0.01,
            enmo_p95=0.02,
            still_frac=0.9,
            hr_median=55,
            rmssd=45,
            valid_hr_frac=1.0,
            valid_rr_frac=1.0,
            immobile_frac=0.85,
        ),
    ]
    sleep_windows = [SleepWindow(start_s=3600, end_s=7200)]  # Window starts later
    stages, deep_flags, confidence = classify_cardio_epochs(
        features, sleep_windows, epoch_sec=30
    )
    assert stages[0] == 0  # Wake
    assert deep_flags[0] is False


# ── Tests for segmentSleep ───────────────────────────────────────────────────────


def test_segment_sleep_basic():
    """End-to-end segmentation."""
    from argon_algorithms.models import SleepSegmentation
    session = _make_sleep_session(duration_hours=2.0, hr=55)
    config = AdvancedSleepStager(epoch_sec=30, min_sleep_window_min=30)
    result = segment_sleep(session, config)

    assert isinstance(result, SleepSegmentation)
    assert result.epoch_sec == 30
    assert len(result.stages) > 0
    assert len(result.deep_flag) == len(result.stages)
    assert result.in_bed_start_s == session.in_bed_start_s
    assert result.in_bed_end_s == session.in_bed_end_s
    assert 0 <= result.confidence <= 1.0


def test_segment_sleep_on_off():
    """Sleep onset/offset detection."""
    session = _make_sleep_session(duration_hours=2.0, hr=55)
    config = AdvancedSleepStager(epoch_sec=30)
    result = segment_sleep(session, config)

    # Should detect sleep period
    assert result.sleep_onset_s is not None
    assert result.sleep_offset_s is not None
    assert result.sleep_onset_s >= session.in_bed_start_s
    assert result.sleep_offset_s <= session.in_bed_end_s
    assert result.sleep_offset_s > result.sleep_onset_s


def test_segment_sleep_unobserved():
    """Unobserved seconds counting."""
    # Create session with some off-skin periods
    session = _make_sleep_session(duration_hours=2.0, hr=0)  # hr=0 = off-skin
    config = AdvancedSleepStager(epoch_sec=30)
    result = segment_sleep(session, config)

    assert result.unobserved_sec >= 0


# ── Tests for stageSleep (high-level API) ────────────────────────────────────────


def test_stage_sleep():
    """High-level API returns CardioStagerResult."""
    session = _make_sleep_session(duration_hours=1.0, hr=55)
    result = stage_sleep(session)

    from argon_algorithms.models import CardioStagerResult
    assert isinstance(result, CardioStagerResult)
    assert result.base.epoch_sec == 30
    assert len(result.base.stages) > 0
    assert len(result.deep_flag) == len(result.base.stages)
    assert 0 <= result.confidence <= 1.0


# ── Tests for extract_nightly_observation ────────────────────────────────────────


def test_extract_nightly_observation():
    """Extract observation for profile folding."""
    session = _make_sleep_session(duration_hours=2.0, hr=55)
    config = AdvancedSleepStager(epoch_sec=30)
    segmentation = segment_sleep(session, config)

    # Get features from cardio_stager
    features = cardio_stager(session, epoch_sec=30)

    observation = extract_nightly_observation(segmentation, features)

    assert observation is not None
    assert observation.hr_floor_p5 is not None
    assert observation.hr_floor_p25 is not None
    assert observation.hr_sleep_median is not None
    assert observation.hr_arousal is not None
    assert observation.rmssd_med is not None
    assert observation.rmssd_mad is not None
    assert observation.enmo_still_cut is not None
    assert observation.enmo_move_cut is not None
    # Check reasonable values
    assert 40 < observation.hr_sleep_median < 70
    # With constant HR, percentiles are equal (allow <=)
    assert observation.hr_floor_p5 <= observation.hr_floor_p25 <= observation.hr_sleep_median


def test_extract_nightly_observation_empty():
    """Empty segmentation returns None."""
    from argon_algorithms.models import SleepNightObservation, SleepSegmentation
    segmentation = SleepSegmentation(stages=[], deep_flag=[], epoch_sec=30)
    features = []
    observation = extract_nightly_observation(segmentation, features)
    assert observation is None


# ── Tests for SleepUserProfile folding ───────────────────────────────────────────


def test_profile_fold():
    """Profile folding with EWMA."""
    from argon_algorithms.models import SleepNightObservation

    # Start with empty profile
    profile = SleepUserProfile(nights=0)

    # Create observation
    obs = SleepNightObservation(
        hr_floor_p5=45.0,
        hr_floor_p25=50.0,
        hr_sleep_median=55.0,
        hr_arousal=65.0,
        rmssd_med=40.0,
        rmssd_mad=5.0,
        enmo_still_cut=0.01,
        enmo_move_cut=0.05,
        lfhf_med=2.0,
        rk_med=1.5,
        updated_at_ms=int(time.time() * 1000),
    )

    # Fold once (n2=1, a=max(1.0, 2/15)=1.0 -> takes observation value)
    profile2 = profile.fold(obs, horizon_nights=14)
    assert profile2.nights == 1
    assert profile2.hr_floor_p5 == 45.0
    assert profile2.hr_sleep_median == 55.0

    # Fold again with different value (n2=2, a=max(0.5, 2/15)=0.5 -> simple average)
    obs2 = SleepNightObservation(
        hr_floor_p5=48.0,
        hr_sleep_median=58.0,
        updated_at_ms=int(time.time() * 1000),
    )
    profile3 = profile2.fold(obs2, horizon_nights=14)
    assert profile3.nights == 2
    # EWMA with a=0.5: (45 + 48) / 2 = 46.5
    expected_p5 = (45.0 + 48.0) / 2
    assert abs(profile3.hr_floor_p5 - expected_p5) < 0.01
    expected_median = (55.0 + 58.0) / 2
    assert abs(profile3.hr_sleep_median - expected_median) < 0.01


def test_profile_personal_weight():
    """Personal weight grows with nights."""
    profile = SleepUserProfile(nights=0)
    assert profile.personal_weight == 0.0

    profile = SleepUserProfile(nights=7)
    assert abs(profile.personal_weight - 0.25) < 0.01  # 7/28 = 0.25

    profile = SleepUserProfile(nights=14)
    assert abs(profile.personal_weight - 0.5) < 0.01  # capped at 0.5

    profile = SleepUserProfile(nights=28)
    assert profile.personal_weight == 0.5  # hard cap


# ── Integration test ─────────────────────────────────────────────────────────────


def test_full_pipeline():
    """Full pipeline: session -> segmentation -> observation -> profile fold."""
    # Create session with realistic sleep pattern (2 hours for faster test)
    session = _make_sleep_session(duration_hours=2.0, hr=55)

    # Segment
    config = AdvancedSleepStager(epoch_sec=30)
    segmentation = segment_sleep(session, config)

    # Extract features
    features = cardio_stager(session, epoch_sec=30)

    # Extract observation
    observation = extract_nightly_observation(segmentation, features)

    # Fold into profile
    profile = SleepUserProfile(nights=0)
    new_profile = profile.fold(observation, horizon_nights=14)

    # Verify
    assert new_profile.nights == 1
    assert new_profile.hr_sleep_median is not None
    assert 50 < new_profile.hr_sleep_median < 60
    assert new_profile.rmssd_med is not None
    # Synthetic RR data produces ~13.7ms RMSSD (fixed intervals [1000,1010,990,1005])
    assert new_profile.rmssd_med > 10


# ── Constants verification ───────────────────────────────────────────────────────


def test_constants():
    """Verify constants match Dart."""
    assert DEFAULT_EPOCH_SEC == 30
    assert STILL_CUT_G == 0.015
    assert MOVE_CUT_G == 0.05
    assert Z_ANGLE_STILL_DEG == 5.0


# Run all tests if executed directly
if __name__ == "__main__":
    pytest.main([__file__, "-v"])