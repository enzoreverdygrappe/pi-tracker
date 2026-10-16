"""Séances Kotcha récupérées automatiquement via Garmin Connect (sans montre).

Kotcha n'a pas d'API : il pousse ses séances planifiées dans le calendrier
d'entraînement Garmin Connect (c'est ainsi qu'elles atteignent une montre).
Un compte Garmin Connect gratuit, sans appareil, suffit donc comme passerelle.
Ce script lit ce calendrier (bibliothèque non officielle `garminconnect`),
résume chaque séance (km, durée, allure) et prépare la boucle du jour.

Usage :
  python3 scripts/garmin_workouts.py auth      # une fois : email, mot de passe, code MFA
  python3 scripts/garmin_workouts.py collect   # cron : séances des 7 prochains jours
Jetons dans .garmin_tokens/ (gitignoré) ; le mot de passe n'est jamais stocké.
"""
from __future__ import annotations

import argparse
import getpass
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import DATA_DIR, PROJECT_ROOT
from scripts.common import read_document, utc_now_iso, write_document_atomic
from scripts.source_status import record_status

CATEGORY = "kotcha_workouts"
DATA_FILE = DATA_DIR / f"{CATEGORY}.json"
TOKEN_DIR = PROJECT_ROOT / ".garmin_tokens"
LOOKAHEAD_DAYS = 7
DEFAULT_EASY_PACE_S = 360     # allure retenue pour une étape sans cible
OPEN_STEP_S = 600             # étape « jusqu'au Lap » sans durée : comptée 10 min…
OPEN_WARMUP_S = 1500          # … sauf l'échauffement : 25 min, comme l'affiche Kotcha
LONG_RUN_MIN = 75
LONG_RUN_WORDS = ("longue", "long run", "long")
RUN_KINDS_WITH_LOOP = ("footing", "sortie_longue")


def upcoming_items(calendars: Iterable[dict[str, Any]], today: date,
                   days: int = LOOKAHEAD_DAYS) -> list[dict[str, Any]]:
    """Séances planifiées de today à today+days, sans doublon, triées (pure)."""
    last = today + timedelta(days=days)
    seen: dict[Any, dict[str, Any]] = {}
    for calendar in calendars:
        for item in (calendar or {}).get("calendarItems") or []:
            if item.get("itemType") != "workout" or not item.get("date"):
                continue
            try:
                day = date.fromisoformat(item["date"])
            except ValueError:
                continue
            if today <= day <= last:
                seen.setdefault((item.get("workoutId"), item["date"]), item)
    return sorted(seen.values(), key=lambda item: item["date"])


def _target_pace_s(step: dict[str, Any]) -> float | None:
    """Allure cible (s/km) au milieu de la zone ; Garmin la donne en m/s."""
    target = (step.get("targetType") or {}).get("workoutTargetTypeKey")
    speeds = [step.get("targetValueOne"), step.get("targetValueTwo")]
    if target != "pace.zone" or not all(isinstance(v, (int, float)) and v > 0 for v in speeds):
        return None
    return sum(1000 / speed for speed in speeds) / 2


def _walk(steps: list[dict[str, Any]], fallback_pace_s: float, repeat: int = 1):
    """Totaux (secondes, mètres, a des répétitions ?) d'une liste d'étapes."""
    seconds = meters = 0.0
    has_repeat = False
    for step in steps or []:
        if step.get("type") == "RepeatGroupDTO":
            inner = _walk(step.get("workoutSteps"), fallback_pace_s,
                          int(step.get("numberOfIterations") or 1))
            seconds, meters, has_repeat = seconds + inner[0], meters + inner[1], True
            continue
        pace = _target_pace_s(step) or fallback_pace_s
        condition = (step.get("endCondition") or {}).get("conditionTypeKey")
        value = step.get("endConditionValue")
        if condition == "distance" and isinstance(value, (int, float)):
            meters += value
            seconds += value / 1000 * pace
            continue
        if not (condition == "time" and isinstance(value, (int, float))):
            is_warmup = (step.get("stepType") or {}).get("stepTypeKey") == "warmup"
            value = OPEN_WARMUP_S if is_warmup else OPEN_STEP_S  # durée inconnue : estimée
        seconds += value
        meters += value / pace * 1000
    return seconds * repeat, meters * repeat, has_repeat


def summarize_workout(workout: dict[str, Any], fallback_pace_s: float = DEFAULT_EASY_PACE_S
                      ) -> dict[str, Any]:
    """Résumé d'une séance Garmin : type, km, durée, allure moyenne (pure)."""
    steps = [step for segment in workout.get("workoutSegments") or []
             for step in segment.get("workoutSteps") or []]
    seconds, meters, has_repeat = _walk(steps, fallback_pace_s)

    est_seconds = workout.get("estimatedDurationInSecs")
    est_meters = workout.get("estimatedDistanceInMeters")
    if isinstance(est_seconds, (int, float)) and isinstance(est_meters, (int, float)) and est_meters > 0:
        seconds, meters = float(est_seconds), float(est_meters)

    name = str(workout.get("workoutName") or "Séance")
    duration_min = round(seconds / 60) if seconds > 0 else None
    if has_repeat:
        kind = "fractionne"
    elif any(word in name.lower() for word in LONG_RUN_WORDS) or (duration_min or 0) >= LONG_RUN_MIN:
        kind = "sortie_longue"
    else:
        kind = "footing"

    return {
        "title": name,
        "description": str(workout.get("description") or ""),
        "kind": kind,
        "duration_min": duration_min,
        "distance_km": round(meters / 1000, 2) if meters > 0 else None,
        "pace_s": round(seconds / meters * 1000) if meters > 0 else None,
    }


def _client(with_credentials: bool = False):
    from garminconnect import Garmin  # import local : dépendance lourde, utile ici seulement

    if with_credentials:
        email = input("Email Garmin Connect : ").strip()
        password = getpass.getpass("Mot de passe (non stocké) : ")
        client = Garmin(email, password, prompt_mfa=lambda: input("Code MFA : ").strip())
    else:
        client = Garmin()
    TOKEN_DIR.mkdir(mode=0o700, exist_ok=True)
    client.login(tokenstore=str(TOKEN_DIR))
    return client


def collect(data_file: Path = DATA_FILE) -> list[dict[str, Any]]:
    client = _client()
    today = date.today()
    months = {(today.year, today.month)}
    ahead = today + timedelta(days=LOOKAHEAD_DAYS)
    months.add((ahead.year, ahead.month))
    calendars = [client.get_scheduled_workouts(year, month) for year, month in sorted(months)]

    workouts = []
    for item in upcoming_items(calendars, today):
        detail = client.get_workout_by_id(item["workoutId"]) if item.get("workoutId") else {}
        workouts.append({"date": item["date"], **summarize_workout(detail or {"workoutName": item.get("title")})})

    document = read_document(data_file, CATEGORY)
    write_document_atomic(data_file, {**document, "updated_at": utc_now_iso(), "entries": workouts})
    _prepare_today_loop(workouts, today)
    return workouts


def _prepare_today_loop(workouts: list[dict[str, Any]], today: date) -> None:
    """Boucle du jour calculée d'avance (footing / sortie longue) pour l'onglet Course."""
    from scripts.run_plan import DATA_FILE as PLAN_FILE, build_plan

    todays = [w for w in workouts if w["date"] == today.isoformat()
              and w["kind"] in RUN_KINDS_WITH_LOOP and w["distance_km"]]
    if not todays:
        return
    workout = todays[0]
    plans = read_document(PLAN_FILE, "run_plan").get("entries", [])
    if any(plan.get("kotcha", {}).get("date") == workout["date"]
           and plan["kotcha"].get("title") == workout["title"] for plan in plans):
        return  # déjà préparée : ne pas écraser une boucle choisie à l'écran
    try:
        build_plan({"kind": workout["kind"], "mode": "distance", "km": workout["distance_km"],
                    "pace_s": workout["pace_s"] or DEFAULT_EASY_PACE_S, "seed": 0,
                    "kotcha": {"date": workout["date"], "title": workout["title"]}})
    except (ValueError, RuntimeError) as error:
        print(f"Boucle du jour non préparée : {error}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["auth", "collect"])
    args = parser.parse_args(argv)
    try:
        if args.command == "auth":
            _client(with_credentials=True)
            print(f"Connecté. Jetons enregistrés dans {TOKEN_DIR}.")
            return 0
        workouts = collect()
        record_status(CATEGORY)
    except Exception as error:  # noqa: BLE001 - erreurs réseau/auth de la lib, message clair
        if args.command == "collect":
            record_status(CATEGORY, f"{type(error).__name__}: {error}")
        print(f"Erreur Garmin Connect : {error}", file=sys.stderr)
        print("Si les jetons ont expiré : python3 scripts/garmin_workouts.py auth", file=sys.stderr)
        return 1
    if not workouts:
        print("Aucune séance planifiée dans les 7 prochains jours (liaison Kotcha -> Garmin ?).")
    for workout in workouts:
        km = f"{workout['distance_km']} km" if workout["distance_km"] else "durée libre"
        print(f"{workout['date']}  {workout['kind']:<14} {km:<10} {workout['title']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
