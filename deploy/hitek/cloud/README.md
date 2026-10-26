# HITEK Cloud Pilot

This is the HITEK-owned hosting path on `hitek/cloud-hosting`. It runs the
existing browser app and agent server on Linux. Dealers use a URL and email
code; they do not install Node, manage MCP tokens or run the desktop app.

## Implementation Status

| Area | Implemented here | Still requires an operator or follow-up |
| --- | --- | --- |
| Hosting | Docker/Caddy stack, HTTPS ingress, resource limits, pinned releases and rollback | Linux host, DNS and firewall |
| Sign-in | HITEK Supabase email OTP adapter, existing secure sessions and admin/member scopes | Supabase project, SMTP, branded email template and dealer allow-lists |
| Isolation | Separate container, data volume and Compose project per dealer | One VM per dealer for this pilot; no shared multi-dealer agent process |
| CRM | Existing Connect HITEK CRM button, PKCE and configurable public callbacks | Register each exact HTTPS redirect with the CRM OAuth provider |
| Persistence | Existing SQLite chats, attachments, approvals/audit and usage ledger; optional central usage export | Apply the optional SQL, register workspaces, schedule/export and monitor |
| Operations | CI build/publish, opt-in staging deployment, HTTPS probe, encrypted stopped-volume backups | Host/registry access, storage credentials, backup schedule and restore drill |
| Mobile | Existing responsive browser app, HITEK PNG/PWA/home-screen icons | Device acceptance testing; native apps, push and store release remain separate |

This is an operator-provisioned pilot, not a completed self-service SaaS portal.
Central invitations/provisioning, subscriptions, authoritative billing,
platform-wide quotas and a platform admin UI remain follow-up work. The
existing enterprise portal and budget/billing checks remain unchanged. Review
`enterprise/README.md` and its license before using those features commercially;
this deployment does not set an enterprise key or pretend those features are free.

## Provision One Dealer

Use a Linux VM with Docker Engine, Compose 2.30 or newer (raw env files), Node
24, an encrypted persistent disk and enough memory for the selected engine.
The template starts with a 4 GiB runtime limit and two CPUs; size the VM for
the browser/engine workload as well as the operating system. Only SSH, TCP 80
and TCP 443 should be reachable. Do not expose ports 8799/8800, the Docker
socket, or the Caddy admin API. Do not attach multiple dealers to one runtime.

Initialize a new operator-owned directory from this checkout:

```sh
node scripts/hitek-cloud.mjs init /opt/hitek-dealer
```

Provision `.env` and `runtime.env` there from your deployment/secret manager.
The examples are deliberately invalid until real values are provided.
`runtime.env` uses literal `NAME=value` lines without quotes or interpolation.
On Linux the generated files are mode 0600; use equivalent ACLs on Windows.
No domain, dealer account, CRM token or cloud credential is embedded in source.

Set `HITEK_IMAGE` to the reference emitted by the HITEK Cloud workflow. A
private GHCR package also requires a read-only registry credential on the VM.
Never use the upstream image: it does not contain these HITEK changes.

```sh
node /opt/hitek-dealer/check.mjs validate /opt/hitek-dealer
bash /opt/hitek-dealer/deploy.sh "$HITEK_IMAGE"
node /opt/hitek-dealer/check.mjs probe /opt/hitek-dealer
```

The deploy script records a successful image in `release.env`, recreates the
runtime and its network-sharing edge together, and restores the preceding
recorded image if Docker's readiness check fails. It does not roll back data
formats. Back up before upgrades and check upstream storage compatibility.
The public probe checks health, unauthenticated API denial, email sign-in and
webhook routing; it does not certify a real CRM write or a paid model call.

## Identity and Onboarding

Set `HITEK_SUPABASE_URL` and `HITEK_SUPABASE_PUBLISHABLE_KEY` to a Supabase
project under HITEK's control (managed or self-hosted). A publishable/legacy
anon key is sufficient for sign-in. Never put a service-role key in a dealer
runtime. A partial configuration fails closed rather than using upstream
account services.

Configure custom SMTP and a HITEK-branded email template containing
`{{ .Token }}`. Supabase's standard template is a magic link, whereas this
flow needs the numeric code. See the official
[email OTP guide](https://supabase.com/docs/guides/auth/auth-email-passwordless)
and [SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).
The app accepts 6-10 digits and leaves expiration/rate limiting to the identity
provider plus its existing local sign-in limits. Test delivery to a real
invited mailbox before admitting dealers.

Each runtime independently checks its email allow-list before requesting a
code and after verification. Supabase proves identity; it does not grant access
to every dealer. Local roles and revocable sessions stay in the dealer volume.
Removing a person from the runtime allow-list and recreating the runtime
revokes that local access. Disabling a Supabase user alone does not immediately
revoke an already-issued local session. Use local session revocation too.

An operator signs in first, configures a working model/provider and imports
the prepared HITEK team. Keep routines paused until tested. Then invite the
named dealer users out of band. The user chooses Connect HITEK CRM and grants
access to that dealer. Other MCP connections remain available in parallel.
Each runtime must use dealer-scoped credentials or gateway credentials, not
a platform-wide unrestricted model key. Engine processes can access files in
their own runtime; these are trusted dealer workspaces, not sandboxes between
mutually untrusted members of one dealer.

## CRM Callbacks and Events

The stack sets `OMB_MCP_OAUTH_PUBLIC_CALLBACK=1` and derives both public URLs
from `HITEK_DOMAIN`. Pre-registered OAuth clients then return directly to:

```text
https://<dealer-host>/mcp-oauth/callback
```

That exact URI must be registered at the CRM authorization server. Desktop
loopback behavior is preserved when the option is absent. Neither this branch
nor the deploy script edits CRM repositories or registrations automatically.

Create webhook subscriptions using the URL issued by the runtime's Webhooks
screen, including its per-hook credentials. Its ingress is `/hooks/<id>`, not
an invented `/webhooks/hitek` endpoint. Caddy forwards this path to the private
receiver without requiring the browser session. Register the public HTTPS
address; staging cannot reach a callback on your laptop's loopback address.
Configure any CRM production webhook-host allow-list separately when needed.

## Data and Usage

Keep the existing per-dealer data layout. Chats and local session records,
attachments, MCP OAuth credentials, approvals and usage survive restarts in
`runtime_data`. Treat the volume as sensitive; it is not application-layer
encrypted by this Compose file. Use disk encryption and encrypted backups.

For central reporting, `usage-schema.sql` creates two optional Supabase/Postgres
tables with RLS enabled and no anonymous/authenticated-role access. It is a
manual SQL runbook, not an auto-run migration. Register a workspace row using
your Supabase administration UI before importing its usage.

Run the exporter in an operator job, outside the agent runtime, against a
read-only copy/mount of that runtime's data directory:

```sh
node --env-file=/secure/hitek-metering.env scripts/hitek-usage-export.mjs /snapshot/.openmausbot <deployment-id> <YYYY-MM>
```

That job requires `HITEK_USAGE_SUPABASE_URL` and `HITEK_USAGE_SERVICE_KEY` from
the secret manager. It uploads bounded batches and ignores duplicate IDs on
retry. IDs derive from the workspace, source month, line number and contents;
keep source ledgers append-only. Unknown costs remain null. Prompts, message
text, user emails and credentials are not exported. It never deletes source
data or charges a payment method. Runtime-controlled ledger reports are not
tamper-proof billing evidence; production invoicing and hard quotas need an
authoritative model gateway with reservations and reconciliation.

## Backups and Recovery

Set `HITEK_BACKUP_IMAGE` to a verified, digest-pinned restic image. Provision
`backup.env` with a separate storage credential scoped to this dealer's backup
prefix and `backup-password` with a strong secret from your secret manager.
Keep the password in that manager for recovery, not only on the VM.

```sh
bash /opt/hitek-dealer/backup.sh init
bash /opt/hitek-dealer/backup.sh backup
bash /opt/hitek-dealer/backup.sh check
```

The backup operation stops the runtime and edge, captures the volume
consistently, then restarts them even after a backup failure. Schedule an
appropriate maintenance window; this is not a zero-downtime backup. No
retention deletion runs automatically. Configure retention deliberately.
Restore to a fresh isolated VM/volume first, then verify sign-in, chat history,
MCP refresh and webhook URLs before switching DNS. Record a successful restore
drill before production use.

## Releases and Monitoring

Pushing this branch runs HITEK Cloud tests, builds the server image, boots it
in CI and publishes a commit-tagged image. It does not auto-deploy production.
Manual deployment is gated by the `hitek-staging` GitHub environment. Set its
variables `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_PUBLIC_URL` and
secrets `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`; enable environment approvals.
Provision the deployment directory and registry access on that host first.
GitHub needs the dispatch workflow registered on the default branch for the
manual UI; until then the operator can run `deploy.sh` directly.

Monitor HTTPS health, disk space, container restarts, backup age, identity/SMTP
delivery, webhook failures and model spend. Docker health alone does not restart
an unhealthy process. Runtime logs are size-limited and the public edge does
not enable request logging that could retain OAuth query strings.

Analytics has no default project key or host. It stays disabled unless a
custom build explicitly provides `VITE_HITEK_ANALYTICS_KEY` and
`VITE_HITEK_ANALYTICS_HOST` and the person opts in. This image workflow supplies
neither. Optional upstream integrations elsewhere in the app have not been
replaced by HITEK-hosted services; don't enable those until separately reviewed.

## Verification

```sh
pnpm exec vitest run server/hitek-supabase-auth.test.ts server/hitek-cloud-api.test.ts server/account-signin.test.ts server/mcp-oauth.test.ts scripts/hitek-cloud.test.mjs scripts/hitek-usage-export.test.mjs src/lib/analytics.test.ts src/lib/analytics.wire.test.ts src/pair/PairPage.test.ts
pnpm typecheck
docker build --target server -t hitek-cloud:verify .
node scripts/smoke-hitek-cloud.mjs hitek-cloud:verify
```

The HITEK API fixture boots a real server in a temporary home with a synthetic
identity provider and fake engine. It exercises secure cookies, roles,
cross-origin rejection and public webhook addresses without live credentials.
The Docker smoke boots the actual Compose/Caddy template with fresh volumes,
a loopback-only HTTPS port and a synthetic identity provider. It checks raw
environment values, HITEK assets, protected APIs, forwarded-header spoofing,
OTP, cookie flags, roles, CSRF, SSE, webhook routing, private listeners and
session/data persistence after container recreation, then removes its own
containers and volumes. It uses Caddy's internal CA only for this fixture.
`HITEK_COMPOSE_BIN` may point to a separate Compose executable for testing on
an older Docker Desktop installation; the host installation is unchanged.

On 2026-10-26 the image build and full Docker HTTPS smoke passed locally, as
did 162 focused tests, both TypeScript checks and lint. The locale validation
still reports stale translation hashes from the preceding branding work; no
translation files were regenerated by this hosting change. Real public
DNS/certificates, SMTP, CRM authorization/writes, backup restore, model billing
and mobile-device acceptance still require deployment qualification.
