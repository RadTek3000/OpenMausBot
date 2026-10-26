import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const image = process.argv[2];
if (!image || image.startsWith("-")) throw new Error("Pass the built gateway image reference");
const name = `hitek-ai-verify-${randomUUID().slice(0, 8)}`;
const docker = args => execFileSync("docker", args, { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] }).trim();
try {
  docker(["run", "-d", "--name", name, "--network", "none",
    "-e", "OPENAI_API_KEY=provider-fixture-only", "-e", "HITEK_AI_GATEWAY_TOKEN=fixture-gateway-credential-not-real-12345678",
    "-e", "HITEK_AI_MODEL=fixture-model", image]);
  const result = docker(["exec", name, "node", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    assert.notEqual(process.getuid(), 0);
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try { ready = (await fetch('http://127.0.0.1:8080/health')).ok; } catch {}
      if (ready) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(ready, 'gateway did not start');
    assert.equal((await fetch('http://127.0.0.1:8080/v1/chat/completions', {method:'POST'})).status, 401);
    assert.equal((await fetch('http://127.0.0.1:8080/v1/models')).status, 404);
    console.log('PASS non-root container startup, health, authentication and restricted routes');
  `]);
  assert.match(result, /^PASS/);
  console.log(result);
} finally {
  docker(["rm", "--force", name]);
}
