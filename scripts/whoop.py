"""Collecte WHOOP : récupération, sommeil, strain quotidiens.

API développeur WHOOP v2 (OAuth2). Prérequis : créer une app sur
https://developer-dashboard.whoop.com avec l'URI de redirection
http://localhost:8399/callback, puis renseigner WHOOP_CLIENT_ID et
WHOOP_CLIENT_SECRET dans .env.

Usage :
    python3 scripts/whoop.py auth              # une fois, ouvre le navigateur
    python3 scripts/whoop.py collect [--days 7]
    python3 scripts/whoop.py show
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import time
import webbrowser
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import DATA_DIR, PROJECT_ROOT, load_env
from scripts.common import read_document, utc_now_iso, write_document_atomic

CATEGORY = "whoop"
DATA_FILE = DATA_DIR / f"{CATEGORY}.json"
TOKENS_FILE = PROJECT_ROOT / ".whoop_tokens.json"  # gitignoré

API_BASE = "https://api.prod.whoop.com/developer"
AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
SCOPES = "offline read:recovery read:sleep read:cycles read:profile"
DEFAULT_REDIRECT_URI = "http://localhost:8399/callback"

REQUEST_TIMEOUT_SECONDS = 15
# Cloudflare (erreur 1010) rejette le User-Agent Python par défaut.
USER_AGENT = "pi-tracker/1.0 (personal dashboard)"
AUTH_FLOW_TIMEOUT_SECONDS = 300
TOKEN_EXPIRY_MARGIN_SECONDS = 60
PAGE_LIMIT = 25
MAX_PAGES = 20
DEFAULT_COLLECT_DAYS = 7
MAX_DAILY_ENTRIES = 400
KJ_TO_KCAL = 0.239006
MS_PER_HOUR = 3_600_000


# --------------------------------------------------------------------------
# OAuth2
# --------------------------------------------------------------------------

def _require_client_config() -> dict[str, str]:
    env = load_env()
    client_id = env.get("WHOOP_CLIENT_ID", "")
    client_secret = env.get("WHOOP_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        raise RuntimeError(
            "WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET manquants dans .env — "
            "créer une app sur https://developer-dashboard.whoop.com")
    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": env.get("WHOOP_REDIRECT_URI", DEFAULT_REDIRECT_URI),
    }


def _post_token_request(payload: dict[str, str]) -> dict[str, Any]:
    request = Request(
        TOKEN_URL,
        data=urlencode(payload).encode(),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read(65536).decode("utf-8", errors="replace"))
    except HTTPError as error:
        detail = error.read(2048).decode("utf-8", errors="replace")
        raise RuntimeError(f"Échec token WHOOP ({error.code}) : {detail}") from error
    except (URLError, OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Requête token WHOOP échouée : {error}") from error

    if "access_token" not in body:
        raise RuntimeError(f"Réponse token WHOOP inattendue : {body}")
    return {
        "access_token": body["access_token"],
        "refresh_token": body.get("refresh_token", ""),
        "expires_at": time.time() + float(body.get("expires_in", 3600)),
    }


def _save_tokens(tokens: dict[str, Any]) -> None:
    TOKENS_FILE.write_text(json.dumps(tokens, indent=2), encoding="utf-8")
    os.chmod(TOKENS_FILE, 0o600)


def _load_tokens() -> dict[str, Any]:
    if not TOKENS_FILE.is_file():
        raise RuntimeError(
            "Pas de tokens WHOOP — lancer d'abord : python3 scripts/whoop.py auth")
    try:
        return json.loads(TOKENS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Tokens WHOOP illisibles ({TOKENS_FILE}) : {error}") from error


def get_access_token() -> str:
    """Access token valide ; rafraîchi (et re-sauvegardé) si expiré."""
    tokens = _load_tokens()
    if time.time() < tokens.get("expires_at", 0) - TOKEN_EXPIRY_MARGIN_SECONDS:
        return tokens["access_token"]

    config = _require_client_config()
    refreshed = _post_token_request({
        "grant_type": "refresh_token",
        "refresh_token": tokens.get("refresh_token", ""),
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
        "scope": "offline",
    })
    _save_tokens(refreshed)
    return refreshed["access_token"]


def run_auth_flow() -> None:
    """Flow OAuth2 interactif : navigateur + mini serveur local de callback."""
    config = _require_client_config()
    state = secrets.token_urlsafe(16)
    parsed = urlparse(config["redirect_uri"])
    port = parsed.port or 80
    captured: dict[str, str] = {}

    class CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            query = parse_qs(urlparse(self.path).query)
            captured["code"] = query.get("code", [""])[0]
            captured["state"] = query.get("state", [""])[0]
            captured["error"] = query.get("error", [""])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                "<h2>pi-tracker connecté à WHOOP — tu peux fermer cet onglet.</h2>"
                .encode("utf-8"))

        def log_message(self, *_args):
            pass  # silence des logs HTTP

    auth_url = f"{AUTH_URL}?" + urlencode({
        "response_type": "code",
        "client_id": config["client_id"],
        "redirect_uri": config["redirect_uri"],
        "scope": SCOPES,
        "state": state,
    })
    print("Ouverture du navigateur pour autoriser WHOOP…\nSi rien ne s'ouvre :")
    print(f"  {auth_url}\n")
    webbrowser.open(auth_url)

    server = HTTPServer(("localhost", port), CallbackHandler)
    server.timeout = AUTH_FLOW_TIMEOUT_SECONDS
    server.handle_request()  # une seule requête : le callback
    server.server_close()

    if captured.get("error"):
        raise RuntimeError(f"Autorisation refusée : {captured['error']}")
    if not captured.get("code"):
        raise RuntimeError("Aucun code reçu (timeout ?) — réessayer.")
    if captured.get("state") != state:
        raise RuntimeError("State OAuth invalide — tentative rejetée.")

    tokens = _post_token_request({
        "grant_type": "authorization_code",
        "code": captured["code"],
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
        "redirect_uri": config["redirect_uri"],
    })
    _save_tokens(tokens)
    print(f"Connecté. Tokens enregistrés dans {TOKENS_FILE.name} (gitignoré).")


# --------------------------------------------------------------------------
# Collecte
# --------------------------------------------------------------------------

def _fetch_collection(path: str, token: str, start_iso: str) -> list[dict[str, Any]]:
    """Récupère toutes les pages d'une collection v2 depuis start_iso."""
    records: list[dict[str, Any]] = []
    next_token = ""
    for _ in range(MAX_PAGES):
        params = {"limit": str(PAGE_LIMIT), "start": start_iso}
        if next_token:
            params["nextToken"] = next_token
        request = Request(f"{API_BASE}{path}?{urlencode(params)}", headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": USER_AGENT,
        })
        try:
            with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                body = json.loads(response.read(1_000_000).decode("utf-8", errors="replace"))
        except HTTPError as error:
            if error.code == 401:
                raise RuntimeError(
                    "Token WHOOP invalide — relancer scripts/whoop.py auth") from error
            if error.code == 429:
                raise RuntimeError("Rate limit WHOOP — réessayer plus tard") from error
            raise RuntimeError(f"Erreur API WHOOP {error.code} sur {path}") from error
        except (URLError, OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Requête WHOOP échouée ({path}) : {error}") from error

        records = [*records, *body.get("records", [])]
        next_token = body.get("next_token") or ""
        if not next_token:
            break
    return records


def _date_of(iso_timestamp: Any) -> str:
    """Date "YYYY-MM-DD" d'un timestamp ISO ; chaîne vide si invalide."""
    if not isinstance(iso_timestamp, str) or len(iso_timestamp) < 10:
        return ""
    return iso_timestamp[:10]


def _round1(value: Any) -> float | None:
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return None


def build_daily_records(
    recovery_records: list[dict[str, Any]],
    sleep_records: list[dict[str, Any]],
    cycle_records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fusionne les 3 collections WHOOP en entrées quotidiennes (fonction pure).

    Attribution des dates : cycle -> jour de début, sommeil -> jour de réveil
    (fin), récupération -> jour de calcul (created_at). Les siestes sont
    ignorées. Retourne une liste triée par date croissante.
    """
    days: dict[str, dict[str, Any]] = {}

    def day(date: str) -> dict[str, Any]:
        if date not in days:
            days[date] = {"date": date}
        return days[date]

    for cycle in cycle_records:
        date = _date_of(cycle.get("start"))
        score = cycle.get("score") or {}
        if not date or not score:
            continue
        kilojoules = score.get("kilojoule")
        day(date).update({
            "strain": _round1(score.get("strain")),
            "calories_kcal": (
                round(float(kilojoules) * KJ_TO_KCAL) if kilojoules else None),
            "avg_hr_bpm": score.get("average_heart_rate"),
            "max_hr_bpm": score.get("max_heart_rate"),
        })

    for sleep in sleep_records:
        if sleep.get("nap"):
            continue
        date = _date_of(sleep.get("end"))
        score = sleep.get("score") or {}
        if not date or not score:
            continue
        stages = score.get("stage_summary") or {}
        in_bed = stages.get("total_in_bed_time_milli") or 0
        awake = stages.get("total_awake_time_milli") or 0
        day(date).update({
            "sleep_hours": _round1((in_bed - awake) / MS_PER_HOUR),
            "sleep_performance_pct": score.get("sleep_performance_percentage"),
            "sleep_efficiency_pct": _round1(score.get("sleep_efficiency_percentage")),
            "respiratory_rate": _round1(score.get("respiratory_rate")),
            "sleep_start": str(sleep.get("start") or ""),
            "sleep_end": str(sleep.get("end") or ""),
        })

    for recovery in recovery_records:
        date = _date_of(recovery.get("created_at"))
        score = recovery.get("score") or {}
        if not date or not score:
            continue
        day(date).update({
            "recovery_pct": score.get("recovery_score"),
            "hrv_ms": _round1(score.get("hrv_rmssd_milli")),
            "rhr_bpm": score.get("resting_heart_rate"),
            "spo2_pct": _round1(score.get("spo2_percentage")),
        })

    return [days[date] for date in sorted(days)]


def merge_daily_entries(
    existing: list[dict[str, Any]],
    fresh: list[dict[str, Any]],
    keep: int = MAX_DAILY_ENTRIES,
) -> list[dict[str, Any]]:
    """Fusion par date, les nouvelles entrées remplacent les anciennes (pure)."""
    by_date = {entry["date"]: entry for entry in existing if entry.get("date")}
    merged = {**by_date, **{entry["date"]: entry for entry in fresh}}
    return [merged[date] for date in sorted(merged)][-keep:]


def collect(days: int = DEFAULT_COLLECT_DAYS, data_file: Path = DATA_FILE) -> int:
    """Collecte les N derniers jours et met à jour data/whoop.json."""
    token = get_access_token()
    start_iso = (datetime.now(timezone.utc) - timedelta(days=days)) \
        .replace(microsecond=0).isoformat()

    fresh = build_daily_records(
        _fetch_collection("/v2/recovery", token, start_iso),
        _fetch_collection("/v2/activity/sleep", token, start_iso),
        _fetch_collection("/v2/cycle", token, start_iso),
    )
    document = read_document(data_file, CATEGORY)
    updated = {
        **document,
        "updated_at": utc_now_iso(),
        "entries": merge_daily_entries(document.get("entries", []), fresh),
    }
    write_document_atomic(data_file, updated)
    return len(fresh)


def format_entry(entry: dict[str, Any]) -> str:
    return (f"{entry.get('date')}  récup {entry.get('recovery_pct', '—')}%  "
            f"HRV {entry.get('hrv_ms', '—')}ms  RHR {entry.get('rhr_bpm', '—')}bpm  "
            f"sommeil {entry.get('sleep_hours', '—')}h  "
            f"strain {entry.get('strain', '—')}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collecte WHOOP")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("auth", help="Autoriser pi-tracker (une fois, navigateur)")
    collect_parser = subparsers.add_parser("collect", help="Collecter les derniers jours")
    collect_parser.add_argument("--days", type=int, default=DEFAULT_COLLECT_DAYS)
    subparsers.add_parser("show", help="Afficher la dernière entrée")
    args = parser.parse_args(argv)

    try:
        if args.command == "auth":
            run_auth_flow()
        elif args.command == "collect":
            count = collect(days=max(1, min(args.days, 90)))
            print(f"{count} jour(s) collectés.")
        elif args.command == "show":
            entries = read_document(DATA_FILE, CATEGORY).get("entries", [])
            print(format_entry(entries[-1]) if entries
                  else "Aucune donnée — lancer 'auth' puis 'collect'.")
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Erreur : {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
