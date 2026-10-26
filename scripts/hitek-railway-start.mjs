import { spawn } from "node:child_process";
import { chownSync, readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function railwayConfiguration(env = process.env) {
  const port = Number(env.PORT || "8080");
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 8799 || port === 8800) {
    throw new Error("PORT must be an unprivileged TCP port distinct from the private listeners");
  }
  const rawOrigin = env.OMB_PUBLIC_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : "");
  const origin = publicOrigin(rawOrigin, "OMB_PUBLIC_URL");
  if (env.RAILWAY_PROJECT_ID && env.RAILWAY_VOLUME_MOUNT_PATH !== "/data") {
    throw new Error("Attach a Railway volume at /data before deploying the agent");
  }
  if (!env.HITEK_SUPABASE_URL || !env.HITEK_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Configure HITEK_SUPABASE_URL and HITEK_SUPABASE_PUBLISHABLE_KEY before exposing the agent");
  }
  const admins = (env.OMB_SIGNIN_EMAILS || "").split(/[\s,]+/).filter(Boolean);
  if (admins.length === 0 || admins.some((email) => email.startsWith("@") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("OMB_SIGNIN_EMAILS must contain named admin email addresses");
  }
  const webhookOrigin = publicOrigin(env.OMB_WEBHOOK_PUBLIC_URL || origin, "OMB_WEBHOOK_PUBLIC_URL");
  if (webhookOrigin !== origin) throw new Error("OMB_WEBHOOK_PUBLIC_URL must match OMB_PUBLIC_URL on this single-port deployment");
  return { port: String(port), origin };
}

function publicOrigin(raw, name) {
  let url;
  try { url = new URL(raw); } catch { throw new Error(`Set ${name} to a bare HTTPS origin`); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be a bare HTTPS origin`);
  }
  return url.origin;
}

export function childEnvironments(env, configuration) {
  const server = {
    ...env,
    HOME: "/data",
    OMB_DATA_DIR: "/data/.openmausbot",
    OMB_PORT: "8799",
    OMB_WEBHOOK_PORT: "8800",
    OMB_LOOPBACK_TRUST: "service",
    OMB_MCP_OAUTH_PUBLIC_CALLBACK: "1",
    OMB_PUBLIC_URL: configuration.origin,
    OMB_WEBHOOK_PUBLIC_URL: configuration.origin,
  };
  // Caddy never receives provider keys, CRM credentials, or sign-in settings.
  const edge = {
    PATH: env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: "/tmp/hitek-edge",
    XDG_DATA_HOME: "/tmp/hitek-edge/data",
    XDG_CONFIG_HOME: "/tmp/hitek-edge/config",
    PORT: configuration.port,
  };
  return { server, edge };
}

function serviceIds() {
  const line = readFileSync("/etc/passwd", "utf8").split("\n").find((entry) => entry.startsWith("maus:"));
  const fields = line?.split(":");
  if (!fields || !/^\d+$/.test(fields[2]) || !/^\d+$/.test(fields[3])) throw new Error("The service user is missing");
  return { uid: Number(fields[2]), gid: Number(fields[3]) };
}

export function startRailway(env = process.env) {
  process.umask(0o077);
  if (process.getuid?.() !== 0) throw new Error("Railway image must start as root to prepare its volume");
  const config = railwayConfiguration(env);
  const ids = serviceIds();
  const volume = statSync("/data");
  if (!volume.isDirectory()) throw new Error("/data is not a directory");
  if (volume.uid !== ids.uid || volume.gid !== ids.gid) chownSync("/data", ids.uid, ids.gid);
  const { server, edge } = childEnvironments(env, config);
  const children = [
    spawn(process.execPath, ["/app/dist-server/server-launcher.js"], { cwd: "/app", env: server, uid: ids.uid, gid: ids.gid, stdio: "inherit" }),
    spawn("/usr/local/bin/caddy", ["run", "--config", "/app/railway/Caddyfile", "--adapter", "caddyfile"], { cwd: "/app", env: edge, uid: ids.uid, gid: ids.gid, stdio: "inherit" }),
  ];
  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
    const timer = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); }, 20_000);
    timer.unref();
  };
  for (const child of children) {
    child.once("error", (error) => { console.error("Railway child failed:", error); stop(1); });
    child.once("exit", (code) => { if (!stopping) stop(code === 0 ? 1 : code || 1); });
  }
  process.once("SIGTERM", () => stop(0));
  process.once("SIGINT", () => stop(0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { startRailway(); } catch (error) {
    console.error(`Railway startup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
