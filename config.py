"""Configuration centrale de pi-tracker.

Toutes les constantes (chemins, serveur, validation) vivent ici.
Les secrets vivent dans .env (jamais commité) et sont chargés via load_env().
"""
from __future__ import annotations

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
DATA_DIR = PROJECT_ROOT / "data"
DASHBOARD_DIR = PROJECT_ROOT / "dashboard"
ENV_FILE = PROJECT_ROOT / ".env"

SERVER_HOST = "127.0.0.1"
SERVER_PORT = 8321

# Whitelist des noms de catégories de données (anti path-traversal) :
# minuscules, chiffres et underscore uniquement.
DATA_CATEGORY_PATTERN = r"[a-z][a-z0-9_]{0,49}"

# Bornes de validation des entrées de tracking Claude.
MAX_NOTE_LENGTH = 500
MAX_CALLS_PER_SESSION = 100_000


def load_env(env_path: Path | None = None) -> dict[str, str]:
    """Charge un fichier .env (format KEY=value) sans dépendance externe.

    Retourne un nouveau dict ; ne modifie jamais os.environ.
    Fichier absent -> dict vide (les secrets sont optionnels en V1).
    """
    path = env_path if env_path is not None else ENV_FILE
    if not path.is_file():
        return {}

    try:
        raw_lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise RuntimeError(f"Impossible de lire {path}: {error}") from error

    entries = (
        line.split("=", 1)
        for line in raw_lines
        if line.strip() and not line.strip().startswith("#") and "=" in line
    )
    return {key.strip(): value.strip() for key, value in entries}
