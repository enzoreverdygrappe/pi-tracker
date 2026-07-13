"""Tracking de l'usage Claude / API Anthropic.

V1 : enregistrement manuel de sessions via CLI. Le branchement sur l'API
d'usage réelle remplacera plus tard build_entry() sans toucher au stockage.

Usage :
    python3 scripts/claude_usage.py add --calls 12 --note "Session dev dashboard"
    python3 scripts/claude_usage.py list --last 10
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import DATA_DIR, MAX_CALLS_PER_SESSION, MAX_NOTE_LENGTH
from scripts.common import append_entry, read_document, utc_now_iso, write_document_atomic

CATEGORY = "claude_usage"
DATA_FILE = DATA_DIR / f"{CATEGORY}.json"


def validate_session(calls: int, note: str) -> None:
    """Valide une session avant enregistrement ; lève ValueError sinon."""
    if not isinstance(calls, int) or isinstance(calls, bool):
        raise ValueError("calls doit être un entier")
    if calls < 0 or calls > MAX_CALLS_PER_SESSION:
        raise ValueError(f"calls doit être entre 0 et {MAX_CALLS_PER_SESSION}")
    if not isinstance(note, str):
        raise ValueError("note doit être une chaîne")
    if len(note) > MAX_NOTE_LENGTH:
        raise ValueError(f"note limitée à {MAX_NOTE_LENGTH} caractères")


def build_entry(calls: int, note: str, timestamp: str | None = None) -> dict[str, Any]:
    """Construit une entrée de session validée."""
    validate_session(calls, note)
    return {
        "timestamp": timestamp if timestamp is not None else utc_now_iso(),
        "calls": calls,
        "note": note.strip(),
    }


def log_session(calls: int, note: str, data_file: Path = DATA_FILE) -> dict[str, Any]:
    """Ajoute une session au fichier de données et retourne le nouveau document."""
    document = read_document(data_file, CATEGORY)
    updated = append_entry(document, build_entry(calls, note))
    write_document_atomic(data_file, updated)
    return updated


def format_recent_sessions(document: dict[str, Any], last: int) -> str:
    """Formate les N dernières sessions pour affichage terminal."""
    entries = document.get("entries", [])
    if not entries:
        return "Aucune session enregistrée."
    lines = [
        f"{entry['timestamp']}  {entry['calls']:>5} appels  {entry.get('note', '')}"
        for entry in entries[-last:]
    ]
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Tracking de l'usage Claude")
    subparsers = parser.add_subparsers(dest="command", required=True)

    add_parser = subparsers.add_parser("add", help="Enregistrer une session")
    add_parser.add_argument("--calls", type=int, required=True, help="Nombre d'appels API")
    add_parser.add_argument("--note", type=str, default="", help="Note libre sur la session")

    list_parser = subparsers.add_parser("list", help="Afficher les dernières sessions")
    list_parser.add_argument("--last", type=int, default=10, help="Nombre de sessions")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "add":
            document = log_session(args.calls, args.note)
            print(f"Session enregistrée ({len(document['entries'])} au total).")
        elif args.command == "list":
            print(format_recent_sessions(read_document(DATA_FILE, CATEGORY), args.last))
    except (ValueError, OSError) as error:
        print(f"Erreur : {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
