"""Tests unitaires de scripts/claude_stats.py (agrégation, sans I/O)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.claude_stats import (
    cost_usd,
    local_day,
    merge_daily_entries,
    parse_usage_lines,
    prettify_project,
)


def make_line(day="2026-07-18", model="claude-fable-5", output=1000,
              input_tokens=100, cache_read=0, entry_type="assistant"):
    return {
        "type": entry_type,
        "timestamp": f"{day}T10:00:00.000Z",
        "message": {
            "model": model,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output,
                "cache_read_input_tokens": cache_read,
                "cache_creation_input_tokens": 0,
            },
        },
    }


class TestLocalDay:
    def test_converts_utc_timestamp_to_local_date(self):
        # 23:30 UTC le 17 : le 18 en heure de Paris (UTC+2 l'été).
        from datetime import datetime, timedelta, timezone
        paris = timezone(timedelta(hours=2))
        assert local_day("2026-07-17T23:30:00.000Z", paris) == "2026-07-18"
        assert local_day("2026-07-17T21:30:00.000Z", paris) == "2026-07-17"

    def test_unparseable_timestamp_falls_back_to_prefix(self):
        assert local_day("2026-07-17-garbage") == "2026-07-17"


class TestParseUsageLines:
    def test_aggregates_per_day_and_today_buckets(self):
        # Arrange
        lines = {"-Users-enzor-pi-tracker": [
            make_line(output=1_000_000, input_tokens=0),  # 1M out Fable = $50
            make_line(day="2026-07-17", output=500),
        ]}

        # Act
        parsed = parse_usage_lines(lines, "2026-07-01", "2026-07-18")

        # Assert
        assert parsed["days"]["2026-07-18"]["messages"] == 1
        assert parsed["days"]["2026-07-18"]["cost_usd"] == 50.0
        assert parsed["days"]["2026-07-17"]["output_tokens"] == 500
        assert parsed["today_projects"] == {"-Users-enzor-pi-tracker": 1_000_000}
        assert parsed["today_models"]["claude-fable-5"]["output_tokens"] == 1_000_000

    def test_hourly_buckets_since_cutoff(self):
        # Arrange
        early = make_line(day="2026-07-18", output=1_000_000, input_tokens=0)
        late = {**make_line(day="2026-07-18", output=500),
                "timestamp": "2026-07-18T14:59:59.000Z"}
        lines = {"p": [early, late, make_line(day="2026-07-16")]}

        # Act
        parsed = parse_usage_lines(lines, "2026-07-01", "2026-07-18",
                                   hourly_since="2026-07-17")

        # Assert
        assert set(parsed["hourly"]) == {"2026-07-18T10", "2026-07-18T14"}
        assert parsed["hourly"]["2026-07-18T10"] == {"messages": 1, "cost_usd": 50.0}
        assert parsed["hourly"]["2026-07-18T14"]["messages"] == 1

    def test_hourly_defaults_to_today_only(self):
        lines = {"p": [make_line(day="2026-07-17"), make_line(day="2026-07-18")]}
        parsed = parse_usage_lines(lines, "2026-07-01", "2026-07-18")
        assert list(parsed["hourly"]) == ["2026-07-18T10"]

    def test_skips_non_assistant_and_synthetic(self):
        lines = {"p": [
            make_line(entry_type="user"),
            make_line(model="<synthetic>"),
        ]}
        parsed = parse_usage_lines(lines, "2026-07-01", "2026-07-18")
        assert parsed["days"] == {}

    def test_skips_days_before_cutoff(self):
        lines = {"p": [make_line(day="2026-06-01")]}
        parsed = parse_usage_lines(lines, "2026-07-01", "2026-07-18")
        assert parsed["days"] == {}

    def test_cache_savings_counted(self):
        # 1M cache_read Fable : plein tarif $10, cache $1 -> $9 économisés
        lines = {"p": [make_line(output=0, input_tokens=0, cache_read=1_000_000)]}
        parsed = parse_usage_lines(lines, "2026-07-01", "2026-07-18")
        assert parsed["days"]["2026-07-18"]["cache_saved_usd"] == 9.0


class TestCostUsd:
    def test_fable_pricing(self):
        usage = {"input": 1_000_000, "output": 1_000_000,
                 "cache_read": 0, "cache_creation": 0}
        assert cost_usd("claude-fable-5", usage) == 60.0  # $10 + $50

    def test_unknown_model_falls_back_to_sonnet_rates(self):
        usage = {"input": 1_000_000, "output": 0, "cache_read": 0, "cache_creation": 0}
        assert cost_usd("mystery-model", usage) == 3.0


class TestPrettifyProject:
    def test_home_prefix_becomes_tilde(self):
        home_dashed = str(Path.home()).replace("/", "-")
        assert prettify_project(f"{home_dashed}-pi-tracker") == "~/pi-tracker"

    def test_home_itself_becomes_tilde(self):
        assert prettify_project(str(Path.home()).replace("/", "-")) == "~"

    def test_other_names_keep_readable_form(self):
        assert prettify_project("-opt-projects-demo") == "opt-projects-demo"


class TestMergeDailyEntries:
    def test_fresh_replaces_and_sorts(self):
        merged = merge_daily_entries(
            [{"date": "2026-07-17", "messages": 1}],
            [{"date": "2026-07-17", "messages": 9}, {"date": "2026-07-16", "messages": 2}])
        assert [entry["date"] for entry in merged] == ["2026-07-16", "2026-07-17"]
        assert merged[1]["messages"] == 9
