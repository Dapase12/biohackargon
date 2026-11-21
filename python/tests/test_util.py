"""Tests for util.py — pure math utilities.

Mirrors analytics/lib/src/onehz/util.dart tests.
"""

import math

import pytest

from argon_algorithms.util import (
    LombScargle,
    LsPoint,
    RobustScale,
    average_ranks,
    benjamini_hochberg,
    calendar_days,
    clean_beats_in_window,
    freq_grid,
    lomb_scargle,
    mad,
    mean,
    median,
    normal_two_sided_p,
    ols_fit,
    ols_slope,
    percentile,
    percentile_sorted,
    robust_z,
    round6,
    round_to,
    sample_cadence_seconds,
    stddev,
    stddev_pop,
    theil_sen,
    z_score,
)


class TestBasicStatistics:
    """Test basic statistics functions."""

    def test_mean_empty(self):
        assert mean([]) is None

    def test_mean_single(self):
        assert mean([5.0]) == 5.0

    def test_mean_multiple(self):
        assert mean([1.0, 2.0, 3.0, 4.0, 5.0]) == 3.0

    def test_stddev_empty(self):
        assert stddev([]) is None

    def test_stddev_single(self):
        assert stddev([5.0]) is None

    def test_stddev_two(self):
        # stddev of [1, 3] with N-1 = sqrt(((1-2)^2 + (3-2)^2)/1) = sqrt(2)
        assert abs(stddev([1.0, 3.0]) - math.sqrt(2)) < 1e-10

    def test_stddev_pop_empty(self):
        assert stddev_pop([]) is None

    def test_stddev_pop_single(self):
        assert stddev_pop([5.0]) == 0.0

    def test_stddev_pop_multiple(self):
        # pop stddev of [1, 3] = sqrt(((1-2)^2 + (3-2)^2)/2) = 1
        assert abs(stddev_pop([1.0, 3.0]) - 1.0) < 1e-10


class TestPercentiles:
    """Test percentile and median functions."""

    def test_percentile_empty(self):
        assert percentile([], 50) is None

    def test_percentile_single(self):
        assert percentile([5.0], 50) == 5.0

    def test_percentile_sorted(self):
        assert percentile_sorted([1, 2, 3, 4], 50) == 2.5

    def test_percentile_edges(self):
        assert percentile([1, 2, 3, 4], 0) == 1.0
        assert percentile([1, 2, 3, 4], 100) == 4.0

    def test_median_empty(self):
        assert median([]) is None

    def test_median_odd(self):
        assert median([1, 2, 3]) == 2.0

    def test_median_even(self):
        assert median([1, 2, 3, 4]) == 2.5


class TestMAD:
    """Test median absolute deviation."""

    def test_mad_empty(self):
        assert mad([]) is None

    def test_mad_scaled(self):
        # For [1, 2, 3, 4, 5], median=3, deviations=[2,1,0,1,2], median=1, scaled=1.4826
        result = mad([1, 2, 3, 4, 5])
        assert abs(result - 1.4826) < 1e-4

    def test_mad_unscaled(self):
        result = mad([1, 2, 3, 4, 5], scaled=False)
        assert result == 1.0

    def test_mad_zero(self):
        # All same values -> MAD = 0
        result = mad([5, 5, 5, 5])
        assert result == 0.0


class TestSampleCadence:
    """Test sample_cadence_seconds."""

    def test_cadence_empty(self):
        assert sample_cadence_seconds([]) is None

    def test_cadence_single(self):
        assert sample_cadence_seconds([0.0]) is None

    def test_cadence_1hz(self):
        # 1 Hz = 1 second intervals
        ts = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]
        result = sample_cadence_seconds(ts)
        assert result == 1.0

    def test_cadence_2hz(self):
        # 2 Hz = 0.5 second intervals
        ts = [0.0, 0.5, 1.0, 1.5, 2.0]
        result = sample_cadence_seconds(ts)
        assert result == 0.5

    def test_cadence_with_dropout(self):
        # 1 Hz with one dropout
        ts = [0.0, 1.0, 2.0, 10.0, 11.0, 12.0]
        result = sample_cadence_seconds(ts)
        assert result == 1.0

    def test_cadence_too_slow(self):
        # 301 seconds - exceeds max supported
        ts = [0.0, 301.0, 602.0]
        result = sample_cadence_seconds(ts)
        assert result is None

    def test_cadence_non_positive_gaps(self):
        # Duplicate timestamps
        ts = [0.0, 0.0, 1.0, 2.0]
        result = sample_cadence_seconds(ts)
        assert result == 1.0


class TestZScores:
    """Test z-score functions."""

    def test_robust_z(self):
        sample = [1, 2, 3, 4, 5]
        # median=3, mad=1.4826, z(5) = (5-3)/1.4826 = 1.349
        result = robust_z(5.0, sample)
        assert abs(result - 1.349) < 0.01

    def test_robust_z_mad_zero(self):
        # All same values -> MAD=0 -> None
        sample = [5, 5, 5, 5]
        result = robust_z(5.0, sample)
        assert result is None

    def test_robust_z_insufficient_sample(self):
        result = robust_z(5.0, [1])
        assert result is None

    def test_robust_scale_class(self):
        scale = RobustScale.of([1, 2, 3, 4, 5])
        assert scale is not None
        assert scale.med == 3.0
        assert abs(scale.scale - 1.4826) < 1e-4
        assert abs(scale.z(5) - 1.349) < 0.01

    def test_z_score(self):
        sample = [1, 2, 3, 4, 5]
        # mean=3, stddev=1.581, z(5) = (5-3)/1.581 = 1.265
        result = z_score(5.0, sample)
        assert abs(result - 1.265) < 0.01

    def test_z_score_zero_sd(self):
        result = z_score(5.0, [5, 5, 5])
        assert result is None


class TestRegression:
    """Test regression functions."""

    def test_ols_slope_simple(self):
        # y = 2x, x = [0,1,2,3] -> slope = 2
        y = [0, 2, 4, 6]
        result = ols_slope(y)
        assert abs(result - 2.0) < 1e-10

    def test_ols_slope_with_x(self):
        y = [2, 4, 6, 8]
        x = [0, 1, 2, 3]
        result = ols_slope(y, x)
        assert abs(result - 2.0) < 1e-10

    def test_ols_slope_insufficient(self):
        assert ols_slope([1]) is None

    def test_ols_fit(self):
        y = [1, 3, 5, 7]  # y = 2x + 1
        fit = ols_fit(y)
        assert fit is not None
        assert abs(fit.slope - 2.0) < 1e-10
        assert abs(fit.intercept - 1.0) < 1e-10

    def test_theil_sen(self):
        # y = 2x + 1, no outliers
        y = [1, 3, 5, 7]
        result = theil_sen(y)
        assert abs(result - 2.0) < 1e-10

    def test_theil_sen_with_outlier(self):
        # y = 2x + 1 with one outlier
        y = [1, 3, 100, 7]  # outlier at index 2
        result = theil_sen(y)
        # Should be robust to outlier
        assert abs(result - 2.0) < 1.0


class TestRounding:
    """Test rounding functions."""

    def test_round6_normal(self):
        assert round6(1.23456789) == 1.234568

    def test_round6_nan(self):
        assert round6(float('nan')) is None

    def test_round6_inf(self):
        assert round6(float('inf')) is None

    def test_round_to(self):
        assert round_to(1.23456, 2) == 1.23
        assert round_to(1.23456, 4) == 1.2346


class TestLombScargle:
    """Test Lomb-Scargle periodogram."""

    def test_lomb_scargle_simple(self):
        # Simple sine wave
        t = [i * 0.1 for i in range(100)]  # 0 to 9.9 seconds
        y = [math.sin(2 * math.pi * 1.0 * ti) for ti in t]  # 1 Hz sine
        freqs = freq_grid(0.1, 5.0, 50)
        result = lomb_scargle(t, y, freqs)
        assert result is not None
        assert len(result.spectrum) == 50

    def test_lomb_scargle_insufficient_points(self):
        result = lomb_scargle([0, 1, 2], [1, 2, 3], [1.0])
        assert result is None

    def test_lomb_scargle_zero_variance(self):
        t = [0, 1, 2, 3]
        y = [5, 5, 5, 5]
        freqs = freq_grid(0.1, 5.0, 10)
        result = lomb_scargle(t, y, freqs)
        assert result is None

    def test_band_power(self):
        # Create a simple spectrum
        spectrum = [
            LsPoint(0.1, 10.0),
            LsPoint(0.2, 20.0),
            LsPoint(0.3, 30.0),
        ]
        ls = LombScargle(spectrum)
        # Band power from 0.15 to 0.25 Hz should capture part of 0.2 Hz
        power = ls.band_power(0.15, 0.25)
        assert power > 0

    def test_peak_freq(self):
        spectrum = [
            LsPoint(0.1, 10.0),
            LsPoint(0.2, 50.0),
            LsPoint(0.3, 30.0),
        ]
        ls = LombScargle(spectrum)
        peak = ls.peak_freq(0.1, 0.3)
        assert peak == 0.2


class TestFreqGrid:
    """Test frequency grid generation."""

    def test_freq_grid_single(self):
        grid = freq_grid(0.1, 0.1, 1)
        assert grid == [0.1]

    def test_freq_grid_multiple(self):
        grid = freq_grid(0.0, 1.0, 5)
        assert grid == [0.0, 0.25, 0.5, 0.75, 1.0]

    def test_freq_grid_empty(self):
        grid = freq_grid(0.1, 0.2, 0)
        assert grid == []


class TestCalendarDays:
    """Test calendar day conversion."""

    def test_calendar_days_valid(self):
        dates = ["2024-01-01", "2024-01-02", "2024-01-03"]
        days = calendar_days(dates)
        assert days[1] - days[0] == 1
        assert days[2] - days[1] == 1

    def test_calendar_days_invalid(self):
        dates = ["invalid", "2024-01-01"]
        days = calendar_days(dates)
        assert days[0] == 0  # Falls back to position
        assert days[1] > days[0]


class TestAverageRanks:
    """Test average ranks with tie handling."""

    def test_average_ranks_no_ties(self):
        xs = [3, 1, 4, 2]
        ranks = average_ranks(xs)
        # Sorted: 1, 2, 3, 4 -> ranks 1, 2, 3, 4
        # Original positions: 3->3, 1->1, 4->4, 2->2
        assert ranks == [3.0, 1.0, 4.0, 2.0]

    def test_average_ranks_with_ties(self):
        xs = [5, 3, 3, 1]
        ranks = average_ranks(xs)
        # Sorted: 1, 3, 3, 5 -> ranks 1, 2.5, 2.5, 4
        assert ranks == [4.0, 2.5, 2.5, 1.0]

    def test_average_ranks_all_same(self):
        xs = [5, 5, 5]
        ranks = average_ranks(xs)
        # All rank 2
        assert ranks == [2.0, 2.0, 2.0]


class TestNormalTwoSidedP:
    """Test two-sided p-value from z-score."""

    def test_p_zero(self):
        p = normal_two_sided_p(0.0)
        assert p == 1.0

    def test_p_large_z(self):
        p = normal_two_sided_p(10.0)
        assert p < 1e-20

    def test_p_nan(self):
        p = normal_two_sided_p(float('nan'))
        assert p == 1.0


class TestBenjaminiHochberg:
    """Test Benjamini-Hochberg FDR adjustment."""

    def test_bh_simple(self):
        ps = [0.01, 0.04, 0.03, 0.2]
        q = benjamini_hochberg(ps)
        # Sorted: 0.01, 0.03, 0.04, 0.2
        # q: 0.01*4/1=0.04, 0.03*4/2=0.06, 0.04*4/3=0.053, 0.2*4/4=0.2
        # Running min from end: 0.2, 0.053, 0.053, 0.04
        assert q[0] == 0.04
        assert abs(q[2] - 0.053) < 0.001

    def test_bh_with_none(self):
        ps = [0.01, None, 0.03, 0.2]
        q = benjamini_hochberg(ps)
        assert q[1] is None
        # Only 3 valid p-values
        assert q[0] is not None


class TestBeatCleaning:
    """Test beat cleaning functions."""

    def test_clean_beats_normal(self):
        rr_ms = [800, 810, 805, 800]
        rr_ts_ms = [1000, 1800, 2605, 3405]
        filtered_rr, filtered_ts = clean_beats_in_window(
            rr_ms, rr_ts_ms, 500, 4000
        )
        assert len(filtered_rr) == 4
        assert filtered_rr == [800, 810, 805, 800]

    def test_clean_beats_rr_out_of_bounds(self):
        rr_ms = [200, 800, 810, 2500]  # 200 < RR_MIN, 2500 > RR_MAX
        rr_ts_ms = [1000, 1800, 2605, 3405]
        filtered_rr, filtered_ts = clean_beats_in_window(
            rr_ms, rr_ts_ms, 500, 4000
        )
        assert len(filtered_rr) == 2
        assert filtered_rr == [800, 810]

    def test_clean_beats_large_step(self):
        rr_ms = [800, 1100, 805]  # 1100 - 800 = 300 > RR_MAX_STEP
        rr_ts_ms = [1000, 1800, 2605]
        filtered_rr, filtered_ts = clean_beats_in_window(
            rr_ms, rr_ts_ms, 500, 4000
        )
        assert len(filtered_rr) == 2
        assert filtered_rr == [800, 805]

    def test_clean_beats_window_filter(self):
        rr_ms = [800, 810, 805, 800]
        rr_ts_ms = [1000, 1800, 2605, 3405]
        # Window only includes middle two beats
        filtered_rr, filtered_ts = clean_beats_in_window(
            rr_ms, rr_ts_ms, 1500, 3000
        )
        assert len(filtered_rr) == 2
        assert filtered_rr == [810, 805]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
