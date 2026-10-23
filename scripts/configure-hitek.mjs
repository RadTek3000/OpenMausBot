import { loadConfig, saveConfig } from "../server/config.ts";

const url = process.env.HITEK_MCP_URL?.trim();
const token = process.env.HITEK_MCP_TOKEN?.trim();
const name = process.env.HITEK_MCP_NAME?.trim() || "hitek-crm";

if (!url || !token) {
  throw new Error("Set HITEK_MCP_URL and HITEK_MCP_TOKEN in the hosted agent environment.");
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  throw new Error("HITEK_MCP_URL must be a valid https:// URL (or http:// localhost URL for development).");
}
const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
  throw new Error("HITEK_MCP_URL must use https://; http:// is allowed only for localhost development.");
}
if (!/^\S+$/.test(token)) throw new Error("HITEK_MCP_TOKEN must not contain whitespace.");
if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) throw new Error("HITEK_MCP_NAME must be a lowercase MCP server name.");

const config = loadConfig();
const mcpServers = { ...config.mcpServers };
mcpServers[name] = {
  type: "http",
  url: parsed.toString(),
  headers: { Authorization: `Bearer ${token}` },
  enabled: true,
};
saveConfig({ mcpServers });

console.log(`Configured MCP server ${name} at ${parsed.origin}${parsed.pathname}`);
