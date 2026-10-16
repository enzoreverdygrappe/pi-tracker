"""Tests unitaires de scripts/run_route.py (géométrie, recherche de boucle, liens), sans réseau."""
import math
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.run_route import (
    LOOP_WAYPOINTS,
    distance_m,
    google_maps_url,
    loop_waypoints,
    plan_loop,
    retraced_ratio,
)

HOME = (48.8566, 2.3522)  # Paris (coordonnées génériques)


class TestLoopWaypoints:
    def test_returns_three_points_around_home(self):
        # Act
        points = loop_waypoints(HOME, radius_m=1000, bearing_deg=0)

        # Assert
        assert len(points) == LOOP_WAYPOINTS == 3
        for point in points:
            # Tous les points sont sur le cercle de rayon 1 km centré à 1 km de la maison.
            assert 0 < distance_m(HOME, point) <= 2000 + 1

    def test_bearing_changes_the_loop(self):
        north = loop_waypoints(HOME, 1000, 0)
        south = loop_waypoints(HOME, 1000, 180)
        assert north != south

    def test_opposite_point_is_one_diameter_away(self):
        points = loop_waypoints(HOME, 1000, 90)
        assert math.isclose(distance_m(HOME, points[1]), 2000, rel_tol=0.01)


class FakeRouter:
    """Routeur déterministe : distance réelle = 1,3 x le périmètre à vol d'oiseau."""

    def __init__(self, detour=1.3):
        self.detour = detour
        self.calls = 0

    def __call__(self, points):
        self.calls += 1
        legs = sum(distance_m(a, b) for a, b in zip(points, points[1:]))
        return {"distance_m": legs * self.detour, "coords": [list(p) for p in points]}


class TestPlanLoop:
    def test_converges_within_tolerance(self):
        # Arrange
        router = FakeRouter()

        # Act
        loop = plan_loop(HOME, target_m=8000, seed=0, router=router)

        # Assert
        assert abs(loop["distance_m"] - 8000) / 8000 <= 0.04
        assert len(loop["waypoints"]) == 3
        assert router.calls <= 6

    def test_seed_varies_bearing(self):
        first = plan_loop(HOME, 8000, seed=0, router=FakeRouter())
        second = plan_loop(HOME, 8000, seed=1, router=FakeRouter())
        assert first["waypoints"] != second["waypoints"]

    def test_router_failure_raises_clear_error(self):
        def broken(_points):
            raise OSError("réseau coupé")

        with pytest.raises(RuntimeError, match="Calcul d'itinéraire"):
            plan_loop(HOME, 8000, seed=0, router=broken)


class SpurRouter(FakeRouter):
    """Les premiers caps donnent un aller-retour dans une impasse (même rue 2 fois)."""

    def __init__(self, spur_calls):
        super().__init__()
        self.spur_calls = spur_calls

    def __call__(self, points):
        route = super().__call__(points)
        if self.calls <= self.spur_calls:
            home, first = points[0], points[1]
            route = {**route, "coords": [list(home), list(first), list(home), *route["coords"][1:]]}
        return route


class TestRetracedRatio:
    def test_clean_loop_is_zero(self):
        square = [[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]]
        assert retraced_ratio(square) == 0

    def test_out_and_back_counts_the_return(self):
        out_and_back = [[0, 0], [0, 0.01], [0, 0]]
        assert retraced_ratio(out_and_back) == pytest.approx(0.5)


class TestPlanLoopAvoidsSpurs:
    def test_rotates_until_loop_has_no_dead_end(self):
        router = SpurRouter(spur_calls=3)  # les premiers caps tombent dans une impasse
        loop = plan_loop(HOME, 8000, seed=0, router=router)
        assert retraced_ratio(loop["coords"]) == 0
        assert abs(loop["distance_m"] - 8000) / 8000 <= 0.04
        assert loop["bearing_deg"] != 0

    def test_keeps_least_retraced_when_every_bearing_is_bad(self):
        router = SpurRouter(spur_calls=10_000)
        loop = plan_loop(HOME, 8000, seed=0, router=router)
        assert loop["coords"]  # un tracé est quand même proposé
        assert router.calls <= 15


class TestGoogleMapsUrl:
    def test_walking_loop_with_three_waypoints(self):
        # Arrange
        waypoints = [(48.8, 2.39), (48.81, 2.4), (48.8, 2.41)]

        # Act
        url = google_maps_url(HOME, waypoints)

        # Assert
        query = parse_qs(urlparse(url).query)
        assert url.startswith("https://www.google.com/maps/dir/?api=1")
        assert query["travelmode"] == ["walking"]
        assert query["origin"] == query["destination"] == ["48.856600,2.352200"]
        assert query["waypoints"][0].count("|") == 2
