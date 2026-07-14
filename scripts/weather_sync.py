"""Sync météo via Open-Meteo (gratuit, sans clé API) -> data/weather.json.

Localisation dans .env : WEATHER_LAT / WEATHER_LON / WEATHER_CITY
(défaut : Lyon). Chaque collecte ajoute un snapshot ; le dashboard lit
le dernier (actuel + 24 h par tranches de 3 h + 3 jours).

Usage :
    python3 scripts/weather_sync.py collect
    python3 scripts/weather_sync.py show
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import DATA_DIR, load_env
from scripts.common import append_entry, read_document, utc_now_iso, write_document_atomic

CATEGORY = "weather"
DATA_FILE = DATA_DIR / f"{CATEGORY}.json"

API_URL = "https://api.open-meteo.com/v1/forecast"
REQUEST_TIMEOUT_SECONDS = 15
DEFAULT_LOCATION = {"lat": "45.7578", "lon": "4.8320", "city": "Lyon"}
HOURLY_STEP_HOURS = 3
HOURLY_SLOTS = 8          # 8 x 3 h = 24 h
FORECAST_DAYS_SHOWN = 3   # à partir de demain
MAX_SNAPSHOTS = 200


def get_location() -> dict[str, str]:
    """Localisation depuis .env, défauts Lyon (changer de ville = 3 lignes)."""
    env = load_env()
    return {
        "lat": env.get("WEATHER_LAT", DEFAULT_LOCATION["lat"]),
        "lon": env.get("WEATHER_LON", DEFAULT_LOCATION["lon"]),
        "city": env.get("WEATHER_CITY", DEFAULT_LOCATION["city"]),
    }


def fetch_forecast(location: dict[str, str]) -> dict[str, Any]:
    params = urlencode({
        "latitude": location["lat"],
        "longitude": location["lon"],
        "current": "temperature_2m,apparent_temperature,weather_code,"
                   "wind_speed_10m,relative_humidity_2m",
        "hourly": "temperature_2m,weather_code",
        "daily": "temperature_2m_max,temperature_2m_min,weather_code",
        "timezone": "auto",
        "forecast_days": str(FORECAST_DAYS_SHOWN + 2),
    })
    request = Request(f"{API_URL}?{params}", headers={"User-Agent": "pi-tracker/1.0"})
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return json.loads(response.read(1_000_000).decode("utf-8", errors="replace"))
    except HTTPError as error:
        raise RuntimeError(f"Erreur API Open-Meteo {error.code}") from error
    except (URLError, OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Requête Open-Meteo échouée : {error}") from error


def _round1(value: Any) -> float | None:
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return None


def build_snapshot(payload: dict[str, Any], city: str, timestamp: str) -> dict[str, Any]:
    """Transforme la réponse Open-Meteo en snapshot de stockage (fonction pure).

    - hourly_3h : les 24 prochaines heures par pas de 3 h, à partir de la
      prochaine heure pleine multiple de 3 (heures locales de la station).
    - daily : 3 jours à partir de demain (aujourd'hui est couvert par current).
    """
    if not isinstance(payload, dict) or "current" not in payload:
        raise ValueError("Payload Open-Meteo inattendu")

    current_raw = payload.get("current") or {}
    current = {
        "temp_c": _round1(current_raw.get("temperature_2m")),
        "feels_c": _round1(current_raw.get("apparent_temperature")),
        "code": int(current_raw.get("weather_code") or 0),
        "wind_kmh": _round1(current_raw.get("wind_speed_10m")),
        "humidity_pct": current_raw.get("relative_humidity_2m"),
    }

    hourly_raw = payload.get("hourly") or {}
    times = hourly_raw.get("time") or []
    temps = hourly_raw.get("temperature_2m") or []
    codes = hourly_raw.get("weather_code") or []
    now_local = str(current_raw.get("time") or "")
    hourly = [
        {"time": times[i], "temp_c": _round1(temps[i]), "code": int(codes[i] or 0)}
        for i in range(min(len(times), len(temps), len(codes)))
        if times[i] > now_local and int(times[i][11:13]) % HOURLY_STEP_HOURS == 0
    ][:HOURLY_SLOTS]

    daily_raw = payload.get("daily") or {}
    days = daily_raw.get("time") or []
    tmax = daily_raw.get("temperature_2m_max") or []
    tmin = daily_raw.get("temperature_2m_min") or []
    dcodes = daily_raw.get("weather_code") or []
    daily = [
        {"date": days[i], "tmax_c": _round1(tmax[i]), "tmin_c": _round1(tmin[i]),
         "code": int(dcodes[i] or 0)}
        for i in range(1, min(len(days), len(tmax), len(tmin), len(dcodes)))
    ][:FORECAST_DAYS_SHOWN]

    return {
        "timestamp": timestamp,
        "city": city,
        "current": current,
        "hourly_3h": hourly,
        "daily": daily,
    }


def trim_snapshots(document: dict[str, Any], keep: int = MAX_SNAPSHOTS) -> dict[str, Any]:
    entries = document.get("entries", [])
    if len(entries) <= keep:
        return document
    return {**document, "entries": entries[-keep:]}


def collect(data_file: Path = DATA_FILE) -> dict[str, Any]:
    location = get_location()
    snapshot = build_snapshot(fetch_forecast(location), location["city"], utc_now_iso())
    document = trim_snapshots(
        append_entry(read_document(data_file, CATEGORY), snapshot))
    write_document_atomic(data_file, document)
    return snapshot


def format_snapshot(snapshot: dict[str, Any]) -> str:
    current = snapshot["current"]
    daily = ", ".join(
        f"{day['date'][5:]} {day['tmin_c']}/{day['tmax_c']}°C"
        for day in snapshot["daily"])
    return (f"{snapshot['city']}  {current['temp_c']}°C "
            f"(ressenti {current['feels_c']}°C, code {current['code']})\n"
            f"3 jours : {daily}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync météo Open-Meteo")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("collect", help="Collecter et enregistrer un snapshot")
    subparsers.add_parser("show", help="Afficher le dernier snapshot")
    args = parser.parse_args(argv)

    try:
        if args.command == "collect":
            print(format_snapshot(collect()))
        elif args.command == "show":
            entries = read_document(DATA_FILE, CATEGORY).get("entries", [])
            print(format_snapshot(entries[-1]) if entries
                  else "Aucun snapshot — lancer 'collect' d'abord.")
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Erreur : {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
