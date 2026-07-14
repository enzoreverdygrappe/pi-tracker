"""Tests unitaires de scripts/calendar_sync.py (parsing, sans réseau)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.calendar_sync import normalize_events


def make_event(summary="Réunion", start_dt="2026-07-15T09:30:00+02:00", **overrides):
    event = {
        "summary": summary,
        "status": "confirmed",
        "start": {"dateTime": start_dt},
        "end": {"dateTime": "2026-07-15T10:30:00+02:00"},
        "location": "Lyon",
    }
    return {**event, **overrides}


class TestNormalizeEvents:
    def test_normalizes_timed_event(self):
        # Act
        events = normalize_events([make_event()])

        # Assert
        assert events == [{
            "title": "Réunion",
            "start": "2026-07-15T09:30:00+02:00",
            "end": "2026-07-15T10:30:00+02:00",
            "location": "Lyon",
            "all_day": False,
        }]

    def test_all_day_event_uses_date_key(self):
        event = make_event(
            start={"date": "2026-07-16"}, end={"date": "2026-07-17"})
        events = normalize_events([event])
        assert events[0]["all_day"] is True
        assert events[0]["start"] == "2026-07-16"

    def test_skips_cancelled_events(self):
        assert normalize_events([make_event(status="cancelled")]) == []

    def test_untitled_event_gets_placeholder(self):
        events = normalize_events([make_event(summary=None)])
        assert events[0]["title"] == "(sans titre)"

    def test_sorts_by_start(self):
        events = normalize_events([
            make_event(summary="B", start_dt="2026-07-16T09:00:00+02:00",
                       start={"dateTime": "2026-07-16T09:00:00+02:00"}),
            make_event(summary="A", start={"dateTime": "2026-07-15T08:00:00+02:00"}),
        ])
        assert [event["title"] for event in events] == ["A", "B"]

    def test_skips_event_without_start(self):
        assert normalize_events([make_event(start={})]) == []
