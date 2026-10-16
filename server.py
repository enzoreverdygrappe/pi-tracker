"""Serveur local pi-tracker : sert le dashboard statique + les données JSON.

Lancement : python3 server.py
Le dashboard est alors sur http://127.0.0.1:8321
"""
from __future__ import annotations

import re

from flask import Flask, jsonify, request

from config import DASHBOARD_DIR, DATA_CATEGORY_PATTERN, DATA_DIR, SERVER_HOST, SERVER_PORT
from scripts.common import read_document
from scripts.goal import add_entry as goal_add_entry
from scripts.goal import compute_stats as goal_compute_stats
from scripts.goal import get_goal_config
from scripts.run_plan import build_plan as run_build_plan

app = Flask(__name__, static_folder=str(DASHBOARD_DIR), static_url_path="")

CATEGORY_RE = re.compile(rf"^{DATA_CATEGORY_PATTERN}$")


def api_response(data=None, error: str | None = None, status: int = 200):
    """Enveloppe de réponse API uniforme."""
    return jsonify({"success": error is None, "data": data, "error": error}), status


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/categories")
def list_categories():
    """Liste les catégories de données disponibles (fichiers data/*.json)."""
    if not DATA_DIR.is_dir():
        return api_response(data=[])
    names = sorted(
        path.stem for path in DATA_DIR.glob("*.json") if CATEGORY_RE.match(path.stem)
    )
    return api_response(data=names)


@app.get("/api/data/<category>")
def get_category(category: str):
    """Retourne le document JSON complet d'une catégorie."""
    if not CATEGORY_RE.match(category):
        return api_response(error="Nom de catégorie invalide", status=400)

    path = DATA_DIR / f"{category}.json"
    if not path.is_file():
        return api_response(error=f"Catégorie inconnue : {category}", status=404)

    try:
        return api_response(data=read_document(path, category))
    except ValueError as error:
        app.logger.error("Lecture de %s impossible : %s", path, error)
        return api_response(error="Fichier de données illisible", status=500)


RECENT_GOAL_ENTRIES = 8


def build_goal_summary(document) -> dict:
    """Config + stats calculées côté Python (source de vérité unique)."""
    entries = document.get("entries", [])
    config = get_goal_config()
    return {
        "config": config,
        "stats": goal_compute_stats(entries, config),
        "recent": entries[-RECENT_GOAL_ENTRIES:],
        "count": len(entries),
        "updated_at": document.get("updated_at", ""),
    }


@app.get("/api/goal/summary")
def get_goal_summary():
    """Résumé de l'objectif pour la vue Goal."""
    try:
        document = read_document(DATA_DIR / "goal.json", "goal")
    except ValueError as error:
        app.logger.error("Lecture goal.json impossible : %s", error)
        return api_response(error="Fichier objectif illisible", status=500)
    return api_response(data=build_goal_summary(document))


@app.post("/api/goal/add")
def post_goal_entry():
    """Ajout d'un revenu depuis l'écran tactile (numpad de la vue Goal)."""
    payload = request.get_json(silent=True) or {}
    try:
        document = goal_add_entry(payload.get("amount"), str(payload.get("note") or ""))
    except ValueError as error:
        return api_response(error=str(error), status=400)
    except OSError as error:
        app.logger.error("Écriture goal.json impossible : %s", error)
        return api_response(error="Enregistrement impossible", status=500)
    return api_response(data=build_goal_summary(document))


@app.post("/api/run/plan")
def post_run_plan():
    """Onglet Course : séance saisie au tactile -> analyse + boucle Google Maps."""
    payload = request.get_json(silent=True) or {}
    try:
        plan = run_build_plan(payload)
    except ValueError as error:
        return api_response(error=str(error), status=400)
    except RuntimeError as error:
        app.logger.error("Boucle de course impossible : %s", error)
        return api_response(error="Itinéraire indisponible (réseau ?) : réessaie dans un instant",
                            status=502)
    except OSError as error:
        app.logger.error("Écriture run_plan.json impossible : %s", error)
        return api_response(error="Enregistrement impossible", status=500)
    return api_response(data=plan)


@app.errorhandler(404)
def not_found(_error):
    return api_response(error="Ressource introuvable", status=404)


if __name__ == "__main__":
    # Serveur local uniquement (kiosque sur le Pi) : pas d'exposition réseau.
    app.run(host=SERVER_HOST, port=SERVER_PORT, debug=False)
