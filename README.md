# pi-tracker

Dashboard personnel de tracking, pensé pour tourner en kiosque plein écran sur un
Raspberry Pi 4 (2 Go RAM) avec écran tactile HDMI 10.1" (pensé pour 1280x800, s'adapte
jusqu'à 1024x600). Données stockées
en JSON local, versionnées sur GitHub, affichage 100 % offline.

## Architecture

```
config.py            Chemins, constantes, chargement .env (stdlib, zéro dépendance)
server.py            Flask : sert dashboard/ + API JSON (/api/data/<catégorie>)
sync.sh              Commit + push automatique de data/ (appelé par cron)
data/                1 fichier JSON par catégorie de métrique
scripts/             1 script Python par source de données
dashboard/           Frontend vanilla HTML/CSS/JS (aucun framework)
deploy/              Kiosque Chromium, crontab, unit systemd
tests/               Tests pytest
```

**Ajouter une nouvelle métrique** :
1. `scripts/<nom>.py` qui écrit `data/<nom>.json` (réutiliser `scripts/common.py`)
2. Dans `dashboard/app.js` : ajouter `<nom>` à `MAX_AGE_H` (il est alors pollé),
   écrire sa fonction de rendu et l'inscrire dans `RENDERERS`
3. Ajouter sa carte (`<article class="tile card" id="...">`) dans `index.html`

**Frontend** (`dashboard/`, détails dans [dashboard/README.md](dashboard/README.md)) :
widgets façon iOS / visionOS en grille bento, 3 pages en swipe (Accueil, Santé,
Claude API), thème auto clair/sombre selon l'heure, veille après 2 min.
`index.html` + `styles.css` + `app.js`, plus `js/ui.js` (graphiques SVG,
compteurs) et `js/weather-icons.js`. Police Inter servie en local.

## Démarrage rapide (dev, Mac/Linux)

```bash
cd pi-tracker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Stats d'usage Claude Code (coût, tokens, modèles, top projets)
# Parse ~/.claude en local — à lancer sur la machine où Claude Code tourne.
python3 scripts/claude_stats.py collect

# Limites de plan Claude (session 5h / hebdo / Fable)
# Nécessite Claude Code connecté sur la machine (token OAuth local).
python3 scripts/claude_limits.py collect

# Objectif financier (API /api/goal/* — plus affiché dans le dashboard v3)
python3 scripts/goal.py add --amount 150 --note "Mission client"
python3 scripts/goal.py stats

# Lancer le dashboard
python3 server.py
# -> http://127.0.0.1:8321
```

Tests : `pytest tests/ -v`

Tests de l'interface (Playwright, lancent leur propre serveur sur le port 8399) :
`npm install --no-save playwright && npx playwright install chromium` une fois,
puis `node --test tests/e2e/*.test.mjs`.

## WHOOP

1. Créer une app sur https://developer-dashboard.whoop.com (compte WHOOP
   normal) avec l'URI de redirection `http://localhost:8399/callback` et les
   scopes recovery / sleep / cycles / profile.
2. Copier le Client ID / Client Secret dans `.env`
   (`WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`).
3. Autoriser une fois (ouvre le navigateur, se fait sur une machine avec
   écran ; les tokens vont dans `.whoop_tokens.json`, gitignoré) :
   ```bash
   python3 scripts/whoop.py auth
   ```
4. Collecter : `python3 scripts/whoop.py collect` (cron toutes les 2 h dans
   `deploy/crontab.example`). Le refresh token est renouvelé automatiquement.

Pour le Pi : soit refaire `auth` sur le Pi (navigateur nécessaire), soit
copier `.whoop_tokens.json` depuis le Mac (il n'est pas synchronisé par git).

## Agenda (Google Calendar)

1. Aller sur https://console.cloud.google.com → créer un projet (ex.
   « pi-tracker »).
2. **APIs & Services → Library** → activer « Google Calendar API ».
3. **APIs & Services → OAuth consent screen** : type « External », remplir le
   nom de l'app, s'ajouter soi-même dans « Test users » (pas besoin de faire
   valider l'app par Google pour un usage perso).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** :
   type « **Desktop app** ». Copier le Client ID et le Client Secret dans
   `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
5. Autoriser une fois (navigateur, lecture seule de l'agenda principal) :
   ```bash
   python3 scripts/calendar_sync.py auth
   ```
6. Collecter : `python3 scripts/calendar_sync.py collect` (cron toutes les
   15 min). Le token (`.google_tokens.json`, gitignoré) se rafraîchit seul.

## Météo (Open-Meteo)

Aucune clé API. La localisation vient de `.env` :

```bash
WEATHER_LAT=48.8566   # Paris par défaut
WEATHER_LON=2.3522
WEATHER_CITY=Paris    # ex. Lyon : 45.7578 / 4.8320
```

Collecter : `python3 scripts/weather_sync.py collect` (cron toutes les 30 min).
Open-Meteo répond parfois 503 ou trop lentement : la requête est retentée 2 fois
(après 5 s puis 20 s) avant d'abandonner.

## Course (séance Kotcha → boucle Google Maps)

Onglet « Course » du dashboard (détails dans `dashboard/README.md`). Départ dans `.env` :

```bash
RUN_HOME_LAT=48.8566
RUN_HOME_LON=2.3522
RUN_HOME_LABEL=Maison
```

**Séance Kotcha automatique (via Garmin Connect, sans montre)** : Kotcha n'a pas
d'API, mais il envoie ses séances dans le calendrier Garmin Connect.
1. Créer un compte gratuit sur connect.garmin.com (aucun appareil nécessaire).
2. Dans Kotcha : **Moi → Connected Apps & Devices → Sync with Garmin Connect**,
   en cochant les permissions **Activities** et **Training**.
3. Vérifier que les séances apparaissent dans le calendrier Garmin Connect.
4. Une fois : `python3 scripts/garmin_workouts.py auth` (email, mot de passe,
   code MFA ; seuls des jetons sont gardés dans `.garmin_tokens/`, gitignoré).
5. Collecte : `python3 scripts/garmin_workouts.py collect` (cron horaire). La
   séance du jour pré-remplit l'onglet Course et sa boucle est calculée
   d'avance. Le fractionné est seulement affiché (il se fait au stade).

Bibliothèque non officielle (`garminconnect`) : si Garmin change son site,
la collecte peut casser ; la saisie manuelle reste toujours disponible.

En ligne de commande : `python3 scripts/run_plan.py plan --minutes 45 --pace 6:00`
(ou `--km 15 --kind sortie_longue`). Les plans vont dans `data/run_plan.json`
(gitignoré : il contient l'adresse de départ).

**App mobile « Course »** (`~/ma-course`, https://ma-course-six.vercel.app) : version
téléphone de cet onglet, qui se met à jour seule sur Vercel (Garmin + WHOOP), sans le Mac.
Les jetons de rafraîchissement Garmin et WHOOP changent à chaque utilisation et ne peuvent
vivre qu'à un endroit : c'est l'app qui les garde. Avec `COURSE_API_URL` et
`COURSE_SYNC_SECRET` dans `.env`, `whoop.py` et `garmin_workouts.py` lui demandent un jeton
d'accès (`scripts/course_cloud.py`), et leur commande `auth` lui confie les nouveaux jetons.

## Installation sur le Raspberry Pi

### Installation automatique (recommandé)

```bash
git clone git@github.com:<ton-user>/pi-tracker.git ~/pi-tracker
cd ~/pi-tracker
./deploy/install.sh
```

`deploy/install.sh` fait tout, de façon idempotente (relançable sans risque) :
paquets système, dépendances Python, dossier `logs/`, copie de `.env.example`
vers `.env`, service systemd (serveur au boot, redémarrage auto), autostart du
kiosque, rotation des logs (logrotate) et tâches cron. Il termine en listant les
étapes manuelles restantes.

### Étapes manuelles après install.sh

1. **Remplir `.env`** : clés WHOOP + Google, coordonnées météo, objectif Goal.
2. **Auth WHOOP** : `python3 scripts/whoop.py auth`
3. **Auth Google** : `python3 scripts/calendar_sync.py auth`
4. **Auto-login graphique au boot** — sans lui, le kiosque ne peut pas se lancer
   seul après un redémarrage ou une coupure de courant :
   ```bash
   sudo raspi-config
   #   1 System Options  ->  S5 Boot / Auto Login  ->  Desktop Autologin
   ```
   Équivalent non-interactif :
   ```bash
   sudo raspi-config nonint do_boot_behaviour B4   # Desktop Autologin
   ```
5. **Redémarrer** : `sudo reboot`

Après reboot : dashboard sur `http://127.0.0.1:8321`, plein écran automatique.

### Ce que fait le kiosque (deploy/kiosk.sh)

- **Écran toujours allumé** : screensaver et veille DPMS désactivés (`xset`).
- **Curseur masqué en continu** : démon `unclutter`.
- **Bureau/barre des tâches masqués** pour un affichage 100 % kiosque
  (`HIDE_DESKTOP=1`, valeur par défaut).
- **Watchdog Chromium** : si Chromium plante, il est relancé automatiquement
  (boucle) ; les drapeaux de crash sont effacés pour ne jamais afficher
  « Restaurer les pages ». Cache HTTP vidé à chaque lancement.
- **GPU** : rastérisation GPU forcée (`--ignore-gpu-blocklist`,
  `--enable-gpu-rasterization`), 2 process de rendu max pour tenir en 2 Go.
  `KIOSK_LITE=1` force le mode sans flou ; `CHROMIUM_EXTRA_FLAGS` ajoute des
  drapeaux sans éditer le script.

**Relancer le kiosque** (après une mise à jour, ou s'il fige), y compris en SSH :

```bash
./deploy/kiosk-restart.sh          # ferme Chromium, vide le cache, le watchdog relance
./deploy/kiosk-restart.sh --full   # relance aussi kiosk.sh (après l'avoir modifié)
./deploy/kiosk-restart.sh --lite   # idem, en forçant le mode sans flou
```

Le **serveur** est protégé côté systemd (`Restart=always`, `RestartSec=5`, garde
anti-crash-loop). Pour sortir du kiosque : brancher un clavier et `Alt+F4`, ou
`sudo systemctl stop tracker`.

### Mise à jour après un push GitHub

```bash
cd ~/pi-tracker && ./deploy/update.sh
```

`deploy/update.sh` fait `git pull --ff-only`, réinstalle les dépendances Python,
redémarre `tracker.service` puis relance le kiosque (`kiosk-restart.sh`), avec un message clair et un guide de résolution
si le `git pull` échoue (divergence data/ locale non poussée).

### Rotation des logs

`deploy/pi-tracker.logrotate` (installé dans `/etc/logrotate.d/` par
`install.sh`) fait une rotation quotidienne, 30 jours d'historique, compressée.
`sync.sh` borne en plus chaque `.log` à 5000 lignes en garde-fou — la carte SD
ne peut pas se remplir de logs.

### Écran tactile HAMTYSAN 10.1"

Le tactile USB est reconnu nativement (HID). Si l'affichage 1024x600 n'est pas
détecté, ajouter dans `/boot/firmware/config.txt` :

```
hdmi_group=2
hdmi_mode=87
hdmi_cvt=1024 600 60 3 0 0 0
```

## Sync GitHub

1. Créer un repo **privé** `pi-tracker` sur GitHub.
2. Sur le Pi :
   ```bash
   cd ~/pi-tracker
   git remote add origin git@github.com:<ton-user>/pi-tracker.git
   ```
3. Auth SSH recommandée pour le cron (pas de prompt) :
   ```bash
   ssh-keygen -t ed25519 -C "pi-tracker"
   cat ~/.ssh/id_ed25519.pub   # -> à ajouter dans GitHub > Settings > SSH keys
   ```
4. Tester : `./sync.sh`

`sync.sh` ne commite que si `data/` a changé ; en cas de push refusé (pas de
réseau), le commit local est conservé et repartira au prochain sync.

## Cron

```bash
crontab -e
# puis coller le contenu de deploy/crontab.example (adapter les chemins)
```

- **23h15 tous les jours** : `sync.sh` pousse les données vers GitHub
  (log dans `logs/sync.log`).
- Les futures collectes automatiques s'ajoutent sur le même
  modèle : une ligne cron → un script de `scripts/` → un JSON de `data/`.

## Sécurité

- Le serveur écoute uniquement sur `127.0.0.1` (rien d'exposé sur le réseau).
- Les noms de catégories de l'API sont validés par whitelist (anti path-traversal).
- `.env` (clés API), `.whoop_tokens.json` et `.google_tokens.json` sont ignorés
  par git ; seul `.env.example` (sans valeurs) est versionné.
- Aucun secret n'est écrit dans les logs : les scripts ne journalisent que des
  messages d'état et des données de tracking, jamais les tokens ni les clés.
- Seul `data/` (métriques non sensibles) est poussé sur GitHub par `sync.sh`.
