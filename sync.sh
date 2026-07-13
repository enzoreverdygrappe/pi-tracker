#!/usr/bin/env bash
# Sync GitHub : commit + push automatique du dossier data/.
# Pensé pour être appelé par cron ; ne commite que si data/ a changé.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

log() { printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log "ERREUR : $PROJECT_ROOT n'est pas un dépôt git." >&2
    exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
    log "ERREUR : aucun remote 'origin' configuré (voir README, section Sync GitHub)." >&2
    exit 1
fi

git add data/

if git diff --cached --quiet; then
    log "Aucun changement dans data/, rien à synchroniser."
    exit 0
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git commit -m "chore: sync data $(date -u '+%Y-%m-%d %H:%M UTC')"

if git push origin "$BRANCH"; then
    log "Push OK sur origin/$BRANCH."
else
    log "ERREUR : push refusé (réseau ? auth ?). Le commit local est conservé," >&2
    log "il partira au prochain sync réussi." >&2
    exit 1
fi
