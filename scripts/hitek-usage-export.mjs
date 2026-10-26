import { createHash } from "node:crypto";
import { createReadStream, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

function requiredText(row, key) {
  const value = row[key];
  if (typeof value !== "string" || !value || value.length > 512) throw new Error(`Invalid usage field: ${key}`);
  return value;
}

export function usageEvent(line, workspace, month, index) {
  const row = JSON.parse(line);
  for (const key of ["input", "output"]) {
    if (!Number.isSafeInteger(row[key]) || row[key] < 0) throw new Error(`Invalid usage field: ${key}`);
  }
  if (typeof row.at !== "string" || !Number.isFinite(Date.parse(row.at))) throw new Error("Invalid usage timestamp.");
  if (row.costUsd != null && (typeof row.costUsd !== "number" || !Number.isFinite(row.costUsd) || row.costUsd < 0)) throw new Error("Invalid usage cost.");
  return {
    workspace_id: workspace,
    event_id: createHash("sha256").update(JSON.stringify([workspace, month, index, line])).digest("hex"),
    occurred_at: new Date(row.at).toISOString(),
    bot_id: requiredText(row, "botId"), thread_id: requiredText(row, "threadId"), turn_id: row.turnId == null ? null : requiredText(row, "turnId"),
    model: requiredText(row, "model"), driver: requiredText(row, "driverKind"),
    input_tokens: row.input, output_tokens: row.output, cost_usd: row.costUsd ?? null,
  };
}

export async function exportUsage({ dataDir, workspace, month, env = process.env, fetchImpl = fetch }) {
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(workspace) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Supply a deployment ID and a YYYY-MM month.");
  const url = new URL(env.HITEK_USAGE_SUPABASE_URL ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Usage storage requires an HTTPS Supabase origin.");
  const key = env.HITEK_USAGE_SERVICE_KEY ?? "";
  let serviceRole = false;
  try { serviceRole = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url")).role === "service_role"; } catch { serviceRole = false; }
  if (!key.startsWith("sb_secret_") && !serviceRole) throw new Error("Run this operator-only exporter with a Supabase secret/service-role key, never in a dealer runtime.");
  const usageDir = join(resolve(dataDir), "usage");
  const file = join(usageDir, `${month}.jsonl`);
  if (lstatSync(usageDir).isSymbolicLink() || !lstatSync(usageDir).isDirectory() || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw new Error("Export only regular usage files in the selected data directory.");
  let count = 0;
  let batch = [];
  async function send() {
    if (!batch.length) return;
    const response = await fetchImpl(new URL("/rest/v1/hitek_usage_events?on_conflict=workspace_id,event_id", url), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { apikey: key, ...(serviceRole ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json", prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(batch),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Usage export refused (HTTP ${response.status}); no source rows were removed. Check the schema and workspace registration.`);
    count += batch.length;
    batch = [];
  }
  const input = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let index = 0;
  try {
    for await (const line of lines) {
      index++;
      if (!line.trim()) continue;
      if (line.length > 64 * 1024) throw new Error(`Usage row ${index} is too large.`);
      try { batch.push(usageEvent(line, workspace, month, index)); }
      catch { throw new Error(`Usage row ${index} is invalid; retry after the writer settles or investigate the source ledger.`); }
      if (batch.length === 200) await send();
    }
    await send();
  } finally { lines.close(); input.destroy(); }
  return { workspace, month, submitted: count, duplicatesIgnored: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [dataDir, workspace, month, ...extra] = process.argv.slice(2);
    if (!dataDir || !workspace || !month || extra.length) throw new Error("Usage: node scripts/hitek-usage-export.mjs <data-directory> <deployment-id> <YYYY-MM>");
    console.log(JSON.stringify(await exportUsage({ dataDir, workspace, month })));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Usage export failed.");
    process.exitCode = 1;
  }
}
