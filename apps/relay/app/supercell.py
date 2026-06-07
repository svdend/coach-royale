"""Pure helpers for Supercell relay operations."""

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from app.config import RelaySettings


def normalize_tag(tag: str) -> str:
    """Normalize a player or clan tag to the canonical Clash Royale format."""

    normalized = tag.strip().upper()
    if not normalized.startswith("#"):
        normalized = f"#{normalized}"
    return normalized


def encode_tag(tag: str) -> str:
    """Encode a normalized tag for use in upstream URLs."""

    return quote(normalize_tag(tag), safe="")


@dataclass(slots=True)
class SupercellUpstreamError(Exception):
    """A normalized upstream failure from the Supercell API."""

    status_code: int
    payload: Any


def build_supercell_headers(settings: RelaySettings) -> dict[str, str]:
    """Build authenticated headers for the Clash Royale API."""

    return {
        "Authorization": f"Bearer {settings.supercell_api_token}",
        "Accept": "application/json",
    }


async def fetch_json(
    http_client: httpx.AsyncClient,
    settings: RelaySettings,
    path: str,
) -> Any:
    """Fetch JSON from the Supercell API or raise a normalized upstream error."""

    response = await http_client.get(path, headers=build_supercell_headers(settings))

    try:
        payload = response.json()
    except ValueError:
        payload = {"error": "Upstream returned a non-JSON response"}

    if response.is_error:
        raise SupercellUpstreamError(status_code=response.status_code, payload=payload)

    return payload


async def fetch_player(
    http_client: httpx.AsyncClient,
    settings: RelaySettings,
    tag: str,
) -> Any:
    """Fetch a player's profile from Supercell."""

    return await fetch_json(http_client, settings, f"/players/{encode_tag(tag)}")


async def fetch_battles(
    http_client: httpx.AsyncClient,
    settings: RelaySettings,
    tag: str,
) -> Any:
    """Fetch a player's recent battles from Supercell."""

    return await fetch_json(http_client, settings, f"/players/{encode_tag(tag)}/battlelog")


async def fetch_chests(
    http_client: httpx.AsyncClient,
    settings: RelaySettings,
    tag: str,
) -> Any:
    """Fetch a player's upcoming chests from Supercell."""

    return await fetch_json(http_client, settings, f"/players/{encode_tag(tag)}/upcomingchests")


async def fetch_clan(
    http_client: httpx.AsyncClient,
    settings: RelaySettings,
    tag: str,
) -> Any:
    """Fetch clan information from Supercell."""

    return await fetch_json(http_client, settings, f"/clans/{encode_tag(tag)}")


async def fetch_cards(
    http_client: httpx.AsyncClient,
    settings: RelaySettings,
) -> Any:
    """Fetch the Clash Royale card catalog from Supercell."""

    return await fetch_json(http_client, settings, "/cards")
