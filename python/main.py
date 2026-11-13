"""
FastAPI wrapper for Argon sleep staging algorithm.
Deploy this as a Python microservice (Railway, Fly.io, Cloud Run, etc.)
The Supabase Edge Function `sleep-webhook` calls this via PYTHON_PIPELINE_URL.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from argon_algorithms.models import (
    AccelSample,
    AdvancedSleepStager,
    HrSample,
    RrSeries,
    SleepSession,
    SleepUserProfile,
)
from argon_algorithms.sleep_stager import (
    extract_nightly_observation,
    segment_sleep,
)

app = FastAPI(
    title="Argon Sleep Staging API",
    version="1.0.0",
    description="Python microservice for sleep staging via FastAPI",
)

# ── Request/Response models matching Edge Function expectations ──────────────────────


class RawAccelSample(BaseModel):
    ts_ms: float
    x: float
    y: float
    z: float
    valid: Optional[bool] = True


class RawHrSample(BaseModel):
    ts_ms: float
    hr: float


class RawRrSeries(BaseModel):
    ts_ms: list[float] | float
    rr_ms: list[float]


class RawSleepData(BaseModel):
    user_id: str
    log_date: str
    accel: list[RawAccelSample]
    hr: list[RawHrSample]
    rr: list[RawRrSeries] = []
    in_bed_start_s: float
    in_bed_end_s: float
    config: Optional[dict[str, Any]] = None


class PipelineSegmentation(BaseModel):
    stages: list[int]
    deep_flag: list[bool]
    sleep_onset_s: Optional[float]
    sleep_offset_s: Optional[float]
    in_bed_start_s: float
    in_bed_end_s: float
    epoch_sec: int
    confidence: float
    unobserved_sec: int


class PipelineFeatures(BaseModel):
    epoch_start_s: float
    enmo_median: Optional[float]
    enmo_p95: Optional[float]
    still_frac: Optional[float]
    immobile_frac: Optional[float]
    hr_median: Optional[float]
    hr_p5: Optional[float]
    hr_p25: Optional[float]
    valid_hr_frac: Optional[float]
    rmssd_ms: Optional[float]
    lfhf_ratio: Optional[float]
    rk_bpm: Optional[float]
    valid_rr_frac: Optional[float]
    stage: int
    deep_flag: bool


class PipelineObservation(BaseModel):
    hr_floor_p5: Optional[float]
    hr_floor_p25: Optional[float]
    hr_sleep_median: Optional[float]
    hr_arousal: Optional[float]
    rmssd_med_ms: Optional[float]
    rmssd_mad_ms: Optional[float]
    enmo_still_cut_g: Optional[float]
    enmo_move_cut_g: Optional[float]
    lfhf_med: Optional[float]
    rk_med_bpm: Optional[float]


class PipelineProfile(BaseModel):
    nights: int
    hr_floor_p5: Optional[float]
    hr_floor_p25: Optional[float]
    hr_sleep_median: Optional[float]
    hr_arousal: Optional[float]
    rmssd_med_ms: Optional[float]
    rmssd_mad_ms: Optional[float]
    enmo_still_cut_g: Optional[float]
    enmo_move_cut_g: Optional[float]
    lfhf_med: Optional[float]
    rk_med_bpm: Optional[float]
    personal_weight: float


class PipelineResult(BaseModel):
    segmentation: PipelineSegmentation
    features: list[PipelineFeatures]
    observation: Optional[PipelineObservation]
    profile: Optional[PipelineProfile]
    stored: bool
    error: Optional[str] = None


# ── Helper functions ─────────────────────────────────────────────────────────────────


def parse_rr_series(rr_data: list[RawRrSeries]) -> list[RrSeries]:
    """Parse RR series from various input formats."""
    series = []
    for d in rr_data:
        try:
            ts_ms = d.ts_ms if isinstance(d.ts_ms, list) else [d.ts_ms]
            rr_ms = d.rr_ms

            if len(ts_ms) == 1 and len(rr_ms) > 1:
                # Reconstruct beat times from end time + intervals
                end_time = ts_ms[0]
                reconstructed_ts = []
                current_time = end_time
                for rr in reversed(rr_ms):
                    reconstructed_ts.insert(0, current_time)
                    current_time -= rr
                ts_ms = reconstructed_ts

            if len(ts_ms) == len(rr_ms):
                series.append(RrSeries(ts_ms=ts_ms, rr_ms=rr_ms))
        except Exception:
            continue
    return series


def convert_to_python_models(raw: RawSleepData) -> SleepSession:
    """Convert raw API payload to internal Python models."""
    accel = [
        AccelSample(ts_ms=s.ts_ms, x=s.x, y=s.y, z=s.z, valid=s.valid or True)
        for s in raw.accel
    ]

    hr = [HrSample(ts_ms=s.ts_ms, hr=s.hr) for s in raw.hr]

    rr = parse_rr_series(raw.rr)

    profile = None
    if raw.config and raw.config.get("profile"):
        p = raw.config["profile"]
        profile = SleepUserProfile(
            nights=p.get("nights", 0),
            hr_floor_p5=p.get("hr_floor_p5"),
            hr_floor_p25=p.get("hr_floor_p25"),
            hr_sleep_median=p.get("hr_sleep_median"),
            hr_arousal=p.get("hr_arousal"),
            rmssd_med=p.get("rmssd_med"),
            rmssd_mad=p.get("rmssd_mad"),
            enmo_still_cut=p.get("enmo_still_cut"),
            enmo_move_cut=p.get("enmo_move_cut"),
            lfhf_med=p.get("lfhf_med"),
            rk_med=p.get("rk_med"),
            updated_at_ms=p.get("updated_at_ms", 0),
        )

    config = AdvancedSleepStager(
        epoch_sec=raw.config.get("epoch_sec", 30) if raw.config else 30,
        min_sleep_window_min=raw.config.get("min_sleep_window_min", 30) if raw.config else 30,
        still_cut_g=raw.config.get("still_cut_g", 0.015) if raw.config else 0.015,
        move_cut_g=raw.config.get("move_cut_g", 0.05) if raw.config else 0.05,
        z_angle_still_deg=raw.config.get("z_angle_still_deg", 5.0) if raw.config else 5.0,
    )

    return SleepSession(
        accel=accel,
        hr=hr,
        rr=rr,
        in_bed_start_s=raw.in_bed_start_s,
        in_bed_end_s=raw.in_bed_end_s,
        profile=profile,
    )


def build_pipeline_result(
    segmentation, features, observation, profile
) -> PipelineResult:
    """Convert internal results to PipelineResult for API response."""
    # Segmentation
    seg = PipelineSegmentation(
        stages=segmentation.stages,
        deep_flag=segmentation.deep_flag,
        sleep_onset_s=segmentation.sleep_onset_s,
        sleep_offset_s=segmentation.sleep_offset_s,
        in_bed_start_s=segmentation.in_bed_start_s,
        in_bed_end_s=segmentation.in_bed_end_s,
        epoch_sec=segmentation.epoch_sec,
        confidence=segmentation.confidence,
        unobserved_sec=segmentation.unobserved_sec,
    )

    # Features
    feat_list = []
    for f in features:
        feat_list.append(
            PipelineFeatures(
                epoch_start_s=f.epoch_start_s,
                enmo_median=f.enmo_median,
                enmo_p95=f.enmo_p95,
                still_frac=f.still_frac,
                immobile_frac=f.immobile_frac,
                hr_median=f.hr_median,
                hr_p5=f.hr_p5,
                hr_p25=f.hr_p25,
                valid_hr_frac=f.valid_hr_frac,
                rmssd_ms=f.rmssd,
                lfhf_ratio=f.lfhf,
                rk_bpm=f.rk,
                valid_rr_frac=f.valid_rr_frac,
                stage=0,  # Will be filled from segmentation
                deep_flag=False,
            )
        )

    # Map stages to features
    for i, f in enumerate(feat_list):
        if i < len(segmentation.stages):
            f.stage = segmentation.stages[i]
            f.deep_flag = segmentation.deep_flag[i] if i < len(segmentation.deep_flag) else False

    # Observation
    obs = None
    if observation:
        obs = PipelineObservation(
            hr_floor_p5=observation.hr_floor_p5,
            hr_floor_p25=observation.hr_floor_p25,
            hr_sleep_median=observation.hr_sleep_median,
            hr_arousal=observation.hr_arousal,
            rmssd_med_ms=observation.rmssd_med,
            rmssd_mad_ms=observation.rmssd_mad,
            enmo_still_cut_g=observation.enmo_still_cut,
            enmo_move_cut_g=observation.enmo_move_cut,
            lfhf_med=observation.lfhf_med,
            rk_med_bpm=observation.rk_med,
        )

    # Profile
    prof = None
    if profile:
        prof = PipelineProfile(
            nights=profile.nights,
            hr_floor_p5=profile.hr_floor_p5,
            hr_floor_p25=profile.hr_floor_p25,
            hr_sleep_median=profile.hr_sleep_median,
            hr_arousal=profile.hr_arousal,
            rmssd_med_ms=profile.rmssd_med,
            rmssd_mad_ms=profile.rmssd_mad,
            enmo_still_cut_g=profile.enmo_still_cut,
            enmo_move_cut_g=profile.enmo_move_cut,
            lfhf_med=profile.lfhf_med,
            rk_med_bpm=profile.rk_med,
            personal_weight=profile.personal_weight,
        )

    return PipelineResult(
        segmentation=seg,
        features=feat_list,
        observation=obs,
        profile=prof,
        stored=False,  # Storage happens in Edge Function
        error=None,
    )


# ── API Endpoints ────────────────────────────────────────────────────────────────────


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "argon-sleep-staging"}


@app.post("/process-sleep", response_model=PipelineResult)
async def process_sleep(raw: RawSleepData):
    """
    Process raw sleep data through the Argon sleep staging pipeline.

    Expected payload matches the Edge Function's RawSleepData format.
    Returns PipelineResult with segmentation, features, observation, and profile.
    """
    try:
        # Convert to internal models
        session = convert_to_python_models(raw)

        if not session.accel or not session.hr:
            raise HTTPException(
                status_code=400,
                detail="Missing required data: accel and hr arrays must not be empty",
            )

        # Run sleep staging pipeline
        segmentation = segment_sleep(session)

        # Extract features for observation
        from argon_algorithms.sleep_stager import cardio_stager

        features = cardio_stager(session, epoch_sec=segmentation.epoch_sec)

        # Extract nightly observation
        observation = extract_nightly_observation(segmentation, features)

        # Build profile (cold start if no previous profile)
        profile = None
        if session.profile:
            profile = session.profile.fold(observation) if observation else session.profile

        return build_pipeline_result(segmentation, features, observation, profile)

    except HTTPException:
        raise
    except Exception as e:
        # Return error in PipelineResult format (not HTTP error) to match Edge Function expectation
        return PipelineResult(
            segmentation=PipelineSegmentation(
                stages=[],
                deep_flag=[],
                sleep_onset_s=None,
                sleep_offset_s=None,
                in_bed_start_s=raw.in_bed_start_s,
                in_bed_end_s=raw.in_bed_end_s,
                epoch_sec=raw.config.get("epoch_sec", 30) if raw.config else 30,
                confidence=0,
                unobserved_sec=0,
            ),
            features=[],
            observation=None,
            profile=None,
            stored=False,
            error=f"Processing error: {str(e)}",
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)