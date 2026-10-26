import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { loadBrand } from "./brand.ts";
import { hitekManagedService } from "./hitek-managed.ts";
import type { hostedModelPolicy } from "./hosted-models.ts";
import type { ModelSelection } from "./contracts.ts";

export const HITEK_AI_INSTANCE = "hitek-ai";
const SETTINGS_ERROR = "AI is managed by your service administrator.";
type ModelPolicy = NonNullable<ReturnType<typeof hostedModelPolicy>>;

/** An operator-provisioned, single-workspace API credential; never a platform-wide master key. */
export function hitekModelPolicy(dataDirectory: string, env: NodeJS.ProcessEnv = process.env): ModelPolicy | null {
  if (!hitekManagedService(env)) return null;
  const fields = [env.OPENAI_COMPAT_API_KEY, env.OPENAI_COMPAT_URL, env.OPENAI_COMPAT_MODEL];
  if (fields.every(value => value === undefined)) return null;
  if (fields.some(value => !value?.trim())) throw new Error("Managed AI requires an API key, base URL and model in the server environment.");
  if (env.OMB_HOSTED_MODELS !== undefined || env.OMB_HOSTED_MODEL_TOKEN !== undefined) throw new Error("Configure only one managed AI policy.");
  let endpoint: URL;
  try { endpoint = new URL(env.OPENAI_COMPAT_URL!.trim()); } catch { throw new Error("Invalid managed AI base URL."); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
  if ((endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Managed AI requires HTTPS, or a loopback HTTP endpoint for local testing.");
  }
  const url = endpoint.href.replace(/\/+$/, "");
  const model = env.OPENAI_COMPAT_MODEL!.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,159}$/.test(model)) throw new Error("Invalid managed AI model.");
  const key = env.OPENAI_COMPAT_API_KEY!.trim();
  const selection: ModelSelection = { instanceId: HITEK_AI_INSTANCE, model };
  const allows = (value: ModelSelection) => value.instanceId === selection.instanceId && value.model === model && value.effort === undefined && value.variant === undefined;
  const reset = { resumeCursors: {}, lastInstanceId: undefined, rewound: true, lastContextModel: undefined, appliedCompactionId: undefined };
  return {
    allows,
    select: () => ({ ...selection }),
    resetTask: (previous, next) => JSON.stringify(previous) === JSON.stringify(next) ? {} : { ...reset },
    error: () => SETTINGS_ERROR,
    configs() {
      const brand = loadBrand().brand;
      return { [HITEK_AI_INSTANCE]: {
        driver: "openai-compat", displayName: `${brand.organizationName || brand.name} AI`, access: "api",
        config: { url, apiKeyEnv: "OPENAI_COMPAT_API_KEY", model, managedModels: [model], provider: "" },
        environment: { OPENAI_COMPAT_API_KEY: key },
      } };
    },
    decorate(instance) {
      return {
        ...instance,
        models: { default: model, options: [{ id: model, label: model }] },
        refreshModels: async () => {},
        installRuntime: undefined, startAuthentication: undefined, getAuthentication: undefined,
        completeAuthentication: undefined, cancelAuthentication: undefined, signOut: undefined,
        adapter: { ...instance.adapter, sendTurn: async input => {
          if (!allows({ instanceId: instance.instanceId, model: input.model ?? "", effort: input.effort, variant: input.variant })) throw new Error(SETTINGS_ERROR);
          return instance.adapter.sendTurn(input);
        } },
        generateText: instance.generateText ? async (prompt, options) => {
          if (options?.model && options.model !== model) throw new Error(SETTINGS_ERROR);
          return instance.generateText!(prompt, { ...options, model });
        } : undefined,
      };
    },
    reconcile(store) {
      const marker = join(dataDirectory, "hitek-model-policy.json");
      const identity = JSON.stringify({ version: 1, url, model });
      const routeChanged = !existsSync(marker) || readFileSync(marker, "utf8") !== identity;
      for (const bot of store.bots) {
        for (const task of store.tasks(bot.id)) {
          const current = task.modelSelection ?? bot.modelSelection;
          if (routeChanged || !allows(current)) store.patchTask(bot.id, task.threadId, {
            ...(task.modelSelection ? { modelSelection: { ...selection } } : {}), ...reset,
          });
        }
        if (!allows(bot.modelSelection)) store.patchBot(bot.id, { modelSelection: { ...selection } });
      }
      writeFileAtomic(marker, identity, { mode: 0o600 });
    },
  };
}
