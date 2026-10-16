"""Tests unitaires de scripts/weather_sync.py (parsing, sans réseau)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.weather_sync import build_snapshot

TIMESTAMP = "2026-07-14T12:00:00+00:00"


def make_payload():
    hours = [f"2026-07-14T{h:02d}:00" for h in range(12, 24)] + \
            [f"2026-07-15T{h:02d}:00" for h in range(0, 24)]
    return {
        "current": {
            "time": "2026-07-14T12:15",
            "temperature_2m": 27.3,
            "apparent_temperature": 28.9,
            "weather_code": 1,
            "wind_speed_10m": 12.4,
            "relative_humidity_2m": 48,
        },
        "hourly": {
            "time": hours,
            "temperature_2m": [20.0 + i * 0.5 for i in range(len(hours))],
            "weather_code": [0] * len(hours),
        },
        "daily": {
            "time": ["2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18"],
            "temperature_2m_max": [28.1, 29.4, 24.0, 22.2, 30.0],
            "temperature_2m_min": [17.2, 18.0, 14.5, 12.9, 16.0],
            "weather_code": [1, 0, 61, 3, 95],
        },
    }


class TestBuildSnapshot:
    def test_parses_current_conditions(self):
        # Act
        snapshot = build_snapshot(make_payload(), "Lyon", TIMESTAMP)

        # Assert
        assert snapshot["city"] == "Lyon"
        assert snapshot["current"] == {
            "temp_c": 27.3, "feels_c": 28.9, "code": 1,
            "wind_kmh": 12.4, "humidity_pct": 48,
        }

    def test_hourly_starts_after_now_on_3h_steps(self):
        # Act
        snapshot = build_snapshot(make_payload(), "Lyon", TIMESTAMP)
        hourly = snapshot["hourly_3h"]

        # Assert — 8 tranches, premières heures multiples de 3 après 12:15
        assert len(hourly) == 8
        assert hourly[0]["time"] == "2026-07-14T15:00"
        assert all(int(slot["time"][11:13]) % 3 == 0 for slot in hourly)

    def test_daily_skips_today_and_keeps_three_days(self):
        # Act
        snapshot = build_snapshot(make_payload(), "Lyon", TIMESTAMP)
        daily = snapshot["daily"]

        # Assert
        assert [day["date"] for day in daily] == \
            ["2026-07-15", "2026-07-16", "2026-07-17"]
        assert daily[0] == {
            "date": "2026-07-15", "tmax_c": 29.4, "tmin_c": 18.0, "code": 0}

    def test_rejects_payload_without_current(self):
        with pytest.raises(ValueError):
            build_snapshot({"hourly": {}}, "Lyon", TIMESTAMP)


class TestFetchRetry:
    """Open-Meteo renvoie parfois 503 / délai dépassé : on retente avant d'échouer."""

    LOCATION = {"lat": "48.8", "lon": "2.3", "city": "Paris"}

    @staticmethod
    def opener(outcomes):
        calls = []

        def fake_urlopen(request, timeout):
            calls.append(request)
            outcome = outcomes[len(calls) - 1]
            if isinstance(outcome, Exception):
                raise outcome
            import io
            return io.BytesIO(outcome)

        return fake_urlopen, calls

    def test_retries_after_503_then_succeeds(self):
        from urllib.error import HTTPError
        from scripts.weather_sync import fetch_forecast
        error = HTTPError("u", 503, "busy", {}, None)
        fake, calls = self.opener([error, b'{"ok": true}'])
        assert fetch_forecast(self.LOCATION, opener=fake, sleep=lambda _s: None) == {"ok": True}
        assert len(calls) == 2

    def test_gives_up_after_three_timeouts(self):
        from scripts.weather_sync import fetch_forecast
        fake, calls = self.opener([TimeoutError("timed out")] * 3)
        with pytest.raises(RuntimeError, match="échouée"):
            fetch_forecast(self.LOCATION, opener=fake, sleep=lambda _s: None)
        assert len(calls) == 3

    def test_rate_limit_is_retried(self):
        from urllib.error import HTTPError
        from scripts.weather_sync import fetch_forecast
        fake, calls = self.opener([HTTPError("u", 429, "slow down", {}, None), b"{}"])
        assert fetch_forecast(self.LOCATION, opener=fake, sleep=lambda _s: None) == {}
        assert len(calls) == 2

    def test_client_error_is_not_retried(self):
        from urllib.error import HTTPError
        from scripts.weather_sync import fetch_forecast
        fake, calls = self.opener([HTTPError("u", 400, "bad", {}, None)])
        with pytest.raises(RuntimeError, match="400"):
            fetch_forecast(self.LOCATION, opener=fake, sleep=lambda _s: None)
        assert len(calls) == 1
