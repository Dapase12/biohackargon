"""REA Validation Harness for OpenStrap Algorithm Migration.

This module provides validation infrastructure to compare Python implementations
against OpenStrap Dart reference outputs.
"""

from .harness import ValidationHarness, ValidationResult
from .test_vectors import (
    get_hrs_vectors,
    get_trimp_vectors,
    get_sleep_vectors,
    get_dart_reference,
    HrsTestVector,
    TrimpTestVector,
    SleepTestVector,
)

__all__ = [
    "ValidationHarness",
    "ValidationResult",
    "get_hrs_vectors",
    "get_trimp_vectors",
    "get_sleep_vectors",
    "get_dart_reference",
    "HrsTestVector",
    "TrimpTestVector",
    "SleepTestVector",
]