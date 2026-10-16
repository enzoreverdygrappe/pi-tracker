"""Tests unitaires de scripts/source_status.py (état des collectes)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.common import read_document
from scripts.source_status import CATEGORY, is_auth_error, record_status

NOW = "2026-10-16T10:00:00+00:00"
LATER = "2026-10-16T11:00:00+00:00"


@pytest.mark.parametrize("message", [
    "Pas de tokens Google — lancer d'abord : python3 scripts/calendar_sync.py auth",
    "Aucun token Claude Code trouvé — se connecter avec 'claude'",
    "HTTP 401 Unauthorized",
    "Erreur API WHOOP 403",
    "Jeton expiré",
    "GarminConnectAuthenticationError: 401",
    "lancer d'abord : python3 scripts/calendar_sync.py auth",
])
def test_auth_errors_are_detected(message):
    assert is_auth_error(message)


@pytest.mark.parametrize("message", [
    "Erreur API Open-Meteo 503",
    "Requête Open-Meteo échouée : The read operation timed out",
    "Connection refused",
    "Champ 'author' manquant dans la réponse",
])
def test_network_errors_are_not_auth(message):
    assert not is_auth_error(message)


def test_success_then_failure_keeps_last_success(tmp_path):
    # Arrange
    path = tmp_path / f"{CATEGORY}.json"

    # Act
    record_status("whoop", path=path, now=NOW)
    record_status("whoop", "HTTP 401 Unauthorized", path=path, now=LATER)

    # Assert
    status = read_document(path, CATEGORY)["sources"]["whoop"]
    assert status == {"ok_at": NOW, "error_at": LATER,
                      "error": "HTTP 401 Unauthorized", "needs_auth": True}


def test_success_clears_previous_error(tmp_path):
    path = tmp_path / f"{CATEGORY}.json"
    record_status("calendar", "Pas de tokens Google", path=path, now=NOW)
    record_status("calendar", path=path, now=LATER)
    status = read_document(path, CATEGORY)["sources"]["calendar"]
    assert status["ok_at"] == LATER
    assert status["error"] is None
    assert status["needs_auth"] is False


def test_sources_are_independent(tmp_path):
    path = tmp_path / f"{CATEGORY}.json"
    record_status("weather", "Erreur API Open-Meteo 503", path=path, now=NOW)
    record_status("whoop", path=path, now=LATER)
    sources = read_document(path, CATEGORY)["sources"]
    assert set(sources) == {"weather", "whoop"}
    assert sources["weather"]["needs_auth"] is False


def test_long_error_is_truncated(tmp_path):
    path = tmp_path / f"{CATEGORY}.json"
    record_status("whoop", "x" * 1000, path=path, now=NOW)
    assert len(read_document(path, CATEGORY)["sources"]["whoop"]["error"]) <= 200
