import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const image = process.argv[2];
if (!image || process.argv.length !== 3) throw new Error("Usage: node scripts/smoke-hitek-railway.mjs <local-image>");
const id = `hitek-railway-smoke-${randomBytes(6).toString("hex")}`;
const volume = `${id}-data`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 120_000, windowsHide: true }).trim();
const socket = createServer();
await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
let containerCreated = false;
let volumeCreated = false;

async function ready() {
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      const health = await fetch(`${base}/api/health`);
      if (health.ok && (await health.json()).app === "openmausbot") return;
    } catch { /* Container startup is asynchronous. */ }
    await delay(1000);
  }
  throw new Error(`Railway fixture did not become ready: ${docker("logs", id)}`);
}

try {
  docker("volume", "create", volume);
  volumeCreated = true;
  docker("run", "-d", "--name", id, "--memory", "512m", "--cpus", "1", "--shm-size", "64m",
    "-p", `127.0.0.1:${port}:8080`, "-v", `${volume}:/data`,
    "-e", "PORT=8080", "-e", "RAILWAY_PROJECT_ID=fixture", "-e", "RAILWAY_VOLUME_MOUNT_PATH=/data",
    "-e", "OMB_PUBLIC_URL=https://desk-fixture.example.test", "-e", "HITEK_SUPABASE_URL=https://fixture.supabase.co",
    "-e", "HITEK_SUPABASE_PUBLISHABLE_KEY=sb_publishable_fixture", "-e", "OMB_SIGNIN_EMAILS=owner@dealer.test", image);
  containerCreated = true;
  await ready();
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /HITEK/);
  assert.equal((await fetch(`${base}/api/bots`)).status, 403);
  assert.equal((await fetch(`${base}/api/bots`, { headers: { "x-forwarded-for": "127.0.0.1" } })).status, 403);
  assert.notEqual((await fetch(`${base}/hooks/missing`)).status, 502);
  assert.equal(docker("exec", id, "stat", "-c", "%u", "/data"), docker("exec", id, "id", "-u", "maus"));
  docker("exec", "-u", "maus", id, "node", "-e", "require('node:fs').writeFileSync('/data/persistence-fixture', 'persisted')");
  docker("restart", id);
  await ready();
  assert.equal(docker("exec", "-u", "maus", id, "node", "-e", "process.stdout.write(require('node:fs').readFileSync('/data/persistence-fixture','utf8'))"), "persisted");
  console.log("PASS: Railway edge, HITEK assets, service trust, webhook routing and volume persistence under 512 MB.");
} finally {
  if (containerCreated) { try { docker("rm", "-f", id); } catch { /* Preserve the original failure. */ } }
  if (volumeCreated) { try { docker("volume", "rm", volume); } catch { /* Preserve the original failure. */ } }
}
