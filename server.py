"""Serveur local pi-tracker : sert le dashboard statique + les données JSON.

Lancement : python3 server.py
Le dashboard est alors sur http://127.0.0.1:8321
"""
from __future__ import annotations

import re

from flask import Flask, jsonify

from config import DASHBOARD_DIR, DATA_CATEGORY_PATTERN, DATA_DIR, SERVER_HOST, SERVER_PORT
from scripts.common import read_document

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


@app.errorhandler(404)
def not_found(_error):
    return api_response(error="Ressource introuvable", status=404)


if __name__ == "__main__":
    # Serveur local uniquement (kiosque sur le Pi) : pas d'exposition réseau.
    app.run(host=SERVER_HOST, port=SERVER_PORT, debug=False)
