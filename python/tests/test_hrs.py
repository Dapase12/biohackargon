"""Tests for HRS parser — test-driven development against Bluetooth SIG test vectors.

Mirrors protocol/test/hrs_test.dart fixtures.
"""

import pytest

from argon_algorithms.hrs import parse_heart_rate_measurement


class TestParseHeartRateMeasurement:
    """Test cases for Bluetooth SIG Heart Rate Measurement parsing."""

    def test_uint8_hr_no_rr_no_contact(self):
        """uint8 HR, no RR, no contact, no energy expended."""
        # Flags: 0b00000000 = 0x00
        # HR: 0x4B (75 bpm)
        value = bytes([0x00, 0x4B])
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.hr == 75
        assert result.rr_ms == ()
        assert result.contact is None

    def test_uint8_hr_with_rr_no_contact(self):
        """uint8 HR with RR intervals, no contact."""
        # Flags: 0b00010000 = 0x10 (RR present)
        # HR: 0x4B (75 bpm)
        # RR: 1000 ticks (977 ms), 1024 ticks (1000 ms)
        # 1000 ticks = 1000*1000/1024 = 976.5625 -> 977 ms
        # 1024 ticks = 1024*1000/1024 = 1000 ms
        value = bytes([0x10, 0x4B, 0xE8, 0x03, 0x00, 0x04])
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.hr == 75
        assert result.rr_ms == (977, 1000)
        assert result.contact is None

    def test_uint16_hr_no_rr(self):
        """uint16 HR (little-endian), no RR."""
        # Flags: 0b00000001 = 0x01 (uint16 HR)
        # HR: 0x0082 (130 bpm) -> 0x82 0x00 in LE
        value = bytes([0x01, 0x82, 0x00])
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.hr == 130
        assert result.rr_ms == ()
        assert result.contact is None

    def test_uint16_hr_with_contact_supported_true(self):
        """uint16 HR with contact supported (bit 1-2 = 0b11)."""
        # Flags: 0b00000111 = 0x07 (uint16 HR + contact supported)
        # HR: 0x0078 (120 bpm)
        value = bytes([0x07, 0x78, 0x00])
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.hr == 120
        assert result.contact is True

    def test_uint8_hr_with_contact_supported_false(self):
        """uint8 HR with contact supported but no contact (bit 1-2 = 0b10)."""
        # Flags: 0b00000100 = 0x04 (contact supported, no contact)
        # HR: 0x5A (90 bpm)
        value = bytes([0x04, 0x5A])
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.hr == 90
        assert result.contact is False

    def test_uint8_hr_with_energy_expended(self):
        """uint8 HR with energy expended present."""
        # Flags: 0b00001000 = 0x08 (energy expended)
        # HR: 0x64 (100 bpm)
        # Energy: 0x0010 (16 kJ) -> 0x10 0x00 in LE
        value = bytes([0x08, 0x64, 0x10, 0x00])
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.hr == 100
        assert result.rr_ms == ()

    def test_uint8_hr_with_energy_and_rr(self):
        """uint8 HR with both energy expended and RR intervals."""
        # Flags: 0b00011000 = 0x18 (energy + RR)
        # HR: 0x50 (80 bpm)
        # Energy: 0x0020 (32 kJ)
        # RR: 1024 ticks (1000 ms)
        value = bytes([0x18, 0x50, 0x20, 0x00, 0x00, 0x04])
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.hr == 80
        assert result.rr_ms == (1000,)

    def test_truncated_uint16_hr(self):
        """Truncated uint16 HR (only 2 bytes instead of 3)."""
        value = bytes([0x01, 0x4B])  # flags say uint16 but only 1 byte for HR
        result = parse_heart_rate_measurement(value)
        assert result is None

    def test_zero_hr_rejected(self):
        """HR = 0 is rejected (off-skin/searching)."""
        value = bytes([0x00, 0x00])
        result = parse_heart_rate_measurement(value)
        assert result is None

    def test_hr_above_300_rejected(self):
        """HR > 300 is rejected as implausible."""
        value = bytes([0x01, 0x2D, 0x01])  # 301 bpm in uint16
        result = parse_heart_rate_measurement(value)
        assert result is None

    def test_truncated_energy_expended(self):
        """Energy expended flag set but only 1 byte provided."""
        # Flags: 0x08 (energy), HR: 0x4B, only 1 byte for energy
        value = bytes([0x08, 0x4B, 0x10])
        result = parse_heart_rate_measurement(value)
        assert result is None

    def test_odd_rr_remainder_rejected(self):
        """Odd number of bytes for RR intervals is rejected."""
        # Flags: 0x10 (RR present), HR: 0x4B, 3 bytes for RR (1.5 uint16s)
        value = bytes([0x10, 0x4B, 0xE8, 0x03, 0x00])
        result = parse_heart_rate_measurement(value)
        assert result is None

    def test_zero_rr_ticks_filtered(self):
        """Zero RR ticks are filtered out (not a valid interval)."""
        # Flags: 0x10, HR: 0x4B, RR: 0 ticks, 1024 ticks
        value = bytes([0x10, 0x4B, 0x00, 0x00, 0x00, 0x04])
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.rr_ms == (1000,)

    def test_rr_rounding(self):
        """RR ticks correctly rounded to nearest millisecond."""
        # 1 tick = 1000/1024 = 0.9765625 ms -> 1 ms
        # 1023 ticks = 1023*1000/1024 = 999.023... -> 999 ms
        value = bytes([0x10, 0x4B, 0x01, 0x00, 0xFF, 0x03])
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.rr_ms == (1, 999)

    def test_empty_input(self):
        """Empty input returns None."""
        result = parse_heart_rate_measurement(bytes([]))
        assert result is None

    def test_single_byte_input(self):
        """Single byte input returns None."""
        result = parse_heart_rate_measurement(bytes([0x00]))
        assert result is None

    def test_list_input_accepted(self):
        """List[int] input is accepted (not just bytes)."""
        value = [0x00, 0x4B]
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.hr == 75

    def test_contact_bits_not_supported(self):
        """Contact bits 0b00 and 0b01 both mean not supported."""
        # 0b00
        value1 = bytes([0x00, 0x4B])
        result1 = parse_heart_rate_measurement(value1)
        assert result1 is not None
        assert result1.contact is None

        # 0b01 (flags = 0x02)
        value2 = bytes([0x02, 0x4B])
        result2 = parse_heart_rate_measurement(value2)
        assert result2 is not None
        assert result2.contact is None

    def test_multiple_rr_intervals(self):
        """Multiple RR intervals parsed correctly."""
        # HR 60 bpm, RR: 1000, 1024, 1048, 1072 ticks
        value = bytes([
            0x10, 0x3C,  # flags + HR
            0xE8, 0x03,  # 1000 ticks -> 977 ms
            0x00, 0x04,  # 1024 ticks -> 1000 ms
            0x18, 0x04,  # 1048 ticks -> 1023 ms
            0x30, 0x04,  # 1072 ticks -> 1047 ms
        ])
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.hr == 60
        assert result.rr_ms == (977, 1000, 1023, 1047)

    def test_hr_boundary_1_bpm(self):
        """HR = 1 is accepted (minimum valid)."""
        value = bytes([0x00, 0x01])
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.hr == 1

    def test_hr_boundary_300_bpm(self):
        """HR = 300 is accepted (maximum valid)."""
        value = bytes([0x01, 0x2C, 0x01])  # 300 in uint16 LE
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.hr == 300

    def test_rr_large_values(self):
        """Large RR values (up to 65535 ticks = ~64 seconds) accepted."""
        # 65535 ticks = 65535 * 1000 / 1024 = 63999 ms
        value = bytes([0x10, 0x4B, 0xFF, 0xFF])
        result = parse_heart_rate_measurement(value)
        assert result is not None
        assert result.rr_ms == (63999,)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
