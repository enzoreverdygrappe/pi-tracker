# Frontend v3 · changements

Refonte complète du dashboard kiosque. Direction : widgets iOS / visionOS et
minimalisme technique façon On. Le backend Flask et les collecteurs ne changent
pas (voir plus bas pour les deux ajouts).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Les 4 pages, les points de navigation, l'écran de veille |
| `styles.css` | Tokens clair/sombre, grilles bento, cartes en verre, animations |
| `app.js` | Données (polling), rendu des widgets, swipe, thème, veille |
| `js/ui.js` | Primitives : courbe SVG lissée, anneau, jauge, contrôle segmenté, compteurs |
| `js/lite.js` | Repli performance : mesure du débit d'images, mode sans flou |
| `js/run.js` | Onglet Course : saisie, séance Kotcha, carte Leaflet, QR |
| `js/weather-icons.js` | Icônes météo line-art (repris tel quel) |
| `assets/fonts/` | Inter variable (woff2 local, licence OFL jointe) |
| `assets/leaflet/` | Leaflet 1.9.4 en local (carte de l'onglet Course) |

Supprimés : `css/style.css`, `js/core.js`, `js/charts.js`, `js/app.js`,
`js/views/*`, logos ENSIA / Claude / WHOOP. Tout reste dans l'historique git.

## Pages (swipe horizontal ou points en bas)

1. **Accueil** : horloge et date en grand, météo Paris avec les 12 prochaines
   heures, anneau de récupération WHOOP (un toucher ouvre Santé), prochains
   événements de l'agenda, courbe du coût Claude par Jour (24 h glissantes),
   Semaine ou Mois.
2. **Santé** : récupération (VFC, FC repos, SpO₂), sommeil, effort, tendance
   sur 14 jours (Récup. / Sommeil / Effort).
3. **Claude API** : coût du jour, grande courbe Jour / Semaine / Mois, limites
   du plan, modèles du jour, cumuls sur 7 et 30 jours.

4. **Course** (séance Kotcha) : Kotcha n'a pas d'API et ne se relie pas au
   WHOOP, donc la séance se saisit au tactile. On choisit Footing ou Sortie
   longue, puis durée ou distance, puis l'allure, avec −/+ (appui long pour
   faire défiler). « Tracer la boucle » affiche :
   - l'analyse : km et temps, récupération WHOOP du jour, météo, eau et gel
     pour une sortie longue ;
   - une boucle à pied de la bonne distance (±4 %) au départ de
     `RUN_HOME_*` (.env), sur fond OpenStreetMap ;
   - un QR code qui ouvre l'itinéraire piéton dans Google Maps.
   Si la passerelle Garmin Connect est en place (voir le README principal),
   la séance Kotcha du jour s'affiche en haut de la carte et pré-remplit la
   saisie. Le bouton « Utiliser » permet de la reprendre après modification.
   « Autre boucle » propose une autre orientation. Tout est gratuit et sans
   clé : le routage passe par OSRM (routing.openstreetmap.de). Google Maps
   recalcule entre les 3 points de passage, donc compte quelques centaines de
   mètres d'écart avec la boucle affichée.

## Comportements

- **Thème auto** : clair de 7 h à 20 h (#F4F2EE), graphite la nuit (#121214).
  Pour forcer : `?theme=light` ou `?theme=dark`.
- **Veille** : après 2 min sans toucher, horloge géante sur fond presque noir,
  qui se déplace un peu chaque minute (contre le marquage de l'écran). Un
  toucher la réveille sans déclencher ce qu'il y a dessous.
- **Données** : polling toutes les 60 s ; une carte n'est redessinée que si
  le `updated_at` de sa source a changé. Une source trop ancienne affiche
  « non à jour · 3 j » avec un point rouge.
- **À reconnecter** : chaque collecte note sa réussite ou son échec dans
  `data/sources_status.json` (`scripts/source_status.py`). Si l'échec vient
  d'un jeton absent ou expiré, la carte affiche « à reconnecter » (« Garmin à
  reconnecter » sur l'onglet Course) au lieu d'attendre que les données vieillissent.
- **Course** : séances Kotcha et boucle du jour relues toutes les 10 min (le
  kiosque reste allumé des jours). Les boucles qui font un aller-retour dans
  une impasse (plus de 6 % du tracé couru deux fois) sont écartées : la boucle
  tourne autour de la maison jusqu'à en trouver une propre.
- **Performance (Pi 4)** : seuls `transform` et `opacity` sont animés. Au
  chargement, le débit d'images est mesuré : sous 40 fps, le flou est
  désactivé (mode `.lite`) jusqu'au prochain chargement. Pour le forcer
  durablement : `?lite=1` ; pour l'annuler : `?lite=0`.
- **Tactile** : swipe natif (scroll-snap). Il marche aussi si l'écran USB se
  déclare comme une souris. Toutes les cibles font au moins 48 px.
- `?page=1` ou `?page=2` ouvre directement Santé ou Claude (utile en test).

## Côté backend (ajouts)

- `scripts/claude_stats.py` enregistre aussi `hourly` (coût et messages par
  heure UTC, veille incluse) pour la vue « Jour ». Tests ajoutés.
  Les jours sont maintenant comptés en heure locale, et non plus en UTC :
  l'usage entre minuit et 2 h (heure de Paris) n'est plus compté la veille.
- Météo : Paris par défaut (`scripts/weather_sync.py`, `.env.example`).

La vue Goal (Money Mission) n'est plus affichée. Ses endpoints
`/api/goal/*` et `scripts/goal.py` restent en place.

## Déploiement

`deploy/update.sh` relance maintenant le kiosque à la fin. À la main :
`./deploy/kiosk-restart.sh` (voir le README principal).
