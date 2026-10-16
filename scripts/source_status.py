"""État des collectes : dernière réussite / dernier échec par source.

Chaque script de collecte l'appelle à la fin de `collect`. Le dashboard lit
data/sources_status.json et affiche « à reconnecter » sur la carte concernée
quand l'échec vient d'un jeton expiré ou absent (plutôt qu'un log silencieux).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import DATA_DIR
from scripts.common import read_document, utc_now_iso, write_document_atomic

CATEGORY = "sources_status"
DATA_FILE = DATA_DIR / f"{CATEGORY}.json"
MAX_ERROR_LENGTH = 200

# Jeton absent, expiré ou refusé : seule une action humaine (auth) répare.
AUTH_ERROR_RE = re.compile(r"token|jeton|\bauth\b|authenticat|unauthori[sz]ed|login|\b40[13]\b",
                           re.IGNORECASE)


def is_auth_error(message: str) -> bool:
    return bool(AUTH_ERROR_RE.search(message or ""))


def record_status(source: str, error: str | None = None, *, path: Path = DATA_FILE,
                  now: str | None = None) -> None:
    """Note le résultat d'une collecte ; ne lève jamais (le statut est accessoire)."""
    stamp = now or utc_now_iso()
    try:
        document = read_document(path, CATEGORY)
    except ValueError:
        document = {"version": 1, "category": CATEGORY, "entries": []}
    previous = (document.get("sources") or {}).get(source) or {}
    status: dict[str, Any] = {
        "ok_at": previous.get("ok_at") if error else stamp,
        "error_at": stamp if error else previous.get("error_at"),
        "error": error[:MAX_ERROR_LENGTH] if error else None,
        "needs_auth": bool(error) and is_auth_error(error),
    }
    sources = {**(document.get("sources") or {}), source: status}
    try:
        write_document_atomic(path, {**document, "updated_at": stamp, "sources": sources})
    except OSError as write_error:
        print(f"Statut {source} non enregistré : {write_error}", file=sys.stderr)
