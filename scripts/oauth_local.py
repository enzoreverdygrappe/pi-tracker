"""Helper partagé pour les flows OAuth2 « installed app » (WHOOP, Google…).

Ouvre le navigateur sur l'URL d'autorisation et capture le code de retour
sur un mini serveur HTTP localhost (l'URI de redirection déclarée chez le
fournisseur).
"""
from __future__ import annotations

import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

AUTH_FLOW_TIMEOUT_SECONDS = 300

SUCCESS_HTML = "<h2>pi-tracker connecté — tu peux fermer cet onglet.</h2>"


def capture_auth_code(auth_url: str, redirect_uri: str, expected_state: str) -> str:
    """Lance le navigateur sur auth_url et attend le callback.

    Retourne le code d'autorisation ; lève RuntimeError si refus, timeout
    ou state invalide (anti-CSRF).
    """
    port = urlparse(redirect_uri).port or 80
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
            self.wfile.write(SUCCESS_HTML.encode("utf-8"))

        def log_message(self, *_args):
            pass  # silence des logs HTTP

    print("Ouverture du navigateur pour autoriser l'accès…\nSi rien ne s'ouvre :")
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
    if captured.get("state") != expected_state:
        raise RuntimeError("State OAuth invalide — tentative rejetée.")
    return captured["code"]
