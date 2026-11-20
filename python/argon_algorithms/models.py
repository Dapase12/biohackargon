"""OpenStrap algorithm types ported to Python with Pydantic.

Mirrors analytics/lib/src/onehz/types.dart and sleep types.
All models are immutable (frozen=True) to match Dart's const constructors.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


# ── Constants ────────────────────────────────────────────────────────────────────

# Days required for quiet-waking HRR to be considered "settled" (personalized)
QUIET_HRR_SETTLED_DAYS = 7


class Tier(str, Enum):
    """Confidence/quality tier of a published method on our substrate."""

    AUTH = "AUTH"  # Directly measured / definitional
    HIGH = "HIGH"  # Strong literature support on our substrate
    ESTIMATE = "ESTIMATE"  # Published but estimate-grade on wrist 1 Hz
    RELATIVE = "RELATIVE"  # Relative-only, never an absolute unit


class Sex(str, Enum):
    """Sex constant for Banister TRIMP."""

    MALE = "male"
    FEMALE = "female"


class SleepStage(str, Enum):
    """3-class label used across the sleep family."""

    WAKE = "wake"
    NREM = "nrem"
    REM = "rem"


@dataclass(frozen=True)
class Driver:
    """A single ranked contributor to a metric (for glass-box narratives)."""

    label: str
    contribution: float  # signed standardized contribution
    detail: Optional[str] = None

    def to_json(self) -> dict[str, Any]:
        result = {
            "label": self.label,
            "contribution": round(self.contribution, 6),
        }
        if self.detail is not None:
            result["detail"] = self.detail
        return result


class Metric(BaseModel, frozen=True):
    """Honest metric wrapper.

    value == None means the inputs to compute this metric were absent or
    insufficient. In that case confidence MUST be 0.
    """

    value: Optional[Any] = None
    confidence: float = Field(ge=0.0, le=1.0)
    tier: Tier
    inputs_used: list[str] = Field(default_factory=list)
    drivers: Optional[list[Driver]] = None
    note: Optional[str] = None

    @classmethod
    def absent(
        cls,
        tier: Tier,
        inputs_used: Optional[list[str]] = None,
        note: Optional[str] = None,
    ) -> "Metric":
        """Create an absent metric: no data, confidence forced to 0."""
        return cls(
            value=None,
            confidence=0.0,
            tier=tier,
            inputs_used=inputs_used or [],
            drivers=None,
            note=note,
        )

    @property
    def present(self) -> bool:
        return self.value is not None

    def to_json(self, encode: Optional[callable] = None) -> dict[str, Any]:
        """JSON encode with honest placeholder for absent values."""
        enc = None
        if self.value is not None:
            enc = encode(self.value) if encode else self.value
            # Non-finite scalar is not a measurement
            if isinstance(enc, float) and not (enc == enc and enc != float("inf") and enc != float("-inf")):
                enc = None

        m: dict[str, Any] = {}
        m["value"] = "—" if enc is None else enc
        m["confidence"] = round(0.0 if enc is None else self.confidence, 6)
        m["tier"] = self.tier.value
        m["inputs_used"] = self.inputs_used
        if self.drivers is not None:
            m["drivers"] = [d.to_json() for d in self.drivers]
        if self.note is not None:
            m["note"] = self.note
        return m


class RrSeries(BaseModel, frozen=True):
    """A beat-to-beat RR (inter-beat-interval) series.

    tsMs[i] is the wall-clock time (ms) at which beat i's interval was
    observed (the END of the RR interval). rrMs[i] is that interval in ms.
    Pulse-derived — this is PRV, not ECG HRV.
    """

    ts_ms: list[float] = Field(default_factory=list)
    rr_ms: list[float] = Field(default_factory=list)

    @field_validator("ts_ms", "rr_ms", mode="before")
    @classmethod
    def ensure_lists(cls, v):
        if v is None:
            return []
        return list(v)

    @property
    def length(self) -> int:
        return len(self.rr_ms)

    @property
    def is_empty(self) -> bool:
        return len(self.rr_ms) == 0

    def beat_times_ms(self, t0_ms: float = 0.0) -> list[float]:
        """Reconstruct cumulative beat-occurrence times (ms) from RR intervals."""
        out = []
        t = t0_ms
        for rr in self.rr_ms:
            t += rr
            out.append(t)
        return out


class HrSample(BaseModel, frozen=True):
    """1 Hz heart-rate sample. hr == 0 means OFF-SKIN (never bradycardia)."""

    ts_ms: float
    hr: float  # bpm; 0 = off-skin

    @property
    def valid(self) -> bool:
        return self.hr > 0


class AccelSample(BaseModel, frozen=True):
    """1 Hz tri-axial accel sample (gravity vector, g)."""

    ts_ms: float
    x: float
    y: float
    z: float
    valid: bool = True


class AdcSample(BaseModel, frozen=True):
    """A relative-ADC sample (skin-temp / SpO2 channel / ambient).

    Carries NO absolute unit — only the raw count + a validity/contact flag.
    """

    ts_ms: float
    adc: float
    valid: bool = True


class NightlyRecord(BaseModel, frozen=True):
    """One nightly aggregate row, the unit the 24/7 stack reasons over.

    All fields nullable — a missing night contributes nothing (no fabrication).
    """

    date: str  # display-only label (edge-supplied), wake-to-wake day
    rhr: Optional[float] = None  # nocturnal resting HR (bpm)
    ln_rmssd: Optional[float] = None  # ln(RMSSD ms)
    rmssd: Optional[float] = None  # RMSSD (ms)
    sdnn: Optional[float] = None  # SDNN (ms)
    skin_temp_z: Optional[float] = None  # relative skin-temp deviation (z), unitless
    resp_rate: Optional[float] = None  # breaths/min
    coverage: Optional[float] = None  # 0..1 valid-data fraction for the night


class SleepUserProfile(BaseModel, frozen=True):
    """PER-USER rolling sleep profile — the "gets better over time" personalization.

    Blended via EWMA (~14-night horizon) after each finalized night.
    Blend weight grows from 0 (cold start) to a hard 0.5 cap.
    All fields nullable: absent => no personalization on that axis.
    """

    nights: int = 0
    hr_floor_p5: Optional[float] = None  # sleeping-HR 5th pct (bpm) — deep-sleep floor
    hr_floor_p25: Optional[float] = None  # sleeping-HR 25th pct (bpm) — REM HR gate
    hr_sleep_median: Optional[float] = None  # sleeping-HR median (bpm)
    hr_arousal: Optional[float] = None  # typical arousal/wake HR threshold (bpm)
    rmssd_med: Optional[float] = None  # sleeping RMSSD median (ms)
    rmssd_mad: Optional[float] = None  # sleeping RMSSD MAD (ms)
    enmo_still_cut: Optional[float] = None  # still/repositioning ENMO cut (g)
    enmo_move_cut: Optional[float] = None  # big-move ENMO cut (g)
    lfhf_med: Optional[float] = None  # sleeping LF/HF median
    rk_med: Optional[float] = None  # sleeping |ΔIHR| median (bpm)
    updated_at_ms: int = 0

    @property
    def personal_weight(self) -> float:
        """Personal-vs-local blend weight: 0 at cold start -> 0.5 hard cap at >=14 nights."""
        return max(0.0, min(0.5, self.nights / 28.0))

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "SleepUserProfile":
        return cls(
            nights=data.get("nights", 0),
            hr_floor_p5=data.get("hr_floor_p5"),
            hr_floor_p25=data.get("hr_floor_p25"),
            hr_sleep_median=data.get("hr_sleep_median"),
            hr_arousal=data.get("hr_arousal"),
            rmssd_med=data.get("rmssd_med"),
            rmssd_mad=data.get("rmssd_mad"),
            enmo_still_cut=data.get("enmo_still_cut"),
            enmo_move_cut=data.get("enmo_move_cut"),
            lfhf_med=data.get("lfhf_med"),
            rk_med=data.get("rk_med"),
            updated_at_ms=data.get("updated_at_ms", 0),
        )

    def to_json(self) -> dict[str, Any]:
        result = {"nights": self.nights, "updated_at_ms": self.updated_at_ms}
        for field, value in [
            ("hr_floor_p5", self.hr_floor_p5),
            ("hr_floor_p25", self.hr_floor_p25),
            ("hr_sleep_median", self.hr_sleep_median),
            ("hr_arousal", self.hr_arousal),
            ("rmssd_med", self.rmssd_med),
            ("rmssd_mad", self.rmssd_mad),
            ("enmo_still_cut", self.enmo_still_cut),
            ("enmo_move_cut", self.enmo_move_cut),
            ("lfhf_med", self.lfhf_med),
            ("rk_med", self.rk_med),
        ]:
            if value is not None:
                result[field] = value
        return result

    def fold(self, observation: "SleepNightObservation", horizon_nights: int = 14) -> "SleepUserProfile":
        """EWMA-fold one finalized night's observation into the profile."""
        if horizon_nights <= 0:
            raise ValueError("horizon_nights must be positive")
        n2 = self.nights + 1
        a = max(1.0 / n2, 2.0 / (horizon_nights + 1))

        def ew(old: Optional[float], obs: Optional[float]) -> Optional[float]:
            if obs is None:
                return old
            if old is None:
                return obs
            return old * (1 - a) + obs * a

        return SleepUserProfile(
            nights=n2,
            hr_floor_p5=ew(self.hr_floor_p5, observation.hr_floor_p5),
            hr_floor_p25=ew(self.hr_floor_p25, observation.hr_floor_p25),
            hr_sleep_median=ew(self.hr_sleep_median, observation.hr_sleep_median),
            hr_arousal=ew(self.hr_arousal, observation.hr_arousal),
            rmssd_med=ew(self.rmssd_med, observation.rmssd_med),
            rmssd_mad=ew(self.rmssd_mad, observation.rmssd_mad),
            enmo_still_cut=ew(self.enmo_still_cut, observation.enmo_still_cut),
            enmo_move_cut=ew(self.enmo_move_cut, observation.enmo_move_cut),
            lfhf_med=ew(self.lfhf_med, observation.lfhf_med),
            rk_med=ew(self.rk_med, observation.rk_med),
            updated_at_ms=observation.updated_at_ms,
        )


class SleepNightObservation(BaseModel, frozen=True):
    """One finalized night's extracted features for profile folding."""

    hr_floor_p5: Optional[float] = None
    hr_floor_p25: Optional[float] = None
    hr_sleep_median: Optional[float] = None
    hr_arousal: Optional[float] = None
    rmssd_med: Optional[float] = None
    rmssd_mad: Optional[float] = None
    enmo_still_cut: Optional[float] = None
    enmo_move_cut: Optional[float] = None
    lfhf_med: Optional[float] = None
    rk_med: Optional[float] = None
    updated_at_ms: int = 0


class StagerResult(BaseModel, frozen=True):
    """Result from a sleep stager."""

    stages: list[SleepStage]
    epoch_sec: int
    wake_pct: float
    nrem_pct: float
    rem_pct: float

    def to_json(self) -> dict[str, Any]:
        return {
            "epoch_sec": self.epoch_sec,
            "wake_pct": round(self.wake_pct, 6),
            "nrem_pct": round(self.nrem_pct, 6),
            "rem_pct": round(self.rem_pct, 6),
            "epochs": len(self.stages),
        }


class CardioStagerResult(BaseModel, frozen=True):
    """Result: the standard StagerResult (W/NREM/REM) + a per-epoch deep flag.

    Deep is an NREM subtype — LOW CONFIDENCE; meaningless for non-NREM epochs.
    """

    base: StagerResult
    deep_flag: list[bool]
    confidence: float

    def to_json(self) -> dict[str, Any]:
        result = self.base.to_json()
        result["deep_flag"] = self.deep_flag
        result["confidence"] = round(self.confidence, 6)
        return result


class LoadState(BaseModel, frozen=True):
    """Training load state: CTL (chronic), ATL (acute), TSB (form)."""

    ctl: float  # Chronic Training Load (42-day EWMA)
    atl: float  # Acute Training Load (7-day EWMA)
    tsb: float  # Training Stress Balance = CTL - ATL


class QuietLevel(BaseModel, frozen=True):
    """A personal quiet-waking level and how many prior days back it."""

    hrr: float
    days: int

    @property
    def settled(self) -> bool:
        return self.days >= QUIET_HRR_SETTLED_DAYS


class NetTrimp(BaseModel, frozen=True):
    """TRIMP split into exercise and living components."""

    exercise: float
    living: float
    minutes: int

    @property
    def net(self) -> float:
        """Living minutes cancel among themselves, then floor at 0; exercise added in full."""
        return self.exercise + max(0.0, self.living)


# ── Sleep staging types (mirrors analytics/lib/src/onehz/sleep/*.dart) ────────────

class SleepWindow(BaseModel, frozen=True):
    """A sleep window detected by van Hees algorithm.

    start_s: Unix timestamp (seconds) of window start
    end_s: Unix timestamp (seconds) of window end
    """
    start_s: float
    end_s: float

    @property
    def duration_s(self) -> float:
        return self.end_s - self.start_s


class ImmobilityMask(BaseModel, frozen=True):
    """Per-second immobility mask from z-angle analysis."""

    # 1 = immobile, 0 = movement (aligned with 1 Hz accel timestamps)
    mask: list[int] = Field(default_factory=list)
    # The timestamps (ms) corresponding to each mask entry
    ts_ms: list[float] = Field(default_factory=list)

    @property
    def length(self) -> int:
        return len(self.mask)

    @property
    def is_empty(self) -> bool:
        return len(self.mask) == 0


class ZAngle(BaseModel, frozen=True):
    """Z-angle (tilt) time series computed from accel gravity vector."""

    # Z-angle in degrees per second (aligned with 1 Hz accel timestamps)
    z_angle_deg: list[float] = Field(default_factory=list)
    ts_ms: list[float] = Field(default_factory=list)

    @property
    def length(self) -> int:
        return len(self.z_angle_deg)

    @property
    def is_empty(self) -> bool:
        return len(self.z_angle_deg) == 0


class SleepSession(BaseModel, frozen=True):
    """Input session for sleep staging.

    Covers the full in-bed window with 1 Hz signals.
    """
    # Accel samples at 1 Hz (gravity vector)
    accel: list[AccelSample] = Field(default_factory=list)
    # Heart rate at 1 Hz (0 = off-skin)
    hr: list[HrSample] = Field(default_factory=list)
    # RR intervals (beat-to-beat, ms)
    rr: list[RrSeries] = Field(default_factory=list)
    # In-bed window: start/end in seconds since epoch
    in_bed_start_s: float
    in_bed_end_s: float
    # Optional personal profile for personalization
    profile: Optional[SleepUserProfile] = None


class CardioEpochFeatures(BaseModel, frozen=True):
    """Per-epoch features computed by cardioStager (epoch = 30 seconds default)."""

    epoch_start_s: float  # epoch start time (seconds since epoch)
    # Motion features
    enmo_median: float
    enmo_p95: float
    still_frac: float  # fraction of seconds with ENMO < still_cut
    # HR features (only valid HR samples)
    hr_median: Optional[float] = None
    hr_p5: Optional[float] = None
    hr_p25: Optional[float] = None
    # HRV features (from RR in this epoch)
    rmssd: Optional[float] = None
    lfhf: Optional[float] = None
    rk: Optional[float] = None  # |ΔIHR| median (bpm)
    # Validity
    valid_hr_frac: float = 0.0
    valid_rr_frac: float = 0.0
    # Immobility
    immobile_frac: float = 0.0


class SleepSegmentation(BaseModel, frozen=True):
    """Result from segmentSleep: single source of truth for sleep accounting.

    Mirrors Dart's SleepSegmentation exactly.
    """
    # 3-class stages per epoch (0=wake, 1=nrem, 2=rem) — aligned to epoch grid
    stages: list[int] = Field(default_factory=list)
    # Per-epoch deep flag (meaningful only where stages[i] == 1 (NREM))
    deep_flag: list[bool] = Field(default_factory=list)
    # Epoch length in seconds (typically 30)
    epoch_sec: int = 30
    # In-bed window boundaries (seconds since epoch)
    in_bed_start_s: float = 0.0
    in_bed_end_s: float = 0.0
    # Sleep window (subset of in-bed) — onset/offset
    sleep_onset_s: Optional[float] = None
    sleep_offset_s: Optional[float] = None
    # Unobserved seconds within in-bed (off-skin / no data)
    unobserved_sec: int = 0
    # Overall confidence 0..1
    confidence: float = 0.0

    @property
    def sleep_stage_enum(self) -> list[SleepStage]:
        """Convert integer stages to SleepStage enum."""
        mapping = {0: SleepStage.WAKE, 1: SleepStage.NREM, 2: SleepStage.REM}
        return [mapping.get(s, SleepStage.WAKE) for s in self.stages]

    def to_stager_result(self) -> StagerResult:
        """Convert to base StagerResult for API compatibility."""
        stages = self.sleep_stage_enum
        total = len(stages)
        if total == 0:
            return StagerResult(
                stages=[],
                epoch_sec=self.epoch_sec,
                wake_pct=0.0,
                nrem_pct=0.0,
                rem_pct=0.0,
            )
        wake = sum(1 for s in stages if s == SleepStage.WAKE) / total
        nrem = sum(1 for s in stages if s == SleepStage.NREM) / total
        rem = sum(1 for s in stages if s == SleepStage.REM) / total
        return StagerResult(
            stages=stages,
            epoch_sec=self.epoch_sec,
            wake_pct=wake * 100,
            nrem_pct=nrem * 100,
            rem_pct=rem * 100,
        )

    def to_cardio_result(self) -> CardioStagerResult:
        """Convert to CardioStagerResult with deep flag."""
        base = self.to_stager_result()
        return CardioStagerResult(
            base=base,
            deep_flag=self.deep_flag,
            confidence=self.confidence,
        )


class AdvancedSleepStager(BaseModel, frozen=True):
    """Configuration for advanced sleep stager (segmentSleep entry point)."""

    epoch_sec: int = 30
    # van Hees sleep window detection
    min_sleep_window_min: int = 30  # minimum sleep window duration (minutes)
    # Immobility detection
    still_cut_g: float = 0.015  # ENMO threshold for "still" (g)
    move_cut_g: float = 0.05   # ENMO threshold for "big move" (g)
    # Z-angle
    z_angle_still_deg: float = 5.0  # degrees
    # Personalization blend weight cap
    max_personal_weight: float = 0.5