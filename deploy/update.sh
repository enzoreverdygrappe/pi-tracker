#!/usr/bin/env bash
# Met à jour pi-tracker depuis GitHub et redémarre le serveur.
# À lancer sur le Pi après chaque push :  cd ~/pi-tracker && ./deploy/update.sh
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

info() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; }

info "1/3 · Récupération des changements (git pull)"
# --ff-only : refuse tout merge implicite. Le Pi ne fait que POUSSER data/
# (via sync.sh) et TIRER le code : un fast-forward doit toujours suffire.
if ! git pull --ff-only; then
    err "git pull a échoué : l'historique local a divergé de l'origine."
    err "Cause probable : un sync.sh n'a pas pu pousser (réseau) et des"
    err "commits data/ locaux ne sont pas sur GitHub."
    err "Inspecter :        git status"
    err "Repartir du distant en gardant les données locales :"
    err "    git stash push -- data/ && git pull --ff-only && git stash pop"
    exit 1
fi
ok "Code à jour."

info "2/3 · Dépendances Python"
if ! pip3 install --break-system-packages -r requirements.txt; then
    err "Installation des dépendances Python échouée — voir le message ci-dessus."
    exit 1
fi
ok "Dépendances à jour."

info "3/3 · Redémarrage du serveur"
if systemctl list-unit-files 2>/dev/null | grep -q '^tracker.service'; then
    sudo systemctl restart tracker.service
    ok "tracker.service redémarré."
else
    err "tracker.service introuvable — lancer d'abord ./deploy/install.sh."
    exit 1
fi

info "Relance du kiosque (cache vidé, nouveau frontend)"
"$PROJECT_ROOT/deploy/kiosk-restart.sh" || err "Relance du kiosque impossible — voir logs/kiosk.log."

echo
ok "Mise à jour terminée."
