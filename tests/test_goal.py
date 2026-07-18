"""Tests unitaires de scripts/goal.py (métriques Money Mission, sans I/O)."""
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.goal import build_entry, compute_stats, validate_amount

CONFIG = {
    "amount": 25_000.0,
    "goal_date": "2026-12-31",
    "start_date": "2026-01-01",
    "currency": "€",
}
TODAY = date(2026, 7, 18)


def make_entry(amount, day="2026-07-10"):
    return {"timestamp": f"{day}T10:00:00+00:00", "amount": amount, "note": ""}


class TestValidateAmount:
    def test_accepts_normal_amount(self):
        assert validate_amount("150.505") == 150.5

    def test_rejects_zero_negative_and_huge(self):
        for bad in (0, -5, 2_000_000):
            with pytest.raises(ValueError):
                validate_amount(bad)

    def test_rejects_non_numeric(self):
        with pytest.raises(ValueError, match="invalide"):
            validate_amount("abc")


class TestBuildEntry:
    def test_builds_valid_entry(self):
        entry = build_entry(99.9, "  Mission client  ", "2026-07-18T09:00:00+00:00")
        assert entry == {
            "timestamp": "2026-07-18T09:00:00+00:00",
            "amount": 99.9,
            "note": "Mission client",
        }

    def test_rejects_oversized_note(self):
        with pytest.raises(ValueError):
            build_entry(10, "x" * 201)


class TestComputeStats:
    def test_progress_pace_and_projection(self):
        # Arrange — 10 000 € gagnés en 199 jours (01/01 -> 18/07)
        entries = [make_entry(6_000), make_entry(4_000, day="2026-07-18")]

        # Act
        stats = compute_stats(entries, CONFIG, today=TODAY)

        # Assert
        assert stats["total"] == 10_000
        assert stats["today"] == 4_000
        assert stats["remaining"] == 15_000
        assert stats["progress_pct"] == 40.0
        assert stats["days_left"] == (date(2026, 12, 31) - TODAY).days
        assert stats["pace_per_day"] == round(10_000 / 198, 2)
        assert stats["projected_end"] == round(
            10_000 + stats["pace_per_day"] * stats["days_left"], 2)

    def test_on_track_flag(self):
        rich = [make_entry(20_000, day="2026-02-01")]
        poor = [make_entry(100, day="2026-02-01")]
        assert compute_stats(rich, CONFIG, today=TODAY)["is_on_track"] is True
        assert compute_stats(poor, CONFIG, today=TODAY)["is_on_track"] is False

    def test_empty_entries(self):
        stats = compute_stats([], CONFIG, today=TODAY)
        assert stats["total"] == 0
        assert stats["progress_pct"] == 0.0
        assert stats["projected_end"] == 0
