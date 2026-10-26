import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { hitekModelPolicy, HITEK_AI_INSTANCE } from "./hitek-model-policy.ts";
import { ProviderRegistry } from "./harness/registry.ts";
import { OpenAICompatDriver } from "./drivers/openai-compat.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import type { Store } from "./store.ts";

const directories: string[] = [], registries: ProviderRegistry[] = [];
const directory = () => { const path = mkdtempSync(join(tmpdir(), "hitek-model-policy-")); directories.push(path); return path; };
const env = () => ({ HITEK_MANAGED_SERVICE: "1", OPENAI_COMPAT_API_KEY: "fixture-only-key", OPENAI_COMPAT_URL: "https://provider.example.test/v1", OPENAI_COMPAT_MODEL: "fixture-model" });
afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.disposeAll();
  vi.unstubAllGlobals();
  for (const path of directories.splice(0)) await removeTempDir(path);
});

it("leaves desktops and unprovisioned services unchanged, and rejects incomplete managed configuration", () => {
  expect(hitekModelPolicy(directory(), {})).toBeNull();
  expect(hitekModelPolicy(directory(), { ...env(), HITEK_MANAGED_SERVICE: "0" })).toBeNull();
  expect(hitekModelPolicy(directory(), { HITEK_MANAGED_SERVICE: "1" })).toBeNull();
  for (const key of ["OPENAI_COMPAT_API_KEY", "OPENAI_COMPAT_URL", "OPENAI_COMPAT_MODEL"] as const) {
    expect(() => hitekModelPolicy(directory(), { ...env(), [key]: "" })).toThrow("requires");
  }
  expect(() => hitekModelPolicy(directory(), { ...env(), OMB_HOSTED_MODELS: "{}" })).toThrow("only one");
});

it.each(["http://external.example.test/v1", "https://user:pass@provider.example.test/v1", "https://provider.example.test/v1?key=secret", "file:///tmp/provider"])("rejects unsafe operator endpoints: %s", url => {
  expect(() => hitekModelPolicy(directory(), { ...env(), OPENAI_COMPAT_URL: url })).toThrow();
});

it("pins new and existing selections to the operator model and keeps keys out of persistable config", () => {
  const policy = hitekModelPolicy(directory(), env())!;
  expect(policy.select({ instanceId: "personal", model: "other" })).toEqual({ instanceId: HITEK_AI_INSTANCE, model: "fixture-model" });
  expect(policy.allows(policy.select())).toBe(true);
  expect(policy.allows({ ...policy.select(), effort: "high" })).toBe(false);
  expect(policy.allows({ ...policy.select(), model: "other" })).toBe(false);
  const config = policy.configs()[HITEK_AI_INSTANCE];
  expect(config.config).toMatchObject({ managedModels: ["fixture-model"], url: "https://provider.example.test/v1" });
  expect(JSON.stringify(config.config)).not.toContain("fixture-only-key");
});

it("prevents model overrides on chat and helpers without fetching a public catalog", async () => {
  const policy = hitekModelPolicy(directory(), env())!;
  const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ choices: [{ message: { content: "Fixture answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2 } }));
  vi.stubGlobal("fetch", fetcher);
  const registry = new ProviderRegistry([OpenAICompatDriver], { npmAvailable: () => false }); registries.push(registry);
  await registry.load(policy.configs(), instance => policy.decorate(instance));
  const instance = registry.get(HITEK_AI_INSTANCE)!;
  expect(fetcher).not.toHaveBeenCalled();
  expect(instance.startAuthentication).toBeUndefined();
  await expect(instance.adapter.sendTurn({ threadId: "test", text: "Synthetic", model: "other" })).rejects.toThrow("managed");
  await expect(instance.generateText!("Synthetic", { model: "other" })).rejects.toThrow("managed");
  expect(fetcher).not.toHaveBeenCalled();
  expect(await instance.generateText!("Synthetic")).toBe("Fixture answer");
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).model).toBe("fixture-model");
});

it("reconciles selections and cursors without replacing conversation history or storing credentials", () => {
  const root = directory(), policy = hitekModelPolicy(root, env())!;
  const patchBot = vi.fn(), patchTask = vi.fn();
  const store = { bots: [{ id: "bot", modelSelection: { instanceId: "old", model: "old" } }], tasks: () => [{ threadId: "thread", modelSelection: { instanceId: "old", model: "old" } }], patchBot, patchTask };
  policy.reconcile(store as unknown as Store);
  expect(patchBot).toHaveBeenCalledWith("bot", { modelSelection: policy.select() });
  expect(patchTask).toHaveBeenCalledWith("bot", "thread", expect.objectContaining({ modelSelection: policy.select(), resumeCursors: {}, rewound: true }));
  expect(readFileSync(join(root, "hitek-model-policy.json"), "utf8")).not.toContain("fixture-only-key");
});
