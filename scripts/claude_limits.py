"""Collecte des limites de plan Claude : session 5h, hebdo, cap modèle (Fable).

Interroge l'endpoint OAuth usage utilisé par Claude Code lui-même, avec le
token local (env CLAUDE_CODE_OAUTH_TOKEN -> ~/.claude/.credentials.json ->
Keychain macOS). Chaque collecte ajoute un snapshot horodaté dans
data/claude_limits.json ; le dashboard affiche le dernier.

Usage :
    python3 scripts/claude_limits.py collect
    python3 scripts/claude_limits.py show
"""
from __future__ import annotations

import argparse
import json
import os
import ssl
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import DATA_DIR
from scripts.common import append_entry, read_document, utc_now_iso, write_document_atomic
from scripts.source_status import record_status

CATEGORY = "claude_limits"
DATA_FILE = DATA_DIR / f"{CATEGORY}.json"

USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage"
OAUTH_BETA_HEADER = "oauth-2025-04-20"
REQUEST_TIMEOUT_SECONDS = 10
MAX_SNAPSHOTS = 1000

CLAUDE_DIR = Path.home() / ".claude"
MACOS_KEYCHAIN_SERVICES = ("Claude Code-credentials", "Claude Code")


def _extract_token(blob: str) -> str | None:
    """Extrait le token OAuth d'un blob JSON de credentials Claude Code."""
    try:
        token = json.loads(blob)["claudeAiOauth"]["accessToken"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return None
    token = (token or "").strip()
    return token or None


def load_token() -> str | None:
    """Token OAuth, dans l'ordre de résolution de Claude Code.

    env CLAUDE_CODE_OAUTH_TOKEN -> ~/.claude/.credentials.json -> Keychain macOS.
    """
    env_token = (os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") or "").strip()
    if env_token:
        return env_token

    creds_path = CLAUDE_DIR / ".credentials.json"
    if creds_path.is_file():
        try:
            token = _extract_token(creds_path.read_text(encoding="utf-8", errors="replace"))
            if token:
                return token
        except OSError:
            pass  # Illisible : on tente le Keychain sur macOS.

    if sys.platform == "darwin":
        for service in MACOS_KEYCHAIN_SERVICES:
            try:
                result = subprocess.run(
                    ["/usr/bin/security", "find-generic-password", "-s", service, "-w"],
                    capture_output=True, text=True, timeout=5,
                )
            except (OSError, subprocess.SubprocessError):
                continue
            if result.returncode == 0 and result.stdout.strip():
                token = _extract_token(result.stdout.strip())
                if token:
                    return token
    return None


def _clamp_pct(value: Any) -> float:
    """Pourcentage 0-100 borné ; entrée invalide -> 0."""
    try:
        pct = float(value)
    except (TypeError, ValueError):
        return 0.0
    if pct != pct or pct in (float("inf"), float("-inf")):
        return 0.0
    return max(0.0, min(pct, 100.0))


def parse_usage_payload(payload: dict[str, Any], timestamp: str) -> dict[str, Any]:
    """Transforme la réponse /api/oauth/usage en snapshot de stockage.

    Le cap hebdo par modèle (ex. Fable) arrive dans le tableau `limits`
    comme entrée `weekly_scoped` avec un scope.model.display_name ; quand
    plusieurs existent, on garde la plus utilisée.
    """
    if not isinstance(payload, dict):
        raise ValueError("Payload /api/oauth/usage inattendu")

    five_hour = payload.get("five_hour") or {}
    seven_day = payload.get("seven_day") or {}

    scoped: dict[str, Any] | None = None
    limits = payload.get("limits")
    if isinstance(limits, list):
        candidates = []
        for limit in limits:
            if not isinstance(limit, dict) or limit.get("kind") != "weekly_scoped":
                continue
            scope = limit.get("scope") or {}
            model = (scope.get("model") or {}) if isinstance(scope, dict) else {}
            label = str(model.get("display_name") or "").strip()
            if not label:
                continue
            candidates.append({
                "label": label,
                "pct": _clamp_pct(limit.get("percent", 0)),
                "resets_at": str(limit.get("resets_at") or ""),
            })
        if candidates:
            scoped = max(candidates, key=lambda c: c["pct"])

    return {
        "timestamp": timestamp,
        "session": {
            "pct": _clamp_pct(five_hour.get("utilization", 0)),
            "resets_at": str(five_hour.get("resets_at") or ""),
        },
        "weekly": {
            "pct": _clamp_pct(seven_day.get("utilization", 0)),
            "resets_at": str(seven_day.get("resets_at") or ""),
        },
        "scoped": scoped,
    }


def _ssl_context() -> ssl.SSLContext:
    """Contexte TLS ; certifi si dispo (Python macOS), défaut stdlib sinon."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def fetch_usage(token: str) -> dict[str, Any]:
    """Appelle l'endpoint OAuth usage ; lève RuntimeError avec message clair."""
    request = Request(USAGE_ENDPOINT, headers={
        "Authorization": f"Bearer {token}",
        "anthropic-beta": OAUTH_BETA_HEADER,
        "User-Agent": "pi-tracker",
    })
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS,
                     context=_ssl_context()) as response:
            return json.loads(response.read(65536).decode("utf-8", errors="replace"))
    except HTTPError as error:
        if error.code == 401:
            raise RuntimeError(
                "Token expiré — relancer 'claude' pour se reconnecter") from error
        if error.code == 429:
            raise RuntimeError("Rate limited — réessayer plus tard") from error
        raise RuntimeError(f"Erreur API {error.code}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError("Réponse illisible de l'endpoint usage") from error
    except (URLError, OSError, TimeoutError) as error:
        raise RuntimeError(f"Requête échouée (réseau ?) : {error}") from error


def trim_snapshots(document: dict[str, Any], keep: int = MAX_SNAPSHOTS) -> dict[str, Any]:
    """Retourne un nouveau document limité aux `keep` derniers snapshots."""
    entries = document.get("entries", [])
    if len(entries) <= keep:
        return document
    return {**document, "entries": entries[-keep:]}


def collect(data_file: Path = DATA_FILE) -> dict[str, Any]:
    """Collecte un snapshot et l'enregistre ; retourne le snapshot."""
    token = load_token()
    if not token:
        raise RuntimeError(
            "Aucun token Claude Code trouvé — se connecter avec 'claude' "
            "ou définir CLAUDE_CODE_OAUTH_TOKEN")
    snapshot = parse_usage_payload(fetch_usage(token), utc_now_iso())
    document = trim_snapshots(append_entry(read_document(data_file, CATEGORY), snapshot))
    write_document_atomic(data_file, document)
    return snapshot


def format_snapshot(snapshot: dict[str, Any]) -> str:
    lines = [
        f"session  {snapshot['session']['pct']:5.1f}%  reset {snapshot['session']['resets_at']}",
        f"weekly   {snapshot['weekly']['pct']:5.1f}%  reset {snapshot['weekly']['resets_at']}",
    ]
    scoped = snapshot.get("scoped")
    if scoped:
        lines.append(
            f"{scoped['label'].lower():<8} {scoped['pct']:5.1f}%  reset {scoped['resets_at']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Limites de plan Claude")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("collect", help="Collecter et enregistrer un snapshot")
    subparsers.add_parser("show", help="Afficher le dernier snapshot enregistré")
    args = parser.parse_args(argv)

    try:
        if args.command == "collect":
            print(format_snapshot(collect()))
            record_status(CATEGORY)
        elif args.command == "show":
            entries = read_document(DATA_FILE, CATEGORY).get("entries", [])
            print(format_snapshot(entries[-1]) if entries
                  else "Aucun snapshot — lancer 'collect' d'abord.")
    except (RuntimeError, ValueError, OSError) as error:
        if args.command == "collect":
            record_status(CATEGORY, str(error))
        print(f"Erreur : {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
