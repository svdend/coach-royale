# Supercell Relay

`apps/relay` is the minimal Python service that exists only to call the Supercell API from a static IP.

## Responsibilities

- Accept only shared-secret authenticated requests from the Worker BFF
- Hold the Supercell API token
- Forward approved read requests to the Supercell API
- Return upstream failures in a normalized way

Everything else should stay out of this service.

## Security posture

- Endpoints are limited to `/health`, `/ready`, and `/relay/*`
- OpenAPI, Swagger UI, and ReDoc are disabled
- The Worker sends `X-Relay-Auth`; the relay rejects unauthenticated calls
- The Supercell token never belongs in the browser or the Worker
- The relay echoes or generates `X-Request-ID`; structured request logs are gated behind `RELAY_STRUCTURED_LOGS_ENABLED=true`

## Environment variables

`RelaySettings` is loaded with the `RELAY_` prefix:

| Variable                        | Purpose                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| `RELAY_SHARED_SECRET`           | Shared secret required by the relay                         |
| `RELAY_SUPERCELL_API_TOKEN`     | Supercell API bearer token                                  |
| `RELAY_SUPERCELL_API_BASE`      | Upstream base URL, default `https://api.clashroyale.com/v1` |
| `RELAY_REQUEST_TIMEOUT_SECONDS` | Request timeout, default `10.0`                             |
| `RELAY_STRUCTURED_LOGS_ENABLED` | Optional JSON request logs, default `false`                 |

## Local setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r apps/relay/requirements.txt
```

## Commands

```bash
(cd apps/relay && ../../.venv/bin/ruff check app tests)
(cd apps/relay && ../../.venv/bin/pytest -q)
.venv/bin/uvicorn app.main:app --app-dir apps/relay --reload
```

## Style notes

- The code is structured around small functional helpers.
- Python code follows PEP-conformant formatting and Google-style docstrings.
