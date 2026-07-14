# pi-tracker

Dashboard personnel de tracking, pensé pour tourner en kiosque plein écran sur un
Raspberry Pi 4 (2 Go RAM) avec écran tactile HDMI 10.1" (1024x600). Données stockées
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

**Ajouter une nouvelle métrique** (crypto, fitness…) :
1. `scripts/<nom>.py` qui écrit `data/<nom>.json` (réutiliser `scripts/common.py`)
2. `dashboard/js/views/<nom>.js` qui appelle `Views.register({...})`
3. Référencer le script dans `index.html` avant `app.js`

Rien d'autre à toucher : l'API et la barre d'onglets s'adaptent automatiquement.

**Thèmes** : 6 skins commutables au doigt via le bouton ◐ du header (Esnia,
Data, Terminal, HUD, Receipt, Brutal — inspirés des explorations
claude-usage-widget). Le choix persiste en localStorage ; `?theme=<id>` dans
l'URL force un thème. Un thème = un bloc de variables CSS dans
`dashboard/css/style.css`.

## Démarrage rapide (dev, Mac/Linux)

```bash
cd pi-tracker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Logger une session Claude
python3 scripts/claude_usage.py add --calls 12 --note "Session dev dashboard"
python3 scripts/claude_usage.py list

# Collecter les limites de plan Claude (session 5h / hebdo / Fable)
# Nécessite Claude Code connecté sur la machine (token OAuth local).
python3 scripts/claude_limits.py collect

# Lancer le dashboard
python3 server.py
# -> http://127.0.0.1:8321
```

Tests : `pytest tests/ -v`

## Installation sur le Raspberry Pi

```bash
sudo apt update
sudo apt install -y git python3-pip chromium-browser unclutter
git clone git@github.com:<ton-user>/pi-tracker.git ~/pi-tracker
cd ~/pi-tracker
pip3 install --break-system-packages flask   # ou via venv
cp .env.example .env                          # puis remplir les clés
```

### Serveur au boot (systemd)

```bash
sudo cp deploy/tracker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tracker.service
```

### Kiosque Chromium au démarrage de la session graphique

Raspberry Pi OS (LXDE / labwc) — ajouter à l'autostart :

```bash
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/tracker-kiosk.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Tracker Kiosk
Exec=/home/pi/pi-tracker/deploy/kiosk.sh
EOF
```

`deploy/kiosk.sh` attend que le serveur réponde puis lance Chromium en
`--kiosk` avec le curseur masqué (unclutter). Pour sortir du kiosque :
brancher un clavier et `Alt+F4`, ou `sudo systemctl stop tracker`.

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
- Les futures collectes automatiques (crypto, etc.) s'ajoutent sur le même
  modèle : une ligne cron → un script de `scripts/` → un JSON de `data/`.

## Sécurité

- Le serveur écoute uniquement sur `127.0.0.1` (rien d'exposé sur le réseau).
- Les noms de catégories de l'API sont validés par whitelist (anti path-traversal).
- `.env` (clés API) est ignoré par git ; seul `.env.example` est versionné.
