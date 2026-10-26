# HITEK Agent Desk hosting architecture

Implementation and verification status: [`cloud/README.md`](cloud/README.md).
The first pilot uses operator-provisioned isolated runtimes and Supabase email
identity. A full self-service control plane remains a later phase; the diagram
below is the target architecture, not a claim that every component is live.

HITEK CRM remains the source of truth for dealer, customer, vehicle, quote, job,
and booking records. Agent Desk stores the operational state needed to run a
hosted assistant: identity, conversations, approvals, usage, audit history,
and MCP connection metadata.

## Recommended shape

```text
Dealer web/mobile client
          |
          v
HITEK Agent Desk control plane
  identity, tenancy, usage, audit, approvals
          |
          +--> isolated Agent Desk runtime per dealer
          |      SQLite chats, bot state, usage ledger, data volume
          |
          +--> HITEK CRM MCP (/mcp)
          |
          +--> object storage for attachments and backups
          +--> secret manager for MCP/provider credentials
```

The first hosted version should use one isolated runtime/container and one
persistent volume per dealer. This matches OpenMausBot's local-first storage
model and keeps dealer data from sharing a filesystem or process. The control
plane can route the mobile app to the correct runtime without exposing MCP or
database credentials to the device.

## Control-plane records

Use a dedicated managed PostgreSQL database for:

- `organizations`, `memberships`, `sessions`, and device registrations;
- `agent_workspaces`, `bots`, `threads`, and message summaries;
- `mcp_connections` with a secret-manager reference, never a raw bearer token;
- `approval_requests` and `audit_events` for every proposed CRM mutation;
- `usage_events` and monthly `usage_rollups` for model input/output tokens,
  provider, model, cost, and quota enforcement;
- `subscriptions`, entitlements, limits, and suspension state.

Raw transcripts, attachments, exports, and backups belong in encrypted object
storage. Redis or a managed queue is optional for the first version, but useful
for provisioning, metering, notifications, and long-running jobs.

## HITEK CRM sign-in and token handling

The hosted runtime should expose the HITEK connection through runtime
configuration, not source code. Set `HITEK_MCP_URL` and the public
`HITEK_MCP_OAUTH_CLIENT_ID`; the fork then creates the connection on demand and
uses the existing PKCE sign-in flow. HITEK should register that client ID and
allow the loopback redirect used by the desktop client. A HITEK-specific
client registration is required; do not impersonate a Claude integration.

The `HITEK_MCP_TOKEN` bootstrap path is for provisioning and smoke tests, not
dealer onboarding. It must never be sent to the renderer or included in a
package, browser-visible config, or support ticket.

Authentication tokens and model token usage are separate concerns:

- hash device/session tokens at rest and rotate or revoke them;
- keep HITEK MCP and provider secrets in a secret manager;
- record model usage from provider responses, never by inspecting an API key;
- attach each usage event to `organization_id`, `user_id`, `runtime_id`,
  `thread_id`, and `turn_id`;
- make usage writes idempotent so retries cannot double-charge a dealer.

## HITEK CRM boundary

The agent may read CRM context from one MCP connection and use another MCP
connection for a proposed action. All sends, bookings, customer changes, deal
changes, and payments remain approval-gated in Agent Desk. The hosted layer
records the proposal, approver, request payload hash, result, and timestamp;
the CRM remains responsible for the final record mutation.

This design does not require changes to the HITEK CRM repositories. A later
optimization can centralize chat storage, but it should not be the first step:
isolated runtimes let us ship hosting while preserving OpenMausBot's existing
SQLite and usage-ledger behavior.
