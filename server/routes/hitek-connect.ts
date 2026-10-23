import { PASS, type RouteHandler } from "./table.ts";

export interface HitekConnectionConfig {
  name: string;
  label: string;
  url: string;
  oauthClientId: string;
  scopes: string[];
}

export interface HitekConnectRouteDeps {
  env?: NodeJS.ProcessEnv;
}

function publicUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
    if (parsed.username || parsed.password || (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback))) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function hitekConnectionConfig(env: NodeJS.ProcessEnv = process.env): HitekConnectionConfig | null {
  const url = publicUrl(env.HITEK_MCP_URL);
  const oauthClientId = env.HITEK_MCP_OAUTH_CLIENT_ID?.trim();
  if (!url || !oauthClientId || /\s/u.test(oauthClientId)) return null;
  const scopes = (env.HITEK_MCP_OAUTH_SCOPES || "mcp").split(/[\s,]+/u).map((scope) => scope.trim()).filter(Boolean);
  if (!scopes.length) return null;
  return {
    name: "hitek-crm",
    label: env.HITEK_CONNECT_LABEL?.trim() || "HITEK CRM",
    url,
    oauthClientId,
    scopes,
  };
}

export function createHitekConnectRoutes(deps: HitekConnectRouteDeps = {}): RouteHandler {
  const env = deps.env ?? process.env;
  return async ({ res, path, method, json }) => {
    if (path !== "/api/hitek/connect") return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    res.setHeader("cache-control", "no-store");
    const config = hitekConnectionConfig(env);
    return json(res, 200, config ? { configured: true, ...config } : { configured: false });
  };
}
