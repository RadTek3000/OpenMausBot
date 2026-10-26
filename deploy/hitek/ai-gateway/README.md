# HITEK AI Gateway (Pilot)

Run this service separately from Agent Desk. Only this service receives the AI
provider key. Agent Desk receives a different, revocable pilot credential.
It exposes only authenticated `POST /v1/chat/completions` and public `GET /health`.
It is an ordinary Node 24 container and does not depend on Railway.

## Gateway Variables

| Variable | Required / Default |
| --- | --- |
| `OPENAI_API_KEY` | Required; operator-managed provider key, never put in Agent Desk |
| `HITEK_AI_GATEWAY_TOKEN` | Required; independent randomly generated 32+ character pilot credential |
| `HITEK_AI_MODEL` | Required; exact model enabled for the provider account |
| `HITEK_AI_UPSTREAM_URL` | `https://api.openai.com/v1`; HTTPS base URL, no query or credentials |
| `HITEK_AI_REASONING_EFFORT` | Optional; e.g. `low` for a compatible reasoning model |
| `HITEK_AI_MAX_OUTPUT_TOKENS` | `4096`; includes reasoning tokens on models that count them |
| `HITEK_AI_MAX_REQUEST_BYTES` | `1048576` |
| `HITEK_AI_MAX_CONCURRENT` | `2` |
| `HITEK_AI_REQUESTS_PER_MINUTE` | `30`; each tool-loop completion counts as a request |
| `HITEK_AI_TIMEOUT_MS` | `120000`; whole-request deadline |
| `PORT` | `8080` |

Build from the repository root:

```sh
docker build -f deploy/hitek/ai-gateway/Dockerfile -t hitek-ai-gateway .
```

Use a host secret manager to inject variables. Do not commit an env file or put
keys into Docker build arguments. Expose HTTPS at the hosting edge. No volume,
agent tools, shell access endpoint, browser, or CRM credential is needed here.

## Agent Desk Variables

```ini
HITEK_MANAGED_SERVICE=1
OPENAI_COMPAT_URL=https://YOUR-GATEWAY-HOST/v1
OPENAI_COMPAT_API_KEY=YOUR-PILOT-GATEWAY-TOKEN
OPENAI_COMPAT_MODEL=YOUR-EXACT-MODEL
```

The model must match `HITEK_AI_MODEL`. `OPENAI_COMPAT_API_KEY` must be the gateway
credential, NOT `OPENAI_API_KEY`. On a host supporting cross-service secret
references, reference the gateway token instead of copying it manually.
The pinned model uses the existing native API engine; no Codex/Claude CLI or
dealer key/model setup is required. Existing chats are preserved when the route
changes; provider resume cursors are reset. Personal provider mutations are
rejected on the server, not just hidden in the UI.

## Rotation and Limits

Rotate the provider key on the gateway only. Rotate a pilot credential on both
services (or update the referenced secret), then restart both. Revoking it stops
that runtime's AI access without replacing the provider key.

The pilot gateway has one credential and one model. Its concurrency and rolling
minute limits are in memory and reset on restart; they are NOT durable billing
quotas. The runtime credential can be used by agent tools, so assume it can be
copied and abused within those limits. Configure provider spending alerts and
limits as available, and use a separate provider project/key for production
when possible. The gateway does not log prompts, responses, headers or keys.
Provider retention policies still apply; requests explicitly set `store=false`.

Before self-service multi-dealer production: add a trusted tenant/credential
registry, durable per-shop usage and spend enforcement, revocation and audit
records, key rotation without downtime, and operational monitoring. Never share
one pilot token across independent dealer workspaces. This is not that SaaS
control plane and does not replace tenant isolation in Agent Desk.

## Verification

```sh
pnpm exec vitest run scripts/hitek-ai-gateway.test.mjs scripts/hitek-managed-ai.test.mjs server/hitek-model-policy.test.ts
```

These tests use disposable local servers, fake keys and synthetic chat content.
They verify request restrictions, streaming/tool-call/usage forwarding,
timeouts, rate limits, safe errors, model pinning, read-only provider APIs and a
complete chat through the real Agent Desk server. They make no billable calls.
