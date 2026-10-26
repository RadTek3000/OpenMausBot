import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { createGateway, gatewayConfig } from "../deploy/hitek/ai-gateway/server.mjs";

const token = "pilot-fixture-credential-not-real-123456789";
const env = extra => ({ OPENAI_API_KEY: "provider-fixture-key", HITEK_AI_GATEWAY_TOKEN: token, HITEK_AI_MODEL: "fixture-model", ...extra });
const servers = [];
async function listen(server) {
  servers.push(server);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
afterEach(async () => {
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
const body = extra => ({ model: "fixture-model", messages: [{ role: "user", content: "Synthetic fixture" }], ...extra });
const request = (base, payload = body(), extra = {}) => fetch(`${base}/v1/chat/completions`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload), ...extra,
});

it("fails closed for incomplete credentials, unsafe endpoints and invalid limits", () => {
  for (const patch of [
    { OPENAI_API_KEY: "" }, { HITEK_AI_GATEWAY_TOKEN: "short" }, { HITEK_AI_GATEWAY_TOKEN: "provider-fixture-key" },
    { HITEK_AI_MODEL: "" }, { HITEK_AI_UPSTREAM_URL: "http://external.example/v1" },
    { HITEK_AI_UPSTREAM_URL: "https://user:pass@upstream.example/v1" }, { HITEK_AI_UPSTREAM_URL: "https://upstream.example/v1?key=value" },
    { HITEK_AI_MAX_OUTPUT_TOKENS: "0" }, { HITEK_AI_MAX_CONCURRENT: "100" },
  ]) expect(() => gatewayConfig(env(patch))).toThrow();
  expect(() => gatewayConfig(env())).not.toThrow();
});

it("rejects unauthorized requests and extra routes before contacting the provider", async () => {
  const upstream = vi.fn();
  const base = await listen(createGateway(env(), upstream));
  expect((await fetch(`${base}/health`)).status).toBe(200);
  for (const authorization of ["", "Bearer wrong", `Bearer ${token}wrong`]) {
    expect((await request(base, body(), { headers: { authorization, "content-type": "application/json" } })).status).toBe(401);
  }
  for (const path of ["/v1/models", "/v1/responses", "/v1/chat/completions?url=https://other.example"]) expect((await fetch(base + path)).status).toBe(404);
  expect(upstream).not.toHaveBeenCalled();
});

it("rejects model changes, storage, unbounded choices and oversized requests", async () => {
  const upstream = vi.fn();
  const base = await listen(createGateway(env({ HITEK_AI_MAX_REQUEST_BYTES: "512" }), upstream));
  for (const patch of [{ model: "other" }, { n: 100 }, { store: true }, { api_key: "other" }, { messages: [] }, { stream: "true" }, { max_tokens: -1 }]) expect((await request(base, body(patch))).status).toBe(400);
  expect((await request(base, body({ messages: [{ role: "user", content: "x".repeat(1000) }] }))).status).toBe(413);
  expect((await request(base, body(), { headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" } })).status).toBe(415);
  expect(upstream).not.toHaveBeenCalled();
});

it("forwards only pinned bounded requests with the provider credential over real HTTP", async () => {
  const received = [];
  const remote = await listen(createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ path: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks)) });
    res.writeHead(200, { "content-type": "application/json", "set-cookie": "private=value" });
    res.end(JSON.stringify({ choices: [{ message: { content: "Fixture answer" } }], usage: { prompt_tokens: 2, completion_tokens: 3 } }));
  }));
  const base = await listen(createGateway(env({ HITEK_AI_UPSTREAM_URL: `${remote}/v1`, HITEK_AI_REASONING_EFFORT: "low" })));
  const response = await request(base, body({ max_completion_tokens: 9000, tools: [{ type: "function", function: { name: "fixture_tool", parameters: {} } }] }), { headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "openai-organization": "untrusted", "x-forwarded-for": "untrusted" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect((await response.json()).usage.completion_tokens).toBe(3);
  expect(received).toHaveLength(1);
  expect(received[0].path).toBe("/v1/chat/completions");
  expect(received[0].headers.authorization).toBe("Bearer provider-fixture-key");
  expect(received[0].headers["openai-organization"]).toBeUndefined();
  expect(received[0].headers["x-forwarded-for"]).toBeUndefined();
  expect(received[0].body).toMatchObject({ model: "fixture-model", store: false, max_completion_tokens: 4096, reasoning_effort: "low" });
  expect(received[0].body.tools[0].function.name).toBe("fixture_tool");
});

it("streams tool calls and token usage without buffering the response", async () => {
  const wire = 'data: {"choices":[{"delta":{"tool_calls":[{"id":"test","function":{"name":"lookup","arguments":"{}"}}]}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\ndata: [DONE]\n\n';
  const upstream = vi.fn(async () => new Response(wire, { headers: { "content-type": "text/event-stream" } }));
  const base = await listen(createGateway(env(), upstream));
  const response = await request(base, body({ stream: true, stream_options: { include_usage: false } }));
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  expect(await response.text()).toBe(wire);
  expect(JSON.parse(upstream.mock.calls[0][1].body).stream_options).toEqual({ include_usage: true });
});

it("does not follow provider redirects or expose provider errors", async () => {
  let leaked = false;
  const other = await listen(createServer((_req, res) => { leaked = true; res.end("unexpected"); }));
  const upstream = await listen(createServer((_req, res) => { res.writeHead(302, { location: other }); res.end(); }));
  const base = await listen(createGateway(env({ HITEK_AI_UPSTREAM_URL: upstream })));
  expect((await request(base)).status).toBe(502);
  expect(leaked).toBe(false);
  const failureBase = await listen(createGateway(env(), async () => new Response("provider-fixture-key private diagnostic", { status: 401 })));
  const failure = await request(failureBase);
  expect(failure.status).toBe(502);
  expect(await failure.text()).not.toMatch(/fixture-key|private diagnostic/);
});

it("enforces the pilot's request limit", async () => {
  const upstream = vi.fn(async () => Response.json({ choices: [] }));
  const base = await listen(createGateway(env({ HITEK_AI_REQUESTS_PER_MINUTE: "1" }), upstream));
  expect((await request(base)).status).toBe(200);
  const second = await request(base);
  expect(second.status).toBe(429);
  expect(second.headers.get("retry-after")).toBe("60");
  expect(upstream).toHaveBeenCalledTimes(1);
});

it("bounds concurrent work and releases the slot after provider timeout", async () => {
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const upstream = vi.fn((_url, options) => { started(); return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })); });
  const base = await listen(createGateway(env({ HITEK_AI_MAX_CONCURRENT: "1", HITEK_AI_TIMEOUT_MS: "150" }), upstream));
  const first = request(base);
  await began;
  expect((await request(base)).status).toBe(429);
  expect((await first).status).toBe(504);
  expect((await request(base)).status).toBe(504);
  expect(upstream).toHaveBeenCalledTimes(2);
});
