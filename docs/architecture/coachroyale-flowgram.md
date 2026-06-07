# CoachRoyale product flowgram

This flowgram is the code-derived operating map for the current app. It is
optimized for implementation reviews: product states, trust boundaries, backend
routes, provider gates, persistence points, and fallback behavior are all shown
in one place.

Rendered master diagram:
[generated-diagrams/coachroyale-flowgram-master.png](generated-diagrams/coachroyale-flowgram-master.png)

Review-ready diagram:
[generated-diagrams/coachroyale-flowgram-review.png](generated-diagrams/coachroyale-flowgram-review.png)

Workflow-canvas diagram:
[generated-diagrams/coachroyale-flowgram-workflow.png](generated-diagrams/coachroyale-flowgram-workflow.png)

Workflow-canvas diagram with icon labels:
[generated-diagrams/coachroyale-flowgram-workflow-labeled.png](generated-diagrams/coachroyale-flowgram-workflow-labeled.png)

Static workflow diagram:
[generated-diagrams/coachroyale-flowgram-workflow-static.png](generated-diagrams/coachroyale-flowgram-workflow-static.png)

SVG source:
[diagrams/coachroyale-flowgram-master.svg](diagrams/coachroyale-flowgram-master.svg)

Review SVG source:
[diagrams/coachroyale-flowgram-review.svg](diagrams/coachroyale-flowgram-review.svg)

Workflow SVG source:
[diagrams/coachroyale-flowgram-workflow.svg](diagrams/coachroyale-flowgram-workflow.svg)

Workflow labeled SVG source:
[diagrams/coachroyale-flowgram-workflow-labeled.svg](diagrams/coachroyale-flowgram-workflow-labeled.svg)

Static workflow SVG source:
[diagrams/coachroyale-flowgram-workflow-static.svg](diagrams/coachroyale-flowgram-workflow-static.svg)

Mermaid source:
[diagrams/coachroyale-flowgram-master.mmd](diagrams/coachroyale-flowgram-master.mmd)

Icon assets:
local SVG marks under `docs/architecture/diagrams/` are used for services with
recognizable vendor/runtime identities: React, Cloudflare, Supabase,
PostgreSQL, Anthropic, Lemon Squeezy, FastAPI, and Supercell. Internal Worker
modules, BYOK, and the operator custom model stay text-first because they do
not map to a single official service icon in this architecture.
The local marks were sourced as monochrome brand SVGs from Simple Icons for
stable offline rendering; brand and trademark rights remain with their owners.

## 1. Master flow

```mermaid
flowchart LR
  U((Player))

  subgraph Browser["Browser - apps/web"]
    SPA["React SPA\nApp.tsx"]
    LS["Local storage\nlast tag + BYOK model config"]
    SBJ["Supabase JS anon client\nsession + profile reads"]
  end

  subgraph CF["Cloudflare"]
    PAGES["Pages\nstatic assets"]
    BFF["Worker BFF\nHono /api/*"]
    WAI["Workers AI\noptional AI Gateway"]
    AE["Analytics Engine\nAI_EVENTS"]
  end

  subgraph WorkerModules["Worker domain modules"]
    AUTHZ["supabase.ts\nauth, tier, quotas, persistence"]
    ROUTER["provider-routing.ts\nproviderForAccess"]
    AI["ai.ts\nanalysis + response + weekly plan"]
    AGENT["agent.ts + tools.ts\nSSE tool loop"]
    PAY["payments.ts\ncheckout + webhook"]
    RELAYCLIENT["relay.ts\nsigned Supercell client"]
    THREADS["coach-threads.ts\nthread/message IO"]
    STATS["analytics.ts + battles.ts\nPlayerState"]
  end

  subgraph Data["Supabase"]
    AUTH["Auth\nGoogle / Discord OAuth"]
    PG[("Postgres\nprofiles, tracked players,\nanalysis history, coach threads,\nprivacy settings, usage")]
  end

  subgraph Providers["Model providers"]
    DET["Deterministic fallback"]
    ANT["Anthropic"]
    CUSTOM["Operator custom model\nOpenAI-compatible HTTPS"]
    BYOK["User BYOK endpoint\nbrowser direct"]
  end

  subgraph Commerce["Billing"]
    LEMON["Lemon Squeezy"]
  end

  subgraph GameData["Static-IP Supercell egress"]
    RELAY["FastAPI relay\napps/relay"]
    SC["Supercell API"]
  end

  U -->|"open app"| SPA
  SPA -->|"load JS/CSS"| PAGES
  SPA -->|"OAuth/session/profile"| SBJ
  SBJ --> AUTH
  SBJ -.->|"residual direct profile read\nRLS + anon key"| PG
  SPA -->|"read/write"| LS

  SPA -->|"HTTPS /api/*\nAuthorization: Bearer Supabase JWT when signed in"| BFF

  BFF --> AUTHZ
  BFF --> ROUTER
  BFF --> AI
  BFF --> AGENT
  BFF --> PAY
  BFF --> RELAYCLIENT
  BFF --> THREADS
  BFF --> STATS

  AUTHZ -->|"verify JWT via /auth/v1/user"| AUTH
  AUTHZ -->|"service role app data"| PG
  THREADS --> PG
  PAY --> LEMON
  LEMON -->|"signed webhook"| BFF

  RELAYCLIENT -->|"HTTPS + relay shared secret"| RELAY
  RELAY -->|"Bearer Supercell token\nstatic IP allowlist"| SC
  RELAYCLIENT --> STATS

  ROUTER --> DET
  ROUTER --> WAI
  ROUTER --> ANT
  ROUTER --> CUSTOM
  AI --> WAI
  AI --> ANT
  AI --> CUSTOM
  AGENT --> ANT
  SPA -.->|"BYOK deep analysis\nkey never enters Worker"| BYOK
  BFF -.->|"best-effort telemetry"| AE
```

## 2. User journey flow

```mermaid
flowchart TD
  START([Open Declaw])
  AUTHSTATE{Supabase session?}
  EMPTY["Empty/search state"]
  SAVED["Load saved tracked players"]
  SEARCH["Search Clash Royale tag"]
  PLAYER["Overview tab\nPlayerHeader + StatsPanel + BattleLog"]
  SYNC{Signed in?}
  PERSIST["POST /api/player/:tag/sync\ntracked_players + snapshots + battles"]
  TABS{Choose workflow}
  ANALYSIS["Analysis tab\nquick, deep, BYOK, history"]
  COACH["Coach tab\nweekly plan + chat"]
  PRIVACY["Privacy center\nretention, export, erase"]
  UPGRADE["UpgradeButton\ncheckout"]
  DONE([Session continues])

  START --> AUTHSTATE
  AUTHSTATE -->|anonymous| EMPTY
  AUTHSTATE -->|signed in| SAVED
  EMPTY --> SEARCH
  SAVED --> SEARCH
  SEARCH -->|"GET /api/player/:tag"| PLAYER
  SEARCH -->|"GET /api/player/:tag/battles\nbackground fetch"| PLAYER
  PLAYER --> SYNC
  SYNC -->|yes| PERSIST --> TABS
  SYNC -->|no| TABS
  TABS --> ANALYSIS
  TABS --> COACH
  TABS --> PRIVACY
  TABS --> UPGRADE
  ANALYSIS --> DONE
  COACH --> DONE
  PRIVACY --> DONE
  UPGRADE --> DONE
```

## 3. Supercell lookup and sync

```mermaid
sequenceDiagram
  autonumber
  participant Web as Browser SPA
  participant BFF as Cloudflare Worker
  participant Limit as RELAY_LIMITER
  participant Relay as FastAPI relay
  participant SC as Supercell API
  participant SB as Supabase

  Web->>BFF: GET /api/player/:tag
  BFF->>Limit: per-IP check for public relay-backed routes
  BFF->>Relay: GET /relay/player/:tag + X-Relay-Secret
  Relay->>SC: GET /players/{tag} + Supercell token
  SC-->>Relay: player JSON
  Relay-->>BFF: player JSON
  BFF-->>Web: player JSON + short cache header

  Web->>BFF: GET /api/player/:tag/battles
  BFF->>Limit: per-IP check
  BFF->>Relay: GET /relay/player/:tag/battles + X-Relay-Secret
  Relay->>SC: GET /players/{tag}/battlelog
  SC-->>Relay: battle log JSON
  Relay-->>BFF: battle log JSON
  BFF-->>Web: battle log JSON + short cache header

  alt signed-in search or manual sync
    Web->>BFF: POST /api/player/:tag/sync + Supabase JWT
    BFF->>Relay: player + battles
    BFF->>SB: upsert tracked_players, player_snapshots, battles
    BFF->>SB: enforce user retention window
    BFF-->>Web: sync summary
  end
```

## 4. Managed AI routing

This is the current runtime behavior for `/api/analysis` and
`/api/ai/respond`.

```mermaid
flowchart TD
  REQ["Analysis request\n/api/analysis or /api/ai/respond"]
  ACCESS["getManagedAiAccess\nverify JWT, read tier,\nread usage counters"]
  AUTHED{Authenticated user?}
  OP{User in OPERATOR_USER_IDS\nand custom lane configured?}
  PRO{subscription_tier = pro?}
  FREEQUOTA{Free usage within limits?}
  DET["deterministic\nanonymous fallback"]
  CUSTOM["custom model\nCUSTOM_MODEL_URL"]
  CUSTOMOK{custom returns usable text?}
  ANT["Anthropic"]
  WAI["Workers AI\nAI binding + optional gateway"]
  POOL{Workers AI pool available?}
  UPSELL["Return upsell payload\nno model text"]
  RECORD["record analysis history\nsigned-in calls"]
  TELEMETRY["AI_EVENTS datapoint\nprovider, model, tier,\nfallback, latency"]
  RESP["Return analysis/response"]

  REQ --> ACCESS --> AUTHED
  AUTHED -->|no| DET --> RESP
  AUTHED -->|yes| OP
  OP -->|yes| CUSTOM
  OP -->|no| PRO
  PRO -->|yes| ANT
  PRO -->|no| FREEQUOTA
  FREEQUOTA -->|no| UPSELL --> TELEMETRY --> RESP
  FREEQUOTA -->|yes| WAI --> POOL
  POOL -->|no / 429| UPSELL
  POOL -->|yes| RECORD
  CUSTOM --> CUSTOMOK
  CUSTOMOK -->|yes| RECORD
  CUSTOMOK -->|no| ANT
  ANT --> RECORD
  RECORD --> TELEMETRY --> RESP
```

Provider selection priority:

| Priority | Condition | Provider |
|----------|-----------|----------|
| 1 | No authenticated user | `deterministic` |
| 2 | User id is in `OPERATOR_USER_IDS` and `CUSTOM_MODEL_URL`, `CUSTOM_MODEL_KEY`, `CUSTOM_MODEL_NAME` are set | `custom` |
| 3 | Authenticated user has `subscription_tier = pro` | `anthropic` |
| 4 | Authenticated free user | `workers_ai` |

Endpoint caveat: weekly plan, classic coach question, and agentic coach chat do
not call `providerForAccess` today. They are Pro-gated and use Anthropic-backed
generation paths.

## 5. Pro coaching flows

```mermaid
flowchart TD
  COACH["Coach tab"]
  PLAN["WeeklyPlanPanel"]
  QA["CoachChat classic Q&A"]
  AGENTUI["Agentic coach chat\nfeature flag + beta toggle"]

  PROGATE["getManagedAiAccess\nrequire Pro"]
  BETAGATE["read coach_agent_beta_opt_in"]
  PLAYERCTX["playerContext\nrelay player + battles\nbuild PlayerState"]
  WEEKLY["generateWeeklyPlan\nAnthropic path"]
  ANSWER["answerCoachQuestion\nAnthropic path"]
  THREAD["resolve/create coach_threads row"]
  USERMSG["append user message"]
  LOOP["runAgentTurn\nAnthropic tool-use loop"]
  TOOLS["tools.ts\nprofile, recent battles,\nanalytics, deck stats, matchup reads"]
  SSE["SSE events\nthread, assistant_text,\ntool_call, tool_result, final/error"]
  ASSISTANTMSG["append assistant/tool messages"]

  COACH --> PLAN --> PROGATE --> PLAYERCTX --> WEEKLY
  COACH --> QA --> PROGATE --> PLAYERCTX --> ANSWER
  COACH --> AGENTUI --> PROGATE --> BETAGATE --> THREAD --> USERMSG --> LOOP
  LOOP --> TOOLS --> PLAYERCTX
  LOOP --> SSE
  LOOP --> ASSISTANTMSG
```

Agent chat properties:

| Property | Current behavior |
|----------|------------------|
| Route | `POST /api/coach/agent/:tag` |
| Transport | Server-sent events over HTTP |
| Eligibility | Authenticated Pro user plus `coach_agent_beta_opt_in = true` |
| Model | Anthropic tool-use loop |
| Tool boundary | Tools are scoped to the route player tag; the model cannot supply an arbitrary player tag |
| Persistence | `coach_threads` and immutable `coach_messages` |
| Abort behavior | Client disconnect aborts the Anthropic/tool loop |

## 6. Billing and entitlement

```mermaid
sequenceDiagram
  autonumber
  participant Web as Browser SPA
  participant BFF as Worker
  participant LS as Lemon Squeezy
  participant SB as Supabase profiles

  Web->>BFF: POST /api/payments/checkout + JWT
  BFF->>BFF: require user_id matches JWT user
  BFF->>LS: create checkout URL with custom user_id
  LS-->>BFF: checkout_url
  BFF-->>Web: checkout_url
  Web->>LS: redirect user to checkout
  LS-->>Web: redirect back ?upgraded=true
  Web->>BFF: GET /api/payments/subscription/:userId
  BFF->>SB: read subscription_tier + usage
  SB-->>BFF: tier, limits, usage_today
  BFF-->>Web: subscription status

  LS->>BFF: POST /api/payments/webhook + X-Signature
  BFF->>BFF: verify HMAC signature + validate payload
  BFF->>SB: insert idempotent webhook event
  BFF->>SB: update subscription_id/status/tier
  BFF-->>LS: { ok: true }
```

## 7. Privacy and data lifecycle

```mermaid
flowchart LR
  UI["PrivacyCenter"]
  SETTINGS["GET/PUT /api/gdpr/settings"]
  EXPORT["GET /api/gdpr/export"]
  ERASE["POST /api/gdpr/erase\nconfirmation: ERASE"]
  SB["Supabase service-role operations"]
  RETENTION["Retention enforcement\n30 / 90 / 365 days"]
  JSON["Export JSON\nprofile + tracked players + snapshots + battles + analysis + usage"]
  DELETE["Delete account-owned app data"]

  UI --> SETTINGS --> SB --> RETENTION
  UI --> EXPORT --> SB --> JSON
  UI --> ERASE --> SB --> DELETE
```

Privacy notes:

| Data | Storage / path |
|------|----------------|
| BYOK provider key | Browser local storage only; not sent to the Worker |
| Supabase anon key | Browser env only |
| Supabase service role | Worker only |
| Anthropic key | Worker only |
| Lemon webhook secret | Worker only |
| Relay shared secret | Worker and relay only |
| Supercell token | Relay only |

## 8. Route-to-feature matrix

| Feature | Browser surface | Worker route(s) | Main backend dependencies |
|---------|-----------------|-----------------|---------------------------|
| Player search | `SearchBar`, `PlayerHeader`, `StatsPanel` | `GET /api/player/:tag` | Relay -> Supercell |
| Battle log | `BattleLog` | `GET /api/player/:tag/battles` | Relay -> Supercell |
| Analytics | `PlayerAnalytics`, analysis prep | `GET /api/player/:tag/analytics` | Relay -> analytics module |
| Signed-in sync | search side effect, sync button | `POST /api/player/:tag/sync` | Relay -> Supabase |
| Quick AI | `AnalysisPanel` | `POST /api/ai/respond` | provider router, quotas, Analytics Engine |
| Deep AI | `AnalysisPanel` | `POST /api/analysis` | provider router, Relay, analytics, Analytics Engine |
| Browser BYOK | `ModelConfigPanel`, `AnalysisPanel` | none | user-supplied OpenAI-compatible URL |
| Analysis history | `AnalysisHistory` | `GET/POST /api/analysis-history` | Supabase |
| Weekly plan | `WeeklyPlanPanel` | `POST /api/coach/weekly-plan/:tag` | Pro gate, Relay, Anthropic |
| Classic coach Q&A | `CoachChat` | `POST /api/coach/question/:tag` | Pro gate, Relay, Anthropic |
| Agentic coach | `CoachChat` | `POST /api/coach/agent/:tag`, `GET/PUT /api/coach/agent-beta` | Pro + beta gate, Anthropic, tools, Supabase threads |
| Checkout | `UpgradeButton` | `POST /api/payments/checkout` | Lemon Squeezy |
| Subscription status | subscription provider | `GET /api/payments/subscription/:userId` | Supabase profiles |
| Billing webhook | external Lemon event | `POST /api/payments/webhook` | Lemon signature, Supabase profiles/events |
| Privacy controls | `PrivacyCenter` | `GET/PUT /api/gdpr/settings`, `GET /api/gdpr/export`, `POST /api/gdpr/erase` | Supabase |

## 9. Review checklist

Use this list when changing the product flow:

| Check | Question |
|-------|----------|
| Trust boundary | Did any browser path start receiving a service-role, Anthropic, Lemon, relay, or Supercell secret? |
| BYOK | Does BYOK still go browser-to-provider without Worker proxying? |
| Auth | Does the Worker verify user identity before any user-scoped read/write? |
| Entitlement | Are Pro-only routes gated before cache shortcuts or expensive work? |
| Provider routing | If a route should use managed routing, does it call `providerForAccess`? |
| Fallback | Are custom-lane failures observable and non-fatal where intended? |
| Persistence | Are user messages/results written only after validation and scoped by user id? |
| Observability | Is `X-Request-ID` propagated and is AI telemetry best-effort only? |
| Retention | Does new user-owned data participate in export, erasure, and retention policy? |

## 10. Revision history

| Date | Change |
|------|--------|
| 2026-05-19 | Initial code-derived product flowgram. |
