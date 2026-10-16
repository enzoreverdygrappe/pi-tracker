#!/usr/bin/env bash
# Relance le kiosque Chromium (après une mise à jour du frontend, ou s'il fige).
#  - ferme Chromium ; le watchdog de kiosk.sh le relance avec un cache vide ;
#  - si le watchdog ne tourne pas, ou avec --full, relance aussi kiosk.sh
#    (prise en compte d'un kiosk.sh modifié, sans reboot).
# Utilisable en SSH : l'affichage (X11 :0 ou Wayland) est retrouvé tout seul.
#
# Usage : ./deploy/kiosk-restart.sh [--full] [--lite]
#   --lite   force le mode sans flou (KIOSK_LITE=1), implique --full
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="${HOME}/.config/pi-tracker-kiosk"
LOG_FILE="${PROJECT_ROOT}/logs/kiosk.log"
WATCHDOG_PATTERN="deploy/kiosk\.sh"
STOP_TIMEOUT_SECONDS=10

FULL=0
for arg in "$@"; do
    case "$arg" in
        --full) FULL=1 ;;
        --lite) FULL=1; export KIOSK_LITE=1 ;;
        *) echo "Option inconnue : $arg (attendu : --full, --lite)" >&2; exit 2 ;;
    esac
done

log() { printf '[%s] kiosk-restart: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*"; }

stop_chromium() {
    pkill -f -- "--user-data-dir=${PROFILE_DIR}" 2>/dev/null || return 0
    for _ in $(seq 1 "$STOP_TIMEOUT_SECONDS"); do
        pgrep -f -- "--user-data-dir=${PROFILE_DIR}" >/dev/null || return 0
        sleep 1
    done
    log "Chromium ne s'arrête pas, arrêt forcé."
    pkill -9 -f -- "--user-data-dir=${PROFILE_DIR}" 2>/dev/null || true
}

start_watchdog() {
    # Session graphique de l'utilisateur, même lancé depuis SSH.
    export DISPLAY="${DISPLAY:-:0}"
    export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    if [ -z "${WAYLAND_DISPLAY:-}" ] && [ -S "${XDG_RUNTIME_DIR}/wayland-0" ]; then
        export WAYLAND_DISPLAY=wayland-0
    fi
    mkdir -p "$(dirname "$LOG_FILE")"
    setsid nohup "${PROJECT_ROOT}/deploy/kiosk.sh" >>"$LOG_FILE" 2>&1 </dev/null &
    log "kiosk.sh relancé (logs : ${LOG_FILE})."
}

if [ "$FULL" = "1" ]; then
    pkill -f -- "$WATCHDOG_PATTERN" 2>/dev/null && log "Watchdog arrêté."
fi

stop_chromium
rm -rf "${PROFILE_DIR}/Default/Cache" "${PROFILE_DIR}/Default/Code Cache" 2>/dev/null || true
log "Chromium fermé, cache vidé."

if pgrep -f -- "$WATCHDOG_PATTERN" >/dev/null 2>&1; then
    log "Le watchdog relance Chromium dans quelques secondes."
else
    start_watchdog
fi
