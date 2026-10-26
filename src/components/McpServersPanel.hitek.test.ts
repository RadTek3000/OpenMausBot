// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const f = vi.hoisted(() => ({ api: vi.fn(), signIn: vi.fn(), state: { config: { hitekManaged: true }, bots: [] }, dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({ api: f.api, useStore: () => f }));
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn() }));
vi.mock("@/lib/mcp-sign-in", async original => ({ ...(await original<typeof import("@/lib/mcp-sign-in")>()), runMcpSignIn: f.signIn }));
const { McpServersPanel, hitekServerMatches } = await import("./McpServersPanel");
const config = { configured: true as const, name: "hitek-crm", label: "HITEK CRM", url: "https://crm.example.test/mcp", oauthClientId: "fixture-client", scopes: ["mcp"] };
const server = { name: config.name, type: "http" as const, url: config.url, enabled: true, headerKeys: [], auth: "signed-in" as const,
  oauth: { clientId: config.oauthClientId, scopes: ["mcp"], clientSecretConfigured: false, redirectUri: "https://desk.example.test/mcp-oauth/callback" } };
let saved = { ...server };
let host: HTMLDivElement, root: Root;
const ready = vi.fn();
const show = async () => { await act(async () => root.render(createElement(McpServersPanel, { hitekOnly: true, onHitekConnection: ready }))); };
const press = async (label: string) => {
  const button = [...host.querySelectorAll("button")].find(node => node.textContent?.trim() === label || node.getAttribute("aria-label") === label)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  setLocale("en"); saved = { ...server }; ready.mockReset(); f.api.mockReset(); f.signIn.mockReset();
  f.api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/hitek/connect") return config;
    if (path === "/api/mcp/servers") return { servers: [saved] };
    if (path.endsWith("/test")) return { ok: true, tools: [{ name: "crm_read" }] };
    if (path === `/api/mcp/servers/${config.name}` && init?.method === "PATCH") {
      saved = { ...saved, ...JSON.parse(String(init.body)) }; return { servers: [saved] };
    }
    if (path === `/api/mcp/servers/${config.name}/sign-out`) return { servers: [{ ...saved, auth: "required" }] };
    throw new Error(`Unexpected ${path}`);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("validates endpoint and OAuth client before claiming a CRM connection", () => {
  expect(hitekServerMatches(server, config)).toBe(true);
  expect(hitekServerMatches({ ...server, url: "https://other.example.test/mcp" }, config)).toBe(false);
  expect(hitekServerMatches({ ...server, oauth: { ...server.oauth, clientId: "other" } }, config)).toBe(false);
  expect(hitekServerMatches({ name: config.name, command: "npx", args: [], envKeys: [], enabled: true }, config)).toBe(false);
});

it("verifies tools before announcing readiness", async () => {
  await show();
  expect(f.api).toHaveBeenCalledWith(`/api/mcp/servers/${config.name}/test`, expect.objectContaining({ method: "POST" }));
  expect(ready).toHaveBeenLastCalledWith(true);
  expect(host.textContent).not.toMatch(/Whop|API key|MCP server|Claude/);
});

it("reactivates a signed-in but disabled CRM without asking for a second login", async () => {
  saved.enabled = false; await show(); await press("Connect HITEK CRM");
  expect(f.signIn).not.toHaveBeenCalled();
  expect(saved.enabled).toBe(true);
  expect(ready).toHaveBeenLastCalledWith(true);
});

it("disconnects without starting another automatic access check", async () => {
  await show(); await press("Disconnect CRM");
  expect(saved.enabled).toBe(false);
  expect(ready).toHaveBeenLastCalledWith(false);
  expect(host.textContent).toContain("Connect HITEK CRM");
  expect(f.api).toHaveBeenCalledWith(`/api/mcp/servers/${config.name}/sign-out`, { method: "POST" });
  expect(f.api.mock.calls.filter(([path]) => path.endsWith("/test"))).toHaveLength(1);
});

it("keeps member connection management read-only", async () => {
  await act(async () => root.render(createElement(McpServersPanel, { hitekOnly: true, canConnect: false })));
  expect(host.querySelector('[aria-label="Disconnect CRM"]')).toBeNull();
  expect(host.textContent).not.toContain("Connect HITEK CRM");
});

it("does not enable a connection when the CRM access check fails", async () => {
  saved.enabled = false; await show();
  f.api.mockResolvedValueOnce({ ok: false, error: "Access denied" });
  await press("Connect HITEK CRM");
  expect(saved.enabled).toBe(false);
  expect(ready).not.toHaveBeenCalledWith(true);
  expect(host.textContent).toContain("Access denied");
});

it("offers OAuth again when a saved token needs reauthorization", async () => {
  saved.enabled = false; await show();
  f.api.mockResolvedValueOnce({ ok: false, auth: "required", error: "Sign in again" });
  await press("Connect HITEK CRM");
  f.signIn.mockResolvedValueOnce({ phase: "cancelled" });
  await press("Connect HITEK CRM");
  expect(f.signIn).toHaveBeenCalledWith(config.name, expect.any(Object));
});

it("refuses a same-name connection to a different backend", async () => {
  saved.url = "https://wrong.example.test/mcp"; await show(); await press("Connect HITEK CRM");
  expect(host.textContent).toContain("does not match this service");
  expect(f.signIn).not.toHaveBeenCalled();
  expect(f.api.mock.calls.some(([path]) => path.endsWith("/test"))).toBe(false);
});

it("lets a failed configuration request retry instead of presenting it as unconfigured", async () => {
  f.api.mockImplementationOnce(async () => ({ servers: [] })).mockRejectedValueOnce(new Error("offline"));
  await show(); expect(host.textContent).toContain("Connection status unavailable");
  await press("Refresh CRM connection");
  expect(host.textContent).toContain("Connected");
});
