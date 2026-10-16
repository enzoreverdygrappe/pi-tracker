"""Onglet Course : séance Kotcha saisie à l'écran -> km -> analyse -> boucle Google Maps.

Kotcha n'a pas d'API publique et ne se lie pas au WHOOP : la séance (footing
ou sortie longue) est saisie au tactile (durée ou distance + allure). L'analyse
est locale et gratuite : km / temps, récupération WHOOP du jour, météo.

Départ dans .env : RUN_HOME_LAT / RUN_HOME_LON / RUN_HOME_LABEL.

Usage :
  python3 scripts/run_plan.py plan --minutes 45 --pace 6:00 [--kind footing] [--seed 0]
  python3 scripts/run_plan.py plan --km 15 --pace 6:20 --kind sortie_longue
"""
from __future__ import annotations

import argparse
import io
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import DATA_DIR, load_env
from scripts.common import append_entry, read_document, utc_now_iso, write_document_atomic
from scripts.run_route import google_maps_url, plan_loop

CATEGORY = "run_plan"
DATA_FILE = DATA_DIR / f"{CATEGORY}.json"
MAX_PLANS = 30

KINDS = {"footing": "Footing", "sortie_longue": "Sortie longue"}
MIN_MINUTES, MAX_MINUTES = 10, 300
MIN_KM, MAX_KM = 1.0, 45.0
MIN_PACE_S, MAX_PACE_S = 180, 600      # 3:00 à 10:00 /km

RECOVERY_LOW, RECOVERY_HIGH = 34, 67
SHORT_SLEEP_H = 6
WHOOP_MAX_AGE_DAYS = 1
HOT_C, COLD_C = 25, 3
RAIN_CODES = set(range(51, 68)) | set(range(80, 83)) | set(range(95, 100))
LONG_RUN_MIN = 75
GEL_RUN_MIN = 90


def format_pace(pace_s: int) -> str:
    return f"{pace_s // 60}:{pace_s % 60:02d}"


def _number(payload: dict[str, Any], key: str, label: str, low: float, high: float) -> float:
    try:
        value = float(payload.get(key))
    except (TypeError, ValueError):
        raise ValueError(f"{label} invalide") from None
    if not low <= value <= high:
        raise ValueError(f"{label} hors limites ({low:g} à {high:g})")
    return value


def parse_session(payload: dict[str, Any]) -> dict[str, Any]:
    """Valide la saisie et calcule distance <-> durée (fonction pure)."""
    kind = payload.get("kind")
    if kind not in KINDS:
        raise ValueError("Type de séance inconnu (footing ou sortie_longue)")
    pace_s = int(_number(payload, "pace_s", "Allure", MIN_PACE_S, MAX_PACE_S))

    if payload.get("mode") == "distance":
        distance_km = round(_number(payload, "km", "Distance", MIN_KM, MAX_KM), 2)
        duration_min = round(distance_km * pace_s / 60)
    else:
        duration_min = round(_number(payload, "minutes", "Durée", MIN_MINUTES, MAX_MINUTES))
        distance_km = round(duration_min * 60 / pace_s, 2)

    return {"kind": kind, "label": KINDS[kind], "pace_s": pace_s,
            "distance_km": distance_km, "duration_min": duration_min}


def _fr(value: float) -> str:
    return f"{value:.1f}".replace(".", ",")


def _duration_text(minutes: int) -> str:
    return f"{minutes // 60} h {minutes % 60:02d}" if minutes >= 60 else f"{minutes} min"


def _recovery_notes(whoop: dict[str, Any] | None, today: date) -> list[dict[str, str]]:
    if not whoop or not whoop.get("date"):
        return []
    age = (today - date.fromisoformat(whoop["date"])).days
    if age > WHOOP_MAX_AGE_DAYS:
        return []
    notes = []
    pct = whoop.get("recovery_pct")
    if isinstance(pct, (int, float)):
        if pct < RECOVERY_LOW:
            notes.append({"tone": "warn", "text": f"Récupération basse ({pct:.0f} %) : reste en "
                          "endurance fondamentale, quitte à raccourcir."})
        elif pct < RECOVERY_HIGH:
            notes.append({"tone": "info", "text": f"Récupération moyenne ({pct:.0f} %) : "
                          "allure facile, sans forcer."})
        else:
            notes.append({"tone": "good", "text": f"Bonne récupération ({pct:.0f} %) : feu vert."})
    sleep = whoop.get("sleep_hours")
    if isinstance(sleep, (int, float)) and sleep < SHORT_SLEEP_H:
        notes.append({"tone": "warn", "text": f"Nuit courte ({_fr(sleep)} h) : écoute tes sensations."})
    return notes


def _weather_notes(weather: dict[str, Any] | None, now: datetime,
                   duration_min: int) -> list[dict[str, str]]:
    if not weather:
        return []
    notes = []
    temp = (weather.get("current") or {}).get("temp_c")
    if isinstance(temp, (int, float)) and temp >= HOT_C:
        notes.append({"tone": "warn", "text": f"Chaud ({temp:.0f}°) : hydrate-toi, "
                      "cours tôt ou en fin de journée."})
    elif isinstance(temp, (int, float)) and temp <= COLD_C:
        notes.append({"tone": "info", "text": f"Froid ({temp:.0f}°) : couvre mains et oreilles."})

    horizon_h = max(3, duration_min / 60 + 3)
    local_now = now.astimezone().replace(tzinfo=None)
    for slot in weather.get("hourly_3h") or []:
        try:
            when = datetime.fromisoformat(slot["time"])
        except (KeyError, ValueError):
            continue
        hours_ahead = (when - local_now).total_seconds() / 3600
        if -3 <= hours_ahead <= horizon_h and slot.get("code") in RAIN_CODES:
            notes.append({"tone": "info", "text": f"Pluie prévue vers {when.hour} h."})
            break
    return notes


def analyze(session: dict[str, Any], whoop: dict[str, Any] | None,
            weather: dict[str, Any] | None, now_iso: str) -> list[dict[str, str]]:
    """Notes d'analyse, résumé en premier (fonction pure : now injecté)."""
    now = datetime.fromisoformat(now_iso)
    summary = (f"{session['label']} de {_duration_text(session['duration_min'])} à "
               f"{format_pace(session['pace_s'])}/km : {_fr(session['distance_km'])} km.")
    notes = [{"tone": "summary", "text": summary}]
    notes += _recovery_notes(whoop, now.astimezone().date())
    notes += _weather_notes(weather, now, session["duration_min"])
    if session["duration_min"] >= LONG_RUN_MIN:
        gel = " et un gel au-delà de 1 h 30" if session["duration_min"] >= GEL_RUN_MIN else ""
        notes.append({"tone": "info", "text": f"Sortie longue : prends de l'eau{gel}."})
    return notes


def get_home() -> tuple[tuple[float, float], str]:
    env = load_env()
    try:
        home = (float(env["RUN_HOME_LAT"]), float(env["RUN_HOME_LON"]))
    except (KeyError, ValueError):
        raise ValueError("Départ non configuré : RUN_HOME_LAT / RUN_HOME_LON dans .env") from None
    return home, env.get("RUN_HOME_LABEL", "Maison")


def qr_svg(url: str) -> str:
    """QR code SVG (couleur pilotée par CSS via currentColor)."""
    import segno  # import local : seule dépendance hors stdlib de ce module

    buffer = io.BytesIO()
    segno.make(url, error="m").save(buffer, kind="svg", scale=4, border=0,
                                    dark="#000", light=None, xmldecl=False,
                                    svgns=True, omitsize=True)
    # segno n'accepte que des couleurs fixes : on rend la main au CSS.
    return buffer.getvalue().decode("utf-8").replace('"#000"', '"currentColor"')


def _latest(category: str, field: str | None = None) -> dict[str, Any] | None:
    entries = read_document(DATA_DIR / f"{category}.json", category).get("entries", [])
    for entry in reversed(entries):
        if field is None or isinstance(entry.get(field), (int, float)):
            return entry
    return None


def build_plan(payload: dict[str, Any], data_file: Path = DATA_FILE) -> dict[str, Any]:
    """Séance -> analyse -> boucle -> lien + QR ; enregistre et renvoie le plan."""
    session = parse_session(payload)
    seed = int(payload.get("seed") or 0)
    home, label = get_home()
    loop = plan_loop(home, session["distance_km"] * 1000, seed=seed)
    url = google_maps_url(home, [tuple(point) for point in loop["waypoints"]])
    now = utc_now_iso()

    plan = {
        "timestamp": now,
        "session": session,
        "seed": seed,
        "home": {"lat": home[0], "lon": home[1], "label": label},
        "route": {"distance_m": round(loop["distance_m"]), "coords": loop["coords"],
                  "waypoints": loop["waypoints"]},
        "google_maps_url": url,
        "qr_svg": qr_svg(url),
        "analysis": analyze(session, _latest("whoop", "recovery_pct"), _latest("weather"), now),
    }
    kotcha = payload.get("kotcha")
    if isinstance(kotcha, dict):  # séance importée de Garmin Connect (garmin_workouts.py)
        plan["kotcha"] = {"date": str(kotcha.get("date", "")), "title": str(kotcha.get("title", ""))}
    document = append_entry(read_document(data_file, CATEGORY), plan)
    trimmed = {**document, "entries": document["entries"][-MAX_PLANS:]}
    write_document_atomic(data_file, trimmed)
    return plan


def _pace_arg(text: str) -> int:
    minutes, _, seconds = text.partition(":")
    return int(minutes) * 60 + int(seconds or 0)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    plan = sub.add_parser("plan", help="calcule une boucle pour une séance")
    plan.add_argument("--kind", default="footing", choices=sorted(KINDS))
    plan.add_argument("--minutes", type=float)
    plan.add_argument("--km", type=float)
    plan.add_argument("--pace", default="6:00", help="allure min:ss par km")
    plan.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)

    payload = {"kind": args.kind, "pace_s": _pace_arg(args.pace), "seed": args.seed,
               "mode": "distance" if args.km else "duration",
               "km": args.km, "minutes": args.minutes}
    try:
        result = build_plan(payload)
    except (ValueError, RuntimeError) as error:
        print(f"Erreur : {error}", file=sys.stderr)
        return 1
    for note in result["analysis"]:
        print(f"- {note['text']}")
    print(f"Boucle : {result['route']['distance_m'] / 1000:.2f} km")
    print(result["google_maps_url"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
