"""Bluetooth SIG Heart Rate Service (0x180D) — Heart Rate Measurement (0x2A37) parser.

Ported from protocol/lib/src/hrs.dart.

Pure function with no hardware dependencies. Verified against Bluetooth SIG
Heart Rate Service 1.0 layout specification.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class HrsSample:
    """One Heart Rate Measurement notification."""

    hr: int  # Beats per minute as the sensor reported it
    rr_ms: tuple[int, ...]  # Beat-to-beat durations in milliseconds
    contact: bool | None  # Sensor's contact claim: True/False when reported, None when unsupported


def parse_heart_rate_measurement(value: bytes | list[int]) -> HrsSample | None:
    """Parse a Heart Rate Measurement (0x2A37) value.

    Layout (Bluetooth SIG, Heart Rate Service 1.0):
      byte 0  flags
        bit 0  HR format: 0 = uint8, 1 = uint16 little-endian
        bits 1-2  sensor contact: 0b00/0b01 = not supported, 0b10 = no contact,
                  0b11 = contact
        bit 3  Energy Expended present (uint16, kJ) — skipped, we do not use it
        bit 4  RR-Interval present (one or more uint16, units of 1/1024 s)
      then HR, then energy expended if present, then RR intervals to the end.

    Returns None for a value that cannot be read as this characteristic (too
    short, or a truncated field). A malformed notification is DROPPED, never
    patched up into a plausible-looking beat.
    """
    if isinstance(value, bytes):
        value = list(value)

    if len(value) < 2:
        return None

    flags = value[0]
    wide = (flags & 0x01) != 0
    i = 1

    # Parse HR
    if wide:
        if len(value) < 3:
            return None
        hr = value[1] | (value[2] << 8)
        i = 3
    else:
        hr = value[1]
        i = 2

    # 0 bpm is not a measurement. Sensors emit it while searching for a signal;
    # storing it would put a real-looking zero into a heart-rate series.
    if hr <= 0 or hr > 300:
        return None

    # Parse sensor contact
    contact_bits = (flags >> 1) & 0x03
    contact = None if contact_bits < 2 else contact_bits == 3

    # Energy Expended is a fixed 2-byte field ONCE the flag says it is present
    # — a notification that sets the bit but doesn't carry both bytes is
    # truncated, not "the field happens to be shorter here", so it is refused
    # outright rather than silently walked past.
    if (flags & 0x08) != 0:
        if i + 2 > len(value):
            return None
        i += 2  # energy expended — present, not used

    # Parse RR intervals
    rr = []
    if (flags & 0x10) != 0:
        # Trailing RR intervals, uint16 LE, 1/1024 s each. An ODD remainder means
        # the buffer ends mid-field — every earlier field's offset is only as
        # trustworthy as the notification's own declared length, so a short tail
        # refuses the whole notification instead of quietly keeping what parsed.
        if (len(value) - i) % 2 != 0:
            return None
        while i + 1 < len(value):
            ticks = value[i] | (value[i + 1] << 8)
            i += 2
            # 1024 ticks = 1 s. Round to the nearest millisecond.
            ms = (ticks * 1000 + 512) // 1024
            # Zero ticks is no interval at all. Every other value passes through
            # unfiltered: the physiological bound lives in ONE place downstream.
            if ticks != 0:
                rr.append(ms)

    return HrsSample(hr=hr, rr_ms=tuple(rr), contact=contact)
