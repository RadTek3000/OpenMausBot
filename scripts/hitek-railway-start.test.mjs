import { describe, expect, it } from "vitest";
import { childEnvironments, railwayConfiguration } from "./hitek-railway-start.mjs";

const hosted = {
  RAILWAY_PROJECT_ID: "fixture",
  RAILWAY_VOLUME_MOUNT_PATH: "/data",
  RAILWAY_PUBLIC_DOMAIN: "desk-fixture.up.railway.app",
  PORT: "8080",
  HITEK_SUPABASE_URL: "https://fixture.supabase.co",
  HITEK_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
  OMB_SIGNIN_EMAILS: "owner@dealer.test",
};

describe("HITEK Railway launcher", () => {
  it("derives public callbacks from Railway's domain and requires a durable volume", () => {
    expect(railwayConfiguration(hosted)).toEqual({ port: "8080", origin: "https://desk-fixture.up.railway.app" });
    expect(() => railwayConfiguration({ ...hosted, RAILWAY_VOLUME_MOUNT_PATH: undefined })).toThrow(/volume at \/data/);
    expect(() => railwayConfiguration({ ...hosted, RAILWAY_PUBLIC_DOMAIN: undefined })).toThrow(/HTTPS origin/);
    expect(() => railwayConfiguration({ ...hosted, HITEK_SUPABASE_URL: undefined })).toThrow(/HITEK_SUPABASE_URL/);
    expect(() => railwayConfiguration({ ...hosted, OMB_SIGNIN_EMAILS: "@dealer.test" })).toThrow(/named admin/);
  });

  it("rejects malformed public URLs and conflicting webhook origins", () => {
    for (const OMB_PUBLIC_URL of ["http://example.test", "https://example.test/path", "https://user:pass@example.test", "https://example.test/?token=x"]) {
      expect(() => railwayConfiguration({ ...hosted, OMB_PUBLIC_URL })).toThrow(/bare HTTPS origin/);
    }
    expect(() => railwayConfiguration({ ...hosted, OMB_WEBHOOK_PUBLIC_URL: "https://other.example.test" })).toThrow(/must match/);
    expect(railwayConfiguration({ ...hosted, OMB_WEBHOOK_PUBLIC_URL: "https://desk-fixture.up.railway.app/" }).origin).toBe("https://desk-fixture.up.railway.app");
  });

  it("keeps the proxy clear of credentials and forces private service trust", () => {
    const env = { ...hosted, HITEK_SUPABASE_PUBLISHABLE_KEY: "fixture-public", HITEK_MCP_OAUTH_CLIENT_ID: "fixture-client", OMB_LOOPBACK_TRUST: "owner", OMB_PORT: "9999" };
    const { server, edge } = childEnvironments(env, railwayConfiguration(env));
    expect(server.OMB_LOOPBACK_TRUST).toBe("service");
    expect(server.OMB_PORT).toBe("8799");
    expect(server.OMB_WEBHOOK_PORT).toBe("8800");
    expect(server.OMB_PUBLIC_URL).toBe("https://desk-fixture.up.railway.app");
    expect(server.OMB_MCP_OAUTH_PUBLIC_CALLBACK).toBe("1");
    expect(edge.PORT).toBe("8080");
    expect(edge).not.toHaveProperty("HITEK_SUPABASE_PUBLISHABLE_KEY");
    expect(edge).not.toHaveProperty("HITEK_MCP_OAUTH_CLIENT_ID");
  });
});
