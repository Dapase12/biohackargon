"""REA Validation Harness - Core validation logic.

Runs Python implementations against test vectors and compares with
expected outputs (from Dart reference implementation when available).
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional
from enum import Enum


class Algorithm(Enum):
    """Algorithms being validated."""
    HRS = "hrs"                    # Bluetooth GATT HR decoding (0x2A37)
    TRIMP = "trimp"                # Banister TRIMP + CTL/ATL/TSB
    SLEEP_STAGING = "sleep_staging"  # Cole-Kripke/Webster + HRV


class ValidationStatus(Enum):
    """Validation result status."""
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"
    ERROR = "error"


@dataclass
class ValidationResult:
    """Result of a single validation test case."""
    algorithm: Algorithm
    test_name: str
    status: ValidationStatus
    python_output: Any = None
    expected_output: Any = None
    difference: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    execution_time_ms: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        d = asdict(self)
        d["algorithm"] = self.algorithm.value
        d["status"] = self.status.value
        return d


@dataclass
class ValidationSummary:
    """Summary of validation run."""
    timestamp: str
    total_tests: int
    passed: int
    failed: int
    skipped: int
    errors: int
    total_time_ms: float
    results: list[ValidationResult]

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "timestamp": self.timestamp,
            "total_tests": self.total_tests,
            "passed": self.passed,
            "failed": self.failed,
            "skipped": self.skipped,
            "errors": self.errors,
            "total_time_ms": self.total_time_ms,
            "results": [r.to_dict() for r in self.results],
        }

    def pass_rate(self) -> float:
        """Calculate pass rate (excluding skipped)."""
        total = self.total_tests - self.skipped
        if total == 0:
            return 0.0
        return self.passed / total * 100


class ValidationHarness:
    """Main validation harness for running algorithm comparisons."""

    def __init__(self, output_dir: Optional[Path] = None):
        """Initialize validation harness.

        Args:
            output_dir: Directory for validation reports. Defaults to validation/reports/
        """
        self.output_dir = output_dir or Path(__file__).parent / "reports"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.results: list[ValidationResult] = []

    def run_test(
        self,
        algorithm: Algorithm,
        test_name: str,
        python_fn: Callable[[], Any],
        expected: Any = None,
        tolerance: Optional[dict[str, float]] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> ValidationResult:
        """Run a single validation test.

        Args:
            algorithm: Algorithm being tested
            test_name: Descriptive test name
            python_fn: Callable that returns Python implementation output
            expected: Expected output (from Dart reference)
            tolerance: Per-field tolerance for numeric comparison
            metadata: Additional metadata

        Returns:
            ValidationResult with comparison outcome
        """
        start = time.perf_counter()
        try:
            python_output = python_fn()
            exec_time = (time.perf_counter() - start) * 1000

            if expected is None:
                result = ValidationResult(
                    algorithm=algorithm,
                    test_name=test_name,
                    status=ValidationStatus.SKIP,
                    python_output=python_output,
                    execution_time_ms=exec_time,
                    metadata=metadata or {},
                )
            else:
                diff = self._compare_outputs(python_output, expected, tolerance)
                status = ValidationStatus.PASS if diff is None else ValidationStatus.FAIL
                result = ValidationResult(
                    algorithm=algorithm,
                    test_name=test_name,
                    status=status,
                    python_output=python_output,
                    expected_output=expected,
                    difference=diff,
                    execution_time_ms=exec_time,
                    metadata=metadata or {},
                )

        except Exception as e:
            exec_time = (time.perf_counter() - start) * 1000
            result = ValidationResult(
                algorithm=algorithm,
                test_name=test_name,
                status=ValidationStatus.ERROR,
                error_message=str(e),
                execution_time_ms=exec_time,
                metadata=metadata or {},
            )

        self.results.append(result)
        return result

    def _compare_outputs(
        self,
        actual: Any,
        expected: Any,
        tolerance: Optional[dict[str, float]] = None,
        path: str = "",
    ) -> Optional[dict[str, Any]]:
        """Recursively compare two outputs with tolerance for floats.

        Returns:
            None if outputs match within tolerance, otherwise difference dict
        """
        if type(actual) != type(expected):
            return {"path": path, "actual_type": type(actual).__name__, "expected_type": type(expected).__name__}

        if isinstance(actual, dict):
            all_keys = set(actual.keys()) | set(expected.keys())
            diffs = []
            for k in sorted(all_keys):
                new_path = f"{path}.{k}" if path else k
                if k not in actual:
                    diffs.append({"path": new_path, "issue": "missing_in_actual"})
                elif k not in expected:
                    diffs.append({"path": new_path, "issue": "missing_in_expected"})
                else:
                    diff = self._compare_outputs(actual[k], expected[k], tolerance, new_path)
                    if diff:
                        diffs.append(diff)
            return {"path": path, "differences": diffs} if diffs else None

        if isinstance(actual, list):
            if len(actual) != len(expected):
                return {"path": path, "actual_len": len(actual), "expected_len": len(expected)}
            diffs = []
            for i, (a, e) in enumerate(zip(actual, expected)):
                diff = self._compare_outputs(a, e, tolerance, f"{path}[{i}]")
                if diff:
                    diffs.append(diff)
            return {"path": path, "differences": diffs} if diffs else None

        if isinstance(actual, float) and isinstance(expected, float):
            tol = tolerance.get(path, 1e-9) if tolerance else 1e-9
            if abs(actual - expected) > tol:
                return {"path": path, "actual": actual, "expected": expected, "diff": abs(actual - expected), "tolerance": tol}
            return None

        if actual != expected:
            return {"path": path, "actual": actual, "expected": expected}

        return None

    def generate_summary(self) -> ValidationSummary:
        """Generate validation summary from results."""
        return ValidationSummary(
            timestamp=datetime.now().isoformat(),
            total_tests=len(self.results),
            passed=sum(1 for r in self.results if r.status == ValidationStatus.PASS),
            failed=sum(1 for r in self.results if r.status == ValidationStatus.FAIL),
            skipped=sum(1 for r in self.results if r.status == ValidationStatus.SKIP),
            errors=sum(1 for r in self.results if r.status == ValidationStatus.ERROR),
            total_time_ms=sum(r.execution_time_ms for r in self.results),
            results=self.results,
        )

    def save_report(self, summary: ValidationSummary, filename: Optional[str] = None) -> Path:
        """Save validation report to JSON file."""
        if filename is None:
            filename = f"validation_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        filepath = self.output_dir / filename
        with open(filepath, "w") as f:
            json.dump(summary.to_dict(), f, indent=2, default=str)
        return filepath

    def print_summary(self, summary: ValidationSummary) -> None:
        """Print validation summary to console."""
        print("\n" + "=" * 60)
        print("VALIDATION SUMMARY")
        print("=" * 60)
        print(f"Timestamp: {summary.timestamp}")
        print(f"Total Tests: {summary.total_tests}")
        print(f"  Passed:  {summary.passed}")
        print(f"  Failed:  {summary.failed}")
        print(f"  Skipped: {summary.skipped}")
        print(f"  Errors:  {summary.errors}")
        print(f"Pass Rate: {summary.pass_rate():.1f}%")
        print(f"Total Time: {summary.total_time_ms:.1f}ms")
        print("=" * 60)

        # Print failures
        failed = [r for r in summary.results if r.status == ValidationStatus.FAIL]
        if failed:
            print("\nFAILURES:")
            for r in failed:
                print(f"  [{r.algorithm.value}] {r.test_name}")
                if r.difference:
                    print(f"    Diff: {json.dumps(r.difference, indent=6, default=str)}")

        errors = [r for r in summary.results if r.status == ValidationStatus.ERROR]
        if errors:
            print("\nERRORS:")
            for r in errors:
                print(f"  [{r.algorithm.value}] {r.test_name}: {r.error_message}")

        print("=" * 60)