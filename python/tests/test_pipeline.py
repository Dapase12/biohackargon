"""Tests for sleep staging pipeline."""

import pytest
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

from argon_algorithms.pipeline import (
    RawSleepData,
    PipelineResult,
    _parse_accel_samples,
    _parse_hr_samples,
    _parse_rr_series,
    build_sleep_session,
    run_sleep_staging,
    get_user_profile,
    upsert_user_profile,
    store_results,
)
from argon_algorithms.models import (
    AccelSample,
    HrSample,
    RrSeries,
    SleepSession,
    SleepUserProfile,
    SleepSegmentation,
    CardioEpochFeatures,
    SleepNightObservation,
)
from argon_algorithms.sleep_stager import SleepStage


class TestParseAccelSamples:
    """Tests for _parse_accel_samples."""

    def test_parse_valid_accel(self):
        data = [
            {"ts_ms": 1000, "x": 0.1, "y": 0.2, "z": 1.0, "valid": True},
            {"ts_ms": 2000, "x": 0.0, "y": 0.0, "z": 1.0, "valid": True},
        ]
        samples = _parse_accel_samples(data)
        assert len(samples) == 2
        assert samples[0].ts_ms == 1000
        assert samples[0].x == 0.1
        assert samples[0].y == 0.2
        assert samples[0].z == 1.0
        assert samples[0].valid is True

    def test_parse_accel_default_valid(self):
        data = [{"ts_ms": 1000, "x": 0.1, "y": 0.2, "z": 1.0}]
        samples = _parse_accel_samples(data)
        assert len(samples) == 1
        assert samples[0].valid is True

    def test_parse_skips_invalid(self):
        data = [
            {"ts_ms": 1000, "x": 0.1, "y": 0.2, "z": 1.0},
            {"ts_ms": 2000, "y": 0.0, "z": 1.0},  # missing x
            {"ts_ms": 3000, "x": 0.0, "y": 0.0, "z": 1.0},
        ]
        samples = _parse_accel_samples(data)
        assert len(samples) == 2


class TestParseHrSamples:
    """Tests for _parse_hr_samples."""

    def test_parse_valid_hr(self):
        data = [
            {"ts_ms": 1000, "hr": 60},
            {"ts_ms": 2000, "hr": 65},
        ]
        samples = _parse_hr_samples(data)
        assert len(samples) == 2
        assert samples[0].ts_ms == 1000
        assert samples[0].hr == 60

    def test_parse_skips_invalid(self):
        data = [
            {"ts_ms": 1000, "hr": 60},
            {"hr": 65},  # missing ts_ms
            {"ts_ms": 3000, "hr": 70},
        ]
        samples = _parse_hr_samples(data)
        assert len(samples) == 2


class TestParseRrSeries:
    """Tests for _parse_rr_series."""

    def test_parse_valid_rr(self):
        data = [
            {"ts_ms": [1000, 2000, 3000], "rr_ms": [1000, 1010, 1020]},
        ]
        series = _parse_rr_series(data)
        assert len(series) == 1
        assert series[0].ts_ms == [1000, 2000, 3000]
        assert series[0].rr_ms == [1000, 1010, 1020]

    def test_parse_skips_mismatched_lengths(self):
        data = [
            {"ts_ms": [1000, 2000], "rr_ms": [1000]},  # mismatch
            {"ts_ms": [3000, 4000], "rr_ms": [1010, 1020]},
        ]
        series = _parse_rr_series(data)
        assert len(series) == 1
        assert series[0].ts_ms == [3000, 4000]


class TestBuildSleepSession:
    """Tests for build_sleep_session."""

    def test_build_basic_session(self):
        raw = RawSleepData(
            user_id="user1",
            log_date=date(2024, 1, 15),
            accel=[{"ts_ms": 1000, "x": 0.1, "y": 0.2, "z": 1.0}],
            hr=[{"ts_ms": 1000, "hr": 60}],
            rr=[{"ts_ms": [1000, 2000], "rr_ms": [1000, 1010]}],
            in_bed_start_s=1000.0,
            in_bed_end_s=5000.0,
        )
        session = build_sleep_session(raw)
        assert isinstance(session, SleepSession)
        assert len(session.accel) == 1
        assert len(session.hr) == 1
        assert len(session.rr) == 1
        assert session.in_bed_start_s == 1000.0
        assert session.in_bed_end_s == 5000.0
        assert session.profile is None

    def test_build_session_with_profile(self):
        profile = SleepUserProfile(nights=10, hr_sleep_median=55.0)
        raw = RawSleepData(
            user_id="user1",
            log_date=date(2024, 1, 15),
            accel=[],
            hr=[],
            rr=[],
            in_bed_start_s=1000.0,
            in_bed_end_s=5000.0,
        )
        session = build_sleep_session(raw, profile)
        assert session.profile is not None
        assert session.profile.nights == 10


class TestRunSleepStaging:
    """Tests for run_sleep_staging."""

    @patch("argon_algorithms.pipeline.segment_sleep")
    @patch("argon_algorithms.pipeline.cardio_stager")
    def test_run_sleep_staging(self, mock_cardio, mock_segment):
        mock_segmentation = SleepSegmentation(
            in_bed_start_s=1000.0,
            in_bed_end_s=5000.0,
            sleep_onset_s=2000.0,
            sleep_offset_s=4000.0,
            epoch_sec=30,
            stages=[0, 1, 2],  # 0=WAKE, 1=NREM, 2=REM
            deep_flag=[False, True, False],
            unobserved_sec=0,
            confidence=0.8,
        )
        mock_segment.return_value = mock_segmentation
        mock_cardio.return_value = [
            CardioEpochFeatures(
                epoch_start_s=1000.0,
                enmo_median=0.01,
                enmo_p95=0.05,
                still_frac=1.0,
                immobile_frac=1.0,
                hr_median=60.0,
                hr_p5=58.0,
                hr_p25=59.0,
                valid_hr_frac=1.0,
                rmssd=50.0,
                lfhf=1.5,
                rk=55.0,
                valid_rr_frac=1.0,
            )
        ]

        session = SleepSession(
            accel=[],
            hr=[],
            rr=[],
            in_bed_start_s=1000.0,
            in_bed_end_s=5000.0,
        )
        segmentation, features = run_sleep_staging(session)

        assert segmentation == mock_segmentation
        assert len(features) == 1
        mock_segment.assert_called_once()
        mock_cardio.assert_called_once()


class TestGetUserProfile:
    """Tests for get_user_profile."""

    def test_get_existing_profile(self):
        mock_supabase = MagicMock()
        mock_result = MagicMock()
        mock_result.data = [{
            "nights": 10,
            "hr_floor_p5": 45.0,
            "hr_floor_p25": 50.0,
            "hr_sleep_median": 55.0,
            "hr_arousal": 75.0,
            "rmssd_med_ms": 50.0,
            "rmssd_mad_ms": 10.0,
            "enmo_still_cut_g": 0.01,
            "enmo_move_cut_g": 0.05,
            "lfhf_med": 1.5,
            "rk_med_bpm": 55.0,
            "updated_at": "2024-01-15T10:00:00Z",
        }]
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = mock_result

        profile = get_user_profile(mock_supabase, "user1")

        assert isinstance(profile, SleepUserProfile)
        assert profile.nights == 10
        assert profile.hr_floor_p5 == 45.0

    def test_get_new_profile(self):
        mock_supabase = MagicMock()
        mock_result = MagicMock()
        mock_result.data = []
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = mock_result

        profile = get_user_profile(mock_supabase, "user1")

        assert isinstance(profile, SleepUserProfile)
        assert profile.nights == 0


class TestUpsertUserProfile:
    """Tests for upsert_user_profile."""

    def test_upsert_success(self):
        mock_supabase = MagicMock()
        mock_execute = MagicMock()
        mock_supabase.table.return_value.upsert.return_value.execute.return_value = mock_execute

        profile = SleepUserProfile(nights=5, hr_sleep_median=55.0)
        result = upsert_user_profile(mock_supabase, "user1", profile)

        assert result is True
        mock_supabase.table.assert_called_with("sleep_user_profiles")

    def test_upsert_failure(self):
        mock_supabase = MagicMock()
        mock_supabase.table.return_value.upsert.return_value.execute.side_effect = Exception("DB error")

        profile = SleepUserProfile(nights=5)
        result = upsert_user_profile(mock_supabase, "user1", profile)

        assert result is False


class TestStoreResults:
    """Tests for store_results."""

    def test_store_segmentation(self):
        mock_supabase = MagicMock()

        # Mock segmentation insert
        mock_seg_result = MagicMock()
        mock_seg_result.data = [{"id": 123}]
        mock_supabase.table.return_value.insert.return_value.execute.return_value = mock_seg_result

        segmentation = SleepSegmentation(
            in_bed_start_s=1000.0,
            in_bed_end_s=5000.0,
            sleep_onset_s=2000.0,
            sleep_offset_s=4000.0,
            epoch_sec=30,
            stages=[0, 1],  # 0=WAKE, 1=NREM
            deep_flag=[False, True],
            unobserved_sec=0,
            confidence=0.8,
        )
        features = [
            CardioEpochFeatures(
                epoch_start_s=1000.0,
                enmo_median=0.01,
                enmo_p95=0.05,
                still_frac=1.0,
                immobile_frac=1.0,
                hr_median=60.0,
                hr_p5=58.0,
                hr_p25=59.0,
                valid_hr_frac=1.0,
                rmssd=50.0,
                lfhf=1.5,
                rk=55.0,
                valid_rr_frac=1.0,
            )
        ]
        observation = SleepNightObservation(
            hr_floor_p5=45.0,
            hr_floor_p25=50.0,
            hr_sleep_median=55.0,
            hr_arousal=75.0,
            rmssd_med=50.0,
            rmssd_mad=10.0,
            enmo_still_cut=0.01,
            enmo_move_cut=0.05,
            lfhf_med=1.5,
            rk_med=55.0,
        )
        profile = SleepUserProfile(nights=5, hr_sleep_median=55.0)

        result = store_results(
            mock_supabase,
            "user1",
            date(2024, 1, 15),
            segmentation,
            features,
            observation,
            profile,
        )

        assert result is True
        # Verify segmentation was stored
        mock_supabase.table.assert_any_call("sleep_segmentations")
        # Verify epoch features were stored
        mock_supabase.table.assert_any_call("sleep_epoch_features")
        # Verify observation was stored
        mock_supabase.table.assert_any_call("sleep_night_observations")
        # Verify profile was updated
        mock_supabase.table.assert_any_call("sleep_user_profiles")


class TestPipelineResult:
    """Tests for PipelineResult dataclass."""

    def test_pipeline_result_creation(self):
        result = PipelineResult(
            segmentation=None,
            features=[],
            observation=None,
            profile=None,
            stored=True,
            error=None,
        )
        assert result.stored is True
        assert result.error is None

    def test_pipeline_result_with_error(self):
        result = PipelineResult(
            segmentation=None,
            features=[],
            observation=None,
            profile=None,
            stored=False,
            error="Test error",
        )
        assert result.stored is False
        assert result.error == "Test error"


class TestRawSleepData:
    """Tests for RawSleepData dataclass."""

    def test_raw_sleep_data_creation(self):
        raw = RawSleepData(
            user_id="user1",
            log_date=date(2024, 1, 15),
            accel=[{"ts_ms": 1000, "x": 0.1, "y": 0.2, "z": 1.0}],
            hr=[{"ts_ms": 1000, "hr": 60}],
            rr=[],
            in_bed_start_s=1000.0,
            in_bed_end_s=5000.0,
            config={"epoch_sec": 30},
        )
        assert raw.user_id == "user1"
        assert raw.log_date == date(2024, 1, 15)
        assert raw.config == {"epoch_sec": 30}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])