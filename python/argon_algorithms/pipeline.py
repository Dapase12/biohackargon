"""Sleep staging pipeline for Argon.

Processes 1 Hz data (accel, HR, RR) through sleep staging algorithms
and stores results in Supabase.

Pipeline stages:
1. Receive raw 1 Hz data from webhook (Health Connect → Google Apps Script → Supabase)
2. Build SleepSession from raw data
3. Run segment_sleep() to get SleepSegmentation
4. Extract SleepNightObservation for profile folding
5. Update SleepUserProfile with EWMA
6. Store SleepSegmentation, SleepEpochFeatures, SleepNightObservation in Supabase
7. Update computed_daily_scores via sleep_daily_scores view
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Optional

from supabase import create_client, Client

from .models import (
    AccelSample,
    AdvancedSleepStager,
    CardioEpochFeatures,
    HrSample,
    RrSeries,
    SleepNightObservation,
    SleepSegmentation,
    SleepSession,
    SleepUserProfile,
)
from .sleep_stager import (
    segment_sleep,
    extract_nightly_observation,
    cardio_stager,
    DEFAULT_EPOCH_SEC,
)


@dataclass
class RawSleepData:
    """Raw 1 Hz data received from webhook."""
    user_id: str
    log_date: date
    accel: list[dict[str, Any]]      # [{ts_ms, x, y, z, valid}]
    hr: list[dict[str, Any]]         # [{ts_ms, hr}]
    rr: list[dict[str, Any]]         # [{ts_ms, rr_ms[]}]
    in_bed_start_s: float
    in_bed_end_s: float
    config: Optional[dict[str, Any]] = None


@dataclass
class PipelineResult:
    """Result of pipeline processing."""
    segmentation: SleepSegmentation
    features: list[CardioEpochFeatures]
    observation: Optional[SleepNightObservation]
    profile: Optional[SleepUserProfile]
    stored: bool = False
    error: Optional[str] = None


def _parse_accel_samples(data: list[dict[str, Any]]) -> list[AccelSample]:
    """Parse accel samples from webhook data."""
    samples = []
    for d in data:
        try:
            samples.append(AccelSample(
                ts_ms=d["ts_ms"],
                x=d["x"],
                y=d["y"],
                z=d["z"],
                valid=d.get("valid", True),
            ))
        except (KeyError, TypeError) as e:
            # Skip invalid samples
            continue
    return samples


def _parse_hr_samples(data: list[dict[str, Any]]) -> list[HrSample]:
    """Parse HR samples from webhook data."""
    samples = []
    for d in data:
        try:
            samples.append(HrSample(
                ts_ms=d["ts_ms"],
                hr=d["hr"],
            ))
        except (KeyError, TypeError):
            continue
    return samples


def _parse_rr_series(data: list[dict[str, Any]]) -> list[RrSeries]:
    """Parse RR series from webhook data."""
    series = []
    for d in data:
        try:
            ts_ms = d["ts_ms"]
            rr_ms = d["rr_ms"]
            if not isinstance(rr_ms, list):
                continue
            if len(rr_ms) != len(ts_ms):
                # If ts_ms is a single timestamp, reconstruct beat times
                # Assuming ts_ms is the timestamp of the last beat
                # This is a fallback for different webhook formats
                continue
            series.append(RrSeries(ts_ms=ts_ms, rr_ms=rr_ms))
        except (KeyError, TypeError):
            continue
    return series


def build_sleep_session(raw: RawSleepData, profile: Optional[SleepUserProfile] = None) -> SleepSession:
    """Build SleepSession from raw webhook data."""
    accel = _parse_accel_samples(raw.accel)
    hr = _parse_hr_samples(raw.hr)
    rr = _parse_rr_series(raw.rr)

    # Use config from raw data or defaults
    config = raw.config or {}
    epoch_sec = config.get("epoch_sec", DEFAULT_EPOCH_SEC)

    return SleepSession(
        accel=accel,
        hr=hr,
        rr=rr,
        in_bed_start_s=raw.in_bed_start_s,
        in_bed_end_s=raw.in_bed_end_s,
        profile=profile,
    )


def run_sleep_staging(session: SleepSession, config: Optional[AdvancedSleepStager] = None) -> tuple[SleepSegmentation, list[CardioEpochFeatures]]:
    """Run sleep staging pipeline on a session."""
    segmentation = segment_sleep(session, config)
    features = cardio_stager(session, epoch_sec=config.epoch_sec if config else DEFAULT_EPOCH_SEC, profile=session.profile)
    return segmentation, features


def process_sleep_data(
    raw: RawSleepData,
    supabase: Client,
    config: Optional[AdvancedSleepStager] = None,
) -> PipelineResult:
    """Process raw sleep data through the full pipeline.

    Steps:
    1. Get or create SleepUserProfile
    2. Build SleepSession
    3. Run segment_sleep
    4. Extract observation
    4. Fold observation into profile
    5. Store everything in Supabase
    """
    try:
        # 1. Get or create profile
        profile = get_user_profile(supabase, raw.user_id)

        # 2. Build session
        session = build_sleep_session(raw, profile)

        # 3. Run sleep staging
        segmentation, features = run_sleep_staging(session, config)

        # 4. Extract observation
        observation = extract_nightly_observation(segmentation, features)

        # 5. Fold observation into profile
        updated_profile = None
        if observation:
            updated_profile = profile.fold(observation, horizon_nights=14)

        # 6. Store in Supabase
        stored = store_results(
            supabase,
            raw.user_id,
            raw.log_date,
            segmentation,
            features,
            observation,
            updated_profile,
        )

        return PipelineResult(
            segmentation=segmentation,
            features=features,
            observation=observation,
            profile=updated_profile,
            stored=stored,
        )

    except Exception as e:
        return PipelineResult(
            segmentation=None,
            features=[],
            observation=None,
            profile=None,
            stored=False,
            error=str(e),
        )


def get_user_profile(supabase: Client, user_id: str) -> SleepUserProfile:
    """Get or create SleepUserProfile for user."""
    result = supabase.table("sleep_user_profiles").select("*").eq("user_id", user_id).execute()

    if result.data and len(result.data) > 0:
        row = result.data[0]
        return SleepUserProfile(
            nights=row.get("nights", 0),
            hr_floor_p5=row.get("hr_floor_p5"),
            hr_floor_p25=row.get("hr_floor_p25"),
            hr_sleep_median=row.get("hr_sleep_median"),
            hr_arousal=row.get("hr_arousal"),
            rmssd_med=row.get("rmssd_med_ms"),
            rmssd_mad=row.get("rmssd_mad_ms"),
            enmo_still_cut=row.get("enmo_still_cut_g"),
            enmo_move_cut=row.get("enmo_move_cut_g"),
            lfhf_med=row.get("lfhf_med"),
            rk_med=row.get("rk_med_bpm"),
            updated_at_ms=int(row.get("updated_at", "1970-01-01")[:19].replace("-", "").replace(":", "").replace("T", "")),
        )

    return SleepUserProfile(nights=0)


def upsert_user_profile(supabase: Client, user_id: str, profile: SleepUserProfile) -> bool:
    """Upsert SleepUserProfile to Supabase."""
    data = {
        "user_id": user_id,
        "nights": profile.nights,
        "hr_floor_p5": profile.hr_floor_p5,
        "hr_floor_p25": profile.hr_floor_p25,
        "hr_sleep_median": profile.hr_sleep_median,
        "hr_arousal": profile.hr_arousal,
        "rmssd_med_ms": profile.rmssd_med,
        "rmssd_mad_ms": profile.rmssd_mad,
        "enmo_still_cut_g": profile.enmo_still_cut,
        "enmo_move_cut_g": profile.enmo_move_cut,
        "lfhf_med": profile.lfhf_med,
        "rk_med_bpm": profile.rk_med,
        "personal_weight": profile.personal_weight,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        supabase.table("sleep_user_profiles").upsert(data).execute()
        return True
    except Exception:
        return False


def store_results(
    supabase: Client,
    user_id: str,
    log_date: date,
    segmentation: SleepSegmentation,
    features: list[CardioEpochFeatures],
    observation: Optional[SleepNightObservation],
    updated_profile: Optional[SleepUserProfile],
) -> bool:
    """Store all results in Supabase."""
    try:
        # 1. Store segmentation
        seg_data = {
            "user_id": user_id,
            "log_date": log_date.isoformat(),
            "session_start": datetime.fromtimestamp(segmentation.in_bed_start_s, tz=timezone.utc).isoformat(),
            "session_end": datetime.fromtimestamp(segmentation.in_bed_end_s, tz=timezone.utc).isoformat(),
            "sleep_onset": datetime.fromtimestamp(segmentation.sleep_onset_s, tz=timezone.utc).isoformat() if segmentation.sleep_onset_s else None,
            "sleep_offset": datetime.fromtimestamp(segmentation.sleep_offset_s, tz=timezone.utc).isoformat() if segmentation.sleep_offset_s else None,
            "epoch_sec": segmentation.epoch_sec,
            "stages": segmentation.stages,
            "deep_flags": segmentation.deep_flag,
            "total_epochs": len(segmentation.stages),
            "wake_pct": round(segmentation.stages.count(0) / max(1, len(segmentation.stages)) * 100, 2),
            "nrem_pct": round(segmentation.stages.count(1) / max(1, len(segmentation.stages)) * 100, 2),
            "rem_pct": round(segmentation.stages.count(2) / max(1, len(segmentation.stages)) * 100, 2),
            "deep_pct": round(segmentation.deep_flag.count(True) / max(1, len(segmentation.stages)) * 100, 2),
            "unobserved_sec": segmentation.unobserved_sec,
            "confidence": segmentation.confidence,
            "sleep_windows": [{"start_s": w.start_s, "end_s": w.end_s} for w in []],  # Not stored in current model
            "config": {
                "epoch_sec": segmentation.epoch_sec,
            },
        }

        seg_result = supabase.table("sleep_segmentations").insert(seg_data).execute()
        if not seg_result.data:
            return False
        segmentation_id = seg_result.data[0]["id"]

        # 2. Store epoch features
        epoch_data = []
        for i, feat in enumerate(features):
            epoch_data.append({
                "segmentation_id": segmentation_id,
                "epoch_index": i,
                "epoch_start": datetime.fromtimestamp(feat.epoch_start_s, tz=timezone.utc).isoformat(),
                "enmo_median": feat.enmo_median,
                "enmo_p95": feat.enmo_p95,
                "still_frac": feat.still_frac,
                "immobile_frac": feat.immobile_frac,
                "hr_median": feat.hr_median,
                "hr_p5": feat.hr_p5,
                "hr_p25": feat.hr_p25,
                "valid_hr_frac": feat.valid_hr_frac,
                "rmssd_ms": feat.rmssd,
                "lfhf_ratio": feat.lfhf,
                "rk_bpm": feat.rk,
                "valid_rr_frac": feat.valid_rr_frac,
                "stage": segmentation.stages[i] if i < len(segmentation.stages) else 0,
                "deep_flag": segmentation.deep_flag[i] if i < len(segmentation.deep_flag) else False,
            })

        if epoch_data:
            supabase.table("sleep_epoch_features").insert(epoch_data).execute()

        # 3. Store observation
        if observation:
            obs_data = {
                "user_id": user_id,
                "segmentation_id": segmentation_id,
                "log_date": log_date.isoformat(),
                "hr_floor_p5": observation.hr_floor_p5,
                "hr_floor_p25": observation.hr_floor_p25,
                "hr_sleep_median": observation.hr_sleep_median,
                "hr_arousal": observation.hr_arousal,
                "rmssd_med_ms": observation.rmssd_med,
                "rmssd_mad_ms": observation.rmssd_mad,
                "enmo_still_cut_g": observation.enmo_still_cut,
                "enmo_move_cut_g": observation.enmo_move_cut,
                "lfhf_med": observation.lfhf_med,
                "rk_med_bpm": observation.rk_med,
            }
            supabase.table("sleep_night_observations").insert(obs_data).execute()

        # 4. Update profile
        if updated_profile:
            upsert_user_profile(supabase, user_id, updated_profile)

        return True

    except Exception as e:
        print(f"Error storing results: {e}")
        return False


# High-level async function for webhook handlers
async def process_webhook_payload(
    payload: dict[str, Any],
    supabase_url: str,
    supabase_key: str,
) -> PipelineResult:
    """Process a webhook payload from Health Connect / Google Apps Script.

    Expected payload format:
    {
        "user_id": "uuid",
        "log_date": "2024-01-15",
        "accel": [{"ts_ms": 1234567890000, "x": 0.0, "y": 0.0, "z": 1.0, "valid": true}, ...],
        "hr": [{"ts_ms": 1234567890000, "hr": 55}, ...],
        "rr": [{"ts_ms": [1234567890000, ...], "rr_ms": [1000, 1010, ...]}, ...],
        "in_bed_start_s": 1234567890,
        "in_bed_end_s": 1234597890,
        "config": {"epoch_sec": 30, ...}
    }
    """
    supabase = create_client(supabase_url, supabase_key)

    raw = RawSleepData(
        user_id=payload["user_id"],
        log_date=date.fromisoformat(payload["log_date"]),
        accel=payload.get("accel", []),
        hr=payload.get("hr", []),
        rr=payload.get("rr", []),
        in_bed_start_s=payload["in_bed_start_s"],
        in_bed_end_s=payload["in_bed_end_s"],
        config=payload.get("config"),
    )

    config = None
    if raw.config:
        config = AdvancedSleepStager(**raw.config)

    return process_sleep_data(raw, supabase, config)


# Convenience function for batch processing (e.g., nightly cron)
def process_user_night(
    supabase: Client,
    user_id: str,
    log_date: date,
    config: Optional[AdvancedSleepStager] = None,
) -> PipelineResult:
    """Process a user's night data from Supabase tables.

    Assumes raw 1 Hz data is stored in staging tables (e.g., raw_accel_1hz, raw_hr_1hz, raw_rr_1hz).
    This would be implemented based on your raw data storage schema.
    """
    # This is a placeholder - implement based on your raw data storage
    # For now, return error
    return PipelineResult(
        segmentation=None,
        features=[],
        observation=None,
        profile=None,
        stored=False,
        error="Not implemented - requires raw data tables",
    )


__all__ = [
    "RawSleepData",
    "PipelineResult",
    "build_sleep_session",
    "run_sleep_staging",
    "process_sleep_data",
    "get_user_profile",
    "upsert_user_profile",
    "store_results",
    "process_webhook_payload",
    "process_user_night",
]