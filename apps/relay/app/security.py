"""Security helpers for relay-only authentication."""

from hmac import compare_digest

from fastapi import HTTPException, Request, status


RELAY_AUTH_HEADER = "X-Relay-Auth"


def require_relay_auth(request: Request) -> None:
    """Reject requests that do not present the shared relay secret."""

    settings = request.app.state.settings
    provided_secret = request.headers.get(RELAY_AUTH_HEADER, "")

    if not settings.shared_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Relay shared secret is not configured",
        )

    if not compare_digest(provided_secret, settings.shared_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid relay credentials",
        )
