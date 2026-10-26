# HITEK Agent Desk deployment profile

This profile turns the OpenMausBot fork into a hosted HITEK dealer assistant.
Dealers should sign in to HITEK Agent Desk and use the prepared team. They
should not be asked to install Node, paste MCP tokens, or edit JSON files.

The executable hosted pilot and its remaining launch requirements are in
[`cloud/README.md`](cloud/README.md). Use that HITEK stack, not the upstream
generic Compose image or its account services.

## Configure the HITEK connection

For dealer sign-in, set these variables only in the hosted agent environment.
The HITEK Agent Desk settings screen will show a **Connect HITEK CRM** button.
The dealer signs in at HITEK, and Agent Desk stores the resulting access and
refresh tokens in its protected MCP OAuth store. No dealer credential or raw
bearer token is placed in the browser or committed to the fork.

`HITEK_MCP_OAUTH_CLIENT_ID` must be a public client registered by the HITEK
OAuth service for Agent Desk. Do not reuse a Claude client ID. The HITEK MCP
service must advertise OAuth discovery and accept the loopback PKCE redirect
used by the desktop client.

For the hosted pilot, register the exact public HTTPS callback instead and
enable `OMB_MCP_OAUTH_PUBLIC_CALLBACK=1` with an HTTPS `OMB_PUBLIC_URL`.
The cloud stack sets these values from its deployment settings.

```powershell
$env:HITEK_MCP_URL = "https://your-hitek-api-host/mcp"
$env:HITEK_MCP_OAUTH_CLIENT_ID = "<public-client-id-from-hitek>"
$env:HITEK_MCP_OAUTH_SCOPES = "mcp"
$env:HITEK_CONNECT_LABEL = "HITEK CRM"
```

For provisioning or non-interactive smoke tests only, the legacy token path is
still available. Set these variables only in the hosted agent environment;
never commit the token or place it in a browser-visible configuration file.

```powershell
$env:HITEK_MCP_URL = "https://your-hitek-api-host/mcp"
$env:HITEK_MCP_TOKEN = "dealer-scoped-token"
node scripts/configure-hitek.mjs
```

The command preserves other MCP connections and creates or updates the
`hitek-crm` remote server in the OpenMausBot data directory. The token is
stored in the server's protected config file and is never printed.

OpenMausBot can keep several MCP servers enabled at once. HITEK can therefore
be combined with inventory, accounting, messaging, or other dealer systems.
The agent may read from one connection and use the resulting context when
proposing an action through another connection.

## Verify the connection

The safe smoke test initializes MCP and lists tools. A read tool is optional:

```powershell
$env:HITEK_MCP_READ_TOOL = "get_deal"
$env:HITEK_MCP_READ_ARGS_JSON = '{"dealId":"fixture-id"}'
node scripts/test-hitek-mcp.mjs
```

Writes require both a named write tool and the exact confirmation value below.
Use a disposable staging dealer only:

```powershell
$env:HITEK_MCP_WRITE_TOOL = "update_deal"
$env:HITEK_MCP_WRITE_ARGS_JSON = '{"dealId":"fixture-id","status":"quoted"}'
$env:HITEK_MCP_WRITE_CONFIRM = "I_UNDERSTAND_THIS_WRITES_TO_STAGING"
node scripts/test-hitek-mcp.mjs
```

The smoke test refuses non-staging-looking hosts unless an operator adds an
explicit override. It never runs a write by default.

## Import the prepared team

Import `hitek-agent-team.openmaus.package` through the normal package import
flow. The package contains a HITEK coordinator, sales operations, and service
coordination roles. It contains a connection slot, not a credential. The
hosted provisioner should stamp the real HITEK MCP URL and OAuth client ID;
the dealer completes sign-in through the connection button during onboarding.

All routines start paused. Imported roles use approval-aware instructions and
must not send messages, change bookings, or mutate customer/deal records
without an explicit approval path.

## Branding and distribution

The fork's default product brand is HITEK Agent Desk. `brand.json` is also
included as a deployment reference for environments that use the existing
licensed white-label server path. Keep Apache-2.0 and third-party notices in
every distribution, and confirm any enterprise/hosted/white-label agreement
before selling a hosted service to dealers.

## Mobile

The fork's companion protocol is the hosted mobile boundary: the server keeps
agent processes, credentials, transcripts, and approvals while a future HITEK
Flutter client provides chat, approval, and notification views. The fork does
not contain a native mobile app source tree, so mobile distribution remains a
separate client release rather than a claim that the desktop package is a
phone app.
