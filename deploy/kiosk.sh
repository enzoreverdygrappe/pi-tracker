#!/usr/bin/env bash
# Kiosque plein écran Chromium sur le dashboard local.
#  - écran toujours allumé (screensaver + veille DPMS désactivés)
#  - curseur masqué en continu (démon unclutter)
#  - bureau / barre des tâches Raspberry Pi OS masqués (option HIDE_DESKTOP)
#  - Chromium relancé automatiquement s'il crashe (boucle watchdog)
# Lancé au démarrage de la session graphique (voir README, autostart).
#
# Pas de `set -e` : la boucle watchdog doit survivre à un arrêt de Chromium.
set -uo pipefail

DASHBOARD_URL="http://127.0.0.1:8321"
# Défaut kiosque : thème nuit. Sans ce paramètre, Chromium (qui annonce
# prefers-color-scheme: light par défaut) démarrerait en thème papier.
# La bascule tactile de l'UI (persistée en localStorage) prime sur ce défaut.
KIOSK_URL="${DASHBOARD_URL}/?theme=ensia"
MAX_WAIT_SECONDS=60
CHROME_RESTART_DELAY=3
PROFILE_DIR="${HOME}/.config/pi-tracker-kiosk"

log() { printf '[%s] kiosk: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*"; }

# 1. Écran toujours allumé : pas de screensaver ni d'extinction d'énergie.
if command -v xset >/dev/null 2>&1; then
    xset s off        # désactive le screensaver
    xset s noblank    # n'assombrit jamais l'écran
    xset -dpms        # désactive la gestion d'énergie (extinction écran)
else
    log "xset absent — impossible de désactiver la veille écran (X11 ?)."
fi

# 2. Option : masquer le bureau et la barre des tâches pour un kiosque total.
#    HIDE_DESKTOP=1 (défaut) ferme panneau + gestionnaire de fichiers.
if [ "${HIDE_DESKTOP:-1}" = "1" ]; then
    for proc in lxpanel pcmanfm wf-panel-pi; do
        pkill -x "$proc" 2>/dev/null || true
    done
fi

# 3. Curseur masqué en continu (unclutter est un démon : reste actif après
#    le démarrage). On ne le relance pas s'il tourne déjà.
if ! pgrep -x unclutter >/dev/null 2>&1; then
    if command -v unclutter >/dev/null 2>&1; then
        unclutter -idle 0.1 -root >/dev/null 2>&1 &
    else
        log "unclutter absent (sudo apt install unclutter) — curseur visible."
    fi
fi

# 4. Attendre que le serveur Flask réponde avant d'ouvrir le navigateur.
for _ in $(seq 1 "$MAX_WAIT_SECONDS"); do
    if curl -sf "$DASHBOARD_URL/api/categories" >/dev/null 2>&1; then break; fi
    sleep 1
done

# chromium-browser sur Raspberry Pi OS, chromium sur d'autres distros.
CHROMIUM_BIN="$(command -v chromium-browser || command -v chromium)" || {
    log "ERREUR : Chromium introuvable (sudo apt install chromium-browser)."
    exit 1
}

mkdir -p "$PROFILE_DIR"

# 5. Watchdog : tant que la session tourne, (re)lancer Chromium à chaque sortie.
while true; do
    # Efface les drapeaux de crash pour ne jamais afficher « Restaurer les pages »
    # après une coupure de courant.
    PREFS="$PROFILE_DIR/Default/Preferences"
    if [ -f "$PREFS" ]; then
        sed -i 's/"exited_cleanly":false/"exited_cleanly":true/;
                s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PREFS" 2>/dev/null || true
    fi

    log "Démarrage de Chromium…"
    "$CHROMIUM_BIN" \
        --kiosk \
        --user-data-dir="$PROFILE_DIR" \
        --noerrdialogs \
        --disable-infobars \
        --disable-session-crashed-bubble \
        --disable-features=Translate \
        --disable-pinch \
        --overscroll-history-navigation=0 \
        --check-for-update-interval=31536000 \
        "$KIOSK_URL" || true

    log "Chromium s'est arrêté — redémarrage dans ${CHROME_RESTART_DELAY}s."
    sleep "$CHROME_RESTART_DELAY"
done
