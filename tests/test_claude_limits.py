"""Tests unitaires de scripts/claude_limits.py (parsing, sans réseau)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.claude_limits import parse_usage_payload, trim_snapshots

TIMESTAMP = "2026-07-14T08:00:00+00:00"


def make_payload(**overrides):
    payload = {
        "five_hour": {"utilization": 25, "resets_at": "2026-07-14T12:36:00+00:00"},
        "seven_day": {"utilization": 11, "resets_at": "2026-07-20T10:00:00+00:00"},
        "limits": [
            {
                "kind": "weekly_scoped",
                "percent": 19,
                "resets_at": "2026-07-20T10:00:00+00:00",
                "scope": {"model": {"display_name": "Fable"}},
            }
        ],
    }
    return {**payload, **overrides}


class TestParseUsagePayload:
    def test_parses_session_weekly_and_scoped(self):
        # Act
        snapshot = parse_usage_payload(make_payload(), TIMESTAMP)

        # Assert
        assert snapshot["timestamp"] == TIMESTAMP
        assert snapshot["session"] == {
            "pct": 25.0, "resets_at": "2026-07-14T12:36:00+00:00"}
        assert snapshot["weekly"]["pct"] == 11.0
        assert snapshot["scoped"] == {
            "label": "Fable", "pct": 19.0,
            "resets_at": "2026-07-20T10:00:00+00:00"}

    def test_no_scoped_limit_gives_none(self):
        snapshot = parse_usage_payload(make_payload(limits=[]), TIMESTAMP)
        assert snapshot["scoped"] is None

    def test_keeps_most_utilized_scoped_limit(self):
        # Arrange
        limits = [
            {"kind": "weekly_scoped", "percent": 5,
             "scope": {"model": {"display_name": "Opus"}}},
            {"kind": "weekly_scoped", "percent": 42,
             "scope": {"model": {"display_name": "Fable"}}},
        ]

        # Act
        snapshot = parse_usage_payload(make_payload(limits=limits), TIMESTAMP)

        # Assert
        assert snapshot["scoped"]["label"] == "Fable"
        assert snapshot["scoped"]["pct"] == 42.0

    def test_clamps_invalid_percentages(self):
        payload = make_payload(
            five_hour={"utilization": "n/a", "resets_at": ""},
            seven_day={"utilization": 250, "resets_at": ""},
        )
        snapshot = parse_usage_payload(payload, TIMESTAMP)
        assert snapshot["session"]["pct"] == 0.0
        assert snapshot["weekly"]["pct"] == 100.0

    def test_rejects_non_dict_payload(self):
        with pytest.raises(ValueError):
            parse_usage_payload(["pas", "un", "dict"], TIMESTAMP)


class TestTrimSnapshots:
    def test_keeps_last_n_without_mutating_original(self):
        # Arrange
        original = {"entries": [{"i": i} for i in range(10)]}

        # Act
        trimmed = trim_snapshots(original, keep=3)

        # Assert
        assert [e["i"] for e in trimmed["entries"]] == [7, 8, 9]
        assert len(original["entries"]) == 10

    def test_short_document_unchanged(self):
        document = {"entries": [{"i": 1}]}
        assert trim_snapshots(document, keep=5) is document
