"""FastAPI app that exposes a locked-down Supercell relay."""

import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.responses import Response

from app.config import RelaySettings, get_env_settings
from app.security import require_relay_auth
from app.supercell import (
    SupercellUpstreamError,
    fetch_battles,
    fetch_cards,
    fetch_chests,
    fetch_clan,
    fetch_player,
)
from app.sentry import build_sentry_config, capture_relay_error

REQUEST_ID_HEADER = "X-Request-ID"
MAX_REQUEST_ID_LENGTH = 128
LOGGER = logging.getLogger("coachroyale.relay")


def get_settings(request: Request) -> RelaySettings:
    """Resolve settings from application state."""

    return request.app.state.settings


def get_http_client(request: Request) -> httpx.AsyncClient:
    """Resolve the shared HTTP client from application state."""

    return request.app.state.http_client


def request_id_from_header(value: str | None) -> str:
    """Return a caller-provided request id or generate a safe fallback."""

    request_id = (value or "").strip()
    if request_id and len(request_id) <= MAX_REQUEST_ID_LENGTH:
        return request_id
    return str(uuid.uuid4())


def build_readiness(settings: RelaySettings) -> dict[str, Any]:
    """Build a dependency-readiness payload for probes and smoke checks."""

    checks = {
        "shared_secret": bool(settings.shared_secret.strip()),
        "supercell_api_base": bool(settings.supercell_api_base.strip()),
        "supercell_api_token": bool(settings.supercell_api_token.strip()),
    }
    ready = all(checks.values())
    return {
        "status": "ready" if ready else "not_ready",
        "service": "relay",
        "checks": checks,
    }


def create_app(settings: RelaySettings | None = None) -> FastAPI:
    """Create the relay application with shared state and exception handling."""

    resolved_settings = settings or get_env_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        timeout = httpx.Timeout(resolved_settings.request_timeout_seconds)
        limits = httpx.Limits(max_connections=20, max_keepalive_connections=10)
        async with httpx.AsyncClient(
            base_url=resolved_settings.supercell_api_base,
            timeout=timeout,
            limits=limits,
        ) as http_client:
            app.state.settings = resolved_settings
            app.state.http_client = http_client
            yield

    app = FastAPI(
        title="CoachRoyale Supercell Relay",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.middleware("http")
    async def attach_request_context(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = request_id_from_header(request.headers.get(REQUEST_ID_HEADER))
        started_at = time.perf_counter()
        request.state.request_id = request_id

        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = request_id

        if request.app.state.settings.structured_logs_enabled:
            LOGGER.info(
                json.dumps(
                    {
                        "duration_ms": round((time.perf_counter() - started_at) * 1000),
                        "method": request.method,
                        "path": request.url.path,
                        "request_id": request_id,
                        "service": "relay",
                        "status": response.status_code,
                    },
                    separators=(",", ":"),
                )
            )

        return response

    @app.exception_handler(SupercellUpstreamError)
    async def handle_supercell_error(
        _request: Request,
        error: SupercellUpstreamError,
    ) -> JSONResponse:
        return JSONResponse(status_code=error.status_code, content=error.payload)

    @app.get("/health")
    async def health(current_settings: RelaySettings = Depends(get_settings)) -> dict[str, Any]:
        return {
            "status": "ok",
            "service": "relay",
            "supercell_base_url": current_settings.supercell_api_base,
        }

    @app.get("/ready")
    async def ready(current_settings: RelaySettings = Depends(get_settings)) -> JSONResponse:
        readiness = build_readiness(current_settings)
        status_code = 200 if readiness["status"] == "ready" else 503
        return JSONResponse(status_code=status_code, content=readiness)

    @app.get("/relay/player/{tag}", dependencies=[Depends(require_relay_auth)])
    async def get_player(
        tag: str,
        settings: RelaySettings = Depends(get_settings),
        http_client: httpx.AsyncClient = Depends(get_http_client),
    ) -> Any:
        return await fetch_player(http_client, settings, tag)

    @app.get("/relay/player/{tag}/battles", dependencies=[Depends(require_relay_auth)])
    async def get_battles(
        tag: str,
        settings: RelaySettings = Depends(get_settings),
        http_client: httpx.AsyncClient = Depends(get_http_client),
    ) -> Any:
        return await fetch_battles(http_client, settings, tag)

    @app.get("/relay/player/{tag}/chests", dependencies=[Depends(require_relay_auth)])
    async def get_chests(
        tag: str,
        settings: RelaySettings = Depends(get_settings),
        http_client: httpx.AsyncClient = Depends(get_http_client),
    ) -> Any:
        return await fetch_chests(http_client, settings, tag)

    @app.get("/relay/clan/{tag}", dependencies=[Depends(require_relay_auth)])
    async def get_clan(
        tag: str,
        settings: RelaySettings = Depends(get_settings),
        http_client: httpx.AsyncClient = Depends(get_http_client),
    ) -> Any:
        return await fetch_clan(http_client, settings, tag)

    @app.get("/relay/cards", dependencies=[Depends(require_relay_auth)])
    async def get_cards_route(
        settings: RelaySettings = Depends(get_settings),
        http_client: httpx.AsyncClient = Depends(get_http_client),
    ) -> Any:
        return await fetch_cards(http_client, settings)

    @app.exception_handler(Exception)
    async def handle_general_error(request: Request, error: Exception) -> JSONResponse:
        """Catch-all exception handler with Sentry reporting."""
        request_id = (
            request.state.request_id if hasattr(request.state, "request_id") else str(uuid.uuid4())
        )

        # Capture to Sentry only if it's not an expected upstream error
        if not isinstance(error, SupercellUpstreamError):
            sentry_config = build_sentry_config(
                dsn=getattr(resolved_settings, "sentry_dsn", None),
                environment=getattr(resolved_settings, "environment", "unknown"),
                release=getattr(resolved_settings, "release", "unknown"),
            )
            await capture_relay_error(
                sentry_config,
                error,
                request_id=request_id,
                level="error",
                tags={
                    "endpoint": request.url.path,
                    "method": request.method,
                },
                extra={"request_id": request_id},
            )

        LOGGER.error(f"Unhandled exception: {error}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "request_id": request_id,
            },
        )

    return app


app = create_app()
