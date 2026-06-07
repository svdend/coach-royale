"""Tests for the Supercell relay service."""

from typing import Any

import httpx
from fastapi.testclient import TestClient

from app.config import RelaySettings
from app.main import create_app, get_http_client
from app.supercell import SupercellUpstreamError, encode_tag, normalize_tag


class FakeHttpClient:
    """Small fake for dependency overrides in route tests."""

    async def get(
        self,
        path: str,
        *,
        headers: dict[str, str],
    ) -> httpx.Response:
        assert headers["Authorization"] == "Bearer supercell-token"
        if path.startswith("/players/%232PP/battlelog"):
            return httpx.Response(200, json=[{"battle_for": "#2PP"}])
        if path.startswith("/players/%232PP/upcomingchests"):
            return httpx.Response(200, json={"items": [{"name": "Silver Chest"}]})
        if path.startswith("/players/%232PP"):
            return httpx.Response(200, json={"tag": "#2PP", "name": "Coach"})
        if path.startswith("/clans/%23ABC"):
            return httpx.Response(200, json={"tag": "#ABC", "name": "Declaw"})
        if path == "/cards":
            return httpx.Response(200, json={"items": [{"name": "Knight"}]})
        return httpx.Response(404, json={"error": "not_found"})


class ExplodingHttpClient:
    """Fake upstream client that always raises a normalized relay error."""

    async def get(self, path: str, *, headers: dict[str, str]) -> httpx.Response:
        del path
        del headers
        raise SupercellUpstreamError(
            status_code=429,
            payload={"reason": "rate_limited", "tag": "#ABC"},
        )


def build_test_client(fake_http_client: Any | None = None) -> TestClient:
    """Create a test client with fixed settings and optional fake downstream."""

    settings = RelaySettings(
        shared_secret="test-secret",
        supercell_api_token="supercell-token",
    )
    app = create_app(settings)
    if fake_http_client is not None:
        app.dependency_overrides[get_http_client] = lambda: fake_http_client
    return TestClient(app)


def test_health_is_public() -> None:
    with build_test_client() as client:
        response = client.get("/health", headers={"X-Request-ID": "relay-request-1"})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "relay-request-1"
    assert response.json()["status"] == "ok"


def test_ready_reports_configured_dependencies() -> None:
    with build_test_client() as client:
        response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "service": "relay",
        "checks": {
            "shared_secret": True,
            "supercell_api_base": True,
            "supercell_api_token": True,
        },
    }


def test_ready_reports_missing_dependencies() -> None:
    app = create_app(RelaySettings(shared_secret="", supercell_api_token=""))

    with TestClient(app) as client:
        response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "service": "relay",
        "checks": {
            "shared_secret": False,
            "supercell_api_base": True,
            "supercell_api_token": False,
        },
    }


def test_relay_requires_shared_secret() -> None:
    with build_test_client(fake_http_client=FakeHttpClient()) as client:
        response = client.get("/relay/player/2pp")

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid relay credentials"}


def test_relay_forwards_player_requests() -> None:
    with build_test_client(fake_http_client=FakeHttpClient()) as client:
        response = client.get(
            "/relay/player/2pp",
            headers={"X-Relay-Auth": "test-secret"},
        )

    assert response.status_code == 200
    assert response.json() == {"tag": "#2PP", "name": "Coach"}


def test_relay_forwards_cards_requests() -> None:
    with build_test_client(fake_http_client=FakeHttpClient()) as client:
        response = client.get(
            "/relay/cards",
            headers={"X-Relay-Auth": "test-secret"},
        )

    assert response.status_code == 200
    assert response.json() == {"items": [{"name": "Knight"}]}


def test_upstream_errors_are_normalized() -> None:
    with build_test_client(fake_http_client=ExplodingHttpClient()) as client:
        response = client.get(
            "/relay/player/abc",
            headers={"X-Relay-Auth": "test-secret"},
        )

    assert response.status_code == 429
    assert response.json() == {"reason": "rate_limited", "tag": "#ABC"}


def test_tag_helpers_normalize_and_encode() -> None:
    assert normalize_tag("2pp") == "#2PP"
    assert normalize_tag("#2pp") == "#2PP"
    assert encode_tag("2pp") == "%232PP"
