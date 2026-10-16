"""Boucle de course à pied d'une distance donnée, au départ et retour de la maison.

Principe (gratuit, sans clé) : 3 points de passage sur un cercle qui passe par
la maison, itinéraire piéton calculé par le routeur OSRM public d'OpenStreetMap
(routing.openstreetmap.de), rayon ajusté jusqu'à tomber à ±4 % de la cible.
Les 3 mêmes points servent au lien Google Maps (3 points max sur mobile).
Un point tombé dans une impasse fait faire un aller-retour sur la même rue :
ces tracés sont écartés en faisant tourner la boucle autour de la maison.
"""
from __future__ import annotations

import json
import math
from typing import Any, Callable, Sequence
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROUTER_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/driving/"
REQUEST_TIMEOUT_SECONDS = 15
USER_AGENT = "pi-tracker/1.0 (dashboard perso)"

EARTH_RADIUS_M = 6_371_000
LOOP_WAYPOINTS = 3
INSCRIBED_SQUARE_RATIO = 4 * math.sqrt(2)  # périmètre / rayon du carré inscrit
INITIAL_DETOUR = 1.25                     # rues vs vol d'oiseau, premier essai
DISTANCE_TOLERANCE = 0.04
GOLDEN_ANGLE_DEG = 137.5                  # seed -> orientations bien réparties
MAX_RETRACED = 0.06                       # part max de la boucle courue 2 fois (impasses)
ROTATIONS_DEG = (0, 45, -45, 90, -90)     # orientations essayées si impasse
ATTEMPTS_PER_BEARING = 3                  # 15 appels max : le routeur public est partagé
SEGMENT_DECIMALS = 4                      # ~10 m : même tronçon de rue à l'aller et au retour

Point = tuple[float, float]  # (lat, lon)
Router = Callable[[Sequence[Point]], dict[str, Any]]


def distance_m(a: Point, b: Point) -> float:
    """Distance haversine en mètres."""
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def destination(origin: Point, distance: float, bearing_deg: float) -> Point:
    """Point atteint depuis origin après `distance` mètres au cap bearing_deg."""
    lat1, lon1 = map(math.radians, origin)
    bearing = math.radians(bearing_deg)
    angular = distance / EARTH_RADIUS_M
    lat2 = math.asin(math.sin(lat1) * math.cos(angular)
                     + math.cos(lat1) * math.sin(angular) * math.cos(bearing))
    lon2 = lon1 + math.atan2(math.sin(bearing) * math.sin(angular) * math.cos(lat1),
                             math.cos(angular) - math.sin(lat1) * math.sin(lat2))
    return (math.degrees(lat2), math.degrees(lon2))


def loop_waypoints(home: Point, radius_m: float, bearing_deg: float) -> list[Point]:
    """3 points d'un carré inscrit dans un cercle passant par la maison.

    Le centre est à radius_m de la maison au cap bearing_deg ; les points sont
    à -90°, 0° et +90° autour du centre (le 4e coin est la maison).
    """
    center = destination(home, radius_m, bearing_deg)
    return [destination(center, radius_m, bearing_deg + offset) for offset in (-90, 0, 90)]


def osrm_route(points: Sequence[Point]) -> dict[str, Any]:
    """Itinéraire piéton via OSRM public ; coords renvoyées en [lat, lon]."""
    path = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in points)
    query = urlencode({"overview": "full", "geometries": "geojson"})
    request = Request(f"{ROUTER_URL}{path}?{query}", headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        payload = json.load(response)
    if payload.get("code") != "Ok" or not payload.get("routes"):
        raise ValueError(f"Réponse OSRM inattendue : {payload.get('code')}")
    route = payload["routes"][0]
    return {
        "distance_m": float(route["distance"]),
        "coords": [[lat, lon] for lon, lat in route["geometry"]["coordinates"]],
    }


def retraced_ratio(coords: Sequence[Sequence[float]]) -> float:
    """Part de la longueur parcourue sur un tronçon déjà emprunté (0 = vraie boucle)."""
    seen: set[frozenset] = set()
    total = retraced = 0.0
    for a, b in zip(coords, coords[1:]):
        start = (round(a[0], SEGMENT_DECIMALS), round(a[1], SEGMENT_DECIMALS))
        end = (round(b[0], SEGMENT_DECIMALS), round(b[1], SEGMENT_DECIMALS))
        length = distance_m((a[0], a[1]), (b[0], b[1]))
        total += length
        if start == end:
            continue
        segment = frozenset((start, end))
        if segment in seen:
            retraced += length
        seen.add(segment)
    return retraced / total if total else 0.0


def _score(loop: dict[str, Any], target_m: float) -> float:
    """Écart de distance + part courue deux fois : plus petit = meilleur."""
    return abs(loop["distance_m"] - target_m) / target_m + loop["retraced"]


def _is_good(loop: dict[str, Any], target_m: float) -> bool:
    return (abs(loop["distance_m"] - target_m) / target_m <= DISTANCE_TOLERANCE
            and loop["retraced"] <= MAX_RETRACED)


def plan_loop(home: Point, target_m: float, seed: int = 0,
              router: Router = osrm_route) -> dict[str, Any]:
    """Boucle à ±DISTANCE_TOLERANCE de target_m, sans aller-retour en impasse si possible.

    Pour chaque orientation, le rayon est corrigé par la distance obtenue ; on
    s'arrête au premier tracé bon sur les deux critères, sinon on rend le
    meilleur compromis (voir _score).
    """
    base = (seed * GOLDEN_ANGLE_DEG) % 360
    radius = target_m / (INSCRIBED_SQUARE_RATIO * INITIAL_DETOUR)
    best: dict[str, Any] | None = None
    for rotation in ROTATIONS_DEG:
        bearing = base + rotation
        for _ in range(ATTEMPTS_PER_BEARING):
            waypoints = loop_waypoints(home, radius, bearing)
            try:
                route = router([home, *waypoints, home])
            except (OSError, ValueError, KeyError) as error:
                raise RuntimeError(f"Calcul d'itinéraire impossible : {error}") from error
            loop = {**route, "waypoints": [list(point) for point in waypoints],
                    "bearing_deg": round(bearing % 360, 1),
                    "retraced": round(retraced_ratio(route["coords"]), 3)}
            if best is None or _score(loop, target_m) < _score(best, target_m):
                best = loop
            if _is_good(loop, target_m):
                return loop
            if route["distance_m"] > 0:
                radius *= target_m / route["distance_m"]
    return best


def google_maps_url(home: Point, waypoints: Sequence[Point]) -> str:
    """Lien d'itinéraire piéton Google Maps : maison -> 3 points -> maison."""
    def fmt(point: Point) -> str:
        return f"{point[0]:.6f},{point[1]:.6f}"

    query = urlencode({
        "api": 1,
        "origin": fmt(home),
        "destination": fmt(home),
        "waypoints": "|".join(fmt(point) for point in waypoints),
        "travelmode": "walking",
    })
    return f"https://www.google.com/maps/dir/?{query}"
