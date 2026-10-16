"""Jetons Garmin et WHOOP partagés avec l'app mobile « Course » (Vercel).

Les jetons de rafraîchissement Garmin et WHOOP changent à chaque utilisation : ils ne
peuvent vivre qu'à un seul endroit. Depuis que l'app se met à jour seule sur Vercel,
c'est elle qui les garde ; le Mac lui demande un jeton d'accès valide (jamais le jeton
de rafraîchissement) et lui envoie les nouveaux jetons après un `auth`.

.env : COURSE_API_URL (ex. https://ma-course-six.vercel.app) et COURSE_SYNC_SECRET
(même valeur que SYNC_SECRET sur Vercel). Sans ces deux valeurs, les connecteurs
fonctionnent comme avant, avec leurs jetons locaux.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import load_env

PROVIDERS = ("garmin", "whoop")
REQUEST_TIMEOUT_SECONDS = 40
USER_AGENT = "pi-tracker/1.0 (course_cloud)"


def cloud_config(env: dict[str, str] | None = None) -> tuple[str, str] | None:
    """(url de base, secret) si l'app Course garde les jetons, sinon None (pure)."""
    env = load_env() if env is None else env
    url = (env.get("COURSE_API_URL") or "").strip().rstrip("/")
    secret = (env.get("COURSE_SYNC_SECRET") or "").strip()
    return (url, secret) if url.startswith("https://") and secret else None


def _call(request: Request) -> dict[str, Any]:
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read(65536).decode("utf-8", errors="replace"))
    except HTTPError as error:
        try:
            detail = json.loads(error.read(2048).decode("utf-8", errors="replace")).get("error")
        except (ValueError, AttributeError):
            detail = None
        raise RuntimeError(f"App Course : HTTP {error.code} {detail or ''}".strip()) from error
    except (URLError, OSError, ValueError) as error:
        raise RuntimeError(f"App Course injoignable : {error}") from error
    if not body.get("success"):
        raise RuntimeError(f"App Course : {body.get('error') or 'réponse inattendue'}")
    return body.get("data") or {}


def fetch_access_token(provider: str, config: tuple[str, str]) -> dict[str, Any]:
    """{access_token, expires_at, client_id} valide, rafraîchi au besoin par l'app."""
    if provider not in PROVIDERS:
        raise ValueError(f"provider inconnu : {provider}")
    url, secret = config
    data = _call(Request(f"{url}/api/token?{urlencode({'provider': provider})}", headers={
        "Authorization": f"Bearer {secret}", "User-Agent": USER_AGENT,
    }))
    if not data.get("access_token"):
        raise RuntimeError("App Course : jeton d'accès absent")
    return data


def push_tokens(provider: str, tokens: dict[str, Any], config: tuple[str, str]) -> None:
    """Confie à l'app les jetons obtenus par un nouvel `auth` sur le Mac."""
    if provider not in PROVIDERS:
        raise ValueError(f"provider inconnu : {provider}")
    url, secret = config
    _call(Request(f"{url}/api/token", method="POST",
                  data=json.dumps({"provider": provider, "tokens": tokens}).encode("utf-8"),
                  headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json",
                           "User-Agent": USER_AGENT}))
