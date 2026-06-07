"""Configuration for the Supercell relay service."""

from functools import lru_cache
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class RelaySettings(BaseSettings):
    """Environment-backed settings for the relay service."""

    model_config = SettingsConfigDict(
        env_prefix="RELAY_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    shared_secret: str = ""
    supercell_api_token: str = ""
    supercell_api_base: str = "https://api.clashroyale.com/v1"
    request_timeout_seconds: float = Field(default=10.0, gt=0, le=30.0)
    structured_logs_enabled: bool = False
    sentry_dsn: Optional[str] = None
    environment: str = "unknown"
    release: str = "unknown"


@lru_cache(maxsize=1)
def get_env_settings() -> RelaySettings:
    """Return cached environment settings for the process lifetime."""

    return RelaySettings()
