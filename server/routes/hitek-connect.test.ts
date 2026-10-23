import { describe, expect, it } from "vitest";

import { hitekConnectionConfig } from "./hitek-connect.ts";

describe("HITEK connection configuration", () => {
  it("requires a public MCP URL and OAuth client ID", () => {
    expect(hitekConnectionConfig({})).toBeNull();
    expect(hitekConnectionConfig({ HITEK_MCP_URL: "https://crm.example.test/mcp" })).toBeNull();
    expect(hitekConnectionConfig({
      HITEK_MCP_URL: "https://crm.example.test/mcp",
      HITEK_MCP_OAUTH_CLIENT_ID: "hitek-agent-desk",
    })).toEqual({
      name: "hitek-crm",
      label: "HITEK CRM",
      url: "https://crm.example.test/mcp",
      oauthClientId: "hitek-agent-desk",
      scopes: ["mcp"],
    });
  });

  it("accepts loopback HTTP for development but rejects unsafe endpoints", () => {
    const base = { HITEK_MCP_OAUTH_CLIENT_ID: "hitek-agent-desk" };
    expect(hitekConnectionConfig({ ...base, HITEK_MCP_URL: "http://localhost:3000/mcp" })).not.toBeNull();
    expect(hitekConnectionConfig({ ...base, HITEK_MCP_URL: "http://crm.example.test/mcp" })).toBeNull();
    expect(hitekConnectionConfig({ ...base, HITEK_MCP_URL: "https://user:pass@crm.example.test/mcp" })).toBeNull();
    expect(hitekConnectionConfig({ ...base, HITEK_MCP_URL: "https://crm.example.test/mcp", HITEK_MCP_OAUTH_CLIENT_ID: "contains whitespace" })).toBeNull();
  });

  it("normalizes the optional label and scopes", () => {
    expect(hitekConnectionConfig({
      HITEK_MCP_URL: "https://crm.example.test/mcp",
      HITEK_MCP_OAUTH_CLIENT_ID: "client-123",
      HITEK_CONNECT_LABEL: "  Dealer CRM  ",
      HITEK_MCP_OAUTH_SCOPES: "mcp, profile   records",
    })).toMatchObject({ label: "Dealer CRM", scopes: ["mcp", "profile", "records"] });
  });
});
