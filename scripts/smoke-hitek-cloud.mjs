import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { initializeDeployment } from "./hitek-cloud.mjs";

const image = process.argv[2];
if (!image || process.argv.length !== 3) throw new Error("Usage: node scripts/smoke-hitek-cloud.mjs <local-image>");
const project = `hitek-smoke-${randomBytes(6).toString("hex")}`;
const root = mkdtempSync(join(tmpdir(), `${project}-`));
const directory = join(root, "dealer");
const composeBinary = process.env.HITEK_COMPOSE_BIN || "docker";
const prefix = process.env.HITEK_COMPOSE_BIN ? [] : ["compose"];
const compose = (...args) => execFileSync(composeBinary, [...prefix, "--project-directory", directory,
  "-p", project, "-f", join(directory, "compose.yaml"), "-f", join(directory, "fixture.yaml"), ...args],
{ encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

const socket = createServer();
await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = `https://localhost:${port}`;

function call(path, { body, cookie, headers = {}, stream = false } = {}) {
  return new Promise((resolve, reject) => {
    // Only this disposable localhost fixture uses Caddy's untrusted internal CA.
    const req = request({ hostname: "127.0.0.1", port, servername: "localhost", path, rejectUnauthorized: false,
      method: body === undefined ? "GET" : "POST",
      headers: { host: `localhost:${port}`, origin, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
    }, res => {
      const chunks = [];
      const finish = () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
      res.on("data", chunk => { chunks.push(chunk); if (stream) { finish(); res.destroy(); } });
      res.on("end", finish);
      res.on("error", reject);
    });
    req.setTimeout(10_000, () => req.destroy(new Error(`HTTPS fixture timed out: ${path}`)));
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const health = await call("/api/health").catch(() => null);
    if (health?.status === 200) return;
    await delay(1000);
  }
  throw new Error("The isolated HTTPS edge did not become ready.");
}

let started = false;
try {
  initializeDeployment(directory);
  writeFileSync(join(directory, ".env"), [
    `HITEK_DEPLOYMENT_ID=${project}`, `HITEK_IMAGE=${image}`, "HITEK_DOMAIN=localhost",
    "HITEK_TLS_EMAIL=fixture@example.test", "HITEK_WORKSPACE_LABEL=HITEK Agent Desk",
  ].join("\n"));
  const literal = 'fixture$with#literal="quotes"';
  writeFileSync(join(directory, "runtime.env"), [
    "HITEK_SUPABASE_URL=http://127.0.0.1:19990", "HITEK_SUPABASE_PUBLISHABLE_KEY=sb_publishable_fixture",
    "OMB_SIGNIN_EMAILS=owner@dealer.test", "OMB_SIGNIN_MEMBER_EMAILS=member@dealer.test",
    `HITEK_FIXTURE_LITERAL=${literal}`,
  ].join("\n"));
  writeFileSync(join(directory, "fixture.yaml"), `services:
  runtime:
    ports: !override
      - "127.0.0.1:${port}:443"
    environment:
      OMB_PUBLIC_URL: ${origin}
      OMB_WEBHOOK_PUBLIC_URL: ${origin}
    healthcheck:
      interval: 2s
      start_period: 10s
`);
  const config = JSON.parse(compose("config", "--format", "json"));
  assert.equal(config.services.runtime.environment.HITEK_FIXTURE_LITERAL, literal.replaceAll("$", () => "$$"));
  assert.equal(config.services.runtime.ports.length, 1);
  assert.equal(config.services.runtime.ports[0].host_ip, "127.0.0.1");
  started = true;
  console.log(`Booting isolated ${project} on ${origin}`);
  compose("up", "-d", "--wait", "--wait-timeout", "150");
  await ready();
  assert.equal(compose("exec", "-T", "runtime", "node", "-e", "process.stdout.write(process.env.HITEK_FIXTURE_LITERAL)"), literal);
  compose("exec", "-d", "runtime", "node", "-e", `
    require('node:http').createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      res.setHeader('content-type', 'application/json');
      if (req.url === '/auth/v1/verify') {
        if (body.token !== '123456') { res.writeHead(403); res.end('{}'); return; }
        res.end(JSON.stringify({access_token:'fixture-only-token', user:{id:body.email,email:body.email,email_confirmed_at:'2026-10-26T12:00:00Z'}}));
      } else res.end('{}');
    }).listen(19990, '127.0.0.1');
  `);
  for (let attempt = 0; attempt < 20; attempt++) {
    try { compose("exec", "-T", "runtime", "node", "-e", "fetch('http://127.0.0.1:19990').then(()=>process.exit(0)).catch(()=>process.exit(1))"); break; }
    catch (error) { if (attempt === 19) throw error; await delay(250); }
  }
  assert.equal(JSON.parse((await call("/api/health")).body).app, "openmausbot");
  const html = await call("/");
  assert.equal(html.status, 200);
  assert.match(html.body.toString(), /HITEK/);
  assert.equal(html.headers["x-content-type-options"], "nosniff");
  assert.match(html.headers["strict-transport-security"], /max-age=/);
  const manifest = JSON.parse((await call("/manifest.webmanifest")).body);
  assert.match(manifest.name, /HITEK/);
  for (const icon of ["/app-icon-192.png", "/app-icon-512.png", "/apple-touch-icon.png"]) {
    const response = await call(icon);
    assert.equal(response.status, 200);
    assert.equal(response.body.subarray(1, 4).toString(), "PNG");
  }
  assert.equal((await call("/api/bots")).status, 403);
  assert.equal((await call("/api/bots", { headers: { "x-forwarded-for": "127.0.0.1" } })).status, 403);
  const descriptor = JSON.parse((await call("/.well-known/openmausbot/environment")).body);
  assert.equal(descriptor.capabilities.emailSignIn, true);
  assert.equal((await call("/api/auth/email/start", { body: { email: "stranger@other.test" } })).status, 403);
  assert.equal((await call("/api/auth/email/start", { body: { email: "owner@dealer.test" } })).status, 200);
  assert.equal((await call("/api/auth/email/verify", { body: { email: "owner@dealer.test", code: "000000" } })).status, 401);
  const signIn = await call("/api/auth/email/verify", { body: { email: "owner@dealer.test", code: "123456" } });
  assert.equal(signIn.status, 200);
  const setCookie = signIn.headers["set-cookie"][0];
  for (const flag of ["Secure", "HttpOnly", "SameSite=Lax"]) assert.ok(setCookie.includes(flag));
  assert.ok(!signIn.body.includes("fixture-only-token"));
  const cookie = setCookie.split(";")[0];
  assert.equal((await call("/api/bots", { cookie })).status, 200);
  assert.equal((await call("/api/bots", { cookie, body: {}, headers: { origin: "https://attacker.test" } })).status, 403);
  const hooks = JSON.parse((await call("/api/webhooks", { cookie })).body);
  assert.equal(hooks.ingress.baseUrl, origin);
  const hookProbe = await call("/hooks/wh_hitek_health_probe");
  assert.ok([400, 401, 404, 405].includes(hookProbe.status));
  assert.match(hookProbe.headers["content-type"], /application\/json/);
  const stream = await call("/api/events", { cookie, stream: true });
  assert.equal(stream.status, 200);
  assert.match(stream.headers["content-type"], /text\/event-stream/);
  assert.match(stream.body.toString(), /"kind":"hello"/);
  const member = await call("/api/auth/email/verify", { body: { email: "member@dealer.test", code: "123456" } });
  assert.equal(member.status, 200);
  assert.equal((await call("/api/auth/sessions", { cookie: member.headers["set-cookie"][0].split(";")[0] })).status, 403);
  compose("exec", "-T", "runtime", "node", "-e", `
    const ips = Object.values(require('node:os').networkInterfaces()).flat().filter(i => !i.internal && i.family === 'IPv4');
    if (!ips.length) process.exit(1);
    Promise.all(ips.flatMap(i => [8799, 8800].map(async port => {
      try { await fetch('http://' + i.address + ':' + port, {signal:AbortSignal.timeout(3000)}); process.exitCode = 1; }
      catch (error) { if (error.cause?.code !== 'ECONNREFUSED') throw error; }
    }))).catch(() => process.exit(1));
  `);
  compose("exec", "-T", "runtime", "node", "-e", "require('node:fs').writeFileSync('/data/hitek-smoke-marker', 'persistent-fixture')");
  compose("up", "-d", "--force-recreate", "--wait", "--wait-timeout", "150", "runtime", "edge");
  await ready();
  assert.equal((await call("/api/bots", { cookie })).status, 200);
  assert.equal(compose("exec", "-T", "runtime", "node", "-e", "process.stdout.write(require('node:fs').readFileSync('/data/hitek-smoke-marker'))"), "persistent-fixture");
  console.log("PASS: HTTPS, HITEK assets, raw env, OTP, secure sessions, roles, CSRF, SSE, public hooks, private listeners and volume/session persistence.");
} catch (error) {
  if (started) {
    try { console.error(compose("logs", "--no-color", "--tail", "60")); } catch { /* Fixture startup may fail before creating containers. */ }
  }
  throw error;
} finally {
  if (started) compose("down", "--volumes", "--remove-orphans", "--timeout", "5");
  const child = relative(resolve(tmpdir()), resolve(root));
  if (!child.startsWith("..") && !child.includes(":") && child.startsWith("hitek-smoke-")) rmSync(root, { recursive: true, force: true });
}
