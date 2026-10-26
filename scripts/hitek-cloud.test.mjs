import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { initializeDeployment, parseRuntimeEnv, probeDeployment, readDeployment, validateDeployment } from "./hitek-cloud.mjs";

const settings = { HITEK_DEPLOYMENT_ID: "dealer-one", HITEK_DOMAIN: "desk.dealer.test", HITEK_TLS_EMAIL: "ops@dealer.test", HITEK_IMAGE: `ghcr.io/operator/desk:hitek-${"a".repeat(40)}` };
const runtime = { HITEK_SUPABASE_URL: "https://auth.dealer.test", HITEK_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", OMB_SIGNIN_EMAILS: "owner@dealer.test", HITEK_MCP_URL: "https://crm.dealer.test/mcp", HITEK_MCP_OAUTH_CLIENT_ID: "fixture-client" };

describe("HITEK deployment preflight", () => {
  it("keeps secret files out of image builds and exposes only the HTTPS edge", () => {
    const ignore = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8");
    for (const path of ["**/runtime.env", "**/backup.env", "**/backup-password", "deploy/hitek/instances"]) expect(ignore).toContain(path);
    const compose = parse(readFileSync(new URL("../deploy/hitek/cloud/compose.yaml", import.meta.url), "utf8"));
    expect(compose.services.runtime.ports).toEqual(["80:80", "443:443"]);
    expect(compose.services.runtime.cap_drop).toEqual(["ALL"]);
    expect(compose.services.runtime.volumes).toEqual(["runtime_data:/data"]);
    expect(compose.services.edge.network_mode).toBe("service:runtime");
    expect(compose.services.runtime.environment.OMB_LOOPBACK_TRUST).toBe("service");
    expect(compose.services.runtime.env_file[0].format).toBe("raw");
  });
  it("derives URLs from deployment settings and never substitutes a vendor hostname", () => {
    expect(validateDeployment(settings, runtime)).toMatchObject({ publicUrl: "https://desk.dealer.test", callbackUrl: "https://desk.dealer.test/mcp-oauth/callback" });
  });
  it.each(["localhost", "127.0.0.1", "0x7f000001", "https://desk.test", "desk.test/other", "desk.test:8799", "desk.local"])("rejects a local or malformed public hostname: %s", domain => {
    expect(() => validateDeployment({ ...settings, HITEK_DOMAIN: domain }, runtime)).toThrow();
  });
  it.each(["ghcr.io/operator/desk:latest", "ghcr.io/operator/desk", "bad\nINJECT=value"])("refuses unpinned images and injected configuration: %s", image => {
    expect(() => validateDeployment({ ...settings, HITEK_IMAGE: image }, runtime)).toThrow();
  });
  it("requires a dedicated identity service, individual members and an OAuth client", () => {
    for (const patch of [{ HITEK_SUPABASE_URL: "" }, { HITEK_SUPABASE_PUBLISHABLE_KEY: "sb_secret_private" }, { OMB_SIGNIN_EMAILS: "@dealer.test" }, { HITEK_MCP_URL: "http://localhost:3000/mcp" }, { HITEK_MCP_OAUTH_CLIENT_ID: "" }, { HITEK_MCP_TOKEN: "private" }, { OMB_ADMIN_URL: "https://portal.test" }]) {
      expect(() => validateDeployment(settings, { ...runtime, ...patch })).toThrow();
    }
  });
  it("preserves literal secret characters in raw runtime env files and rejects duplicate keys", () => {
    expect(parseRuntimeEnv("# comment\nKEY=a$#b=c\n")).toEqual({ KEY: "a$#b=c" });
    expect(() => parseRuntimeEnv("KEY=first\nKEY=second")).toThrow();
  });
  it("initializes a new directory without overwriting an existing deployment", () => {
    const temp = mkdtempSync(join(tmpdir(), "hitek-deploy-"));
    try {
      const target = join(temp, "dealer");
      initializeDeployment(target);
      expect(readFileSync(join(target, "compose.yaml"), "utf8")).toContain("network_mode: service:runtime");
      if (process.platform !== "win32") {
        expect(statSync(join(target, "Caddyfile")).mode & 0o777).toBe(0o644);
        for (const secret of [".env", "runtime.env", "backup.env"]) {
          expect(statSync(join(target, secret)).mode & 0o777).toBe(0o600);
        }
      }
      expect(() => readDeployment(target)).toThrow(/real deployment value/);
      expect(() => initializeDeployment(target)).toThrow();
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
  it("checks the public boundary without creating records or invoking the agent", async () => {
    const fetchImpl = vi.fn().mockImplementation(async url => {
      if (url.endsWith("/api/health")) return Response.json({ app: "openmausbot" });
      if (url.endsWith("/api/bots")) return Response.json({ error: "sign in" }, { status: 403 });
      if (url.includes("/.well-known/")) return Response.json({ capabilities: { emailSignIn: true } });
      return Response.json({ error: "method not allowed" }, { status: 405 });
    });
    expect(await probeDeployment(validateDeployment(settings, runtime), fetchImpl)).toMatchObject({ healthy: true, privateApiProtected: true });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls.every(([, options]) => !options.method && options.redirect === "error")).toBe(true);
  });
  it("fails the probe if the proxy accidentally trusts remote clients as loopback owners", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ app: "openmausbot" })).mockResolvedValueOnce(Response.json([]));
    await expect(probeDeployment(validateDeployment(settings, runtime), fetchImpl)).rejects.toThrow(/private API/);
  });
});
