import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { exportUsage, usageEvent } from "./hitek-usage-export.mjs";

const row = { at: "2026-10-26T12:00:00Z", botId: "bot", threadId: "thread", turnId: "turn", model: "fixture", driverKind: "fixture", input: 12, output: 8, costUsd: null,
  trigger: { kind: "user", email: "private@example.test" }, text: "private conversation", access_token: "private-token" };
const line = JSON.stringify(row);

it("exports only usage metadata and stable idempotency keys, retaining unknown costs", () => {
  const event = usageEvent(line, "dealer-one", "2026-10", 1);
  expect(event.event_id).toBe(usageEvent(line, "dealer-one", "2026-10", 1).event_id);
  expect(event.event_id).not.toBe(usageEvent(line, "dealer-two", "2026-10", 1).event_id);
  expect(event.event_id).not.toBe(usageEvent(line, "dealer-one", "2026-10", 2).event_id);
  expect(event).toMatchObject({ cost_usd: null, input_tokens: 12, output_tokens: 8, workspace_id: "dealer-one" });
  expect(JSON.stringify(event)).not.toContain("private");
});

it.each([{ input: -1 }, { output: 1.5 }, { costUsd: -1 }, { at: "invalid" }, { model: "" }])("refuses malformed usage instead of booking a misleading charge: %j", patch => {
  expect(() => usageEvent(JSON.stringify({ ...row, ...patch }), "dealer-one", "2026-10", 1)).toThrow();
});

it("replays in bounded idempotent batches and leaves the source ledger intact", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "hitek-usage-"));
  mkdirSync(join(dataDir, "usage"));
  const file = join(dataDir, "usage", "2026-10.jsonl");
  const source = `${Array(201).fill(line).join("\n")}\n`;
  writeFileSync(file, source);
  const fetchImpl = vi.fn().mockImplementation(async () => new Response(null, { status: 201 }));
  const env = { HITEK_USAGE_SUPABASE_URL: "https://storage.example.test", HITEK_USAGE_SERVICE_KEY: "sb_secret_fixture" };
  try {
    const options = { dataDir, workspace: "dealer-one", month: "2026-10", env, fetchImpl };
    expect(await exportUsage(options)).toMatchObject({ submitted: 201, duplicatesIgnored: true });
    await exportUsage(options);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls[0][1].body).toBe(fetchImpl.mock.calls[2][1].body);
    expect(fetchImpl.mock.calls[0][1].headers.prefer).toContain("ignore-duplicates");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toHaveLength(200);
    expect(readFileSync(file, "utf8")).toBe(source);
    fetchImpl.mockImplementationOnce(async () => Response.json({ message: "private database error" }, { status: 403 }));
    await expect(exportUsage(options)).rejects.toThrow(/HTTP 403/);
    expect(readFileSync(file, "utf8")).toBe(source);
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});
