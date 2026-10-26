# Railway Free Pilot

This is a small, test-data-only deployment of HITEK Agent Desk. It keeps the
private app listeners on loopback inside one container and exposes only Caddy's
HTTP port behind Railway's HTTPS edge. It uses the existing SQLite data layout
on a Railway volume. It is one isolated runtime for one test dealer, not a
multi-tenant control plane or a production availability promise.

## Prepare

1. Create a Railway project in the HITEK-owned workspace and add a GitHub
   service from `RadTek3000/OpenMausBot`, branch `hitek/cloud-hosting`.
2. Attach the project's one Free-plan volume to that service at `/data`
   before deploying. Railway mounts volumes as root; this image prepares only
   the mount point, then runs the server and Caddy as its unprivileged user.
3. Set these service variables:

   ```text
   HITEK_IMAGE_TARGET=hitek-railway
   PORT=8080
   HITEK_SUPABASE_URL=<HITEK-owned Supabase HTTPS origin>
   HITEK_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable or legacy anon key>
   OMB_SIGNIN_EMAILS=<named pilot admin email>
   ```

   Railway passes `HITEK_IMAGE_TARGET` as a Docker build argument. The root
   Dockerfile defaults to the ordinary server image for other hosts. Do not
   set an upstream control-plane URL or put a Supabase service-role key here.
   The entrypoint fails closed without HITEK sign-in, a named admin email, a
   public HTTPS origin, or the mounted volume.
4. Under Networking, generate a Railway domain and point it at port `8080`.
   Railway supplies `RAILWAY_PUBLIC_DOMAIN` to the container. With a custom
   domain, set `OMB_PUBLIC_URL=https://<custom-domain>` explicitly. The OAuth
   callback and webhook base use that same origin; no dealer URL is compiled
   into the image. Set the healthcheck path to `/api/health`.
5. To connect the CRM, set the existing `HITEK_MCP_URL`, OAuth client ID and
   scopes as service variables for the intended **test** CRM environment.
   Register the exact HTTPS `/mcp-oauth/callback` URL with the CRM provider.
   Do not copy a local CRM token or a production dealer's credentials into
   this pilot. Model/provider credentials likewise belong in Railway service
   variables or the signed-in app's own credential flow, not in Git.
6. Deploy staged Railway changes, then test sign-in, Connect HITEK CRM, a
   harmless read, one approved test write, chat persistence after redeploy,
   and a webhook round-trip. Keep any routine that writes to CRM paused until
   the callback is verified.

The Free plan currently caps a service at 512 MB RAM and offers 0.5 GB of
volume storage. A local idle image used about 204 MiB; live browser/agent
work has not been proven to fit. Free serverless sleep can delay the first
request or return 502, so event deliveries may need retry and this is not
an always-on webhook receiver. A volume preserves chats across restarts but
does not replace encrypted backups. Keep spending and usage limits visible
in Railway, and move to an always-on host before using this with dealers.

Local qualification:

```sh
docker build --build-arg HITEK_IMAGE_TARGET=hitek-railway -t hitek-railway:verify .
node scripts/smoke-hitek-railway.mjs hitek-railway:verify
```
