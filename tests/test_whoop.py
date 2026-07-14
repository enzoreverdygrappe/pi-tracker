"""Tests unitaires de scripts/whoop.py (fonctions pures, sans réseau)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.whoop import build_daily_records, merge_daily_entries


def make_recovery(date, score=66, hrv=52.31, rhr=48):
    return {
        "created_at": f"{date}T07:12:00.000Z",
        "score": {
            "recovery_score": score,
            "hrv_rmssd_milli": hrv,
            "resting_heart_rate": rhr,
            "spo2_percentage": 96.4,
        },
    }


def make_sleep(date, in_bed_h=8.0, awake_h=0.5, nap=False):
    return {
        "end": f"{date}T06:58:00.000Z",
        "nap": nap,
        "score": {
            "stage_summary": {
                "total_in_bed_time_milli": int(in_bed_h * 3_600_000),
                "total_awake_time_milli": int(awake_h * 3_600_000),
            },
            "sleep_performance_percentage": 87,
            "sleep_efficiency_percentage": 91.2,
            "respiratory_rate": 15.3,
        },
    }


def make_cycle(date, strain=12.4, kilojoule=8368.0):
    return {
        "start": f"{date}T04:00:00.000Z",
        "score": {
            "strain": strain,
            "kilojoule": kilojoule,
            "average_heart_rate": 62,
            "max_heart_rate": 171,
        },
    }


class TestBuildDailyRecords:
    def test_merges_three_sources_into_one_day(self):
        # Act
        entries = build_daily_records(
            [make_recovery("2026-07-14")],
            [make_sleep("2026-07-14")],
            [make_cycle("2026-07-14")],
        )

        # Assert
        assert len(entries) == 1
        entry = entries[0]
        assert entry["date"] == "2026-07-14"
        assert entry["recovery_pct"] == 66
        assert entry["hrv_ms"] == 52.3
        assert entry["rhr_bpm"] == 48
        assert entry["sleep_hours"] == 7.5
        assert entry["sleep_performance_pct"] == 87
        assert entry["strain"] == 12.4
        assert entry["calories_kcal"] == 2000  # 8368 kJ ~ 2000 kcal

    def test_ignores_naps(self):
        entries = build_daily_records(
            [], [make_sleep("2026-07-14", nap=True)], [])
        assert entries == []

    def test_skips_records_without_score(self):
        entries = build_daily_records(
            [{"created_at": "2026-07-14T07:00:00Z", "score": None}], [], [])
        assert entries == []

    def test_sorts_multiple_days(self):
        entries = build_daily_records(
            [make_recovery("2026-07-14"), make_recovery("2026-07-12")], [], [])
        assert [e["date"] for e in entries] == ["2026-07-12", "2026-07-14"]


class TestMergeDailyEntries:
    def test_fresh_replaces_existing_same_date(self):
        # Arrange
        existing = [{"date": "2026-07-13", "recovery_pct": 50}]
        fresh = [{"date": "2026-07-13", "recovery_pct": 61}]

        # Act
        merged = merge_daily_entries(existing, fresh)

        # Assert
        assert merged == [{"date": "2026-07-13", "recovery_pct": 61}]
        assert existing[0]["recovery_pct"] == 50  # original non muté

    def test_keeps_only_last_n_days(self):
        existing = [{"date": f"2026-06-{d:02d}"} for d in range(1, 11)]
        merged = merge_daily_entries(existing, [], keep=3)
        assert [e["date"] for e in merged] == ["2026-06-08", "2026-06-09", "2026-06-10"]

    def test_union_of_disjoint_dates_sorted(self):
        merged = merge_daily_entries(
            [{"date": "2026-07-10"}], [{"date": "2026-07-09"}])
        assert [e["date"] for e in merged] == ["2026-07-09", "2026-07-10"]
