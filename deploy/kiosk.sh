#!/usr/bin/env bash
# Lance Chromium en mode kiosque plein écran sur le dashboard local.
# À appeler après le démarrage du serveur (voir tracker.service ou README).
set -euo pipefail

DASHBOARD_URL="http://127.0.0.1:8321"
MAX_WAIT_SECONDS=30

# Attendre que le serveur réponde avant d'ouvrir le navigateur.
for _ in $(seq 1 "$MAX_WAIT_SECONDS"); do
    if curl -sf "$DASHBOARD_URL/api/categories" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

# Masquer le curseur souris sur écran tactile (paquet : sudo apt install unclutter)
if command -v unclutter >/dev/null 2>&1; then
    unclutter -idle 0.5 -root &
fi

# chromium-browser sur Raspberry Pi OS, chromium sur certaines distros.
CHROMIUM_BIN="$(command -v chromium-browser || command -v chromium)" || {
    echo "ERREUR : Chromium introuvable (sudo apt install chromium-browser)." >&2
    exit 1
}

exec "$CHROMIUM_BIN" \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --check-for-update-interval=31536000 \
    "$DASHBOARD_URL"
