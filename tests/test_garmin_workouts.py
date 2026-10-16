"""Tests unitaires de scripts/garmin_workouts.py (parsing, sans réseau)."""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.garmin_workouts import summarize_workout, upcoming_items

TODAY = date(2026, 10, 10)
EASY_SPEED = 1000 / 360  # 6:00/km en m/s


def step(kind, condition, value, slow=None, fast=None):
    payload = {
        "type": "ExecutableStepDTO",
        "stepType": {"stepTypeKey": kind},
        "endCondition": {"conditionTypeKey": condition},
        "endConditionValue": value,
        "targetType": {"workoutTargetTypeKey": "pace.zone" if slow else "no.target"},
    }
    if slow:
        payload["targetValueOne"] = fast
        payload["targetValueTwo"] = slow
    return payload


def workout(steps, name="Footing", **extra):
    return {
        "workoutId": 42, "workoutName": name, "description": "Endurance fondamentale",
        "sportType": {"sportTypeKey": "running"},
        "workoutSegments": [{"segmentOrder": 1, "workoutSteps": steps}],
        **extra,
    }


class TestUpcomingItems:
    def test_keeps_workouts_from_today_sorted(self):
        # Arrange
        calendar = {"calendarItems": [
            {"itemType": "workout", "date": "2026-10-12", "title": "Sortie longue", "workoutId": 2},
            {"itemType": "activity", "date": "2026-10-10", "title": "Course"},
            {"itemType": "workout", "date": "2026-10-09", "title": "Hier", "workoutId": 9},
            {"itemType": "workout", "date": "2026-10-10", "title": "Footing", "workoutId": 1},
            {"itemType": "workout", "date": "2026-10-30", "title": "Trop loin", "workoutId": 3},
        ]}

        # Act
        items = upcoming_items([calendar], TODAY, days=7)

        # Assert
        assert [item["workoutId"] for item in items] == [1, 2]

    def test_deduplicates_across_months(self):
        item = {"itemType": "workout", "date": "2026-10-31", "title": "F", "workoutId": 5}
        items = upcoming_items([{"calendarItems": [item]}, {"calendarItems": [item]}],
                               date(2026, 10, 30), days=7)
        assert len(items) == 1


class TestSummarizeWorkout:
    def test_easy_run_by_time_with_pace_target(self):
        # 45 min entre 5:50 et 6:10 /km
        summary = summarize_workout(
            workout([step("interval", "time", 2700, slow=1000 / 370, fast=1000 / 350)]),
            fallback_pace_s=360)
        assert summary["duration_min"] == 45
        assert summary["pace_s"] == 360
        assert summary["distance_km"] == 7.5
        assert summary["kind"] == "footing"

    def test_repeat_group_is_fractionne(self):
        steps = [
            step("warmup", "time", 900),
            {"type": "RepeatGroupDTO", "stepType": {"stepTypeKey": "repeat"},
             "numberOfIterations": 6, "workoutSteps": [
                 step("interval", "distance", 1000, slow=1000 / 255, fast=1000 / 245),
                 step("recovery", "time", 120),
             ]},
            step("cooldown", "time", 600),
        ]
        summary = summarize_workout(workout(steps, name="6 x 1000 m"), fallback_pace_s=360)
        assert summary["kind"] == "fractionne"
        # 6 km d'intervalles + (15 + 12 + 10 min) à 6:00/km = 6 + 6,17 = 12,17 km
        assert summary["distance_km"] == 12.17
        assert summary["duration_min"] == 62

    def test_long_run_by_duration(self):
        summary = summarize_workout(workout([step("interval", "time", 6000)]), fallback_pace_s=380)
        assert summary["kind"] == "sortie_longue"
        assert summary["duration_min"] == 100

    def test_prefers_garmin_estimates_when_present(self):
        summary = summarize_workout(
            workout([step("interval", "lap.button", None)],
                    estimatedDurationInSecs=3000, estimatedDistanceInMeters=8200),
            fallback_pace_s=360)
        assert summary["duration_min"] == 50
        assert summary["distance_km"] == 8.2

    def test_lap_button_warmup_counts_as_kotcha_default(self):
        # Kotcha : échauffement « jusqu'au Lap » = 25 min ; ici à 6:00, + 30 min à 5:00 + 10 min à 6:00
        steps = [
            step("warmup", "lap.button", None, slow=1000 / 370, fast=1000 / 350),
            step("interval", "time", 1800, slow=1000 / 310, fast=1000 / 290),
            step("cooldown", "time", 600),
        ]
        summary = summarize_workout(workout(steps, name="30' Race Pace"), fallback_pace_s=360)
        assert summary["duration_min"] == 65
        assert summary["distance_km"] == 11.83  # 4,17 + 6 + 1,67
        assert summary["kind"] == "footing"

    def test_other_lap_button_step_counts_as_ten_minutes(self):
        summary = summarize_workout(workout([step("interval", "lap.button", None)]), 360)
        assert summary["duration_min"] == 10
