"""Sync Google Agenda : événements des 7 prochains jours -> data/calendar.json.

API Google Calendar v3 en lecture seule, OAuth2 « app de bureau » (stdlib,
pas de google-api-python-client). Prérequis : un identifiant OAuth créé sur
https://console.cloud.google.com (voir README, section Agenda), puis
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET dans .env.

Usage :
    python3 scripts/calendar_sync.py auth      # une fois, ouvre le navigateur
    python3 scripts/calendar_sync.py collect   # via cron ensuite
    python3 scripts/calendar_sync.py show
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import DATA_DIR, PROJECT_ROOT, load_env
from scripts.common import read_document, utc_now_iso, write_document_atomic
from scripts.oauth_local import capture_auth_code

CATEGORY = "calendar"
DATA_FILE = DATA_DIR / f"{CATEGORY}.json"
TOKENS_FILE = PROJECT_ROOT / ".google_tokens.json"  # gitignoré

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
DEFAULT_REDIRECT_URI = "http://localhost:8400/callback"

REQUEST_TIMEOUT_SECONDS = 15
TOKEN_EXPIRY_MARGIN_SECONDS = 60
LOOKAHEAD_DAYS = 7
MAX_EVENTS = 100


# --------------------------------------------------------------------------
# OAuth2
# --------------------------------------------------------------------------

def _require_client_config() -> dict[str, str]:
    env = load_env()
    client_id = env.get("GOOGLE_CLIENT_ID", "")
    client_secret = env.get("GOOGLE_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        raise RuntimeError(
            "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants dans .env — "
            "voir README, section Agenda (Google Calendar)")
    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": env.get("GOOGLE_REDIRECT_URI", DEFAULT_REDIRECT_URI),
    }


def _post_token_request(payload: dict[str, str]) -> dict[str, Any]:
    request = Request(
        TOKEN_URL,
        data=urlencode(payload).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read(65536).decode("utf-8", errors="replace"))
    except HTTPError as error:
        detail = error.read(2048).decode("utf-8", errors="replace")
        raise RuntimeError(f"Échec token Google ({error.code}) : {detail}") from error
    except (URLError, OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Requête token Google échouée : {error}") from error

    if "access_token" not in body:
        raise RuntimeError(f"Réponse token Google inattendue : {body}")
    return body


def _save_tokens(tokens: dict[str, Any]) -> None:
    TOKENS_FILE.write_text(json.dumps(tokens, indent=2), encoding="utf-8")
    os.chmod(TOKENS_FILE, 0o600)


def _load_tokens() -> dict[str, Any]:
    if not TOKENS_FILE.is_file():
        raise RuntimeError(
            "Pas de tokens Google — lancer d'abord : python3 scripts/calendar_sync.py auth")
    try:
        return json.loads(TOKENS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Tokens Google illisibles ({TOKENS_FILE}) : {error}") from error


def get_access_token() -> str:
    """Access token valide ; rafraîchi si expiré (le refresh token Google
    est stable, il n'est pas renouvelé à chaque refresh)."""
    tokens = _load_tokens()
    if time.time() < tokens.get("expires_at", 0) - TOKEN_EXPIRY_MARGIN_SECONDS:
        return tokens["access_token"]

    config = _require_client_config()
    body = _post_token_request({
        "grant_type": "refresh_token",
        "refresh_token": tokens.get("refresh_token", ""),
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
    })
    refreshed = {
        "access_token": body["access_token"],
        "refresh_token": tokens.get("refresh_token", ""),
        "expires_at": time.time() + float(body.get("expires_in", 3600)),
    }
    _save_tokens(refreshed)
    return refreshed["access_token"]


def run_auth_flow() -> None:
    """Flow OAuth2 interactif — access_type=offline pour obtenir un refresh
    token, prompt=consent pour le recevoir même après une autorisation passée."""
    config = _require_client_config()
    state = secrets.token_urlsafe(16)
    auth_url = f"{AUTH_URL}?" + urlencode({
        "response_type": "code",
        "client_id": config["client_id"],
        "redirect_uri": config["redirect_uri"],
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    })
    code = capture_auth_code(auth_url, config["redirect_uri"], state)
    body = _post_token_request({
        "grant_type": "authorization_code",
        "code": code,
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
        "redirect_uri": config["redirect_uri"],
    })
    _save_tokens({
        "access_token": body["access_token"],
        "refresh_token": body.get("refresh_token", ""),
        "expires_at": time.time() + float(body.get("expires_in", 3600)),
    })
    print(f"Connecté. Tokens enregistrés dans {TOKENS_FILE.name} (gitignoré).")


# --------------------------------------------------------------------------
# Collecte
# --------------------------------------------------------------------------

def normalize_events(api_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalise les événements de l'API (fonction pure).

    Un événement « journée entière » a une clé `date` (pas `dateTime`) ;
    les événements annulés sont ignorés.
    """
    events = []
    for item in api_items:
        if not isinstance(item, dict) or item.get("status") == "cancelled":
            continue
        start = item.get("start") or {}
        end = item.get("end") or {}
        is_all_day = "date" in start
        begins = start.get("dateTime") or start.get("date") or ""
        if not begins:
            continue
        events.append({
            "title": str(item.get("summary") or "(sans titre)"),
            "start": str(begins),
            "end": str(end.get("dateTime") or end.get("date") or ""),
            "location": str(item.get("location") or ""),
            "all_day": is_all_day,
        })
    return sorted(events, key=lambda event: event["start"])


def fetch_events(token: str) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    params = urlencode({
        "timeMin": now.isoformat(),
        "timeMax": (now + timedelta(days=LOOKAHEAD_DAYS)).isoformat(),
        "singleEvents": "true",
        "orderBy": "startTime",
        "maxResults": str(MAX_EVENTS),
    })
    request = Request(f"{EVENTS_URL}?{params}", headers={
        "Authorization": f"Bearer {token}",
    })
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read(1_000_000).decode("utf-8", errors="replace"))
    except HTTPError as error:
        if error.code == 401:
            raise RuntimeError(
                "Token Google invalide — relancer scripts/calendar_sync.py auth") from error
        raise RuntimeError(f"Erreur API Google Calendar {error.code}") from error
    except (URLError, OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Requête Google Calendar échouée : {error}") from error
    return body.get("items", [])


def collect(data_file: Path = DATA_FILE) -> int:
    """Remplace le snapshot d'événements par l'état actuel de l'agenda."""
    events = normalize_events(fetch_events(get_access_token()))
    document = {
        **read_document(data_file, CATEGORY),
        "updated_at": utc_now_iso(),
        "entries": events,
    }
    write_document_atomic(data_file, document)
    return len(events)


def format_events(events: list[dict[str, Any]]) -> str:
    if not events:
        return "Aucun événement dans les 7 prochains jours."
    return "\n".join(
        f"{event['start']:<25}  {event['title']}"
        + (f"  ({event['location']})" if event["location"] else "")
        for event in events)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync Google Agenda")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("auth", help="Autoriser l'accès (une fois, navigateur)")
    subparsers.add_parser("collect", help="Récupérer les 7 prochains jours")
    subparsers.add_parser("show", help="Afficher les événements enregistrés")
    args = parser.parse_args(argv)

    try:
        if args.command == "auth":
            run_auth_flow()
        elif args.command == "collect":
            print(f"{collect()} événement(s) sur {LOOKAHEAD_DAYS} jours.")
        elif args.command == "show":
            print(format_events(read_document(DATA_FILE, CATEGORY).get("entries", [])))
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Erreur : {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
