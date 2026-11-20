"""Test Vectors for REA Validation.

Comprehensive test vectors for all three algorithms based on:
1. OpenStrap Dart reference implementations
2. Existing Python unit tests
3. Bluetooth SIG specifications (for HRS)

Each vector contains: input, expected_output (from Dart), and metadata.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from datetime import date


# =============================================================================
# HRS (Heart Rate Service) Test Vectors
# Based on Bluetooth SIG Heart Rate Service 1.0 (0x180D/0x2A37)
# and openstrap-protocol/lib/src/hrs.dart
# =============================================================================

@dataclass
class HrsTestVector:
    """Test vector for HRS parsing."""
    name: str
    input_bytes: list[int]
    expected: dict[str, Any] | None  # None = should return None
    description: str
    source: str = "bluetooth_sig_spec"


HRS_TEST_VECTORS: list[HrsTestVector] = [
    # --- Basic 8-bit HR format ---
    HrsTestVector(
        name="basic_8bit_hr_only",
        input_bytes=[0x00, 0x48],  # flags=0, hr=72
        expected={"hr": 72, "rrMs": [], "contact": None},
        description="8-bit HR, no RR, contact not supported",
    ),
    HrsTestVector(
        name="basic_8bit_hr_contact_not_supported",
        input_bytes=[0x02, 0x48],  # flags=0b10 (bit 1=1), contact_bits=1 (not supported)
        expected={"hr": 72, "rrMs": [], "contact": None},
        description="8-bit HR, contact bits=01 (not supported)",
    ),
    HrsTestVector(
        name="basic_8bit_hr_contact_supported_no_contact",
        input_bytes=[0x04, 0x48],  # flags=0b100 (bit 2=1), contact_bits=2 (no contact)
        expected={"hr": 72, "rrMs": [], "contact": False},
        description="8-bit HR, contact supported but no contact",
    ),
    HrsTestVector(
        name="basic_8bit_hr_contact_supported_contact",
        input_bytes=[0x06, 0x48],  # flags=0b110, contact_bits=3 (contact)
        expected={"hr": 72, "rrMs": [], "contact": True},
        description="8-bit HR, contact supported and contact detected",
    ),

    # --- 16-bit HR format ---
    HrsTestVector(
        name="wide_16bit_hr_invalid_high",
        input_bytes=[0x01, 0x84, 0x03],  # flags=1 (wide), hr=0x0384=900
        expected=None,
        description="16-bit HR value 900 bpm - should be rejected as >300",
    ),
    HrsTestVector(
        name="wide_16bit_hr_valid",
        input_bytes=[0x01, 0x2C, 0x01],  # flags=1, hr=0x012C=300
        expected={"hr": 300, "rrMs": [], "contact": None},
        description="16-bit HR value 300 bpm - max valid",
    ),
    HrsTestVector(
        name="wide_16bit_hr_zero_rejected",
        input_bytes=[0x01, 0x00, 0x00],  # flags=1, hr=0
        expected=None,
        description="16-bit HR value 0 - should be rejected",
    ),

    # --- Energy Expended present ---
    HrsTestVector(
        name="with_energy_expended",
        input_bytes=[0x08, 0x48, 0x10, 0x00],  # flags=0x08 (EE), hr=72, EE=0x0010
        expected={"hr": 72, "rrMs": [], "contact": None},
        description="Energy Expended present (ignored), 8-bit HR",
    ),
    HrsTestVector(
        name="with_energy_expended_wide",
        input_bytes=[0x09, 0x48, 0x00, 0x10, 0x00],  # flags=0x09 (wide+EE), hr=72, EE=0x0010
        expected={"hr": 72, "rrMs": [], "contact": None},
        description="Energy Expended present with wide HR",
    ),
    HrsTestVector(
        name="truncated_energy_expended",
        input_bytes=[0x08, 0x48, 0x10],  # flags=EE but only 1 byte of EE
        expected=None,
        description="Truncated Energy Expended - should return None",
    ),

    # --- RR Intervals ---
    HrsTestVector(
        name="single_rr_interval",
        input_bytes=[0x10, 0x48, 0x00, 0x04],  # flags=0x10 (RR), hr=72, RR=0x0400=1024 ticks=1000ms
        expected={"hr": 72, "rrMs": [1000], "contact": None},
        description="Single RR interval: 1024 ticks = 1000ms",
    ),
    HrsTestVector(
        name="multiple_rr_intervals",
        input_bytes=[0x10, 0x48, 0x00, 0x04, 0x00, 0x04, 0xA0, 0x04],  # hr=72, RR: 1024, 1024, 1184 ticks
        expected={"hr": 72, "rrMs": [1000, 1000, 1156], "contact": None},
        description="Three RR intervals: 1024, 1024, 1184 ticks -> 1000, 1000, 1156ms",
    ),
    HrsTestVector(
        name="rr_with_contact",
        input_bytes=[0x16, 0x48, 0x00, 0x04],  # flags=0x16 (RR+contact), hr=72, RR=1024
        expected={"hr": 72, "rrMs": [1000], "contact": True},
        description="RR intervals with contact detected",
    ),
    HrsTestVector(
        name="rr_zero_ticks_filtered",
        input_bytes=[0x10, 0x48, 0x00, 0x00, 0x00, 0x04],  # RR: 0 (filtered), 1024
        expected={"hr": 72, "rrMs": [1000], "contact": None},
        description="Zero ticks RR filtered out",
    ),
    HrsTestVector(
        name="truncated_rr_odd_bytes",
        input_bytes=[0x10, 0x48, 0x00],  # RR flag set but odd number of trailing bytes
        expected=None,
        description="Truncated RR (odd bytes) - should return None",
    ),

    # --- Combined flags ---
    HrsTestVector(
        name="wide_hr_ee_rr_contact",
        input_bytes=[0x1F, 0x2C, 0x01, 0x10, 0x00, 0x00, 0x04],  # all flags, hr=300, EE=0x0010, RR=1024
        expected={"hr": 300, "rrMs": [1000], "contact": True},
        description="All flags set: wide HR, EE, RR, contact",
    ),

    # --- Edge cases ---
    HrsTestVector(
        name="too_short",
        input_bytes=[0x00],
        expected=None,
        description="Too short (<2 bytes)",
    ),
    HrsTestVector(
        name="hr_301_wide_rejected",
        input_bytes=[0x01, 0x2D, 0x01],  # 0x012D = 301
        expected=None,
        description="Wide HR > 300 rejected",
    ),
]


# =============================================================================
# TRIMP Test Vectors
# Based on openstrap-analytics/lib/src/onehz/clinical/load_trimp.dart
# Key constants from Python:
#   EXERCISE_FLOOR_HRR = 0.40
#   MAX_HR = 220 - age (Tanaka: 208 - 0.7*age)
#   REST_HR default = 60
#   QUIET_HRR default = 0.30
#   TC (Banister) = 1.92 for men, 1.67 for women
#   TAU_C = 42, TAU_A = 7
#   MAXIMAL_NET_TRIMP = 400
#   STRAIN_CURVATURE = 10
# =============================================================================

@dataclass
class TrimpTestVector:
    """Test vector for TRIMP calculations."""
    name: str
    input: dict[str, Any]
    expected: dict[str, Any]
    description: str
    source: str = "openstrap_dart_calibration"


TRIMP_TEST_VECTORS: list[TrimpTestVector] = [
    # --- banister_trimp (session-level) ---
    # Python banister_trimp returns Metric with value=TRIMP, not net_trimp
    # TRIMP = sum(1.0 * hrr * banister_y(hrr)) per minute
    TrimpTestVector(
        name="banister_trimp_60min_145bpm_male_30",
        input={
            "hr_per_min": [145] * 60,
            "resting_hr": 60,
            "max_hr": 190,  # Tanaka for age 30: 208 - 0.7*30 = 187, using 190
            "sex": "male",
        },
        expected={"trimp": 88.1, "net_trimp": 88.1},  # Python returns TRIMP as value
        description="60 min at 145 bpm, male age 30, rest_hr 60",
        source="python_implementation",
    ),
    TrimpTestVector(
        name="banister_trimp_30min_160bpm_female_25",
        input={
            "hr_per_min": [160] * 30,
            "resting_hr": 55,
            "max_hr": 190,  # Tanaka for age 25: 208 - 0.7*25 = 190.5
            "sex": "female",
        },
        expected={"trimp": 73.5, "net_trimp": 73.5},
        description="30 min at 160 bpm, female age 25, rest_hr 55",
    ),
    TrimpTestVector(
        name="banister_trimp_below_exercise_floor",
        input={
            "hr_per_min": [100] * 60,
            "resting_hr": 60,
            "max_hr": 190,
            "sex": "male",
        },
        expected={"trimp": 21.3, "net_trimp": 21.3},  # TRIMP is still computed, just low HRR
        description="HR at 100 bpm (HRR ~0.32) - TRIMP computed but below exercise floor",
    ),

    # --- daily_quiet_waking_hrr ---
    TrimpTestVector(
        name="quiet_hrr_sufficient_data",
        input={
            "hr_per_min": [70, 71, 69, 70, 72, 70, 71] * 20,  # 140 samples, HR~70
            "resting_hr": 60.0,
            "max_hr": 190.0,
            "min_minutes": 60,
        },
        expected={"hrr": 0.077, "days": 1, "settled": True},  # (70-60)/130 = 0.077
        description="Sufficient quiet HR samples",
    ),
    TrimpTestVector(
        name="quiet_hrr_insufficient_data",
        input={
            "hr_per_min": [70, 71] * 10,  # Only 20 samples
            "resting_hr": 60.0,
            "max_hr": 190.0,
            "min_minutes": 60,
        },
        expected={"hrr": None, "days": 0, "settled": False},
        description="Insufficient quiet HR samples",
    ),

    # --- baseline_trimp ---
    TrimpTestVector(
        name="baseline_trimp_settled",
        input={
            "wake_minutes": 600,  # 10 hours wake
            "quiet_hrr": 0.30,
            "female": False,
        },
        expected={"baseline": 204.8, "reliable": True},
        description="Baseline TRIMP for 10h wake at 0.3 HRR, male",
    ),

    # --- net_trimp_above_quiet ---
    TrimpTestVector(
        name="net_trimp_above_quiet",
        input={
            "hr_per_min": [145] * 60,
            "resting_hr": 60.0,
            "max_hr": 190.0,
            "quiet_hrr": 0.30,
            "sex": "male",
        },
        expected={"net_above_quiet": 67.6},
        description="Net TRIMP above quiet for 60 min at 145 bpm",
    ),

    # --- strain_score ---
    TrimpTestVector(
        name="strain_score_low",
        input={"net_trimp_above_quiet": 10.0},
        expected={"strain": 1.85},  # strain_from_net_trimp(10) = 21 * ln(1 + 10/400 * 9) / ln(10) ≈ 1.85
        description="Low net TRIMP above quiet (10)",
    ),
    TrimpTestVector(
        name="strain_score_medium",
        input={"net_trimp_above_quiet": 100.0},
        expected={"strain": 10.75},  # strain_from_net_trimp(100)
        description="Medium net TRIMP above quiet (100)",
    ),
    TrimpTestVector(
        name="strain_score_high",
        input={"net_trimp_above_quiet": 300.0},
        expected={"strain": 18.68},  # strain_from_net_trimp(300)
        description="High net TRIMP above quiet (300)",
    ),

    # --- ctl_atl_tsb ---
    TrimpTestVector(
        name="ctl_atl_tsb_basic",
        input={
            "daily_trimp": [50.0] * 30,
        },
        expected={"ctl": 50.0, "atl": 50.0, "tsb": 0.0},
        description="Steady state: CTL=ATL, TSB=0",
    ),
    TrimpTestVector(
        name="ctl_atl_tsb_taper",
        input={
            "daily_trimp": [80.0] * 14 + [20.0] * 7,
        },
        expected={"ctl": 70.8, "atl": 42.1, "tsb": 28.7},
        description="Taper week: ATL drops, TSB positive",
    ),
]


# =============================================================================
# Sleep Staging Test Vectors
# Based on:
# - openstrap-analytics/lib/src/onehz/sleep/segment.dart (segmentSleep entry point)
# - openstrap-analytics/lib/src/onehz/sleep/cardio_stager.dart (cardioStager)
# - Cole-Kripke algorithm + HRV staging
# Key constants from Python:
#   DEFAULT_EPOCH_SEC = 30
#   STILL_CUT_G = 0.015
#   MOVE_CUT_G = 0.05
#   Z_ANGLE_STILL_DEG = 5.0
#   Epoch alignment: floor to epoch grid
# =============================================================================

@dataclass
class SleepTestVector:
    """Test vector for Sleep Staging."""
    name: str
    input: dict[str, Any]
    expected: dict[str, Any]
    description: str
    source: str = "openstrap_dart"


SLEEP_TEST_VECTORS: list[SleepTestVector] = [
    # --- compute_z_angle ---
    # Returns ZAngle(z_angle_deg=[...], ts_ms=[...]) - list of angles in DEGREES
    SleepTestVector(
        name="z_angle_flat",
        input={"x": 0.0, "y": 0.0, "z": 1.0},
        expected=0.0,  # Flat on back: z=1, mag=1, arccos(1)=0°
        description="Flat on back: z_angle = 0°",
    ),
    SleepTestVector(
        name="z_angle_side",
        input={"x": 1.0, "y": 0.0, "z": 0.0},
        expected=90.0,  # On side: z=0, mag=1, arccos(0)=90°
        description="On side: z_angle = 90°",
    ),
    SleepTestVector(
        name="z_angle_45_degrees",
        input={"x": 0.707, "y": 0.0, "z": 0.707},
        expected=45.0,  # 45 degrees
        description="45 degrees: z_angle ≈ 45°",
    ),
    SleepTestVector(
        name="z_angle_upside_down",
        input={"x": 0.0, "y": 0.0, "z": -1.0},
        expected=0.0,  # Upside down: |z|=1, arccos(1)=0° (abs used)
        description="Upside down: z_angle = 0° (abs z used)",
    ),

    # --- compute_immobility_mask ---
    # Returns ImmobilityMask(mask=[...], ts_ms=[...])
    SleepTestVector(
        name="immobility_all_still",
        input={
            "enmo_count": 100,
            "epoch_sec": 30,
            "still_threshold_g": 0.013,
            "window_sec": 300,
        },
        expected=[1] * 100,  # All immobile
        description="All epochs immobile",
    ),
    SleepTestVector(
        name="immobility_all_moving",
        input={
            "enmo_count": 100,
            "epoch_sec": 30,
            "still_threshold_g": 0.013,
            "move_threshold_g": 0.05,
            "window_sec": 300,
        },
        expected=[0] * 100,  # All moving
        description="All epochs moving",
    ),

    # --- van_hees_sleep_window ---
    # Returns list[SleepWindow]
    SleepTestVector(
        name="van_hees_clear_sleep",
        input={
            "immobile_count": 1840,  # 20 wake + 1800 sleep (30 min) + 20 wake = 1840 seconds
            "epoch_sec": 30,
            "in_bed_start_s": 0.0,
            "in_bed_end_s": 1840.0,
        },
        expected={"sleep_onset_s": 20.0, "sleep_offset_s": 1820.0},  # Returns seconds directly
        description="Clear sleep period detected (1800s immobile bout >= 30 min minimum)",
    ),

    # --- cardio_stager epoch features ---
    SleepTestVector(
        name="cardio_epoch_basic",
        input={
            "accel_count": 30,
            "hr_count": 30,
            "rr_count": 30,
            "epoch_sec": 30,
        },
        expected={"features_generated": True},
        description="Clean epoch with good HR and RR data",
    ),

    # --- segment_sleep (full pipeline) ---
    SleepTestVector(
        name="segment_sleep_short",
        input={
            "in_bed_duration_sec": 1800,  # 30 min
            "epoch_sec": 30,
        },
        expected={"total_epochs": 60, "has_stages": True},
        description="Short 30-min sleep session",
    ),
]


# =============================================================================
# Helper functions to run validation
# =============================================================================

def get_hrs_vectors() -> list[HrsTestVector]:
    """Get all HRS test vectors."""
    return HRS_TEST_VECTORS


def get_trimp_vectors() -> list[TrimpTestVector]:
    """Get all TRIMP test vectors."""
    return TRIMP_TEST_VECTORS


def get_sleep_vectors() -> list[SleepTestVector]:
    """Get all Sleep Staging test vectors."""
    return SLEEP_TEST_VECTORS


def get_all_vectors() -> dict[str, list]:
    """Get all test vectors grouped by algorithm."""
    return {
        "hrs": HRS_TEST_VECTORS,
        "trimp": TRIMP_TEST_VECTORS,
        "sleep_staging": SLEEP_TEST_VECTORS,
    }


# =============================================================================
# Dart Reference Outputs (to be populated when Dart is available)
# =============================================================================

# These will be populated by running the Dart reference implementation
# For now, they contain expected outputs based on Dart code analysis
DART_REFERENCE_OUTPUTS: dict[str, dict[str, Any]] = {
    # HRS: Key reference outputs from Dart parseHeartRateMeasurement
    "hrs": {
        "basic_8bit_hr_only": {"hr": 72, "rrMs": [], "contact": None},
        "basic_8bit_hr_contact_not_supported": {"hr": 72, "rrMs": [], "contact": None},
        "basic_8bit_hr_contact_supported_no_contact": {"hr": 72, "rrMs": [], "contact": False},
        "basic_8bit_hr_contact_supported_contact": {"hr": 72, "rrMs": [], "contact": True},
        "wide_16bit_hr_valid": {"hr": 300, "rrMs": [], "contact": None},
        "with_energy_expended": {"hr": 72, "rrMs": [], "contact": None},
        "single_rr_interval": {"hr": 72, "rrMs": [1000], "contact": None},
        "multiple_rr_intervals": {"hr": 72, "rrMs": [1000, 1000, 1156], "contact": None},
        "rr_with_contact": {"hr": 72, "rrMs": [1000], "contact": True},
        "rr_zero_ticks_filtered": {"hr": 72, "rrMs": [1000], "contact": None},
        "wide_hr_ee_rr_contact": {"hr": 300, "rrMs": [1000], "contact": True},
        "too_short": None,
        "hr_301_wide_rejected": None,
    },

    # TRIMP: Calibration anchors from Dart test file
    "trimp": {
        "45_min_run_145": 8.2,
        "60_min_run_150": 12.3,
        "90_min_run_140": 15.7,
        "30_min_intervals": 6.8,
    },

    # Sleep: Key reference points from Dart implementation
    "sleep": {
        "z_angle_flat": 0.0,
        "z_angle_side": 90.0,
        "immobility_all_still": [1] * 100,
        "immobility_all_moving": [0] * 100,
        "van_hees_clear_sleep": {"sleep_onset_s": 20.0, "sleep_offset_s": 1820.0},
    },
}


def get_dart_reference(algorithm: str, test_name: str) -> Any:
    """Get Dart reference output for a test."""
    return DART_REFERENCE_OUTPUTS.get(algorithm, {}).get(test_name)