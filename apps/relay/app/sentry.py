"""Sentry error reporting for the FastAPI relay.

Disabled by default; requires SENTRY_DSN environment variable to activate.
No PII or secrets are captured or transmitted.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class SentryConfig:
    """Disabled-by-default Sentry config built from RelaySettings."""

    dsn: str | None
    environment: str
    release: str
    enabled: bool


def build_sentry_config(
    *,
    dsn: str | None,
    environment: str = "unknown",
    release: str = "unknown",
) -> SentryConfig:
    """Build a SentryConfig from settings. Returns a disabled config when DSN is missing."""
    cleaned_dsn = (dsn or "").strip() or None
    return SentryConfig(
        dsn=cleaned_dsn,
        environment=environment,
        release=release,
        enabled=cleaned_dsn is not None,
    )


async def capture_relay_error(
    config: SentryConfig,
    error: BaseException,
    *,
    request_id: str | None = None,
    level: str = "error",
    tags: dict[str, str] | None = None,
    extra: dict[str, object] | None = None,
) -> None:
    """Send an error to Sentry. No-op when Sentry is disabled.

    This is a stub. When SENTRY_DSN is configured, replace the body with a real
    sentry-sdk integration or a direct HTTP POST to the Sentry store endpoint.
    For now we just log locally so behavior is predictable.
    """
    if not config.enabled:
        return

    LOGGER.error(
        "sentry-stub: would report %s (level=%s, request_id=%s, tags=%s, extra=%s)",
        type(error).__name__,
        level,
        request_id,
        tags,
        extra,
    )
