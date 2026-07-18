"""Objectif financier — porté de money-mission-terminal.

Un objectif (montant + date butoir), des entrées de revenus, et les
métriques de Money Mission : total, progression, rythme/jour, projection.
Config dans .env : GOAL_AMOUNT / GOAL_DATE / GOAL_START / GOAL_CURRENCY.

Usage :
    python3 scripts/goal.py add --amount 150 --note "Mission client"
    python3 scripts/goal.py stats
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import DATA_DIR, load_env
from scripts.common import append_entry, read_document, utc_now_iso, write_document_atomic

CATEGORY = "goal"
DATA_FILE = DATA_DIR / f"{CATEGORY}.json"

DEFAULTS = {
    "amount": 25_000.0,
    "goal_date": "2026-12-31",
    "start_date": "2026-01-01",
    "currency": "€",
}
MAX_ENTRY_AMOUNT = 1_000_000.0
MAX_NOTE_LENGTH = 200


def get_goal_config() -> dict[str, Any]:
    """Objectif depuis .env, défauts Money Mission ; dates ISO validées."""
    env = load_env()

    def parse_date(key: str, fallback: str) -> str:
        raw = env.get(key, fallback)
        try:
            return date.fromisoformat(raw).isoformat()
        except ValueError:
            return fallback

    try:
        amount = float(env.get("GOAL_AMOUNT", DEFAULTS["amount"]))
    except ValueError:
        amount = DEFAULTS["amount"]
    return {
        "amount": max(1.0, amount),
        "goal_date": parse_date("GOAL_DATE", DEFAULTS["goal_date"]),
        "start_date": parse_date("GOAL_START", DEFAULTS["start_date"]),
        "currency": env.get("GOAL_CURRENCY", DEFAULTS["currency"]),
    }


def validate_amount(raw: Any) -> float:
    """Montant d'une entrée ; lève ValueError si invalide."""
    try:
        amount = float(raw)
    except (TypeError, ValueError):
        raise ValueError("Montant invalide — entrer un nombre (ex. 150 ou 99.50)")
    if amount != amount or amount in (float("inf"), float("-inf")):
        raise ValueError("Montant invalide")
    if amount <= 0 or amount > MAX_ENTRY_AMOUNT:
        raise ValueError(f"Montant hors bornes (0 < montant <= {MAX_ENTRY_AMOUNT:,.0f})")
    return round(amount, 2)


def build_entry(amount: Any, note: str, timestamp: str | None = None) -> dict[str, Any]:
    if not isinstance(note, str) or len(note) > MAX_NOTE_LENGTH:
        raise ValueError(f"Note invalide (max {MAX_NOTE_LENGTH} caractères)")
    return {
        "timestamp": timestamp if timestamp is not None else utc_now_iso(),
        "amount": validate_amount(amount),
        "note": note.strip(),
    }


def compute_stats(
    entries: list[dict[str, Any]],
    config: dict[str, Any],
    today: date | None = None,
) -> dict[str, Any]:
    """Métriques Money Mission (fonction pure) : total, rythme, projection."""
    now = today if today is not None else date.today()
    goal_amount = config["amount"]
    goal_date = date.fromisoformat(config["goal_date"])
    start_date = date.fromisoformat(config["start_date"])

    total = round(sum(float(entry.get("amount", 0) or 0) for entry in entries), 2)
    today_prefix = now.isoformat()
    today_total = round(sum(
        float(entry.get("amount", 0) or 0) for entry in entries
        if str(entry.get("timestamp", "")).startswith(today_prefix)), 2)

    days_left = max((goal_date - now).days, 0)
    days_elapsed = max((now - start_date).days, 1)
    pace_per_day = round(total / days_elapsed, 2)
    projected_end = round(total + pace_per_day * days_left, 2)

    return {
        "total": total,
        "today": today_total,
        "remaining": round(max(goal_amount - total, 0), 2),
        "progress_pct": round(min(total / goal_amount, 1.0) * 100, 1),
        "days_left": days_left,
        "days_elapsed": days_elapsed,
        "pace_per_day": pace_per_day,
        "projected_end": projected_end,
        "is_on_track": projected_end >= goal_amount,
    }


def add_entry(amount: Any, note: str, data_file: Path = DATA_FILE) -> dict[str, Any]:
    """Ajoute une entrée de revenu et retourne le nouveau document."""
    document = append_entry(
        read_document(data_file, CATEGORY), build_entry(amount, note))
    write_document_atomic(data_file, document)
    return document


def format_stats(stats: dict[str, Any], config: dict[str, Any]) -> str:
    currency = config["currency"]
    return "\n".join([
        f"Objectif   {config['amount']:,.0f} {currency}  d'ici le {config['goal_date']}",
        f"Total      {stats['total']:,.2f} {currency}  ({stats['progress_pct']}%)",
        f"Aujourd'hui {stats['today']:,.2f} {currency}",
        f"Restant    {stats['remaining']:,.2f} {currency}  en {stats['days_left']} jours",
        f"Rythme     {stats['pace_per_day']:,.2f} {currency}/jour"
        f"  ->  projection {stats['projected_end']:,.0f} {currency}",
    ])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Objectif financier")
    subparsers = parser.add_subparsers(dest="command", required=True)
    add_parser = subparsers.add_parser("add", help="Ajouter un revenu")
    add_parser.add_argument("--amount", required=True, help="Montant (ex. 150)")
    add_parser.add_argument("--note", type=str, default="", help="Description")
    subparsers.add_parser("stats", help="Afficher la progression")
    args = parser.parse_args(argv)

    try:
        config = get_goal_config()
        if args.command == "add":
            document = add_entry(args.amount, args.note)
            stats = compute_stats(document["entries"], config)
            print(f"+{validate_amount(args.amount):,.2f} {config['currency']} — "
                  f"total {stats['total']:,.2f} ({stats['progress_pct']}%)")
        elif args.command == "stats":
            entries = read_document(DATA_FILE, CATEGORY).get("entries", [])
            print(format_stats(compute_stats(entries, config), config))
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Erreur : {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
