import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launchVerificationServer } from "./control-omb.ts";
import { fixtureApi, mountPreview, type MountedPreview } from "./testing/preview-fixture.ts";
import { startFakeOAuth } from "../server/testing/fake-oauth-server.ts";
import { startFakeHttpMcp } from "../server/testing/fake-http-mcp-server.ts";

const fixture = await launchVerificationServer({ ...process.env, OMB_TEST_HITEK_MANAGED: "1", FAKE_CLAUDE_AUTH: "out", FAKE_CLAUDE_MODE: "not-logged-in" });
const oauth = await startFakeOAuth({ preRegistered: { "hitek-fixture": null } });
const mcp = await startFakeHttpMcp({ acceptBearer: oauth.isValid, wwwAuthenticate: oauth.challenge,
  tools: [{ name: "list_inquiries", inputSchema: { type: "object", properties: {} } }] });
let ui: MountedPreview | undefined;
let browser: { close(): Promise<void> } | undefined;
try {
  const api = fixtureApi(fixture.info.url);
  await api("PUT", "/api/config", { language: "en" });
  const pairing = await api("POST", "/api/auth/pairing", { scopes: ["admin", "client"] });
  let configured = false;
  let authorizationUrl = "";
  ui = await mountPreview(fixture, {
    entry: "/scripts/testing/threads-preview.tsx", route: "/__hitek-welcome.html", title: "HITEK onboarding verification",
    extraRoutes: [
      { path: "/api/hitek/connect", handler: (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(configured ? { configured: true, name: "hitek-crm", label: "HITEK CRM", url: mcp.url, oauthClientId: "hitek-fixture", scopes: ["mcp"] } : { configured: false }));
      } },
      { path: /^\/api\/mcp\/servers\/hitek-crm\/sign-in$/, method: "POST", handler: async (req, res) => {
        const response = await fetch(`${fixture.info.url}${req.url}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10", cookie: req.headers.cookie ?? "" }, body: "{}" });
        const body = await response.json();
        authorizationUrl = body.auth?.authorizationUrl || "";
        if (body.auth) body.auth.authorizationUrl = "https://oauth.example.test/authorize";
        res.writeHead(response.status, { "content-type": "application/json" }).end(JSON.stringify(body));
      } },
    ],
  });
  const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
  browser = await chromium.launch({ headless: true, executablePath: process.env.OMB_VERIFY_BROWSER_CHROME || undefined });
  const context = await (browser as any).newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error: Error) => errors.push(error.message));
  await page.addInitScript(() => { window.open = () => null; });
  const evidence = resolve(".omb-scratch/verify-evidence/hitek-onboarding");
  mkdirSync(evidence, { recursive: true });
  await page.goto(`${ui.previewUrl}?onboarding=1`, { waitUntil: "domcontentloaded" });
  assert.equal(await page.evaluate(async (code: string) => (await fetch("/api/auth/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, cookie: true, label: "HITEK fixture" }) })).status, pairing.code), 200);
  await page.reload();
  const welcome = page.locator("[data-hitek-welcome]");
  await welcome.getByRole("heading", { name: "Welcome to HITEK Agent Desk" }).waitFor();
  await welcome.getByText("Awaiting HITEK configuration", { exact: true }).waitFor();
  await welcome.getByText("Awaiting service activation", { exact: true }).waitFor();
  assert.doesNotMatch(await welcome.innerText(), /OpenMaus|MausBot|Connect an AI|Install a model|Claude|ChatGPT/);
  assert.equal(await welcome.locator("input").count(), 0);
  assert.ok(await welcome.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0));
  await page.screenshot({ path: resolve(evidence, "desktop-welcome.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(evidence, "mobile-welcome.png"), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await welcome.getByRole("button", { name: "Explore workspace" }).isVisible());
  console.log("PASS HITEK assets, pending-service states and responsive welcome");

  configured = true;
  await welcome.getByRole("button", { name: "Refresh CRM connection" }).click();
  await welcome.getByRole("button", { name: "Connect HITEK CRM" }).click();
  await welcome.getByRole("textbox", { name: "Redirect URL", exact: true }).waitFor();
  const approved = await fetch(authorizationUrl, { redirect: "manual" });
  await welcome.getByRole("textbox", { name: "Redirect URL", exact: true }).fill(approved.headers.get("location")!);
  await welcome.getByRole("button", { name: "Complete sign-in", exact: true }).click();
  await welcome.getByText("Connected", { exact: true }).waitFor();
  assert.equal(mcp.calls.length, 0, "Onboarding must not execute CRM business tools");
  const listing = (await api("GET", "/api/mcp/servers")).servers.find((server: { name: string }) => server.name === "hitek-crm");
  assert.equal(listing.enabled, true);
  assert.equal(listing.auth, "signed-in");
  await page.screenshot({ path: resolve(evidence, "mobile-crm-connected.png"), fullPage: true });
  console.log("PASS CRM OAuth, access verification and activation against an isolated fake CRM");

  await welcome.getByRole("button", { name: "Explore workspace" }).click();
  await welcome.waitFor({ state: "hidden" });
  assert.ok((await api("GET", "/api/config")).onboarding.hintsSeen.includes("hitek-welcome-v1"));
  await page.reload();
  await page.getByRole("button", { name: "Review setup", exact: true }).waitFor();
  assert.equal(await welcome.count(), 0);
  await page.getByRole("button", { name: "Review setup", exact: true }).click();
  await welcome.getByRole("heading", { name: "Welcome to HITEK Agent Desk" }).waitFor();
  await welcome.getByRole("button", { name: "Close welcome" }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "You", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.locator("[data-hitek-account]").waitFor();
  const settings = page.getByRole("dialog").filter({ has: page.locator("[data-hitek-account]") });
  assert.doesNotMatch(await settings.innerText(), /API keys|Model providers|Set CLI|Install|OpenMaus|MausBot/);
  await page.screenshot({ path: resolve(evidence, "desktop-settings.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`PASS completion, reload, replay and managed Settings; screenshots: ${evidence}`);
} finally {
  await browser?.close();
  await ui?.close();
  await mcp.close();
  await oauth.close();
  await fixture.close();
}
