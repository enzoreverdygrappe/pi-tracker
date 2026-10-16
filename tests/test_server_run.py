"""Tests de l'endpoint POST /api/run/plan (boucle et réseau simulés)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server


def test_invalid_session_returns_400():
    client = server.app.test_client()
    response = client.post("/api/run/plan", json={"kind": "sprint"})
    assert response.status_code == 400
    assert response.get_json()["success"] is False


def test_routing_failure_returns_502(monkeypatch):
    def failing(_payload):
        raise RuntimeError("Calcul d'itinéraire impossible : timeout")

    monkeypatch.setattr(server, "run_build_plan", failing)
    response = server.app.test_client().post("/api/run/plan", json={})
    assert response.status_code == 502
    assert "Itinéraire indisponible" in response.get_json()["error"]


def test_success_wraps_plan(monkeypatch):
    monkeypatch.setattr(server, "run_build_plan", lambda payload: {"seed": payload["seed"]})
    response = server.app.test_client().post("/api/run/plan", json={"seed": 2})
    assert response.get_json() == {"success": True, "data": {"seed": 2}, "error": None}
