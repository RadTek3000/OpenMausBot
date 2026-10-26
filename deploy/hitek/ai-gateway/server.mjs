import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const hash = value => createHash("sha256").update(value).digest();
const allowedFields = new Set(["model", "messages", "tools", "tool_choice", "parallel_tool_calls", "stream", "stream_options", "response_format", "max_completion_tokens", "max_tokens"]);

function integer(env, key, fallback, max) {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${key}`);
  return value;
}

export function gatewayConfig(env) {
  const key = env.OPENAI_API_KEY?.trim();
  const token = env.HITEK_AI_GATEWAY_TOKEN;
  const model = env.HITEK_AI_MODEL?.trim();
  if (!key || /\s/.test(key)) throw new Error("OPENAI_API_KEY is required");
  if (!token || !/^[\x21-\x7e]{32,256}$/.test(token)) throw new Error("HITEK_AI_GATEWAY_TOKEN must contain 32-256 non-space ASCII characters");
  if (token === key) throw new Error("The gateway token must differ from the provider key");
  if (!model || !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,159}$/.test(model)) throw new Error("HITEK_AI_MODEL is required");
  const url = new URL(env.HITEK_AI_UPSTREAM_URL || "https://api.openai.com/v1");
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash) throw new Error("Invalid HITEK_AI_UPSTREAM_URL");
  const reasoning = env.HITEK_AI_REASONING_EFFORT?.trim();
  if (reasoning && !["none", "minimal", "low", "medium", "high"].includes(reasoning)) throw new Error("Invalid HITEK_AI_REASONING_EFFORT");
  return {
    key, tokenHash: hash(token), model, reasoning,
    endpoint: `${url.href.replace(/\/+$/, "")}/chat/completions`,
    maxOutput: integer(env, "HITEK_AI_MAX_OUTPUT_TOKENS", 4096, 32768),
    maxBody: integer(env, "HITEK_AI_MAX_REQUEST_BYTES", 1048576, 8388608),
    maxConcurrent: integer(env, "HITEK_AI_MAX_CONCURRENT", 2, 16),
    requestsPerMinute: integer(env, "HITEK_AI_REQUESTS_PER_MINUTE", 30, 600),
    timeoutMs: integer(env, "HITEK_AI_TIMEOUT_MS", 120000, 300000),
  };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    const timer = setTimeout(() => fail(408), 15000);
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", data); req.off("end", end); req.off("error", error); req.off("aborted", aborted);
    };
    const fail = status => { cleanup(); req.resume(); reject(Object.assign(new Error("Invalid request body"), { status })); };
    const data = chunk => { bytes += chunk.length; if (bytes > limit) fail(413); else chunks.push(chunk); };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks).toString("utf8")); };
    const error = () => fail(400), aborted = () => fail(400);
    req.on("data", data); req.on("end", end); req.on("error", error); req.on("aborted", aborted);
  });
}

function json(res, status, message) {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", connection: "close" });
  res.end(JSON.stringify(status === 200 ? { ok: true } : { error: { message } }));
}

/** One isolated pilot credential. Limits are per process, not durable billing quotas. */
export function createGateway(env = process.env, fetcher = fetch) {
  const config = gatewayConfig(env);
  let active = 0, requestTimes = [];
  const handle = async (req, res) => {
    if (req.method === "GET" && req.url === "/health") return json(res, 200);
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") return json(res, 404, "Not found");
    const auth = req.headers.authorization;
    if (typeof auth !== "string" || !auth.startsWith("Bearer ") || !timingSafeEqual(hash(auth.slice(7)), config.tokenHash)) return json(res, 401, "Invalid gateway credential");
    if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json" || req.headers["content-encoding"]) return json(res, 415, "JSON is required");
    const now = Date.now();
    requestTimes = requestTimes.filter(time => time > now - 60000);
    if (active >= config.maxConcurrent || requestTimes.length >= config.requestsPerMinute) {
      res.setHeader("retry-after", "60");
      return json(res, 429, "Pilot request limit reached");
    }
    active++; requestTimes.push(now);
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.on("close", abort);
    const timer = setTimeout(abort, config.timeoutMs);
    try {
      let body;
      try { body = JSON.parse(await readBody(req, config.maxBody)); }
      catch (error) { return json(res, error.status || 400, "Invalid request body"); }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowedFields.has(key)) || body.model !== config.model || !Array.isArray(body.messages) || !body.messages.length || (body.stream !== undefined && typeof body.stream !== "boolean")) return json(res, 400, "Unsupported model or request");
      const requestedOutput = body.max_completion_tokens ?? body.max_tokens ?? config.maxOutput;
      if (!Number.isSafeInteger(requestedOutput) || requestedOutput < 1) return json(res, 400, "Invalid output limit");
      const payload = {
        model: config.model, messages: body.messages, stream: body.stream === true, store: false,
        max_completion_tokens: Math.min(requestedOutput, config.maxOutput),
        ...(config.reasoning ? { reasoning_effort: config.reasoning } : {}),
        ...(body.stream ? { stream_options: { include_usage: true } } : {}),
        ...Object.fromEntries(["tools", "tool_choice", "parallel_tool_calls", "response_format"].filter(key => body[key] !== undefined).map(key => [key, body[key]])),
      };
      // No caller-controlled upstream address, credentials, redirects or forwarded headers.
      const upstream = await fetcher(config.endpoint, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { authorization: `Bearer ${config.key}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        return json(res, upstream.status === 429 ? 429 : 502, "AI provider request failed; contact your service administrator");
      }
      const mime = upstream.headers.get("content-type")?.split(";")[0];
      if (!upstream.body || (mime !== "application/json" && !(body.stream && mime === "text/event-stream"))) {
        await upstream.body?.cancel();
        return json(res, 502, "Invalid AI provider response");
      }
      res.writeHead(200, { "content-type": mime, "cache-control": "no-store", "x-content-type-options": "nosniff", "x-accel-buffering": "no" });
      let bytes = 0;
      const bounded = new Transform({ transform(chunk, _encoding, done) {
        bytes += chunk.length;
        done(bytes > 8388608 ? new Error("Provider response too large") : null, chunk);
      } });
      await pipeline(Readable.fromWeb(upstream.body), bounded, res, { signal: controller.signal });
    } catch {
      json(res, controller.signal.aborted ? 504 : 502, "AI gateway request failed");
      if (res.headersSent && !res.writableEnded) res.destroy();
    } finally {
      clearTimeout(timer); res.off("close", abort); controller.abort(); active--;
    }
  };
  return createServer({ maxHeaderSize: 8192, headersTimeout: 10000, requestTimeout: 30000 }, (req, res) => {
    void handle(req, res).catch(() => { json(res, 500, "AI gateway request failed"); res.destroy(); });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const server = createGateway();
    server.listen(integer(process.env, "PORT", 8080, 65535), "0.0.0.0", () => console.log("HITEK AI gateway ready"));
    const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 5000).unref(); };
    process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  } catch {
    console.error("HITEK AI gateway configuration is invalid; check the required service variables.");
    process.exitCode = 1;
  }
}
