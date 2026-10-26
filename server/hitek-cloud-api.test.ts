import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { waitForExit, removeTempDir } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
let home: string;
let child: ChildProcess;
let identity: Server;
let base: string;
let errors = "";
const calls: string[] = [];
const origin = "https://dealer.fixture.test";

const call = (path: string, body?: unknown, cookie?: string, requestOrigin = origin): Promise<Response> => new Promise((resolve, reject) => {
  const req = request(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { host: "dealer.fixture.test", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.19", origin: requestOrigin,
      "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  }, res => {
    let text = "";
    res.on("data", chunk => { text += String(chunk); });
    res.on("end", () => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value[0] : value);
      resolve(new Response(text, { status: res.statusCode, headers }));
    });
  });
  req.setTimeout(10_000, () => req.destroy(new Error("Fixture request timed out.")));
  req.on("error", reject);
  req.end(body === undefined ? undefined : JSON.stringify(body));
});

beforeAll(async () => {
  identity = createServer(async (req, res) => {
    calls.push(req.url ?? "");
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("content-type", "application/json");
    if (req.url === "/auth/v1/verify") {
      if (body.token !== "123456") { res.writeHead(403); res.end('{}'); return; }
      res.end(JSON.stringify({ access_token: "fixture-only-provider-token", user: { id: body.email, email: body.email, email_confirmed_at: "2026-10-26T12:00:00Z" } }));
    } else { res.end('{}'); }
  });
  await new Promise<void>(resolve => identity.listen(0, "127.0.0.1", resolve));
  const address = identity.address();
  if (!address || typeof address === "string") throw new Error("Fixture identity did not listen.");
  home = mkdtempSync(join(tmpdir(), "hitek-cloud-api-"));
  mkdirSync(join(home, "tmp"));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  writeFileSync(join(home, "config.json"), JSON.stringify({ instances: {
    claude: { driver: "claudeAgent", config: { cli: join(root, "server/testing/fake-claude-cli.ts") } },
  } }));
  const env = {
    ...verificationServerEnvironment(process.env, home, port),
    HITEK_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
    HITEK_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    OMB_SIGNIN_EMAILS: "owner@dealer.test", OMB_SIGNIN_MEMBER_EMAILS: "member@dealer.test",
    OMB_PUBLIC_URL: origin, OMB_WEBHOOK_PUBLIC_URL: origin, OMB_MCP_OAUTH_PUBLIC_CALLBACK: "1",
    OMB_LOOPBACK_TRUST: "service",
  };
  child = spawn(process.execPath, verificationServerArgs(env), { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr?.on("data", chunk => { errors += String(chunk); });
  child.stdout?.on("data", chunk => { errors += String(chunk); });
  child.on("error", error => { errors += error.message; });
  await vi.waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`Fixture exited: ${errors}`);
    const healthy = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok).catch(() => false);
    if (!healthy) throw new Error(`Fixture not ready: ${errors}`);
  }, { timeout: 50_000, interval: 250 });
}, 60_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (identity) await new Promise<void>(resolve => { identity.closeAllConnections(); identity.close(() => resolve()); });
  if (home) await removeTempDir(home);
});

it("runs the HITEK identity adapter through the real session, permissions and webhook APIs", async () => {
  expect((await call("/api/bots")).status).toBe(403);
  const descriptor = await (await call("/.well-known/openmausbot/environment")).json();
  expect(descriptor).toMatchObject({ capabilities: { emailSignIn: true } });
  expect((await call("/api/auth/email/start", { email: "stranger@other.test" })).status).toBe(403);
  expect(calls).toEqual([]);
  expect((await call("/api/auth/email/start", { email: "owner@dealer.test" })).status).toBe(200);
  expect((await call("/api/auth/email/verify", { email: "owner@dealer.test", code: "000000" })).status).toBe(401);
  const signedIn = await call("/api/auth/email/verify", { email: "owner@dealer.test", code: "123456" });
  expect(signedIn.status).toBe(200);
  const setCookie = signedIn.headers.get("set-cookie") ?? "";
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  expect(setCookie).toContain("SameSite=Lax");
  const cookie = setCookie.split(";")[0];
  expect(await signedIn.text()).not.toContain("fixture-only-provider-token");
  expect((await call("/api/bots", undefined, cookie)).status).toBe(200);
  expect(await (await call("/api/config", undefined, cookie)).json()).toMatchObject({ hitekManaged: true });
  expect((await call("/api/bots", {}, cookie, "https://attacker.test")).status).toBe(403);
  const webhooks = await call("/api/webhooks", undefined, cookie);
  expect(webhooks.status).toBe(200);
  expect(await webhooks.json()).toMatchObject({ ingress: { baseUrl: origin } });
  const member = await call("/api/auth/email/verify", { email: "member@dealer.test", code: "123456" });
  expect(member.status).toBe(200);
  const memberCookie = (member.headers.get("set-cookie") ?? "").split(";")[0];
  expect((await call("/api/auth/sessions", undefined, memberCookie)).status).toBe(403);
  await expect.poll(() => calls.filter(path => path === "/auth/v1/logout?scope=local").length).toBe(2);
});
