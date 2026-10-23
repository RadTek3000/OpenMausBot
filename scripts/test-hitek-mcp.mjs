const url = process.env.HITEK_MCP_URL?.trim();
const token = process.env.HITEK_MCP_TOKEN?.trim();
if (!url || !token) throw new Error("Set HITEK_MCP_URL and HITEK_MCP_TOKEN.");

const parsed = new URL(url);
const isLoopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
  throw new Error("The MCP URL must use https://, except for localhost development.");
}

let nextId = 1;
async function rpc(method, params, { notification = false } = {}) {
  const response = await fetch(parsed, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: nextId++ }), method, ...(params === undefined ? {} : { params }) }),
  });
  const body = await response.text();
  if (notification) {
    if (!response.ok) throw new Error(`MCP notification failed (${response.status})`);
    return undefined;
  }
  let payload;
  try {
    const event = body.split(/\r?\n/).filter((line) => line.startsWith("data:")).at(-1);
    payload = JSON.parse(event ? event.slice(5).trim() : body);
  } catch {
    throw new Error(`MCP returned a non-JSON response (${response.status})`);
  }
  if (!response.ok) throw new Error(`MCP request failed (${response.status}): ${payload?.error?.message ?? "unknown error"}`);
  if (payload?.error) throw new Error(`MCP ${method} failed: ${payload.error.message ?? "unknown error"}`);
  return payload?.result;
}

await rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "hitek-agent-desk-smoke", version: "0.1.0" },
});
await rpc("notifications/initialized", undefined, { notification: true });
const listing = await rpc("tools/list", {});
const tools = Array.isArray(listing?.tools) ? listing.tools : [];
console.log(`MCP initialized; ${tools.length} tools available.`);
console.log(tools.map((tool) => tool.name).join(", ") || "No tools returned.");

const readTool = process.env.HITEK_MCP_READ_TOOL?.trim();
if (readTool) {
  const args = JSON.parse(process.env.HITEK_MCP_READ_ARGS_JSON || "{}");
  const result = await rpc("tools/call", { name: readTool, arguments: args });
  console.log(`Read tool ${readTool} completed: ${JSON.stringify(result)}`);
}

const writeTool = process.env.HITEK_MCP_WRITE_TOOL?.trim();
if (!writeTool) process.exit(0);
if (process.env.HITEK_MCP_WRITE_CONFIRM !== "I_UNDERSTAND_THIS_WRITES_TO_STAGING") {
  throw new Error("Refusing a write. Set HITEK_MCP_WRITE_CONFIRM=I_UNDERSTAND_THIS_WRITES_TO_STAGING.");
}
const stagingLooking = isLoopback || /(^|[.-])staging([.-]|$)/i.test(parsed.hostname);
if (!stagingLooking && process.env.HITEK_MCP_ALLOW_NON_STAGING_WRITE !== "I_UNDERSTAND_THE_HOST_IS_SAFE") {
  throw new Error("Refusing a write to a host that does not look like staging.");
}
const writeArgs = JSON.parse(process.env.HITEK_MCP_WRITE_ARGS_JSON || "{}");
const writeResult = await rpc("tools/call", { name: writeTool, arguments: writeArgs });
console.log(`Write tool ${writeTool} completed: ${JSON.stringify(writeResult)}`);
