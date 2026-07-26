#!/usr/bin/env bash
# Installation complète de pi-tracker sur un Raspberry Pi (ou réinstall).
# Idempotent : peut être relancé sans casser une installation existante.
#   cd ~/pi-tracker && ./deploy/install.sh
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
USER_NAME="$(whoami)"

info() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }

info "1/7 · Paquets système"
sudo apt update
sudo apt install -y git python3-pip python3-venv chromium-browser unclutter curl
ok "Paquets installés."

info "2/7 · Dépendances Python"
pip3 install --break-system-packages -r requirements.txt
ok "Dépendances Python installées."

info "3/7 · Dossier de logs"
mkdir -p logs
ok "logs/ prêt."

info "4/7 · Fichier .env"
if [ ! -f .env ]; then
    cp .env.example .env
    warn ".env créé depuis .env.example — À REMPLIR AVANT USAGE"
    warn "(clés WHOOP, Google Calendar, coordonnées météo, objectif Goal)."
else
    ok ".env déjà présent — conservé tel quel."
fi

info "5/7 · Service systemd (serveur au boot, redémarrage auto)"
sudo cp deploy/tracker.service /etc/systemd/system/tracker.service
sudo sed -i "s|^User=.*|User=${USER_NAME}|" /etc/systemd/system/tracker.service
sudo sed -i "s|/home/pi/pi-tracker|${PROJECT_ROOT}|g" /etc/systemd/system/tracker.service
sudo systemctl daemon-reload
sudo systemctl enable --now tracker.service
ok "tracker.service actif (Restart=always)."

info "6/7 · Autostart kiosque + rotation des logs"
chmod +x deploy/kiosk.sh deploy/update.sh 2>/dev/null || true
AUTOSTART_DIR="${HOME}/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "${AUTOSTART_DIR}/pi-tracker-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=pi-tracker Kiosk
Exec=${PROJECT_ROOT}/deploy/kiosk.sh
X-GNOME-Autostart-enabled=true
EOF
sudo cp deploy/pi-tracker.logrotate /etc/logrotate.d/pi-tracker
sudo sed -i "s|/home/pi/pi-tracker|${PROJECT_ROOT}|g; s|su pi pi|su ${USER_NAME} ${USER_NAME}|" \
    /etc/logrotate.d/pi-tracker
ok "Autostart et logrotate configurés."

info "7/7 · Tâches cron (collectes périodiques)"
if crontab -l 2>/dev/null | grep -q 'pi-tracker\|sync.sh'; then
    warn "Cron pi-tracker déjà présent — non modifié (éditer avec 'crontab -e')."
else
    TMP_CRON="$(mktemp)"
    crontab -l 2>/dev/null > "$TMP_CRON" || true
    sed "s|/home/pi/pi-tracker|${PROJECT_ROOT}|g" deploy/crontab.example >> "$TMP_CRON"
    crontab "$TMP_CRON"
    rm -f "$TMP_CRON"
    ok "Cron installé depuis deploy/crontab.example."
fi

cat <<EOF

============================================================
  Installation terminée.

  ÉTAPES MANUELLES RESTANTES :
   1. Remplir  ${PROJECT_ROOT}/.env
        (clés WHOOP + Google, coordonnées météo, objectif Goal)
   2. Auth WHOOP   :  python3 scripts/whoop.py auth
   3. Auth Google  :  python3 scripts/calendar_sync.py auth
   4. Auto-login graphique au démarrage (indispensable au kiosque) :
        sudo raspi-config
          -> 1 System Options -> S5 Boot / Auto Login -> Desktop Autologin
   5. Redémarrer :  sudo reboot

  Après reboot : dashboard sur http://127.0.0.1:8321, plein écran
  au démarrage, redémarré automatiquement en cas de crash.
============================================================
EOF
