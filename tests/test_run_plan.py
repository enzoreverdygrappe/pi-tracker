"""Tests unitaires de scripts/run_plan.py (séance, analyse), sans réseau."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.run_plan import analyze, format_pace, parse_session, qr_svg

NOW = "2026-10-10T16:00:00+00:00"


class TestParseSession:
    def test_duration_mode_computes_distance(self):
        # 45 min à 6:00/km = 7,5 km
        session = parse_session({"kind": "footing", "mode": "duration", "minutes": 45, "pace_s": 360})
        assert session["distance_km"] == 7.5
        assert session["duration_min"] == 45

    def test_distance_mode_computes_duration(self):
        session = parse_session({"kind": "sortie_longue", "mode": "distance", "km": 15, "pace_s": 380})
        assert session["distance_km"] == 15
        assert session["duration_min"] == 95  # 15 x 6:20 = 95 min

    @pytest.mark.parametrize("payload, message", [
        ({"kind": "sprint", "mode": "duration", "minutes": 45, "pace_s": 360}, "Type de séance"),
        ({"kind": "footing", "mode": "duration", "minutes": 2, "pace_s": 360}, "Durée"),
        ({"kind": "footing", "mode": "distance", "km": 80, "pace_s": 360}, "Distance"),
        ({"kind": "footing", "mode": "duration", "minutes": 45, "pace_s": 60}, "Allure"),
        ({"kind": "footing", "mode": "duration", "minutes": "abc", "pace_s": 360}, "Durée"),
    ])
    def test_rejects_invalid_input(self, payload, message):
        with pytest.raises(ValueError, match=message):
            parse_session(payload)


class TestFormatPace:
    def test_minutes_seconds(self):
        assert format_pace(345) == "5:45"
        assert format_pace(360) == "6:00"


def session(kind="footing", minutes=45):
    return parse_session({"kind": kind, "mode": "duration", "minutes": minutes, "pace_s": 360})


class TestAnalyze:
    def test_low_recovery_advises_easy_effort(self):
        whoop = {"date": "2026-10-10", "recovery_pct": 25.0, "sleep_hours": 7.5}
        notes = analyze(session(), whoop, None, NOW)
        assert any("Récupération basse" in note["text"] for note in notes)

    def test_stale_whoop_is_ignored(self):
        whoop = {"date": "2026-07-14", "recovery_pct": 25.0}
        notes = analyze(session(), whoop, None, NOW)
        assert not any("Récupération" in note["text"] for note in notes)

    def test_hot_weather_and_rain(self):
        weather = {
            "current": {"temp_c": 29.0},
            "hourly_3h": [{"time": "2026-10-10T18:00", "temp_c": 27.0, "code": 63}],
        }
        texts = " ".join(note["text"] for note in analyze(session(), None, weather, NOW))
        assert "Chaud" in texts
        assert "Pluie" in texts

    def test_long_run_reminds_fuel(self):
        notes = analyze(session("sortie_longue", 100), None, None, NOW)
        assert any("eau" in note["text"] for note in notes)

    def test_always_returns_summary_first(self):
        notes = analyze(session(), None, None, NOW)
        assert notes[0]["tone"] == "summary"
        assert "7,5 km" in notes[0]["text"]


class TestQrSvg:
    def test_svg_inherits_css_color(self):
        svg = qr_svg("https://www.google.com/maps/dir/?api=1")
        assert svg.startswith("<svg")
        assert "currentColor" in svg
        assert "#000" not in svg
