import json

import pytest

from scripts import course_cloud, whoop
from scripts.course_cloud import cloud_config


def test_cloud_config_needs_https_url_and_secret():
    assert cloud_config({"COURSE_API_URL": "https://course.example/", "COURSE_SYNC_SECRET": "s"}) == \
        ("https://course.example", "s")
    assert cloud_config({"COURSE_API_URL": "http://course.example", "COURSE_SYNC_SECRET": "s"}) is None
    assert cloud_config({"COURSE_API_URL": "https://course.example"}) is None
    assert cloud_config({}) is None


class _Response:
    def __init__(self, body):
        self._body = json.dumps(body).encode()

    def read(self, _size=-1):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def test_fetch_access_token_sends_secret_and_returns_data(monkeypatch):
    seen = {}

    def fake_urlopen(request, timeout):
        seen["url"], seen["auth"] = request.full_url, request.get_header("Authorization")
        return _Response({"success": True, "data": {"access_token": "A", "expires_at": 1, "client_id": None}})

    monkeypatch.setattr(course_cloud, "urlopen", fake_urlopen)
    token = course_cloud.fetch_access_token("whoop", ("https://course.example", "secret"))
    assert token["access_token"] == "A"
    assert seen == {"url": "https://course.example/api/token?provider=whoop", "auth": "Bearer secret"}


def test_fetch_access_token_reports_app_errors(monkeypatch):
    monkeypatch.setattr(course_cloud, "urlopen",
                        lambda request, timeout: _Response({"success": False, "error": "garmin non connecté"}))
    with pytest.raises(RuntimeError, match="garmin non connecté"):
        course_cloud.fetch_access_token("garmin", ("https://course.example", "s"))
    with pytest.raises(ValueError):
        course_cloud.fetch_access_token("strava", ("https://course.example", "s"))


def test_whoop_uses_the_app_token_when_configured(monkeypatch):
    monkeypatch.setattr(whoop, "cloud_config", lambda: ("https://course.example", "s"))
    monkeypatch.setattr(whoop, "fetch_access_token", lambda provider, cloud: {"access_token": f"{provider}-cloud"})
    monkeypatch.setattr(whoop, "_load_tokens", lambda: pytest.fail("local tokens must not be used"))
    assert whoop.get_access_token() == "whoop-cloud"
