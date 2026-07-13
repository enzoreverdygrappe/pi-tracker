"""Tests unitaires de scripts/claude_usage.py."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.claude_usage import (
    build_entry,
    format_recent_sessions,
    log_session,
    validate_session,
)
from scripts.common import make_empty_document, read_document


class TestValidateSession:
    def test_accepts_valid_session(self):
        validate_session(calls=10, note="session normale")  # ne lève pas

    def test_rejects_negative_calls(self):
        with pytest.raises(ValueError, match="entre 0 et"):
            validate_session(calls=-1, note="")

    def test_rejects_calls_over_limit(self):
        with pytest.raises(ValueError, match="entre 0 et"):
            validate_session(calls=1_000_000, note="")

    def test_rejects_boolean_calls(self):
        with pytest.raises(ValueError, match="entier"):
            validate_session(calls=True, note="")

    def test_rejects_oversized_note(self):
        with pytest.raises(ValueError, match="caractères"):
            validate_session(calls=1, note="x" * 501)


class TestBuildEntry:
    def test_builds_entry_with_stripped_note(self):
        # Act
        entry = build_entry(calls=7, note="  ma note  ", timestamp="2026-07-13T09:00:00+00:00")

        # Assert
        assert entry == {
            "timestamp": "2026-07-13T09:00:00+00:00",
            "calls": 7,
            "note": "ma note",
        }

    def test_generates_timestamp_when_missing(self):
        entry = build_entry(calls=1, note="")
        assert entry["timestamp"].startswith("20")


class TestLogSession:
    def test_creates_file_and_appends_entries(self, tmp_path):
        # Arrange
        data_file = tmp_path / "claude_usage.json"

        # Act
        log_session(5, "première", data_file=data_file)
        document = log_session(3, "seconde", data_file=data_file)

        # Assert
        assert len(document["entries"]) == 2
        reloaded = read_document(data_file, "claude_usage")
        assert [e["calls"] for e in reloaded["entries"]] == [5, 3]

    def test_rejects_invalid_session_without_writing(self, tmp_path):
        # Arrange
        data_file = tmp_path / "claude_usage.json"

        # Act / Assert
        with pytest.raises(ValueError):
            log_session(-5, "invalide", data_file=data_file)
        assert not data_file.exists()


class TestFormatRecentSessions:
    def test_empty_document_message(self):
        assert "Aucune session" in format_recent_sessions(
            make_empty_document("claude_usage"), last=5)

    def test_formats_last_n_entries(self):
        # Arrange
        document = {
            "entries": [
                {"timestamp": f"2026-07-{day:02d}T10:00:00+00:00", "calls": day, "note": f"j{day}"}
                for day in range(1, 6)
            ]
        }

        # Act
        output = format_recent_sessions(document, last=2)

        # Assert — seulement les 2 dernières
        assert "j4" in output and "j5" in output
        assert "j1" not in output
