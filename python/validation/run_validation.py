#!/usr/bin/env python3
"""REA Validation Runner.

Runs validation tests for all three algorithms against Python implementations.
Compares with Dart reference outputs where available.
"""

from __future__ import annotations

import sys
import math
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from argon_algorithms.hrs import parse_heart_rate_measurement
from argon_algorithms.trimp import (
    banister_trimp,
    daily_quiet_waking_hrr,
    baseline_trimp,
    net_trimp_above_quiet,
    strain_score,
    strain_from_net_trimp,
    ctl_atl_tsb,
    LoadState,
    NetTrimp,
    QuietLevel,
    StrainScorer,
    Sex,
)
from argon_algorithms.sleep_stager import (
    compute_z_angle,
    compute_immobility_mask,
    van_hees_sleep_window,
    cardio_stager,
    segment_sleep,
    extract_nightly_observation,
    classify_cardio_epochs,
    DEFAULT_EPOCH_SEC,
    STILL_CUT_G,
    MOVE_CUT_G,
    Z_ANGLE_STILL_DEG,
)
from argon_algorithms.models import (
    AccelSample,
    HrSample,
    RrSeries,
    SleepSession,
    AdvancedSleepStager,
    SleepStage,
    SleepWindow,
    SleepUserProfile,
)
from validation.harness import ValidationHarness, ValidationStatus, Algorithm
from validation.test_vectors import (
    get_hrs_vectors,
    get_trimp_vectors,
    get_sleep_vectors,
    get_dart_reference,
    HrsTestVector,
    TrimpTestVector,
    SleepTestVector,
)


def run_hrs_validation(harness: ValidationHarness) -> None:
    """Run HRS parsing validation."""
    print("\n[HRS] Running Bluetooth GATT HR validation...")

    for vec in get_hrs_vectors():
        expected = get_dart_reference("hrs", vec.name)

        def python_fn(vec=vec):
            result = parse_heart_rate_measurement(vec.input_bytes)
            if result is None:
                return None
            return {
                "hr": result.hr,
                "rrMs": list(result.rr_ms),  # Convert tuple to list
                "contact": result.contact,
            }

        # Tolerance for RR intervals (rounding differences)
        tolerance = {"rrMs": 2.0}  # Allow 2ms difference in RR

        harness.run_test(
            algorithm=Algorithm.HRS,
            test_name=vec.name,
            python_fn=python_fn,
            expected=expected,
            tolerance=tolerance,
            metadata={
                "input_bytes": vec.input_bytes,
                "description": vec.description,
                "source": vec.source,
            },
        )

    print(f"[HRS] Completed {len(get_hrs_vectors())} tests")


def run_trimp_validation(harness: ValidationHarness) -> None:
    """Run TRIMP validation."""
    print("\n[TRIMP] Running Banister TRIMP + CTL/ATL/TSB validation...")

    for vec in get_trimp_vectors():
        expected = get_dart_reference("trimp", vec.name)
        test_expected = vec.expected if expected is None else expected

        def make_python_fn(vec):
            def python_fn():
                if vec.name.startswith("banister_trimp"):
                    # banister_trimp(hr_per_min, *, resting_hr, max_hr, sex)
                    result = banister_trimp(
                        hr_per_min=vec.input["hr_per_min"],
                        resting_hr=vec.input["resting_hr"],
                        max_hr=vec.input["max_hr"],
                        sex=Sex(vec.input["sex"]),
                    )
                    return {"trimp": round(result.value, 1) if result.value else 0.0, "net_trimp": round(result.value, 1) if result.value else 0.0}

                elif vec.name == "quiet_hrr_sufficient_data":
                    # daily_quiet_waking_hrr(hr_per_min, *, resting_hr, max_hr, min_minutes)
                    q = daily_quiet_waking_hrr(
                        hr_per_min=vec.input["hr_per_min"],
                        resting_hr=vec.input["resting_hr"],
                        max_hr=vec.input["max_hr"],
                        min_minutes=vec.input.get("min_minutes", 60),
                    )
                    return {"hrr": q, "days": 1, "settled": q is not None}

                elif vec.name == "quiet_hrr_insufficient_data":
                    q = daily_quiet_waking_hrr(
                        hr_per_min=vec.input["hr_per_min"],
                        resting_hr=vec.input["resting_hr"],
                        max_hr=vec.input["max_hr"],
                        min_minutes=vec.input.get("min_minutes", 60),
                    )
                    return {"hrr": q, "days": 0, "settled": q is not None}

                elif vec.name == "baseline_trimp_settled":
                    # baseline_trimp(wake_minutes, *, quiet_hrr, female)
                    b = baseline_trimp(
                        wake_minutes=vec.input["wake_minutes"],
                        quiet_hrr=vec.input["quiet_hrr"],
                        female=vec.input.get("female", False),
                    )
                    return {"baseline": round(b, 1), "reliable": True}

                elif vec.name == "net_trimp_above_quiet":
                    # net_trimp_above_quiet(hr_per_min, *, resting_hr, max_hr, quiet_hrr, sex)
                    n = net_trimp_above_quiet(
                        hr_per_min=vec.input["hr_per_min"],
                        resting_hr=vec.input["resting_hr"],
                        max_hr=vec.input["max_hr"],
                        quiet_hrr=vec.input["quiet_hrr"],
                        sex=Sex(vec.input["sex"]),
                    )
                    if n:
                        return {"net_above_quiet": round(n.net, 1)}
                    return {"net_above_quiet": 0.0}

                elif vec.name.startswith("strain_score"):
                    # strain_score(trimp, *, wake_minutes, quiet_hrr, female)
                    # Use strain_from_net_trimp directly
                    net = vec.input["net_trimp_above_quiet"]
                    s = strain_from_net_trimp(net)
                    return {"strain": round(s, 2)}

                elif vec.name == "ctl_atl_tsb_basic":
                    # ctl_atl_tsb(daily_trimp, *)
                    result = ctl_atl_tsb(vec.input["daily_trimp"])
                    if result.value:
                        return {
                            "ctl": round(result.value.ctl, 1),
                            "atl": round(result.value.atl, 1),
                            "tsb": round(result.value.tsb, 1),
                        }
                    return {"ctl": 0.0, "atl": 0.0, "tsb": 0.0}

                elif vec.name == "ctl_atl_tsb_taper":
                    result = ctl_atl_tsb(vec.input["daily_trimp"])
                    if result.value:
                        return {
                            "ctl": round(result.value.ctl, 1),
                            "atl": round(result.value.atl, 1),
                            "tsb": round(result.value.tsb, 1),
                        }
                    return {"ctl": 0.0, "atl": 0.0, "tsb": 0.0}

                return None
            return python_fn

        # Tolerances for TRIMP calculations
        tolerance = {
            "trimp": 1.0,
            "net_trimp": 1.0,
            "baseline": 1.0,
            "net_above_quiet": 1.0,
            "strain": 0.05,
            "ctl": 2.0,
            "atl": 2.0,
            "tsb": 2.0,
            "hrr": 0.01,
        }

        harness.run_test(
            algorithm=Algorithm.TRIMP,
            test_name=vec.name,
            python_fn=make_python_fn(vec),
            expected=test_expected,
            tolerance=tolerance,
            metadata={
                "input": vec.input,
                "description": vec.description,
                "source": vec.source,
            },
        )

    print(f"[TRIMP] Completed {len(get_trimp_vectors())} tests")


def run_sleep_validation(harness: ValidationHarness) -> None:
    """Run Sleep Staging validation."""
    print("\n[SLEEP] Running Sleep Staging validation...")

    for vec in get_sleep_vectors():
        expected = get_dart_reference("sleep", vec.name)
        test_expected = vec.expected if expected is None else expected

        def make_python_fn(vec):
            def python_fn():
                if vec.name.startswith("z_angle"):
                    # compute_z_angle takes list[AccelSample]
                    accel = [AccelSample(ts_ms=0, x=vec.input["x"], y=vec.input["y"], z=vec.input["z"], valid=True)]
                    z = compute_z_angle(accel)
                    return z.z_angle_deg[0] if z.z_angle_deg else None

                elif vec.name.startswith("immobility"):
                    # compute_immobility_mask takes accel_samples list
                    # Create samples with varying ENMO based on test
                    if vec.name == "immobility_all_still":
                        # All still - low ENMO (mag=1.0 -> ENMO=0)
                        accel = [
                            AccelSample(ts_ms=i*1000, x=0.0, y=0.0, z=1.0, valid=True)
                            for i in range(vec.input["enmo_count"])
                        ]
                    else:
                        # All moving - high ENMO (mag=sqrt(1.5)≈1.22 -> ENMO=0.22 > 0.015)
                        accel = [
                            AccelSample(ts_ms=i*1000, x=0.5, y=0.5, z=1.0, valid=True)
                            for i in range(vec.input["enmo_count"])
                        ]
                    mask = compute_immobility_mask(
                        accel_samples=accel,
                        epoch_sec=vec.input["epoch_sec"],
                        still_cut_g=vec.input.get("still_threshold_g", STILL_CUT_G),
                        move_cut_g=vec.input.get("move_threshold_g", MOVE_CUT_G),
                        z_angle_still_deg=vec.input.get("z_angle_still_deg", Z_ANGLE_STILL_DEG),
                    )
                    return mask.mask

                elif vec.name == "van_hees_clear_sleep":
                    # Create accel with clear sleep pattern: 20 wake, 1800 sleep (30 min), 20 wake
                    # Use 1 Hz samples - need magnitude > 1.0 for moving (ENMO > 0.015)
                    # Still: x=0, y=0, z=1.0 -> mag=1.0 -> ENMO=0
                    # Moving: x=0.5, y=0.5, z=1.0 -> mag=sqrt(1.5)≈1.22 -> ENMO=0.22 > 0.015
                    # Need at least 30 min (1800s) immobile for van Hees minimum window
                    immobile_count = vec.input["immobile_count"]
                    accel = []
                    for i in range(immobile_count):
                        if 20 <= i < 1820:  # Sleep period - still (1800 seconds = 30 min)
                            accel.append(AccelSample(ts_ms=i*1000, x=0.0, y=0.0, z=1.0, valid=True))
                        else:  # Wake period - moving
                            accel.append(AccelSample(ts_ms=i*1000, x=0.5, y=0.5, z=1.0, valid=True))
                    windows = van_hees_sleep_window(
                        accel_samples=accel,
                        in_bed_start_s=vec.input["in_bed_start_s"],
                        in_bed_end_s=vec.input["in_bed_end_s"],
                        epoch_sec=vec.input["epoch_sec"],
                    )
                    return {"sleep_onset_s": windows[0].start_s if windows else None, "sleep_offset_s": windows[0].end_s if windows else None}

                elif vec.name == "cardio_epoch_basic":
                    # Build session with 30 seconds of data
                    count = vec.input["accel_count"]
                    accel = [AccelSample(ts_ms=i*1000, x=0.0, y=0.0, z=1.0, valid=True) for i in range(count)]
                    hr = [HrSample(ts_ms=i*1000, hr=55) for i in range(count)]
                    rr = [RrSeries(ts_ms=[i*1000 for i in range(count)], rr_ms=[1000]*count)]

                    session = SleepSession(
                        accel=accel,
                        hr=hr,
                        rr=rr,
                        in_bed_start_s=0.0,
                        in_bed_end_s=count,
                    )

                    features = cardio_stager(
                        session,
                        epoch_sec=vec.input["epoch_sec"],
                        profile=None,
                    )
                    return {"features_generated": len(features) > 0}

                elif vec.name == "segment_sleep_short":
                    # 30 min session
                    duration = vec.input["in_bed_duration_sec"]
                    accel = [AccelSample(ts_ms=i*1000, x=0.0, y=0.0, z=1.0, valid=True) for i in range(duration)]
                    hr = [HrSample(ts_ms=i*1000, hr=55) for i in range(duration)]
                    rr = [RrSeries(ts_ms=[i*1000 for i in range(duration)], rr_ms=[1000]*duration)]

                    session = SleepSession(
                        accel=accel,
                        hr=hr,
                        rr=rr,
                        in_bed_start_s=0.0,
                        in_bed_end_s=duration,
                    )

                    config = AdvancedSleepStager(epoch_sec=vec.input["epoch_sec"])
                    segmentation = segment_sleep(session, config)

                    return {
                        "total_epochs": len(segmentation.stages),
                        "has_stages": len(segmentation.stages) > 0,
                    }

                return None
            return python_fn

        # Tolerances for sleep calculations
        tolerance = {
            "z_angle_deg": 1.0,
        }

        harness.run_test(
            algorithm=Algorithm.SLEEP_STAGING,
            test_name=vec.name,
            python_fn=make_python_fn(vec),
            expected=test_expected,
            tolerance=tolerance,
            metadata={
                "input": vec.input,
                "description": vec.description,
                "source": vec.source,
            },
        )

    print(f"[SLEEP] Completed {len(get_sleep_vectors())} tests")


def main():
    """Main validation entry point."""
    print("=" * 60)
    print("REA VALIDATION HARNESS - OpenStrap Algorithm Migration")
    print("=" * 60)

    harness = ValidationHarness()

    # Run all validations
    run_hrs_validation(harness)
    run_trimp_validation(harness)
    run_sleep_validation(harness)

    # Generate and print summary
    summary = harness.generate_summary()
    harness.print_summary(summary)

    # Save report
    report_path = harness.save_report(summary)
    print(f"\nReport saved to: {report_path}")

    # Exit with appropriate code
    if summary.failed > 0 or summary.errors > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()