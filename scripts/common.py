"""Helpers partagés pour les fichiers de données JSON.

Toutes les fonctions sont pures ou à effet localisé :
- les documents sont des dicts jamais mutés (chaque opération retourne une copie),
- les écritures disque sont atomiques (fichier temporaire puis os.replace).
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DOCUMENT_VERSION = 1


def utc_now_iso() -> str:
    """Timestamp UTC ISO 8601, précision seconde."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def make_empty_document(category: str) -> dict[str, Any]:
    """Structure de base d'un fichier de données."""
    return {
        "version": DOCUMENT_VERSION,
        "category": category,
        "updated_at": utc_now_iso(),
        "entries": [],
    }


def append_entry(document: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    """Retourne un NOUVEAU document avec l'entrée ajoutée (aucune mutation)."""
    if not isinstance(entry, dict):
        raise TypeError("entry doit être un dict")
    return {
        **document,
        "updated_at": utc_now_iso(),
        "entries": [*document.get("entries", []), entry],
    }


def read_document(path: Path, category: str) -> dict[str, Any]:
    """Lit un document JSON ; fichier absent -> document vide neuf.

    Un fichier corrompu lève une ValueError explicite plutôt que d'écraser
    silencieusement des données existantes.
    """
    if not path.is_file():
        return make_empty_document(category)

    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"JSON corrompu dans {path}: {error}") from error
    except OSError as error:
        raise ValueError(f"Lecture impossible de {path}: {error}") from error

    if not isinstance(loaded, dict) or not isinstance(loaded.get("entries"), list):
        raise ValueError(f"Structure inattendue dans {path} (clé 'entries' manquante)")
    return loaded


def write_document_atomic(path: Path, document: dict[str, Any]) -> None:
    """Écrit le document via un fichier temporaire puis os.replace.

    Une coupure de courant du Pi en pleine écriture ne peut donc jamais
    laisser un JSON à moitié écrit.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(document, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(tmp_name, path)
    except OSError:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise
