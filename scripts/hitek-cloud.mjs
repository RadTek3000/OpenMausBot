import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const template = fileURLToPath(new URL("../deploy/hitek/cloud/", import.meta.url));
const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function required(values, name) {
  const value = values[name]?.trim();
  if (!value || /[\r\n\0$]/.test(value) || /REPLACE_|your-project|your-account/.test(value)) throw new Error(`Set ${name} to a real deployment value.`);
  return value;
}

function publicOrigin(raw, name, allowPath = false) {
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${name} must be a public HTTPS address.`); }
  if (url.protocol !== "https:" || !hostnamePattern.test(url.hostname) || /\.(localhost|local|internal)$/.test(url.hostname) ||
      url.username || url.password || url.search || url.hash || (!allowPath && url.pathname !== "/")) {
    throw new Error(`${name} must be a public HTTPS ${allowPath ? "address" : "origin"} without credentials.`);
  }
  return url;
}

export function parseRuntimeEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(env, match[1])) throw new Error("runtime.env must contain unique NAME=value lines without quoting.");
    env[match[1]] = match[2];
  }
  return env;
}

export function validateDeployment(settings, runtime) {
  const id = required(settings, "HITEK_DEPLOYMENT_ID");
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) throw new Error("HITEK_DEPLOYMENT_ID must contain 2-40 lowercase letters, digits or hyphens.");
  const domain = required(settings, "HITEK_DOMAIN");
  if (!hostnamePattern.test(domain)) throw new Error("HITEK_DOMAIN must be a DNS hostname, without a scheme, path or port.");
  publicOrigin(`https://${domain}`, "HITEK_DOMAIN");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(required(settings, "HITEK_TLS_EMAIL"))) throw new Error("Set a valid HITEK_TLS_EMAIL.");
  const image = required(settings, "HITEK_IMAGE");
  if (!/^[a-z0-9][a-z0-9./_-]+(?::[0-9]+\/[a-z0-9./_-]+)?(?:@sha256:[a-f0-9]{64}|:hitek-[a-f0-9]{40})$/.test(image)) {
    throw new Error("HITEK_IMAGE must use a sha256 digest or a hitek-<40 character commit SHA> tag.");
  }
  publicOrigin(required(runtime, "HITEK_SUPABASE_URL"), "HITEK_SUPABASE_URL");
  const key = required(runtime, "HITEK_SUPABASE_PUBLISHABLE_KEY");
  let anon = false;
  try { anon = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url")).role === "anon"; } catch { anon = false; }
  if (!key.startsWith("sb_publishable_") && !anon) throw new Error("Dealer runtimes require a publishable/anon Supabase key, never a service-role key.");
  const admins = required(runtime, "OMB_SIGNIN_EMAILS").split(/[,\s]+/);
  const members = (runtime.OMB_SIGNIN_MEMBER_EMAILS ?? "").split(/[,\s]+/).filter(Boolean);
  if ([...admins, ...members].some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("The hosted pilot requires individual email allow-list entries, not whole-domain access.");
  }
  publicOrigin(required(runtime, "HITEK_MCP_URL"), "HITEK_MCP_URL", true);
  if (/\s/.test(required(runtime, "HITEK_MCP_OAUTH_CLIENT_ID"))) throw new Error("The MCP client ID cannot contain whitespace.");
  if (Object.keys(runtime).some(key => key.startsWith("OMB_ADMIN_") || ["OMB_CLOUD_ROLE", "HITEK_MCP_TOKEN", "HITEK_USAGE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY"].includes(key))) {
    throw new Error("This pilot uses Supabase sign-in and per-dealer MCP OAuth, not upstream portal settings or a shared CRM token.");
  }
  return { id, domain, image, publicUrl: `https://${domain}`, callbackUrl: `https://${domain}/mcp-oauth/callback` };
}

export function readDeployment(directory) {
  const settings = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
  const release = join(directory, "release.env");
  if (existsSync(release)) Object.assign(settings, parseEnv(readFileSync(release, "utf8")));
  const runtime = parseRuntimeEnv(readFileSync(join(directory, "runtime.env"), "utf8"));
  return validateDeployment(settings, runtime);
}

export function initializeDeployment(directory) {
  mkdirSync(directory, { mode: 0o700 });
  for (const [source, target] of [
    [".env.example", ".env"], ["runtime.env.example", "runtime.env"],
    ["compose.yaml", "compose.yaml"], ["Caddyfile", "Caddyfile"], ["deploy.sh", "deploy.sh"],
    ["backup.sh", "backup.sh"], ["backup.env.example", "backup.env"],
  ]) {
    writeFileSync(join(directory, target), readFileSync(join(template, source)), {
      flag: "wx", mode: target === "Caddyfile" ? 0o644 : target.endsWith(".sh") ? 0o700 : 0o600,
    });
  }
  writeFileSync(join(directory, "check.mjs"), readFileSync(fileURLToPath(import.meta.url)), { flag: "wx", mode: 0o600 });
}

export async function probeDeployment(config, fetchImpl = fetch) {
  const get = async (path) => fetchImpl(`${config.publicUrl}${path}`, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  const health = await get("/api/health");
  if (!health.ok || (await health.json()).app !== "openmausbot") throw new Error("The public runtime health check failed.");
  const privateApi = await get("/api/bots");
  if (![401, 403].includes(privateApi.status)) throw new Error("The private API did not reject an unauthenticated request.");
  await privateApi.body?.cancel();
  const descriptor = await get("/.well-known/openmausbot/environment");
  if (!descriptor.ok || (await descriptor.json()).capabilities?.emailSignIn !== true) throw new Error("Email sign-in is not enabled on the public runtime.");
  const hook = await get("/hooks/wh_hitek_health_probe");
  if (![400, 401, 404, 405].includes(hook.status) || !(hook.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error("The public webhook path did not reach the webhook receiver.");
  }
  await hook.body?.cancel();
  return { healthy: true, privateApiProtected: true, emailSignIn: true, webhookIngress: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, path, ...extra] = process.argv.slice(2);
    if (!path || extra.length || !["init", "validate", "probe"].includes(command)) throw new Error("Usage: node scripts/hitek-cloud.mjs <init|validate|probe> <deployment-directory>");
    const directory = resolve(path);
    if (command === "init") {
      initializeDeployment(directory);
      console.log(`Created an unconfigured deployment at ${directory}.`);
    } else {
      const config = readDeployment(directory);
      console.log(JSON.stringify(command === "probe" ? await probeDeployment(config) : { valid: true, ...config }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Deployment command failed.");
    process.exitCode = 1;
  }
}
