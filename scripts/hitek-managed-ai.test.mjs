import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createGateway } from "../deploy/hitek/ai-gateway/server.mjs";
import { runControlOmb, verificationServerArgs, verificationServerEnvironment } from "./control-omb.ts";
import { freePortBlock } from "../server/testing/ports.ts";
import { removeTempDir, waitForExit } from "../server/testing/cleanup.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const pilotToken = "pilot-fixture-credential-not-real-123456789";
let home, child, gateway, provider, base, log = "";
const received = [];
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
const api = async (path, method = "GET", body) => {
  const response = await fetch(base + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
};

beforeAll(async () => {
  provider = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    received.push({ body, authorization: req.headers.authorization });
    const message = "Managed fixture answer";
    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: message }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 4 } })}\n\ndata: [DONE]\n\n`);
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: message }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 4 } }));
    }
  });
  const upstream = await listen(provider);
  gateway = createGateway({ OPENAI_API_KEY: "provider-only-fixture-key", HITEK_AI_GATEWAY_TOKEN: pilotToken, HITEK_AI_MODEL: "fixture-model", HITEK_AI_UPSTREAM_URL: upstream });
  const gatewayUrl = await listen(gateway);
  home = mkdtempSync(join(tmpdir(), "hitek-managed-ai-"));
  mkdirSync(join(home, "tmp"));
  writeFileSync(join(home, "config.json"), JSON.stringify({ instances: {} }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  const env = {
    ...verificationServerEnvironment(process.env, home, port), HITEK_MANAGED_SERVICE: "1",
    OPENAI_COMPAT_API_KEY: pilotToken, OPENAI_COMPAT_URL: `${gatewayUrl}/v1`, OPENAI_COMPAT_MODEL: "fixture-model",
  };
  expect(env.OPENAI_API_KEY).toBeUndefined();
  child = spawn(process.execPath, verificationServerArgs(env), { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", chunk => { log += chunk; });
  child.stderr.on("data", chunk => { log += chunk; });
  await vi.waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`Fixture exited: ${log}`);
    expect((await fetch(base + "/api/health")).status).toBe(200);
  }, { timeout: 50000, interval: 250 });
}, 60000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  for (const server of [gateway, provider]) if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  if (home) await removeTempDir(home);
});

it("starts ready without CLI installation and refuses personal provider configuration", async () => {
  const config = await api("/api/config");
  expect(config.body.hitekManaged).toBe(true);
  const instances = await api("/api/instances");
  expect(instances.body.instances).toHaveLength(1);
  expect(instances.body.instances[0]).toMatchObject({ instanceId: "hitek-ai", readOnly: true });
  expect(JSON.stringify([config.body, instances.body])).not.toContain(pilotToken);
  expect((await api("/api/config", "PUT", { openaiCompat: { apiKey: "personal", model: "other" } })).status).toBe(403);
  expect((await api("/api/instances/openai-compat", "POST", { displayName: "Other", url: "https://other.test/v1", apiKey: "personal" })).status).toBe(403);
});

it("answers a synthetic chat through the isolated gateway with a server-selected model", async () => {
  const created = await runControlOmb(["new-bot", "--name", "Managed Probe", "--url", base]);
  const botId = created.bot.id;
  expect(created.bot.modelSelection).toEqual({ instanceId: "hitek-ai", model: "fixture-model" });
  await expect(runControlOmb(["set-model", "--bot", botId, "--instance", "hitek-ai", "--model", "other", "--url", base])).rejects.toThrow();
  await runControlOmb(["send", "--bot", botId, "--text", "Return a synthetic fixture answer without tools.", "--url", base]);
  const settled = await runControlOmb(["wait", "--bot", botId, "--timeout", "40", "--url", base]);
  expect(settled.status).toBe("settled");
  const messages = await runControlOmb(["messages", "--bot", botId, "--limit", "10", "--url", base]);
  expect(JSON.stringify(messages)).toContain("Managed fixture answer");
  expect(received.length).toBeGreaterThan(0);
  for (const request of received) {
    expect(request.authorization).toBe("Bearer provider-only-fixture-key");
    expect(request.body.model).toBe("fixture-model");
    expect(request.body.max_completion_tokens).toBe(4096);
  }
  expect(readFileSync(join(home, "config.json"), "utf8")).not.toContain(pilotToken);
}, 60000);
