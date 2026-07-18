"""Statistiques d'usage Claude Code — porté de claude-usage-widget.

Parse les conversations locales ~/.claude/projects/*/*.jsonl (lignes
"assistant" portant le bloc usage) et agrège par jour : messages, tokens,
coût équivalent pay-as-you-go, économies de cache. À lancer sur la machine
où Claude Code tourne (le Pi reçoit les données via le sync GitHub).

Usage :
    python3 scripts/claude_stats.py collect [--days 30]
    python3 scripts/claude_stats.py show
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import DATA_DIR
from scripts.common import read_document, utc_now_iso, write_document_atomic

CATEGORY = "claude_stats"
DATA_FILE = DATA_DIR / f"{CATEGORY}.json"
CLAUDE_DIR = Path.home() / ".claude"

DEFAULT_DAYS = 30
MAX_DAILY_ENTRIES = 400
TOP_PROJECTS = 5

# USD par million de tokens (pricing public Anthropic, juillet 2026 —
# table portée du widget ; cache_read = input x 0.1, cache_creation x 1.25).
MODEL_PRICING = {
    "claude-opus-4-8": {"input": 5.0, "output": 25.0, "cache_read": 0.50, "cache_creation": 6.25},
    "claude-opus-4-7": {"input": 5.0, "output": 25.0, "cache_read": 0.50, "cache_creation": 6.25},
    "claude-opus-4-6": {"input": 5.0, "output": 25.0, "cache_read": 0.50, "cache_creation": 6.25},
    "claude-sonnet-5": {"input": 2.0, "output": 10.0, "cache_read": 0.20, "cache_creation": 2.50},
    "claude-sonnet-4-6": {"input": 3.0, "output": 15.0, "cache_read": 0.30, "cache_creation": 3.75},
    "claude-fable-5": {"input": 10.0, "output": 50.0, "cache_read": 1.00, "cache_creation": 12.50},
    "claude-haiku-4-5-20251001": {"input": 1.0, "output": 5.0, "cache_read": 0.10, "cache_creation": 1.25},
}
FALLBACK_PRICING = MODEL_PRICING["claude-sonnet-4-6"]
TOKENS_PER_MILLION = 1_000_000


def pricing_for(model: str) -> dict[str, float]:
    if model in MODEL_PRICING:
        return MODEL_PRICING[model]
    for known, rates in MODEL_PRICING.items():
        if model.startswith(known):
            return rates
    return FALLBACK_PRICING


def cost_usd(model: str, usage: dict[str, int]) -> float:
    """Coût pay-as-you-go d'un bloc usage {input, output, cache_read, cache_creation}."""
    rates = pricing_for(model)
    return sum(
        usage.get(kind, 0) * rates[kind] / TOKENS_PER_MILLION
        for kind in ("input", "output", "cache_read", "cache_creation"))


def cache_saved_usd(model: str, cache_read_tokens: int) -> float:
    """Ce que les lectures de cache auraient coûté en input plein tarif."""
    rates = pricing_for(model)
    return cache_read_tokens * (rates["input"] - rates["cache_read"]) / TOKENS_PER_MILLION


def prettify_project(dir_name: str) -> str:
    """"-Users-enzor-pi-tracker" -> "~/pi-tracker" (approximation lisible)."""
    home_prefix = str(Path.home()).replace("/", "-")
    if dir_name == home_prefix:
        return "~"
    if dir_name.startswith(home_prefix + "-"):
        return "~/" + dir_name[len(home_prefix) + 1:]
    return dir_name.lstrip("-")


def parse_usage_lines(
    lines_by_project: dict[str, list[dict[str, Any]]],
    since_prefix: str,
    today_prefix: str,
) -> dict[str, Any]:
    """Agrège les entrées "assistant" par jour (fonction pure).

    Retourne {"days": {date: {...}}, "today_models": {...}, "today_projects": {...}}.
    """
    days: dict[str, dict[str, Any]] = {}
    today_models: dict[str, dict[str, Any]] = {}
    today_projects: dict[str, int] = {}

    for project, lines in lines_by_project.items():
        for entry in lines:
            if not isinstance(entry, dict) or entry.get("type") != "assistant":
                continue
            timestamp = str(entry.get("timestamp") or "")
            day_key = timestamp[:10]
            if len(day_key) < 10 or day_key < since_prefix:
                continue
            message = entry.get("message")
            if not isinstance(message, dict):
                continue
            usage_raw = message.get("usage") or {}
            usage = {
                "input": usage_raw.get("input_tokens", 0) or 0,
                "output": usage_raw.get("output_tokens", 0) or 0,
                "cache_read": usage_raw.get("cache_read_input_tokens", 0) or 0,
                "cache_creation": usage_raw.get("cache_creation_input_tokens", 0) or 0,
            }
            model = str(message.get("model") or "unknown")
            if model.startswith("<"):
                continue  # entrées internes Claude Code (<synthetic>), sans coût

            day = days.setdefault(day_key, {
                "date": day_key, "messages": 0, "input_tokens": 0,
                "output_tokens": 0, "cache_read_tokens": 0,
                "cache_write_tokens": 0, "cost_usd": 0.0, "cache_saved_usd": 0.0,
            })
            day["messages"] += 1
            day["input_tokens"] += usage["input"]
            day["output_tokens"] += usage["output"]
            day["cache_read_tokens"] += usage["cache_read"]
            day["cache_write_tokens"] += usage["cache_creation"]
            day["cost_usd"] += cost_usd(model, usage)
            day["cache_saved_usd"] += cache_saved_usd(model, usage["cache_read"])

            if day_key == today_prefix:
                bucket = today_models.setdefault(model, {"output_tokens": 0, "cost_usd": 0.0})
                bucket["output_tokens"] += usage["output"]
                bucket["cost_usd"] += cost_usd(model, usage)
                today_projects[project] = today_projects.get(project, 0) + usage["output"]

    for day in days.values():
        day["cost_usd"] = round(day["cost_usd"], 2)
        day["cache_saved_usd"] = round(day["cache_saved_usd"], 2)
    for bucket in today_models.values():
        bucket["cost_usd"] = round(bucket["cost_usd"], 2)

    return {"days": days, "today_models": today_models, "today_projects": today_projects}


def read_project_lines(claude_dir: Path) -> dict[str, list[dict[str, Any]]]:
    """Lit les JSONL de conversations, groupés par nom de projet."""
    projects_dir = claude_dir / "projects"
    if not projects_dir.is_dir():
        raise RuntimeError(f"{projects_dir} introuvable — Claude Code est-il installé ici ?")

    lines_by_project: dict[str, list[dict[str, Any]]] = {}
    for jsonl_path in glob.glob(str(projects_dir / "*" / "*.jsonl")):
        project = os.path.basename(os.path.dirname(jsonl_path))
        bucket = lines_by_project.setdefault(project, [])
        try:
            with open(jsonl_path, encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        bucket.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        except OSError:
            continue
    return lines_by_project


def merge_daily_entries(
    existing: list[dict[str, Any]],
    fresh: list[dict[str, Any]],
    keep: int = MAX_DAILY_ENTRIES,
) -> list[dict[str, Any]]:
    """Fusion par date, les nouvelles entrées remplacent les anciennes (pure)."""
    by_date = {entry["date"]: entry for entry in existing if entry.get("date")}
    merged = {**by_date, **{entry["date"]: entry for entry in fresh}}
    return [merged[key] for key in sorted(merged)][-keep:]


def collect(days: int = DEFAULT_DAYS, data_file: Path = DATA_FILE) -> int:
    today = date.today()
    parsed = parse_usage_lines(
        read_project_lines(CLAUDE_DIR),
        since_prefix=(today - timedelta(days=days)).isoformat(),
        today_prefix=today.isoformat(),
    )
    fresh = [parsed["days"][key] for key in sorted(parsed["days"])]
    top_projects = sorted(
        parsed["today_projects"].items(), key=lambda item: -item[1])[:TOP_PROJECTS]

    document = read_document(data_file, CATEGORY)
    updated = {
        **document,
        "updated_at": utc_now_iso(),
        "entries": merge_daily_entries(document.get("entries", []), fresh),
        "today_models": parsed["today_models"],
        "today_projects": [
            {"name": prettify_project(name), "output_tokens": tokens}
            for name, tokens in top_projects],
    }
    write_document_atomic(data_file, updated)
    return len(fresh)


def format_today(document: dict[str, Any]) -> str:
    entries = document.get("entries", [])
    if not entries:
        return "Aucune donnée — lancer 'collect' d'abord."
    last = entries[-1]
    models = ", ".join(
        f"{model} ${bucket['cost_usd']}"
        for model, bucket in (document.get("today_models") or {}).items())
    return (f"{last['date']}  {last['messages']} messages  "
            f"{last['output_tokens']:,} tokens out  ${last['cost_usd']}"
            f"  (cache -${last['cache_saved_usd']})\n{models}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Stats d'usage Claude Code")
    subparsers = parser.add_subparsers(dest="command", required=True)
    collect_parser = subparsers.add_parser("collect", help="Parser ~/.claude et enregistrer")
    collect_parser.add_argument("--days", type=int, default=DEFAULT_DAYS)
    subparsers.add_parser("show", help="Afficher le dernier jour")
    args = parser.parse_args(argv)

    try:
        if args.command == "collect":
            count = collect(days=max(1, min(args.days, 120)))
            print(f"{count} jour(s) agrégés.")
        elif args.command == "show":
            print(format_today(read_document(DATA_FILE, CATEGORY)))
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Erreur : {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
